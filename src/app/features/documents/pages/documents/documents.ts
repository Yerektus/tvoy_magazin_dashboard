import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ArrowRight, BadgeCheck, Plus, Trash2 } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Checkbox } from '../../../../shared/components/checkbox/checkbox';
import { Icon } from '../../../../shared/components/icon/icon';
import { Menu } from '../../../../shared/components/menu/menu';
import { MenuItem } from '../../../../shared/components/menu/menu-item';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { AddDocumentDialog } from '../../components/add-document-dialog/add-document-dialog';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import {
  type DocumentItem,
  documentTitle,
  formatDate,
  formatTime,
  statusClasses,
  statusIcon,
  statusLabel,
} from '../../models/document';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { DocumentsStore } from '../../services/documents-store';

/** Вкладки списка и то, чем они оборачиваются в запросе. */
const TABS: Record<string, string> = {
  Все: 'all',
  Ожидают: 'pending',
  Проверенные: 'checked',
  Удалённые: 'deleted',
};

@Component({
  selector: 'app-documents',
  imports: [
    Icon,
    Button,
    Checkbox,
    Menu,
    MenuItem,
    Table,
    TableColumn,
    Toolbar,
    AddDocumentDialog,
    RouterLink,
  ],
  templateUrl: './documents.html',
})
export class Documents {
  protected readonly addIcon = Plus;
  protected readonly openIcon = ArrowRight;
  protected readonly checkedIcon = BadgeCheck;
  protected readonly removeIcon = Trash2;

  protected readonly statusIcon = statusIcon;
  protected readonly statusClasses = statusClasses;
  protected readonly statusLabel = statusLabel;
  protected readonly documentTitle = documentTitle;
  protected readonly formatDate = formatDate;
  protected readonly formatTime = formatTime;

  protected readonly dialogOpen = signal(false);

  private readonly store = inject(DocumentsStore);
  private readonly header = inject(PageHeader);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);

  protected readonly documents = this.store.documents;
  protected readonly total = this.store.total;
  protected readonly loading = this.store.loading;
  protected readonly error = this.store.error;

  protected readonly trackById = (document: DocumentItem) => document.id;

  /** Об ошибке кричит тост, а таблица не должна врать, что документов нет. */
  protected readonly emptyText = computed(() => {
    return this.error()
      ? 'Список не загрузился — обновите страницу'
      : 'Документов пока нет — добавьте первый документ';
  });

  protected readonly selected = signal<ReadonlySet<number>>(new Set());

  protected readonly allSelected = computed(
    () => this.documents().length > 0 && this.selected().size === this.documents().length,
  );

  /** Выбрана часть строк — галочка в шапке рисуется промежуточной. */
  protected readonly someSelected = computed(() => this.selected().size > 0 && !this.allSelected());

  constructor() {
    this.header.setTabs(Object.keys(TABS));

    effect(() => {
      const tab = this.header.activeTab();
      void this.store.load(TABS[tab ?? ''] ?? 'all');
    });

    // Сколько накладных ждёт проверки — числом рядом с вкладкой.
    effect(() => {
      this.header.setBadges({ Ожидают: this.store.counts()['pending'] ?? 0 });
    });

    inject(DestroyRef).onDestroy(() => this.header.clear());
  }

  protected isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  protected toggle(id: number): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  protected toggleAll(): void {
    this.selected.update((current) =>
      current.size === this.documents().length
        ? new Set()
        : new Set(this.documents().map((document) => document.id)),
    );
  }

  protected open(document: DocumentItem): void {
    void this.router.navigate(['/documents', document.id]);
  }

  /** Отметить проверенной прямо из списка, не заходя в накладную. */
  protected async check(document: DocumentItem): Promise<void> {
    const agreed = await this.confirm.ask({
      title: 'Отметить проверенной?',
      message: `Подтвердите, что позиции накладной сверены с бумагой: ${documentTitle(document)}.`,
      confirmLabel: 'Проверено',
    });

    if (!agreed) {
      return;
    }

    try {
      await this.store.check(document.id);
      this.toasts.success('Накладная отмечена проверенной');
    } catch {
      this.toasts.error('Не удалось отметить накладную проверенной');
    }
  }

  /** Удаление мягкое: на бэкенде накладная остаётся с отметкой. */
  protected async remove(document: DocumentItem): Promise<void> {
    const agreed = await this.confirm.ask({
      title: 'Удалить накладную?',
      message:
        'Накладная скроется из списка, но останется в базе — восстановить её сможет администратор.',
      confirmLabel: 'Удалить',
      danger: true,
    });

    if (!agreed) {
      return;
    }

    try {
      await this.store.remove(document.id);
      this.toasts.success('Накладная удалена');
    } catch {
      this.toasts.error('Не удалось удалить накладную');
    }
  }

  protected onUploaded(): void {
    this.dialogOpen.set(false);
  }
}
