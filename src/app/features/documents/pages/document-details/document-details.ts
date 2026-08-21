import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  ExternalLink,
  Eye,
  Plus,
  type IconNode,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Icon } from '../../../../shared/components/icon/icon';
import { ImageViewer } from '../../../../shared/components/image-viewer/image-viewer';
import { Modal } from '../../../../shared/components/modal/modal';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { EditableText } from '../../../../shared/components/editable-text/editable-text';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { PageHeader } from '../../../../shared/services/page-header';
import { Confirm } from '../../../../shared/services/confirm';
import { Toasts } from '../../../../shared/services/toasts';
import {
  type DocumentItem,
  type DocumentLine,
  documentTitle,
  formatCost,
  formatDate,
  formatMoment,
  formatMoney,
  formatQuantity,
  isPending,
  lineGuessNote,
  lineGuessed,
  statusClasses,
  statusIcon,
  statusLabel,
} from '../../models/document';
import { DocumentsStore } from '../../services/documents-store';
import {
  type UmagPreflight,
  type UmagStore,
  guessNote,
  isGuessed,
  lineNote,
  suggestionNote,
  storeIndexOf,
  supplyUrl,
} from '../../../extensions/models/umag';
import { Umag } from '../../../extensions/services/umag';

const TABS = ['Информация', 'История', 'Проверка'] as const;

/**
 * Пункт нижней панели на телефоне: иконка сверху, подпись под ней, поровну
 * ширины на каждый. Цвет дописывается отдельно — иначе красный и серый
 * оказались бы в одном классе и спорили бы порядком в стилях.
 */
const BAR_ITEM =
  'flex flex-1 cursor-pointer flex-col items-center gap-1 px-1 py-2 text-xs transition ' +
  'disabled:pointer-events-none disabled:opacity-40';

/** Шаг обработки накладной для вкладки «История». */
type StepState = 'done' | 'current' | 'waiting' | 'failed';

interface Step {
  title: string;
  note: string;
  at: string;
  state: StepState;
}

/** Результат автоматической проверки документа. */
type CheckState = 'passed' | 'warning' | 'pending';

interface DocumentCheck {
  label: string;
  state: CheckState;
  note: string;
}

const CHECK_ICONS: Record<CheckState, IconNode> = {
  passed: CircleCheck,
  warning: TriangleAlert,
  pending: CircleDashed,
};

const CHECK_CLASSES: Record<CheckState, string> = {
  passed: 'text-emerald-600',
  warning: 'text-amber-600',
  pending: 'text-neutral-400',
};

@Component({
  selector: 'app-document-details',
  imports: [Button, Icon, ImageViewer, Modal, Spinner, Table, TableColumn, EditableText],
  templateUrl: './document-details.html',
})
export class DocumentDetails {
  /** Приходит из `:id` в маршруте. */
  readonly id = input.required<string>();

  protected readonly viewIcon = Eye;
  protected readonly checkedIcon = BadgeCheck;
  protected readonly retryIcon = RefreshCw;
  protected readonly removeIcon = Trash2;
  protected readonly addIcon = Plus;
  protected readonly doneIcon = Check;
  protected readonly currentIcon = Send;
  protected readonly waitingIcon = Clock;
  protected readonly failedIcon = TriangleAlert;
  protected readonly umagIcon = Upload;
  protected readonly linkIcon = ExternalLink;
  protected readonly backIcon = ArrowLeft;

  protected readonly barItem = `${BAR_ITEM} text-neutral-500 hover:text-neutral-900`;
  protected readonly barDanger = `${BAR_ITEM} text-red-600 hover:text-red-700`;

  /** Строка карточки: на телефоне подпись над значением, дальше — слева от него. */
  protected readonly row =
    'flex flex-col gap-1 border-b border-neutral-100 py-3 last:border-0 sm:flex-row sm:gap-4';
  protected readonly rowLabel = 'text-neutral-500 sm:w-56 sm:shrink-0';

