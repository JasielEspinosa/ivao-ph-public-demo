import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { getAuthHeader } from '../../app';
import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';
import { PopupMessageComponent } from '../../shared/popup/popup-message';
import { NETWORK_UNAVAILABLE_MESSAGE, getServerStatusMessage } from '../../shared/submit-error-utils';
import { UploadRules, getUploadFileError } from '../../shared/upload-files';

const UPLOAD_SESSIONS_API = `${environment.apiUrl.replace(/\/$/, '')}/upload-sessions`;

type UploadPageState = 'loading' | 'ready' | 'uploading' | 'done' | 'expired' | 'error';

/**
 * Public page opened on the user's phone from the QR code shown next to an upload field of a data management page.
 * The chosen file is sent to the upload session, and the page that showed the QR code receives it automatically.
 * Nothing here needs a sign-in: the token in the address is the only credential, and it works once.
 */
@Component({
  selector: 'app-upload-file',
  standalone: true,
  imports: [PlaceholderBannerComponent, PopupMessageComponent],
  templateUrl: './upload-file.html',
  styleUrl: './upload-file.css',
})
export class UploadFilePageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(Title);

  readonly state = signal<UploadPageState>('loading');
  readonly fieldLabel = signal('File');
  readonly uploadAccept = signal('');
  readonly uploadHelperText = signal('');
  readonly fileName = signal('');
  /** The page could not be loaded, or the chosen file cannot be sent: shown on the page. */
  readonly errorMessage = signal('');
  /** Sending the file failed: shown in a popup. */
  readonly sendError = signal('');

  private token = '';
  private file: File | null = null;
  /** The rules of this upload (what the server told us), so a wrong file is caught before it is sent. */
  private rules: Pick<UploadRules, 'extensions' | 'maxBytes' | 'typeMessage' | 'sizeMessage'> | null = null;

  async ngOnInit(): Promise<void> {
    this.titleService.setTitle('IVAO Philippines - Upload File');
    this.token = (this.route.snapshot.queryParamMap.get('t') ?? '').trim();
    if (!this.token) {
      this.state.set('expired');
      return;
    }

    try {
      const info = await firstValueFrom(
        this.http.get<{
          status: string;
          label?: string;
          accept?: string;
          helper_text?: string;
          max_bytes?: number;
          type_error?: string;
          size_error?: string;
        }>(`${UPLOAD_SESSIONS_API}/${encodeURIComponent(this.token)}`, { headers: this.headers }),
      );
      if (info.status === 'WAITING') {
        this.fieldLabel.set(info.label || 'File');
        this.uploadAccept.set(info.accept ?? '');
        this.uploadHelperText.set(info.helper_text ?? '');
        this.rules = {
          extensions: (info.accept ?? '')
            .split(',')
            .map((extension) => extension.replace('.', '').trim().toLowerCase()),
          maxBytes: info.max_bytes ?? Number.MAX_SAFE_INTEGER,
          typeMessage: info.type_error ?? 'This file type is not accepted.',
          sizeMessage: info.size_error ?? 'This file is too large.',
        };
        this.state.set('ready');
      } else if (info.status === 'UPLOADED') {
        this.state.set('done');
      } else {
        this.state.set('expired');
      }
    } catch {
      this.errorMessage.set('The page could not be loaded. Please check your connection and scan the QR code again.');
      this.state.set('error');
    }
  }

  onFileChosen(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.fileName.set(this.file?.name ?? '');
    this.errorMessage.set(this.file ? this.fileError(this.file, '') : '');
  }

  async send(): Promise<void> {
    if (this.state() !== 'ready') {
      return;
    }

    const message = this.fileError(this.file, 'Please choose a file to upload.');
    if (message || !this.file) {
      this.errorMessage.set(message);
      return;
    }

    this.errorMessage.set('');
    this.sendError.set('');
    this.state.set('uploading');
    const formData = new FormData();
    formData.append('file', this.file);
    try {
      await firstValueFrom(
        this.http.post(`${UPLOAD_SESSIONS_API}/${encodeURIComponent(this.token)}/file`, formData, {
          headers: this.headers,
        }),
      );
      this.state.set('done');
    } catch (error) {
      const status = (error as { status?: number })?.status ?? 0;
      const serverMessage = (error as { error?: { message?: unknown } })?.error?.message;
      if (status === 404) {
        this.state.set('expired');
        return;
      }

      // The page stays usable (back to "ready") so the user can pick another file and try again.
      this.sendError.set(
        status === 0
          ? NETWORK_UNAVAILABLE_MESSAGE
          : (getServerStatusMessage(status) ??
              (typeof serverMessage === 'string' && serverMessage
                ? serverMessage
                : 'The file could not be uploaded. Please try again.')),
      );
      this.state.set('ready');
    }
  }

  /** The reason the file cannot be sent ('' when it can). Without rules the server decides. */
  private fileError(file: File | null, requiredMessage: string): string {
    return this.rules ? getUploadFileError(file, this.rules, requiredMessage) : file ? '' : requiredMessage;
  }

  private get headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: getAuthHeader() });
  }
}
