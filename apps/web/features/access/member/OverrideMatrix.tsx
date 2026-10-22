'use client';

import {
  isGrantable,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  type OverrideEffect,
  type PermissionAction,
  type PermissionKey,
  type PermissionModule,
} from '@zoauro/shared';
import { Check, Lock, Minus, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { cn } from '../../../lib/utils';
import { useAccessPreview } from './api';
import { nextEffect } from './draft';
import { ACTION_LABEL, moduleLabel, NEVER_GRANTABLE } from './labels';

// The overrides of one assignment as a modules × actions table (D104): each grantable cell is a button cycling
// Profile → Grant → Deny. Cells a Zonal Admin can never hold (doc 04 section 3) are disabled and say why. Which cells
// are grantable comes from the API's access preview (its matrix applies the Control Panel switches, e.g. D155
// commission:edit once access.commissionEditGrantable is on). A switch only ever adds cells to the static rule.

type Overrides = Partial<Record<PermissionKey, OverrideEffect>>;

const STATE_TEXT = {
  none: 'profile default',
  GRANT: 'granted (override)',
  DENY: 'denied (override)',
} as const;

export function OverrideMatrix({
  memberId,
  zoneId,
  zoneName,
  overrides,
  onChange,
}: {
  memberId: string;
  zoneId: string;
  zoneName: string;
  overrides: Overrides;
  onChange: (key: PermissionKey, effect: OverrideEffect | undefined) => void;
}) {
  const preview = useAccessPreview(memberId, zoneId);
  const grantable = preview.data
    ? new Set(preview.data.matrix.filter((c) => c.grantable).map((c) => `${c.module}:${c.action}`))
    : null;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <caption className="sr-only">Overrides in {zoneName}</caption>
          <thead className="text-left font-semibold text-muted uppercase">
            <tr>
              <th scope="col" className="py-1.5 pr-2">
                Module
              </th>
              {PERMISSION_ACTIONS.map((a) => (
                <th key={a} scope="col" className="px-1 py-1.5 text-center">
                  {ACTION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {PERMISSION_MODULES.map((m) => (
              <tr key={m}>
                <th scope="row" className="py-1 pr-2 text-left font-medium text-text">
                  {moduleLabel(m)}
                </th>
                {PERMISSION_ACTIONS.map((a) => (
                  <td key={a} className="px-1 py-1 text-center">
                    <Cell
                      module={m}
                      action={a}
                      grantable={isGrantable(m, a) || (grantable?.has(`${m}:${a}`) ?? false)}
                      effect={overrides[`${m}:${a}`]}
                      onCycle={(e) => onChange(`${m}:${a}`, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

const CELL = 'inline-flex h-7 w-full min-w-12 items-center justify-center gap-1 rounded-input';

function Cell({
  module,
  action,
  grantable,
  effect,
  onCycle,
}: {
  module: PermissionModule;
  action: PermissionAction;
  grantable: boolean;
  effect: OverrideEffect | undefined;
  onCycle: (next: OverrideEffect | undefined) => void;
}) {
  if (!grantable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* the wrapper takes the hover: a disabled button fires no pointer events */}
          <span className="inline-flex w-full">
            <button
              type="button"
              disabled
              aria-label={`${module} ${action}: ${NEVER_GRANTABLE.toLowerCase()}`}
              className={cn(CELL, 'cursor-not-allowed bg-surface-muted text-muted opacity-60')}
            >
              <Lock aria-hidden className="size-3" />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{NEVER_GRANTABLE}</TooltipContent>
      </Tooltip>
    );
  }
  const Icon = effect === 'GRANT' ? Check : effect === 'DENY' ? X : Minus;
  return (
    <button
      type="button"
      onClick={() => onCycle(nextEffect(effect))}
      aria-label={`${module} ${action}: ${STATE_TEXT[effect ?? 'none']}`}
      className={cn(
        CELL,
        'border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        effect === 'GRANT'
          ? 'border-success/40 bg-success-soft font-semibold text-success'
          : effect === 'DENY'
            ? 'border-danger/40 bg-danger-soft font-semibold text-danger'
            : 'border-line bg-surface text-muted hover:bg-surface-muted',
      )}
    >
      <Icon aria-hidden className="size-3" />
      <span aria-hidden>{effect === 'GRANT' ? 'Grant' : effect === 'DENY' ? 'Deny' : ''}</span>
    </button>
  );
}
