/** Реплика в переписке с аналитиком. */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  image: string | null;
  file: string | null;
  file_name: string | null;
  created_at: string;
  /** Следующие вопросы к ответу аналитика — их нажимают, а не читают. */
  suggestions?: string[];
  /** Адрес страницы с фильтрами, которые аналитик выставил сам. */
  screen?: string | null;
}

/** Переписка в истории: чем была и когда в ней говорили последний раз. */
export interface ChatSummary {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatBody {
  chat: ChatSummary | null;
  messages: ChatMessage[];
}

export interface ChatList {
  chats: ChatSummary[];
}

/**
 * Вопросы, с которых начинают, пока аналитик ещё ничего не ответил.
 * Дальше кнопки берём из ответа: там они про то же дело, а не про магазин вообще.
 */
export function starterQuestions(path: string): string[] {
  const parts = path.split(/[?#]/)[0]?.split('/').filter(Boolean) ?? [];
  const [section, ident] = parts;

  if (section === 'products' && ident) {
    return [
      'Сколько этого продали за месяц?',
      'Сколько заказать на неделю?',
      'Когда этот товар кончится?',
    ];
  }

  if (section === 'documents' && ident) {
    return ['Что в этой накладной?', 'Сходится ли она с кабинетом?', 'Кто поставщик?'];
  }

  if (section === 'documents') {
    return [
      'Сколько накладных за месяц?',
      'Кто главный поставщик?',
      'Какие ещё не проверены?',
    ];
  }

  if (section === 'purchases') {
    return [
      'Что заказать на неделю?',
      'Какие товары кончаются?',
      'Сколько это будет стоить?',
    ];
  }

  if (section === 'sales') {
    return [
      'Что продаётся лучше всего?',
      'Как продажи к прошлой неделе?',
      'В какие часы больше всего чеков?',
    ];
  }

  return [
    'Что заканчивается на полке?',
    'Что продаётся лучше всего?',
    'Сколько накладных за месяц?',
  ];
}

/** Название для списка. Пустое бывает у переписки из одного фото без слов. */
export const chatName = (chat: ChatSummary): string => chat.title.trim() || 'Без названия';

/** Только товары и продажи — модель сюда чужой адрес не подставит. */
const SCREEN = /^\/(products|sales)(\?[A-Za-z0-9._~&=%+-]*)?$/;

export function safeScreen(path: string | null | undefined): string | null {
  const value = (path ?? '').trim();
  return SCREEN.test(value) ? value : null;
}

/**
 * Когда реплику отправили — так, как это подписывают в переписке.
 * Сегодняшним хватает времени; у вчерашних и старше нужна дата.
 */
export function formatSentAt(value: string, now = new Date()): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const startOf = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const shift = Math.round((startOf(now).getTime() - startOf(date).getTime()) / 86_400_000);

  if (shift === 0) {
    return time;
  }

  if (shift === 1) {
    return `вчера, ${time}`;
  }

  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;

  return `${date.getDate()} ${month}${year}, ${time}`;
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;
