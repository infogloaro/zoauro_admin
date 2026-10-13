'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import {
  Controller,
  useForm,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import { toast } from 'sonner';
import {
  homemakerFormSchema,
  homemakerFormToPayload,
  restaurantFormSchema,
  restaurantFormToPayload,
  splitTags,
  type HomemakerCreateInput,
  type HomemakerUpdateInput,
  type RestaurantCreateInput,
  type RestaurantUpdateInput,
  type Vendor,
  type VendorKind,
} from '@zoauro/shared';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ApiError } from '../../lib/api';
import { useCreateVendor, useUpdateVendor } from './api';
import type { ZoneOption } from './vendor-filters';

/**
 * Add/Edit overlay for both kinds (doc 20 Add/Edit, doc 22 forms). One flat
 * value type carries every field of both kinds; each kind validates against
 * its own schema and submits only its own fields. `zoneId` is create-only —
 * moving a vendor is the audited move-zone action from Details (doc 09).
 */
interface VendorFormValues {
  zoneId: string;
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  area: string;
  lat: string;
  lng: string;
  cuisineTags: string;
  commissionPct: string;
  specialityTags: string;
  foodCategory: string;
  experienceYears: string;
  isAvailable: 'yes' | 'no';
  dailyCapacity: string;
}

function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormReturn<T>['setError'],
): void {
  if (!(error instanceof ApiError)) {
    toast.error('Could not reach the server. Try again.');
    return;
  }
  const fields = error.fieldErrors();
  for (const [field, issue] of Object.entries(fields)) {
    setError(field as Path<T>, { message: issue });
  }
  if (Object.keys(fields).length === 0) {
    toast.error(error.message);
  }
}

function defaultsFor(kind: VendorKind, vendor: Vendor | null): VendorFormValues {
  const base: VendorFormValues = {
    zoneId: '',
    name: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    area: '',
    lat: '',
    lng: '',
    cuisineTags: '',
    commissionPct: '',
    specialityTags: '',
    foodCategory: '',
    experienceYears: '',
    isAvailable: 'yes',
    dailyCapacity: '',
  };
  if (!vendor) return base;

  return {
    ...base,
    zoneId: vendor.zoneId,
    name: vendor.name,
    phone: vendor.phone,
    email: vendor.email ?? '',
    address: vendor.address,
    area: vendor.area ?? '',
    lat: vendor.lat === null ? '' : String(vendor.lat),
    lng: vendor.lng === null ? '' : String(vendor.lng),
    commissionPct: vendor.commissionPct === null ? '' : String(vendor.commissionPct),
    ...(kind === 'restaurant' && vendor.kind === 'restaurant'
      ? { ownerName: vendor.ownerName, cuisineTags: vendor.cuisineTags.join(', ') }
      : {}),
    ...(kind === 'homemaker' && vendor.kind === 'homemaker'
      ? {
          specialityTags: vendor.specialityTags.join(', '),
          foodCategory: vendor.foodCategory ?? '',
          experienceYears: vendor.experienceYears === null ? '' : String(vendor.experienceYears),
          isAvailable: vendor.isAvailable ? 'yes' : 'no',
          dailyCapacity: vendor.dailyCapacity === null ? '' : String(vendor.dailyCapacity),
        }
      : {}),
  };
}

function toPayload(
  kind: VendorKind,
  values: VendorFormValues,
): RestaurantCreateInput | HomemakerCreateInput {
  if (kind === 'restaurant') {
    return restaurantFormToPayload({
      zoneId: values.zoneId,
      name: values.name,
      ownerName: values.ownerName,
      phone: values.phone,
      email: values.email,
      address: values.address,
      area: values.area,
      lat: values.lat,
      lng: values.lng,
      cuisineTags: values.cuisineTags,
      commissionPct: values.commissionPct,
    });
  }
  return homemakerFormToPayload({
    zoneId: values.zoneId,
    name: values.name,
    phone: values.phone,
    email: values.email,
    address: values.address,
    area: values.area,
    lat: values.lat,
    lng: values.lng,
    specialityTags: values.specialityTags,
    foodCategory: values.foodCategory,
    experienceYears: values.experienceYears,
    isAvailable: values.isAvailable,
    dailyCapacity: values.dailyCapacity,
    commissionPct: values.commissionPct,
  });
}

function toUpdate(
  kind: VendorKind,
  original: Vendor,
  values: VendorFormValues,
): RestaurantUpdateInput | HomemakerUpdateInput {
  const pct = values.commissionPct === '' ? null : Number(values.commissionPct);
  // Skip the field when unchanged so a non-Super-Admin editor (SA-1.7 seam)
  // never trips the server-side commission guard (doc 04 §3).
  const includePct = original.commissionPct !== pct;
  const email = values.email === '' ? null : values.email;
  const area = values.area === '' ? null : values.area;
  const lat = values.lat === '' ? null : Number(values.lat);
  const lng = values.lng === '' ? null : Number(values.lng);

  if (kind === 'restaurant') {
    const update: RestaurantUpdateInput = {
      name: values.name,
      ownerName: values.ownerName,
      phone: values.phone,
      address: values.address,
      email,
      area,
      lat,
      lng,
      cuisineTags: splitTags(values.cuisineTags),
      ...(includePct ? { commissionPct: pct } : {}),
    };
    return update;
  }

  const update: HomemakerUpdateInput = {
    name: values.name,
    phone: values.phone,
    address: values.address,
    email,
    area,
    lat,
    lng,
    specialityTags: values.specialityTags === '' ? null : splitTags(values.specialityTags),
    foodCategory: values.foodCategory === '' ? null : values.foodCategory,
    experienceYears: values.experienceYears === '' ? null : Number(values.experienceYears),
    isAvailable: values.isAvailable === 'yes',
    dailyCapacity: values.dailyCapacity === '' ? null : Number(values.dailyCapacity),
    ...(includePct ? { commissionPct: pct } : {}),
  };
  return update;
}

