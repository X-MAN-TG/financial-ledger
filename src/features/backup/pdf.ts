/**
 * Client-side PDF generation (15-pdf-export.txt).
 *
 * HARD CONSTRAINT (15 s1): the Worker never renders PDFs. It only serves
 * JSON from /api/export/*; everything here runs in the browser. This module
 * is imported dynamically so jsPDF is never in the initial bundle (15 s2).
 *
 * Print styling is always light/print-safe regardless of the app theme
 * (17 s4) - paper is white.
 */
import type { jsPDF } from 'jspdf';
import type {
  ColumnDefinition,
  ExportDayPayload,
  ExportFullPage,
  Transaction,
} from '../../../shared/types';
import { apiGet, apiPost } from '../../lib/api';
import { formatDateLong, formatDateMedium, formatMoney } from '../../lib/format';

type DayExportResponse = ExportDayPayload & {
  profile: { displayName: string; fullName: string | null };
  columns: ColumnDefinition[];
};

/* Print-safe palette - deliberately not theme tokens. */
const INK = '#14181f';
const MUTED = '#6b7380';
const RULE = '#d8dde4';
const HEAD_BG = '#f1f3f6';
const ACCENT = '#24457f';

const MARGIN = 40;

async function createDoc(): Promise<{ doc: jsPDF; autoTable: typeof import('jspdf-autotable').default }> {
  const [{ jsPDF: JsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  return { doc, autoTable: autoTableMod.default };
}

function header(doc: jsPDF, title: string, subtitle: string, right?: string): number {
  const w = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(INK);
  doc.text(title, MARGIN, 46);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(MUTED);
  doc.text(subtitle, MARGIN, 62);

  if (right) {
    doc.setFontSize(9);
    doc.text(right, w - MARGIN, 46, { align: 'right' });
  }

  doc.setDrawColor(RULE);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, 74, w - MARGIN, 74);
  return 92;
}

/** Page numbers + a generation stamp on every page (15 s3). */
function paginate(doc: jsPDF, label: string): void {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(label, MARGIN, h - 22);
    doc.text(`Page ${i} of ${pages}`, w - MARGIN, h - 22, { align: 'right' });
  }
}

function money(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : formatMoney(v, 'INR', { symbol: false });
}

function buildHead(customColumns: ColumnDefinition[]): string[] {
  return [
    'Sr',
    'Customer Name',
    'INR',
    'Recd',
    'USDT',
    'Final RUB',
    'Extras',
    'Done',
    ...customColumns.map((c) => c.label),
  ];
}

function buildBody(rows: Transaction[], customColumns: ColumnDefinition[]): string[][] {
  return rows.map((t, i) => [
    String(t.srNumber || i + 1),
    t.customerNameSnapshot ?? '—',
    money(t.inrAmount),
    t.inrReceived ? 'Yes' : '—',
    money(t.usdtAmount),
    money(t.finalRubAmount),
    money(t.extrasAmount),
    t.orderDone ? 'Yes' : '—',
    ...customColumns.map((c) => t.customValues?.[c.key] ?? '—'),
  ]);
}

function tableOptions(customColumns: ColumnDefinition[]) {
  const numeric = { halign: 'right' as const, cellWidth: 68 };
  const centered = { halign: 'center' as const, cellWidth: 40 };
  const styles: Record<number, Record<string, unknown>> = {
    0: { halign: 'center', cellWidth: 30 },
    1: { cellWidth: 'auto' },
    2: numeric,
    3: centered,
    4: numeric,
    5: numeric,
    6: numeric,
    7: centered,
  };
  customColumns.forEach((_, i) => {
    styles[8 + i] = { cellWidth: 62 };
  });
  return styles;
}

/**
 * Notes render as a keyed appendix rather than inline, so the money columns
 * keep their alignment on the page (15 s3).
 */
function notesAppendix(
  doc: jsPDF,
  rows: Transaction[],
  startY: number,
): number {
  const noted = rows.filter((t) => t.note && t.note.trim());
  if (noted.length === 0) return startY;

  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  let y = startY + 18;

  if (y > h - 90) {
    doc.addPage();
    y = 60;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(INK);
  doc.text('Notes', MARGIN, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const t of noted) {
    const text = doc.splitTextToSize(`Sr ${t.srNumber}: ${t.note}`, w - MARGIN * 2);
    if (y + text.length * 11 > h - 50) {
      doc.addPage();
      y = 60;
    }
    doc.setTextColor(MUTED);
    doc.text(text, MARGIN, y);
    y += text.length * 11 + 4;
  }
  return y;
}

function totalsStrip(
  doc: jsPDF,
  totals: ExportDayPayload['totals'],
  y: number,
): number {
  const w = doc.internal.pageSize.getWidth();
  const boxY = y + 6;
  const boxH = 44;

  doc.setFillColor(HEAD_BG);
  doc.setDrawColor(RULE);
  doc.roundedRect(MARGIN, boxY, w - MARGIN * 2, boxH, 4, 4, 'FD');

  const cells: Array<[string, string]> = [
    ['INR', money(totals.totalInr)],
    ['USDT', money(totals.totalUsdt)],
    ['FINAL RUB', money(totals.totalRub)],
    ['EXTRAS', money(totals.totalExtras)],
    ['COMPLETED', `${totals.completedCount} / ${totals.rowCount}`],
  ];
  const colW = (w - MARGIN * 2) / cells.length;

  cells.forEach(([label, value], i) => {
    const x = MARGIN + colW * i + 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    doc.text(label, x, boxY + 17);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(INK);
    doc.text(value, x, boxY + 33);
  });

  return boxY + boxH;
}

/* ------------------------------------------------------------ daily PDF --- */

export async function generateDayPdf(date: string): Promise<void> {
  const data = await apiGet<DayExportResponse>(`/api/export/day/${date}`);
  const { doc, autoTable } = await createDoc();
  const custom = data.columns.filter((c) => !c.isSystem && c.isActive);

  const y = header(
    doc,
    'Daily Ledger',
    `${formatDateLong(data.date)}${data.status === 'DAY_OFF' ? '  ·  Day Off' : ''}`,
    data.profile.displayName,
  );

  if (data.transactions.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text(
      data.status === 'DAY_OFF' ? 'Day Off — no trading recorded.' : 'No transactions recorded.',
      MARGIN,
      y + 10,
    );
  } else {
    autoTable(doc, {
      startY: y,
      head: [buildHead(custom)],
      body: buildBody(data.transactions, custom),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: RULE, lineWidth: 0.4 },
      headStyles: { fillColor: HEAD_BG, textColor: INK, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: '#fbfcfd' },
      columnStyles: tableOptions(custom),
      margin: { left: MARGIN, right: MARGIN },
    });

    const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    const afterTotals = totalsStrip(doc, data.totals, afterTable);
    notesAppendix(doc, data.transactions, afterTotals);
  }

  paginate(doc, `Generated ${formatDateMedium(new Date().toISOString().slice(0, 10))} · ${data.profile.displayName}`);
  doc.save(`ledger-${data.date}.pdf`);
  await apiPost('/api/backup/export', { type: 'PDF', status: 'SUCCESS' }).catch(() => {});
}

