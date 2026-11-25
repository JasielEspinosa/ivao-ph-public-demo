import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { map } from 'rxjs';

import { AdminAuthService } from '../services/admin-auth.service';

/**
 * Data Management pages. The route's `manageCode` (e.g. MEMBERS) must be one the user may open (event approvers may
 * also open EVENTS); the Data Management menu itself (no manageCode) opens only for a user with access to at least one
 * page. Visitors go to the login page.
 */
export const dataManagementAccessGuard: CanActivateFn = (route) => {
  const authService = inject(AdminAuthService);
  const router = inject(Router);
  const manageCode = String(route.data?.['manageCode'] || '')
    .trim()
    .toUpperCase();

  return authService.revalidateSession(true).pipe(
    map((isValid) => {
      if (!isValid) {
        return router.createUrlTree(['/login']);
      }

      const hasAccess = manageCode
        ? authService.canOpenDataManagementPage(manageCode)
        : authService.hasDataManagementAccess();

      return hasAccess ? true : router.createUrlTree(['/home']);
    }),
  );
};
