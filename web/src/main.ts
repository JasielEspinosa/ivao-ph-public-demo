import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { BrowserNotSupportedComponent } from './app/pages/browser-not-supported/browser-not-supported';
import { shouldBlockBrowser } from './app/shared/browser-support';

// Unsupported browser with the blocker enabled: show the notice instead of starting the app, so no page or API call runs.
const bootstrap = shouldBlockBrowser()
  ? bootstrapApplication(BrowserNotSupportedComponent)
  : bootstrapApplication(App, appConfig);

bootstrap.catch((err) => console.error(err));
