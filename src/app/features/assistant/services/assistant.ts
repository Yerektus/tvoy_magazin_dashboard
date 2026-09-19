import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../../../shared/services/api-config';
import {
  type ChatBody,
  type ChatList,
  type ChatMessage,
  type ChatSummary,
} from '../models/chat';

/**
 * Переписки с аналитиком: открытая и все прошлые.
 *
 * Историю держит сервер: разговор продолжается с телефона и из кабинета, а в
 * браузере ему храниться незачем. Панель при этом общая для всех страниц —
 * закрыли на товарах, открыли на закупах, переписка на месте.
 */
@Injectable({ providedIn: 'root' })
export class Assistant {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/assistant`;

  private readonly panelOpen = signal(false);
  private readonly messageList = signal<ChatMessage[]>([]);
  private readonly chatList = signal<ChatSummary[]>([]);
  private readonly currentId = signal<number | null>(null);
  private readonly loadingState = signal(false);
  private readonly thinkingState = signal(false);
  private readonly loadError = signal<string | null>(null);
  private readonly draftText = signal('');

  /**
   * Следующий вопрос начинает новую переписку, а не продолжает последнюю.
   * Нужно только между «начать заново» и первым вопросом.
   */
  private fresh = false;
  private loaded = false;

  readonly open = this.panelOpen.asReadonly();
  readonly messages = this.messageList.asReadonly();
  readonly chats = this.chatList.asReadonly();
  readonly chatId = this.currentId.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  /** Вопрос ушёл, ответа ещё нет. Пока аналитик думает, переписку видно. */
  readonly thinking = this.thinkingState.asReadonly();
  readonly error = this.loadError.asReadonly();
  readonly draft = this.draftText.asReadonly();

  toggle(): void {
    if (this.panelOpen()) {
      this.close();
      return;
    }

    this.panelOpen.set(true);
    void this.ensureLoaded();
  }

  close(): void {
    this.panelOpen.set(false);
  }

  /** Выход: чужая переписка не должна остаться в памяти вкладки. */
  reset(): void {
    this.panelOpen.set(false);
    this.messageList.set([]);
    this.chatList.set([]);
    this.currentId.set(null);
    this.loadingState.set(false);
    this.thinkingState.set(false);
    this.loadError.set(null);
    this.draftText.set('');
    this.fresh = false;
    this.loaded = false;
  }

  setDraft(text: string): void {
    this.draftText.set(text);
  }

  /** Открывает переписку, в которой говорили последней. */
  async load(): Promise<void> {
    await this.fetchChat(`${this.url}/chat/`);
  }

  /** Открывает переписку из истории. */
  async openChat(id: number): Promise<void> {
    await this.fetchChat(`${this.url}/chats/${id}/`);
  }

  /**
   * Начать разговор заново. Пустая переписка серверу не нужна: новая
   * заведётся сама вместе с первым вопросом.
   */
  startNew(): void {
    this.messageList.set([]);
    this.currentId.set(null);
    this.fresh = true;
    this.loadError.set(null);
  }

  async loadHistory(): Promise<void> {
    const body = await this.request<ChatList>('get', `${this.url}/chats/`);
    this.chatList.set(body.chats);
  }

  /**
   * Убирает переписку из истории. Если убрали открытую — на экране остаётся
   * новая: показывать реплики того, чего уже нет, нельзя.
   */
  async remove(id: number): Promise<void> {
    await this.request<void>('delete', `${this.url}/chats/${id}/`);
    this.chatList.update((chats) => chats.filter((chat) => chat.id !== id));

    if (this.currentId() === id) {
      this.startNew();
    }
  }

  /**
   * Задаёт вопрос. Реплику показываем сразу: аналитик думает секунды, и всё
   * это время человек должен видеть, что его услышали.
   */
  async ask(page?: { title: string; path: string }): Promise<void> {
    const question = this.draftText().trim();

    if (!question || this.thinkingState()) {
      return;
    }

    const optimistic: ChatMessage = {
      id: -Date.now(),
      role: 'user',
      text: question,
      image: null,
      created_at: new Date().toISOString(),
    };

    this.draftText.set('');
    this.messageList.update((messages) => [...messages, optimistic]);
    this.thinkingState.set(true);

    try {
      const shown = this.messageList().filter((message) => message !== optimistic);
      const body = await this.request<ChatBody>('post', `${this.url}/chat/`, {
        text: question,
        ...(this.currentId() !== null ? { chat: this.currentId() } : {}),
        ...(this.fresh ? { fresh: true } : {}),
        ...(page?.path || page?.title ? { page } : {}),
      });

      this.currentId.set(body.chat?.id ?? null);
      this.fresh = false;
      this.loaded = true;
      this.messageList.set([...shown, ...body.messages]);
    } catch (error) {
      this.messageList.update((messages) => messages.filter((message) => message !== optimistic));
      this.draftText.set(question);
      throw error instanceof Error ? error : new Error('Не удалось спросить');
    } finally {
      this.thinkingState.set(false);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded || this.loadingState()) {
      return;
    }

    await this.load();
  }

  private async fetchChat(path: string): Promise<void> {
    this.loadingState.set(true);
    this.loadError.set(null);

    try {
      this.take(await this.request<ChatBody>('get', path));
      this.fresh = false;
      this.loaded = true;
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Не удалось загрузить');
    } finally {
      this.loadingState.set(false);
    }
  }

  private take(body: ChatBody): void {
    this.currentId.set(body.chat?.id ?? null);
    this.messageList.set(body.messages);
    this.loaded = true;
  }

  private async request<T>(method: 'get' | 'post' | 'delete', url: string, body?: unknown): Promise<T> {
    try {
      const call =
        method === 'get'
          ? this.http.get<T>(url)
          : method === 'delete'
            ? this.http.delete<T>(url)
            : this.http.post<T>(url, body);

      return await firstValueFrom(call);
    } catch (error) {
      throw new Error(describe(error));
    }
  }
}

function describe(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Не удалось связаться с сервером';
  }

  if (error.status === 0) {
    return 'Сервер недоступен. Проверьте, запущен ли API.';
  }

  const detail = (error.error as { detail?: unknown } | null)?.detail;

  return typeof detail === 'string' && detail.trim() ? detail : `Ошибка сервера (${error.status})`;
}