export function VendorFormDialog({
  kind,
  vendor,
  zones,
  onClose,
}: {
  kind: VendorKind;
  vendor: Vendor | null;
  zones: ZoneOption[];
  onClose: () => void;
}) {
  const editing = vendor !== null;
  const create = useCreateVendor(kind);
  const update = useUpdateVendor(kind);
  const schema = kind === 'restaurant' ? restaurantFormSchema : homemakerFormSchema;

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VendorFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<VendorFormValues>,
    defaultValues: defaultsFor(kind, vendor),
  });

  const pending = isSubmitting || create.isPending || update.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success(kind === 'restaurant' ? 'Restaurant created' : 'Homemaker created');
      onClose();
    }
  }, [create.isSuccess, kind, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Saved');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  async function onSubmit(values: VendorFormValues) {
    try {
      if (vendor) {
        await update.mutateAsync({ id: vendor.id, input: toUpdate(kind, vendor, values) });
      } else {
        await create.mutateAsync(toPayload(kind, values));
      }
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  const isRestaurant = kind === 'restaurant';
  const noun = isRestaurant ? 'restaurant' : 'homemaker';

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the details. Zone changes use Move to zone in Details.'
              : `Create a new ${noun} in the chosen zone (starts as Pending).`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vendor-zone">
              Zone <span className="text-danger">*</span>
            </Label>
            <Controller
              control={control}
              name="zoneId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
                  <SelectTrigger id="vendor-zone">
                    <SelectValue placeholder="Choose a zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((zone) => (
                      <SelectItem key={zone.id} value={zone.id}>
                        {zone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.zoneId && <p className="text-xs text-danger">{errors.zoneId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input id="vendor-name" placeholder="Annapoorna Mess" {...register('name')} />
              {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
            </div>
            {isRestaurant ? (
              <div className="space-y-1.5">
                <Label htmlFor="vendor-owner">
                  Owner <span className="text-danger">*</span>
                </Label>
                <Input id="vendor-owner" placeholder="Ravi Kumar" {...register('ownerName')} />
                {errors.ownerName && (
                  <p className="text-xs text-danger">{errors.ownerName.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="vendor-capacity">Daily capacity</Label>
                <Input
                  id="vendor-capacity"
                  inputMode="numeric"
                  placeholder="20"
                  {...register('dailyCapacity')}
                />
                {errors.dailyCapacity && (
                  <p className="text-xs text-danger">{errors.dailyCapacity.message}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-phone">
                Phone <span className="text-danger">*</span>
              </Label>
              <Input id="vendor-phone" placeholder="9876543210" {...register('phone')} />
              {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-email">Email</Label>
              <Input
                id="vendor-email"
                type="email"
                placeholder="owner@example.com"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vendor-address">
              Address <span className="text-danger">*</span>
            </Label>
            <Input
              id="vendor-address"
              placeholder="12 Anna Salai, Chennai"
              {...register('address')}
            />
            {errors.address && <p className="text-xs text-danger">{errors.address.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-area">Area</Label>
              <Input id="vendor-area" placeholder="T. Nagar" {...register('area')} />
              {errors.area && <p className="text-xs text-danger">{errors.area.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-commission">Commission %</Label>
              <Input
                id="vendor-commission"
                inputMode="decimal"
                placeholder="15"
                {...register('commissionPct')}
              />
              <p className="text-xs text-muted">0–50%. Super Admin only (doc 04).</p>
              {errors.commissionPct && (
                <p className="text-xs text-danger">{errors.commissionPct.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-lat">Latitude</Label>
              <Input id="vendor-lat" placeholder="13.0418" {...register('lat')} />
              {errors.lat && <p className="text-xs text-danger">{errors.lat.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-lng">Longitude</Label>
              <Input id="vendor-lng" placeholder="80.2341" {...register('lng')} />
              {errors.lng && <p className="text-xs text-danger">{errors.lng.message}</p>}
            </div>
          </div>

          {isRestaurant ? (
            <div className="space-y-1.5">
              <Label htmlFor="vendor-cuisines">
                Cuisines <span className="text-danger">*</span>
              </Label>
              <Input
                id="vendor-cuisines"
                placeholder="North Indian, Chinese"
                {...register('cuisineTags')}
              />
              <p className="text-xs text-muted">Comma-separated, up to 5.</p>
              {errors.cuisineTags && (
                <p className="text-xs text-danger">{errors.cuisineTags.message}</p>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="vendor-speciality">Specialities</Label>
                <Input
                  id="vendor-speciality"
                  placeholder="Biryani, Home-style lunch"
                  {...register('specialityTags')}
                />
                <p className="text-xs text-muted">Comma-separated, up to 5.</p>
                {errors.specialityTags && (
                  <p className="text-xs text-danger">{errors.specialityTags.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vendor-category">Food category</Label>
                  <Input
                    id="vendor-category"
                    placeholder="Veg / Non-Veg"
                    {...register('foodCategory')}
                  />
                  {errors.foodCategory && (
                    <p className="text-xs text-danger">{errors.foodCategory.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vendor-experience">Experience (years)</Label>
                  <Input
                    id="vendor-experience"
                    inputMode="numeric"
                    placeholder="5"
                    {...register('experienceYears')}
                  />
                  {errors.experienceYears && (
                    <p className="text-xs text-danger">{errors.experienceYears.message}</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vendor-available">Available for orders</Label>
                <Controller
                  control={control}
                  name="isAvailable"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="vendor-available">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.isAvailable && (
                  <p className="text-xs text-danger">{errors.isAvailable.message}</p>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'Save changes' : `Create ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
