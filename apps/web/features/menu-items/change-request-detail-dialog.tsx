'use client';

import { useState } from 'react';
import {
  MENU_CHANGE_STATUS_LABELS,
  MENU_CHANGE_STATUS_TONES,
  type MenuItemChangeRequestDetail,
} from '@zoauro/shared';
import { Check, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/format';
import { ConfirmDialog } from '../vendors/vendor-actions';
import { useDecideMenuChangeRequest } from './api';
import {
  formatChangeValue,
  MENU_CHANGE_KIND_LABELS,
  rejectReasonValid,
  runChangeDecision,
} from './change-requests';

/**
 * Detail view for one vendor menu change request (R09, D119/D125/D127):
 * base → live → proposed per changed field, with Approve (confirm sends the
 * loaded `version` for the optimistic check) and Reject (reason required)
 * while the request is still PENDING. A 409 version clash toasts “reload
 * and retry” and refetches the detail; success toasts and lets the caller
 * close and refetch the list (the mutation already invalidated it).
 */
export function ChangeRequestDetailDialog({
  detail,
  onDecided,
  onReload,
  onClose,
}: {
  detail: MenuItemChangeRequestDetail;
  /** A decision landed — close and show the refreshed list. */
  onDecided: () => void;
  /** Stale version — refetch this detail so the operator can retry. */
  onReload: () => void;
  onClose: () => void;
}) {
  const decide = useDecideMenuChangeRequest();
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const busy = decide.isPending;
  const pending = detail.status === 'PENDING';
  const title = detail.itemName ?? 'New menu item';

  async function run(decision: 'APPROVED' | 'REJECTED', rejectReason?: string) {
    const result = await runChangeDecision({
      id: detail.id,
      decision,
      version: detail.version,
      ...(rejectReason !== undefined ? { reason: rejectReason } : {}),
      decide: (id, input) =>
        decide.mutateAsync({
          id,
          decision: decision === 'REJECTED' ? 'reject' : 'approve',
          input,
        }),
    });
    if (result.ok) {
      onDecided();
    } else if (result.stale) {
      onReload();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            <Badge tone={MENU_CHANGE_STATUS_TONES[detail.status]}>
              {MENU_CHANGE_STATUS_LABELS[detail.status] ?? detail.status}
            </Badge>
            <Badge tone="info">{MENU_CHANGE_KIND_LABELS[detail.changeKind]}</Badge>
          </DialogTitle>
          <DialogDescription>
            {detail.vendorName} · {detail.zone.name} · submitted {formatDateTime(detail.createdAt)}{' '}
            via {detail.source}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            {detail.live
              ? 'The live item is compared against the vendor’s proposal.'
              : 'This proposal would create a new item — there is no live record yet.'}
          </p>

          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[13px] font-medium text-slate-600">Field</TableHead>
                <TableHead className="text-[13px] font-medium text-slate-600">Base</TableHead>
                <TableHead className="text-[13px] font-medium text-slate-600">Live</TableHead>
                <TableHead className="text-[13px] font-medium text-slate-600">Proposed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.fields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-[13px] text-muted">
                    No changed fields on this request.
                  </TableCell>
                </TableRow>
              ) : (
                detail.fields.map((field) => (
                  <TableRow
                    key={field.field}
                    className={cn(field.changed && 'bg-amber-50/60')}
                    data-changed={field.changed ? 'true' : undefined}
                  >
                    <TableCell className="text-[13px] font-semibold text-slate-900">
                      {field.field}
                      {field.changed && (
                        <Badge tone="warning" className="ms-2">
                          Changed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-500">
                      {formatChangeValue(field.field, field.base)}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-700">
                      {formatChangeValue(field.field, field.live)}
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-text">
                      {formatChangeValue(field.field, field.proposed)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {detail.status !== 'PENDING' && detail.decisionReason && (
            <p className="text-[13px] text-danger">
              Decision reason: {detail.decisionReason}
              {detail.decidedAt ? ` · ${formatDateTime(detail.decidedAt)}` : ''}
            </p>
          )}

          {pending && rejecting && (
            <div className="space-y-1.5">
              <Label htmlFor="cr-reject-reason">
                Reject reason <span className="text-danger">*</span>
              </Label>
              <Textarea
                id="cr-reject-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Does not match the catalog rules"
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {pending &&
            (rejecting ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRejecting(false);
                    setReason('');
                  }}
                  disabled={busy}
                >
                  <X className="size-4" /> Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || !rejectReasonValid(reason)}
                  onClick={() => void run('REJECTED', reason.trim())}
                >
                  Confirm reject
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
                  <X className="size-4" /> Reject
                </Button>
                <Button type="button" onClick={() => setConfirmApprove(true)} disabled={busy}>
                  <Check className="size-4" /> Approve
                </Button>
              </>
            ))}
        </div>

        {confirmApprove && (
          <ConfirmDialog
            title={`Approve ${title}?`}
            description="The proposal is applied to the live item (vendor-owned fields only) and the request is marked Approved. This is audited."
            confirmLabel="Approve"
            destructive={false}
            busy={busy}
            onConfirm={() => {
              setConfirmApprove(false);
              void run('APPROVED');
            }}
            onClose={() => setConfirmApprove(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
