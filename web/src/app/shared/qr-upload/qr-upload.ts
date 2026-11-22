import { HttpClient } from '@angular/common/http';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Subscription, catchError, firstValueFrom, of, switchMap, timer } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AdminAuthService } from '../../services/admin-auth.service';

type QrStatus = 'creating' | 'waiting' | 'receiving' | 'expired' | 'error';

interface UploadSessionInfo {
  status: 'WAITING' | 'UPLOADED' | 'EXPIRED';
  filename?: string;
  mimetype?: string;
}

/** API of the QR code upload sessions and the public phone page the QR code opens (route `upload-file`). */
const UPLOAD_SESSIONS_API = `${environment.apiUrl.replace(/\/$/, '')}/upload-sessions`;
const UPLOAD_PAGE_PATH = 'upload-file';

const POLL_FIRST_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 2000;
const POLL_FAILURES_BEFORE_ERROR = 5;

/**
 * Upload control with a "Choose File" button and a "Scan QR" button: the QR code opens the upload page on the user's
 * phone, and the file sent from the phone shows up here as a normal `File` (emitted through `fileChange`), exactly
 * like a file chosen on this device. The parent keeps validating and submitting the `File` like any other.
 *
 * `purpose` is a key of UPLOAD_PURPOSES in the backend `upload-sessions/upload-session.config.ts` (e.g. `DOCUMENTS`).
 */
