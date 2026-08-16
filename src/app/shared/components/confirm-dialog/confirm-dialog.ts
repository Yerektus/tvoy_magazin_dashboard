import { Component, computed, inject } from '@angular/core';

import { Confirm } from '../../services/confirm';
import { Button } from '../button/button';
import { Modal } from '../modal/modal';

/** Окно подтверждения. Живёт один раз, в корне приложения. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal, Button],
  templateUrl: './confirm-dialog.html',
})
export class ConfirmDialog {
  protected readonly confirm = inject(Confirm);

  protected readonly open = computed(() => this.confirm.request() !== null);
}
