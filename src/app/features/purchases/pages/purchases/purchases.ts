import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ArrowRight, ChevronRight, Plus, Trash2 } from 'lucide';

import { Button } from '../../../../shared/components/button/button';
import { Empty } from '../../../../shared/components/empty/empty';
import { Icon } from '../../../../shared/components/icon/icon';
import { Menu } from '../../../../shared/components/menu/menu';
import { MenuItem } from '../../../../shared/components/menu/menu-item';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Table } from '../../../../shared/components/table/table';
import { TableColumn } from '../../../../shared/components/table/table-column';
import { Toolbar } from '../../../../shared/components/toolbar/toolbar';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { Umag } from '../../../extensions/services/umag';
import { CreatePlanDialog } from '../../components/create-plan-dialog/create-plan-dialog';
import {
  type ApprovedPurchase,
  type ApprovedPurchaseItem,
  type PurchasePlan,
  formatApprovedAt,
  formatAmount,
  formatCover,
  formatDate,
  formatMoney,
  formatTime,
  horizonLabel,
  isOut,
  planTitle,
  statusClasses,
  statusIcon,
  statusLabel,
} from '../../models/plan';
import { Planning } from '../../services/planning';

/** Пока план считается, список спрашиваем так же часто, как карточку. */
const POLL_INTERVAL = 2500;

/** Столько же длится `accordion-out` в `styles.css`. */
const COLLAPSE_MS = 200;

/** Вкладки списка: таблица планировок и одобренные закупки. */
const TABS: Record<string, 'plan' | 'approved'> = {
  План: 'plan',
  Одобренные: 'approved',
};

/**
 * Список планировок: новые создают из окна, готовую открывают как накладную.
 */
@Component({
  selector: 'app-purchases',
  imports: [
    Button,
    CreatePlanDialog,
    Empty,
    Icon,
    Menu,
    MenuItem,
    RouterLink,
    Spinner,
    Table,
    TableColumn,
    Toolbar,
  ],
  templateUrl: './purchases.html',
})
export class Purchases {
  protected readonly addIcon = Plus;
  protected readonly openIcon = ArrowRight;
  protected readonly chevronIcon = ChevronRight;
  protected readonly removeIcon = Trash2;

  protected readonly formatAmount = formatAmount;
  protected readonly formatApprovedAt = formatApprovedAt;
  protected readonly formatCover = formatCover;
  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;
  protected readonly formatTime = formatTime;
  protected readonly horizonLabel = horizonLabel;
  protected readonly isOut = isOut;
  protected readonly planTitle = planTitle;
  protected readonly statusClasses = statusClasses;
  protected readonly statusIcon = statusIcon;
  protected readonly statusLabel = statusLabel;

  protected readonly plans = signal<PurchasePlan[]>([]);
  protected readonly approved = signal<ApprovedPurchase[]>([]);
  protected readonly loading = signal(true);
  protected readonly dialogOpen = signal(false);

  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  private readonly closing = signal<ReadonlySet<string>>(new Set());
  protected readonly visible = computed(() => new Set([...this.opened(), ...this.closing()]));

  protected readonly trackPlan = (plan: PurchasePlan) => plan.id;
  protected readonly trackApproved = (purchase: ApprovedPurchase) => purchase.id;
  protected readonly trackItem = (item: ApprovedPurchaseItem) => item.position;

  private readonly planning = inject(Planning);
  private readonly umag = inject(Umag);
  private readonly header = inject(PageHeader);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly confirm = inject(Confirm);

  protected readonly connected = this.planning.connected;

  /**
   * Магазин, выбранный в шапке: планировки всегда по нему. `undefined` — про
   * UMAG ещё не спрашивали, и список рано грузить.
   */
  private readonly store = computed(() => this.umag.account()?.targetId);

  protected readonly tab = computed(() => TABS[this.header.activeTab() ?? ''] ?? 'plan');
  protected readonly onPlan = computed(() => this.tab() === 'plan');
  protected readonly onApproved = computed(() => this.tab() === 'approved');

