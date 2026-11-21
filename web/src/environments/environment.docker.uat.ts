export const environment = {
  production: true,
  // true = visitors on an unsupported browser see the "browser not supported" page instead of the app (see shared/browser-support.ts).
  browserBlockerEnabled: true,
  // false = the "Forgot password?" link is hidden on the login page (the page and API stay in place for when email is back).
  forgotPasswordEnabled: false,
  apiUrl: 'api',
  adminAuthApi: 'api/admin-auth',
  sessionStorageKey: 'ivao_admin_session_v1',
  revalidateIntervalMs: 60 * 1000,
  apiAuth: {
    username: 'admin',
    password: 'admin',
  },
};
