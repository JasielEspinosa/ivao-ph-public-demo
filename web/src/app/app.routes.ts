import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login';
import { adminRoleGuard } from './guards/admin-role.guard';
import { authSessionGuard } from './guards/auth-session.guard';
import { dataManagementAccessGuard } from './guards/data-management-access.guard';

// Public pages (no sign-in): home, members, pilots-lounge, documents, privacy-policy, login, forgot-password, set-password.
// Signed-in pages: profile-settings (any user), data-management (+ its pages, by access code) and the admin pages (admins).
// Keep the public list in sync with AdminAuthService.isPublicRoute.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },

  {
    path: 'home',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomeComponent),
  },
  {
    path: 'members',
    loadComponent: () => import('./pages/members/members').then((m) => m.MembersComponent),
  },
  {
    path: 'pilots-lounge',
    loadComponent: () => import('./pages/pilots-lounge/pilots-lounge').then((m) => m.PilotsLoungeComponent),
  },
  {
    path: 'documents',
    loadComponent: () => import('./pages/documents/documents').then((m) => m.DocumentsComponent),
  },
  {
    path: 'privacy-policy',
    loadComponent: () => import('./pages/privacy-policy/privacy-policy').then((m) => m.PrivacyPolicyComponent),
  },

  { path: 'login', component: LoginComponent },
  {
    path: 'set-password',
    loadComponent: () => import('./pages/login/set-password/set-password').then((m) => m.SetPasswordComponent),
  },
  {
    // The page stays in place, but the login page hides its link while email sending is off (forgotPasswordEnabled).
    path: 'forgot-password',
    loadComponent: () => import('./pages/login/forgot-password/forgot-password').then((m) => m.ForgotPasswordComponent),
  },

  {
    path: 'profile-settings',
    loadComponent: () => import('./pages/profile-settings/profile-settings').then((m) => m.ProfileSettingsComponent),
    canActivate: [authSessionGuard],
  },

  {
    path: 'admin-settings',
    loadComponent: () => import('./pages/menu/admin-settings/admin-settings').then((m) => m.AdminSettingsComponent),
    canActivate: [adminRoleGuard],
  },
  {
    path: 'admin/manage_user',
    loadComponent: () => import('./pages/admin/manage_user/manage_user').then((m) => m.ManageUserComponent),
    canActivate: [adminRoleGuard],
  },
  {
    path: 'admin/manage_user/:loginEmail',
    loadComponent: () => import('./pages/admin/manage_user/manage_user').then((m) => m.ManageUserComponent),
    canActivate: [adminRoleGuard],
  },
  {
    path: 'admin/manage_users',
    loadComponent: () => import('./pages/admin/manage_users/manage_users').then((m) => m.ManageUsersComponent),
    canActivate: [adminRoleGuard],
  },

  {
    path: 'data-management',
    loadComponent: () => import('./pages/menu/data-management/data-management').then((m) => m.DataManagementComponent),
    canActivate: [dataManagementAccessGuard],
  },
  {
    path: 'countries-manage',
    loadComponent: () =>
      import('./pages/data-management/countries/countries-manage').then((m) => m.CountriesManageComponent),
    canActivate: [dataManagementAccessGuard],
    data: { manageCode: 'COUNTRIES' },
  },
  {
    path: 'members-manage',
    loadComponent: () => import('./pages/data-management/members/members-manage').then((m) => m.MembersManageComponent),
    canActivate: [dataManagementAccessGuard],
    data: { manageCode: 'MEMBERS' },
  },

  { path: '**', redirectTo: 'home' },
];
