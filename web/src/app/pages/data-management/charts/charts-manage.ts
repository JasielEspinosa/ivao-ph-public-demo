import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PlaceholderBannerDataManagementComponent } from '../../../placeholders/banner/placeholder-banner-data-management';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { LINK_URL_ERROR, LINK_URL_MAX_LENGTH, linkUrlValidator } from '../../../shared/link-url';
import { injectCurrentPage } from '../../../shared/page-titles';
import { PHILIPPINE_AIRPORTS } from '../../../shared/philippine-airports';
import { QrUploadComponent } from '../../../shared/qr-upload/qr-upload';
import { buildSubmitErrorMessage } from '../../../shared/submit-error-utils';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import { CHART_RULES, formatFileSize, getAcceptAttribute, getUploadFileError } from '../../../shared/upload-files';
import { VALIDATION_MESSAGES } from '../../../shared/validation-messages';

const CHARTS_API = `${environment.apiUrl.replace(/\/$/, '')}/data-management/charts`;

interface ChartRow {
  id: number;
  airport_icao: string | null;
  chart_name: string;
  description: string | null;
  /** The page a link chart opens; null for a chart that holds a PDF. */
  link_url: string | null;
  /** The file fields are null for a link. */
  file_name: string | null;
  file_mimetype: string | null;
  file_size: number | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

type ChartColumnKey = 'id' | 'airport_icao' | 'chart_name' | 'file_name' | 'is_active';
type SortDirection = 'asc' | 'desc';
/** A chart is a PDF chosen on this device / sent from a phone, or a link to a page. */
type ChartSource = 'file' | 'link';

const EMPTY_FILTERS: Record<ChartColumnKey, string> = {
  id: '',
  airport_icao: '',
  chart_name: '',
  file_name: '',
  is_active: '',
};

/**
 * Data management page for the flight charts shown on the public Charts page: a PDF (chosen on this device or sent from
 * a phone through a QR code, up to 50 MB, kept in a folder on the server), its name, the (optional) airport it belongs to, an
 * optional description and the Enabled switch. Instead of a PDF a chart can be a link: the public page then sends the
 * visitor to that web address (it cannot be downloaded). Like Documents it has no template import/export: a file cannot
 * travel in a CSV.
 */
@Component({
  selector: 'app-charts-manage',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PlaceholderBannerDataManagementComponent,
    QrUploadComponent,
    TablePaginationComponent,
  ],
  templateUrl: './charts-manage.html',
})
export class ChartsManageComponent implements OnInit {
  readonly pager = new TablePagination();
  readonly page = injectCurrentPage();

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly VALIDATION_MESSAGES = VALIDATION_MESSAGES;
  readonly messages = DATA_MANAGE_MESSAGES;
  readonly airports = PHILIPPINE_AIRPORTS;
  readonly chartAccept = getAcceptAttribute(CHART_RULES);
  readonly chartHelperText = CHART_RULES.helperText;
  readonly formatFileSize = formatFileSize;
  readonly invalidIcaoMessage = 'Enter the 4-letter ICAO code of the airport, for example RPLL.';
  readonly linkUrlMaxLength = LINK_URL_MAX_LENGTH;
  readonly linkUrlErrorMessage = LINK_URL_ERROR;

  readonly form = this.fb.nonNullable.group({
    source: ['file' as ChartSource],
    // Off until "Link to a web page" is chosen; a disabled field is neither validated nor saved.
    link_url: [
      { value: '', disabled: true },
      [Validators.required, Validators.maxLength(LINK_URL_MAX_LENGTH), linkUrlValidator],
    ],
    chart_name: ['', [Validators.required, Validators.maxLength(255)]],
    // Optional: a chart may belong to no single airport.
    airport_icao: ['', [Validators.pattern(/^[A-Za-z]{4}$/)]],
    description: ['', [Validators.maxLength(1000)]],
    // A new chart is shown on the public Charts page right away; switch it off to keep it hidden.
    is_active: [true],
  });

