import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { map } from 'rxjs';

import { AdminAuthService } from '../services/admin-auth.service';

export const adminRoleGuard: CanActivateFn = () => {
  const authService = inject(AdminAuthService);
  const router = inject(Router);

  return authService.revalidateSession(true).pipe(
    map((isValid) => {
      if (!isValid) {
        return router.createUrlTree(['/login']);
      }

      if (!authService.hasAdminRole()) {
        return router.createUrlTree(['/home']);
      }

      return true;
    }),
  );
};
