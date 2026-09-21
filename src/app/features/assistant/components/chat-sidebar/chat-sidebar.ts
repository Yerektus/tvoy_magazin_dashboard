import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { ArrowRight, ChevronLeft, FileSpreadsheet, List, MapPin, SquarePen, Trash2, X } from 'lucide';
import { filter, map } from 'rxjs';

import { Auth } from '../../../auth/services/auth';
import { Avatar } from '../../../../shared/components/avatar/avatar';
import { Button } from '../../../../shared/components/button/button';
import { Icon } from '../../../../shared/components/icon/icon';
import { Spinner } from '../../../../shared/components/spinner/spinner';
import { Confirm } from '../../../../shared/services/confirm';
import { PageHeader } from '../../../../shared/services/page-header';
import { Toasts } from '../../../../shared/services/toasts';
import { chatName, formatSentAt, safeScreen, starterQuestions, type ChatSummary } from '../../models/chat';
import { Assistant } from '../../services/assistant';
import { ChatMarkdown } from '../chat-markdown/chat-markdown';

type PanelView = 'chat' | 'history';

const WIDTH_KEY = 'assistant-sidebar-width';
const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 320;
/** Как `chat-sidebar-motion` у панели: чат показываем, только когда она доехала. */
const OPEN_MS = 300;

/**
 * Правая панель разговора с аналитиком. Открывается с любой страницы кнопкой
 * в шапке; сама переписка общая — при переходах не сбрасывается.
 *
 * Ширину на большом экране тянут за левый край: на телефоне панель и так
 * почти на весь экран, регулировать там нечего.
 */
@Component({
  selector: 'app-chat-sidebar',
  imports: [Avatar, Button, Icon, Spinner, ChatMarkdown],
  templateUrl: './chat-sidebar.html',
  host: {
    class:
      'chat-sidebar-motion fixed inset-y-0 right-0 z-50 w-full overflow-hidden bg-white lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-0 lg:shrink-0',
    '[class.translate-x-0]': 'assistant.open()',
    '[class.translate-x-full]': '!assistant.open()',
    '[class.lg:translate-x-0]': 'true',
    '[class.lg:!transition-none]': 'dragging()',
    '[class.border-l]': 'assistant.open()',
    '[class.border-neutral-200]': 'assistant.open()',
    '[style.width]': 'hostWidth()',
    '[attr.inert]': '!assistant.open() ? true : null',
    '[attr.aria-hidden]': '!assistant.open()',
    '(document:keydown.escape)': 'onEscape()',
    '(window:resize)': 'clampToWindow()',
    '(transitionend)': 'onPanelTransitionEnd($event)',
  },
})
export class ChatSidebar {
  protected readonly assistant = inject(Assistant);
  private readonly auth = inject(Auth);
  private readonly confirm = inject(Confirm);
  private readonly toasts = inject(Toasts);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly header = inject(PageHeader);

  protected readonly view = signal<PanelView>('chat');
  protected readonly historyLoading = signal(false);
  protected readonly sendError = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly width = signal(readWidth());
  /**
   * Панель уже на месте. До этого чат не рисуем: иначе он сжимается, пока
   * ширина едет от нуля, или едет вместе с выездом на телефоне.
   */
  protected readonly ready = signal(false);

  private readonly desktop = signal(isDesktop());
  private dragStartX = 0;
  private dragStartWidth = DEFAULT_WIDTH;
  private revealTimer = 0;

  /**
   * На телефоне ширину не задаём пикселями: панель `fixed` и `w-full`, иначе
   * сохранённые 600px со компьютера выталкивают страницу. На большом экране
   * закрытая панель схлопывается в ноль, открытая — выбранной ширины.
   */
  protected readonly hostWidth = computed(() => {
    if (!this.desktop()) {
      return null;
    }

    return `${this.assistant.open() ? this.width() : 0}px`;
  });

  protected readonly closeIcon = X;
  protected readonly historyIcon = List;
  protected readonly newIcon = SquarePen;
  protected readonly backIcon = ChevronLeft;
  protected readonly removeIcon = Trash2;
  protected readonly pageIcon = MapPin;
  protected readonly promptIcon = ArrowRight;
  protected readonly fileIcon = FileSpreadsheet;

