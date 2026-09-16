import { Component, input } from '@angular/core';

/** Карточка метрики: подпись и значение в слоте. */
@Component({
  selector: 'app-stat-card',
  templateUrl: './stat-card.html',
})
export class StatCard {
  readonly label = input.required<string>();
}
