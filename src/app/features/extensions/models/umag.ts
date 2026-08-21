import type { ExtensionTarget } from './extension';

/** Подключение сотрудника к своему кабинету UMAG. */
export interface UmagAccount {
  connected: boolean;
  /** Вход в UMAG — по номеру телефона. */
  phone: string;
  store_id: number | null;
  store_name: string;
  connected_at?: string;
  /** Приходит после входа и при смене магазина. */
  stores?: UmagStore[];
  /** На номер заведено несколько сотрудников — нужно выбрать, кто заходит. */
  users?: UmagUser[];
}

export interface UmagStore {
  id: number;
  name: string;
}

export interface UmagUser {
  id: number;
  label: string;
}

/**
 * Что не так со строкой перед отправкой.
 * `ok` — товар в UMAG нашёлся, остальное чинит человек.
 */
export type UmagLineStatus = 'ok' | 'no_barcode' | 'unknown_barcode' | 'no_price';

export interface UmagLine {
  id: number;
  position: number;
  name: string;
  barcode: string;
  status: UmagLineStatus;
  /** Карточка товара в UMAG: заполнена, когда строка сошлась по штрихкоду. */
  product_id: number | null;
  /** Название товара в UMAG — видно, что сопоставилось именно то. */
  product_name: string;
  measure: string;
  /** Остаток в магазине и цена на полке — прямо из карточки. */
  stock: number | null;
  selling_price: number | null;
  /** Товар, который ИИ выбрал по названию: его штрихкод предлагаем подставить. */
  suggested_barcode: string;
  suggested_name: string;
  /** Уверенность в сопоставлении: 1 — сошлось по штрихкоду, меньше — догадка ИИ. */
  confidence: number | null;
}

export interface UmagSupplier {
  name: string;
  agent_id: number | null;
  agent_name: string;
  /** Одноимённые контрагенты: в UMAG поставщики задвоены, выбирает человек. */
  candidates: UmagStore[];
}

export interface UmagPreflight {
  ready: boolean;
  supplier: UmagSupplier;
  lines: UmagLine[];
  problems: string[];
}

export interface UmagDraft {
  supply_id: number;
}

const LINE_NOTES: Record<UmagLineStatus, string> = {
  ok: 'Товар найден',
  no_barcode: 'Нет штрихкода',
  unknown_barcode: 'Штрихкода нет в UMAG',
  no_price: 'Нет количества или цены',
};

export const lineNote = (line: UmagLine): string => {
  if (line.status !== 'ok' || !line.product_name) {
    return LINE_NOTES[line.status];
  }

  // Остаток из карточки: видно, что сопоставился живой товар, а не однофамилец.
  return line.stock === null ? line.product_name : `${line.product_name} · остаток ${line.stock}`;
};

const percent = (confidence: number | null): string => `${Math.round((confidence ?? 0) * 100)}%`;

/** Подпись к подсказке: её ещё нужно подтвердить кнопкой. */
export const suggestionNote = (line: UmagLine): string =>
  line.confidence === null ? 'Подсказка' : `ИИ уверен на ${percent(line.confidence)}`;

/** Штрихкод в строку подставил ИИ — в бумаге его не было. */
export const isGuessed = (line: UmagLine): boolean =>
  line.status === 'ok' && line.confidence !== null && line.confidence < 1;

export const guessNote = (line: UmagLine): string =>
  `Штрихкод подставил ИИ · ${percent(line.confidence)}`;

/**
 * Ссылка на черновик приёмки в кабинете.
 *
 * Две ловушки, обе стоили нам «У Вас нет доступа к этой приёмке».
 *
 * Первая: в адресе стоит не номер магазина, а его **порядковый номер** в
 * списке магазинов кабинета. Маршрут объявлен как `store/:storeId`, но кладут
 * туда `storeIndex`, и у третьего магазина это `2`, а не `17797`.
 *
 * Вторая: страница называется `edit-template`, а не `edit`.
 */
export const supplyUrl = (id: number, storeIndex: number): string =>
  `https://web.umag.kz/store/${storeIndex}/supplies/${id}/edit-template`;

/** Порядковый номер магазина в кабинете — его и ждёт адрес приёмки. */
export const storeIndexOf = (targets: ExtensionTarget[] | undefined, storeId: number | null) => {
  const index = (targets ?? []).findIndex((target) => target.id === storeId);

  // Не нашли — пусть откроется первый магазин: пустая страница хуже.
  return index >= 0 ? index : 0;
};
