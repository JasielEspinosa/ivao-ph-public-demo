import { Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';

import { CropArea } from '../../../shared/profile-photo';

const MAX_ZOOM = 4;
/** Zooming stops here (picture pixels across the frame), before the crop turns blurry. */
const MIN_CROP_WIDTH = 300;
/** How far one arrow key press moves the picture, as a share of the frame. */
const KEY_STEP = 0.02;

/**
 * One crop frame: the picture is moved (drag or arrow keys) and zoomed (slider, + and - keys) inside a frame of a fixed
 * ratio. `area` is the part of the picture inside the frame.
 */
@Component({
  selector: 'app-photo-cropper',
  standalone: true,
  templateUrl: './photo-cropper.html',
  styleUrl: './photo-cropper.css',
})
export class PhotoCropperComponent implements OnChanges {
  @Input({ required: true }) image!: HTMLImageElement;
  /** Width divided by height. */
  @Input({ required: true }) aspect = 1;
  /** The overlay that shows where the face goes: a head and shoulders outline, or the circle of the profile picture. */
  @Input({ required: true }) guide: 'portrait' | 'circle' = 'circle';
  @Input({ required: true }) label = '';
  @Input() disabled = false;

  @ViewChild('frame', { static: true }) private readonly frame!: ElementRef<HTMLElement>;

  zoom = 1;
  maxZoom = 1;
  private center = { x: 0, y: 0 };
  private drag: { pointerId: number; x: number; y: number } | null = null;

  ngOnChanges(): void {
    const base = this.baseSize();
    this.maxZoom = Math.max(1, Math.min(MAX_ZOOM, base.width / MIN_CROP_WIDTH));
    this.zoom = 1;
    // Centred, but nearer the top of a tall picture, where the head usually is.
    this.center = {
      x: this.image.naturalWidth / 2,
      y: (this.image.naturalHeight - base.height) * 0.25 + base.height / 2,
    };
  }

  get area(): CropArea {
    const base = this.baseSize();
    const width = base.width / this.zoom;
    const height = base.height / this.zoom;

    return { x: this.center.x - width / 2, y: this.center.y - height / 2, width, height };
  }

  /** Where the whole picture sits, in percent of the frame, so that `area` fills it. */
  get placement(): { width: number; height: number; left: number; top: number } {
    const area = this.area;

    return {
      width: (this.image.naturalWidth / area.width) * 100,
      height: (this.image.naturalHeight / area.height) * 100,
      left: (-area.x / area.width) * 100,
      top: (-area.y / area.height) * 100,
    };
  }

  setZoom(zoom: number): void {
    if (this.disabled) {
      return;
    }

    this.zoom = Math.min(this.maxZoom, Math.max(1, zoom));
    this.moveTo(this.center.x, this.center.y);
  }

  startDrag(event: PointerEvent): void {
    if (this.disabled || event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.frame.nativeElement.focus();
    this.frame.nativeElement.setPointerCapture(event.pointerId);
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  moveDrag(event: PointerEvent): void {
    if (this.disabled || this.drag?.pointerId !== event.pointerId) {
      return;
    }

    // Dragging the picture to the right shows more of its left side.
    const scale = this.area.width / this.frame.nativeElement.clientWidth;
    this.moveTo(
      this.center.x - (event.clientX - this.drag.x) * scale,
      this.center.y - (event.clientY - this.drag.y) * scale,
    );
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  endDrag(): void {
    this.drag = null;
  }

  onKey(event: KeyboardEvent): void {
    const step = this.area.width * KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const zooms: Record<string, number> = { '+': 0.1, '=': 0.1, '-': -0.1 };

    if (!this.disabled && moves[event.key]) {
      event.preventDefault();
      this.moveTo(this.center.x + moves[event.key][0], this.center.y + moves[event.key][1]);
    } else if (zooms[event.key]) {
      event.preventDefault();
      this.setZoom(this.zoom + zooms[event.key]);
    }
  }

  /** The largest part of the picture with the frame's ratio (zoom 1). */
  private baseSize(): { width: number; height: number } {
    const { naturalWidth, naturalHeight } = this.image;

    return naturalWidth / naturalHeight > this.aspect
      ? { width: naturalHeight * this.aspect, height: naturalHeight }
      : { width: naturalWidth, height: naturalWidth / this.aspect };
  }

  /** Moves the middle of the crop, keeping the frame filled by the picture. */
  private moveTo(x: number, y: number): void {
    const { width, height } = this.area;
    const clamp = (value: number, half: number, full: number) => Math.min(full - half, Math.max(half, value));

    this.center = {
      x: clamp(x, width / 2, this.image.naturalWidth),
      y: clamp(y, height / 2, this.image.naturalHeight),
    };
  }
}
