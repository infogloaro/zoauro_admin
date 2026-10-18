'use client';

import {
  CATEGORY_NAME,
  categoryCreateSchema,
  categoryUpdateSchema,
  type Category,
} from '@zoauro/shared';
import { FolderTree, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { useZoneOptions } from '../platform-settings/api';
import { useCategories, useInvalidateMenu } from './api';

// Menu categories (D119): global categories (Super Admin only) and zone categories, in display order, with the number of
// live items. Add, rename, reorder and delete (the API refuses a category that still has items).

type Target =
  { kind: 'new' } | { kind: 'edit'; category: Category } | { kind: 'delete'; category: Category };

export function CategoriesPage({
  role,
  myZones = [],
  can,
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  can: { add: boolean; edit: boolean; delete: boolean };
}) {
  const allZones = useZoneOptions(role === 'SUPER_ADMIN');
  const zones: ScopeZone[] =
    role === 'SUPER_ADMIN'
      ? (allZones.data?.data ?? []).map((z) => ({
          id: z.id,
          name: z.name,
          code: z.code,
          colorHex: z.colorHex,
        }))
      : myZones;
  const list = useCategories();
  const [target, setTarget] = useState<Target | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Menu Categories"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          {
            label: 'Menu Items',
            href: role === 'SUPER_ADMIN' ? '/super-admin/menu-items' : '/zone/menu-items',
          },
          { label: 'Categories' },
        ]}
        description={
          role === 'SUPER_ADMIN'
            ? 'Categories for every zone, and categories of single zones.'
            : 'Categories for every zone and for your zones.'
        }
        actions={
          can.add ? (
            <Button onClick={() => setTarget({ kind: 'new' })}>
              <Plus aria-hidden className="size-4" /> Add category
            </Button>
          ) : undefined
        }
      />
      <Card>
        {list.isError ? (
          <CardError what="Categories" onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <CardSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FolderTree aria-hidden className="size-5" />}
            title="No categories yet"
          >
            Add the first one; items are filed under categories.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line" aria-label="Categories">
            {rows.map((c) => {
              const mine = c.zone
                ? role === 'SUPER_ADMIN' || zones.some((z) => z.id === c.zone?.id)
                : role === 'SUPER_ADMIN';
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-10 text-xs tabular-nums text-muted">#{c.sortOrder}</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold">{c.name}</span>
                  <Badge tone={c.zone ? 'neutral' : 'brand'}>
                    {c.zone ? c.zone.code : 'All zones'}
                  </Badge>
                  <span className="text-xs text-muted">
                    {c.itemCount} item{c.itemCount === 1 ? '' : 's'}
                  </span>
                  {mine && can.edit ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setTarget({ kind: 'edit', category: c })}
                      aria-label={`Edit ${c.name}`}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {mine && can.delete ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={c.itemCount > 0}
                      title={c.itemCount > 0 ? 'Move its items first' : undefined}
                      onClick={() => setTarget({ kind: 'delete', category: c })}
                      aria-label={`Delete ${c.name}`}
                    >
                      Delete
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {target ? (
        <CategoryDialog target={target} role={role} zones={zones} onClose={() => setTarget(null)} />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  target,
  role,
  zones,
  onClose,
}: {
  target: Target;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  zones: ScopeZone[];
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMenu();
  const { toast } = useToast();
  const existing = target.kind === 'new' ? null : target.category;
  const [name, setName] = useState(existing?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? 0));
  const [zoneId, setZoneId] = useState<string>(role === 'SUPER_ADMIN' ? '' : (zones[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setAlert(null);
    try {
      if (target.kind === 'delete') {
        await client.delete('/categories/{id}', { params: { id: target.category.id } });
        toast({ title: `${target.category.name} deleted` });
      } else if (target.kind === 'edit') {
        const p = categoryUpdateSchema.safeParse({
          ...(name.trim() !== target.category.name ? { name: name.trim() } : {}),
          ...(Number(sortOrder) !== target.category.sortOrder
            ? { sortOrder: Number(sortOrder) }
            : {}),
        });
        if (!p.success) throw new Error(p.error.issues[0]?.message ?? 'Check the values');
        await client.patch('/categories/{id}', {
          params: { id: target.category.id },
          body: p.data,
        });
        toast({ title: 'Category saved' });
      } else {
        const p = categoryCreateSchema.safeParse({
          zoneId: zoneId || null,
          name: name.trim(),
          sortOrder: Number(sortOrder),
        });
        if (!p.success) throw new Error(p.error.issues[0]?.message ?? 'Check the values');
        await client.post('/categories', { body: p.data });
        toast({ title: `${name.trim()} added` });
      }
      await invalidate();
      onClose();
    } catch (err) {
      setAlert(
        isApiError(err) ? err.message || TRY_AGAIN : err instanceof Error ? err.message : TRY_AGAIN,
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>
            {target.kind === 'new'
              ? 'Add a category'
              : target.kind === 'edit'
                ? `Edit ${target.category.name}`
                : `Delete ${target.category.name}?`}
          </DialogTitle>
          <DialogDescription>
            {target.kind === 'delete'
              ? 'Only an empty category can be deleted.'
              : 'Lower numbers show first in the apps.'}
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {target.kind !== 'delete' ? (
          <div className="flex flex-col gap-4">
            {target.kind === 'new' ? (
              <FormField label="For">
                <select
                  className={inputClass()}
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  {role === 'SUPER_ADMIN' ? <option value="">Every zone</option> : null}
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} only
                    </option>
                  ))}
                </select>
              </FormField>
            ) : null}
            <FormField label="Name" hint={`Up to ${CATEGORY_NAME.max} characters`}>
              <Input
                value={name}
                maxLength={CATEGORY_NAME.max}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Display order">
              <Input
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </FormField>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={target.kind === 'delete' ? 'danger' : 'primary'}
            onClick={() => void run()}
            disabled={busy || (target.kind !== 'delete' && name.trim() === '')}
          >
            {target.kind === 'delete' ? 'Delete' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