  protected readonly statusIcon = statusIcon;
  protected readonly statusClasses = statusClasses;
  protected readonly statusLabel = statusLabel;
  protected readonly formatMoney = formatMoney;
  protected readonly formatQuantity = formatQuantity;
  protected readonly formatDate = formatDate;
  protected readonly formatCost = formatCost;

  protected readonly document = signal<DocumentItem | null>(null);
  protected readonly loading = signal(true);
  protected readonly viewerOpen = signal(false);
  protected readonly busy = signal(false);

  /** Итог последней проверки готовности к UMAG: пусто, пока не нажимали. */
  protected readonly umagState = signal<UmagPreflight | null>(null);
  protected readonly umagBusy = signal(false);
  protected readonly supplierOpen = signal(false);
  protected readonly lineNote = lineNote;
  protected readonly suggestionNote = suggestionNote;
  protected readonly isGuessed = isGuessed;
  protected readonly guessNote = guessNote;
  protected readonly lineGuessed = lineGuessed;
  protected readonly lineGuessNote = lineGuessNote;

  protected readonly trackLine = (line: DocumentLine) => line.id;

  private readonly store = inject(DocumentsStore);
  private readonly umag = inject(Umag);
  private readonly router = inject(Router);
  private readonly header = inject(PageHeader);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);

  /** Крошки и табы этой страницы живут в шапке. */
  protected readonly activeTab = this.header.activeTab;

  protected readonly lines = computed(() => this.document()?.lines ?? []);

  /** Сумма распознанных строк: она же стоит в подвале таблицы позиций. */
  protected readonly linesTotal = computed(() =>
    this.lines().reduce((total, line) => total + Number(line.total ?? 0), 0),
  );

  protected readonly linesTotalLabel = computed(() => formatMoney(String(this.linesTotal())));

  protected readonly canRetry = computed(() => {
    const document = this.document();
    return document !== null && !isPending(document);
  });

  /** Отметить проверенной можно разобранную и ещё не отмеченную. */
  protected readonly canCheck = computed(() => this.document()?.status === 'done');

  /**
   * Порядок такой: сначала «Проверено», и только у проверенной накладной
   * появляется отправка — две кнопки разом сбивают с толку, непонятно, какую
   * жать первой. Уехавшую второй раз не отправляем, а пока расширение не
   * подключено, кнопки нет вовсе: отправлять некуда.
   */
  protected readonly canSendToUmag = computed(() => {
    const document = this.document();

    return this.umag.connected() && document?.status === 'checked' && !document.umag_supply_id;
  });

  /** Ссылка на созданный черновик приёмки — в тот магазин, куда она уехала. */
  protected readonly umagLink = computed(() => {
    const document = this.document();
    const account = this.umag.account();

    if (!document?.umag_supply_id) {
      return null;
    }

    // Накладная помнит свой магазин; у старых его нет — берём выбранный сейчас.
    const store = document.umag_store_id ?? account?.targetId ?? null;

    return supplyUrl(document.umag_supply_id, storeIndexOf(account?.targets, store));
  });

  /** История обработки: что уже сделал бэкенд и что делает прямо сейчас. */
  protected readonly steps = computed<Step[]>(() => {
    const document = this.document();
    if (!document) {
      return [];
    }

    const uploaded: Step = {
      title: 'Накладная загружена',
      note: 'Фото сохранено на сервере',
      at: formatMoment(document.created_at),
      state: 'done',
    };

    // «Проверено» идёт после «Готово», так что распознавание к этому моменту
    // тоже завершено — иначе шаг откатывался бы в «идёт сейчас».
    const parsed = document.status === 'done' || document.status === 'checked';

    const recognition: Step = {
      title: 'Распознавание ИИ',
      note: document.model ? `Модель ${document.model}` : 'Модель разбирает фотографию',
      at: document.status === 'pending' ? 'В очереди' : formatMoment(document.processed_at),
      state: document.status === 'failed' ? 'failed' : parsed ? 'done' : 'current',
    };

    if (document.status === 'failed') {
      return [
        uploaded,
        recognition,
        {
          title: 'Разбор не удался',
          note: document.error || 'Модель вернула ошибку',
          at: formatMoment(document.processed_at),
          state: 'failed',
        },
      ];
    }

    return [
      uploaded,
      recognition,
      {
        title: 'Данные готовы',
        note: parsed
          ? `Распознано позиций: ${document.lines_count}`
          : 'Ожидает окончания распознавания',
        at: parsed ? formatMoment(document.processed_at) : '—',
        state: parsed ? 'done' : 'waiting',
      },
      {
        title: 'Проверка человеком',
        note:
          document.status === 'checked'
            ? `Проверил ${document.checked_by_email ?? 'сотрудник'}`
            : 'Сверьте распознанные позиции с бумагой и нажмите «Проверено»',
        at: document.status === 'checked' ? formatMoment(document.checked_at) : '—',
        state: document.status === 'checked' ? 'done' : 'waiting',
      },
    ];
  });

  protected readonly checks = computed<DocumentCheck[]>(() => {
    const document = this.document();
    if (!document) {
      return [];
    }

    if (isPending(document)) {
      return [{ label: 'Проверки', state: 'pending', note: 'Дождитесь окончания распознавания' }];
    }

    const binValid = /^\d{12}$/.test(document.supplier_bin);
    const lines = this.lines();
    const withBarcode = lines.filter((line) => line.barcode).length;
    const sum = this.linesTotal();
    const declared = Number(document.total ?? 0);
    const sumMatches = declared > 0 && Math.abs(sum - declared) < 1;

    return [
      {
        label: 'БИН поставщика',
        state: binValid ? 'passed' : 'warning',
        note: binValid ? `${document.supplier_bin} — 12 цифр` : 'БИН не распознан или неполный',
      },
      {
        label: 'Позиции',
        state: lines.length > 0 ? 'passed' : 'warning',
        note:
          lines.length > 0 ? `Распознано строк: ${lines.length}` : 'Ни одной позиции не найдено',
      },
      {
        label: 'Штрихкоды',
        state: withBarcode === lines.length && lines.length > 0 ? 'passed' : 'warning',
        note: `Со штрихкодом ${withBarcode} из ${lines.length}`,
      },
      {
        label: 'Сумма',
        state: sumMatches ? 'passed' : 'warning',
        note: sumMatches
          ? `Сумма строк сходится с итогом ${formatMoney(document.total)}`
          : `Строки дают ${formatMoney(String(sum))}, в накладной ${formatMoney(document.total)}`,
      },
    ];
  });

  protected readonly checksPassed = computed(
    () => this.checks().filter((check) => check.state === 'passed').length,
  );

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.header.setTabs(TABS);

    // Состояние расширения решает, показывать ли отправку в UMAG.
    // Если по нему уже ходили, второй раз не спрашиваем.
    if (this.umag.account() === null) {
      void this.umag.load().catch(() => undefined);
    }

    effect(() => {
      const id = Number(this.id());
      void this.load(id);
    });

    effect(() => {
      const document = this.document();
      this.header.setCrumbs([
        { label: 'Документы', route: '/documents' },
        { label: document ? documentTitle(document) : 'Накладная' },
      ]);
    });

    inject(DestroyRef).onDestroy(() => {
      this.header.clear();
      this.stopPolling();
    });
  }

  /** Сохраняет поставщика: его название и БИН стоят на печати, а не в таблице. */
  protected async saveSupplier(patch: Partial<DocumentItem>): Promise<void> {
    const document = this.document();
    if (!document) {
      return;
    }

    try {
      const saved = await this.store.updateDocument(document.id, patch);
      this.document.set(saved);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось сохранить');
    }
  }

  /**
   * Сохраняет правку позиции. Числовые поля пропускаем через проверку:
   * бэкенд отвергнет мусор, но лучше сказать об этом сразу.
   */
  protected async saveLine(
    line: DocumentLine,
    patch: Partial<Record<'name' | 'barcode' | 'quantity' | 'unit' | 'price' | 'total', string>>,
  ): Promise<void> {
    const document = this.document();
    if (!document) {
      return;
    }

    for (const field of ['quantity', 'price', 'total'] as const) {
      const raw = patch[field];
      if (raw !== undefined && raw !== '' && Number.isNaN(Number(raw.replace(',', '.')))) {
        this.toasts.error('Тут нужно число');
        return;
      }
    }

    const normalized = Object.fromEntries(
      Object.entries(patch).map(([field, raw]) => [
        field,
        ['quantity', 'price', 'total'].includes(field) && raw ? raw.replace(',', '.') : raw || null,
      ]),
    );

    try {
      const saved = await this.store.updateLine(document.id, line.id, normalized);
      this.document.update((current) =>
        current
          ? {
              ...current,
              lines: current.lines?.map((item) => (item.id === saved.id ? saved : item)),
            }
          : current,
      );
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось сохранить');
    }
  }

  /** Добавляет пустую позицию наверх таблицы — заполняют её прямо там. */
  protected async addLine(): Promise<void> {
    const document = this.document();
    if (!document) {
      return;
    }

    // Запрос идёт до секунды, а таблица за это время не меняется: без
    // уведомления кажется, что кнопка не сработала.
    const toast = this.toasts.loading('Добавляем позицию…');

    try {
      await this.store.addLine(document.id);
      // Бэкенд сдвинул номера остальных строк — забираем накладную целиком.
      this.document.set(await this.store.fetch(document.id));
      this.toasts.settle(toast, 'Позиция добавлена');
    } catch (error) {
      this.toasts.settle(
        toast,
        error instanceof Error ? error.message : 'Не удалось добавить позицию',
        'error',
      );
    }
  }

  /** Убирает позицию, которой на бумаге нет. */
  protected async removeLine(line: DocumentLine): Promise<void> {
    const document = this.document();
    if (!document) {
      return;
    }

    const agreed = await this.confirm.ask({
      title: 'Удалить позицию?',
      message: `«${line.name}» пропадёт из накладной, итог пересчитается.`,
      confirmLabel: 'Удалить',
      danger: true,
    });

    if (!agreed) {
      return;
    }

    const toast = this.toasts.loading('Удаляем позицию…');

    try {
      await this.store.removeLine(document.id, line.id);
      // Бэкенд перенумеровал строки и пересчитал итог — забираем накладную целиком.
      this.document.set(await this.store.fetch(document.id));
      this.toasts.settle(toast, 'Позиция удалена');
    } catch (error) {
      this.toasts.settle(
        toast,
        error instanceof Error ? error.message : 'Не удалось удалить позицию',
        'error',
      );
    }
  }

  protected async check(): Promise<void> {
    const document = this.document();
    if (!document || this.busy()) {
      return;
    }

    const agreed = await this.confirm.ask({
      title: 'Отметить проверенной?',
      message: 'Подтвердите, что распознанные позиции сверены с бумажной накладной.',
      confirmLabel: 'Проверено',
    });

    if (!agreed) {
      return;
    }

    this.busy.set(true);

    try {
      this.document.set(await this.store.check(document.id));
      this.toasts.success('Накладная отмечена проверенной');
    } catch {
      this.toasts.error('Не удалось отметить накладную проверенной');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Отправка в UMAG. Сначала спрашиваем бэкенд, всё ли сходится: без товара в
   * номенклатуре или с задвоенным поставщиком приёмку создавать нельзя.
   */
  protected async sendToUmag(): Promise<void> {
    const document = this.document();
    if (!document || this.umagBusy()) {
      return;
    }

    this.umagBusy.set(true);

    try {
      const state = await this.umag.preflight(document.id);
      this.umagState.set(state);

      // Одноимённых контрагентов в UMAG несколько — какой из них, знает человек.
      if (!state.supplier.agent_id && state.supplier.candidates.length) {
        this.supplierOpen.set(true);
        return;
      }

      if (!state.ready) {
        this.header.selectTab('Проверка');
        this.toasts.error(state.problems[0]);
        return;
      }

      await this.createDraft();
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось связаться с UMAG');
    } finally {
      this.umagBusy.set(false);
    }
  }

  /** Из нижней панели — обратно к списку: крошки на телефоне узкие. */
  protected back(): void {
    void this.router.navigateByUrl('/documents');
  }

  /** Открывает созданный черновик в кабинете UMAG. */
  protected openDraft(): void {
    const link = this.umagLink();

    if (link) {
      window.open(link, '_blank', 'noopener');
    }
  }

  /** Человек выбрал поставщика — выбор запомнится на бэкенде. */
  protected async chooseSupplier(agent: UmagStore): Promise<void> {
    this.supplierOpen.set(false);
    this.umagBusy.set(true);

    try {
      await this.createDraft(agent.id);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось связаться с UMAG');
    } finally {
      this.umagBusy.set(false);
    }
  }

  /** Подставляет в строку штрихкод товара, который предложил UMAG. */
  protected async applySuggestion(suggested: UmagPreflight['lines'][number]): Promise<void> {
    const line = this.lines().find((item) => item.id === suggested.id);
    if (!line) {
      return;
    }

    await this.saveLine(line, { barcode: suggested.suggested_barcode });
    await this.sendToUmag();
  }

  private async createDraft(agentId?: number): Promise<void> {
    const document = this.document();
    if (!document) {
      return;
    }

    try {
      const draft = await this.umag.push(document.id, agentId);
      this.document.set(await this.store.fetch(document.id));
      this.umagState.set(null);
      this.toasts.success(`Черновик приёмки №${draft.supply_id} создан в UMAG`);
    } catch (error) {
      // Бэкенд перепроверяет готовность сам — его отказ и показываем.
      this.umagState.set(await this.umag.preflight(document.id).catch(() => this.umagState()));
      this.header.selectTab('Проверка');
      throw error;
    }
  }

  protected async retry(): Promise<void> {
    const document = this.document();
    if (!document || this.busy()) {
      return;
    }

    const agreed = await this.confirm.ask({
      title: 'Распознать заново?',
      message: 'Позиции будут заменены новым результатом модели — ручные правки пропадут. ',
      confirmLabel: 'Распознать',
    });

    if (!agreed) {
      return;
    }

    this.busy.set(true);

    try {
      await this.store.retry(document.id);
      await this.load(document.id);
      this.toasts.info('Отправили накладную на повторное распознавание');
    } catch {
      this.toasts.error('Не удалось перезапустить распознавание');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const document = this.document();
    if (!document || this.busy()) {
      return;
    }

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

    this.busy.set(true);

    try {
      await this.store.remove(document.id);
      this.toasts.success('Накладная удалена');
      await this.router.navigateByUrl('/documents');
    } catch {
      this.toasts.error('Не удалось удалить накладную');
    } finally {
      this.busy.set(false);
    }
  }

  protected checkIcon(state: CheckState): IconNode {
    return CHECK_ICONS[state];
  }

  protected checkClasses(state: CheckState): string {
    return CHECK_CLASSES[state];
  }

  /** Пока ИИ разбирает накладную, страница переспрашивает бэкенд. */
  private async load(id: number): Promise<void> {
    this.stopPolling();

    try {
      const document = await this.store.fetch(id);
      this.document.set(document);

      if (isPending(document)) {
        this.pollTimer = setTimeout(() => void this.load(id), 2500);
      }
    } catch {
      this.document.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
