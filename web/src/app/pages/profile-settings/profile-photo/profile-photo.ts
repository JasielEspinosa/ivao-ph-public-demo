import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, Input, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

import { AdminAuthService } from '../../../services/admin-auth.service';
import { AuthImageDirective } from '../../../shared/auth-image';
import { PopupMessageComponent } from '../../../shared/popup/popup-message';
import { PopupService } from '../../../shared/popup/popup.service';
import {
  AVATAR_SIZE,
  PORTRAIT_SIZE,
  PROFILE_PHOTO_MIN_SIZE,
  PROFILE_PHOTO_RULES,
  PROFILE_PHOTO_SMALL_MESSAGE,
  PROFILE_PHOTO_UNREADABLE_MESSAGE,
  cropToJpeg,
  getOwnPhotoUrl,
  loadPicture,
} from '../../../shared/profile-photo';
import { NETWORK_UNAVAILABLE_MESSAGE } from '../../../shared/submit-error-utils';
import { getAcceptAttribute, getUploadFileError } from '../../../shared/upload-files';
import { PhotoCropperComponent } from './photo-cropper';

/**
 * The profile picture at the top of Profile Settings: the circle, the Upload / Change and Remove buttons, and the window
 * where the chosen picture is adjusted to the "Head to chest" (4:5) and profile picture (1:1) frames before saving.
 */
@Component({
  selector: 'app-profile-photo',
  standalone: true,
  imports: [AuthImageDirective, PhotoCropperComponent, PopupMessageComponent],
  templateUrl: './profile-photo.html',
  styleUrl: './profile-photo.css',
})
export class ProfilePhotoComponent implements OnDestroy {
  /** Shown in the circle while there is no photo. */
  @Input() initials = '';

  private readonly authService = inject(AdminAuthService);
  private readonly popups = inject(PopupService);

  readonly accept = getAcceptAttribute(PROFILE_PHOTO_RULES);
  readonly helperText = PROFILE_PHOTO_RULES.helperText;
  readonly portraitAspect = PORTRAIT_SIZE.width / PORTRAIT_SIZE.height;
  readonly avatarAspect = AVATAR_SIZE.width / AVATAR_SIZE.height;

  /** The chosen picture; the adjust window is open while there is one. */
  readonly picture = signal<HTMLImageElement | null>(null);
  readonly isBusy = signal(false);
  readonly successMessage = signal('');
  readonly errorMessage = signal('');

  @ViewChild('portraitCropper') private portraitCropper?: PhotoCropperComponent;
  @ViewChild('avatarCropper') private avatarCropper?: PhotoCropperComponent;

  /** Takes the keyboard focus when the window opens, so Escape closes it. */
  @ViewChild('dialog') set dialog(element: ElementRef<HTMLElement> | undefined) {
    element?.nativeElement.focus();
  }

  private isDestroyed = false;

  get photoUrl(): string {
    const version = this.authService.getCurrentUser()?.photo_version;
    return version ? getOwnPhotoUrl(version) : '';
  }

  async chooseFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // So choosing the same file again is noticed.
    input.value = '';
    if (!file) {
      return;
    }

    this.successMessage.set('');
    this.errorMessage.set(getUploadFileError(file, PROFILE_PHOTO_RULES));
    if (this.errorMessage()) {
      return;
    }

    this.isBusy.set(true);
    const image = await loadPicture(file);
    this.isBusy.set(false);

    if (!image) {
      this.errorMessage.set(PROFILE_PHOTO_UNREADABLE_MESSAGE);
      return;
    }

    const isTooSmall =
      image.naturalWidth < PROFILE_PHOTO_MIN_SIZE.width || image.naturalHeight < PROFILE_PHOTO_MIN_SIZE.height;
    if (isTooSmall || this.isDestroyed) {
      URL.revokeObjectURL(image.src);
      this.errorMessage.set(isTooSmall ? PROFILE_PHOTO_SMALL_MESSAGE : '');
      return;
    }

    this.picture.set(image);
  }

  cancel(): void {
    if (!this.isBusy()) {
      this.closeWindow();
    }
  }

  async save(): Promise<void> {
    const image = this.picture();
    if (!image || !this.portraitCropper || !this.avatarCropper || this.isBusy()) {
      return;
    }

    this.errorMessage.set('');
    this.isBusy.set(true);
    const [portrait, avatar] = await Promise.all([
      cropToJpeg(image, this.portraitCropper.area, PORTRAIT_SIZE),
      cropToJpeg(image, this.avatarCropper.area, AVATAR_SIZE),
    ]);

    if (!portrait || !avatar) {
      this.isBusy.set(false);
      this.errorMessage.set('The photo could not be processed. Choose another file.');
      return;
    }

    this.authService
      .uploadOwnPhoto(portrait, avatar)
      .pipe(finalize(() => this.isBusy.set(false)))
      .subscribe({
        next: () => {
          this.closeWindow();
          this.successMessage.set('Your profile photo was updated.');
        },
        error: (error: unknown) => this.showRequestError(error, 'save'),
      });
  }

  async remove(): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    const confirmed = await this.popups.ask({
      title: 'Remove Photo',
      message: 'Remove your profile photo? It is also removed from the Members and Contacts pages.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    this.successMessage.set('');
    this.errorMessage.set('');
    this.isBusy.set(true);
    this.authService
      .removeOwnPhoto()
      .pipe(finalize(() => this.isBusy.set(false)))
      .subscribe({
        next: () => this.successMessage.set('Your profile photo was removed.'),
        error: (error: unknown) => this.showRequestError(error, 'remove'),
      });
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.closeWindow();
  }

  private closeWindow(): void {
    const image = this.picture();
    if (image) {
      URL.revokeObjectURL(image.src);
      this.picture.set(null);
    }
  }

  private showRequestError(error: unknown, action: 'save' | 'remove'): void {
    const fallback = `Unable to ${action} your photo right now. Please try again.`;
    if (!(error instanceof HttpErrorResponse)) {
      this.errorMessage.set(fallback);
      return;
    }

    if (error.status === 0) {
      this.errorMessage.set(NETWORK_UNAVAILABLE_MESSAGE);
      return;
    }

    if (error.status === 401) {
      this.authService.logout();
    }

    const message = error.error?.message;
    const backendMessage = Array.isArray(message) ? message.join(' ') : String(message || '').trim();
    this.errorMessage.set(error.status === 400 && backendMessage ? backendMessage : fallback);
  }
}
