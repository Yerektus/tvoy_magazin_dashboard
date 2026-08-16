import type { Signal, Type } from '@angular/core';

import type { TextFieldType } from '../../../shared/components/text-field/text-field';

/** Соседнее расширение, без которого это не работает. */
export interface ExtensionLink {
  slug: string;
  name: string;
  logo: string;
}

/** Расширение из каталога бэкенда: витрина, а не настройки подключения. */
export interface Extension {
  /** Код: по нему находится реализация на фронте и адрес `/settings/<slug>`. */
  slug: string;
  name: string;
  /** Строка под названием. */
  summary: string;
  /** Абзацы описания. */
  description: string[];
  logo: string;
  /** Что даёт подключение. */
  features: string[];
  /** Что должно быть подключено до него: планированию нужен UMAG. */
  requires: ExtensionLink[];
  /** Кто стоит поверх: отключится вместе с ним. */
  required_by: ExtensionLink[];
}

/** Куда расширение пишет: магазин, склад, касса. */
export interface ExtensionTarget {
  id: number;
  name: string;
}

/** Кем заходим, если на одном логине заведено несколько людей. */
export interface ExtensionIdentity {
  id: number;
  label: string;
}

/** Состояние подключения — одинаковое для всех расширений. */
export interface ExtensionAccount {
  /** Вход есть и цель выбрана: расширение работает. */
  connected: boolean;
  /** Чем вошли: телефон или почта. */
  login: string;
  targetId: number | null;
  targetName: string;
  /** Приходят вместе с входом, чтобы не ходить за ними второй раз. */
  targets?: ExtensionTarget[];
  /** Сервис просит выбрать, кем заходим. */
  identities?: ExtensionIdentity[];
}

/** Что умеет расширение. Этого хватает каталогу, странице и окну входа. */
export interface ExtensionProvider {
  readonly account: Signal<ExtensionAccount | null>;
  load(): Promise<ExtensionAccount>;
  /**
   * Вход. Логин с паролем нужны не всем: надстройка над уже подключённым
   * сервисом включается просто так, и тогда аргументы приходят пустыми.
   */
  connect(login: string, password: string, identityId?: number): Promise<ExtensionAccount>;
  disconnect(): Promise<void>;
  /** Только у расширений, которым есть куда писать: у UMAG это магазины. */
  targets?(): Promise<ExtensionTarget[]>;
  chooseTarget?(id: number): Promise<ExtensionAccount>;
}

/** Подписи под конкретный сервис: у UMAG это телефон и магазин. */
export interface ExtensionLabels {
  /** Чем входят: «Номер телефона». */
  login: string;
  loginType: TextFieldType;
  /** Выдуманный образец: настоящий номер сотрудника в поле светить незачем. */
  loginPlaceholder: string;
  /** Одно значение в карточке состояния: «Магазин». */
  target: string;
  /** Заголовок списка: «Магазин для приёмок». */
  targets: string;
  /** «Кем заходим?» */
  identity: string;
  identityHint: string;
}

/**
 * Часть расширения, которая живёт в коде: сервис, который ходит по сети,
 * и подписи его формы входа. Описание и список возможностей — из базы.
 */
export interface ExtensionSetup {
  provider: Type<ExtensionProvider>;
  /** Пусто — расширение включается без логина и пароля, одной кнопкой. */
  labels?: ExtensionLabels;
}
