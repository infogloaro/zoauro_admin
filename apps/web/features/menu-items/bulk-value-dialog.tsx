'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { MenuBulkPreviewResponse } from '@zoauro/shared';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  applyBulkValue,
  bulkValueBody,
  classifyBulkValueError,
  EMPTY_BULK_DRAFT,
  formatBulkPreviewValue,
  previewBulkValue,
  type BulkValueDraft,
} from './bulk-value';
import { useBulkMenuAction, useBulkMenuPreview } from './api';

const ACTION_LABELS: Record<BulkValueDraft['action'], string> = {
  availability: 'Set availability',
  category: 'Change category',
  price: 'Adjust price',
};

/**
 * Bulk value actions (doc 09 /bulk/preview + /bulk): the operator picks an
 * action, the same body is first previewed (dry run, zero writes) and only
 * applied after the before/after report is confirmed — exactly the body the
 * preview ran on (D124). 404 (an id vanished) offers a list refresh; 409
 * (category clash in one provider) and 422 (a result below ₹1) surface the
 * server message and keep the dialog open.
 */
export function BulkValueDialog({
  ids,
  onApplied,
  onRefresh,
  onClose,
}: {
  ids: string[];
  /** Called after a successful apply (the list invalidation already ran). */
  onApplied: () => void;
  /** Offered by the 404 toast when a selected id no longer exists. */
  onRefresh: () => void;
  onClose: () => void;
}) {
  const preview = useBulkMenuPreview();
  const bulk = useBulkMenuAction();
  const [draft, setDraft] = useState<BulkValueDraft>(EMPTY_BULK_DRAFT);
  const [previewData, setPreviewData] = useState<MenuBulkPreviewResponse['data'] | null>(null);

  const built = useMemo(() => bulkValueBody(draft, ids), [draft, ids]);
  const busy = preview.isPending || bulk.isPending;

  // A changed draft invalidates the dry run so Apply can never send a body
  // the operator has not reviewed.
  useEffect(() => {
    setPreviewData(null);
  }, [draft]);

  async function runPreview() {
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    setPreviewData(null);
    try {
      setPreviewData(await previewBulkValue(built.body, (input) => preview.mutateAsync(input)));
    } catch (error) {
      const classified = classifyBulkValueError(error);
      if (classified.kind === 'missing') {
        toast.error(classified.message, {
          action: { label: 'Refresh list', onClick: onRefresh },
        });
        return;
      }
      toast.error(classified.message);
    }
  }

  async function runApply() {
    if (!built.ok || !previewData) return;
    try {
      const result = await applyBulkValue(built.body, (input) => bulk.mutateAsync(input));
      toast.success(`${result.data.updated} items updated, ${result.data.skipped} skipped`);
      onApplied();
    } catch (error) {
      const classified = classifyBulkValueError(error);
      if (classified.kind === 'missing') {
        toast.error(classified.message, {
          action: { label: 'Refresh list', onClick: onRefresh },
        });
        return;
      }
      toast.error(classified.message);
    }
  }

  const priceMode = draft.action === 'price' ? draft.priceMode : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk change {ids.length} items</DialogTitle>
          <DialogDescription>
            Preview the change first — nothing is written until you confirm the before/after report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-text">Action</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACTION_LABELS) as Array<BulkValueDraft['action']>).map((action) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant={draft.action === action ? 'default' : 'outline'}
                  aria-pressed={draft.action === action}
                  onClick={() => setDraft((prev) => ({ ...prev, action }))}
                >
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            </div>
          </fieldset>

          {draft.action === 'availability' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-available">Availability</Label>
              <select
                id="bulk-available"
                className="h-9 w-full rounded-[--radius-input] border border-border bg-surface px-3 text-sm text-text"
                value={draft.available ? 'on' : 'off'}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, available: e.target.value === 'on' }))
                }
              >
                <option value="on">On — customers can order</option>
                <option value="off">Off — hidden from the menu</option>
              </select>
            </div>
          )}

          {draft.action === 'category' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-category">Category</Label>
              <Input
                id="bulk-category"
                value={draft.category}
                maxLength={60}
                placeholder="Main course (leave empty to clear)"
                onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
              />
            </div>
          )}

          {draft.action === 'price' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={priceMode === 'percent' ? 'default' : 'outline'}
                  aria-pressed={priceMode === 'percent'}
                  onClick={() => setDraft((prev) => ({ ...prev, priceMode: 'percent' }))}
                >
                  Percent
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={priceMode === 'amount' ? 'default' : 'outline'}
                  aria-pressed={priceMode === 'amount'}
                  onClick={() => setDraft((prev) => ({ ...prev, priceMode: 'amount' }))}
                >
                  Flat ₹
                </Button>
              </div>
              {priceMode === 'percent' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-percent">Percent change (−99 to 1000)</Label>
                  <Input
                    id="bulk-percent"
                    inputMode="decimal"
                    value={draft.percent}
                    placeholder="10 (or −10)"
                    onChange={(e) => setDraft((prev) => ({ ...prev, percent: e.target.value }))}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-amount">New price (₹, minimum 1)</Label>
                  <Input
                    id="bulk-amount"
                    inputMode="numeric"
                    value={draft.amountRupees}
                    placeholder="260"
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, amountRupees: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>
          )}

          {!built.ok && (
            <p role="alert" className="text-[13px] text-danger">
              {built.error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void runPreview()}
              disabled={busy || !built.ok}
            >
              {preview.isPending && <Loader2 className="size-4 animate-spin" />}
              Preview change
            </Button>
            <span className="text-[12px] text-muted">
              Previewed rows must be confirmed to apply.
            </span>
          </div>

          {previewData && (
            <div className="rounded-lg border border-slate-200" data-testid="bulk-preview">
              <p className="border-b border-slate-200 px-3 py-2 text-[13px] font-medium text-text">
                {previewData.total} items · {ACTION_LABELS[previewData.action]}
              </p>
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[13px] font-medium text-slate-600">Item</TableHead>
                    <TableHead className="text-[13px] font-medium text-slate-600">Before</TableHead>
                    <TableHead className="text-[13px] font-medium text-slate-600">After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.rows.map((row) => {
                    const field = Object.keys(row.after)[0] ?? Object.keys(row.before)[0] ?? '';
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-[13px] font-semibold text-slate-900">
                          {row.name}
                        </TableCell>
                        <TableCell className="text-[13px] text-slate-600">
                          {formatBulkPreviewValue(field, row.before[field] ?? null)}
                        </TableCell>
                        <TableCell className="text-[13px] font-medium text-text">
                          {formatBulkPreviewValue(field, row.after[field] ?? null)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void runApply()}
            disabled={busy || !previewData || !built.ok}
          >
            {bulk.isPending && <Loader2 className="size-4 animate-spin" />}
            Apply to {ids.length} {ids.length === 1 ? 'item' : 'items'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
