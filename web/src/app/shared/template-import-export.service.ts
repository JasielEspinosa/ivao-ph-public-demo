import { Injectable } from '@angular/core';
import { Workbook } from 'exceljs';

@Injectable({ providedIn: 'root' })
export class TemplateImportExportService {
  async parseTemplateFile(file: File, expectedHeaders: readonly string[]): Promise<string[][]> {
    const extension = String(file.name.split('.').pop() || '').toLowerCase();
    if (extension === 'csv') {
      return this.parseCsvTemplate(await file.text(), expectedHeaders);
    }
    if (extension !== 'xlsx' && extension !== 'xlsm') {
      throw new Error('Unsupported file type. Use .xlsx, .xlsm, or .csv.');
    }

    const workbook = new Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('Template file does not contain a worksheet.');
    }

    const headers = expectedHeaders.map((_, index) =>
      this.normalizeCell(worksheet.getRow(1).getCell(index + 1).value).toLowerCase(),
    );
    this.ensureHeaders(headers, expectedHeaders);
    const rows: string[][] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const values = expectedHeaders.map((_, index) =>
        this.normalizeCell(worksheet.getRow(rowNumber).getCell(index + 1).value),
      );
      if (values.some(Boolean)) {
        rows.push(values);
      }
    }
    return rows;
  }

  downloadCsv(fileName: string, rows: readonly (readonly string[])[]): void {
    const csvBody = rows.map((row) => row.map((cell) => this.escapeCsvCell(cell)).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(fileName, blob);
  }

  getExportFilenameFromDisposition(contentDisposition: string | null, fallbackName: string): string {
    const match = String(contentDisposition || '').match(/filename\*?=(?:UTF-8''|\")?([^\";\n\r]+)/i);
    if (!match?.[1]) {
      return fallbackName;
    }
    return decodeURIComponent(match[1]).replace(/^"|"$/g, '').trim() || fallbackName;
  }

  getCurrentDateStamp(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  private parseCsvTemplate(csvText: string, expectedHeaders: readonly string[]): string[][] {
    const parsedRows = this.parseCsvRows(csvText)
      .map((row) => row.map((cell) => String(cell || '').trim()))
      .filter((row) => row.length > 0 && row.some((cell) => cell !== ''));
    if (!parsedRows.length) {
      throw new Error('Template file is empty.');
    }
    this.ensureHeaders(
      parsedRows[0].map((header) => header.toLowerCase()),
      expectedHeaders,
    );
    return parsedRows
      .slice(1)
      .filter((row) => row.some(Boolean))
      .map((row) => expectedHeaders.map((_, index) => row[index] || ''));
  }

  private ensureHeaders(headers: string[], expectedHeaders: readonly string[]): void {
    for (let index = 0; index < expectedHeaders.length; index += 1) {
      if (headers[index] !== expectedHeaders[index]) {
        throw new Error(`Invalid template headers. Expected: ${expectedHeaders.join(', ')}`);
      }
    }
  }

  private parseCsvRows(input: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      const next = input[index + 1];
      if (char === '"') {
        if (quoted && next === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  private normalizeCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && value && 'text' in (value as Record<string, unknown>)) {
      return String((value as { text?: unknown }).text || '').trim();
    }
    return String(value).trim();
  }

  private escapeCsvCell(value: string): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadBlob(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }
}
