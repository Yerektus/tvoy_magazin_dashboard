import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import Viewer from 'viewerjs';

/**
 * Просмотр фотографии документа: зум, поворот, полный экран, клавиатура.
 * Обёртка над viewerjs — он работает с обычным DOM, Angular тут только
 * заводит и гасит просмотрщик.
 *
 * ```html
 * <app-image-viewer [src]="photo" [open]="open()" (closed)="open.set(false)" />
 * ```
 */
@Component({
  selector: 'app-image-viewer',
  template: `
    <div class="hidden" #host>
      <img [src]="src()" [alt]="alt()" />
    </div>
  `,
})
export class ImageViewer {
  readonly src = input.required<string>();
  readonly alt = input('Фото документа');
  readonly open = input(false);
  readonly closed = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private viewer: Viewer | null = null;

  constructor() {
    effect(() => {
      // Пересоздаём при смене картинки, иначе viewerjs покажет прошлую.
      this.src();
      this.destroy();
    });

    effect(() => {
      if (this.open()) {
        this.show();
      } else {
        this.viewer?.hide();
      }
    });

    inject(DestroyRef).onDestroy(() => this.destroy());
  }

  private show(): void {
    if (!this.viewer) {
      this.viewer = new Viewer(this.host().nativeElement, {
        navbar: false,
        title: false,
        toolbar: {
          zoomIn: true,
          zoomOut: true,
          oneToOne: true,
          reset: true,
          rotateLeft: true,
          rotateRight: true,
          flipHorizontal: false,
          flipVertical: false,
        },
        // Закрыли крестиком или Esc — сообщаем наружу, чтобы сигнал сошёлся.
        hidden: () => this.closed.emit(),
      });
    }

    this.viewer.show();
  }

  private destroy(): void {
    this.viewer?.destroy();
    this.viewer = null;
  }
}
