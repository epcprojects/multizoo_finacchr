import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import * as pdfmake from 'pdfmake';
import type { Content, TableCell } from 'pdfmake/interfaces';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { fromPaisa, toPaisa } from '@multizoo/utils';

/**
 * The reporting suite's PDF engine: pdfmake, pure JavaScript, no browser —
 * tables that break across pages with their header rows repeated, landscape
 * pages for the wide grids, and a common header and footer. Every report
 * builds its body from the helpers here so they read as one set.
 */

const INK = '#16201B';
const SOFT = '#4A5750';
const FAINT = '#7C8A82';
const LINE = '#D9DFD4';
const HEAD_FILL = '#EEF2EC';
const TOTAL_FILL = '#F5F7F3';
export const ACCENT = '#1B6E52';
export const DANGER = '#A8433A';

// --- Fonts -----------------------------------------------------------------------------

/**
 * Roboto ships with pdfmake. The API is bundled by webpack, so the package
 * is found from the working directory (or `PDF_FONTS_DIR`), not from this
 * file's location.
 */
function fontsDir(): string {
  if (process.env.PDF_FONTS_DIR) return resolve(process.env.PDF_FONTS_DIR);
  const bases = [join(process.cwd(), 'package.json'), join(dirname(process.argv[1] ?? process.cwd()), 'package.json')];
  for (const base of bases) {
    try {
      const dir = join(dirname(createRequire(base).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
      if (existsSync(join(dir, 'Roboto-Regular.ttf'))) return dir;
    } catch {
      // try the next base
    }
  }
  throw new Error('Could not find the report fonts. Set PDF_FONTS_DIR to pdfmake/fonts/Roboto.');
}

let ready = false;
function init() {
  if (ready) return;
  const dir = fontsDir();
  pdfmake.setFonts({
    Roboto: {
      normal: join(dir, 'Roboto-Regular.ttf'),
      bold: join(dir, 'Roboto-Medium.ttf'),
      italics: join(dir, 'Roboto-Italic.ttf'),
      bolditalics: join(dir, 'Roboto-MediumItalic.ttf'),
    },
  });
  // Reports never fetch anything: no URLs, and only the fonts from disk.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((path: string) => resolve(path).startsWith(dir));
  ready = true;
}

// --- Formatting ----------------------------------------------------------------------------

/** "12160777.5" → "12,160,777.50"; negatives with a minus sign. `decimals: false` drops the paisa. */
export function money(amount: string | bigint | null | undefined, { decimals = true } = {}): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const text = typeof amount === 'bigint' ? fromPaisa(amount) : fromPaisa(toPaisa(amount));
  const negative = text.startsWith('-');
  const [whole, fraction] = text.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${decimals ? `${grouped}.${fraction}` : grouped}`;
}

/** Blank rather than 0.00 — for sparse grids. */
export function moneyOrBlank(amount: string | null | undefined, opts?: { decimals?: boolean }): string {
  if (!amount || toPaisa(amount) === 0n) return '';
  return money(amount, opts);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** "2026-09-23" → "23 Sep 2026". */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** "2026-09" → "September 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function dateRange(from: string, to: string): string {
  return from === to ? date(from) : `${date(from)} – ${date(to)}`;
}

/** "12.5" → "+12.5%", null → "—". */
export function pct(value: string | null | undefined, { signed = true } = {}): string {
  if (value === null || value === undefined) return '—';
  if (!signed) return `${value}%`;
  return value.startsWith('-') ? `−${value.slice(1)}%` : `+${value}%`;
}

export function when(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${MONTH_SHORT[Number(get('month')) - 1]} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

// --- Building blocks ---------------------------------------------------------------------------

export type Align = 'left' | 'right' | 'center';

export interface Column {
  header: string;
  /** '*', 'auto' or points. */
  width?: number | string;
  align?: Align;
}

/** A cell: plain text, or text with emphasis. */
export type Cell =
  | string
  | number
  | { text: string; bold?: boolean; color?: string; italics?: boolean; colSpan?: number; fillColor?: string; margin?: [number, number, number, number] };

/** A sub-account under its heading. */
export function indented(text: string, extra: { bold?: boolean; italics?: boolean } = {}): Cell {
  return { text, margin: [10, 0, 0, 0], ...extra };
}

export interface TableOptions {
  columns: Column[];
  rows: Cell[][];
  /** Bold rows at the foot, shaded. */
  totals?: Cell[][];
  /** Rows to shade as sub-headings (index into rows). */
  headingRows?: number[];
  fontSize?: number;
  /** Shown instead of an empty table. */
  empty?: string;
  /** Tighter rows — a 31-day grid on one page. */
  compact?: boolean;
}

function toCell(cell: Cell, align: Align | undefined, extra: Record<string, unknown> = {}): TableCell {
  const base = typeof cell === 'object' ? { ...cell } : { text: String(cell ?? '') };
  return { alignment: align ?? 'left', ...base, ...extra } as TableCell;
}

/** A ruled table whose header row repeats on every page. */
export function table({ columns, rows, totals = [], headingRows = [], fontSize = 8, empty, compact = false }: TableOptions): Content {
  if (!rows.length && !totals.length && empty) return note(empty);
  const header = columns.map((c) =>
    toCell({ text: c.header, bold: true }, c.align, { fillColor: HEAD_FILL, color: INK, fontSize: fontSize - 0.5 }),
  );
  const heading = new Set(headingRows);
  const body = rows.map((r, i) =>
    r.map((cell, j) => toCell(cell, columns[j]?.align, heading.has(i) ? { bold: true, fillColor: TOTAL_FILL } : {})),
  );
  const foot = totals.map((r) => r.map((cell, j) => toCell(cell, columns[j]?.align, { bold: true, fillColor: TOTAL_FILL })));
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: columns.map((c) => c.width ?? 'auto'),
      body: [header, ...body, ...foot],
    },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => (compact ? 1 : 2.5),
      paddingBottom: () => (compact ? 1 : 2.5),
    },
    fontSize,
    margin: [0, 0, 0, 10],
  } as Content;
}

export function heading(text: string, sub?: string): Content {
  return {
    stack: [
      { text, fontSize: 11.5, bold: true, color: INK },
      ...(sub ? [{ text: sub, fontSize: 8, color: SOFT, margin: [0, 1, 0, 0] }] : []),
    ],
    margin: [0, 6, 0, 5],
  } as Content;
}

export function note(text: string): Content {
  return { text, fontSize: 8, color: SOFT, italics: true, margin: [0, 0, 0, 8] } as Content;
}

export function paragraph(text: string): Content {
  return { text, fontSize: 8.5, color: SOFT, margin: [0, 0, 0, 8] } as Content;
}

/** A row of headline figures: "Total cash  12,345,678". */
export function figures(items: { label: string; value: string; tone?: 'danger' | 'accent' }[]): Content {
  const perRow = Math.min(items.length, 5) || 1;
  const rows: Content[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    const slice = items.slice(i, i + perRow);
    while (slice.length < perRow) slice.push({ label: '', value: '' });
    rows.push(
      slice.map((f) => ({
        stack: [
          { text: f.label, fontSize: 7.5, color: FAINT },
          { text: f.value, fontSize: 12, bold: true, color: f.tone === 'danger' ? DANGER : f.tone === 'accent' ? ACCENT : INK },
        ],
        margin: [0, 0, 0, 0],
      })),
    );
  }
  return {
    table: { widths: Array(perRow).fill('*'), body: rows },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      fillColor: () => TOTAL_FILL,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 0, 0, 10],
  } as Content;
}

/** Label / value pairs in two columns — a payslip's particulars. */
export function details(pairs: [string, string][]): Content {
  const half = Math.ceil(pairs.length / 2);
  const col = (list: [string, string][]) => ({
    table: {
      widths: [90, '*'],
      body: list.map(([k, v]) => [
        { text: k, color: FAINT, fontSize: 8 },
        { text: v || '—', fontSize: 8.5 },
      ]),
    },
    layout: 'noBorders',
  });
  return { columns: [col(pairs.slice(0, half)), col(pairs.slice(half))], columnGap: 16, margin: [0, 0, 0, 10] } as Content;
}

export function pageBreak(): Content {
  return { text: '', pageBreak: 'after' } as Content;
}

// --- The document ---------------------------------------------------------------------------------

export interface DocumentInput {
  title: string;
  subtitle: string;
  landscape: boolean;
  content: Content[];
  generatedAt: Date;
  generatedBy: string;
  /** False for reports with no money in them (attendance). */
  amounts?: boolean;
}

export function documentDefinition({ title, subtitle, landscape, content, generatedAt, generatedBy, amounts = true }: DocumentInput): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [32, 78, 32, 40],
    info: { title: `${title} — ${subtitle}`, author: 'Multizoo Group Ledger Platform', creator: 'Multizoo Group Ledger Platform' },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: INK, lineHeight: 1.15 },
    header: (_page: number, _count: number, size: { width: number }) =>
      ({
        margin: [32, 22, 32, 0],
        stack: [
          {
            columns: [
              {
                width: '*',
                stack: [
                  { text: 'MULTIZOO GROUP', fontSize: 7, bold: true, color: ACCENT, characterSpacing: 1.2 },
                  { text: title, fontSize: 14, bold: true, color: INK, margin: [0, 2, 0, 0] },
                  { text: subtitle, fontSize: 8.5, color: SOFT, margin: [0, 1, 0, 0] },
                ],
              },
              {
                width: 'auto',
                alignment: 'right',
                stack: [
                  { text: `Generated ${when(generatedAt)} PKT`, fontSize: 7, color: FAINT },
                  { text: generatedBy, fontSize: 7, color: FAINT },
                  ...(amounts ? [{ text: 'Amounts in Pakistani rupees', fontSize: 7, color: FAINT }] : []),
                ],
              },
            ],
          },
          { canvas: [{ type: 'line', x1: 0, y1: 6, x2: size.width - 64, y2: 6, lineWidth: 1, lineColor: ACCENT }] },
        ],
      }) as Content,
    footer: (page: number, count: number) =>
      ({
        margin: [32, 12, 32, 0],
        columns: [
          { text: 'Multizoo Group Ledger Platform — computed from the ledger when generated', fontSize: 7, color: FAINT },
          { text: `Page ${page} of ${count}`, fontSize: 7, color: FAINT, alignment: 'right' },
        ],
      }) as Content,
    content,
  };
}

export async function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  init();
  const doc = pdfmake.createPdf(definition);
  return (await doc.getBuffer()) as Buffer;
}
