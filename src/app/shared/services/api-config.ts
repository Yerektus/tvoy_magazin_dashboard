import { environment } from '../../../environments/environment';

/**
 * Адрес бэкенда «Твоего магазина». Значение приходит из окружения: при сборке
 * для разработки Angular подменяет `environment.ts` на `environment.development.ts`.
 */
export const API_BASE_URL = environment.apiUrl;
