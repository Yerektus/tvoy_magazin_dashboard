import { CircleCheck, type IconNode, RefreshCw, TriangleAlert } from 'lucide';

export type PlanStatus = 'building' | 'ready' | 'failed';

/** Строка плана: один товар, который пора дозаказать. */
export interface PurchasePlanItem {
  position: number;
  barcode: string;
  name: string;
  measure: string;
  /** У кого этот товар берут. Пусто — поставщик не определился. */
  supplier: string;
  /** Продано за период анализа. */
  sold: string;
  stock: string;
  per_day: string;
  /** Пусто — считать не от чего: товар не продавался. */
  cover_days: string | null;
  suggested: string;
  price: string | null;
  cost: string | null;
}

export interface PurchasePlan {
  id: number;
  /** Как назвали в кабинете. Пусто — с телефона или старая запись. */
  name: string;
  status: PlanStatus;
  error: string;
  store_id: number | null;
  store_name: string;
  /** Период анализа и горизонт закупа, в днях. */
  days: number;
  horizon: number;
  /** Вычитать ли остаток на складе из потребности. */
  use_stock: boolean;
  /** Сколько всего позиций просит заказа: в `items` лежат самые срочные. */
  items_total: number;
  total_cost: string;
  created_at: string;
  built_at: string | null;
  /** В списке позиций нет: их тысячи, таблице они не нужны. */
  items?: PurchasePlanItem[];
}

const STATUS_LABELS: Record<PlanStatus, string> = {
  building: 'Считается',
  ready: 'Готов',
  failed: 'Ошибка',
};

const STATUS_ICONS: Record<PlanStatus, IconNode> = {
  building: RefreshCw,
  ready: CircleCheck,
  failed: TriangleAlert,
};

const STATUS_CLASSES: Record<PlanStatus, string> = {
  building: 'text-blue-600',
  ready: 'text-emerald-600',
  failed: 'text-red-600',
};

export const statusLabel = (status: PlanStatus): string => STATUS_LABELS[status];

export const statusIcon = (status: PlanStatus): IconNode => STATUS_ICONS[status];

export const statusClasses = (status: PlanStatus): string => STATUS_CLASSES[status];

/** Заголовок планировки: своё имя или горизонт, если имя не задали. */
export function planTitle(plan: Pick<PurchasePlan, 'name' | 'horizon'>): string {
  const name = plan.name.trim();

  return name || `Закуп на ${plan.horizon} дн.`;
}

/** На сколько дней закупаемся — как в модалке и в таблице. */
export function horizonLabel(days: number): string {
  if (days === 3) {
    return 'Закуп на 3 дня';
  }

  if (days === 7) {
    return 'Закуп на неделю';
  }

  if (days === 14) {
    return 'Закуп на 2 недели';
  }

  if (days === 30) {
    return 'Закуп на месяц';
  }

  return `Закуп на ${days} дн.`;
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

/** Считается — страницу нужно опрашивать. */
export const isBuilding = (plan: PurchasePlan | null): boolean => plan?.status === 'building';

/**
 * Количество без лишней точности. В базе всё с тремя знаками, но «86,167»
 * глазом читается как восемьдесят шесть тысяч, а не как 86 штук в день:
 * крупные числа показываем целыми, мелкие — с одним знаком, а меньше
 * единицы — с двумя, иначе от 0,25 кг ничего не останется.
 */
export function formatAmount(value: string | null): string {
  if (value === null || value === '') {
    return '—';
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return value;
  }

  const size = Math.abs(number);
  const digits = size >= 100 ? 0 : size >= 1 ? 1 : 2;

  return number.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

/** Дни до опустевшей полки: меньше суток показываем как «сегодня». */
export function formatCover(value: string | null): string {
  if (value === null) {
    return '—';
  }

  const days = Number(value);

  return days < 1
    ? 'кончился'
    : `${days.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} дн.`;
}

export function formatMoney(value: string | number | null): string {
  if (value === null || value === '') {
    return '—';
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return String(value);
  }

  return `${Math.round(number).toLocaleString('ru-RU')} ₸`;
}

/** Когда одобрили закуп: дата и время одной строкой. */
export function formatApprovedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Одобренный закуп у одного поставщика. */
export interface ApprovedPurchaseItem {
  position: number;
  barcode: string;
  name: string;
  measure: string;
  sold: string;
  stock: string;
  per_day: string;
  cover_days: string | null;
  suggested: string;
  price: string | null;
  cost: string | null;
}

export interface ApprovedPurchase {
  id: number;
  store_id: number | null;
  store_name: string;
  supplier: string;
  items_total: number;
  total_cost: string;
  approved_at: string;
  items: ApprovedPurchaseItem[];
}

/** Товар кончился — такую строку подсвечиваем. */
export const isOut = (item: PurchasePlanItem | ApprovedPurchaseItem): boolean =>
  Number(item.cover_days ?? 0) < 1;

/** Закуп одного поставщика: с ним и поедет заказ. */
export interface SupplierGroup {
  supplier: string;
  items: PurchasePlanItem[];
  /** Сумма закупа — по ней сортируются группы. */
  cost: number;
}

/** Чем упорядочить поставщиков. */
export type SortMode = 'urgent' | 'cost' | 'name';

const UNKNOWN = 'Поставщик не определён';

/**
 * Раскладывает план по поставщикам, сохраняя порядок строк: первым идёт тот,
 * у кого лежит самое горящее — план и так отсортирован по срочности.
 */
export function groupBySupplier(items: readonly PurchasePlanItem[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();

  for (const item of items) {
    const supplier = item.supplier || UNKNOWN;
    const group = groups.get(supplier) ?? { supplier, items: [], cost: 0 };

    group.items.push(item);
    group.cost += Number(item.cost ?? 0);
    groups.set(supplier, group);
  }

  return [...groups.values()];
}

/**
 * Порядок поставщиков. «Сначала горящие» — тот порядок, в котором план пришёл
 * с сервера: строки уже отсортированы по срочности, значит и группы тоже.
 */
export function sortGroups(groups: SupplierGroup[], mode: SortMode): SupplierGroup[] {
  if (mode === 'cost') {
    return [...groups].sort((first, second) => second.cost - first.cost);
  }

  if (mode === 'name') {
    return [...groups].sort((first, second) => first.supplier.localeCompare(second.supplier, 'ru'));
  }

  return groups;
}
