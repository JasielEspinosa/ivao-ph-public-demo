import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../environments/environment';

/**
 * Public demo only: GitHub Pages has no backend, so answer the API calls listed here
 * with the dummy JSON files in `public/demo/` (served next to the site, so the URL is
 * relative to the page's base href).
 */
const DEMO_RESPONSES: Record<string, string> = {
  '/members': 'demo/members.json',
};

export const demoDataInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET') {
    return next(req);
  }

  const apiBase = environment.apiUrl.replace(/\/$/, '');
  const path = req.url.startsWith(apiBase) ? req.url.slice(apiBase.length) : null;
  const file = path === null ? undefined : DEMO_RESPONSES[path.split('?')[0]];

  // Drop the API credentials: the static file needs none.
  return next(file ? req.clone({ url: file, headers: req.headers.delete('Authorization') }) : req);
};
