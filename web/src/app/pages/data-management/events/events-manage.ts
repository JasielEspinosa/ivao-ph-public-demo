import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { AdminAuthService } from '../../../services/admin-auth.service';
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
  fromZoneParts,
  toZoneParts,
  usesFromAirport,
  usesToAirport,
} from '../../../shared/event-format';
import { injectCurrentPage } from '../../../shared/page-titles';
import { PHILIPPINE_AIRPORTS } from '../../../shared/philippine-airports';
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
  updated_at: string;
}

/** What the creator can change in an event, except the description (see `changedAfterCompletion`). */
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
 * upcoming and current events (soonest start first) and the past events (most recently ended first), each with its
 * picture. A new or edited event is typed in GMT or Philippine Time (the creator's choice) and saved as an exact moment.
 * A past event can also be archived (hidden from the website) or cloned into a new event. Like Documents and Charts it
 * has no template import/export: a picture cannot travel in a CSV.
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

  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly fallbackImage = EVENT_FALLBACK_IMAGE;
  readonly imageAccept = getAcceptAttribute(EVENT_IMAGE_RULES);
  readonly imageHelperText = EVENT_IMAGE_RULES.helperText;
  readonly formatFileSize = formatFileSize;
  readonly formatWhen = formatEventWhen;
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
  showArchived = false;
  pastLimit = PAST_PAGE_SIZE;

  /** The details of the event as it was when the edit started, to see whether the creator changed any. */
  private originalDetails: EventDetails | null = null;
  private zone: EventZone = 'PHT';

  constructor() {
    this.form.controls.time_zone.valueChanges.subscribe((zone) => this.switchZone(zone));
    this.form.controls.airport_mode.valueChanges.subscribe((mode) => this.setAirportControls(mode));
    this.setAirportControls('FROM_TO');
  }

  ngOnInit(): void {
    this.loadEvents();
  }

  ngOnDestroy(): void {
    this.releasePreview();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
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

  /** Upcoming and current events: the soonest start first. */
  get upcomingEvents(): EventRow[] {
    return this.events
      .filter((item) => !this.isPast(item))
      .sort((left, right) => this.time(left.start_at) - this.time(right.start_at) || left.id - right.id);
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
    if (!start_date.value) {
      return;
    }

    end_date.setValue(start_date.value);
    end_date.markAsDirty();
  }

  isPast(item: EventRow): boolean {
    return this.time(item.end_at) < Date.now();
  }

  imageUrl(item: EventRow): string {
    return item.has_image ? `${EVENTS_API}/${item.id}/image?v=${encodeURIComponent(item.updated_at)}` : '';
  }

  loadEvents(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<EventRow[]>(EVENTS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.events = Array.isArray(rows) ? rows : [];
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
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
    this.isModalOpen = true;
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

  save(): void {
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

    const isEditing = this.editingId !== null;
    // A completed event is a record of what happened: ask before its details change (the description may change freely).
    const changes = isEditing && this.isEditingPastEvent ? this.changedAfterCompletion() : [];
    if (changes.length > 0) {
      const title = this.editingEvent?.title ?? '';
      const message = `"${title}" has already been completed, and you changed its ${changes.join(', ')}. Save the changes anyway?`;
      if (!window.confirm(message)) {
        return;
      }
    }

    const value = this.form.getRawValue();
    const mode = value.airport_mode;
    // multipart/form-data: the text fields and, when one was chosen, the picture.
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
    } else if (this.cloneSource && !isEditing) {
      body.append('clone_from_id', String(this.cloneSource.id));
    }

    const headers = this.authService.getAdminApiHeaders();
    const request = isEditing
      ? this.http.put(`${EVENTS_API}/${this.editingId}`, body, { headers })
      : this.http.post(EVENTS_API, body, { headers });

    this.isSaving = true;
    request.subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = isEditing ? DATA_MANAGE_MESSAGES.updated('Event') : DATA_MANAGE_MESSAGES.added('Event');
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

  deleteEvent(): void {
    if (this.editingId === null) {
      return;
    }

    if (!window.confirm(DATA_MANAGE_MESSAGES.confirmDelete(this.editingEvent?.title ?? ''))) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
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
  setArchived(item: EventRow, archived: boolean): void {
    if (archived && !window.confirm(`Archive "${item.title}"? It will no longer be shown on the Home page.`)) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isLoading = true;
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

  showMorePast(): void {
    this.pastLimit += PAST_PAGE_SIZE;
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
   * What differs from when the edit started, as words for the warning: every detail except the description (the picture
   * counts as a detail). Empty when nothing but the description changed.
   */
  private changedAfterCompletion(): string[] {
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
    this.originalDetails = null;
    this.releasePreview();
    this.selectedFile = null;
    this.removeImage = false;
    this.imageError = '';
    this.isCheckingImage = false;
    this.attemptedSave = false;
    this.airportList = [];
    this.zone = 'PHT';
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
