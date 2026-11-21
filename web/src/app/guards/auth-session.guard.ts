import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { map } from 'rxjs';

import { AdminAuthService } from '../services/admin-auth.service';

export const authSessionGuard: CanActivateFn = () => {
  const authService = inject(AdminAuthService);
  const router = inject(Router);

  return authService
    .revalidateSession(true)
    .pipe(map((isValid) => (isValid ? true : router.createUrlTree(['/login']))));
};
