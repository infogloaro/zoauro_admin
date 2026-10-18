'use client';

import { useQuery } from '@tanstack/react-query';
import {
  DIETARY_LABELS,
  DIETARY_TYPES,
  MENU_ITEM_DESCRIPTION_MAX,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  paiseToRupees,
  rupeesToPaise,
  type DietaryType,
  type MenuItemDetail,
  type MenuVendorKind,
} from '@zoauro/shared';
import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { fileProblem, useUploadFile, type VendorListResult } from '../vendors/api';
import { useCategories, useInvalidateMenu } from './api';
import { VENDOR_KIND_LABEL } from './labels';

// Add or edit a menu item (doc 22, D119, D126). The zone is the vendor's. Admin edits apply at once (vendor changes go
// through Food Item Requests). The vendor's on/off switch stays the vendor's; the admin's is "Disable" with a reason
// the vendor app receives. Prices are typed in rupees and stored in paise. Edit sends only what changed.

export function MenuItemEditor({
  item,
  onClose,
}: {
  /** edit this one; absent = add */
  item?: MenuItemDetail;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateMenu();
  const upload = useUploadFile();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [vendorKind, setVendorKind] = useState<MenuVendorKind>(item?.vendor.kind ?? 'RESTAURANT');
  const [vendorId, setVendorId] = useState(item?.vendor.id ?? '');
  const [categoryId, setCategoryId] = useState(item?.category.id ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item ? String(paiseToRupees(item.price)) : '');
  const [stock, setStock] = useState(item ? String(item.stock) : '0');
  const [featured, setFeatured] = useState(item?.isFeatured ?? false);
  const [dietary, setDietary] = useState<DietaryType | ''>(item?.dietary ?? '');
  const [disabled, setDisabled] = useState(item?.adminDisabled ?? false);
  const [reason, setReason] = useState('');
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const vendors = useQuery<VendorListResult>({
    queryKey: ['menu', 'vendors', vendorKind],
    enabled: !item,
    queryFn: ({ signal }) =>
      vendorKind === 'RESTAURANT'
        ? client.get('/restaurants', { query: { page: 1, pageSize: 100, sort: 'name' }, signal })
        : client.get('/homemakers', { query: { page: 1, pageSize: 100, sort: 'name' }, signal }),
    staleTime: 60_000,
  });
  const vendor = item
    ? { id: item.vendor.id, zoneId: item.zone.id }
    : (() => {
        const v = vendors.data?.data.find((x) => x.id === vendorId);
        return v ? { id: v.id, zoneId: v.zone?.id ?? null } : null;
      })();
  const categories = useCategories(vendor?.zoneId ?? undefined);

  const addPhoto = async (file: File) => {
    const problem = fileProblem(file, false);
    if (problem) return setAlert(problem);
    if (!vendor?.zoneId) return setAlert('Choose a vendor that has a zone first.');
    setBusy(true);
    setAlert(null);
    try {
      setImageKey(await upload(file, vendor.zoneId, vendor.id, 'MENU_IMAGE'));
    } catch (err) {
      setAlert(
        isApiError(err) ? err.message || TRY_AGAIN : err instanceof Error ? err.message : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async () => {
    setAlert(null);
    const toErrors = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) => {
      const out: Record<string, string> = {};
      for (const i of issues) out[String(i.path[0] ?? '')] ??= i.message;
      setErrors(out);
    };
    const pricePaise = price.trim() === '' ? NaN : rupeesToPaise(Number(price));
    let call: () => Promise<{ id: string }>;
    if (item) {
      const c: Record<string, unknown> = {};
      if (categoryId !== item.category.id) c['categoryId'] = categoryId;
      if (name.trim() !== item.name) c['name'] = name.trim();
      if ((description.trim() || null) !== item.description)
        c['description'] = description.trim() || null;
      if (pricePaise !== item.price) c['price'] = pricePaise;
      if (Number(stock) !== item.stock) c['stock'] = Number(stock);
      if (featured !== item.isFeatured) c['isFeatured'] = featured;
      if ((dietary || null) !== item.dietary) c['dietary'] = dietary || null;
      if (imageKey) c['imageKey'] = imageKey;
      if (disabled !== item.adminDisabled) {
        c['adminDisabled'] = disabled;
        if (reason.trim()) c['reason'] = reason.trim();
      }
      if (Object.keys(c).length === 0) return setAlert('Nothing changed.');
      const p = menuItemUpdateSchema.safeParse(c);
      if (!p.success) return toErrors(p.error.issues);
      call = () => client.patch('/menu-items/{id}', { params: { id: item.id }, body: p.data });
    } else {
      const p = menuItemCreateSchema.safeParse({
        vendorKind,
        vendorId,
        categoryId,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        price: pricePaise,
        stock: Number(stock),
        isFeatured: featured,
        ...(dietary ? { dietary } : {}),
        ...(imageKey ? { imageKey } : {}),
      });
      if (!p.success) return toErrors(p.error.issues);
      call = () => client.post('/menu-items', { body: p.data });
    }
    setErrors({});
    setBusy(true);
    try {
      await call();
      toast({ title: item ? 'Item saved' : `${name.trim()} added` });
      await invalidate();
      onClose();
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      setAlert(isApiError(err) ? err.message || TRY_AGAIN : TRY_AGAIN);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <div>
          <DialogTitle>{item ? `Edit ${item.name}` : 'Add a menu item'}</DialogTitle>
          <DialogDescription>
            {item
              ? `${item.vendor.name} · ${item.zone.name}. Your changes apply at once.`
              : 'The item belongs to one vendor and its zone.'}
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void save();
          }}
        >
          {!item ? (
            <>
              <FormField label="Vendor type">
                <select
                  className={inputClass()}
                  value={vendorKind}
                  onChange={(e) => {
                    setVendorKind(e.target.value as MenuVendorKind);
                    setVendorId('');
                    setCategoryId('');
                  }}
                >
                  {(['RESTAURANT', 'HOMEMAKER'] as const).map((k) => (
                    <option key={k} value={k}>
                      {VENDOR_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Vendor" error={errors['vendorId']}>
                <select
                  className={inputClass()}
                  value={vendorId}
                  onChange={(e) => {
                    setVendorId(e.target.value);
                    setCategoryId('');
                  }}
                >
                  <option value="">{vendors.isPending ? 'Loading…' : 'Choose'}</option>
                  {(vendors.data?.data ?? []).map((v) => (
                    <option key={v.id} value={v.id} disabled={!v.zone}>
                      {v.name}
                      {v.zone ? ` (${v.zone.code})` : ' (no zone yet)'}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          ) : null}
          <FormField label="Name" error={errors['name']}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Category" error={errors['categoryId']}>
            <select
              className={inputClass()}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={!vendor}
            >
              <option value="">Choose</option>
              {(categories.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.zone ? '' : ' (all zones)'}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Price (₹)" error={errors['price']}>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </FormField>
          <FormField label="Stock" error={errors['stock']} hint="0 shows the item as out of stock">
            <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} />
          </FormField>
          <FormField label="Dietary">
            <select
              className={inputClass()}
              value={dietary}
              onChange={(e) => setDietary(e.target.value as DietaryType | '')}
            >
              <option value="">Not set</option>
              {DIETARY_TYPES.map((d) => (
                <option key={d} value={d}>
                  {DIETARY_LABELS[d]}
                </option>
              ))}
            </select>
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-input border border-line p-3">
            <span id="menu-featured" className="text-sm font-medium">
              Featured
            </span>
            <Switch checked={featured} onChange={setFeatured} labelledBy="menu-featured" />
          </div>
          <FormField
            label="Description"
            hint={`Optional, up to ${MENU_ITEM_DESCRIPTION_MAX} characters`}
            error={errors['description']}
            className="flex flex-col gap-1.5 sm:col-span-2"
          >
            <textarea
              className={inputClass('min-h-20 py-2')}
              maxLength={MENU_ITEM_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Choose a photo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addPhoto(f);
              }}
            />
            <Button
              variant="secondary"
              disabled={busy || !vendor}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus aria-hidden className="size-4" />{' '}
              {imageKey
                ? 'Photo ready, change it'
                : item?.hasImage
                  ? 'Replace the photo'
                  : 'Add a photo'}
            </Button>
            <span className="text-xs text-muted">JPG, PNG or WebP up to 5 MB.</span>
          </div>
          {item ? (
            <div className="flex flex-col gap-2 rounded-input border border-line p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <span id="menu-disabled" className="text-sm font-medium">
                  Disabled by admin
                </span>
                <Switch checked={disabled} onChange={setDisabled} labelledBy="menu-disabled" />
              </div>
              {disabled && !item.adminDisabled ? (
                <FormField label="Reason (sent to the vendor app)" error={errors['reason']}>
                  <textarea
                    className={inputClass('min-h-16 py-2')}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </FormField>
              ) : null}
              <p className="text-xs text-muted">
                The vendor’s own on/off switch is theirs; this one hides the item whatever they set.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {item ? 'Save' : 'Add item'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
