'use client';

import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import { useUser } from '../layout/UserProvider';
import { allowedReportKeys, generateAndOpen, REPORT_PERMISSIONS, type ReportParams } from '../../lib/api/reports';
import { errorMessage } from '../../lib/money';

/**
 * "PDF" on a record's page: generates that record's report (a payroll
 * register, a settlement statement, a campaign P&L …), opens it in a new
 * tab and keeps it in the Reports archive. Hidden from anyone who can't
 * generate that report.
 */
export default function PdfButton({
  report,
  params,
  label = 'PDF',
  disabled,
}: {
  report: string;
  params: ReportParams;
  label?: string;
  disabled?: boolean;
}) {
  const { hasAnyPermission } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayReport = hasAnyPermission(REPORT_PERMISSIONS);
  // Only reports whose data this user can see on screen are in their catalogue.
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!mayReport) return;
    let live = true;
    void allowedReportKeys().then((keys) => live && setAllowed(keys.has(report)));
    return () => {
      live = false;
    };
  }, [mayReport, report]);
  if (!mayReport || !allowed) return null;

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || disabled}
        title="Generate a PDF — it opens in a new tab and is kept in Reports → Archive"
        onClick={() => {
          setError(null);
          setBusy(true);
          generateAndOpen(report, params)
            .catch((err) => setError(errorMessage(err, 'Could not generate the PDF.')))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Generating…' : label}
      </Button>
    </span>
  );
}
