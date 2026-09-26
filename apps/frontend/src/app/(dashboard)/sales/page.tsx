'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import { PlusIcon } from '../../../components/ui/icons';
import { MonthPicker, NoticeLine, Pill, Section, Tabs, UnitPicker, type Notice } from '../../../components/hr/ui';
import SalesItemModal from '../../../components/sales/SalesItemModal';
import SalesEventModal from '../../../components/sales/SalesEventModal';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import {
  compareEvent,
  formatPct,
  getSalesBreakup,
  getSalesGrid,
  getSalesStats,
  getYearOverYear,
  listSalesDays,
  listSalesEvents,
  listSalesItems,
  openSalesDay,
  type EventComparison,
  type SalesBreakup,
  type SalesDaySummary,
  type SalesEventRecord,
  type SalesGrid,
  type SalesItemRecord,
  type SalesStats,
  type YearOverYear,
} from '../../../lib/api/sales';
import { errorMessage, formatDate, formatMoney, todayIso } from '../../../lib/money';
import PdfButton from '../../../components/reports/PdfButton';

const TABS = ['Days', 'Daily grid', 'By item', 'Year on year', 'Eid & events', 'Price list'] as const;
type Tab = (typeof TABS)[number];
const REPORT_TABS: Tab[] = ['Daily grid', 'By item', 'Year on year', 'Eid & events'];

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2';
const num = 'text-right tabular-nums';
const money = (v: string | null | undefined) => (v == null ? '' : formatMoney(v, { decimals: false, prefix: false }));
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Sales & ticketing (architecture plan Part 03 §9, Fig. 11). A unit's day is
 * entered item by item (Qty × Rate) and posted as money in; the grid, the
 * category breakup, year on year and the Eid comparison are all live views
 * over the same posted lines — no separately kept pivots.
 */