@Component({
  selector: 'app-qr-upload',
  standalone: true,
  templateUrl: './qr-upload.html',
  styleUrl: './qr-upload.css',
})
export class QrUploadComponent implements OnChanges, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);

  @Input({ required: true }) purpose!: string;
  @Input() inputId = '';
  @Input() accept = '';
  @Input() invalid = false;
  /** The file the parent already holds. */
  @Input() file: File | null = null;

  /** The "Choose File" input; it is emptied when the phone's file replaces its choice, so only one file is ever shown. */
  @ViewChild('fileInput', { static: true }) private fileInput?: ElementRef<HTMLInputElement>;

  @Output() readonly fileChange = new EventEmitter<File | null>();

  readonly panelOpen = signal(false);
  readonly status = signal<QrStatus>('creating');
  readonly qrImage = signal('');
  readonly secondsLeft = signal(0);
  readonly errorMessage = signal('');
  /** Where the current file came from, to mark the matching option as selected. */
  readonly source = signal<'device' | 'phone' | ''>('');

  /** A phone cannot scan its own screen, and its "Choose File" already offers the camera and files: no QR there. */
  readonly phoneLike =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse) and (max-width: 820px)').matches;
  /** A phone cannot open `localhost`; shown as a hint when testing from the same machine. */
  readonly localhostHint =
    typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  private pollSubscription?: Subscription;
  private countdownSubscription?: Subscription;
  /** Bumped by every new QR / cancel, so a response that arrives for an older QR is ignored. */
  private attempt = 0;
  /** Token of the QR code currently shown; discarded on the server when it is replaced, cancelled or the page is left. */
  private currentToken = '';

  get countdownText(): string {
    const total = Math.max(0, this.secondsLeft());
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The parent cleared the file (e.g. the modal was reset): empty the input too, so the same file can be chosen again.
    if (changes['file'] && !this.file) {
      if (this.fileInput?.nativeElement.value) {
        this.fileInput.nativeElement.value = '';
      }
      this.source.set('');
    }
  }

  ngOnDestroy(): void {
    this.stop();
    this.discardCurrentSession();
  }

  /** Marks the option the current file came from. */
  isSelected(source: 'device' | 'phone'): boolean {
    return !!this.file && this.source() === source;
  }

  openFilePicker(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileChosen(event: Event): void {
    const chosen = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (chosen) {
      // A file chosen here replaces the phone's file, and a QR code still waiting must not replace this one later.
      this.cancelScan();
    }
    this.source.set(chosen ? 'device' : '');
    this.fileChange.emit(chosen);
  }

  async startScan(): Promise<void> {
    this.stop();
    this.discardCurrentSession();
    const attempt = ++this.attempt;
    this.panelOpen.set(true);
    this.status.set('creating');
    this.qrImage.set('');
    this.errorMessage.set('');

    let token: string;
    let expiresAtMs: number;
    try {
      const session = await firstValueFrom(
        this.http.post<{ token: string; expires_at: string }>(
          UPLOAD_SESSIONS_API,
          { purpose: this.purpose },
          { headers: this.authService.getAdminApiHeaders() },
        ),
      );
      token = session.token;
      this.currentToken = token;
      expiresAtMs = new Date(session.expires_at).getTime();
      const image = await this.renderQr(this.buildUploadUrl(token));
      if (attempt !== this.attempt) {
        return;
      }
      this.qrImage.set(image);
    } catch (error) {
      if (attempt === this.attempt) {
        this.fail(this.readError(error, 'The QR code could not be created. Please try again.'));
      }
      return;
    }

    this.status.set('waiting');
    this.startCountdown(expiresAtMs, attempt);
    this.startPolling(token, attempt);
  }

  cancelScan(): void {
    this.stop();
    this.discardCurrentSession();
    this.attempt++;
    this.panelOpen.set(false);
  }

  private startCountdown(expiresAtMs: number, attempt: number): void {
    const update = () => {
      if (attempt !== this.attempt) {
        return;
      }
      const left = Math.round((expiresAtMs - Date.now()) / 1000);
      this.secondsLeft.set(Math.max(0, left));
      if (left <= 0 && this.status() === 'waiting') {
        this.stop();
        this.status.set('expired');
      }
    };
    update();
    this.countdownSubscription = timer(1000, 1000).subscribe(update);
  }

  private startPolling(token: string, attempt: number): void {
    let failures = 0;
    this.pollSubscription = timer(POLL_FIRST_DELAY_MS, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() =>
          this.http
            .get<UploadSessionInfo>(`${UPLOAD_SESSIONS_API}/${encodeURIComponent(token)}`, {
              headers: this.authService.getAdminApiHeaders(),
            })
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((info) => {
        if (attempt !== this.attempt) {
          return;
        }
        if (!info) {
          failures++;
          if (failures >= POLL_FAILURES_BEFORE_ERROR) {
            this.stop();
            this.fail('Lost connection to the server. Please check the connection and try again.');
          }
          return;
        }
        failures = 0;
        if (info.status === 'EXPIRED') {
          this.stop();
          this.status.set('expired');
        } else if (info.status === 'UPLOADED') {
          this.stop();
          void this.collectFile(token, info, attempt);
        }
      });
  }

  private async collectFile(token: string, info: UploadSessionInfo, attempt: number): Promise<void> {
    this.status.set('receiving');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${UPLOAD_SESSIONS_API}/${encodeURIComponent(token)}/file`, {
          headers: this.authService.getAdminApiHeaders(),
          responseType: 'blob',
        }),
      );
      if (attempt !== this.attempt) {
        return;
      }
      // The server deletes the session once the file is collected.
      this.currentToken = '';
      // The phone's file replaces whatever "Choose File" held: empty the input so it does not show the old name.
      if (this.fileInput) {
        this.fileInput.nativeElement.value = '';
      }
      this.source.set('phone');
      this.fileChange.emit(new File([blob], info.filename || 'upload', { type: info.mimetype || blob.type }));
      this.panelOpen.set(false);
    } catch (error) {
      if (attempt === this.attempt) {
        this.fail(this.readError(error, 'The uploaded file could not be received. Please scan a new QR code.'));
      }
    }
  }

  /** Fire and forget: a failure only leaves the session to expire by itself. */
  private discardCurrentSession(): void {
    if (!this.currentToken) {
      return;
    }
    const token = this.currentToken;
    this.currentToken = '';
    this.http
      .delete(`${UPLOAD_SESSIONS_API}/${encodeURIComponent(token)}`, { headers: this.authService.getAdminApiHeaders() })
      .subscribe({ error: () => undefined });
  }

  private fail(message: string): void {
    this.errorMessage.set(message);
    this.status.set('error');
  }

  private stop(): void {
    this.pollSubscription?.unsubscribe();
    this.countdownSubscription?.unsubscribe();
    this.pollSubscription = undefined;
    this.countdownSubscription = undefined;
  }

  /** The phone opens `<site base>upload-file?t=<token>`: the address this page was opened from, so every environment works. */
  private buildUploadUrl(token: string): string {
    return new URL(`${UPLOAD_PAGE_PATH}?t=${encodeURIComponent(token)}`, document.baseURI).toString();
  }

  private async renderQr(text: string): Promise<string> {
    const module = await import('qrcode');
    const toDataURL = module.toDataURL ?? (module as unknown as { default: typeof module }).default.toDataURL;
    return toDataURL(text, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
  }

  private readError(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' && message ? message : fallback;
  }
}
