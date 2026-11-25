import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Pagination state for a table. Call `slice()` from the template's `*ngFor`
 * (`let row of pager.slice(filteredRows)`) so the page always follows the
 * current filtered/sorted list. Exports should keep using the full list.
 */
export class TablePagination {
  readonly pageSizeOptions = TABLE_PAGE_SIZE_OPTIONS;
  page = 0;
  pageSize: number;
  total = 0;
  private lastTotal = -1;

  constructor(defaultPageSize: number = DEFAULT_PAGE_SIZE) {
    this.pageSize = defaultPageSize;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  get isFirst(): boolean {
    return this.page <= 0;
  }

  get isLast(): boolean {
    return this.page >= this.pageCount - 1;
  }

  get rangeStart(): number {
    return this.total ? this.page * this.pageSize + 1 : 0;
  }

  get rangeEnd(): number {
    return Math.min(this.total, (this.page + 1) * this.pageSize);
  }

  /** Page indexes to show; `null` marks a gap ("…"). */
  get pageItems(): (number | null)[] {
    const last = this.pageCount - 1;
    const wanted = new Set([0, last, this.page - 1, this.page, this.page + 1]);
    const indexes = [...wanted].filter((index) => index >= 0 && index <= last).sort((a, b) => a - b);
    const items: (number | null)[] = [];
    indexes.forEach((index, position) => {
      if (position > 0 && index - indexes[position - 1] > 1) {
        items.push(null);
      }
      items.push(index);
    });
    return items;
  }

  /** Returns the rows of the current page; goes back to page 1 when the row count changes. */
  slice<T>(items: readonly T[]): T[] {
    this.total = items.length;
    if (this.total !== this.lastTotal) {
      this.lastTotal = this.total;
      this.page = 0;
    }
    this.page = Math.min(this.page, this.pageCount - 1);
    const start = this.page * this.pageSize;
    return items.slice(start, start + this.pageSize);
  }

  goTo(page: number): void {
    this.page = Math.min(Math.max(0, page), this.pageCount - 1);
  }

  setPageSize(size: number): void {
    if (!TABLE_PAGE_SIZE_OPTIONS.includes(size as (typeof TABLE_PAGE_SIZE_OPTIONS)[number])) {
      return;
    }
    this.pageSize = size;
    this.page = 0;
  }
}

@Component({
  selector: 'app-table-pagination',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './table-pagination.html',
  // The pager is one object that changes in place (filtering, searching, the other pagination bar of the table), which the
  // default OnPush strategy would not see: check it whenever the page that holds it is checked.
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class TablePaginationComponent {
  @Input({ required: true }) pager!: TablePagination;

  onPageSizeChange(event: Event): void {
    this.pager.setPageSize(Number((event.target as HTMLSelectElement).value));
  }
}
