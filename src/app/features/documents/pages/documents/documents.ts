import {
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import {
  DateRange,
  type DateRangeValue,
} from '../../../../shared/components/date-range/date-range';
import {
  NumberRange,
  type NumberRangeValue,
} from '../../../../shared/components/number-range/number-range';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Menu } from '../../../../shared/components/menu/menu';
import { MenuItem } from '../../../../shared/components/menu/menu-item';
import {
  Select,
  type SelectOption,
  type SelectValue,
} from '../../../../shared/components/select/select';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Auth } from '../../../auth/services/auth';
import { Umag } from '../../../extensions/services/umag';
import { AddDocumentDialog } from '../../components/add-document-dialog/add-document-dialog';
import {
  type DocumentItem,
  documentTitle,
  formatMoment,
  statusClasses,
  statusIcon,
  statusLabel,
} from '../../models/document';
import { DocumentsStore } from '../../services/documents-store';
import { Recognition } from '../../services/recognition';
/** Вкладки списка и то, чем они оборачиваются в запросе. */
const TABS: Record<string, string> = {
  Все: 'all',
  Ожидают: 'pending',
  Проверенные: 'checked',
  Удалённые: 'deleted',
};

/** Размер страницы — тот же, что у DRF в настройках API. */
const PAGE_SIZE = 20;

const SEARCH_DELAY = 300;

type SortColumn = 'supplier' | 'number' | 'lines' | 'status' | 'created';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'pending', label: 'В очереди' },
  { value: 'processing', label: 'Распознаётся' },
  { value: 'done', label: 'Готово' },
  { value: 'checked', label: 'Проверено' },
  { value: 'failed', label: 'Ошибка' },
];

@Component({
  selector: 'app-documents',
  imports: [
    Icon,
    Button,
    Menu,
    MenuItem,
    Table,
    TableColumn,
    Toolbar,
    AddDocumentDialog,
    Empty,
    RouterLink,
    Spinner,
    Select,
    DateRange,
    NumberRange,
  ],
  templateUrl: './documents.html',
})
export class Documents {
  protected readonly addIcon = Plus;
  protected readonly openIcon = ArrowRight;
  protected readonly checkedIcon = BadgeCheck;
  protected readonly removeIcon = Trash2;
  protected readonly prevIcon = ChevronLeft;
  protected readonly nextIcon = ChevronRight;
  protected readonly sortUpIcon = ArrowUp;
  protected readonly sortDownIcon = ArrowDown;

  protected readonly statusIcon = statusIcon;
  protected readonly statusClasses = statusClasses;
  protected readonly statusLabel = statusLabel;
  protected readonly documentTitle = documentTitle;
  protected readonly formatMoment = formatMoment;
  protected readonly statusOptions = STATUS_OPTIONS;

  protected readonly dialogOpen = signal(false);