  /**
   * Имя над своим вопросом — как «Помощник» над ответом. Без него реплики
   * сливаются: оба текста на всю ширину, и не сразу видно, чья это строка.
   */
  protected readonly senderName = computed(() => {
    const name = this.auth.user()?.name.trim();

    return name || 'Вы';
  });

  private readonly routeUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Как страница называется в шапке: на деталях это имя накладной или товара,
   * а не общее «Накладная». Отсюда же подпись бейджа у поля ввода.
   */
  protected readonly pageBadge = computed(() => {
    this.routeUrl();
    const crumbs = this.header.crumbs();
    const last = crumbs.at(-1);

    if (last?.label) {
      return last.label;
    }

    return routeTitle(this.router);
  });

  /**
   * С чего начать, пока аналитик ещё ничего не ответил. После ответа кнопки
   * живут в самой реплике — там они про то же дело.
   */
  protected readonly starters = computed(() => {
    if (this.assistant.thinking() || this.assistant.messages().length) {
      return [];
    }

    return starterQuestions(this.routeUrl().split(/[?#]/)[0] ?? '/');
  });

  protected readonly chatName = chatName;
  protected readonly formatSentAt = formatSentAt;

  /**
   * Только что отправленный вопрос и только что пришедший ответ: их
   * показываем с появлением. Прошлые реплики при открытии истории не дёргаем.
   */
  protected readonly sendingId = signal<number | null>(null);
  protected readonly arrivingId = signal<number | null>(null);
  private wasThinking = false;

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  constructor() {
    const media = window.matchMedia('(min-width: 1024px)');
    const onMedia = () => this.desktop.set(media.matches);
    media.addEventListener('change', onMedia);
    this.destroyRef.onDestroy(() => {
      media.removeEventListener('change', onMedia);
      this.clearDragCursor();
      window.clearTimeout(this.revealTimer);
    });

    effect(() => {
      this.assistant.messages();
      this.assistant.thinking();
      this.assistant.open();
      this.view();

      untracked(() => queueMicrotask(() => this.scrollToBottom()));
    });

    effect(() => {
      if (this.assistant.open() && this.view() === 'chat' && this.ready()) {
        untracked(() => queueMicrotask(() => this.focusField()));
      }
    });

    effect(() => {
      const open = this.assistant.open();
      untracked(() => this.scheduleReveal(open));
    });

    effect(() => {
      const thinking = this.assistant.thinking();
      const messages = this.assistant.messages();

      untracked(() => {
        if (thinking && !this.wasThinking) {
          const last = messages.at(-1);

          if (last?.role === 'user') {
            this.sendingId.set(last.id);
          }

          this.arrivingId.set(null);
        } else if (!thinking && this.wasThinking) {
          const last = messages.at(-1);

          if (last?.role === 'assistant') {
            this.arrivingId.set(last.id);
          }

          this.sendingId.set(null);
        }

        this.wasThinking = thinking;
      });
    });

    effect(() => {
      const arriving = this.arrivingId();
      const messages = this.assistant.messages();

      if (!arriving) {
        return;
      }

      const last = messages.at(-1);

      if (last?.id === arriving && last.screen) {
        untracked(() => this.openScreen(last.screen));
      }
    });
  }

  protected startResize(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragging.set(true);
    this.dragStartX = event.clientX;
    this.dragStartWidth = this.width();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  protected onResize(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    // Левый край: тянем влево — панель шире.
    this.width.set(clampWidth(this.dragStartWidth + (this.dragStartX - event.clientX)));
  }

  protected endResize(): void {
    if (!this.dragging()) {
      return;
    }

    this.dragging.set(false);
    this.clearDragCursor();
    writeWidth(this.width());
  }

  protected resetWidth(): void {
    this.width.set(DEFAULT_WIDTH);
    writeWidth(DEFAULT_WIDTH);
  }

  protected clampToWindow(): void {
    const next = clampWidth(this.width());

    if (next === this.width()) {
      return;
    }

    this.width.set(next);
    writeWidth(next);
  }

  protected onPanelTransitionEnd(event: TransitionEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (!this.assistant.open()) {
      return;
    }

    if (event.propertyName !== 'width' && event.propertyName !== 'transform') {
      return;
    }

    this.ready.set(true);
  }

  private scheduleReveal(open: boolean): void {
    window.clearTimeout(this.revealTimer);

    if (!open) {
      this.ready.set(false);
      return;
    }

    if (prefersReducedMotion()) {
      this.ready.set(true);
      return;
    }

    this.revealTimer = window.setTimeout(() => this.ready.set(true), OPEN_MS);
  }

  protected onEscape(): void {
    if (this.confirm.request() || !this.assistant.open()) {
      return;
    }

    this.assistant.close();
  }

  protected async showHistory(): Promise<void> {
    this.view.set('history');
    this.historyLoading.set(true);

    try {
      await this.assistant.loadHistory();
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось загрузить историю');
      this.view.set('chat');
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected backToChat(): void {
    this.view.set('chat');
  }

  protected startNew(): void {
    if (!this.assistant.messages().length) {
      return;
    }

    this.assistant.startNew();
    this.view.set('chat');
    this.sendError.set(null);
    this.focusField();
  }

  protected async openChat(id: number): Promise<void> {
    this.view.set('chat');
    this.sendError.set(null);
    await this.assistant.openChat(id);
    this.focusField();
  }

  protected async removeChat(event: Event, chat: ChatSummary): Promise<void> {
    event.stopPropagation();

    const agreed = await this.confirm.ask({
      title: 'Удалить переписку?',
      message: 'Её нельзя будет вернуть.',
      confirmLabel: 'Удалить',
      danger: true,
    });

    if (!agreed) {
      return;
    }

    try {
      await this.assistant.remove(chat.id);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : 'Не удалось удалить');
    }
  }

  protected onDraft(event: Event): void {
    const field = event.target as HTMLTextAreaElement;
    this.assistant.setDraft(field.value);
    this.resize(field);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void this.send();
  }

  protected askPrompt(text: string): void {
    if (!text.trim() || this.assistant.thinking()) {
      return;
    }

    this.assistant.setDraft(text);
    void this.send();
  }

  protected async send(): Promise<void> {
    if (!this.assistant.draft().trim() || this.assistant.thinking()) {
      return;
    }

    this.sendError.set(null);

    try {
      await this.assistant.ask({
        title: this.pageBadge(),
        path: this.routeUrl().split('#')[0] ?? '/',
      });
      this.resetField();
    } catch (error) {
      this.sendError.set(error instanceof Error ? error.message : 'Аналитик не ответил');
    }
  }

  protected retry(): void {
    void this.assistant.load();
  }

  private scrollToBottom(): void {
    const el = this.thread()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  private focusField(): void {
    this.field()?.nativeElement.focus();
  }

  private resetField(): void {
    const field = this.field()?.nativeElement;
    if (field) {
      field.style.height = '';
    }
  }

  private openScreen(path: string | null | undefined): void {
    const screen = safeScreen(path);

    if (!screen) {
      return;
    }

    const current = this.router.url.split('#')[0];

    if (current === screen) {
      return;
    }

    void this.router.navigateByUrl(screen);
  }

  private resize(field: HTMLTextAreaElement): void {
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }

  private clearDragCursor(): void {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}

function routeTitle(router: Router): string {
  let route: ActivatedRouteSnapshot = router.routerState.snapshot.root;
  let title = route.title ?? '';

  while (route.firstChild) {
    route = route.firstChild;
    title = route.title ?? title;
  }

  return title;
}

function isDesktop(): boolean {
  return window.matchMedia('(min-width: 1024px)').matches;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.min(800, window.innerWidth - 360));
}

function clampWidth(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));
}

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));

  if (!Number.isFinite(raw)) {
    return DEFAULT_WIDTH;
  }

  return clampWidth(raw);
}

function writeWidth(value: number): void {
  localStorage.setItem(WIDTH_KEY, String(value));
}
