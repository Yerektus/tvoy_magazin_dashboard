import { BadgeCheck, CircleCheck, Clock, type IconNode, RefreshCw, TriangleAlert } from 'lucide';

/** Статусы разбора накладной на бэкенде. */
export type DocumentStatus = 'pending' | 'processing' | 'done' | 'checked' | 'failed';

/** Позиция накладной — то, что модель вытащила из фотографии. */
export interface DocumentLine {
  id: number;
  position: number;
  name: string;
  barcode: string;
  quantity: string | null;
  unit: string;
  price: string | null;
  total: string | null;
  /** Товар кабинета, с которым сведена строка. */
  umag_product_name: string;
  /** Единица — штрихкод с бумаги, меньше — его подставила модель. */
  umag_confidence: number | null;
}

export interface DocumentItem {
  id: number;
  status: DocumentStatus;
  error: string;
  supplier: string;
  supplier_bin: string;
  /** БИН не прочитался с фото — его взяли из прошлой накладной поставщика. */
  supplier_bin_auto: boolean;
  number: string;
  issued_at: string | null;
  total: string | null;
  /** Сколько стоил разбор фотографии, в долларах. */
  cost: string | null;
  lines_count: number;
  /** Номер черновика приёмки в UMAG — стоит, значит накладная уже уехала туда. */
  umag_supply_id: number | null;
  umag_pushed_at: string | null;
  /** Магазин, в который уйдёт приёмка: тот, что был выбран при загрузке. */
  umag_store_id: number | null;
  umag_store_name: string;
  created_at: string;
  processed_at: string | null;
  checked_at: string | null;
  checked_by_email: string | null;
  /** Приходит только в карточке документа. */
  image?: string;
  /** JPEG для показа: заполнен, когда оригинал в HEIC. */
  preview?: string;
  model?: string;
  lines?: DocumentLine[];
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'В очереди',
  processing: 'Распознаётся',
  done: 'Готово',
  checked: 'Проверено',
  failed: 'Ошибка',
};

const STATUS_ICONS: Record<DocumentStatus, IconNode> = {
  pending: Clock,
  processing: RefreshCw,
  done: CircleCheck,
  checked: BadgeCheck,
  failed: TriangleAlert,
};

const STATUS_CLASSES: Record<DocumentStatus, string> = {
  pending: 'text-neutral-500',
  processing: 'text-sky-600',
  done: 'text-emerald-600',
  checked: 'text-emerald-700',
  failed: 'text-red-600',
};

export const statusLabel = (status: DocumentStatus): string => STATUS_LABELS[status];

export const statusIcon = (status: DocumentStatus): IconNode => STATUS_ICONS[status];

export const statusClasses = (status: DocumentStatus): string => STATUS_CLASSES[status];

/** Штрихкод в строку подставила модель — в бумаге его не было. */
export const lineGuessed = (line: DocumentLine): boolean =>
  line.umag_confidence !== null && line.umag_confidence < 1;

export const lineGuessNote = (line: DocumentLine): string =>
  `подставил ИИ · ${Math.round((line.umag_confidence ?? 0) * 100)}%`;

/** Разбор ещё идёт — такую накладную нужно опрашивать. */
export const isPending = (document: DocumentItem): boolean =>
  document.status === 'pending' || document.status === 'processing';

/** Заголовок накладной: номер, если он распознан, иначе дата загрузки. */
export function documentTitle(document: DocumentItem): string {
  if (document.number) {
    return `Накладная №${document.number}`;
  }

  return `Накладная от ${formatDate(document.created_at)}`;
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU');
}

export function formatTime(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Дата и время рядом: «15.08.2026 15:41». Пусто — прочерк. */
export const formatMoment = (value: string | null): string =>
  value ? `${formatDate(value)} ${formatTime(value)}` : '—';

export function formatMoney(value: string | null): string {
  if (value === null || value === '') {
    return '—';
  }

  const amount = Number(value);
  return Number.isNaN(amount)
    ? value
    : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount)} ₸`;
}

/** Разбор одной накладной стоит центы, поэтому округляем до сотых цента. */
export function formatCost(value: string | null): string {
  if (value === null || value === '') {
    return '—';
  }

  const amount = Number(value);
  return Number.isNaN(amount) ? value : `$${amount.toFixed(4)}`;
}

/** «60.000» → «60», «1.500» → «1,5» */
export function formatQuantity(value: string | null): string {
  if (value === null || value === '') {
    return '—';
  }

  const amount = Number(value);
  return Number.isNaN(amount) ? value : new Intl.NumberFormat('ru-RU').format(amount);
}
