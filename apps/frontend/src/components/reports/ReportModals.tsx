'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import type { BusinessUnitRecord } from '../../lib/api/ledger';
import {
  createSchedule,
  generateAndOpen,
  updateSchedule,
  WEEKDAY_NAMES,
  type ArchivedReport,
  type RelativePeriod,
  type ReportDefinition,
  type ReportParams,
  type ReportSchedule,
  type ScheduleCadence,
} from '../../lib/api/reports';
import { errorMessage } from '../../lib/money';
import ReportParamsForm, { defaultParams, PERIOD_PARAMS } from './ReportParamsForm';

/** Every half hour of the day, 00:00 – 23:30. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return { label: t, value: t };
});

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null;

function missing(def: ReportDefinition, values: ReportParams, skip: string[] = []) {
  return def.params.filter((p) => p.required && !skip.includes(p.name) && (values[p.name] === undefined || values[p.name] === ''));
}

/** Pick a report's params, generate it, open the PDF — and it's in the archive. */
export function GenerateModal({
  def,
  units,
  initial,
  onClose,
  onGenerated,
}: {
  def: ReportDefinition | null;
  units: BusinessUnitRecord[];
  initial?: ReportParams;
  onClose: () => void;
  onGenerated: (r: ArchivedReport) => void;
}) {
  const [values, setValues] = useState<ReportParams>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!def) return;
    // Someone with a single unit reports on it without having to pick it.
    const only = units.length === 1 && def.params.some((p) => p.name === 'businessUnitId') ? { businessUnitId: units[0].id } : {};
    setValues({ ...defaultParams(def), ...only, ...(initial ?? {}) });
    setError(null);
  }, [def, initial, units]);

  if (!def) return null;

  function submit() {
    if (!def || busy) return;
    const gaps = missing(def, values);
    if (gaps.length) return setError(`Pick ${gaps.map((g) => g.label.toLowerCase()).join(', ')}.`);
    if (values.from && values.to && String(values.from) > String(values.to)) return setError('The start date must be on or before the end date.');
    setError(null);
    setBusy(true);
    // generateAndOpen opens the tab straight away, inside this click.
    generateAndOpen(def.key, values)
      .then((r) => onGenerated(r))
      .catch((err) => setError(errorMessage(err, 'Could not generate the report.')))
      .finally(() => setBusy(false));
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={def.title}
      subtitle={def.description}
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={busy ? 'Generating…' : 'Generate PDF'}
      confirmDisabled={busy}
    >
      <div className="flex flex-col gap-4">
        <ErrorLine error={error} />
        <ReportParamsForm def={def} values={values} onChange={setValues} units={units} />
        <p className="text-xs text-gray-500">
          Opens in a new tab and is kept in the archive. {def.landscape ? 'Landscape A4.' : 'A4.'} Figures are computed from the ledger at the moment it’s
          generated.
        </p>
      </div>
    </Modal>
  );
}