  private readonly store = inject(DocumentsStore);
  private readonly recognition = inject(Recognition);
  private readonly umag = inject(Umag);
  private readonly auth = inject(Auth);
  private readonly header = inject(PageHeader);
  private readonly headerActions = viewChild<TemplateRef<unknown>>('headerActions');
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);

  protected readonly documents = this.store.documents;
  protected readonly total = this.store.total;
  protected readonly loading = this.store.loading;
  protected readonly pending = this.store.pending;
  protected readonly error = this.store.error;
  protected readonly connected = this.recognition.connected;
  protected readonly managesOrganization = this.auth.managesOrganization;

  protected readonly supplierQuery = signal('');
  protected readonly numberQuery = signal('');
  protected readonly statusQuery = signal('');
  protected readonly linesFrom = signal('');
  protected readonly linesTo = signal('');
  protected readonly dateFrom = signal('');
  protected readonly dateTo = signal('');
  protected readonly page = signal(1);
  protected readonly sortColumn = signal<SortColumn>('created');
  protected readonly sortDirection = signal<'asc' | 'desc'>('desc');

  /**
   * Расширение ещё не спросили — рано показывать приглашение подключиться:
   * страница успела бы мигнуть пустым экраном, хотя разбор уже включён.
   */
  protected readonly ready = computed(() => this.recognition.account() !== null);

  protected readonly trackById = (document: DocumentItem) => document.id;

  protected readonly filtering = computed(
    () =>
      Boolean(this.supplierQuery().trim()) ||
      Boolean(this.numberQuery().trim()) ||
      Boolean(this.statusQuery()) ||
      Boolean(this.linesFrom()) ||
      Boolean(this.linesTo()) ||
      Boolean(this.dateFrom()) ||
      Boolean(this.dateTo()),
  );

  /** Об ошибке кричит тост, а таблица не должна врать, что документов нет. */
  protected readonly emptyText = computed(() => {
    if (this.error()) {
      return 'Список не загрузился — обновите страницу';
    }

    return this.filtering()
      ? 'Ничего не нашлось'
      : 'Документов пока нет — добавьте первый документ';
  });

  /**
   * Открыта вкладка «Удалённые». Такую накладную удалять второй раз нечего:
   * из выдачи она уже ушла, вернуть её может только администратор.
   */
  protected readonly deleted = computed(() => TABS[this.header.activeTab() ?? ''] === 'deleted');

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly shownPage = computed(() => Math.min(this.page(), this.pageCount()));
  protected readonly rangeStart = computed(() => {
    if (!this.total()) {
      return 0;
    }

    return (this.shownPage() - 1) * PAGE_SIZE + 1;
  });
  protected readonly rangeEnd = computed(() =>
    Math.min(this.shownPage() * PAGE_SIZE, this.total()),
  );
  protected readonly rangeLabel = computed(() => {
    const total = this.total().toLocaleString('ru-RU');

    return `${this.rangeStart()}–${this.rangeEnd()} из ${total}`;
  });

  /** Магазин, с которым список сейчас показан. `undefined` — ещё не известен. */
  private shownStore: number | null | undefined;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;
  /** Первый запрос — полноэкранный спиннер, дальше таблица только тускнеет. */
  private booted = false;

  constructor() {
    this.header.setTabs(Object.keys(TABS));

    if (this.recognition.account() === null) {
      void this.recognition.load().catch(() => undefined);
    }

    effect(() => {
      const actions = this.headerActions();
      this.header.setActions(this.connected() && !this.loading() && actions ? actions : null);
    });

    effect(() => {
      const locked = this.ready() && !this.connected();

      untracked(() => this.header.setTabs(locked ? [] : Object.keys(TABS)));
    });

    effect(() => {
      const tab = TABS[this.header.activeTab() ?? ''] ?? 'all';
      untracked(() => {
        this.page.set(1);
        const soft = this.booted;
        this.booted = true;
        void this.refresh({ tab, soft });
      });
    });

    // Магазин переключают в шапке, а документы теперь принадлежат ему: список
    // должен смениться вместе с ним.
    effect(() => {
      const store = this.umag.account()?.targetId;

      // Первый известный магазин — тот, с которым список уже загрузился:
      // бэкенд берёт его из подключения сам, спрашивать второй раз незачем.
      if (store === undefined || this.shownStore === undefined) {
        this.shownStore = store;
        return;
      }

      if (store === this.shownStore) {
        return;
      }

      this.shownStore = store;
      untracked(() => {
        this.page.set(1);
        void this.refresh({ soft: false });
      });
    });

    // Сколько накладных ждёт проверки — числом рядом с вкладкой.
    effect(() => {
      this.header.setBadges({ Ожидают: this.store.counts()['pending'] ?? 0 });
    });

    inject(DestroyRef).onDestroy(() => {
      this.stopSearch();
      this.header.setActions(null);
      this.header.clear();
    });
  }

  protected searchSupplier(event: Event): void {
    this.supplierQuery.set((event.target as HTMLInputElement).value);
    this.scheduleRefresh();
  }

  protected searchNumber(event: Event): void {
    this.numberQuery.set((event.target as HTMLInputElement).value);
    this.scheduleRefresh();
  }

  protected filterStatus(value: SelectValue): void {
    this.statusQuery.set(value === '' ? '' : String(value));
    this.page.set(1);
    void this.refresh({ soft: true });
  }

  protected filterLinesRange(range: NumberRangeValue): void {
    this.linesFrom.set(range.from);
    this.linesTo.set(range.to);
    this.page.set(1);
    void this.refresh({ soft: true });
  }

  protected filterDateRange(range: DateRangeValue): void {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.page.set(1);
    void this.refresh({ soft: true });
  }

  protected toggleSort(column: SortColumn): void {
    const order =
      this.sortColumn() === column
        ? this.sortDirection() === 'asc'
          ? 'desc'
          : 'asc'
        : column === 'created' || column === 'lines'
          ? 'desc'
          : 'asc';

    this.sortColumn.set(column);
    this.sortDirection.set(order);
    this.page.set(1);
    void this.refresh({ soft: true });
  }

  protected isSorted(column: SortColumn): boolean {
    return this.sortColumn() === column;
  }

  protected sortIcon(column: SortColumn) {
    if (!this.isSorted(column)) {
      return null;
    }

    return this.sortDirection() === 'asc' ? this.sortUpIcon : this.sortDownIcon;
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(1, page), this.pageCount());

    if (next === this.shownPage()) {
      return;
    }

    this.page.set(next);
    void this.refresh({ soft: true });
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

  private scheduleRefresh(): void {
    this.stopSearch();
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      void this.refresh({ soft: true });
    }, SEARCH_DELAY);
  }

  private stopSearch(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private async refresh(options: { tab?: string; soft?: boolean } = {}): Promise<void> {
    const version = ++this.version;
    const tab = options.tab ?? TABS[this.header.activeTab() ?? ''] ?? 'all';

    await this.store.load({
      tab,
      page: this.page(),
      supplier: this.supplierQuery().trim(),
      number: this.numberQuery().trim(),
      status: this.statusQuery(),
      linesFrom: this.linesFrom(),
      linesTo: this.linesTo(),
      from: this.dateFrom(),
      to: this.dateTo(),
      sort: this.sortColumn(),
      order: this.sortDirection(),
      soft: options.soft === true,
    });

    if (version !== this.version) {
      return;
    }

    // Страница могла уехать за конец после фильтра — подтянем.
    if (this.page() > this.pageCount()) {
      this.page.set(this.pageCount());
      await this.refresh({ soft: true });
    }
  }
}