  charts: ChartRow[] = [];
  editingId: number | null = null;
  /** The file chosen on this device or received from the phone; null keeps the saved file when editing. */
  selectedFile: File | null = null;
  fileTouched = false;
  isModalOpen = false;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';
  columnFilters: Record<ChartColumnKey, string> = { ...EMPTY_FILTERS };

  sortColumn: ChartColumnKey | null = 'airport_icao';
  sortDirection: SortDirection = 'asc';

  constructor() {
    this.form.controls.source.valueChanges.subscribe((value) => this.setLinkFieldEnabled(value === 'link'));
  }

  ngOnInit(): void {
    this.loadCharts();
  }

  get isEditMode(): boolean {
    return this.editingId !== null;
  }

  get editingChart(): ChartRow | undefined {
    return this.charts.find((item) => item.id === this.editingId);
  }

  get isLinkSource(): boolean {
    return this.form.controls.source.value === 'link';
  }

  /** The chart being edited holds a stored file (not a link): choosing a new file is then optional. */
  get hasSavedFile(): boolean {
    return !!this.editingChart?.file_name;
  }

  /**
   * Why the chosen file cannot be used ('' when it is fine, nothing was tried yet, or the chart is a link). A file is
   * required unless the chart being edited already holds one.
   */
  get fileErrorMessage(): string {
    if (!this.fileTouched || this.isLinkSource) {
      return '';
    }

    return getUploadFileError(this.selectedFile, CHART_RULES, this.hasSavedFile ? '' : VALIDATION_MESSAGES.required);
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value);
  }

  get filteredCharts(): ChartRow[] {
    const filters = {
      id: this.columnFilters.id.trim().toLowerCase(),
      airport_icao: this.columnFilters.airport_icao.trim().toLowerCase(),
      chart_name: this.columnFilters.chart_name.trim().toLowerCase(),
      file_name: this.columnFilters.file_name.trim().toLowerCase(),
      is_active: this.columnFilters.is_active.trim().toLowerCase(),
    };

    const filtered = this.charts.filter((item) => {
      if (filters.id && !String(item.id).includes(filters.id)) {
        return false;
      }
      if (filters.airport_icao && !(item.airport_icao ?? '').toLowerCase().includes(filters.airport_icao)) {
        return false;
      }
      if (filters.chart_name && !item.chart_name.toLowerCase().includes(filters.chart_name)) {
        return false;
      }
      if (filters.file_name && !this.formatFile(item).toLowerCase().includes(filters.file_name)) {
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
      if (sortColumn === 'is_active') {
        return (Number(left.is_active) - Number(right.is_active)) * directionMultiplier;
      }

      // A chart without an airport sorts as an empty text (first when ascending).
      const leftValue = sortColumn === 'file_name' ? this.formatFile(left) : (left[sortColumn] ?? '');
      const rightValue = sortColumn === 'file_name' ? this.formatFile(right) : (right[sortColumn] ?? '');
      return (
        leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' }) * directionMultiplier
      );
    });
  }

  /** "chart.pdf (1.2 MB)" for a file, or "Link: https://example.com" for a link. */
  formatFile(item: ChartRow): string {
    return item.link_url
      ? `Link: ${item.link_url}`
      : `${item.file_name ?? ''} (${formatFileSize(item.file_size ?? 0)})`;
  }

  loadCharts(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<ChartRow[]>(CHARTS_API, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: (rows) => {
        this.charts = Array.isArray(rows) ? rows : [];
        this.isLoading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading = false;
        this.errorMessage = this.buildErrorMessage(error, DATA_MANAGE_MESSAGES.unableToLoad('charts'));
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

  edit(item: ChartRow): void {
    this.resetForm();
    this.editingId = item.id;
    this.errorMessage = '';
    this.successMessage = '';
    // Setting the source first enables the link field (a link chart) or keeps it off (a file chart).
    this.form.setValue({
      source: item.link_url ? 'link' : 'file',
      link_url: item.link_url ?? '',
      chart_name: item.chart_name,
      airport_icao: item.airport_icao ?? '',
      description: item.description ?? '',
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

  onFileChange(file: File | null): void {
    this.selectedFile = file;
    this.fileTouched = true;
    this.changeDetectorRef.detectChanges();
  }

  /** The ICAO code is four letters in capitals: anything else typed or pasted is dropped. */
  onIcaoInput(input: HTMLInputElement): void {
    const icao = input.value
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4);
    input.value = icao;
    this.form.controls.airport_icao.setValue(icao);
  }

  showInvalid(controlName: 'airport_icao' | 'chart_name' | 'description' | 'link_url'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.touched || control.dirty);
  }

  save(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.fileTouched = true;
    if (this.form.invalid || this.fileErrorMessage) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const isLink = value.source === 'link';
    const chartName = value.chart_name.trim();
    if (!chartName) {
      this.form.controls.chart_name.setErrors({ required: true });
      this.form.controls.chart_name.markAsTouched();
      return;
    }

    // multipart/form-data: the text fields and, when one was chosen, the file.
    const body = new FormData();
    body.append('chart_name', chartName);
    // Always sent: an empty text tells the server this chart is a file (it drops a saved link).
    body.append('link_url', isLink ? value.link_url.trim() : '');
    // Always sent: an empty text clears the airport / description of a chart being edited.
    body.append('airport_icao', value.airport_icao.toUpperCase());
    body.append('description', value.description.trim());
    body.append('is_active', String(value.is_active));
    if (!isLink && this.selectedFile) {
      body.append('file', this.selectedFile, this.selectedFile.name);
    }

    const headers = this.authService.getAdminApiHeaders();
    const isEditing = this.editingId !== null;
    const request = isEditing
      ? this.http.put(`${CHARTS_API}/${this.editingId}`, body, { headers })
      : this.http.post(CHARTS_API, body, { headers });

    this.isSaving = true;
    request.subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = isEditing ? DATA_MANAGE_MESSAGES.updated('Chart') : DATA_MANAGE_MESSAGES.added('Chart');
        this.isModalOpen = false;
        this.resetForm();
        this.loadCharts();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(
          error,
          isEditing ? 'Unable to update chart.' : 'Unable to add chart.',
        );
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  deleteChart(): void {
    if (this.editingId === null) {
      return;
    }

    if (!window.confirm(DATA_MANAGE_MESSAGES.confirmDelete(this.editingChart?.chart_name ?? ''))) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.isSaving = true;
    this.http.delete(`${CHARTS_API}/${this.editingId}`, { headers: this.authService.getAdminApiHeaders() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = DATA_MANAGE_MESSAGES.deleted('Chart');
        this.isModalOpen = false;
        this.resetForm();
        this.loadCharts();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = this.buildErrorMessage(error, 'Unable to delete chart.');
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  setColumnFilter(column: ChartColumnKey, value: string): void {
    this.columnFilters[column] = value;
  }

  clearFilters(): void {
    this.columnFilters = { ...EMPTY_FILTERS };
  }

  toggleSort(column: ChartColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.sortColumn = column;
    this.sortDirection = 'asc';
  }

  getSortIndicator(column: ChartColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  /** Turns the link field on (required) or off (emptied, not validated, not saved). */
  private setLinkFieldEnabled(enabled: boolean): void {
    const { link_url } = this.form.controls;
    if (enabled) {
      link_url.enable({ emitEvent: false });
    } else {
      link_url.reset('', { emitEvent: false });
      link_url.disable({ emitEvent: false });
    }
  }

  private resetForm(): void {
    this.editingId = null;
    this.selectedFile = null;
    this.fileTouched = false;
    this.form.reset({
      source: 'file',
      link_url: '',
      chart_name: '',
      airport_icao: '',
      description: '',
      is_active: true,
    });
    this.setLinkFieldEnabled(false);
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private buildErrorMessage(error: HttpErrorResponse, fallback: string): string {
    return buildSubmitErrorMessage(error, { fallbackMessage: fallback });
  }
}
