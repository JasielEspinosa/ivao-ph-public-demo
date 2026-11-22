import { Component } from '@angular/core';
import { SUPPORTED_BROWSER_NAMES } from '../../shared/browser-support';

@Component({
  selector: 'app-root', // bootstrapped in place of App (index.html hosts <app-root>)
  template: `
    <main class="bns-page">
      <section class="bns-card" role="alert">
        <h1 class="bns-title">This browser is not yet supported</h1>
        <p>
          Sorry, the IVAO Philippines website does not support this browser at this time. We are working on it and
          appreciate your patience.
        </p>
        <p>
          Please open this page in one of the supported browsers:
          @for (name of supportedBrowsers; track name; let last = $last) {
            <strong>{{ name }}</strong
            >{{ last ? '.' : ', ' }}
          }
        </p>
        <p class="bns-note">Thank you for your understanding.</p>
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      font-family: 'IVAO Sans', inherit, sans-serif;
    }

    .bns-page {
      min-height: 100dvh;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: #f2f6fa;
    }

    .bns-card {
      width: 100%;
      max-width: 560px;
      box-sizing: border-box;
      padding: 32px;
      text-align: center;
      line-height: 1.5;
      color: #1f2d3a;
      background: #fff;
      border-top: 6px solid #004987;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgb(0 0 0 / 12%);
    }

    .bns-title {
      margin: 0 0 16px;
      font-size: 1.5rem;
      color: #004987;
    }

    .bns-card p {
      margin: 0 0 12px;
    }

    .bns-note {
      margin-bottom: 0;
      color: #5b6b7a;
    }
  `,
})
export class BrowserNotSupportedComponent {
  readonly supportedBrowsers = SUPPORTED_BROWSER_NAMES;
}
