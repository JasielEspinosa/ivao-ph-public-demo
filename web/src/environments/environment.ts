// Use the host the page was opened from, so the app also works from another computer on the network (http://<this-pc-ip>:4200).
const apiHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';

export const environment = {
  production: false,
  // true = visitors on an unsupported browser see the "browser not supported" page instead of the app (see shared/browser-support.ts).
  browserBlockerEnabled: true,
  // false = the "Forgot password?" link is hidden on the login page (the page and API stay in place for when email is back).
  forgotPasswordEnabled: false,
  apiUrl: `http://${apiHost}:3005/api`,
  adminAuthApi: `http://${apiHost}:3005/api/admin-auth`,
  sessionStorageKey: 'ivao_admin_session_v1',
  revalidateIntervalMs: 60 * 1000,
  apiAuth: {
    username: 'admin',
    password: 'admin',
  },
};