/** Set up or change a scheduled report: which report, when, and which period each run covers. */
export function ScheduleModal({
  schedule,
  catalogue,
  units,
  onClose,
  onSaved,
}: {
  /** null = closed; 'new' = a new schedule. */
  schedule: ReportSchedule | 'new' | null;
  catalogue: ReportDefinition[];
  units: BusinessUnitRecord[];
  onClose: () => void;
  onSaved: (s: ReportSchedule) => void;
}) {
  const schedulable = catalogue.filter((d) => d.schedulable);
  const [reportKey, setReportKey] = useState('');
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<ScheduleCadence>('DAILY');
  const [runAt, setRunAt] = useState('07:00');
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [period, setPeriod] = useState<RelativePeriod | ''>('');
  const [values, setValues] = useState<ReportParams>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!schedule) return;
    setError(null);
    if (schedule === 'new') {
      setReportKey('');
      setName('');
      setCadence('DAILY');
      setRunAt('07:00');
      setWeekday(1);
      setDayOfMonth(1);
      setPeriod('');
      setValues({});
      return;
    }
    setReportKey(schedule.reportKey);
    setName(schedule.name);
    setCadence(schedule.cadence);
    setRunAt(schedule.runAt);
    setWeekday(schedule.weekday ?? 1);
    setDayOfMonth(schedule.dayOfMonth ?? 1);
    setPeriod(schedule.period ?? '');
    setValues(schedule.params ?? {});
  }, [schedule]);

  const def = schedulable.find((d) => d.key === reportKey) ?? catalogue.find((d) => d.key === reportKey) ?? null;

  function pickReport(key: string) {
    setReportKey(key);
    setValues({});
    const d = schedulable.find((x) => x.key === key);
    setPeriod(d?.relativePeriods[0]?.value ?? '');
    if (!name && d) setName(d.title);
  }

  async function submit() {
    setError(null);
    if (!def) return setError('Choose a report.');
    if (name.trim().length < 2) return setError('Give the schedule a name.');
    if (def.relativePeriods.length && !period) return setError('Choose the period each run covers.');
    const gaps = missing(def, values, PERIOD_PARAMS);
    if (gaps.length) return setError(`Pick ${gaps.map((g) => g.label.toLowerCase()).join(', ')}.`);
    const params = Object.fromEntries(Object.entries(values).filter(([k, v]) => !PERIOD_PARAMS.includes(k as never) && v !== '' && v !== undefined));
    const payload = {
      name: name.trim(),
      cadence,
      runAt,
      weekday: cadence === 'WEEKLY' ? weekday : null,
      dayOfMonth: cadence === 'MONTHLY' ? dayOfMonth : null,
      period: period || null,
      params,
    };
    setSaving(true);
    try {
      onSaved(schedule === 'new' ? await createSchedule({ ...payload, reportKey: def.key }) : await updateSchedule((schedule as ReportSchedule).id, payload));
    } catch (err) {
      setError(errorMessage(err, 'Could not save the schedule.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(schedule)}
      onClose={onClose}
      title={schedule === 'new' ? 'New scheduled report' : (schedule?.name ?? '')}
      subtitle="Generated automatically on its timetable (Pakistan time) and kept in the archive. Scheduled reports cover the whole group unless you pick a unit."
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        <ErrorLine error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          {schedule === 'new' ? (
            <Select
              label="Report"
              required
              value={reportKey}
              onChange={pickReport}
              options={schedulable.map((d) => ({ label: d.title, value: d.key }))}
            />
          ) : (
            <Input label="Report" value={def?.title ?? reportKey} disabled />
          )}
          <Input label="Name" required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nightly cash position" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="How often"
            value={cadence}
            onChange={(v) => setCadence(v as ScheduleCadence)}
            options={[
              { label: 'Every day', value: 'DAILY' },
              { label: 'Every week', value: 'WEEKLY' },
              { label: 'Every month', value: 'MONTHLY' },
            ]}
          />
          {cadence === 'WEEKLY' && (
            <Select label="On" value={String(weekday)} onChange={(v) => setWeekday(Number(v))} options={WEEKDAY_NAMES.map((d, i) => ({ label: d, value: String(i + 1) }))} />
          )}
          {cadence === 'MONTHLY' && (
            <Select
              label="On day"
              value={String(dayOfMonth)}
              onChange={(v) => setDayOfMonth(Number(v))}
              options={Array.from({ length: 28 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }))}
            />
          )}
          <Select label="At (Pakistan time)" value={runAt} onChange={setRunAt} options={TIMES} />
        </div>
        {def && def.relativePeriods.length > 0 && (
          <Select label="Each run covers" required value={period} onChange={(v) => setPeriod(v as RelativePeriod)} options={def.relativePeriods.map((p) => ({ label: p.label, value: p.value }))} />
        )}
        {def && <ReportParamsForm def={def} values={values} onChange={setValues} units={units} forSchedule />}
      </div>
    </Modal>
  );
}