export default function SalesPage() {
  const router = useRouter();
  const { hasPermission, hasAnyPermission } = useUser();
  const canEnter = hasPermission('transactions.create_own_unit');
  const canReport = hasAnyPermission(['ledger.view', 'pnl.view_consolidated']);
  const canManage = hasPermission('sales.manage');
  const tabs = TABS.filter((t) => canReport || !REPORT_TABS.includes(t));

  const [tab, setTab] = useState<Tab>('Days');
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [unitId, setUnitId] = useState('');
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    void listBusinessUnits().then((u) => {
      const active = u.filter((x) => x.isActive && !x.isHolding);
      setUnits(active);
      if (active.length === 1) setUnitId(active[0].id);
    });
    getSalesStats().then(setStats, () => setStats(null));
  }, []);

  const unit = units.find((u) => u.id === unitId) ?? null;
  const thisYear = Number(todayIso().slice(0, 4));
  const years = Array.from({ length: thisYear - 2021 }, (_, i) => thisYear - i);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/sales-icon.svg"
            imageAlt="Sales"
            title="Sales"
            stats={[
              { title: 'Today', count: stats ? formatMoney(stats.today, { decimals: false }) : '…', color: '#34D399' },
              { title: 'This month', count: stats ? formatMoney(stats.month, { decimals: false }) : '…', color: '#60A5FA' },
              { title: 'This year', count: stats ? formatMoney(stats.year, { decimals: false }) : '…', color: '#A78BFA' },
              {
                title: 'Year to date vs last year',
                count: stats?.yearToDate ? formatPct(stats.yearToDate.pct) : '…',
                color: '#F5A623',
              },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title={<Tabs tabs={tabs} value={tab} onChange={setTab} counts={{ Days: stats?.drafts ?? 0 }} />}
          actions={
            <>
              {tab !== 'Days' && tab !== 'Price list' && (
                <PdfButton report="sales" params={{ year, businessUnitId: unitId }} label={`Sales ${year} PDF`} />
              )}
              {canEnter && (
                <Button icon={<PlusIcon />} onClick={() => setOpening(true)}>
                  Enter sales
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-72">
              <UnitPicker units={units} value={unitId} onChange={setUnitId} allowAll={tab !== 'Price list'} label="Unit" />
            </div>
            {tab === 'Days' ? (
              <MonthPicker value={month} onChange={setMonth} max={todayIso().slice(0, 7)} />
            ) : tab !== 'Price list' && tab !== 'Eid & events' ? (
              <div className="sm:w-36">
                <Select label="Year" value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ label: String(y), value: String(y) }))} />
              </div>
            ) : null}
          </div>

          {tab === 'Days' && <DaysTab unitId={unitId} month={month} onError={(text) => setNotice({ tone: 'error', text })} />}
          {tab === 'Daily grid' && <GridTab unitId={unitId} year={year} onError={(text) => setNotice({ tone: 'error', text })} />}
          {tab === 'By item' && <BreakupTab unitId={unitId} year={year} onError={(text) => setNotice({ tone: 'error', text })} />}
          {tab === 'Year on year' && <YoyTab unitId={unitId} year={year} onError={(text) => setNotice({ tone: 'error', text })} />}
          {tab === 'Eid & events' && <EventsTab unitId={unitId} canManage={canManage} onError={(text) => setNotice({ tone: 'error', text })} />}
          {tab === 'Price list' && <PriceListTab unit={unit} canManage={canManage} onNotice={setNotice} />}
        </Section>
      </div>

      <OpenDayModal
        isOpen={opening}
        units={units}
        presetUnitId={unitId}
        onClose={() => setOpening(false)}
        onOpen={async (u, date) => {
          const day = await openSalesDay(u, date);
          router.push(`/sales/days/${day.id}`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function OpenDayModal({ isOpen, units, presetUnitId, onClose, onOpen }: {
  isOpen: boolean;
  units: BusinessUnitRecord[];
  presetUnitId: string;
  onClose: () => void;
  onOpen: (unitId: string, date: string) => Promise<void>;
}) {
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUnitId(presetUnitId || (units.length === 1 ? units[0].id : ''));
    setDate(todayIso());
    setError(null);
  }, [isOpen, presetUnitId, units]);

  async function submit() {
    if (!unitId) return setError('Choose the unit.');
    setBusy(true);
    setError(null);
    try {
      await onOpen(unitId, date);
    } catch (err) {
      setError(errorMessage(err, 'Could not open the day.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Enter sales"
      subtitle="Opens the day’s sheet — a draft until it’s posted"
      size="small"
      showFooter
      onConfirm={submit}
      confirmLabel={busy ? 'Opening…' : 'Open the day'}
      confirmDisabled={busy}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <UnitPicker label="Unit" units={units} value={unitId} onChange={setUnitId} />
        <Input label="Date" type="date" required value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Modal>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500">{children}</p>;
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[], onError: (t: string) => void): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    fn().then(
      (d) => live && setData(d),
      (err) => live && onError(errorMessage(err, 'Could not load.')),
    );
    return () => {
      live = false;
    };
  }, deps);
  return data;
}

function DaysTab({ unitId, month, onError }: { unitId: string; month: string; onError: (t: string) => void }) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = useLoad<SalesDaySummary[]>(
    () => listSalesDays({ businessUnitId: unitId || undefined, from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }),
    [unitId, month],
    onError,
  );
  if (!days) return <Empty>Loading…</Empty>;
  if (!days.length) return <Empty>No sales entered for this month yet.</Empty>;
  const posted = days.filter((d) => d.status === 'POSTED');
  const sum = (f: (d: SalesDaySummary) => number) => posted.reduce((s, d) => s + f(d), 0);
  const total = posted.reduce((s, d) => s + BigInt(Math.round(Number(d.total) * 100)), 0n);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-180 text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-900">
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Unit</th>
            <th className={`${th} text-right`}>Lines</th>
            <th className={`${th} text-right`}>Adults</th>
            <th className={`${th} text-right`}>Kids</th>
            <th className={`${th} text-right`}>Sales</th>
            <th className={th}>Status</th>
            <th className={th}>Entry</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.id} className="border-t border-gray-200 hover:bg-gray-50">
              <td className={td}>
                <Link href={`/sales/days/${d.id}`} className="font-medium text-gray-900 hover:text-accent">
                  {formatDate(d.salesDate)}
                </Link>
              </td>
              <td className={td}>{d.businessUnit.code}</td>
              <td className={`${td} ${num}`}>{d.lineCount}</td>
              <td className={`${td} ${num}`}>{d.adults || ''}</td>
              <td className={`${td} ${num}`}>{d.kids || ''}</td>
              <td className={`${td} ${num} font-medium`}>{formatMoney(d.total)}</td>
              <td className={td}>{d.status === 'POSTED' ? <Pill tone="green">Posted</Pill> : <Pill tone="amber">Draft</Pill>}</td>
              <td className={`${td} font-mono text-xs`}>{d.entry?.displayNo ?? ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
          <tr>
            <td className={td} colSpan={3}>
              Posted this month ({posted.length} {posted.length === 1 ? 'day' : 'days'})
            </td>
            <td className={`${td} ${num}`}>{sum((d) => d.adults) || ''}</td>
            <td className={`${td} ${num}`}>{sum((d) => d.kids) || ''}</td>
            <td className={`${td} ${num}`}>{formatMoney(total)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GridTab({ unitId, year, onError }: { unitId: string; year: number; onError: (t: string) => void }) {
  const grid = useLoad<SalesGrid>(() => getSalesGrid(year, unitId), [unitId, year], onError);
  if (!grid) return <Empty>Loading…</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <span>
          Grand total <b className="tabular-nums">{formatMoney(grid.total)}</b>
        </span>
        <span>
          Average per day with sales{' '}
          <b className="tabular-nums">{grid.averagePerSalesDay ? formatMoney(grid.averagePerSalesDay) : '—'}</b>{' '}
          <span className="text-gray-500">({grid.daysWithSales} days)</span>
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[1100px] text-left text-xs">
          <thead className="bg-gray-50 text-gray-900">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-2 py-2 font-semibold">Date</th>
              {grid.months.map((m) => (
                <th key={m.month} className="px-2 py-2 text-right font-semibold">
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 31 }, (_, d) => (
              <tr key={d} className="border-t border-gray-100">
                <td className="sticky left-0 bg-white px-2 py-1 text-gray-600">{ordinal(d + 1)}</td>
                {grid.months.map((m) => (
                  <td key={m.month} className={clsx('px-2 py-1', num, d + 1 > m.daysInMonth && 'bg-gray-50')}>
                    {money(m.days[d])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50">
            <tr className="font-semibold">
              <td className="sticky left-0 bg-gray-50 px-2 py-1.5">Total sales</td>
              {grid.months.map((m) => (
                <td key={m.month} className={`px-2 py-1.5 ${num}`}>
                  {money(m.total)}
                </td>
              ))}
            </tr>
            <tr className="text-gray-700">
              <td className="sticky left-0 bg-gray-50 px-2 py-1.5" title="The month's total over its calendar days, as the sheet does (÷31, ÷28 …)">
                Monthly avg / day
              </td>
              {grid.months.map((m) => (
                <td key={m.month} className={`px-2 py-1.5 ${num}`}>
                  {money(m.averagePerDay)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BreakupTab({ unitId, year, onError }: { unitId: string; year: number; onError: (t: string) => void }) {
  const b = useLoad<SalesBreakup>(() => getSalesBreakup(year, unitId), [unitId, year], onError);
  if (!b) return <Empty>Loading…</Empty>;
  if (!b.items.length) return <Empty>No posted sales in {year}.</Empty>;
  const key = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
  const cell = (v?: { amount: string; quantity: number }) =>
    v ? (
      <>
        <span className="block">{money(v.amount)}</span>
        {v.quantity > 0 && <span className="block text-[11px] text-gray-500">{v.quantity.toLocaleString()}</span>}
      </>
    ) : null;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[1200px] text-left text-xs">
        <thead className="bg-gray-50 text-gray-900">
          <tr>
            <th className="sticky left-0 bg-gray-50 px-2 py-2 font-semibold">Item</th>
            {MONTHS.map((m) => (
              <th key={m} className="px-2 py-2 text-right font-semibold">
                {m}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-semibold">Year</th>
          </tr>
        </thead>
        <tbody>
          {b.items.map((i) => (
            <tr key={i.item} className="border-t border-gray-100 align-top">
              <td className="sticky left-0 bg-white px-2 py-1.5">
                <span className="block font-medium text-gray-900">{i.item}</span>
                {i.category && <span className="block text-[11px] text-gray-500">{i.category}</span>}
              </td>
              {MONTHS.map((_, m) => (
                <td key={m} className={`px-2 py-1.5 ${num}`}>
                  {cell(i.months[key(m + 1)])}
                </td>
              ))}
              <td className={`px-2 py-1.5 ${num} font-semibold`}>{cell({ amount: i.amount, quantity: i.quantity })}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
          <tr className="align-top">
            <td className="sticky left-0 bg-gray-50 px-2 py-1.5">Total</td>
            {MONTHS.map((_, m) => (
              <td key={m} className={`px-2 py-1.5 ${num}`}>
                {cell(b.months.find((x) => x.month === key(m + 1)))}
              </td>
            ))}
            <td className={`px-2 py-1.5 ${num}`}>{cell({ amount: b.total, quantity: b.quantity })}</td>
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-2 text-xs text-gray-500">Amount, with the number sold beneath it.</p>
    </div>
  );
}

function PctCell({ pct }: { pct: string | null }) {
  return <span className={clsx(pct?.startsWith('-') ? 'text-danger' : pct ? 'text-green-700' : 'text-gray-400')}>{formatPct(pct)}</span>;
}

function YoyTab({ unitId, year, onError }: { unitId: string; year: number; onError: (t: string) => void }) {
  const y = useLoad<YearOverYear>(() => getYearOverYear(year, unitId), [unitId, year], onError);
  if (!y) return <Empty>Loading…</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {y.toDate && (
        <p className="text-sm text-gray-700">
          1 January to today: <b className="tabular-nums">{formatMoney(y.toDate.current)}</b> against{' '}
          <span className="tabular-nums">{formatMoney(y.toDate.previous)}</span> over the same days of {year - 1} —{' '}
          <b>
            <PctCell pct={y.toDate.pct} />
          </b>
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-150 text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-900">
            <tr>
              <th className={th}>Month</th>
              <th className={`${th} text-right`}>{year}</th>
              <th className={`${th} text-right`}>{year - 1}</th>
              <th className={`${th} text-right`}>Change</th>
              <th className={`${th} text-right`}>%</th>
            </tr>
          </thead>
          <tbody>
            {y.months.map((m) => (
              <tr key={m.month} className="border-t border-gray-200">
                <td className={td}>{m.name}</td>
                <td className={`${td} ${num}`}>{money(m.current)}</td>
                <td className={`${td} ${num} text-gray-600`}>{money(m.previous)}</td>
                <td className={`${td} ${num}`}>{money(m.change)}</td>
                <td className={`${td} ${num}`}>
                  <PctCell pct={m.pct} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <tr>
              <td className={td}>Year</td>
              <td className={`${td} ${num}`}>{money(y.current)}</td>
              <td className={`${td} ${num}`}>{money(y.previous)}</td>
              <td className={`${td} ${num}`}>{money(y.change)}</td>
              <td className={`${td} ${num}`}>
                <PctCell pct={y.pct} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function EventsTab({ unitId, canManage, onError }: { unitId: string; canManage: boolean; onError: (t: string) => void }) {
  const [events, setEvents] = useState<SalesEventRecord[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [editing, setEditing] = useState<SalesEventRecord | 'new' | null>(null);
  const [cmp, setCmp] = useState<EventComparison | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const list = await listSalesEvents();
      setEvents(list);
      setEventId((cur) => cur || list.find((e) => e.isActive)?.id || '');
    } catch (err) {
      onError(errorMessage(err, 'Could not load events.'));
    }
  }, [onError]);

  useEffect(() => {
    void loadEvents();
  }, []);

  useEffect(() => {
    if (!eventId) return;
    setCmp(null);
    compareEvent(eventId, unitId).then(setCmp, (err) => onError(errorMessage(err, 'Could not load the comparison.')));
  }, [eventId, unitId]);

  const event = events?.find((e) => e.id === eventId) ?? null;
  const years = useMemo(() => (cmp ? cmp.totals.map((t) => t.year) : []), [cmp]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-72">
          <Select label="Event" value={eventId} onChange={setEventId} options={(events ?? []).map((e) => ({ label: e.name, value: e.id }))} />
        </div>
        {canManage && (
          <div className="flex gap-2">
            {event && (
              <Button variant="secondary" onClick={() => setEditing(event)}>
                Edit dates
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing('new')}>
              New event
            </Button>
          </div>
        )}
      </div>
      {!events ? (
        <Empty>Loading…</Empty>
      ) : !event ? (
        <Empty>No events yet.</Empty>
      ) : !cmp ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Day 1 to day {cmp.days} of {event.name}, year against year
            {unitId ? '' : ' (every unit you can see, added together)'}. Footfall counts the adult and child tickets on the price list.
          </p>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-gray-50 text-gray-900">
                <tr>
                  <th rowSpan={2} className="sticky left-0 bg-gray-50 px-2 py-2 font-semibold">
                    Eid day
                  </th>
                  {years.map((yr) => (
                    <th key={yr} colSpan={3} className="border-l border-gray-200 px-2 py-2 text-center font-semibold">
                      {yr}
                    </th>
                  ))}
                </tr>
                <tr>
                  {years.map((yr) => (
                    <FragmentHeads key={yr} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.day} className="border-t border-gray-100">
                    <td className="sticky left-0 bg-white px-2 py-1 text-gray-700">{ordinal(r.day)} day</td>
                    {years.map((yr) => {
                      const c = r.byYear[yr];
                      return (
                        <FragmentCells key={yr} title={c ? formatDate(c.date) : ''} values={[money(c?.amount), c?.adults?.toLocaleString() ?? '', c?.kids?.toLocaleString() ?? '']} />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                <tr className="font-semibold">
                  <td className="sticky left-0 bg-gray-50 px-2 py-1.5">Total</td>
                  {cmp.totals.map((t) => (
                    <FragmentCells key={t.year} values={[money(t.amount), t.adults.toLocaleString(), t.kids.toLocaleString()]} />
                  ))}
                </tr>
                <tr>
                  <td className="sticky left-0 bg-gray-50 px-2 py-1.5" title="Over the days that had sales">
                    Average / day
                  </td>
                  {cmp.totals.map((t) => (
                    <FragmentCells key={t.year} values={[money(t.averagePerDay), `${t.daysWithSales} days`, '']} />
                  ))}
                </tr>
                <tr>
                  <td className="sticky left-0 bg-gray-50 px-2 py-1.5">On the year before</td>
                  {cmp.totals.map((t) => (
                    <FragmentCells
                      key={t.year}
                      values={
                        t.change
                          ? [formatPct(t.change.pct), `${t.change.adults >= 0 ? '+' : '−'}${Math.abs(t.change.adults).toLocaleString()}`, `${t.change.kids >= 0 ? '+' : '−'}${Math.abs(t.change.kids).toLocaleString()}`]
                          : ['', '', '']
                      }
                    />
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {event.notes && <p className="text-xs text-gray-500">{event.notes}</p>}
        </>
      )}
      <SalesEventModal
        isOpen={editing !== null}
        event={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(e) => {
          setEditing(null);
          setEventId(e.id);
          void loadEvents();
        }}
      />
    </div>
  );
}

function FragmentHeads() {
  return (
    <>
      <th className="border-l border-gray-200 px-2 py-1.5 text-right font-medium text-gray-600">Income</th>
      <th className="px-2 py-1.5 text-right font-medium text-gray-600">Adults</th>
      <th className="px-2 py-1.5 text-right font-medium text-gray-600">Kids</th>
    </>
  );
}

function FragmentCells({ values, title }: { values: string[]; title?: string }) {
  return (
    <>
      {values.map((v, i) => (
        <td key={i} title={title} className={clsx('px-2 py-1', num, i === 0 && 'border-l border-gray-200')}>
          {v}
        </td>
      ))}
    </>
  );
}

function PriceListTab({ unit, canManage, onNotice }: { unit: BusinessUnitRecord | null; canManage: boolean; onNotice: (n: Notice) => void }) {
  const [items, setItems] = useState<SalesItemRecord[] | null>(null);
  const [editing, setEditing] = useState<SalesItemRecord | 'new' | null>(null);

  const refresh = useCallback(async () => {
    if (!unit) return setItems(null);
    try {
      setItems(await listSalesItems({ businessUnitId: unit.id, includeInactive: true }));
    } catch (err) {
      onNotice({ tone: 'error', text: errorMessage(err, 'Could not load the price list.') });
    }
  }, [unit, onNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!unit) return <Empty>Choose a unit to see its price list.</Empty>;
  const categories = [...new Set((items ?? []).map((i) => i.category))].sort();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">What {unit.name} sells, the rate it’s usually sold at, and the income account it goes to.</p>
        {canManage && (
          <Button icon={<PlusIcon />} variant="secondary" onClick={() => setEditing('new')}>
            New item
          </Button>
        )}
      </div>
      {!items ? (
        <Empty>Loading…</Empty>
      ) : !items.length ? (
        <Empty>Nothing on {unit.name}’s price list yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-900">
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Category</th>
                <th className={th}>Income account</th>
                <th className={`${th} text-right`}>Default rate</th>
                <th className={th}>Visitors</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={clsx('border-t border-gray-200', !i.isActive && 'text-gray-400')}>
                  <td className={td}>
                    <span className="font-medium">{i.name}</span>
                    {!i.isActive && (
                      <span className="ml-1.5">
                        <Pill>Inactive</Pill>
                      </span>
                    )}
                  </td>
                  <td className={td}>{i.category}</td>
                  <td className={td}>{i.incomeAccount ? `${i.incomeAccount.code} ${i.incomeAccount.name}` : ''}</td>
                  <td className={`${td} ${num}`}>{i.pricing === 'AMOUNT' ? <span className="text-gray-500">Day’s amount</span> : i.defaultRate ? formatMoney(i.defaultRate) : '—'}</td>
                  <td className={td}>{i.footfall === 'ADULT' ? <Pill tone="blue">Adult</Pill> : i.footfall === 'KID' ? <Pill tone="violet">Child</Pill> : ''}</td>
                  <td className={`${td} text-right`}>
                    {canManage && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(i)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SalesItemModal
        isOpen={editing !== null}
        item={editing === 'new' ? null : editing}
        unitId={unit.id}
        unitName={unit.name}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={(i) => {
          setEditing(null);
          onNotice({ tone: 'ok', text: `${i.name} saved.` });
          void refresh();
        }}
      />
    </div>
  );
}
