'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  VENDOR_DOC_TYPES,
  type OnboardingChecklistInput,
  type VendorDocType,
  type VendorKind,
} from '@zoauro/shared';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ErrorState, TableSkeleton } from '../../components/shared/states';
import { ApiError } from '../../lib/api';
import { useOnboardingChecklist, useUpdateOnboardingChecklist } from './api';

/**
 * A1 checklist configuration (doc 09 PUT /onboarding/checklist, Super Admin
 * only). Weights feed the advisory readiness score — they never gate
 * activation. Rows the admin keeps but deactivates simply stop counting.
 */

interface DraftRow {
  docType: VendorDocType;
  label: string;
  weight: number;
  active: boolean;
  sortOrder: number;
}

export function ChecklistConfigDialog({
  kind,
  onClose,
}: {
  kind: VendorKind;
  onClose: () => void;
}) {
  const checklist = useOnboardingChecklist(kind);
  const save = useUpdateOnboardingChecklist(kind);
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const data = checklist.data?.data;
    if (data && rows === null) {
      setRows(
        data.map((r, index) => ({
          docType: r.docType as VendorDocType,
          label: r.label,
          weight: r.weight,
          active: r.active,
          sortOrder: r.sortOrder === 0 && index > 0 ? index : r.sortOrder || index,
        })),
      );
    }
  }, [checklist.data, rows]);

  const busy = checklist.isPending || save.isPending;
  const usedTypes = new Set((rows ?? []).map((r) => r.docType));
  const unusedTypes = VENDOR_DOC_TYPES.filter((t) => !usedTypes.has(t));

  function patchRow(index: number, patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev ? prev.map((row, i) => (i === index ? { ...row, ...patch } : row)) : prev,
    );
    setError(null);
  }

  function addRow(type: VendorDocType) {
    setRows((prev) =>
      prev
        ? [
            ...prev,
            {
              docType: type,
              label: type,
              weight: 10,
              active: true,
              sortOrder: prev.length,
            },
          ]
        : prev,
    );
    setError(null);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
    setError(null);
  }

  async function saveChecklist() {
    if (!rows || rows.length === 0) {
      setError('Keep at least one requirement.');
      return;
    }
    if (rows.some((r) => r.label.trim() === '')) {
      setError('Every requirement needs a label.');
      return;
    }
    const input: OnboardingChecklistInput = {
      kind,
      requirements: rows.map((r, index) => ({
        docType: r.docType,
        label: r.label.trim(),
        weight: r.weight,
        active: r.active,
        sortOrder: index,
      })),
    };
    try {
      await save.mutateAsync(input);
      toast.success('Onboarding checklist saved');
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save the checklist.';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {kind === 'restaurant' ? 'Restaurant' : 'Home food provider'} onboarding checklist
          </DialogTitle>
          <DialogDescription>
            Advisory requirements for the readiness score. Weights explain how complete a vendor's
            paperwork is — they never block verification or activation.
          </DialogDescription>
        </DialogHeader>

        {checklist.isPending ? (
          <TableSkeleton rows={3} />
        ) : checklist.isError ? (
          <ErrorState
            message={
              checklist.error instanceof ApiError
                ? checklist.error.message
                : 'Could not load the checklist.'
            }
            requestId={checklist.error instanceof ApiError ? checklist.error.requestId : undefined}
            onRetry={() => void checklist.refetch()}
          />
        ) : rows === null ? (
          <TableSkeleton rows={3} />
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li
                  key={row.docType}
                  className="flex flex-wrap items-end gap-2 rounded-[--radius-card] border border-border p-3"
                >
                  <div className="min-w-32">
                    <Label className="text-xs">Document</Label>
                    <p className="text-sm font-medium text-text">{row.docType}</p>
                  </div>
                  <div className="min-w-40 flex-1 space-y-1">
                    <Label htmlFor={`label-${row.docType}`}>Label</Label>
                    <Input
                      id={`label-${row.docType}`}
                      value={row.label}
                      disabled={busy}
                      onChange={(e) => patchRow(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label htmlFor={`weight-${row.docType}`}>Weight</Label>
                    <Input
                      id={`weight-${row.docType}`}
                      type="number"
                      min={0}
                      max={100}
                      value={row.weight}
                      disabled={busy}
                      onChange={(e) => patchRow(index, { weight: Number(e.target.value) })}
                    />
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.active}
                    aria-label={`${row.docType} counts toward the score`}
                    disabled={busy}
                    onClick={() => patchRow(index, { active: !row.active })}
                    className={`h-9 rounded-[--radius-input] border px-3 text-xs font-medium ${
                      row.active
                        ? 'border-border bg-surface text-text'
                        : 'border-border bg-bg text-muted'
                    }`}
                  >
                    {row.active ? 'Active' : 'Inactive'}
                  </button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>

            {unusedTypes.length > 0 && (
              <div className="flex items-end gap-2">
                <div className="min-w-44 space-y-1.5">
                  <Label>Add document type</Label>
                  <Select onValueChange={(value) => addRow(value as VendorDocType)}>
                    <SelectTrigger aria-label="Add document type">
                      <SelectValue placeholder="Choose a type" />
                    </SelectTrigger>
                    <SelectContent>
                      {unusedTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-danger">{error}</p>}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void saveChecklist()} disabled={busy}>
                Save checklist
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
