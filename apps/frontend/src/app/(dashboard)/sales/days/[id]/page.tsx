'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../../components/layout/UserProvider';
import Button from '../../../../../components/ui/Button';
import Select from '../../../../../components/ui/Select';
import ConfirmModal from '../../../../../components/ui/ConfirmModal';
import EntryDetailModal from '../../../../../components/ledger/EntryDetailModal';
import ReviewNoteModal, { type ReviewAction } from '../../../../../components/hr/ReviewNoteModal';
import { Figure, NoticeLine, Pill, Section, type Notice } from '../../../../../components/hr/ui';
import { listAccounts, type AccountRecord } from '../../../../../lib/api/ledger';
import {
  deleteSalesDay,
  getSalesDay,
  listSalesItems,
  postSalesDay,
  saveSalesDay,
  unpostSalesDay,
  type SalesDayDetail,
  type SalesItemRecord,
} from '../../../../../lib/api/sales';
import { errorMessage, formatDate, formatMoney, fromPaisa, isAmount, toPaisa } from '../../../../../lib/money';

const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-1.5';
const cellInput =
  'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-gray-400 disabled:border-transparent disabled:bg-transparent';

/** One row of the sheet: an item on the price list, and what was sold of it. */
type Row = { itemId: string; name: string; category: string; perUnit: boolean; footfall: string; defaultRate: string | null; qty: string; rate: string; amount: string };
type ReceiptRow = { accountId: string; amount: string };

function rowAmount(r: Row): bigint {
  if (!r.perUnit) return isAmount(r.amount) ? toPaisa(r.amount) : 0n;
  const q = /^\d+$/.test(r.qty) ? BigInt(r.qty) : 0n;
  const rate = r.rate || r.defaultRate || '';
  return isAmount(rate) ? q * toPaisa(rate) : 0n;
}

/**
 * A unit's sales for one day — the Ticket sales sheet's rows for a date:
 * every item on the price list, Qty × Rate, and where the takings went.
 * Posting puts it on the ledger as one money-in entry.
 */
