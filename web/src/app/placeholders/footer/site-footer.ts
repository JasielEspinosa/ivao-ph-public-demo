import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The footer on every page: IVAO + IVAO Philippines logos, copyright with the current year, and the Privacy Policy link. */
@Component({
  selector: 'app-site-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.css',
})
export class SiteFooterComponent {
  /** Read once per page load, so the year is never hard-coded. */
  readonly year = new Date().getFullYear();
}
