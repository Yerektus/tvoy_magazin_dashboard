import { Component, input } from '@angular/core';
import { type IconNode } from 'lucide';

import { Icon } from '../icon/icon';

/** Карточка метрики: подпись с иконкой и значение в слоте. */
@Component({
  selector: 'app-stat-card',
  imports: [Icon],
  templateUrl: './stat-card.html',
})
export class StatCard {
  readonly icon = input.required<IconNode>();
  readonly label = input.required<string>();
}