export default function SalesDayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useUser();
  const canEnter = hasPermission('transactions.create_own_unit');
  const canUnpost = hasPermission('transactions.reverse');

  const [day, setDay] = useState<SalesDayDetail | null>(null);
  const [items, setItems] = useState<SalesItemRecord[]>([]);
  const [liquid, setLiquid] = useState<AccountRecord[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback((d: SalesDayDetail, list: SalesItemRecord[], cash: AccountRecord[]) => {
    setDay(d);
    // Every active item, plus anything on the day that has since been retired.
    const fromLines: Row[] = d.lines.map((l) => {
      const it = list.find((i) => i.id === l.itemId);
      return {
        itemId: l.itemId,
        name: l.itemName,
        category: l.category,
        perUnit: l.quantity !== null,
        footfall: l.footfall,
        defaultRate: it?.defaultRate ?? null,
        qty: l.quantity !== null ? String(l.quantity) : '',
        rate: l.rate ?? '',
        amount: l.quantity === null ? l.amount : '',
      };
    });
    const rest: Row[] =
      d.status === 'DRAFT'
        ? list
            .filter((i) => i.isActive && !d.lines.some((l) => l.itemId === i.id))
            .map((i) => ({ itemId: i.id, name: i.name, category: i.category, perUnit: i.pricing === 'PER_UNIT', footfall: i.footfall, defaultRate: i.defaultRate, qty: '', rate: '', amount: '' }))
        : [];
    const order = (r: Row) => {
      const i = list.findIndex((x) => x.id === r.itemId);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const all = [...fromLines, ...rest].sort((a, b) => order(a) - order(b));
    setRows(all);
    const rc = d.receipts.length ? d.receipts.map((r) => ({ accountId: r.account.id, amount: r.amount })) : [{ accountId: cash[0]?.id ?? '', amount: '' }];
    setReceipts(rc);
    setSaved(JSON.stringify([all, rc]));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await getSalesDay(id);
        const [list, accounts] = await Promise.all([
          listSalesItems({ businessUnitId: d.businessUnit.id, includeInactive: true }),
          listAccounts({ businessUnitId: d.businessUnit.id }),
        ]);
        const cash = accounts.filter((a) => a.accountClass?.isLiquid && a.businessUnit?.id === d.businessUnit.id && a.isPostable);
        setItems(list);
        setLiquid(cash);
        load(d, list, cash);
      } catch (err) {
        setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the day.') });
      }
    })();
  }, [id, load]);

  const total = useMemo(() => rows.reduce((s, r) => s + rowAmount(r), 0n), [rows]);
  const received = useMemo(() => receipts.reduce((s, r) => s + (isAmount(r.amount) ? toPaisa(r.amount) : 0n), 0n), [receipts]);
  const dirty = JSON.stringify([rows, receipts]) !== saved;

  if (!day) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const draft = day.status === 'DRAFT';
  const editable = draft && canEnter;
  const shown = editable ? rows : rows.filter((r) => rowAmount(r) > 0n);
  const adults = rows.filter((r) => r.footfall === 'ADULT').reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const kids = rows.filter((r) => r.footfall === 'KID').reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const setRow = (itemId: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)));

  function payload() {
    const bad = rows.find((r) => (r.perUnit ? (r.qty && !/^\d+$/.test(r.qty)) || (r.rate && !isAmount(r.rate)) : r.amount && !isAmount(r.amount)));
    if (bad) throw new Error(`${bad.name}: quantities are whole numbers, rates and amounts have at most 2 decimals.`);
    const missingRate = rows.find((r) => r.perUnit && Number(r.qty) > 0 && !r.rate && !r.defaultRate);
    if (missingRate) throw new Error(`${missingRate.name}: enter the rate it was sold at.`);
    return {
      lines: rows
        .filter((r) => rowAmount(r) > 0n || (r.perUnit && Number(r.qty) > 0))
        .map((r) => (r.perUnit ? { itemId: r.itemId, quantity: Number(r.qty), rate: r.rate || null } : { itemId: r.itemId, amount: r.amount })),
      receipts: receipts.filter((r) => r.accountId && isAmount(r.amount) && toPaisa(r.amount) > 0n).map((r) => ({ accountId: r.accountId, amount: r.amount })),
    };
  }

  async function save(): Promise<boolean> {
    if (!day) return false;
    setBusy(true);
    try {
      load(await saveSalesDay(day.id, payload()), items, liquid);
      setNotice({ tone: 'ok', text: 'Saved as a draft.' });
      return true;
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error && !('response' in err) ? err.message : errorMessage(err, 'Could not save.') });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!day) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      load(await postSalesDay(day.id), items, liquid);
      setNotice({ tone: 'ok', text: 'Posted — the day’s sales are on the ledger.' });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not post.') });
    } finally {
      setBusy(false);
    }
  }

  const takeAll = (accountId: string) => setReceipts([{ accountId, amount: fromPaisa(total) }]);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/sales" className="text-gray-400 hover:text-accent">
                Sales
              </Link>
              <span className="text-gray-300">/</span>
              {day.businessUnit.name}, {formatDate(day.salesDate)}
              <Pill tone={draft ? 'amber' : 'green'}>{draft ? 'Draft' : 'Posted'}</Pill>
            </span>
          }
          subtitle={[day.createdByName && `Started by ${day.createdByName}`, day.postedByName && `posted by ${day.postedByName}`].filter(Boolean).join(' · ') || undefined}
          actions={
            <>
              {day.previous && (
                <Button variant="secondary" onClick={() => router.push(`/sales/days/${day.previous?.id}`)}>
                  ‹ {formatDate(day.previous.salesDate)}
                </Button>
              )}
              {day.next && (
                <Button variant="secondary" onClick={() => router.push(`/sales/days/${day.next?.id}`)}>
                  {formatDate(day.next.salesDate)} ›
                </Button>
              )}
            </>
          }
        >
          <NoticeLine notice={notice} onClose={() => setNotice(null)} />
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 p-3 sm:grid-cols-4">
            <Figure label="Sales" value={formatMoney(total)} tone="accent" />
            <Figure label="Received" value={formatMoney(received)} tone={received !== total ? 'danger' : undefined} />
            <Figure label="Adults / kids" value={`${adults.toLocaleString()} / ${kids.toLocaleString()}`} hint="Tickets that count people through the gate" />
            <Figure
              label="Entry"
              value={
                day.entry ? (
                  <button type="button" className="font-mono text-accent hover:underline" onClick={() => setEntryId(day.entry?.id ?? null)}>
                    {day.entry.displayNo}
                  </button>
                ) : (
                  'Not posted'
                )
              }
            />
          </div>
        </Section>

        <Section title="What was sold" subtitle={editable ? 'Type how many of each were sold. The rate defaults to the price list’s — change it if something sold at another price.' : undefined}>
          {!shown.length ? (
            <p className="py-6 text-center text-sm text-gray-500">{items.length ? 'Nothing sold on this day.' : 'This unit has nothing on its price list yet — add items under Sales → Price list.'}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Item</th>
                    <th className={`${th} w-28 text-right`}>Qty</th>
                    <th className={`${th} w-32 text-right`}>Rate</th>
                    <th className={`${th} w-36 text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const amount = rowAmount(r);
                    return (
                      <tr key={r.itemId} className={clsx('border-t border-gray-100', amount > 0n && 'bg-accent-soft/20')}>
                        <td className={td}>
                          <span className="font-medium text-gray-900">{r.name}</span>{' '}
                          <span className="text-xs text-gray-500">{r.category}</span>
                          {r.footfall !== 'NONE' && (
                            <span className="ml-1.5">
                              <Pill tone={r.footfall === 'ADULT' ? 'blue' : 'violet'}>{r.footfall === 'ADULT' ? 'Adult' : 'Child'}</Pill>
                            </span>
                          )}
                        </td>
                        {r.perUnit ? (
                          <>
                            <td className={td}>
                              <input className={cellInput} inputMode="numeric" disabled={!editable} value={r.qty} onChange={(e) => setRow(r.itemId, { qty: e.target.value.replace(/\D/g, '') })} />
                            </td>
                            <td className={td}>
                              <input
                                className={cellInput}
                                inputMode="decimal"
                                disabled={!editable}
                                value={r.rate}
                                placeholder={r.defaultRate ? formatMoney(r.defaultRate, { prefix: false }) : 'Rate'}
                                onChange={(e) => setRow(r.itemId, { rate: e.target.value.replace(/[^\d.]/g, '') })}
                              />
                            </td>
                          </>
                        ) : (
                          <td className={`${td} text-right text-xs text-gray-500`} colSpan={2}>
                            Day’s amount
                          </td>
                        )}
                        <td className={`${td} text-right tabular-nums`}>
                          {r.perUnit ? (
                            amount > 0n ? formatMoney(amount, { prefix: false }) : ''
                          ) : (
                            <input className={cellInput} inputMode="decimal" disabled={!editable} value={r.amount} onChange={(e) => setRow(r.itemId, { amount: e.target.value.replace(/[^\d.]/g, '') })} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <tr>
                    <td className={td} colSpan={3}>
                      Total
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{formatMoney(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Section>

        <Section
          title="Where the takings went"
          subtitle={editable ? 'Cash in hand, the bank, Easypaisa — together they must come to the day’s sales.' : undefined}
          actions={
            editable &&
            liquid[0] && (
              <Button size="sm" variant="secondary" onClick={() => takeAll(liquid[0].id)}>
                All into {liquid[0].name}
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-2">
            {receipts.map((r, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="sm:w-80">
                  {editable ? (
                    <Select
                      value={r.accountId}
                      onChange={(v) => setReceipts((rs) => rs.map((x, j) => (j === i ? { ...x, accountId: v } : x)))}
                      options={liquid.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id }))}
                    />
                  ) : (
                    <span className="text-sm">{day.receipts[i] ? `${day.receipts[i].account.code} ${day.receipts[i].account.name}` : ''}</span>
                  )}
                </div>
                {editable ? (
                  <input
                    className={clsx(cellInput, 'sm:w-44')}
                    inputMode="decimal"
                    value={r.amount}
                    placeholder="0.00"
                    onChange={(e) => setReceipts((rs) => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                  />
                ) : (
                  <span className="text-sm font-medium tabular-nums">{formatMoney(r.amount)}</span>
                )}
                {editable && receipts.length > 1 && (
                  <Button size="sm" variant="secondary" onClick={() => setReceipts((rs) => rs.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {editable && receipts.length < liquid.length && (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setReceipts((rs) => [...rs, { accountId: liquid.find((a) => !rs.some((x) => x.accountId === a.id))?.id ?? '', amount: '' }])}>
                  + Split across another account
                </Button>
              </div>
            )}
            {received !== total && total > 0n && (
              <p className="text-sm text-danger">
                {received < total ? `${formatMoney(total - received)} of the sales isn’t received anywhere yet.` : `${formatMoney(received - total)} more received than sold.`}
              </p>
            )}
          </div>
        </Section>

        {(editable || (!draft && canUnpost)) && (
          <div className="flex flex-wrap justify-end gap-2 pb-4">
            {editable && (
              <>
                <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete draft
                </Button>
                <Button variant="secondary" onClick={() => void save()} disabled={busy || !dirty}>
                  Save draft
                </Button>
                <Button onClick={() => void post()} disabled={busy || total <= 0n || received !== total}>
                  Post to the ledger
                </Button>
              </>
            )}
            {!draft && canUnpost && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setReview({
                    title: 'Unpost this day',
                    subtitle: `${day.businessUnit.name}, ${formatDate(day.salesDate)}`,
                    body: <p className="text-sm text-gray-700">Its entry is reversed (dated today) and the day goes back to draft to be corrected. The Allocation screen will show the day as changed.</p>,
                    confirmLabel: 'Unpost',
                    noteLabel: 'Why',
                    run: async (note) => {
                      load(await unpostSalesDay(day.id, note || undefined), items, liquid);
                      setNotice({ tone: 'ok', text: 'Unposted — correct it and post again.' });
                    },
                  })
                }
              >
                Unpost to correct
              </Button>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this draft?"
        message="Nothing has been posted from it. The day can be started again."
        confirmLabel="Delete"
        variant="danger"
        isSubmitting={busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await deleteSalesDay(day.id);
            router.push('/sales');
          } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err, 'Could not delete.') });
            setConfirmDelete(false);
            setBusy(false);
          }
        }}
      />
      <ReviewNoteModal action={review} onClose={() => setReview(null)} onDone={() => setReview(null)} />
      <EntryDetailModal entryId={entryId} onClose={() => setEntryId(null)} canReverse={false} onChanged={() => undefined} onOpenEntry={setEntryId} />
    </div>
  );
}
