import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { EventApprovalService } from '../../../shared/approval-notifications/event-approval.service';
import { AuthImageDirective } from '../../../shared/auth-image';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { EventAirportListComponent } from '../../../shared/event-airport-list/event-airport-list';
import { EVENT_FALLBACK_IMAGE } from '../../../shared/event-cards/event-cards';
import {
  AirportDetail,
  EventAirportMode,
  EventZone,
  formatEventAirports,
  formatEventWhen,
  formatInOtherZone,
  formatPhtMoment,
  fromZoneParts,
  toZoneParts,
  usesFromAirport,
  usesToAirport,
} from '../../../shared/event-format';
import { injectCurrentPage } from '../../../shared/page-titles';
import { PHILIPPINE_AIRPORTS } from '../../../shared/philippine-airports';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';
import { PopupService } from '../../../shared/popup/popup.service';
import { QrUploadComponent } from '../../../shared/qr-upload/qr-upload';
import { buildSubmitErrorMessage } from '../../../shared/submit-error-utils';
import {
  EVENT_IMAGE_RULES,
  formatFileSize,
  getAcceptAttribute,
  getEventImageSizeError,
  getUploadFileError,
  readImageSize,
} from '../../../shared/upload-files';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';

const EVENTS_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/events`;
const ICAO_PATTERN = /^[A-Za-z]{4}$/;
const MAX_AIRPORTS = 20;
/** The past list shows this many events, and this many more each time "Show more" is pressed. */
const PAST_PAGE_SIZE = 12;
/** "Send now" can post the same event again only after this long (the server enforces it too). */
const SEND_NOW_COOLDOWN_MS = 30_000;
const MAX_DISCORD_OFFSETS = 10;
const MAX_DISCORD_OFFSET_MINUTES = 14 * 24 * 60;
/** The ready-made reminder times of the Discord settings, in minutes before the start. */
const DISCORD_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 1440, label: '1 day before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 0, label: 'At the start' },
];

interface EventRow {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  airport_mode: EventAirportMode;
  from_icao: string | null;
  to_icao: string | null;
  airport_icaos: string[];
  airport_details: AirportDetail[];
  description: string | null;
  has_image: boolean;
  image_name: string | null;
  image_size: number | null;
  /** False once the event is archived: it is no longer shown on the Home page. */
  is_active: boolean;
  created_at: string;
  /** Who added the event; null for an event from before this was recorded. */
  created_by: string | null;
  /** When the details were last changed. */
  updated_at: string;
  /** Who last changed the details; null while nobody has. */
  updated_by: string | null;
  discord_notify_enabled: boolean;
  /** Minutes before the start at which a reminder is posted to Discord (0 = at the start). */
  discord_notify_offsets_minutes: number[];
  /** When "Send now" last posted this event (the 30-second cooldown counts from it). */
  discord_last_manual_sent_at: string | null;
  /** When Discord last accepted a message of this event (a reminder or "Send now"); null = none was posted yet. */
  discord_last_sent_at: string | null;
  /** Extra text posted above the event card in every Discord message of this event. */
  discord_message: string | null;
  /** The Facebook Page is a second channel for the same reminders (the times are the Discord ones). */
  facebook_notify_enabled: boolean;
  /** Facebook post type: true = public (published at once), false = draft (the default). */
  facebook_post_public: boolean;
  /** When Facebook last accepted a post of this event (a reminder or "Send now"); null = none was posted yet. */
  facebook_last_sent_at: string | null;
  /** Whether Manage Integrations has a working Discord webhook / Facebook Page (an admin sets them there). */
  discord_status: IntegrationStatus;
  facebook_status: IntegrationStatus;
  /** Waiting for an approval: not on the Home page and not posted yet. */
  approval_pending: boolean;
  /** Names of the approvers of a pending event: any one of them can approve it. */
  approval_waiting_for: string[];
  /** Names of the approvers who approved the current details. */
  approval_approved_by: string[];
  /** A change of title, date and time or airports by the signed-in user needs approval again. */
  approval_required: boolean;
  /** Which version of these details approval was asked for; sent with an approval. */
  approval_requested_at: string | null;
}

type IntegrationStatus = 'ok' | 'missing' | 'incorrect';

/** What each channel answered to "Send now"; a channel that was not used is missing. */
interface SendNowResponse {
  channels?: { discord?: 'sent' | 'rate_limited' | 'failed'; facebook?: 'sent' | 'rate_limited' | 'failed' };
}

/** What the creator can change in an event, except the description (see `changedDetails`). */
interface EventDetails {
  title: string;
  startAt: string;
  endAt: string;
  mode: EventAirportMode;
  from: string;
  to: string;
  airports: string;
}

/**
 * Data management page for the events shown on the Home page (Events Today, Upcoming Events, Past Events). It lists the
 * events live now, later today and upcoming (soonest start first) and the past events (most recently ended first), each with its
 * picture. A new or edited event is typed in GMT or Philippine Time (the creator's choice) and saved as an exact moment.
 * A past event can also be archived (hidden from the website) or cloned into a new event. Like Documents and Charts it
 * has no template import/export: a picture cannot travel in a CSV.
 *
 * An event approver without the Events access sees the same lists but can only approve; with "Edit Events Before
 * Approving" they can also change an event in its window, saved only together with their approval.
 */
@Component({
  selector: 'app-events-manage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AuthImageDirective,
    EventAirportListComponent,
    PlaceholderBannerDataManagementComponent,
    PopupMessageComponent,
    QrUploadComponent,
  ],
  templateUrl: './events-manage.html',
  styleUrl: './events-manage.css',
})
export class EventsManageComponent implements OnInit, OnDestroy {
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly approvals = inject(EventApprovalService);
  private readonly popups = inject(PopupService);

  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly fallbackImage = EVENT_FALLBACK_IMAGE;
  readonly imageAccept = getAcceptAttribute(EVENT_IMAGE_RULES);
  readonly imageHelperText = EVENT_IMAGE_RULES.helperText;
  readonly formatFileSize = formatFileSize;
  readonly formatWhen = formatEventWhen;
  readonly formatMoment = formatPhtMoment;
  readonly formatAirports = formatEventAirports;
  readonly maxAirports = MAX_AIRPORTS;
  readonly invalidIcaoMessage = 'Enter the 4-letter ICAO code of the airport, for example RPLL.';
  readonly fromToMessage = 'Enter the From airport, the To airport, or both.';
  readonly fromAnyMessage = 'Enter the From airport.';
  readonly anyToMessage = 'Enter the To airport.';
  readonly noAirportMessage = 'Add at least one airport.';
  readonly endBeforeStartMessage = 'The end date and time must be after the start date and time.';

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    // Which clock the four date and time fields below are typed on.
    time_zone: ['PHT' as EventZone],
    start_date: ['', [Validators.required]],
    start_time: ['', [Validators.required]],
    end_date: ['', [Validators.required]],
    end_time: ['', [Validators.required]],
    airport_mode: ['FROM_TO' as EventAirportMode],
    from_icao: ['', [Validators.pattern(ICAO_PATTERN)]],
    to_icao: ['', [Validators.pattern(ICAO_PATTERN)]],
    // The box that adds an airport to the list of "Multiple airports"; it is not saved itself.
    airport_entry: [{ value: '', disabled: true }, [Validators.pattern(ICAO_PATTERN)]],
    description: ['', [Validators.maxLength(5000)]],
  });

  events: EventRow[] = [];
  /** The airports of "Multiple airports", in the order they were added. */
  airportList: string[] = [];
  editingId: number | null = null;
  /** The event a new event is cloned from (null when adding from scratch or editing). */
  cloneSource: EventRow | null = null;
  /** The picture chosen on this device or received from the phone; null keeps the saved one (or the clone's). */
  selectedFile: File | null = null;
  selectedPreviewUrl = '';
  /** The saved picture is dropped when saving. */
  removeImage = false;
  imageError = '';
  isCheckingImage = false;
  /** A save was tried: the errors that need the whole form (airports, time range) show from now on. */
  attemptedSave = false;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  /** The events could not be loaded, so there is no list to show. */
  loadFailed = false;
  showArchived = false;
  /** The event an approval is being saved for (null = none). */
  approvingId: number | null = null;
  /**
   * "Edit & Approve": set while the window is open for an approver who changes an event as they approve it, to the
   * version of the event they started from.
   */
  review: { requestedAt: string; updatedAt: string; wasPending: boolean } | null = null;
  pastLimit = PAST_PAGE_SIZE;

  /** Discord settings window: the event it is open for (null = closed) and what is chosen in it. */
  readonly discordPresets = DISCORD_PRESETS;
  discordEvent: EventRow | null = null;
  discordEnabled = false;
  facebookEnabled = false;
  /** Facebook post type: false = Draft (the default), true = Public. */
  facebookPublic = false;
  discordOffsets: number[] = [];
  discordCustomMinutes = '';
  discordMessage = '';
  discordError = '';
  discordSuccess = '';
  isDiscordSaving = false;
  isDiscordSending = false;
  /** When "Send now" last posted each event (ms), by event id: the buttons count their cooldown from it. */
  private readonly sentAtByEventId = new Map<number, number>();
  private cooldownTimer?: ReturnType<typeof setInterval>;

  /**
   * The event being edited is live or past: only its title, start time, end time and image can be changed (the server
   * enforces it too).
   */
  detailsLocked = false;

  /** The details of the event as it was when the edit started, to see whether the creator changed any. */
  private originalDetails: EventDetails | null = null;
  private originalDescription = '';
  private zone: EventZone = 'PHT';

  constructor() {
    // An approval, given here or in the header's notifications, changes where an event stands.
    this.approvals.approved$.pipe(takeUntilDestroyed()).subscribe(() => this.loadEvents());
    this.form.controls.time_zone.valueChanges.subscribe((zone) => this.switchZone(zone));
    this.form.controls.airport_mode.valueChanges.subscribe((mode) => this.setAirportControls(mode));
    this.setAirportControls('FROM_TO');
  }

  ngOnInit(): void {
    this.loadEvents();
  }

  ngOnDestroy(): void {
    this.releasePreview();
    this.stopCooldownTimer();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  /** The user may add, change, archive and remove events and set their notifications. */
  get canManage(): boolean {
    return this.authService.canAccessDataManagementCode('EVENTS');
  }

  /** An approver without that access who may change an event while approving it. */
  get canEditOnApproval(): boolean {
    return !this.canManage && this.authService.canEditEventsOnApproval();
  }

  get isReview(): boolean {
    return this.review !== null;
  }

  /** What the approver changed in the open window, as words; empty when they approve the event as it is. */
  get reviewChanges(): string[] {
    const changes = this.changedDetails();
    if (this.originalDetails && this.form.getRawValue().description.trim() !== this.originalDescription) {
      changes.push('description');
    }
    return changes;
  }

  get submitLabel(): string {
    if (this.isReview) {
      if (this.isSaving) {
        return 'Approving...';
      }
      return this.reviewChanges.length > 0 ? 'Save Changes & Approve' : 'Approve';
    }
    if (this.isSaving) {
      return 'Saving...';
    }
    return this.isEditMode ? 'Update' : 'Add';
  }

  get editingEvent(): EventRow | undefined {
    return this.events.find((item) => item.id === this.editingId);
  }

  get isEditingPastEvent(): boolean {
    const editing = this.editingEvent;
    return !!editing && this.isPast(editing);
  }

  get isEditingArchivedEvent(): boolean {
    return this.editingEvent?.is_active === false;
  }

  get airportMode(): EventAirportMode {
    return this.form.controls.airport_mode.value;
  }

  get zoneLabel(): EventZone {
    return this.form.controls.time_zone.value;
  }

  /** Live now: started and not yet ended. The soonest start first. */
  get liveEvents(): EventRow[] {
    return this.sortedByStart(this.events.filter((item) => this.isLive(item)));
  }

  /** Not started yet, but starting today (Philippine date, like the Home page). The soonest start first. */
  get laterTodayEvents(): EventRow[] {
    const today = this.manilaDate(Date.now());
    return this.sortedByStart(
      this.events.filter((item) => this.isNotStarted(item) && this.manilaDate(this.time(item.start_at)) <= today),
    );
  }

  /** Starting after today (Philippine date). The soonest start first. */
  get upcomingEvents(): EventRow[] {
    const today = this.manilaDate(Date.now());
    return this.sortedByStart(
      this.events.filter((item) => this.isNotStarted(item) && this.manilaDate(this.time(item.start_at)) > today),
    );
  }

  private sortedByStart(items: EventRow[]): EventRow[] {
    return items.sort((left, right) => this.time(left.start_at) - this.time(right.start_at) || left.id - right.id);
  }

  /** The Philippine calendar date (YYYY-MM-DD) of a moment. */
  private manilaDate(ms: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(ms);
  }

  /** Past events: the most recently ended first. Archived ones only when asked for. */
  get pastEvents(): EventRow[] {
    return this.events
      .filter((item) => this.isPast(item) && (this.showArchived || item.is_active))
      .sort((left, right) => this.time(right.end_at) - this.time(left.end_at) || right.id - left.id);
  }

  get archivedCount(): number {
    return this.events.filter((item) => this.isPast(item) && !item.is_active).length;
  }

  /** The event that supplies the saved picture: the one being edited, or the one being cloned. */
  get imageSource(): EventRow | null {
    const source = this.editingEvent ?? this.cloneSource;
    return source?.has_image ? source : null;
  }

  get showSavedImage(): boolean {
    return !!this.imageSource && !this.removeImage && !this.selectedFile;
  }

  get startHint(): string {
    const { start_date, start_time } = this.form.getRawValue();
    return formatInOtherZone(start_date, start_time, this.zone);
  }

  get endHint(): string {
    const { end_date, end_time } = this.form.getRawValue();
    return formatInOtherZone(end_date, end_time, this.zone);
  }

  /**
   * Why the end cannot be what was typed ('' when fine or while a field is empty). Past dates are allowed: an event that
   * has already ended is listed under Past Events.
   */
  get rangeError(): string {
    const start = this.moment('start');
    const end = this.moment('end');
    if (!start || !end) {
      return '';
    }

    return end.getTime() <= start.getTime() ? this.endBeforeStartMessage : '';
  }

  /** From / To: at least one is needed. */
  get fromToError(): boolean {
    const { from_icao, to_icao } = this.form.controls;
    return this.airportMode === 'FROM_TO' && !from_icao.value.trim() && !to_icao.value.trim();
  }

  /** From airport only ("from the fixed airport to any airport"): the From airport is needed. */
  get fromAnyError(): boolean {
    return this.airportMode === 'FROM_ANY' && !this.form.controls.from_icao.value.trim();
  }

  /** To airport only ("from any airport to the fixed airport"): the To airport is needed. */
  get anyToError(): boolean {
    return this.airportMode === 'ANY_TO' && !this.form.controls.to_icao.value.trim();
  }

  get airportListError(): boolean {
    return this.airportMode === 'MULTIPLE' && this.airportList.length === 0 && !this.pendingAirport;
  }

  /** The airport typed in the "Multiple airports" box and not added yet, when it is a valid code. */
  get pendingAirport(): string {
    const { airport_entry } = this.form.controls;
    return airport_entry.valid ? airport_entry.value.trim().toUpperCase() : '';
  }

  /** Sets the End Date to the Start Date (for an event that starts and ends on the same day). */
  setEndDateToStartDate(): void {
    const { start_date, end_date } = this.form.controls;
    if (!start_date.value || this.detailsLocked) {
      return;
    }

    end_date.setValue(start_date.value);
    end_date.markAsDirty();
  }

  isPast(item: EventRow): boolean {
    return this.time(item.end_at) < Date.now();
  }

  isLive(item: EventRow): boolean {
    return this.time(item.start_at) <= Date.now() && !this.isPast(item);
  }

  private isNotStarted(item: EventRow): boolean {
    return this.time(item.start_at) > Date.now();
  }

  imageUrl(item: EventRow): string {
    return item.has_image ? `${EVENTS_API}/${item.id}/image?v=${encodeURIComponent(item.updated_at)}` : '';
  }

  loadEvents(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.loadFailed = false;
    this.http.get<EventRow[]>(EVENTS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.events = Array.isArray(rows) ? rows : [];
        // After a page refresh the cooldown carries on from the time the server saw.
        for (const row of this.events) {
          if (row.discord_last_manual_sent_at) {
            this.sentAtByEventId.set(row.id, this.time(row.discord_last_manual_sent_at));
          }
        }
        this.startCooldownTimerIfNeeded();
        this.isLoading = false;
        // The list is read again after every change, so the notifications of the header are read again with it.
        this.approvals.eventsChanged$.next();
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.loadFailed = true;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('events'));
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  openAddModal(): void {
    this.resetForm();
    this.errorMessage = '';
    this.successMessage = '';
    this.isModalOpen = true;
  }

  edit(item: EventRow): void {
    this.resetForm();
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';
    this.fillForm(item, true);
    this.originalDetails = this.currentDetails();
    this.originalDescription = this.form.getRawValue().description.trim();
    if (this.time(item.start_at) <= Date.now()) {
      this.lockStartedEvent();
    }
    this.isModalOpen = true;
  }

  /** The edit window for an approver: nothing is saved unless they approve from it. */
  editAndApprove(item: EventRow): void {
    const requestedAt = item.approval_requested_at;
    if (!requestedAt) {
      return;
    }

    this.edit(item);
    this.review = { requestedAt, updatedAt: item.updated_at, wasPending: item.approval_pending };
  }

  /** A new event that starts as a copy of a past event (its picture too): only the dates are left to choose. */
  clone(item: EventRow): void {
    this.resetForm();
    this.cloneSource = item;
    this.errorMessage = '';
    this.successMessage = '';
    this.fillForm(item, false);
    this.isModalOpen = true;
  }

  closeModal(): void {
    if (this.isSaving) {
      return;
    }

    this.isModalOpen = false;
    this.resetForm();
    this.errorMessage = '';
  }

  onFileChange(file: File | null): void {
    this.releasePreview();
    this.selectedFile = file;
    this.removeImage = false;
    this.imageError = file ? getUploadFileError(file, EVENT_IMAGE_RULES, '') : '';
    this.isCheckingImage = false;

    if (file && !this.imageError) {
      this.selectedPreviewUrl = URL.createObjectURL(file);
      // The ratio and size in pixels are known only once the browser has read the picture.
      this.isCheckingImage = true;
      void readImageSize(file).then((size) => {
        if (this.selectedFile === file) {
          this.imageError = getEventImageSizeError(size);
          this.isCheckingImage = false;
          this.changeDetectorRef.detectChanges();
        }
      });
    }
    this.changeDetectorRef.detectChanges();
  }

  setRemoveImage(remove: boolean): void {
    this.removeImage = remove;
  }

  /** An ICAO code is four letters in capitals: anything else typed or pasted is dropped. */
  onIcaoInput(input: HTMLInputElement, controlName: 'from_icao' | 'to_icao' | 'airport_entry'): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.form.controls[controlName].setValue(icao);
  }

  /** Adds the airport typed in the box to the list (also on Enter, without submitting the form). */
  addAirport(event?: Event): void {
    event?.preventDefault();
    const icao = this.pendingAirport;
    const { airport_entry } = this.form.controls;
    if (!icao) {
      airport_entry.markAsTouched();
      return;
    }

    if (this.airportList.length >= MAX_AIRPORTS) {
      return;
    }
    if (!this.airportList.includes(icao)) {
      this.airportList = [...this.airportList, icao];
    }
    airport_entry.reset('');
  }

  removeAirport(icao: string): void {
    this.airportList = this.airportList.filter((item) => item !== icao);
  }

  showInvalid(
    controlName:
      | 'title'
      | 'start_date'
      | 'start_time'
      | 'end_date'
      | 'end_time'
      | 'from_icao'
      | 'to_icao'
      | 'airport_entry'
      | 'description',
  ): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.touched || control.dirty);
  }

  async save(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.attemptedSave = true;
    this.addAirport();
    this.form.markAllAsTouched();

    const start = this.moment('start');
    const end = this.moment('end');
    if (
      this.form.invalid ||
      !start ||
      !end ||
      this.rangeError ||
      this.fromToError ||
      this.fromAnyError ||
      this.anyToError ||
      this.airportListError ||
      this.imageError ||
      this.isCheckingImage
    ) {
      return;
    }

    if (this.review) {
      await this.approveReviewed(start, end);
      return;
    }

    const isEditing = this.editingId !== null;
    // A completed event is a record of what happened: ask before its details change (the description may change freely).
    const changes = isEditing && this.isEditingPastEvent ? this.changedDetails() : [];
    if (changes.length > 0) {
      const title = this.editingEvent?.title ?? '';
      const message = `"${title}" has already been completed, and you changed its ${changes.join(', ')}. Save the changes anyway?`;
      if (!(await this.popups.ask({ title: 'Save Changes', message, confirmLabel: 'Save' }))) {
        return;
      }
    }

    const body = this.buildBody(start, end);
    const headers = this.authService.getAdminApiHeaders();
    const request = isEditing
      ? this.http.put<EventRow>(`${EVENTS_API}/${this.editingId}`, body, { headers })
      : this.http.post<EventRow>(EVENTS_API, body, { headers });

    // Said after saving only when this save is what put the event (back) in the approval queue.
    const wasPending = isEditing && !!this.editingEvent?.approval_pending;

    this.isSaving = true;
    this.changeDetectorRef.detectChanges();
    request.subscribe({
      next: (saved) => {
        this.isSaving = false;
        const done = isEditing ? DATA_MANAGE_MESSAGES.updated('Event') : DATA_MANAGE_MESSAGES.added('Event');
        this.successMessage =
          saved.approval_pending && !wasPending
            ? `${done} It is waiting for approval and shows on the Home page once approved.`
            : done;
        this.isModalOpen = false;
        this.resetForm();
        this.loadEvents();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(
          error,
          isEditing ? 'Unable to update event.' : 'Unable to add event.',
        );
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  /**
   * Approves the event of the open window with the approver's changes, after asking them. Closing the window instead
   * leaves the event as it was.
   */
  private async approveReviewed(start: Date, end: Date): Promise<void> {
    const review = this.review;
    const id = this.editingId;
    if (!review || id === null || this.isSaving) {
      return;
    }

    const title = this.form.controls.title.value.trim();
    const body = this.buildBody(start, end);
    const message = this.reviewQuestion(title);
    if (!(await this.popups.ask({ title: 'Approve Event', message, confirmLabel: 'Approve', success: true }))) {
      return;
    }

    this.isSaving = true;
    this.changeDetectorRef.detectChanges();
    const request = { id, title, requestedAt: review.requestedAt, wasPending: review.wasPending };
    this.approvals.approveWithChanges(request, review.updatedAt, body).subscribe({
      next: (done) => {
        this.isSaving = false;
        this.isModalOpen = false;
        this.resetForm();
        this.successMessage = done;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        // Changed, removed or already approved: the window shows an old version, so it closes and the list is re-read.
        if (error.status === 404 || error.status === 409) {
          this.isModalOpen = false;
          this.resetForm();
          this.loadEvents();
        }
        this.errorMessage = this.approvals.errorMessage(error);
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  private reviewQuestion(title: string): string {
    const changes = this.reviewChanges;
    if (changes.length === 0) {
      return `Approve the event "${title}"?`;
    }

    const completed = this.isEditingPastEvent ? ' This event has already been completed.' : '';
    return `You changed its ${changes.join(', ')}. Save the changes and approve the event "${title}"?${completed}`;
  }

  /** multipart/form-data: the text fields of the window and, when one was chosen, the picture. */
  private buildBody(start: Date, end: Date): FormData {
    const value = this.form.getRawValue();
    const mode = value.airport_mode;
    const body = new FormData();
    body.append('title', value.title.trim());
    body.append('start_at', start.toISOString());
    body.append('end_at', end.toISOString());
    body.append('airport_mode', mode);
    // Always sent: an empty text clears what the chosen mode does not use.
    body.append('from_icao', usesFromAirport(mode) ? value.from_icao.trim().toUpperCase() : '');
    body.append('to_icao', usesToAirport(mode) ? value.to_icao.trim().toUpperCase() : '');
    body.append('airport_icaos', mode === 'MULTIPLE' ? this.airportList.join(',') : '');
    body.append('description', value.description.trim());
    if (this.selectedFile) {
      body.append('image', this.selectedFile, this.selectedFile.name);
    } else if (this.removeImage) {
      body.append('remove_image', 'true');
    } else if (this.cloneSource && this.editingId === null) {
      body.append('clone_from_id', String(this.cloneSource.id));
    }
    return body;
  }

  async deleteEvent(): Promise<void> {
    if (this.editingId === null) {
      return;
    }

    const shouldDelete = await this.popups.ask({
      title: 'Remove Event',
      message: DATA_MANAGE_MESSAGES.confirmDelete(this.editingEvent?.title ?? ''),
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!shouldDelete) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.changeDetectorRef.detectChanges();
    this.http.delete(`${EVENTS_API}/${this.editingId}`, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = DATA_MANAGE_MESSAGES.deleted('Event');
        this.isModalOpen = false;
        this.resetForm();
        this.loadEvents();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(error, 'Unable to delete event.');
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  /** Archive hides a past event from the Home page; unarchive shows it again. */
  async setArchived(item: EventRow, archived: boolean): Promise<void> {
    if (
      archived &&
      !(await this.popups.ask({
        title: 'Archive Event',
        message: `Archive "${item.title}"? It will no longer be shown on the Home page.`,
        confirmLabel: 'Archive',
      }))
    ) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isLoading = true;
    this.changeDetectorRef.detectChanges();
    this.http
      .post(
        `${EVENTS_API}/${item.id}/${archived ? 'archive' : 'unarchive'}`,
        {},
        { headers: this.authService.getAdminApiHeaders() },
      )
      .subscribe({
        next: () => {
          this.successMessage = archived ? 'Event archived successfully.' : 'Event unarchived successfully.';
          this.loadEvents();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading = false;
          this.errorMessage = this.buildErrorMessage(
            error,
            archived ? 'Unable to archive event.' : 'Unable to unarchive event.',
          );
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  /** The signed-in user is an approver who is still asked to approve this event. */
  canApprove(item: EventRow): boolean {
    return !!item.approval_requested_at && this.approvals.askedIds().has(item.id);
  }

  /** Approves the event as it is listed here; one changed since the list was read is refused and listed anew. */
  async approve(item: EventRow): Promise<void> {
    // Read before asking: the approval is for the version listed when the button was pressed.
    const requestedAt = item.approval_requested_at;
    if (this.approvingId !== null || !requestedAt || !(await this.approvals.confirmApproval(item.title))) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.approvingId = item.id;
    this.changeDetectorRef.detectChanges();
    this.approvals
      .approve({
        id: item.id,
        title: item.title,
        requestedAt,
        wasPending: item.approval_pending,
      })
      .subscribe({
        next: (message) => {
          this.approvingId = null;
          this.successMessage = message;
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.approvingId = null;
          // Read the list again first: that clears the old message, and this one has to stay.
          this.loadEvents();
          this.errorMessage = this.approvals.errorMessage(error);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  showMorePast(): void {
    this.pastLimit += PAST_PAGE_SIZE;
  }

  // ---------------------------------------------------------------------------
  // Discord notifications (settings window of an upcoming event)
  // ---------------------------------------------------------------------------

  /** The event of the open window has already started: reminders no longer apply, so their settings are hidden. */
  get discordEventStarted(): boolean {
    const event = this.discordEvent;
    return !!event && this.time(event.start_at) <= Date.now();
  }

  /** The reminder times apply once at least one channel (Discord, or the Facebook Page) is ticked. */
  get remindersEnabled(): boolean {
    return (this.discordReady && this.discordEnabled) || (this.facebookReady && this.facebookEnabled);
  }

  /** Facebook is ticked with the Draft post type: its reminders would only pile up as drafts nobody sees. */
  get facebookDraftReminders(): boolean {
    return this.facebookReady && this.facebookEnabled && !this.facebookPublic;
  }

  /** The channel is set up on Manage Integrations; a channel that is not cannot be ticked. */
  get discordReady(): boolean {
    return this.discordEvent?.discord_status === 'ok';
  }

  get facebookReady(): boolean {
    return this.discordEvent?.facebook_status === 'ok';
  }

  /** What is wrong with the channels set up on Manage Integrations (empty = all fine). */
  get integrationProblems(): string[] {
    const event = this.discordEvent;
    if (!event) {
      return [];
    }
    return [
      this.integrationProblem('Discord', 'webhook URL', event.discord_status),
      this.integrationProblem('Facebook', 'Page ID and Page access token', event.facebook_status),
    ].filter(Boolean);
  }

  private integrationProblem(channel: string, what: string, status: IntegrationStatus): string {
    if (status === 'missing') {
      return `${channel} is not set up: the ${what} is missing.`;
    }
    return status === 'incorrect' ? `${channel} is set up incorrectly: check the ${what}.` : '';
  }

  /** Custom times: the chosen ones that are not one of the ready-made choices. */
  get discordCustomOffsets(): number[] {
    const presets = new Set(DISCORD_PRESETS.map((preset) => preset.minutes));
    return this.discordOffsets.filter((minutes) => !presets.has(minutes));
  }

  /** The moments the reminders will be posted at, furthest first, as words in Philippine Time. */
  get discordSchedulePreview(): { text: string; passed: boolean }[] {
    const event = this.discordEvent;
    if (!event) {
      return [];
    }

    const start = this.time(event.start_at);
    return [...this.discordOffsets]
      .sort((left, right) => right - left)
      .map((minutes) => {
        const at = new Date(start - minutes * 60_000);
        const text = at.toLocaleString('en-PH', {
          timeZone: 'Asia/Manila',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        return { text: `${text} PHT (${this.offsetLabel(minutes)})`, passed: at.getTime() <= Date.now() };
      });
  }

  openDiscord(item: EventRow): void {
    this.discordEvent = item;
    // A channel that is not set up on Manage Integrations cannot be ticked, so it shows (and is saved) as off.
    this.discordEnabled = item.discord_notify_enabled && item.discord_status === 'ok';
    this.facebookEnabled = item.facebook_notify_enabled && item.facebook_status === 'ok';
    this.facebookPublic = item.facebook_post_public;
    this.discordOffsets = [...item.discord_notify_offsets_minutes];
    this.discordCustomMinutes = '';
    this.discordMessage = item.discord_message ?? '';
    this.discordError = '';
    this.discordSuccess = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  closeDiscord(): void {
    if (this.isDiscordSaving) {
      return;
    }
    this.discordEvent = null;
  }

  isDiscordOffsetChosen(minutes: number): boolean {
    return this.discordOffsets.includes(minutes);
  }

  toggleDiscordOffset(minutes: number, chosen: boolean): void {
    this.discordOffsets = chosen
      ? [...new Set([...this.discordOffsets, minutes])]
      : this.discordOffsets.filter((value) => value !== minutes);
  }

  /** Adds the minutes typed in the custom box (also on Enter, without submitting anything). */
  addDiscordCustomOffset(event?: Event): void {
    event?.preventDefault();
    this.discordError = '';
    const minutes = Number(this.discordCustomMinutes);
    if (
      !this.discordCustomMinutes.trim() ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_DISCORD_OFFSET_MINUTES
    ) {
      this.discordError = `Enter a whole number of minutes from 1 to ${MAX_DISCORD_OFFSET_MINUTES} (14 days).`;
      return;
    }
    if (this.discordOffsets.length >= MAX_DISCORD_OFFSETS && !this.discordOffsets.includes(minutes)) {
      this.discordError = `You can set up to ${MAX_DISCORD_OFFSETS} reminder times.`;
      return;
    }

    this.toggleDiscordOffset(minutes, true);
    this.discordCustomMinutes = '';
  }

  /** "90 minutes before", "2 hours before", "At the start"... */
  offsetLabel(minutes: number): string {
    if (minutes === 0) {
      return 'at the start';
    }
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    const parts = [
      days ? `${days} day${days === 1 ? '' : 's'}` : '',
      hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '',
      rest ? `${rest} minute${rest === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    return `${parts.join(' ')} before`;
  }

  saveDiscordSettings(): void {
    const event = this.discordEvent;
    if (!event || this.isDiscordSaving) {
      return;
    }

    this.discordError = '';
    this.discordSuccess = '';
    // For a running event the reminder settings are hidden, so they are not checked (they are saved as they were).
    if (!this.discordEventStarted && this.remindersEnabled && this.discordOffsets.length === 0) {
      this.discordError = 'Choose at least one time to send a reminder, or turn the notifications off.';
      return;
    }

    this.isDiscordSaving = true;
    this.putDiscordSettings(event).subscribe({
      next: () => {
        this.isDiscordSaving = false;
        this.discordSuccess = 'Notification settings saved.';
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isDiscordSaving = false;
        this.discordError = this.discordErrorMessage(error, 'Unable to save the Discord settings.');
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  /** Seconds left before "Send now" works again for the event (0 = ready). */
  sendNowSecondsLeft(eventId: number): number {
    const sentAt = this.sentAtByEventId.get(eventId);
    return sentAt ? Math.max(0, Math.ceil((sentAt + SEND_NOW_COOLDOWN_MS - Date.now()) / 1000)) : 0;
  }

  sendNowLabel(eventId: number): string {
    if (this.isDiscordSending) {
      return 'Sending...';
    }
    const seconds = this.sendNowSecondsLeft(eventId);
    return seconds > 0 ? `Send now (${seconds}s)` : 'Send now';
  }

  /** Saves the settings shown in the window and, once they are saved, updates the list and the open window. */
  private putDiscordSettings(event: EventRow): Observable<EventRow> {
    return this.http
      .put<EventRow>(
        `${EVENTS_API}/${event.id}/discord-notifications`,
        {
          enabled: this.discordEnabled,
          offsets_minutes: [...this.discordOffsets].sort((a, b) => b - a),
          message: this.discordMessage.trim(),
          // Only sent when the server has a Facebook Page, so a server without one never receives (or changes) it.
          ...(event.facebook_status === 'ok'
            ? { facebook_enabled: this.facebookEnabled, facebook_public: this.facebookPublic }
            : {}),
        },
        { headers: this.authService.getAdminApiHeaders() },
      )
      .pipe(
        tap((row) => {
          this.events = this.events.map((item) => (item.id === row.id ? row : item));
          this.discordEvent = row;
        }),
      );
  }

  /**
   * Posts the event to Discord right away with the Additional message as typed in the window. Nothing is saved here
   * (Save Settings does that); then the button waits 30 seconds for that event.
   */
  sendNow(): void {
    const event = this.discordEvent;
    if (!event || this.isDiscordSending || this.sendNowSecondsLeft(event.id) > 0) {
      return;
    }

    this.discordError = '';
    this.discordSuccess = '';
    this.isDiscordSending = true;
    this.http
      .post<SendNowResponse>(
        `${EVENTS_API}/${event.id}/discord-notifications/send-now`,
        {
          message: this.discordMessage.trim(),
          ...(event.facebook_status === 'ok'
            ? { facebook_enabled: this.facebookEnabled, facebook_public: this.facebookPublic }
            : {}),
        },
        { headers: this.authService.getAdminApiHeaders() },
      )
      .subscribe({
        next: (response) => {
          this.isDiscordSending = false;
          this.sentAtByEventId.set(event.id, Date.now());
          this.startCooldownTimerIfNeeded();

          // The "Sent" badge of the list shows at once, without reloading it.
          const channels = response?.channels ?? { discord: 'sent' as const };
          const sentAt = new Date().toISOString();
          this.events = this.events.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  ...(channels.discord === 'sent' ? { discord_last_sent_at: sentAt } : {}),
                  ...(channels.facebook === 'sent' ? { facebook_last_sent_at: sentAt } : {}),
                }
              : item,
          );

          // One channel can fail while the other works: say which one was posted and which was not.
          const sentTo = [
            channels.discord === 'sent' ? 'Discord' : '',
            channels.facebook === 'sent' ? 'Facebook' : '',
          ].filter(Boolean);
          const notSentTo = [
            channels.discord && channels.discord !== 'sent' ? 'Discord' : '',
            channels.facebook && channels.facebook !== 'sent' ? 'Facebook' : '',
          ].filter(Boolean);
          this.discordSuccess = `Sent to ${sentTo.join(' and ')}.`;
          if (notSentTo.length > 0) {
            this.discordError = `It could not be posted to ${notSentTo.join(' and ')}. The Manage Integrations settings may be incorrect: contact the administrator to check them, then try again.`;
          }
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isDiscordSending = false;
          // The server says how long is left when another click got there first (or this page's clock was off).
          const retryAfter = Number(error.error?.retry_after_seconds);
          if (error.status === 429 && retryAfter > 0) {
            this.sentAtByEventId.set(event.id, Date.now() + retryAfter * 1000 - SEND_NOW_COOLDOWN_MS);
            this.startCooldownTimerIfNeeded();
          }
          this.discordError = this.discordErrorMessage(error, 'Unable to send the event to Discord.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  /** The server's own words for the Discord errors (429 wait, 503 not set up), which the shared messages would hide. */
  private discordErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const backendMessage = error.error?.message;
    if ((error.status === 429 || error.status === 503) && typeof backendMessage === 'string' && backendMessage.trim()) {
      return backendMessage;
    }
    return this.buildErrorMessage(error, fallback);
  }

  /** One timer for all events: it redraws the countdown every second and stops itself when no cooldown is left. */
  private startCooldownTimerIfNeeded(): void {
    if (this.cooldownTimer || !this.hasActiveCooldown()) {
      return;
    }

    this.cooldownTimer = setInterval(() => {
      if (!this.hasActiveCooldown()) {
        this.stopCooldownTimer();
      }
      this.changeDetectorRef.detectChanges();
    }, 1000);
  }

  private hasActiveCooldown(): boolean {
    return [...this.sentAtByEventId.keys()].some((eventId) => this.sendNowSecondsLeft(eventId) > 0);
  }

  private stopCooldownTimer(): void {
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
  }

  /** The date and time fields hold a time on the clock of `time_zone`: switching shows the same moment on the other clock. */
  private switchZone(zone: EventZone): void {
    if (zone === this.zone) {
      return;
    }

    const start = this.moment('start');
    const end = this.moment('end');
    if (start) {
      const parts = toZoneParts(start, zone);
      this.form.patchValue({ start_date: parts.date, start_time: parts.time }, { emitEvent: false });
    }
    if (end) {
      const parts = toZoneParts(end, zone);
      this.form.patchValue({ end_date: parts.date, end_time: parts.time }, { emitEvent: false });
    }
    this.zone = zone;
  }

  /** Turns on only the airport fields of the chosen mode: the others are emptied, not validated and not saved. */
  private setAirportControls(mode: EventAirportMode): void {
    const { from_icao, to_icao, airport_entry } = this.form.controls;
    for (const [control, enabled] of [
      [from_icao, usesFromAirport(mode)],
      [to_icao, usesToAirport(mode)],
      [airport_entry, mode === 'MULTIPLE'],
    ] as const) {
      if (enabled) {
        control.enable({ emitEvent: false });
      } else {
        control.reset('', { emitEvent: false });
        control.disable({ emitEvent: false });
      }
    }
  }

  /**
   * Disables everything of a live or past event except the title, start time, end time and image. The dates stay on the
   * Philippine clock, so the time zone cannot be switched either.
   */
  private lockStartedEvent(): void {
    this.detailsLocked = true;
    const { time_zone, start_date, end_date, airport_mode, from_icao, to_icao, airport_entry, description } =
      this.form.controls;
    for (const control of [
      time_zone,
      start_date,
      end_date,
      airport_mode,
      from_icao,
      to_icao,
      airport_entry,
      description,
    ]) {
      control.disable({ emitEvent: false });
    }
  }

  /** The exact moment of the start or end fields, or null while they are empty. */
  private moment(field: 'start' | 'end'): Date | null {
    const value = this.form.getRawValue();
    return field === 'start'
      ? fromZoneParts(value.start_date, value.start_time, this.zone)
      : fromZoneParts(value.end_date, value.end_time, this.zone);
  }

  private time(isoText: string): number {
    return new Date(isoText).getTime();
  }

  private fillForm(item: EventRow, withDates: boolean): void {
    this.form.controls.airport_mode.setValue(item.airport_mode);
    const start = toZoneParts(item.start_at, 'PHT');
    const end = toZoneParts(item.end_at, 'PHT');
    this.form.patchValue({
      title: item.title,
      ...(withDates ? { start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time } : {}),
      from_icao: item.from_icao ?? '',
      to_icao: item.to_icao ?? '',
      description: item.description ?? '',
    });
    this.airportList = [...item.airport_icaos];
  }

  private currentDetails(): EventDetails {
    const value = this.form.getRawValue();
    return {
      title: value.title.trim(),
      startAt: this.moment('start')?.toISOString() ?? '',
      endAt: this.moment('end')?.toISOString() ?? '',
      mode: value.airport_mode,
      from: usesFromAirport(value.airport_mode) ? value.from_icao.trim().toUpperCase() : '',
      to: usesToAirport(value.airport_mode) ? value.to_icao.trim().toUpperCase() : '',
      airports: value.airport_mode === 'MULTIPLE' ? this.airportList.join(',') : '',
    };
  }

  /**
   * What differs from when the edit started, as words for a question: every detail except the description (the picture
   * counts as a detail). Empty when nothing but the description changed.
   */
  private changedDetails(): string[] {
    const original = this.originalDetails;
    if (!original) {
      return [];
    }

    const current = this.currentDetails();
    const changes: string[] = [];
    if (original.title !== current.title) {
      changes.push('title');
    }
    if (original.startAt !== current.startAt || original.endAt !== current.endAt) {
      changes.push('start or end date and time');
    }
    if (
      original.mode !== current.mode ||
      original.from !== current.from ||
      original.to !== current.to ||
      original.airports !== current.airports
    ) {
      changes.push('airports');
    }
    if (this.selectedFile || this.removeImage) {
      changes.push('image');
    }
    return changes;
  }

  private releasePreview(): void {
    if (this.selectedPreviewUrl) {
      URL.revokeObjectURL(this.selectedPreviewUrl);
      this.selectedPreviewUrl = '';
    }
  }

  private resetForm(): void {
    this.editingId = null;
    this.cloneSource = null;
    this.review = null;
    this.originalDetails = null;
    this.originalDescription = '';
    this.releasePreview();
    this.selectedFile = null;
    this.removeImage = false;
    this.imageError = '';
    this.isCheckingImage = false;
    this.attemptedSave = false;
    this.airportList = [];
    this.zone = 'PHT';
    this.detailsLocked = false;
    // The airport fields are switched on or off by setAirportControls below.
    const { time_zone, start_date, end_date, airport_mode, description } = this.form.controls;
    for (const control of [time_zone, start_date, end_date, airport_mode, description]) {
      control.enable({ emitEvent: false });
    }
    this.form.reset({
      title: '',
      time_zone: 'PHT',
      start_date: '',
      start_time: '',
      end_date: '',
      end_time: '',
      airport_mode: 'FROM_TO',
      from_icao: '',
      to_icao: '',
      airport_entry: '',
      description: '',
    });
    this.setAirportControls('FROM_TO');
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    return buildSubmitErrorMessage(error, { fallbackMessage: fallback });
  }
}
