import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { AuthImageDirective } from '../../../shared/auth-image';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { LINK_URL_ERROR, LINK_URL_MAX_LENGTH, linkUrlValidator } from '../../../shared/link-url';
import { injectCurrentPage } from '../../../shared/page-titles';
import { PHILIPPINE_AIRPORTS } from '../../../shared/philippine-airports';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';
import { PopupService } from '../../../shared/popup/popup.service';
import { QrUploadComponent } from '../../../shared/qr-upload/qr-upload';
import {
  SCENERY_SHARED_GROUPS,
  SCENERY_SIMULATORS,
  SceneryDownload,
  SceneryLinkField,
  SceneryLinks,
  ScenerySharedGroup,
  sceneryDownloads,
} from '../../../shared/scenery-simulators';
import { buildSubmitErrorMessage } from '../../../shared/submit-error-utils';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import { SCENERY_IMAGE_RULES, getAcceptAttribute, getUploadFileError } from '../../../shared/upload-files';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';

const SCENERIES_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/sceneries`;
const ICAO_PATTERN = /^[A-Za-z]{4}$/;

interface SceneryRow extends SceneryLinks {
  id: number;
  airport_icao: string;
  airport_name: string;
  note: string | null;
  has_image: boolean;
  image_name: string | null;
  image_size: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** What the server knows of an ICAO code (null when it is not a known airport). */
interface AirportLookupResponse {
  airport: { icao: string; name: string; place: string } | null;
}

/** Where the search for the typed ICAO code stands. */
type AirportLookup = 'idle' | 'loading' | 'found' | 'unknown' | 'failed';

type SceneryColumnKey = 'id' | 'airport_icao' | 'airport_name' | 'links' | 'note' | 'has_image' | 'is_active';
type SortDirection = 'asc' | 'desc';

const EMPTY_FILTERS: Record<SceneryColumnKey, string> = {
  id: '',
  airport_icao: '',
  airport_name: '',
  links: '',
  note: '',
  has_image: '',
  is_active: '',
};

const LINK_VALIDATORS = [Validators.maxLength(LINK_URL_MAX_LENGTH), linkUrlValidator];

function linkControl(): FormControl<string> {
  return new FormControl('', { nonNullable: true, validators: LINK_VALIDATORS });
}

/**
 * Data management page for the airport sceneries shown on the public Sceneries page: the airport (its name is filled in
 * from a known ICAO code), the download link of each flight simulator (at least one), an optional picture and note, and
 * the Enabled switch. Like Documents it has no template import/export: a picture cannot travel in a CSV.
 */
@Component({
  selector: 'app-sceneries-manage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AuthImageDirective,
    PlaceholderBannerDataManagementComponent,
    PopupMessageComponent,
    QrUploadComponent,
    TablePaginationComponent,
  ],
  templateUrl: './sceneries-manage.html',
  styleUrl: './sceneries-manage.css',
})
export class SceneriesManageComponent implements OnInit, OnDestroy {
  readonly pager = new TablePagination();
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly popups = inject(PopupService);

  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly simulators = SCENERY_SIMULATORS;
  readonly imageAccept = getAcceptAttribute(SCENERY_IMAGE_RULES);
  readonly imageHelperText = SCENERY_IMAGE_RULES.helperText;
  readonly linkUrlMaxLength = LINK_URL_MAX_LENGTH;
  readonly linkUrlErrorMessage = LINK_URL_ERROR;
  readonly invalidIcaoMessage = 'Enter the 4-letter ICAO code of the airport, for example RPLL.';
  readonly noLinkMessage = 'Enter at least one download link.';

  readonly form = this.fb.nonNullable.group({
    airport_icao: ['', [Validators.required, Validators.pattern(ICAO_PATTERN)]],
    airport_name: ['', [Validators.required, Validators.maxLength(255)]],
    // While versions share a link, the fields after the first are off: a disabled field is neither validated nor saved.
    msfs_shared_link: [false],
    link_msfs_2024: linkControl(),
    link_msfs_2020: linkControl(),
    p3d_shared_link: [true],
    link_p3d_v6: linkControl(),
    link_p3d_v5: linkControl(),
    link_p3d_v4: linkControl(),
    link_p3d_v3: linkControl(),
    link_fsx: linkControl(),
    link_fs9: linkControl(),
    link_xplane: linkControl(),
    note: ['', [Validators.maxLength(1000)]],
    is_active: [false],
  });

  sceneries: SceneryRow[] = [];
  editingId: number | null = null;
  /** The picture chosen on this device or received from the phone; null keeps the saved one when editing. */
  selectedFile: File | null = null;
  selectedPreviewUrl = '';
  /** The saved picture is dropped when saving. */
  removeImage = false;
  imageError = '';
  airportLookup: AirportLookup = 'idle';
  /** "City, Country" of the airport found. */
  airportPlace = '';
  /** A save was tried: the "at least one link" error shows from now on. */
  attemptedSave = false;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  /** The list could not be loaded, so there is no table to show. */
  loadFailed = false;
  columnFilters: Record<SceneryColumnKey, string> = { ...EMPTY_FILTERS };

  sortColumn: SceneryColumnKey | null = 'airport_icao';
  sortDirection: SortDirection = 'asc';

  /** The airport name that belongs to the code in the form: it is cleared when the code changes. */
  private nameOfCode = '';
  private lookupRequest: Subscription | null = null;

  constructor() {
    for (const group of SCENERY_SHARED_GROUPS) {
      this.form.controls[group.flag].valueChanges.subscribe((shared) => this.setSharedLink(group, shared));
    }
  }

  ngOnInit(): void {
    this.loadSceneries();
  }

  ngOnDestroy(): void {
    this.lookupRequest?.unsubscribe();
    this.releasePreview();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  get editingScenery(): SceneryRow | undefined {
    return this.sceneries.find((item) => item.id === this.editingId);
  }

  /** The link fields shown: versions that share a link have one field between them. */
  get linkFields(): { field: SceneryLinkField; label: string }[] {
    const shared = SCENERY_SHARED_GROUPS.filter(({ flag }) => this.form.controls[flag].value);
    return this.simulators
      .filter(({ field }) => !shared.some(({ fields }) => fields.indexOf(field) > 0))
      .map(({ field, label }) => ({
        field,
        label: shared.find(({ fields }) => fields[0] === field)?.label ?? label,
      }));
  }

  /** A save was tried and not one link is filled in. */
  get noLinkError(): boolean {
    return this.attemptedSave && this.linkFields.every(({ field }) => !this.form.controls[field].value.trim());
  }

  get showSavedImage(): boolean {
    return !!this.editingScenery?.has_image && !this.removeImage && !this.selectedFile;
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value);
  }

  get filteredSceneries(): SceneryRow[] {
    const filters = Object.fromEntries(
      Object.entries(this.columnFilters).map(([key, value]) => [key, value.trim().toLowerCase()]),
    ) as Record<SceneryColumnKey, string>;

    const filtered = this.sceneries.filter((item) => {
      for (const column of ['id', 'airport_icao', 'airport_name', 'links', 'note'] as const) {
        if (filters[column] && !this.getText(item, column).toLowerCase().includes(filters[column])) {
          return false;
        }
      }

      const imageText = item.has_image ? 'yes' : 'no';
      if (filters.has_image && !imageText.includes(filters.has_image)) {
        return false;
      }

      const activeText = item.is_active ? 'yes enabled active true' : 'no disabled inactive false';
      return !filters.is_active || activeText.includes(filters.is_active);
    });

    if (!this.sortColumn) {
      return filtered;
    }

    const sortColumn = this.sortColumn;
    const directionMultiplier = this.sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortColumn === 'id') {
        return (left.id - right.id) * directionMultiplier;
      }
      if (sortColumn === 'has_image' || sortColumn === 'is_active') {
        return (Number(left[sortColumn]) - Number(right[sortColumn])) * directionMultiplier;
      }

      return (
        this.getText(left, sortColumn).localeCompare(this.getText(right, sortColumn), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * directionMultiplier
      );
    });
  }

  downloads(item: SceneryRow): SceneryDownload[] {
    return sceneryDownloads(item);
  }

  imageUrl(item: SceneryRow): string {
    return `${SCENERIES_API}/${item.id}/image?v=${encodeURIComponent(item.updated_at)}`;
  }

  loadSceneries(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.loadFailed = false;
    this.http.get<SceneryRow[]>(SCENERIES_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.sceneries = Array.isArray(rows) ? rows : [];
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.loadFailed = true;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('sceneries'));
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

  edit(item: SceneryRow): void {
    this.resetForm();
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';

    this.form.controls.airport_icao.setValue(item.airport_icao);
    this.form.controls.airport_name.setValue(item.airport_name);
    this.nameOfCode = item.airport_name;
    for (const { field } of this.simulators) {
      this.form.controls[field].setValue(item[field] ?? '');
    }
    // After the links: switching a shared link on or off works with what the fields hold.
    for (const { flag } of SCENERY_SHARED_GROUPS) {
      this.form.controls[flag].setValue(item[flag]);
    }
    this.form.controls.note.setValue(item.note ?? '');
    this.form.controls.is_active.setValue(item.is_active);

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

  /** An ICAO code is four letters in capitals: anything else typed or pasted is dropped. */
  onIcaoInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.form.controls.airport_icao.setValue(icao);
    this.findAirport(icao);
  }

  onFileChange(file: File | null): void {
    this.releasePreview();
    this.selectedFile = file;
    this.removeImage = false;
    this.imageError = file ? getUploadFileError(file, SCENERY_IMAGE_RULES, '') : '';
    if (file && !this.imageError) {
      this.selectedPreviewUrl = URL.createObjectURL(file);
    }
    this.changeDetectorRef.detectChanges();
  }

  setRemoveImage(remove: boolean): void {
    this.removeImage = remove;
  }

  isRequiredLink(field: SceneryLinkField): boolean {
    return this.form.controls[field].hasValidator(Validators.required);
  }

  showInvalid(controlName: 'airport_icao' | 'airport_name' | 'note' | SceneryLinkField): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.touched || control.dirty);
  }

  save(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.attemptedSave = true;
    this.form.markAllAsTouched();

    const value = this.form.getRawValue();
    const airportName = value.airport_name.trim();
    if (!airportName) {
      this.form.controls.airport_name.setErrors({ required: true });
    }
    if (this.form.invalid || this.noLinkError || this.imageError) {
      return;
    }

    // multipart/form-data: the text fields and, when one was chosen, the picture.
    const body = new FormData();
    body.append('airport_icao', value.airport_icao.toUpperCase());
    body.append('airport_name', airportName);
    for (const { flag } of SCENERY_SHARED_GROUPS) {
      body.append(flag, String(value[flag]));
    }
    // Every link is always sent: an empty text removes the saved one, also that of a field that is not shown.
    const shownFields = new Set(this.linkFields.map(({ field }) => field));
    for (const { field } of this.simulators) {
      body.append(field, shownFields.has(field) ? value[field].trim() : '');
    }
    body.append('note', value.note.trim());
    body.append('is_active', String(value.is_active));
    if (this.selectedFile) {
      body.append('image', this.selectedFile, this.selectedFile.name);
    } else if (this.removeImage) {
      body.append('remove_image', 'true');
    }

    const headers = this.authService.getAdminApiHeaders();
    const isEditing = this.editingId !== null;
    const request = isEditing
      ? this.http.put(`${SCENERIES_API}/${this.editingId}`, body, { headers })
      : this.http.post(SCENERIES_API, body, { headers });

    this.isSaving = true;
    request.subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = isEditing
          ? DATA_MANAGE_MESSAGES.updated('Scenery')
          : DATA_MANAGE_MESSAGES.added('Scenery');
        this.isModalOpen = false;
        this.resetForm();
        this.loadSceneries();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(
          error,
          isEditing ? 'Unable to update scenery.' : 'Unable to add scenery.',
        );
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  async deleteScenery(): Promise<void> {
    if (this.editingId === null) {
      return;
    }

    const editing = this.editingScenery;
    const shouldDelete = await this.popups.ask({
      title: 'Delete Scenery',
      message: DATA_MANAGE_MESSAGES.confirmDelete(editing ? `${editing.airport_icao} - ${editing.airport_name}` : ''),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!shouldDelete) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.changeDetectorRef.detectChanges();
    this.http
      .delete(`${SCENERIES_API}/${this.editingId}`, { headers: this.authService.getAdminApiHeaders() })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.successMessage = DATA_MANAGE_MESSAGES.deleted('Scenery');
          this.isModalOpen = false;
          this.resetForm();
          this.loadSceneries();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving = false;
          this.errorMessage = this.buildErrorMessage(error, 'Unable to delete scenery.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  setColumnFilter(column: SceneryColumnKey, value: string): void {
    this.columnFilters[column] = value;
  }

  clearFilters(): void {
    this.columnFilters = { ...EMPTY_FILTERS };
  }

  toggleSort(column: SceneryColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.sortColumn = column;
    this.sortDirection = 'asc';
  }

  getSortIndicator(column: SceneryColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  /** The text a column is filtered and sorted by; the links column by simulator names and addresses. */
  private getText(item: SceneryRow, column: 'id' | 'airport_icao' | 'airport_name' | 'links' | 'note'): string {
    if (column === 'links') {
      return sceneryDownloads(item)
        .map(({ label, url }) => `${label} ${url}`)
        .join(' ');
    }

    return String(item[column] ?? '');
  }

  /** Fills in the Airport Name when the code is a known airport. */
  private findAirport(icao: string): void {
    this.lookupRequest?.unsubscribe();
    this.lookupRequest = null;
    this.airportLookup = 'idle';
    this.airportPlace = '';

    const name = this.form.controls.airport_name;
    // A name that belonged to the previous code does not belong to this one.
    if (this.nameOfCode && name.value === this.nameOfCode) {
      name.setValue('');
    }
    this.nameOfCode = '';

    if (!ICAO_PATTERN.test(icao)) {
      return;
    }

    this.airportLookup = 'loading';
    this.lookupRequest = this.http
      .get<AirportLookupResponse>(`${SCENERIES_API}/airports/${icao}`, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: ({ airport }) => {
          if (airport) {
            this.airportLookup = 'found';
            this.airportPlace = airport.place;
            name.setValue(airport.name);
            this.nameOfCode = airport.name;
          } else {
            this.airportLookup = 'unknown';
          }
          this.changeDetectorRef.detectChanges();
        },
        // The name can still be typed.
        error: () => {
          this.airportLookup = 'failed';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  /**
   * One link for several versions: the first field holds it (required for MSFS) and the others are switched off; what was
   * typed in them comes back when the switch is turned off again.
   */
  private setSharedLink(group: ScenerySharedGroup, shared: boolean): void {
    const [first, ...others] = group.fields.map((field) => this.form.controls[field]);
    if (group.required) {
      first.setValidators(shared ? [Validators.required, ...LINK_VALIDATORS] : LINK_VALIDATORS);
    }
    // A link typed for another version only becomes the shared one.
    if (shared && !first.value.trim()) {
      first.setValue(others.find((control) => control.value.trim())?.value ?? '');
    }
    for (const control of others) {
      if (shared) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    }
    first.updateValueAndValidity({ emitEvent: false });
  }

  private resetForm(): void {
    this.lookupRequest?.unsubscribe();
    this.lookupRequest = null;
    this.releasePreview();
    this.editingId = null;
    this.selectedFile = null;
    this.removeImage = false;
    this.imageError = '';
    this.airportLookup = 'idle';
    this.airportPlace = '';
    this.nameOfCode = '';
    this.attemptedSave = false;
    // Every field goes back to its starting value: empty, with Enabled and the shared MSFS link off and the shared P3D
    // link on.
    this.form.reset();
    for (const group of SCENERY_SHARED_GROUPS) {
      this.setSharedLink(group, this.form.controls[group.flag].value);
    }
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private releasePreview(): void {
    if (this.selectedPreviewUrl) {
      URL.revokeObjectURL(this.selectedPreviewUrl);
      this.selectedPreviewUrl = '';
    }
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    return buildSubmitErrorMessage(error, { fallbackMessage: fallback });
  }
}
