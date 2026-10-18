'use client';

import {
  DIETARY_LABELS,
  DIETARY_TYPES,
  MENU_BULK_MAX_IDS,
  MENU_VENDOR_KINDS,
  menuBulkSchema,
  rupeesToPaise,
  type DietaryType,
  type MenuBulkInput,
  type MenuBulkPreview,
  type MenuVendorKind,
} from '@zoauro/shared';
import { Plus, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Pagination, pageFromParam } from '../../components/shared/Pagination';
import { Badge } from '../../components/ui/badge';
import { Button, buttonClass } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { useUrlState } from '../../lib/url-state';
import { cn } from '../../lib/utils';
import { selectedZone, type ScopeZone } from '../../lib/zone-scope';
import { formatPaise } from '../audit/format';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardError, CardSkeleton, EmptyState } from '../dashboard/parts';
import { useZoneOptions } from '../platform-settings/api';
import { useCategories, useInvalidateMenu, useMenuItems, type MenuFilters } from './api';
import {
  AVAILABILITY_LABEL,
  AVAILABILITY_TONE,
  MENU_TABS,
  VENDOR_KIND_LABEL,
  menuTabFromParam,
} from './labels';
import { MenuItemEditor } from './MenuItemEditor';

// Menu items (M08, SA-2.4; D119, D124, D126), ported from Chittra Priya's menu screen: tabs with API counts, search,
// vendor type / category / dietary / featured filters, 25 a page, URL state, zone switcher. Select items for a bulk
// change (availability, category, price): the preview shows every change and every skip before anything is written.

type Row = NonNullable<ReturnType<typeof useMenuItems>['data']>['data'][number];