  protected readonly emptyText = computed(() =>
    this.onPlan() ? 'Планировок пока нет — создайте первую' : 'Одобренных закупок пока нет',
  );

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly collapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private version = 0;

  constructor() {
    this.header.setTabs(Object.keys(TABS));

    effect(() => {
      const locked = !this.loading() && !this.connected();

      untracked(() => this.header.setTabs(locked ? [] : Object.keys(TABS)));
    });

    effect(() => {
      if (!this.onApproved()) {
        return;
      }

      this.approved();
      this.stopCollapsing();
      this.opened.set(new Set());
    });

    effect(() => {
      this.header.setBadges({ Одобренные: this.approved().length });
    });

    effect(() => {
      if (this.store() !== undefined) {
        untracked(() => void this.load());
      }
    });

    void this.start();

    inject(DestroyRef).onDestroy(() => {
      this.stopPolling();
      this.stopCollapsing();
      this.header.clear();
    });
  }

  protected toggle(key: string): void {
    this.clearCollapseTimer(key);

    if (!this.opened().has(key)) {
      this.closing.update((current) => without(current, key));
      this.opened.update((current) => added(current, key));
      return;
    }

    this.opened.update((current) => without(current, key));
    this.closing.update((current) => added(current, key));

    this.collapseTimers.set(
      key,
      setTimeout(() => {
        this.collapseTimers.delete(key);
        this.closing.update((current) => without(current, key));
      }, COLLAPSE_MS),
    );
  }

  protected open(plan: PurchasePlan): void {
    void this.router.navigate(['/purchases', plan.id]);
  }

  protected onCreated(plan: PurchasePlan): void {
    this.dialogOpen.set(false);
    void this.router.navigate(['/purchases', plan.id]);
  }

  protected async remove(plan: PurchasePlan): Promise<void> {
    const agreed = await this.confirm.ask({
      title: 'Удалить планировку?',
      message: `«${planTitle(plan)}» пропадёт из списка вместе с рассчитанными позициями.`,
      confirmLabel: 'Удалить',
      danger: true,
    });

    if (!agreed) {
      return;
    }

    try {
      await this.planning.remove(plan.id);
      this.plans.update((current) => current.filter((item) => item.id !== plan.id));
      this.toasts.success('Планировка удалена');
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось удалить планировку');
    }
  }

  private async start(): Promise<void> {
    if (this.umag.account() !== null) {
      return;
    }

    try {
      await this.umag.load();
    } catch (error) {
      if (this.umag.account() === null) {
        this.loading.set(false);
        this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть планировки');
      }
    }
  }

  private async load(): Promise<void> {
    const version = ++this.version;

    this.stopPolling();
    this.loading.set(true);
    this.plans.set([]);
    this.approved.set([]);

    try {
      if (this.planning.account() === null) {
        await this.planning.load();
      }

      const [plans, approved] = await Promise.all([
        this.planning.plans(),
        this.planning.approved(),
      ]);

      if (version !== this.version) {
        return;
      }

      this.plans.set(plans);
      this.approved.set(approved);
      this.poll();
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.toasts.error(error instanceof Error ? error.message : 'Не удалось открыть планировки');
    } finally {
      if (version === this.version) {
        this.loading.set(false);
      }
    }
  }

  private poll(): void {
    this.stopPolling();

    if (!this.plans().some((plan) => plan.status === 'building')) {
      return;
    }

    const version = this.version;

    this.pollTimer = setTimeout(async () => {
      try {
        const plans = await this.planning.plans();

        if (version !== this.version) {
          return;
        }

        this.plans.set(plans);
      } catch {
        // Сеть моргнула — попробуем на следующем круге.
      }

      this.poll();
    }, POLL_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private clearCollapseTimer(key: string): void {
    const timer = this.collapseTimers.get(key);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.collapseTimers.delete(key);
    }
  }

  private stopCollapsing(): void {
    for (const timer of this.collapseTimers.values()) {
      clearTimeout(timer);
    }

    this.collapseTimers.clear();
    this.closing.set(new Set());
  }
}

function added(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  return new Set(current).add(value);
}

function without(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current);
  next.delete(value);

  return next;
}
