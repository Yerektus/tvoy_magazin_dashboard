import { type DailySold } from '../models/product';

/** Общая палитра графиков товара: голубой — факт, оранжевый — прогноз. */
export const BLUE = '#4BA3E8';
export const BLUE_HOVER = '#3B91D4';
export const BLUE_BAR = '#8EC4EE';
export const BLUE_BAR_HOVER = '#74B4E8';
export const AMBER = '#E08A3C';
export const BLUE_RGB = [75, 163, 232] as const;
export const AMBER_RGB = [224, 138, 60] as const;
export const GRID = '#EEEEEE';
export const MUTED = '#A3A3A3';
export const FONT = 'Inter Variable, Inter, system-ui, sans-serif';

export type Rgb = readonly [number, number, number];

/** Количество из дневной строки: с сервера оно приходит строкой. */
export function soldOf(row: DailySold): number {
  const value = Number.parseFloat(String(row.sold ?? '').replace(',', '.'));

  return Number.isFinite(value) ? value : 0;
}

/** Подпись дня на оси и в подсказке: «16 июл.». */
export function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
