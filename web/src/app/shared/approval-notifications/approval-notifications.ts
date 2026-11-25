import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { AdminAuthService } from '../../services/admin-auth.service';
import { AuthImageDirective } from '../auth-image';
import { EventAirportListComponent } from '../event-airport-list/event-airport-list';
import { EVENT_FALLBACK_IMAGE } from '../event-cards/event-cards';
import { AirportDetail, formatEventAirports, formatEventWhen } from '../event-format';
import { PopupMessageComponent } from '../popup/popup-message';
import { buildSubmitErrorMessage } from '../submit-error-utils';
import { APPROVALS_API, EventApprovalService } from './event-approval.service';

/** How often the notifications are read again, so changed and removed events show without moving to another page. */
const REFRESH_MS = 60 * 1000;

type ApproverType = 'NONE' | 'REQUIRED' | 'OPTIONAL';

/**
 * One event the signed-in approver is asked to approve, or is told another approver has approved
 * (GET /api/event-approvals).
 */
interface ApprovalNotification {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  airport_mode: string;
  from_icao: string | null;
  to_icao: string | null;
  airport_icaos: string[];
  airport_details: AirportDetail[];
  description: string | null;
  has_image: boolean;
  updated_at: string;
  /** Which version of the details this is; sent back with the approval. */
  requested_at: string;
  /** Asked again because the title, the date and time or the airports changed. */
  is_reapproval: boolean;
  /** False when another approver approved it: the notification only says who, until it is dismissed. */
  needs_approval: boolean;
  /** Waiting for an approval: not on the Home page yet. */
  approval_pending: boolean;
  approval_waiting_for: string[];
  approval_approved_by: string[];
}

interface ApprovalNotifications {
  approver_type: ApproverType;
  items: ApprovalNotification[];
}

/**
 * The notification button of the site header, shown only to a signed-in user who is set as an event approver (Members or
 * Manage User page). Its window lists the events waiting for their approval, with all the details, and an Approve button
 * for each, then the events another approver approved, each with a Dismiss button. The window is a native modal `<dialog>`: it opens above the whole page although it lives inside the header.
 */
@Component({
  selector: 'app-approval-notifications',
  standalone: true,
  imports: [AuthImageDirective, EventAirportListComponent, PopupMessageComponent],
  templateUrl: './approval-notifications.html',
  styleUrls: ['./approval-notifications.css', './approval-notifications-window.css'],
  // Lets the header make room for the button only when there is one.
  host: { '[class.has-approvals-button]': "approverType() !== 'NONE'" },
})
export class ApprovalNotificationsComponent implements OnInit, OnDestroy {
  /** The window opens: the header closes its menus. */
  @Output() readonly opened = new EventEmitter<void>();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly approvals = inject(EventApprovalService);

  readonly fallbackImage = EVENT_FALLBACK_IMAGE;
  readonly formatWhen = formatEventWhen;
  readonly formatAirports = formatEventAirports;

  readonly approverType = signal<ApproverType>('NONE');
  readonly items = signal<ApprovalNotification[]>([]);
  readonly isOpen = signal(false);
  readonly approvingId = signal<number | null>(null);
  readonly dismissingId = signal<number | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  private signedInEmail = '';
  private refreshTimer?: ReturnType<typeof setInterval>;

  /** The window is shown as soon as it is on the page. */
  @ViewChild('dialog') set dialog(element: ElementRef<HTMLDialogElement> | undefined) {
    if (element && !element.nativeElement.open) {
      element.nativeElement.showModal();
    }
  }

  constructor() {
    // The pages that list events offer to approve the same events as this button.
    effect(() => {
      const asked = this.items().filter((item) => item.needs_approval);
      this.approvals.askedIds.set(new Set(asked.map((item) => item.id)));
    });

    // Signing in or out (also from another tab) shows or hides the button.
    effect(() => {
      const email = this.authService.getCurrentUser()?.login_email ?? '';
      untracked(() => {
        if (email !== this.signedInEmail) {
          this.signedInEmail = email;
          this.reset();
          this.load();
        }
      });
    });

    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.close();
        this.load();
      });
    this.approvals.eventsChanged$.pipe(takeUntilDestroyed()).subscribe(() => this.load());
    this.approvals.approved$.pipe(takeUntilDestroyed()).subscribe(() => this.load());
  }

  ngOnInit(): void {
    this.refreshTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        this.load();
      }
    }, REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  imageUrl(item: ApprovalNotification): string {
    return item.has_image ? `${APPROVALS_API}/${item.id}/image?v=${encodeURIComponent(item.updated_at)}` : '';
  }

  open(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.opened.emit();
    this.isOpen.set(true);
    this.load();
  }

  close(): void {
    this.isOpen.set(false);
  }

  /** A click outside the window lands on the dialog itself; its content covers the rest of it. */
  onDialogClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  async approve(item: ApprovalNotification): Promise<void> {
    if (this.approvingId() !== null || !(await this.approvals.confirmApproval(item.title))) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.approvingId.set(item.id);
    this.approvals
      .approve({
        id: item.id,
        title: item.title,
        requestedAt: item.requested_at,
        wasPending: item.approval_pending,
      })
      .subscribe({
        next: (message) => {
          this.approvingId.set(null);
          this.items.update((items) => items.filter((entry) => entry.id !== item.id));
          this.successMessage.set(message);
        },
        error: (error: HttpErrorResponse) => {
          this.approvingId.set(null);
          this.errorMessage.set(this.approvals.errorMessage(error));
          // The event was changed or removed: show it as it is now.
          this.load();
        },
      });
  }

  dismiss(item: ApprovalNotification): void {
    if (this.dismissingId() !== null) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.dismissingId.set(item.id);
    this.approvals.dismiss(item.id, item.requested_at).subscribe({
      next: () => {
        this.dismissingId.set(null);
        this.items.update((items) => items.filter((entry) => entry.id !== item.id));
      },
      error: (error: HttpErrorResponse) => {
        this.dismissingId.set(null);
        this.errorMessage.set(
          buildSubmitErrorMessage(error, { fallbackMessage: 'Unable to dismiss the notification.' }),
        );
        this.load();
      },
    });
  }

  private load(): void {
    const email = this.signedInEmail;
    if (!email) {
      return;
    }

    this.http.get<ApprovalNotifications>(APPROVALS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (response) => {
        // An answer that arrives after another user signed in is not theirs.
        if (email !== this.signedInEmail) {
          return;
        }
        this.approverType.set(response?.approver_type ?? 'NONE');
        this.items.set(response?.items ?? []);
      },
      error: (error: HttpErrorResponse) => {
        // A refresh in the background fails quietly; the open window says so.
        if (this.isOpen() && !this.errorMessage()) {
          this.errorMessage.set(
            buildSubmitErrorMessage(error, { fallbackMessage: 'Unable to load the notifications.' }),
          );
        }
      },
    });
  }

  private reset(): void {
    this.approverType.set('NONE');
    this.items.set([]);
    this.isOpen.set(false);
    this.approvingId.set(null);
    this.dismissingId.set(null);
  }
}
