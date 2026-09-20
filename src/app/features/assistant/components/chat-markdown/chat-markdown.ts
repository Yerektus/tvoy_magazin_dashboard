import { Component, computed, input } from '@angular/core';

export type MdSpan = { text: string; bold: boolean };

export type MdBlock =
  | { type: 'p'; spans: MdSpan[] }
  | { type: 'ul'; items: MdSpan[][] }
  | { type: 'table'; head: string[]; rows: string[][] };

/**
 * Жирный и обычный текст без пробелов из шаблона. У абзаца стоит
 * `pre-wrap`, и перевод строки вокруг `{{ span.text }}` становился
 * пустой строкой и отступом в начале ответа.
 */
@Component({
  selector: 'app-md-spans',
  template: `@for (span of spans(); track $index) {@if (span.bold) {<strong class="font-semibold">{{ span.text }}</strong>} @else {<span>{{ span.text }}</span>}}`,
  host: { class: 'contents' },
})
export class MdSpans {
  readonly spans = input.required<MdSpan[]>();
}

/**
 * Скупая разметка ответа аналитика: жирный, списки и таблицы. Чужой HTML
 * сюда не попадает — только текст, разобранный в блоки.
 */
@Component({
  selector: 'app-chat-markdown',
  imports: [MdSpans],
  template: `
    <div class="flex flex-col gap-2 text-sm break-words text-neutral-900">
      @for (block of blocks(); track $index) {
        @switch (block.type) {
          @case ('p') {
            <p class="whitespace-pre-wrap"><app-md-spans [spans]="block.spans" /></p>
          }
          @case ('ul') {
            <ul class="flex list-disc flex-col gap-1 pl-4">
              @for (item of block.items; track $index) {
                <li><app-md-spans [spans]="item" /></li>
              }
            </ul>
          }
          @case ('table') {
            <div class="overflow-x-auto">
              <table class="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    @for (cell of block.head; track $index) {
                      <th
                        class="border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                      >
                        {{ cell }}
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of block.rows; track $index) {
                    <tr>
                      @for (cell of row; track $index) {
                        <td class="border border-neutral-200 px-2 py-1.5 whitespace-nowrap">
                          {{ cell }}
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    </div>
  `,
})
export class ChatMarkdown {
  readonly text = input.required<string>();

  protected readonly blocks = computed(() => parseMarkdown(this.text()));
}

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const blocks: MdBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    if (isTableRow(lines[index])) {
      const rows: string[][] = [];

      while (index < lines.length && isTableRow(lines[index])) {
        const cells = splitRow(lines[index]);
        index += 1;

        if (cells.every((cell) => /^[-:]+$/.test(cell))) {
          continue;
        }

        rows.push(cells);
      }

      if (rows.length === 1) {
        blocks.push({ type: 'p', spans: spans(rows[0].join(' · ')) });
      } else if (rows.length > 1) {
        const [head, ...body] = rows;
        blocks.push({ type: 'table', head, rows: body });
      }

      continue;
    }

    if (isListItem(lines[index])) {
      const items: MdSpan[][] = [];

      while (index < lines.length && isListItem(lines[index])) {
        items.push(spans(lines[index].replace(/^\s*[-—*•]\s+/, '')));
        index += 1;
      }

      blocks.push({ type: 'ul', items });
      continue;
    }

    const paragraph: string[] = [];

    while (index < lines.length && lines[index].trim() && !isListItem(lines[index]) && !isTableRow(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }

    blocks.push({ type: 'p', spans: spans(paragraph.join('\n')) });
  }

  return blocks;
}

function isTableRow(line: string): boolean {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isListItem(line: string): boolean {
  return /^\s*[-—*•]\s+\S/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function spans(text: string): MdSpan[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}
