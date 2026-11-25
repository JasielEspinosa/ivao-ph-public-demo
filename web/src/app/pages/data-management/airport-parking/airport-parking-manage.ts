import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { AdminAuthService } from '../../../services/admin-auth.service';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';
import { PopupService } from '../../../shared/popup/popup.service';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';
import { injectCurrentPage } from '../../../shared/page-titles';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { TemplateImportExportService } from '../../../shared/template-import-export.service';
import { environment } from '../../../../environments/environment';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import { getAuthErrorMessage, NETWORK_UNAVAILABLE_MESSAGE } from '../../../shared/submit-error-utils';
import { PHILIPPINE_AIRPORTS } from '../../../shared/philippine-airports';
import {
  AIRCRAFT_SIZES,
  AIRLINE_CODES_MESSAGE,
  AIRLINE_CODES_PATTERN,
  AIRPORT_PARKING_SOURCES,
  AIRPORT_STAND_TYPES,
  AirportParkingSpot,
  MAX_AIRLINES_LENGTH,
  MAX_PARKING_NOTE_LENGTH,
  MAX_STAND_NAME_LENGTH,
  STAND_USES,
  airlinesSourceLabel,
  parkingSourceLabel,
  standTypeLabel,
  standUseLabel,
} from '../../../shared/airport-parking';

