import { environment } from '../../environments/environment';
import { UploadRules } from './upload-files';

/**
 * The profile photo of Profile Settings. The picture the user chooses stays on their device: two crops of it are drawn
 * in the browser and uploaded as JPEG files of a fixed size. The backend checks them again (`admin-auth/profile-photo.ts`).
 */
export const PROFILE_PHOTO_RULES: UploadRules = {
  extensions: ['jpg', 'jpeg', 'png', 'webp'],
  maxBytes: 10 * 1024 * 1024,
  typeMessage: 'The photo must be a JPG, PNG or WebP file.',
  sizeMessage: 'The photo must be 10 MB or smaller.',
  helperText: 'JPG, PNG or WebP, up to 10 MB, at least 600 x 750 pixels',
};

/** The chosen picture must be at least this big (px), so both crops stay sharp. */
export const PROFILE_PHOTO_MIN_SIZE = { width: 600, height: 750 } as const;
export const PROFILE_PHOTO_SMALL_MESSAGE = `The photo must be at least ${PROFILE_PHOTO_MIN_SIZE.width} x ${PROFILE_PHOTO_MIN_SIZE.height} pixels.`;
export const PROFILE_PHOTO_UNREADABLE_MESSAGE = 'The photo could not be read. Choose another file.';

export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/** The "Head to chest" picture (4:5) on the Staff cards of the Members page. */
export const PORTRAIT_SIZE: PictureSize = { width: 800, height: 1000 };
/** The profile picture (1:1), shown in a circle. */
export const AVATAR_SIZE: PictureSize = { width: 800, height: 800 };

/** A part of a picture, in the picture's own pixels. */
export interface CropArea extends PictureSize {
  readonly x: number;
  readonly y: number;
}

/** The address of a staff member's "Head to chest" picture; the version changes with every upload. */
export function getStaffPhotoUrl(vid: string, version: string): string {
  const api = environment.apiUrl.replace(/\/$/, '');
  return `${api}/members/${encodeURIComponent(vid)}/photo?v=${encodeURIComponent(version)}`;
}

/** The address of a contact's round profile picture (Contacts page). */
export function getStaffAvatarUrl(vid: string, version: string): string {
  const api = environment.apiUrl.replace(/\/$/, '');
  return `${api}/members/${encodeURIComponent(vid)}/avatar?v=${encodeURIComponent(version)}`;
}

/** The address of the signed-in user's own profile picture. */
export function getOwnPhotoUrl(version: string): string {
  return `${environment.adminAuthApi}/profile/photo?v=${encodeURIComponent(version)}`;
}

/**
 * Reads a picture file, or null when the browser cannot show it. The picture keeps its object URL (it is shown while
 * being cropped): release it with `URL.revokeObjectURL(image.src)` when done.
 */
export function loadPicture(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      resolve(null);
    };
    image.src = URL.createObjectURL(file);
  });
}

/** Draws that part of the picture as a JPEG of the given size, or null when the browser cannot. */
export function cropToJpeg(image: HTMLImageElement, area: CropArea, size: PictureSize): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.resolve(null);
  }

  // JPEG has no transparency: a see-through PNG or WebP gets a white background instead of a black one.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size.width, size.height);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}
