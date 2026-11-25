import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

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
  AIRLINE_CODES_MESSAGE,
  AIRLINE_CODES_PATTERN,
  MAX_AIRLINES_LENGTH,
  MAX_PARKING_NOTE_LENGTH,
  MAX_TERMINAL_NAME_LENGTH,
} from '../../../shared/airport-parking';

const TERMINALS_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/airport-terminals`;
const TEMPLATE_HEADERS = ['id', 'airport_icao', 'terminal_name', 'airlines', 'note', 'is_active'] as const;
const ICAO_PATTERN = /^[A-Z]{4}$/;

interface TerminalRow {
  id: number;
  airport_icao: string;
  terminal_name: string;
  airlines: string | null;
  note: string | null;
  is_active: boolean;
  /** The parking spots that name this terminal. */
  spot_count: number;
}

/** The table columns, in order. `numeric` ones are sorted as numbers. */
const COLUMNS = [
  { key: 'id', label: 'ID', numeric: true },
  { key: 'airport_icao', label: 'ICAO', numeric: false },
  { key: 'terminal_name', label: 'Terminal Name', numeric: false },
  { key: 'airlines', label: 'Airlines', numeric: false },
  { key: 'note', label: 'Note', numeric: false },
  { key: 'spot_count', label: 'Parking Spots', numeric: true },
  { key: 'is_active', label: 'Enabled', numeric: false },
] as const;

type TerminalColumnKey = (typeof COLUMNS)[number]['key'];
type SortDirection = 'asc' | 'desc';

const EMPTY_FILTERS = Object.fromEntries(COLUMNS.map((column) => [column.key, ''])) as Record<
  TerminalColumnKey,
  string
>;

/** Data Management > Airport Terminals: the terminals and their airlines of the public Airport Parking section. */
@Component({
  selector: 'app-airport-terminals-manage',
  standalone: true,
  imports: [
    PopupMessageComponent,
    TablePaginationComponent,
    CommonModule,
    ReactiveFormsModule,
    PlaceholderBannerDataManagementComponent,
  ],
  templateUrl: './airport-terminals-manage.html',
})
export class AirportTerminalsManageComponent implements OnInit {
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
  readonly maxTerminalNameLength = MAX_TERMINAL_NAME_LENGTH;
  readonly maxAirlinesLength = MAX_AIRLINES_LENGTH;
  readonly maxNoteLength = MAX_PARKING_NOTE_LENGTH;
  readonly invalidIcaoMessage = 'Enter the 4-letter ICAO code of the airport, for example RPLL.';
  readonly invalidAirlinesMessage = AIRLINE_CODES_MESSAGE;

  readonly form = this.fb.nonNullable.group({
    airport_icao: ['', [Validators.required, Validators.pattern(ICAO_PATTERN)]],
    terminal_name: ['', [Validators.required, Validators.maxLength(MAX_TERMINAL_NAME_LENGTH)]],
    airlines: ['', [Validators.maxLength(MAX_AIRLINES_LENGTH), Validators.pattern(AIRLINE_CODES_PATTERN)]],
    note: ['', [Validators.maxLength(MAX_PARKING_NOTE_LENGTH)]],
    is_active: [false],
  });

  terminals: TerminalRow[] = [];
  /** The terminals that pass the filters, sorted (rebuilt only when the list, a filter or the order changes). */
  visibleTerminals: TerminalRow[] = [];
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
  columnFilters: Record<TerminalColumnKey, string> = { ...EMPTY_FILTERS };

  sortColumn: TerminalColumnKey = 'airport_icao';
  sortDirection: SortDirection = 'asc';

  ngOnInit(): void {
    this.loadTerminals();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value);
  }

  showInvalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  /** The text a column shows, which is also what its filter searches and its sort compares. */
  cellText(item: TerminalRow, column: TerminalColumnKey): string {
    if (column === 'is_active') {
      return item.is_active ? 'Yes' : 'No';
    }

    return String(item[column] ?? '');
  }

  loadTerminals(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.loadFailed = false;
    this.http.get<TerminalRow[]>(TERMINALS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.terminals = Array.isArray(rows) ? rows : [];
        this.applyView();
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.loadFailed = true;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('terminals'));
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

  edit(item: TerminalRow): void {
    this.resetForm();
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';
    this.form.setValue({
      airport_icao: item.airport_icao,
      terminal_name: item.terminal_name,
      airlines: item.airlines ?? '',
      note: item.note ?? '',
      is_active: item.is_active,
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
    this.form.controls.airport_icao.setValue(icao);
  }

  save(): void {
    this.errorMessage = '';
    this.successMessage = '';

    const value = this.form.getRawValue();
    // A name of spaces only is no name.
    if (!value.terminal_name.trim()) {
      this.form.controls.terminal_name.setValue('');
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = {
      airport_icao: value.airport_icao,
      terminal_name: value.terminal_name.trim(),
      airlines: value.airlines.trim(),
      note: value.note.trim(),
      is_active: value.is_active,
    };

    const isEdit = this.editingId !== null;
    const headers = this.authService.getAdminApiHeaders();
    const request = isEdit
      ? this.http.put(`${TERMINALS_API}/${this.editingId}`, payload, { headers })
      : this.http.post(TERMINALS_API, payload, { headers });

    this.isSaving = true;
    request.subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = isEdit
          ? DATA_MANAGE_MESSAGES.updated('Terminal')
          : DATA_MANAGE_MESSAGES.added('Terminal');
        this.isModalOpen = false;
        this.resetForm();
        this.loadTerminals();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(
          error,
          isEdit ? 'Unable to update terminal.' : 'Unable to add terminal.',
        );
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  async deleteTerminal(): Promise<void> {
    const terminal = this.terminals.find((item) => item.id === this.editingId);
    if (!terminal) {
      return;
    }

    const shouldDelete = await this.popups.ask({
      title: 'Delete Terminal',
      message: DATA_MANAGE_MESSAGES.confirmDelete(`${terminal.airport_icao} ${terminal.terminal_name}`),
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
    this.http.delete(`${TERMINALS_API}/${terminal.id}`, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = DATA_MANAGE_MESSAGES.deleted('Terminal');
        this.isModalOpen = false;
        this.resetForm();
        this.loadTerminals();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(error, 'Unable to delete terminal.');
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
      .get(`${TERMINALS_API}/export-template`, {
        headers: this.authService.getAdminApiHeaders(),
        responseType: 'blob',
        observe: 'response',
      })
      .subscribe({
        next: (response) => {
          const name = this.templateService.getExportFilenameFromDisposition(
            response.headers.get('content-disposition'),
            'airport-terminals-template.csv',
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
    this.templateService.downloadCsv(`airport-terminals-template-${this.templateService.getCurrentDateStamp()}.csv`, [
      TEMPLATE_HEADERS,
      ...this.terminals.map((row) =>
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
        .post(`${TERMINALS_API}/import-template`, { rows }, { headers: this.authService.getAdminApiHeaders() })
        .subscribe({
          next: () => {
            this.isTemplateUploading = false;
            this.isTemplateUpdatedModalOpen = true;
            this.loadTerminals();
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

  setColumnFilter(column: TerminalColumnKey, value: string): void {
    this.columnFilters[column] = value;
    this.applyView();
  }

  clearFilters(): void {
    this.columnFilters = { ...EMPTY_FILTERS };
    this.applyView();
  }

  toggleSort(column: TerminalColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applyView();
  }

  getSortIndicator(column: TerminalColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  private applyView(): void {
    const filters = COLUMNS.map(({ key }) => ({ key, text: this.columnFilters[key].trim().toLowerCase() })).filter(
      (filter) => filter.text,
    );
    const filtered = this.terminals.filter((item) =>
      filters.every(({ key, text }) => this.cellText(item, key).toLowerCase().includes(text)),
    );

    const column = COLUMNS.find(({ key }) => key === this.sortColumn)!;
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    this.visibleTerminals = filtered.sort(
      (left, right) =>
        direction *
        (column.numeric
          ? Number(left[column.key]) - Number(right[column.key])
          : collator.compare(this.cellText(left, column.key), this.cellText(right, column.key))),
    );
  }

  private resetForm(): void {
    this.editingId = null;
    this.form.reset({ airport_icao: '', terminal_name: '', airlines: '', note: '', is_active: false });
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