/* ------------------------------------------------------- full history PDF - */

export interface PdfProgress {
  page: number;
  totalPages: number;
  daysDone: number;
  totalDays: number;
}

/**
 * Assembles the full-history document incrementally from the paginated
 * export endpoint, reporting progress so the UI never freezes (15 s4).
 */
export async function generateFullPdf(
  onProgress?: (p: PdfProgress) => void,
  signal?: { cancelled: boolean },
): Promise<void> {
  const { doc, autoTable } = await createDoc();

  let page = 1;
  let totalDays = 0;
  let daysDone = 0;
  let first = true;
  let profileName = '';
  let custom: ColumnDefinition[] = [];
  let grand: ExportDayPayload['totals'] | null = null;
  let firstDate = '';
  let lastDate = '';

  // Loop the paginated endpoint until every day has been appended.
  for (;;) {
    if (signal?.cancelled) throw new Error('CANCELLED');

    const res = await apiGet<ExportFullPage>(`/api/export/full?page=${page}&pageSize=10`);
    totalDays = res.totalDays;
    profileName = res.profile.displayName;
    custom = res.columns.filter((c) => !c.isSystem && c.isActive);
    grand = res.grandTotals;

    if (first) {
      if (res.days.length === 0) throw new Error('NO_DATA');
      firstDate = res.days[0].date;
      // Cover page.
      header(doc, 'Ledger — Full History', profileName, formatDateMedium(new Date().toISOString().slice(0, 10)));
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(MUTED);
      doc.text(`${totalDays} day${totalDays === 1 ? '' : 's'} of records`, MARGIN, 104);
      first = false;
    }

    for (const day of res.days) {
      if (signal?.cancelled) throw new Error('CANCELLED');
      lastDate = day.date;
      appendDaySection(doc, autoTable, day, custom);
      daysDone += 1;
      onProgress?.({ page, totalPages: Math.ceil(totalDays / 10), daysDone, totalDays });
      // Yield so the browser can paint the progress update.
      await new Promise((r) => setTimeout(r, 0));
    }

    if (res.days.length === 0 || daysDone >= totalDays) break;
    page += 1;
  }

  // Grand totals summary, appended at the end where it reads as a closing
  // statement rather than a header the reader has no context for yet.
  if (grand) {
    doc.addPage();
    const y = header(doc, 'All-Time Summary', `${formatDateMedium(firstDate)} — ${formatDateMedium(lastDate)}`, profileName);
    totalsStrip(doc, grand, y);
  }

  paginate(doc, `Generated ${formatDateMedium(new Date().toISOString().slice(0, 10))} · ${profileName}`);
  doc.save(`ledger-full-history.pdf`);
}

function appendDaySection(
  doc: jsPDF,
  autoTable: typeof import('jspdf-autotable').default,
  day: ExportDayPayload,
  custom: ColumnDefinition[],
): void {
  const h = doc.internal.pageSize.getHeight();
  const prev = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let y = prev ? prev.finalY + 26 : 112;

  if (y > h - 130) {
    doc.addPage();
    y = 60;
  }

  // Day Off renders as one compact line, never an empty table (15 s4).
  if (day.status === 'DAY_OFF' && day.transactions.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    doc.text(formatDateLong(day.date), MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text('Day Off', MARGIN + 190, y);
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable = { finalY: y + 4 };
    return;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(ACCENT);
  doc.text(formatDateLong(day.date), MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text(
    `INR ${money(day.totals.totalInr)}   USDT ${money(day.totals.totalUsdt)}   RUB ${money(day.totals.totalRub)}   Extras ${money(day.totals.totalExtras)}   ·   ${day.totals.completedCount}/${day.totals.rowCount} completed`,
    MARGIN,
    y + 13,
  );

  autoTable(doc, {
    startY: y + 22,
    head: [buildHead(custom)],
    body: buildBody(day.transactions, custom),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: INK, lineColor: RULE, lineWidth: 0.4 },
    headStyles: { fillColor: HEAD_BG, textColor: INK, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: '#fbfcfd' },
    columnStyles: tableOptions(custom),
    margin: { left: MARGIN, right: MARGIN },
  });
}
