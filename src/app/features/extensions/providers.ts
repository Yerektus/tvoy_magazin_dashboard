import { Planning } from '../purchases/services/planning';
import { type ExtensionSetup } from './models/extension';
import { Umag } from './services/umag';

/**
 * Реализации расширений по коду из базы. Само расширение заводится в админке,
 * а сюда добавляется его сервис — без кода подключаться всё равно нечем.
 */
const SETUPS: Record<string, ExtensionSetup> = {
  umag: {
    provider: Umag,
    labels: {
      login: 'Номер телефона',
      loginType: 'tel',
      loginPlaceholder: '+7 (700) 000-00-00',
      target: 'Магазин',
      targets: 'Магазин для приёмок',
      identity: 'Кем заходим?',
      identityHint: 'На этот номер в UMAG заведено несколько сотрудников.',
    },
  },

  // Надстройка над UMAG: своего входа нет, включается одной кнопкой.
  planning: {
    provider: Planning,
  },
};

/** Пусто — расширение есть в каталоге, но подключать его пока нечем. */
export const setupFor = (slug: string): ExtensionSetup | null => SETUPS[slug] ?? null;
