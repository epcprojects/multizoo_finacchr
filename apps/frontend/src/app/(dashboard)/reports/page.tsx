'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { PlusIcon } from '../../../components/ui/icons';
import { NoticeLine, Pill, Section, Tabs, UnitPicker, type Notice } from '../../../components/hr/ui';
import { GenerateModal, ScheduleModal } from '../../../components/reports/ReportModals';
import { describeTiming } from '../../../components/reports/ReportParamsForm';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import {
  deleteSchedule,
  downloadReport,
  formatBytes,
  getReportCatalogue,
  listArchive,
  listSchedules,
  openReport,
  runSchedule,
  updateSchedule,
  type ArchivePage,
  type ArchivedReport,
  type ReportDefinition,
  type ReportGroup,
  type ReportSchedule,
} from '../../../lib/api/reports';
import { errorMessage, formatDate } from '../../../lib/money';

const TABS = ['Generate', 'Archive', 'Schedules'] as const;
type Tab = (typeof TABS)[number];
const GROUPS: ReportGroup[] = ['Finance', 'HR & payroll', 'Operations'];
const th = 'px-3 py-2.5 font-semibold';
const td = 'px-3 py-2';

function when(iso: string) {
  const d = new Date(iso);
  const date = formatDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d));
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date}, ${time}`;
}

/**
 * The Report centre (architecture plan Part 08, module M12): every report in
 * the catalogue generated on demand as a PDF, the archive of every PDF ever
 * produced, and the schedules that produce them automatically.
 */
export default function ReportsPage() {
  const { hasPermission } = useUser();
  const canSchedule = hasPermission('reports.generate');
  const tabs = useMemo(() => TABS.filter((t) => t !== 'Schedules' || canSchedule), [canSchedule]);

  const [tab, setTab] = useState<Tab>('Generate');
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [catalogue, setCatalogue] = useState<ReportDefinition[] | null>(null);
  const [archive, setArchive] = useState<ArchivePage | null>(null);
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null);
  const [generating, setGenerating] = useState<ReportDefinition | null>(null);
  const [recent, setRecent] = useState<ArchivedReport[]>([]);
  const [editing, setEditing] = useState<ReportSchedule | 'new' | null>(null);
  const [removing, setRemoving] = useState<ReportSchedule | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // Archive filters
  const [fKey, setFKey] = useState('');
  const [fUnit, setFUnit] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [page, setPage] = useState(1);

  const fail = (err: unknown, text: string) => setNotice({ tone: 'error', text: errorMessage(err, text) });

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
    getReportCatalogue().then(setCatalogue, (err) => fail(err, 'Could not load the reports.'));
  }, []);

  const refreshArchive = useCallback(async () => {
    try {
      setArchive(await listArchive({ reportKey: fKey, businessUnitId: fUnit, from: fFrom, to: fTo, search: fSearch.trim(), page, limit: 20 }));
    } catch (err) {
      fail(err, 'Could not load the archive.');
    }
  }, [fKey, fUnit, fFrom, fTo, fSearch, page]);

  const refreshSchedules = useCallback(async () => {
    if (!canSchedule) return;
    try {
      setSchedules(await listSchedules());
    } catch (err) {
      fail(err, 'Could not load the schedules.');
    }
  }, [canSchedule]);

  useEffect(() => {
    const t = setTimeout(() => void refreshArchive(), 250);
    return () => clearTimeout(t);
  }, [refreshArchive]);
  useEffect(() => {
    void refreshSchedules();
  }, [refreshSchedules]);

  async function open(r: ArchivedReport) {
    try {
      await openReport(r);
    } catch (err) {
      fail(err, 'Could not open the PDF.');
    }
  }

  async function download(r: ArchivedReport) {
    try {
      await downloadReport(r);
    } catch (err) {
      fail(err, 'Could not download the PDF.');
    }
  }

  const activeSchedules = schedules?.filter((s) => s.isActive).length;
  const failing = schedules?.filter((s) => s.isActive && s.lastStatus === 'FAILED').length ?? 0;

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/reports-icon.svg"
            imageAlt="Reports"
            title="Reports"
            stats={[
              { title: 'Reports you can run', count: catalogue ? catalogue.length : '…', color: '#60A5FA' },
              { title: 'In the archive', count: archive ? archive.total : '…', color: '#A78BFA' },
              ...(canSchedule
                ? [
                    { title: 'Scheduled', count: activeSchedules ?? '…', color: '#34D399' },
                    { title: 'Last run failed', count: schedules ? failing : '…', color: '#F87171' },
                  ]
                : []),
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section title={<Tabs tabs={tabs} value={tab} onChange={setTab} counts={{ Schedules: failing }} />}>
          {tab === 'Generate' && (
            <div className="flex flex-col gap-5">
              {recent.length > 0 && (
                <div className="rounded-xl border border-green-200 bg-green-50/60 p-3">
                  <p className="mb-2 text-sm font-semibold text-green-800">Generated just now</p>
                  <ul className="flex flex-col gap-1.5">
                    {recent.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium text-gray-900">{r.title}</span>
                          <span className="text-gray-600"> · {r.subtitle}</span>
                        </span>
                        <span className="flex gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => void open(r)}>
                            Open
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void download(r)}>
                            Download
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!catalogue ? (
                <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
              ) : !catalogue.length ? (
                <p className="py-6 text-center text-sm text-gray-500">There are no reports you can generate.</p>
              ) : (
                GROUPS.filter((g) => catalogue.some((d) => d.group === g)).map((g) => (
                  <div key={g} className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{g}</h3>
                    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {catalogue
                        .filter((d) => d.group === g)
                        .map((d) => (
                          <div key={d.key} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-gray-900">{d.title}</p>
                              {d.schedulable && canSchedule && <Pill tone="blue">Schedulable</Pill>}
                            </div>
                            <p className="flex-1 text-sm text-gray-600">{d.description}</p>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs text-gray-500">
                                {d.cadence} · {d.audience}
                              </span>
                              <Button size="sm" onClick={() => setGenerating(d)}>
                                Generate PDF
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'Archive' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-600">
                Every PDF the system has produced, on demand or on a schedule — kept as it was generated. {archive ? `${archive.total} in all.` : ''}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Select
                  label="Report"
                  value={fKey}
                  onChange={(v) => {
                    setFKey(v);
                    setPage(1);
                  }}
                  options={[{ label: 'All reports', value: '' }, ...(catalogue ?? []).map((d) => ({ label: d.title, value: d.key }))]}
                />
                <UnitPicker
                  label="Covering"
                  units={units}
                  value={fUnit}
                  allowAll
                  onChange={(v) => {
                    setFUnit(v);
                    setPage(1);
                  }}
                />
                <Input label="Period from" type="date" value={fFrom} onChange={(e) => (setFFrom(e.target.value), setPage(1))} />
                <Input label="Period to" type="date" value={fTo} onChange={(e) => (setFTo(e.target.value), setPage(1))} />
                <Input label="Search" value={fSearch} placeholder="Title, unit, file…" onChange={(e) => (setFSearch(e.target.value), setPage(1))} />
              </div>
              {!archive ? (
                <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
              ) : !archive.items.length ? (
                <p className="py-6 text-center text-sm text-gray-500">No reports here yet.</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-900">
                        <tr>
                          <th className={th}>Generated</th>
                          <th className={th}>Report</th>
                          <th className={th}>Covers</th>
                          <th className={th}>Headline</th>
                          <th className={th}>By</th>
                          <th className={th} />
                        </tr>
                      </thead>
                      <tbody>
                        {archive.items.map((r) => (
                          <tr key={r.id} className="border-t border-gray-200 align-top">
                            <td className={`${td} whitespace-nowrap text-gray-700`}>{when(r.createdAt)}</td>
                            <td className={td}>
                              <span className="font-medium text-gray-900">{r.title}</span>
                              <span className="block text-xs text-gray-500">{r.subtitle}</span>
                            </td>
                            <td className={td}>
                              {r.units.length ? (
                                <span className="flex flex-wrap gap-1">
                                  {r.units.map((u) => (
                                    <Pill key={u}>{u}</Pill>
                                  ))}
                                </span>
                              ) : (
                                <Pill tone="violet">Group</Pill>
                              )}
                            </td>
                            <td className={td}>
                              <span className="flex flex-col text-xs text-gray-600">
                                {r.highlights.slice(0, 3).map((h) => (
                                  <span key={h.label}>
                                    {h.label}: <span className="font-medium tabular-nums text-gray-900">{h.value}</span>
                                  </span>
                                ))}
                              </span>
                            </td>
                            <td className={`${td} text-xs text-gray-600`}>{r.scheduleId ? <Pill tone="blue">Schedule</Pill> : (r.generatedByName ?? '—')}</td>
                            <td className={`${td} text-right`}>
                              <div className="flex justify-end gap-1.5">
                                <Button size="sm" variant="secondary" onClick={() => void open(r)}>
                                  Open
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => void download(r)} title={`${r.fileName} · ${formatBytes(r.sizeBytes)}`}>
                                  Download
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {archive.total > archive.limit && (
                    <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
                      <span>
                        Page {archive.page} of {Math.ceil(archive.total / archive.limit)}
                      </span>
                      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Previous
                      </Button>
                      <Button size="sm" variant="secondary" disabled={page * archive.limit >= archive.total} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'Schedules' && canSchedule && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  Reports produced automatically — the period each run covers is worked out on the day. Times are Pakistan time.
                </p>
                <Button icon={<PlusIcon />} onClick={() => setEditing('new')}>
                  New schedule
                </Button>
              </div>
              {!schedules ? (
                <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
              ) : !schedules.length ? (
                <p className="py-6 text-center text-sm text-gray-500">Nothing scheduled.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className={th}>Schedule</th>
                        <th className={th}>When</th>
                        <th className={th}>Covers</th>
                        <th className={th}>Next run</th>
                        <th className={th}>Last run</th>
                        <th className={th} />
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map((s) => {
                        const unit = s.params.businessUnitId ? units.find((u) => u.id === s.params.businessUnitId)?.code : null;
                        return (
                          <tr key={s.id} className={clsx('border-t border-gray-200 align-top', !s.isActive && 'text-gray-400')}>
                            <td className={td}>
                              <span className="font-medium text-gray-900">{s.name}</span>
                              <span className="block text-xs text-gray-500">{s.reportTitle}</span>
                            </td>
                            <td className={td}>{describeTiming(s)}</td>
                            <td className={td}>
                              {s.periodLabel ?? 'As it stands'}
                              <span className="block text-xs text-gray-500">{unit ?? 'All units'}</span>
                            </td>
                            <td className={`${td} whitespace-nowrap`}>{s.isActive ? when(s.nextRunAt) : <Pill>Off</Pill>}</td>
                            <td className={td}>
                              {!s.lastRunAt ? (
                                <span className="text-xs text-gray-500">Not yet</span>
                              ) : (
                                <span className="flex flex-col gap-1">
                                  <span className="flex items-center gap-1.5">
                                    <Pill tone={s.lastStatus === 'OK' ? 'green' : 'red'}>{s.lastStatus === 'OK' ? 'OK' : 'Failed'}</Pill>
                                    <span className="whitespace-nowrap text-xs text-gray-600">{when(s.lastRunAt)}</span>
                                  </span>
                                  {s.lastStatus === 'FAILED' && s.lastError && <span className="max-w-xs text-xs text-red-600">{s.lastError}</span>}
                                  {s.lastStatus === 'OK' && s.lastArchiveId && (
                                    <button
                                      type="button"
                                      className="w-fit text-xs text-accent hover:underline"
                                      onClick={() => void open({ id: s.lastArchiveId as string, fileName: 'report.pdf' } as ArchivedReport)}
                                    >
                                      Open the PDF
                                    </button>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className={`${td} text-right`}>
                              <div className="flex justify-end gap-1.5 whitespace-nowrap">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={async () => {
                                    try {
                                      const updated = await runSchedule(s.id);
                                      setSchedules((list) => list?.map((x) => (x.id === s.id ? updated : x)) ?? null);
                                      setNotice(
                                        updated.lastStatus === 'OK'
                                          ? { tone: 'ok', text: `${s.name} generated — it’s in the archive.` }
                                          : { tone: 'error', text: `${s.name} failed: ${updated.lastError}` },
                                      );
                                      void refreshArchive();
                                    } catch (err) {
                                      fail(err, 'Could not run it.');
                                    }
                                  }}
                                >
                                  Run now
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={async () => {
                                    try {
                                      const updated = await updateSchedule(s.id, { isActive: !s.isActive });
                                      setSchedules((list) => list?.map((x) => (x.id === s.id ? updated : x)) ?? null);
                                    } catch (err) {
                                      fail(err, 'Could not change it.');
                                    }
                                  }}
                                >
                                  {s.isActive ? 'Turn off' : 'Turn on'}
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => setRemoving(s)}>
                                  Remove
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      <GenerateModal
        def={generating}
        units={units}
        onClose={() => setGenerating(null)}
        onGenerated={(r) => {
          setGenerating(null);
          setRecent((list) => [r, ...list].slice(0, 5));
          setNotice({ tone: 'ok', text: `${r.title} generated and opened in a new tab — it’s in the archive.` });
          void refreshArchive();
        }}
      />
      {catalogue && (
        <ScheduleModal
          schedule={editing}
          catalogue={catalogue}
          units={units}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            setNotice({ tone: 'ok', text: `${s.name} saved — next run ${when(s.nextRunAt)}.` });
            void refreshSchedules();
          }}
        />
      )}
      <ConfirmModal
        isOpen={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove this schedule?"
        message={`${removing?.name ?? ''} stops running. Reports it already produced stay in the archive.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteSchedule(removing.id);
            setRemoving(null);
            void refreshSchedules();
          } catch (err) {
            fail(err, 'Could not remove it.');
          }
        }}
      />
    </div>
  );
}