const PARKING_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/airport-parking`;
const TEMPLATE_HEADERS = [
  'id',
  'airport_icao',
  'stand_name',
  'stand_type',
  'latitude',
  'longitude',
  'source',
  'source_ref',
  'note',
  'is_active',
  'terminal_name',
  'stand_use',
  'aircraft_size',
  'airlines',
  'simulator_airlines',
] as const;
const ICAO_PATTERN = /^[A-Z]{4}$/;
const COORDINATE_PATTERN = /^-?\d{1,3}(\.\d+)?$/;

interface ParkingRow extends AirportParkingSpot {
  /** The spot's own values; the shown_* ones may come from its terminal or a simulator spot. */
  stand_use: string | null;
  aircraft_size: string | null;
  airlines: string | null;
  simulator_airlines: string | null;
  source_ref: string | null;
  is_active: boolean;
  /** A simulator spot the public page leaves out because a real-world spot covers it. */
  is_covered: boolean;
}

/** The table columns, in order. `numeric` ones are sorted as numbers. */
const COLUMNS = [
  { key: 'id', label: 'ID', numeric: true },
  { key: 'airport_icao', label: 'ICAO', numeric: false },
  { key: 'stand_name', label: 'Stand Name', numeric: false },
  { key: 'stand_type', label: 'Type', numeric: false },
  { key: 'terminal_name', label: 'Terminal', numeric: false },
  { key: 'stand_use', label: 'Use', numeric: false },
  { key: 'aircraft_size', label: 'Size', numeric: false },
  { key: 'airlines', label: 'Airlines of Spot', numeric: false },
  { key: 'shown_airlines', label: 'Airlines Shown', numeric: false },
  { key: 'latitude', label: 'Latitude', numeric: true },
  { key: 'longitude', label: 'Longitude', numeric: true },
  { key: 'source', label: 'Source', numeric: false },
  { key: 'note', label: 'Note', numeric: false },
  { key: 'is_active', label: 'Enabled', numeric: false },
  { key: 'is_covered', label: 'Hidden by Real-World Spot', numeric: false },
] as const;

type ParkingColumnKey = (typeof COLUMNS)[number]['key'];
type SortDirection = 'asc' | 'desc';

const EMPTY_FILTERS = Object.fromEntries(COLUMNS.map((column) => [column.key, ''])) as Record<ParkingColumnKey, string>;

/** A terminal a spot of an airport can be given. */
interface TerminalName {
  airport_icao: string;
  terminal_name: string;
}

/** A latitude (limit 90) or longitude (limit 180) in decimal degrees. */
function coordinateValidator(limit: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const text = String(control.value ?? '').trim();
    if (!text) {
      return null;
    }

    return COORDINATE_PATTERN.test(text) && Math.abs(Number(text)) <= limit ? null : { coordinate: true };
  };
}

/** Data Management > Airport Parking: the parking stands, hangars and terminal gates of the public Airport Parking section. */
@Component({
  selector: 'app-airport-parking-manage',
  standalone: true,
  imports: [
    PopupMessageComponent,
    TablePaginationComponent,
    CommonModule,
    ReactiveFormsModule,
    PlaceholderBannerDataManagementComponent,
  ],
  templateUrl: './airport-parking-manage.html',
})
export class AirportParkingManageComponent implements OnInit {
  readonly pager = new TablePagination();
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly popups = inject(PopupService);
  private readonly templateService = inject(TemplateImportExportService);

  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly columns = COLUMNS;
  readonly standTypes = AIRPORT_STAND_TYPES;
  readonly sources = AIRPORT_PARKING_SOURCES;
  readonly standUses = STAND_USES;
  readonly aircraftSizes = AIRCRAFT_SIZES;
  readonly maxAirlinesLength = MAX_AIRLINES_LENGTH;
  readonly invalidAirlinesMessage = AIRLINE_CODES_MESSAGE;
  readonly maxStandNameLength = MAX_STAND_NAME_LENGTH;
  readonly maxNoteLength = MAX_PARKING_NOTE_LENGTH;
  readonly invalidIcaoMessage = 'Enter the 4-letter ICAO code of the airport, for example RPLL.';
  readonly invalidLatitudeMessage = 'Enter a latitude from -90 to 90, for example 14.508600.';
  readonly invalidLongitudeMessage = 'Enter a longitude from -180 to 180, for example 121.019700.';

  readonly form = this.fb.nonNullable.group({
    airport_icao: ['', [Validators.required, Validators.pattern(ICAO_PATTERN)]],
    stand_name: ['', [Validators.maxLength(MAX_STAND_NAME_LENGTH)]],
    stand_type: ['PARKING_STAND', [Validators.required]],
    source: ['', [Validators.required]],
    latitude: ['', [Validators.required, coordinateValidator(90)]],
    longitude: ['', [Validators.required, coordinateValidator(180)]],
    note: ['', [Validators.maxLength(MAX_PARKING_NOTE_LENGTH)]],
    is_active: [false],
    terminal_name: [''],
    stand_use: [''],
    aircraft_size: [''],
    airlines: ['', [Validators.maxLength(MAX_AIRLINES_LENGTH), Validators.pattern(AIRLINE_CODES_PATTERN)]],
  });

  spots: ParkingRow[] = [];
  private terminals: TerminalName[] = [];
  /** The spots that pass the filters, sorted (rebuilt only when the list, a filter or the order changes). */
  visibleSpots: ParkingRow[] = [];
  editingId: number | null = null;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  /** The list could not be loaded, so there is no table to show. */
  loadFailed = false;
  isExportOptionsModalOpen = false;
  isTemplateUploading = false;
  isTemplateUpdatedModalOpen = false;
  pendingImportFile: File | null = null;
  columnFilters: Record<ParkingColumnKey, string> = { ...EMPTY_FILTERS };

  sortColumn: ParkingColumnKey = 'airport_icao';
  sortDirection: SortDirection = 'asc';

  constructor() {
    // Only an enabled spot needs a name.
    this.form.controls.is_active.valueChanges.subscribe((isActive) => {
      const name = this.form.controls.stand_name;
      name.setValidators([...(isActive ? [Validators.required] : []), Validators.maxLength(MAX_STAND_NAME_LENGTH)]);
      name.updateValueAndValidity();
    });
  }

  ngOnInit(): void {
    this.loadSpots();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  /** The terminals of the airport in the form, and the one chosen when it is no longer listed. */
  get terminalOptions(): string[] {
    const { airport_icao: icao, terminal_name: chosen } = this.form.getRawValue();
    const names = this.terminals
      .filter((terminal) => terminal.airport_icao === icao)
      .map((terminal) => terminal.terminal_name);
    return chosen && !names.includes(chosen) ? [...names, chosen] : names;
  }

  /** The airline codes the X-Plane scenery gives the spot being edited. */
  get editingSimulatorAirlines(): string {
    return this.spots.find((item) => item.id === this.editingId)?.simulator_airlines ?? '';
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value);
  }

  showInvalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  /** The text a column shows, which is also what its filter searches and its sort compares. */
  cellText(item: ParkingRow, column: ParkingColumnKey): string {
    switch (column) {
      case 'stand_type':
        return standTypeLabel(item.stand_type);
      case 'source':
        return parkingSourceLabel(item.source);
      case 'stand_use':
        return standUseLabel(item.stand_use);
      case 'shown_airlines': {
        const codes = item.shown_airlines.map((airline) => airline.code).join(', ');
        return codes ? `${codes} (${airlinesSourceLabel(item.airlines_source)})` : '';
      }
      case 'is_active':
        return item.is_active ? 'Yes' : 'No';
      case 'is_covered':
        return item.is_covered ? 'Yes' : 'No';
      default:
        return String(item[column] ?? '');
    }
  }

  loadSpots(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.loadFailed = false;
    const options = { headers: this.authService.getAdminApiHeaders() };
    forkJoin({
      rows: this.http.get<ParkingRow[]>(PARKING_API, options),
      terminals: this.http.get<TerminalName[]>(`${PARKING_API}/terminals`, options),
    }).subscribe({
      next: ({ rows, terminals }) => {
        this.terminals = Array.isArray(terminals) ? terminals : [];
        this.spots = Array.isArray(rows) ? rows : [];
        this.applyView();
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.loadFailed = true;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('parking spots'));
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

  edit(item: ParkingRow): void {
    this.resetForm();
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';
    this.form.setValue({
      airport_icao: item.airport_icao,
      stand_name: item.stand_name ?? '',
      stand_type: item.stand_type,
      source: item.source,
      latitude: String(item.latitude),
      longitude: String(item.longitude),
      note: item.note ?? '',
      is_active: item.is_active,
      terminal_name: item.terminal_name ?? '',
      stand_use: item.stand_use ?? '',
      aircraft_size: item.aircraft_size ?? '',
      airlines: item.airlines ?? '',
    });
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
    if (icao !== this.form.controls.airport_icao.value) {
      // A terminal belongs to the airport it was chosen for.
      this.form.controls.terminal_name.setValue('');
    }
    this.form.controls.airport_icao.setValue(icao);
  }

  save(): void {
    this.errorMessage = '';
    this.successMessage = '';

    const value = this.form.getRawValue();
    // A name of spaces only is no name, so the "required" error of an enabled spot shows for it too.
    if (!value.stand_name.trim()) {
      this.form.controls.stand_name.setValue('');
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = {
      airport_icao: value.airport_icao,
      stand_name: value.stand_name.trim(),
      stand_type: value.stand_type,
      source: value.source,
      latitude: Number(value.latitude),
      longitude: Number(value.longitude),
      note: value.note.trim(),
      is_active: value.is_active,
      terminal_name: value.terminal_name,
      stand_use: value.stand_use,
      aircraft_size: value.aircraft_size,
      airlines: value.airlines.trim(),
    };

    const isEdit = this.editingId !== null;
    const headers = this.authService.getAdminApiHeaders();
    const request = isEdit
      ? this.http.put(`${PARKING_API}/${this.editingId}`, payload, { headers })
      : this.http.post(PARKING_API, payload, { headers });

    this.isSaving = true;
    request.subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = isEdit
          ? DATA_MANAGE_MESSAGES.updated('Parking spot')
          : DATA_MANAGE_MESSAGES.added('Parking spot');
        this.isModalOpen = false;
        this.resetForm();
        this.loadSpots();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(
          error,
          isEdit ? 'Unable to update parking spot.' : 'Unable to add parking spot.',
        );
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  async deleteSpot(): Promise<void> {
    const spot = this.spots.find((item) => item.id === this.editingId);
    if (!spot) {
      return;
    }

    const shouldDelete = await this.popups.ask({
      title: 'Delete Parking Spot',
      message: DATA_MANAGE_MESSAGES.confirmDelete(`${spot.airport_icao} ${spot.stand_name ?? `#${spot.id}`}`),
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
    this.http.delete(`${PARKING_API}/${spot.id}`, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = DATA_MANAGE_MESSAGES.deleted('Parking spot');
        this.isModalOpen = false;
        this.resetForm();
        this.loadSpots();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(error, 'Unable to delete parking spot.');
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  exportTemplate(): void {
    this.isExportOptionsModalOpen = true;
  }

  closeExportOptionsModal(): void {
    this.isExportOptionsModalOpen = false;
  }

  downloadTemplateFromServer(): void {
    this.isExportOptionsModalOpen = false;
    this.http
      .get(`${PARKING_API}/export-template`, {
        headers: this.authService.getAdminApiHeaders(),
        responseType: 'blob',
        observe: 'response',
      })
      .subscribe({
        next: (response) => {
          const name = this.templateService.getExportFilenameFromDisposition(
            response.headers.get('content-disposition'),
            'airport-parking-template.csv',
          );
          const url = URL.createObjectURL(response.body || new Blob());
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = this.buildErrorMessage(error, 'Unable to export template from server.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  downloadTemplateFromPage(): void {
    this.isExportOptionsModalOpen = false;
    this.templateService.downloadCsv(`airport-parking-template-${this.templateService.getCurrentDateStamp()}.csv`, [
      TEMPLATE_HEADERS,
      ...this.spots.map((row) =>
        TEMPLATE_HEADERS.map((header) =>
          header === 'is_active' ? (row.is_active ? 'true' : 'false') : String(row[header] ?? ''),
        ),
      ),
    ]);
  }

  openImportTemplatePicker(fileInput: HTMLInputElement): void {
    fileInput.value = '';
    fileInput.click();
  }

  onImportTemplateSelected(event: Event): void {
    this.pendingImportFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  cancelImportConfirm(): void {
    this.pendingImportFile = null;
  }

  async confirmImportTemplate(): Promise<void> {
    const file = this.pendingImportFile;
    this.pendingImportFile = null;
    if (!file) return;
    this.isTemplateUploading = true;
    try {
      const values = await this.templateService.parseTemplateFile(file, TEMPLATE_HEADERS);
      // The values go as text: the server checks each one and names the row of a wrong one.
      const rows = values.map((cells) =>
        Object.fromEntries(TEMPLATE_HEADERS.map((header, index) => [header, cells[index]])),
      );
      this.http
        .post(`${PARKING_API}/import-template`, { rows }, { headers: this.authService.getAdminApiHeaders() })
        .subscribe({
          next: () => {
            this.isTemplateUploading = false;
            this.isTemplateUpdatedModalOpen = true;
            this.loadSpots();
          },
          error: (error: HttpErrorResponse) => {
            this.isTemplateUploading = false;
            this.errorMessage = this.buildErrorMessage(error, 'Unable to import template.');
            this.changeDetectorRef.detectChanges();
          },
        });
    } catch (error) {
      this.isTemplateUploading = false;
      this.errorMessage = error instanceof Error ? error.message : 'Unable to import template file.';
      this.changeDetectorRef.detectChanges();
    }
  }

  closeTemplateUpdatedModal(): void {
    this.isTemplateUpdatedModalOpen = false;
  }

  setColumnFilter(column: ParkingColumnKey, value: string): void {
    this.columnFilters[column] = value;
    this.applyView();
  }

  clearFilters(): void {
    this.columnFilters = { ...EMPTY_FILTERS };
    this.applyView();
  }

  toggleSort(column: ParkingColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applyView();
  }

  getSortIndicator(column: ParkingColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  private applyView(): void {
    const filters = COLUMNS.map(({ key }) => ({ key, text: this.columnFilters[key].trim().toLowerCase() })).filter(
      (filter) => filter.text,
    );
    const filtered = this.spots.filter((item) =>
      filters.every(({ key, text }) => this.cellText(item, key).toLowerCase().includes(text)),
    );

    const column = COLUMNS.find(({ key }) => key === this.sortColumn)!;
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    this.visibleSpots = filtered.sort(
      (left, right) =>
        direction *
        (column.numeric
          ? Number(left[column.key]) - Number(right[column.key])
          : collator.compare(this.cellText(left, column.key), this.cellText(right, column.key))),
    );
  }

  private resetForm(): void {
    this.editingId = null;
    this.form.reset({
      airport_icao: '',
      stand_name: '',
      stand_type: 'PARKING_STAND',
      source: '',
      latitude: '',
      longitude: '',
      note: '',
      is_active: false,
      terminal_name: '',
      stand_use: '',
      aircraft_size: '',
      airlines: '',
    });
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 0) {
      return NETWORK_UNAVAILABLE_MESSAGE;
    }

    if (error.status === 401 || error.status === 403) {
      return getAuthErrorMessage(error.status);
    }

    const responseMessage = error.error?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }

    if (Array.isArray(responseMessage) && responseMessage.length) {
      return responseMessage.join(' ');
    }

    return fallback;
  }
}
