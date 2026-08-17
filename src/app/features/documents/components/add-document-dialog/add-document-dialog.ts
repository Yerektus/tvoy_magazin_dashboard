import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { ImagePlus, Trash2 } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Icon } from '../../../../shared/components/icon/icon';
import { Modal } from '../../../../shared/components/modal/modal';
import { Toasts } from '../../../../shared/services/toasts';
import { DocumentsStore } from '../../services/documents-store';

/** Столько же принимает бэкенд — отсекаем большие файлы до отправки. */
const MAX_SIZE = 15 * 1024 * 1024;

/**
 * В `accept` у поля выбора HEIC не перечислен намеренно: тогда айфон сам
 * отдаёт снимок в JPEG, и серверу не приходится его перекодировать. Но
 * перетаскиванием и через «Файлы» HEIC всё равно приносят — такие берём:
 * бэкенд их принимает и сделает превью сам. Chrome вдобавок не проставляет
 * таким файлам тип, поэтому смотрим на расширение.
 */
const PHOTO_EXTENSIONS = ['.heic', '.heif'];

interface Attachment {
  file: File;
  url: string;
}

@Component({
  selector: 'app-add-document-dialog',
  imports: [Modal, Button, Icon],
  templateUrl: './add-document-dialog.html',
})
export class AddDocumentDialog {
  readonly open = input(false);
  readonly closed = output<void>();
  readonly uploaded = output<number[]>();

  protected readonly attachIcon = ImagePlus;
  protected readonly removeIcon = Trash2;

  protected readonly photos = signal<Attachment[]>([]);
  protected readonly dragging = signal(false);
  protected readonly sending = signal(false);
  protected readonly done = signal(0);
  protected readonly error = signal<string | null>(null);
  /** HEIC показывает только Safari, поэтому вместо битой картинки ставим заглушку. */
  protected readonly noPreview = signal<ReadonlySet<string>>(new Set());

  protected readonly count = computed(() => this.photos().length);
  protected readonly canSubmit = computed(() => this.count() > 0 && !this.sending());

  private readonly store = inject(DocumentsStore);
  private readonly toasts = inject(Toasts);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revokeAll());
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(input.files);
    // Чтобы повторный выбор тех же файлов снова сработал.
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.add(event.dataTransfer?.files ?? null);
  }

  protected size(file: File): string {
    const kilobytes = file.size / 1024;
    return kilobytes < 1024 ? `${Math.round(kilobytes)} КБ` : `${(kilobytes / 1024).toFixed(1)} МБ`;
  }

  protected remove(attachment: Attachment): void {
    URL.revokeObjectURL(attachment.url);
    this.photos.update((current) => current.filter((item) => item !== attachment));
  }

  protected cancel(): void {
    if (this.sending()) {
      return;
    }

    this.reset();
    this.closed.emit();
  }

  /** Отправляет все фото; распознавание пойдёт на бэкенде, статус придёт поллингом. */
  protected async submit(): Promise<void> {
    const photos = this.photos().map((attachment) => attachment.file);
    if (!photos.length || this.sending()) {
      return;
    }

    this.sending.set(true);
    this.done.set(0);
    this.error.set(null);

    try {
      const { created, failed } = await this.store.uploadMany(photos, (done) =>
        this.done.set(done),
      );

      if (created.length) {
        this.toasts.info(
          created.length === 1
            ? 'Накладная загружена, ИИ разбирает её'
            : `Загружено накладных: ${created.length}. ИИ разбирает их`,
        );
      }

      if (failed.length) {
        this.toasts.error(
          failed.length === 1
            ? `${failed[0].name}: ${failed[0].message}`
            : `Не удалось загрузить файлов: ${failed.length}`,
        );
      }

      if (created.length) {
        this.reset();
        this.uploaded.emit(created.map((document) => document.id));
        return;
      }

      // Ничего не загрузилось — файлы остаются в окне, чтобы повторить отправку.
      // Про причину уже сказал тост, второй раз её тут не пишем.
    } finally {
      this.sending.set(false);
      this.done.set(0);
    }
  }

  protected previewFailed(url: string): void {
    this.noPreview.update((current) => new Set(current).add(url));
  }

  private add(files: FileList | null): void {
    if (!files?.length) {
      return;
    }

    const rejected: string[] = [];
    const accepted: Attachment[] = [];

    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      const looksLikePhoto =
        file.type.startsWith('image/') || PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext));

      if (!looksLikePhoto) {
        rejected.push(`${file.name} — не фотография`);
        continue;
      }

      if (file.size > MAX_SIZE) {
        rejected.push(`${file.name} — больше 15 МБ`);
        continue;
      }

      if (
        this.photos().some((item) => item.file.name === file.name && item.file.size === file.size)
      ) {
        continue;
      }

      accepted.push({ file, url: URL.createObjectURL(file) });
    }

    if (accepted.length) {
      this.photos.update((current) => [...current, ...accepted]);
    }

    this.error.set(rejected.length ? rejected.join('; ') : null);
  }

  private reset(): void {
    this.revokeAll();
    this.photos.set([]);
    this.error.set(null);
  }

  private revokeAll(): void {
    this.photos().forEach((attachment) => URL.revokeObjectURL(attachment.url));
  }
}
