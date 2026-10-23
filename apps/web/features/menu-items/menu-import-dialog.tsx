'use client';

import { FileUp, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MenuImportReport } from '@zoauro/shared';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ApiError } from '../../lib/api';
import { useImportMenuItems } from './api';

/** Server cap (`MENU_IMPORT_MAX_CSV_CHARS`); checked early for a friendly message. */
const MAX_CSV_CHARS = 400_000;

export const MENU_IMPORT_COLUMNS =
  'zone, provider, type, name, description, category, price, dietary';

/** Unit-testable one-liner for a report (dry run vs the final import). */
export function describeImportReport(report: MenuImportReport): string {
  if (report.dryRun) {
    const ready = creatableCount(report);
    return `Dry run: ${ready} of ${report.total} rows will be imported, ${report.invalid} need fixing, ${report.duplicates} already on the menu.`;
  }
  return `${report.created} items imported, ${report.duplicates} skipped as duplicates, ${report.invalid} rows with errors.`;
}

function creatableCount(report: MenuImportReport): number {
  return Math.max(0, report.valid - report.duplicates);
}

/**
 * A6 Menu import dialog (doc 34 SA-2.5, Figma "Import" button): pick a CSV,
 * the file is dry-run immediately and the report (ready / needs fixing /
 * duplicates, with per-row issues) is shown before anything is written; the
 * import step only runs when the operator confirms, so dry-run → report →
 * fix → re-run (doc 44 §5) never surprises the screen. Imported items land
 * PENDING for the normal approval workflow.
 */
export function MenuImportDialog({ onClose }: { onClose: () => void }) {
  const importItems = useImportMenuItems();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [report, setReport] = useState<MenuImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const busy = importItems.isPending;

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReport(null);
    setFileName(file.name);
    const text = await file.text();
    if (text.length > MAX_CSV_CHARS) {
      setCsv(null);
      setFileName(null);
      setError('The file is too large — 400,000 characters max.');
      return;
    }
    setCsv(text);
    try {
      const res = await importItems.mutateAsync({ csv: text, dryRun: true });
      setReport(res.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read the file.');
      setReport(null);
    }
  }

  async function runImport() {
    if (!csv) return;
    setError(null);
    try {
      const res = await importItems.mutateAsync({ csv, dryRun: false });
      toast.success(describeImportReport(res.data));
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not import the file.');
    }
  }

  const ready = report ? creatableCount(report) : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl" aria-label="Import menu items">
        <DialogHeader>
          <DialogTitle>Import menu items</DialogTitle>
          <DialogDescription>
            Upload a CSV to add items in bulk. The file is dry-run first — nothing is written until
            you confirm the report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-[12px] font-medium text-text">Required columns</p>
            <code className="mt-1 block break-words text-[11px] text-slate-500">
              {MENU_IMPORT_COLUMNS}
            </code>
            <p className="mt-2 text-[11px] text-slate-400">
              Type is restaurant, homemaker or hotel; price is whole rupees (1–999999); dietary is
              VEGETARIAN, NON_VEG or EGG. Cells starting with =, +, - or @ are escaped on import.
              Items arrive as Pending for approval.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="Choose CSV file"
              className="hidden"
              onChange={(e) => void onFileChosen(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <FileUp className="size-4" />
              {fileName ? 'Change file' : 'Choose CSV file'}
            </Button>
            {fileName && (
              <span className="truncate text-[13px] text-slate-500" data-testid="import-file">
                {fileName}
              </span>
            )}
          </div>

          {busy && (
            <p className="flex items-center gap-2 text-[13px] text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              {report ? 'Importing…' : 'Checking the file…'}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
            >
              {error}
            </p>
          )}

          {report && !busy && (
            <div
              className="rounded-lg border border-slate-200 px-3 py-3"
              data-testid="import-report"
            >
              <p className="text-[13px] font-medium text-text">{describeImportReport(report)}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{report.total} rows</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                  {ready} to import
                </span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                  {report.duplicates} duplicates
                </span>
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
                  {report.invalid} with errors
                </span>
              </div>
              {report.errors.length > 0 && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-[12px] text-slate-600">
                  {report.errors.map((rowError, index) => (
                    <li key={`${rowError.row}-${rowError.field}-${index}`}>
                      <span className="font-medium">Row {rowError.row}</span>
                      {rowError.field ? ` (${rowError.field})` : ''}: {rowError.issue}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void runImport()}
            disabled={busy || !csv || !report || !report.dryRun || ready === 0}
            className="gap-2"
          >
            <Upload className="size-4" />
            Import {ready} {ready === 1 ? 'item' : 'items'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
