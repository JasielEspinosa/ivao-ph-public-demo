import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, map, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AdminAuthService } from '../../services/admin-auth.service';
import { PopupService } from '../popup/popup.service';
import { buildSubmitErrorMessage } from '../submit-error-utils';

export const APPROVALS_API = `${environment.apiUrl.replace(/\/$/, '')}/event-approvals`;

/** An approval the user is about to give. */
export interface ApprovalRequest {
  id: number;
  title: string;
  /** Which version of the details the user sees; an event changed since is refused. */
  requestedAt: string;
  /** The event waits for an approval (it is not on the Home page yet). */
  wasPending: boolean;
}

/**
 * Event approvals, shared by the notification button of the header and the pages that list events (Events Creation and
 * the Home page): approving works the same from each, and they stay up to date with each other.
 */
@Injectable({ providedIn: 'root' })
export class EventApprovalService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly popups = inject(PopupService);

  /** The events the signed-in user is still asked to approve, as the notification button last read them. */
  readonly askedIds = signal<ReadonlySet<number>>(new Set<number>());
  /** Events were added, changed or removed on a page: the notifications may be out of date. */
  readonly eventsChanged$ = new Subject<void>();
  /** An approval was saved, so lists of events (the Home page's too) are out of date. */
  readonly approved$ = new Subject<void>();

  /** Asks the approver to confirm; true to go ahead. */
  confirmApproval(title: string): Promise<boolean> {
    return this.popups.ask({
      title: 'Approve Event',
      message: `Approve the event "${title}"?`,
      confirmLabel: 'Approve',
      success: true,
    });
  }

  /** Saves an approval; answers with the sentence that tells the approver what happened. */
  approve(request: ApprovalRequest): Observable<string> {
    return this.http
      .post<void>(
        `${APPROVALS_API}/${request.id}/approve`,
        { requested_at: request.requestedAt },
        { headers: this.authService.getAdminApiHeaders() },
      )
      .pipe(
        tap(() => this.recordApproval(request.id)),
        map(() => this.approvedMessage(request)),
      );
  }

  /**
   * "Edit Events Before Approving": saves the changed details (the same fields as an update of the event) together with
   * the approval. `updatedAt` is that of the event the approver started from; one changed since is refused.
   */
  approveWithChanges(request: ApprovalRequest, updatedAt: string, details: FormData): Observable<string> {
    details.set('requested_at', request.requestedAt);
    details.set('updated_at', updatedAt);
    return this.http
      .post<{ changed: boolean }>(`${APPROVALS_API}/${request.id}/approve-with-changes`, details, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .pipe(
        tap(() => this.recordApproval(request.id)),
        map(({ changed }) => `${changed ? 'Your changes are saved. ' : ''}${this.approvedMessage(request)}`),
      );
  }

  /** Removes the notification that another approver approved the event (the version of `requestedAt`). */
  dismiss(eventId: number, requestedAt: string): Observable<void> {
    return this.http.post<void>(
      `${APPROVALS_API}/${eventId}/dismiss`,
      { requested_at: requestedAt },
      { headers: this.authService.getAdminApiHeaders() },
    );
  }

  private recordApproval(eventId: number): void {
    // No page offers to approve it again while the notifications are being read anew.
    this.askedIds.update((ids) => new Set([...ids].filter((id) => id !== eventId)));
    this.approved$.next();
  }

  private approvedMessage({ title, wasPending }: ApprovalRequest): string {
    return wasPending
      ? `"${title}" is approved and now shows on the Home page.`
      : `Your approval of "${title}" is saved.`;
  }

  /** What to say when an approval is refused or cannot be sent. */
  errorMessage(error: HttpErrorResponse): string {
    return buildSubmitErrorMessage(error, {
      fallbackMessage: 'Unable to approve the event.',
      notFoundMessage: 'This event no longer exists.',
    });
  }
}
