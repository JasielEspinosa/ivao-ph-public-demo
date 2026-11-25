import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { PlaceholderBannerAdminComponent } from '../../../placeholders/banner/placeholder-banner-admin';
import { AdminAuthService } from '../../../services/admin-auth.service';
import { DATA_MANAGE_MESSAGES } from '../../../shared/data-manage-messages';
import { NETWORK_UNAVAILABLE_MESSAGE } from '../../../shared/submit-error-utils';
import { TablePagination, TablePaginationComponent } from '../../../shared/table-pagination/table-pagination';
import { environment } from '../../../../environments/environment';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';

interface AdminUserRow {
  login_email: string;
  login_name: string;
  nickname: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  vid: string;
  role_title: string;
  is_active: boolean;
  is_admin: boolean;
  manage_all_data: boolean;
  manage_data_codes: string[];
}

type AdminUserColumnKey = 'login_email' | 'name' | 'vid' | 'role_title' | 'is_active' | 'is_admin' | 'data_manage';
type SortDirection = 'asc' | 'desc';

const ADMIN_USERS_API = `${environment.apiUrl.replace(/\/$/, '')}/admin-users`;

@Component({
  selector: 'app-manage-users',
  standalone: true,
  imports: [PopupMessageComponent, CommonModule, TablePaginationComponent, PlaceholderBannerAdminComponent],
  templateUrl: './manage_users.html',
  styleUrl: './manage_users.css',
})
export class ManageUsersComponent implements OnInit {
  readonly pager = new TablePagination();
  readonly messages = DATA_MANAGE_MESSAGES;

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  users: AdminUserRow[] = [];
  columnFilters: Record<AdminUserColumnKey, string> = {
    login_email: '',
    name: '',
    vid: '',
    role_title: '',
    is_active: '',
    is_admin: '',
    data_manage: '',
  };
  sortColumn: AdminUserColumnKey | null = 'name';
  sortDirection: SortDirection = 'asc';
  isLoading = false;
  errorMessage = '';

  constructor() {
    this.title.setTitle('IVAO Philippines - Manage Users');
  }

  ngOnInit(): void {
    this.loadUsers();
  }

  addUser(): void {
    this.router.navigate(['/admin/manage_user']);
  }

  // Only the Administrator can edit the "admin" record; other admin users get a view-only page.
  isViewOnly(loginEmail: string): boolean {
    const isTargetAdmin =
      String(loginEmail || '')
        .trim()
        .toLowerCase() === 'admin';
    const currentLogin = String(this.authService.getCurrentUser()?.login_email || '')
      .trim()
      .toLowerCase();

    return isTargetAdmin && currentLogin !== 'admin';
  }

  editUser(loginEmail: string): void {
    this.router.navigate(['/admin/manage_user', encodeURIComponent(loginEmail)]);
  }

  get filteredUsers(): AdminUserRow[] {
    const activeFilters = Object.entries(this.columnFilters) as [AdminUserColumnKey, string][];

    const filteredUsers = this.users.filter((user) =>
      activeFilters.every(([column, filterValue]) => {
        const normalizedFilter = filterValue.trim().toLowerCase();

        if (!normalizedFilter) {
          return true;
        }

        return this.getColumnValue(user, column).toLowerCase().includes(normalizedFilter);
      }),
    );

    if (!this.sortColumn) {
      return filteredUsers;
    }

    const sortColumn = this.sortColumn;
    const directionMultiplier = this.sortDirection === 'asc' ? 1 : -1;

    return [...filteredUsers].sort((a, b) => {
      const aValue = this.getSortValue(a, sortColumn);
      const bValue = this.getSortValue(b, sortColumn);

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * directionMultiplier;
      }

      return (
        String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' }) *
        directionMultiplier
      );
    });
  }

  get hasActiveFilters(): boolean {
    return Object.values(this.columnFilters).some((value) => value.trim().length > 0);
  }

  setColumnFilter(column: AdminUserColumnKey, value: string): void {
    this.columnFilters[column] = value;
  }

  clearFilters(): void {
    this.columnFilters = {
      login_email: '',
      name: '',
      vid: '',
      role_title: '',
      is_active: '',
      is_admin: '',
      data_manage: '',
    };
  }

  toggleSort(column: AdminUserColumnKey): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    this.sortColumn = column;
    this.sortDirection = 'asc';
  }

  getSortIndicator(column: AdminUserColumnKey): string {
    if (this.sortColumn !== column) {
      return '';
    }

    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  private loadUsers(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http
      .get<AdminUserRow[]>(ADMIN_USERS_API, {
        headers: this.authService.getAdminApiHeaders(),
      })
      .subscribe({
        next: (rows) => {
          this.users = rows;
          this.isLoading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading = false;

          if (error.status === 401) {
            this.authService.logout();
            this.changeDetectorRef.detectChanges();
            return;
          }

          this.errorMessage =
            error.status === 0 ? NETWORK_UNAVAILABLE_MESSAGE : DATA_MANAGE_MESSAGES.unableToLoad('admin users');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  private getColumnValue(user: AdminUserRow, column: AdminUserColumnKey): string {
    switch (column) {
      case 'login_email':
        return user.login_email || '';
      case 'name':
        return this.getDisplayName(user);
      case 'vid':
        return user.vid || '';
      case 'role_title':
        return user.role_title || '';
      case 'is_active':
        return user.is_active ? 'enabled' : 'disabled';
      case 'is_admin':
        return user.is_admin ? 'yes' : 'no';
      case 'data_manage':
        return this.getDataManageValue(user);
      default:
        return '';
    }
  }

  private getSortValue(user: AdminUserRow, column: AdminUserColumnKey): string | number {
    if (column === 'is_admin') {
      return user.is_admin ? 1 : 0;
    }

    if (column === 'data_manage') {
      return this.getAccessSortValue(Boolean(user.manage_all_data), user.manage_data_codes);
    }

    return this.getColumnValue(user, column);
  }

  getDisplayName(user: AdminUserRow): string {
    const nickname = String(user.nickname || '').trim();
    const firstName = String(user.first_name || '').trim();
    const middleName = String(user.middle_name || '').trim();
    const lastName = String(user.last_name || '').trim();
    const suffix = String(user.suffix || '').trim();

    if (nickname) {
      return nickname;
    }

    const middleInitial = middleName ? `${middleName.charAt(0).toUpperCase()}.` : '';

    const fullName = [firstName, middleInitial, lastName].filter((part) => part.length > 0).join(' ');

    if (fullName && suffix) {
      return `${fullName}, ${suffix}`;
    }

    if (fullName) {
      return fullName;
    }

    return String(user.login_name || '').trim();
  }

  getDataManageValue(user: AdminUserRow): string {
    return this.getAccessDisplayValue(Boolean(user.manage_all_data), user.manage_data_codes);
  }

  private getAccessDisplayValue(allPages: boolean, codes: string[] | null | undefined): string {
    if (allPages) {
      return 'All Pages';
    }

    const count = Array.isArray(codes) ? codes.length : 0;
    return count > 0 ? String(count) : 'None';
  }

  private getAccessSortValue(allPages: boolean, codes: string[] | null | undefined): string | number {
    if (allPages) {
      return Number.MAX_SAFE_INTEGER;
    }

    const count = Array.isArray(codes) ? codes.length : 0;
    return count;
  }
}
