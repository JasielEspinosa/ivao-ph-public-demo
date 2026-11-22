import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { PlaceholderBannerComponent } from '../../placeholders/banner/placeholder-banner';

/**
 * Privacy Policy page. The text below is a DRAFT outline of what this website actually does today; it has not been
 * reviewed by the division's staff or IVAO HQ and must be replaced with the approved policy before launch.
 */
@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [PlaceholderBannerComponent],
  template: `
    <section class="home-shell">
      <div class="form-shell policy-page">
        <app-placeholder-banner title="Privacy Policy" subheading="IVAO PHILIPPINES"></app-placeholder-banner>

        <p class="policy-draft" role="note">
          Draft text. This policy is a placeholder until it is reviewed and approved by IVAO Philippines staff.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Members list:</strong> the VID, name, country, division and, for staff, the role of members who are
            listed on the Members page.
          </li>
          <li>
            <strong>Staff accounts:</strong> the login email, name and password (stored encrypted) of the people who
            manage this website.
          </li>
          <li>
            <strong>Your browser:</strong> your sign-in session and your Light / Dark / System theme choice are kept in
            your browser's local storage. We do not use advertising cookies.
          </li>
        </ul>

        <h2>How we use it</h2>
        <p>
          We use this information only to run the IVAO Philippines website: to show the Members page, to let staff sign
          in and manage the site, and to remember your display preferences.
        </p>

        <h2>Sharing</h2>
        <p>We do not sell personal information. The Members page is public, so anyone can see what it lists.</p>

        <h2>Your choices</h2>
        <p>
          To change or remove your listing on the Members page, or to ask about the information we hold, contact an IVAO
          Philippines staff member.
        </p>
      </div>
    </section>
  `,
  styles: `
    .policy-page {
      font-family: 'IVAO Sans', inherit, sans-serif;
      color: var(--c-slate-800);
      line-height: 1.6;
    }

    .policy-page > :not(app-placeholder-banner) {
      max-width: 52rem;
    }

    h2 {
      margin: 1.75rem 0 0.5rem;
      color: var(--c-brand-ink);
      font-size: 1.35rem;
    }

    p,
    li {
      color: var(--c-slate-700);
    }

    .policy-draft {
      margin: 0 0 1rem;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--c-warning-line);
      border-radius: 8px;
      background: var(--c-warning-wash);
      color: var(--c-warning);
      font-weight: 600;
    }
  `,
})
export class PrivacyPolicyComponent {
  private readonly title = inject(Title);

  constructor() {
    this.title.setTitle('IVAO Philippines - Privacy Policy');
  }
}