export function MenuItemsPage({
  role,
  myZones = [],
  can,
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones?: ScopeZone[];
  can: { add: boolean; edit: boolean };
}) {
  const url = useUrlState();
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
  const zone = selectedZone(url.params.get('zone'), zones);
  const waiting = role === 'SUPER_ADMIN' && url.params.get('zone') !== null && !allZones.data;
  const tab = menuTabFromParam(url.params.get('tab'));
  const q = url.params.get('q') ?? '';
  const vk = url.params.get('vendor');
  const vendorKind = (MENU_VENDOR_KINDS as readonly string[]).includes(vk ?? '')
    ? (vk as MenuVendorKind)
    : undefined;
  const categoryId = url.params.get('category') ?? undefined;
  const dt = url.params.get('dietary');
  const dietary = (DIETARY_TYPES as readonly string[]).includes(dt ?? '')
    ? (dt as DietaryType)
    : undefined;
  const featured = url.params.get('featured') === '1';
  const page = pageFromParam(url.params.get('page'));
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [bulk, setBulk] = useState(false);

  const filters: MenuFilters = {
    page,
    tab,
    sort: '-createdAt',
    ...(q ? { q } : {}),
    ...(zone ? { zoneId: zone.id } : {}),
    ...(vendorKind ? { vendorKind } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(dietary ? { dietary } : {}),
    ...(featured ? { featured } : {}),
  };
  const list = useMenuItems(filters, !waiting);
  const categories = useCategories(zone?.id);
  const counts = list.data?.meta.counts;
  const rows = list.data?.data ?? [];

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      if (q !== next) url.patch({ q: next || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, q, url]);
  useEffect(
    () => setSelected([]),
    [page, tab, q, vendorKind, categoryId, dietary, featured, zone?.id],
  );

  const filtered = Boolean(q || vendorKind || categoryId || dietary || featured || tab !== 'all');
  const showZone = !zone && (role === 'SUPER_ADMIN' || zones.length > 1);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Menu Items"
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Service Management' },
          { label: 'Menu Items' },
        ]}
        description="Every restaurant and Home Food item. Vendor changes wait in Food Item Requests; your edits apply at once."
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={
                role === 'SUPER_ADMIN'
                  ? '/super-admin/menu-items/categories'
                  : '/zone/menu-items/categories'
              }
              className={buttonClass('secondary')}
            >
              Categories
            </a>
            {can.add ? (
              <Button onClick={() => setEditing('new')}>
                <Plus aria-hidden className="size-4" /> Add item
              </Button>
            ) : null}
          </div>
        }
      />

      <div role="tablist" aria-label="Menu items by availability" className="flex flex-wrap gap-2">
        {MENU_TABS.map((t) => {
          const sel = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => url.patch({ tab: t.id === 'all' ? null : t.id, page: null })}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary',
                sel
                  ? 'border-primary bg-primary-soft font-semibold text-primary-strong'
                  : 'border-line bg-surface hover:bg-surface-muted',
              )}
            >
              {t.label}
              <span className="text-xs tabular-nums text-muted">{counts?.[t.count] ?? '—'}</span>
            </button>
          );
        })}
        {counts && counts.pendingChanges > 0 ? (
          <a
            href={
              role === 'SUPER_ADMIN'
                ? '/super-admin/food-item-requests'
                : '/zone/food-item-requests'
            }
            className="flex items-center gap-2 rounded-full border border-amber-200 bg-warning-soft px-3 py-1.5 text-sm"
          >
            Waiting for review <span className="text-xs tabular-nums">{counts.pendingChanges}</span>
          </a>
        ) : null}
      </div>

      <div role="search" aria-label="Find menu items" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
          Search
          <input
            type="search"
            className={inputClass()}
            placeholder="Item or vendor name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Vendor type
          <select
            className={inputClass('min-w-36')}
            value={vendorKind ?? ''}
            onChange={(e) => url.patch({ vendor: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {MENU_VENDOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {VENDOR_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Category
          <select
            className={inputClass('min-w-40')}
            value={categoryId ?? ''}
            onChange={(e) => url.patch({ category: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {(categories.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Dietary
          <select
            className={inputClass('min-w-36')}
            value={dietary ?? ''}
            onChange={(e) => url.patch({ dietary: e.target.value || null, page: null })}
          >
            <option value="">Any</option>
            {DIETARY_TYPES.map((d) => (
              <option key={d} value={d}>
                {DIETARY_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => url.patch({ featured: e.target.checked ? '1' : null, page: null })}
          />
          Featured only
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              url.patch({
                q: null,
                tab: null,
                vendor: null,
                category: null,
                dietary: null,
                featured: null,
                page: null,
              });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {can.edit && selected.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-input border border-primary bg-primary-soft p-3 text-sm"
          role="region"
          aria-label="Selected items"
        >
          <span className="font-semibold">{selected.length} selected</span>
          <Button size="sm" onClick={() => setBulk(true)}>
            Change selected…
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <Card>
        {list.isError ? (
          <CardError what="Menu items" onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <CardSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed aria-hidden className="size-5" />}
            title={filtered ? 'Nothing matches' : 'No menu items yet'}
          >
            {filtered
              ? 'Try another tab or filter.'
              : 'Items arrive from the vendor app, or add one here.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-busy={list.isFetching}>
              <caption className="sr-only">Menu items</caption>
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  {can.edit ? (
                    <th scope="col" className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select every item on this page"
                        checked={allOnPage}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? rows.map((r) => r.id).slice(0, MENU_BULK_MAX_IDS)
                              : [],
                          )
                        }
                      />
                    </th>
                  ) : null}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Item
                  </th>
                  {showZone ? (
                    <th scope="col" className="px-3 py-2 font-medium">
                      Zone
                    </th>
                  ) : null}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Vendor
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Price
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Stock
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 align-top">
                    {can.edit ? (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={selected.includes(r.id)}
                          onChange={(e) =>
                            setSelected((s) =>
                              e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id),
                            )
                          }
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      {can.edit ? (
                        <button
                          type="button"
                          className="text-left font-semibold hover:underline"
                          onClick={() => setEditing(r)}
                        >
                          {r.name}
                        </button>
                      ) : (
                        <span className="font-semibold">{r.name}</span>
                      )}
                      <p className="text-xs text-muted">
                        {r.dietary ? DIETARY_LABELS[r.dietary] : ''}
                        {r.isFeatured ? ' · Featured' : ''}
                        {r.hasPendingChange ? ' · Change waiting' : ''}
                      </p>
                    </td>
                    {showZone ? (
                      <td className="px-3 py-2">
                        <Badge tone="neutral">{r.zone.code}</Badge>
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      {r.vendor.name}
                      <p className="text-xs text-muted">{VENDOR_KIND_LABEL[r.vendor.kind]}</p>
                    </td>
                    <td className="px-3 py-2">{r.category.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPaise(r.price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.stock}</td>
                    <td className="px-3 py-2">
                      <Badge tone={AVAILABILITY_TONE[r.availability]} dot>
                        {AVAILABILITY_LABEL[r.availability]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            page={page}
            total={list.data.meta.total}
            noun={['item', 'items']}
            onPage={(p) => url.patch({ page: p > 1 ? String(p) : null })}
          />
        ) : null}
      </Card>

      {editing ? (
        <EditLoader id={editing === 'new' ? null : editing.id} onClose={() => setEditing(null)} />
      ) : null}
      {bulk ? (
        <BulkDialog
          ids={selected}
          categories={(categories.data?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
          onClose={() => setBulk(false)}
          onDone={() => {
            setBulk(false);
            setSelected([]);
          }}
        />
      ) : null}
    </div>
  );
}

/** Loads the full item (the editor needs the detail) or opens an empty editor. */
function EditLoader({ id, onClose }: { id: string | null; onClose: () => void }) {
  const client = useApiClient();
  const [item, setItem] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const load = (itemId: string) => client.get('/menu-items/{id}', { params: { id: itemId } });
  useEffect(() => {
    if (id) void load(id).then(setItem);
  }, [id]);
  if (id === null) return <MenuItemEditor onClose={onClose} />;
  return item ? <MenuItemEditor item={item} onClose={onClose} /> : null;
}

/** D124 bulk change: choose the action, preview every change and skip, then apply (all or nothing). */
function BulkDialog({
  ids,
  categories,
  onClose,
  onDone,
}: {
  ids: string[];
  categories: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMenu();
  const { toast } = useToast();
  const [action, setAction] = useState<MenuBulkInput['action']>('availability');
  const [disable, setDisable] = useState(true);
  const [reason, setReason] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<MenuBulkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const body = (): MenuBulkInput | string => {
    const input =
      action === 'availability'
        ? {
            action,
            ids,
            adminDisabled: disable,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }
        : action === 'category'
          ? { action, ids, categoryId }
          : {
              action,
              ids,
              mode,
              value: mode === 'amount' ? rupeesToPaise(Number(value)) : Number(value),
            };
    const p = menuBulkSchema.safeParse(input);
    return p.success ? p.data : (p.error.issues[0]?.message ?? 'Check the values');
  };

  const run = async (apply: boolean) => {
    const b = body();
    if (typeof b === 'string') return setAlert(b);
    setBusy(true);
    setAlert(null);
    try {
      if (!apply) setPreview(await client.post('/menu-items/bulk/preview', { body: b }));
      else {
        const r = await client.post('/menu-items/bulk', { body: b });
        toast({
          title: `${r.updated} item${r.updated === 1 ? '' : 's'} changed`,
          ...(r.skipped.length ? { description: `${r.skipped.length} skipped` } : {}),
        });
        await invalidate();
        onDone();
      }
    } catch (err) {
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
    } finally {
      setBusy(false);
    }
  };

  const shown = (v: string | number | boolean) =>
    action === 'price' && typeof v === 'number'
      ? formatPaise(v)
      : action === 'category' && typeof v === 'string'
        ? (categories.find((c) => c.id === v)?.name ?? 'Another category')
        : typeof v === 'boolean'
          ? v
            ? 'Disabled'
            : 'Enabled'
          : String(v);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <div>
          <DialogTitle>
            Change {ids.length} item{ids.length === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            Preview first: nothing changes until you apply. One item outside your zones stops the
            whole change.
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        {!preview ? (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">Change</legend>
              {(['availability', 'category', 'price'] as const).map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="bulk-action"
                    checked={action === a}
                    onChange={() => setAction(a)}
                  />
                  {a === 'availability'
                    ? 'Enable or disable'
                    : a === 'category'
                      ? 'Category'
                      : 'Price'}
                </label>
              ))}
            </fieldset>
            {action === 'availability' ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={disable}
                    onChange={(e) => setDisable(e.target.checked)}
                  />
                  Disable them (otherwise enable)
                </label>
                {disable ? (
                  <FormField label="Reason (sent to the vendors)">
                    <textarea
                      className={inputClass('min-h-16 py-2')}
                      maxLength={300}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </FormField>
                ) : null}
              </>
            ) : action === 'category' ? (
              <FormField label="New category">
                <select
                  className={inputClass()}
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">Choose</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="By">
                  <select
                    className={inputClass()}
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'percent' | 'amount')}
                  >
                    <option value="percent">Percent</option>
                    <option value="amount">Rupees</option>
                  </select>
                </FormField>
                <FormField
                  label={mode === 'percent' ? 'Change (%)' : 'Change (₹)'}
                  hint="Negative lowers the price"
                >
                  <input
                    type="number"
                    step="0.01"
                    className={inputClass()}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </FormField>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void run(false)} disabled={busy}>
                Preview
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {preview.changes.length} will change
              {preview.skipped.length ? `, ${preview.skipped.length} skipped` : ''}.
            </p>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto text-sm">
              {preview.changes.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-1.5">
                  <span>{c.name}</span>
                  <span className="tabular-nums">
                    <span className="text-muted line-through">{shown(c.before)}</span> →{' '}
                    {shown(c.after)}
                  </span>
                </li>
              ))}
            </ul>
            {preview.skipped.length ? (
              <p className="text-xs text-muted">
                Skipped:{' '}
                {preview.skipped
                  .map((s) => s.reason.toLowerCase().replaceAll('_', ' '))
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(', ')}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
                Back
              </Button>
              <Button
                onClick={() => void run(true)}
                disabled={busy || preview.changes.length === 0}
              >
                Apply to {preview.changes.length}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
