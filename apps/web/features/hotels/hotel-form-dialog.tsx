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
  hotelFormSchema,
  hotelFormToPayload,
  hotelFormToUpdate,
  type Hotel,
  type HotelFormValues,
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
import { useCreateHotel, useUpdateHotel } from './api';

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

/**
 * Add/Edit dialog for a hotel (reference "Add Hotel" overlay). `zoneId` is
 * create-only — moving a hotel uses the zone action in Details. Commission
 * is Super Admin only (doc 04 §3); the field is skipped on update when
 * unchanged so a non-Super-Admin editor never trips the server guard.
 */
export function HotelFormDialog({
  hotel,
  zones,
  onClose,
}: {
  hotel: Hotel | null;
  zones: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const editing = hotel !== null;
  const create = useCreateHotel();
  const update = useUpdateHotel();

  const defaults: HotelFormValues = {
    zoneId: hotel?.zoneId ?? '',
    name: hotel?.name ?? '',
    ownerName: hotel?.ownerName ?? '',
    phone: hotel?.phone ?? '',
    email: hotel?.email ?? '',
    address: hotel?.address ?? '',
    area: hotel?.area ?? '',
    totalRooms: hotel ? String(hotel.totalRooms) : '',
    commissionPct: hotel?.commissionPct === null ? '' : hotel ? String(hotel.commissionPct) : '',
    gstNo: hotel?.gstNo ?? '',
  };

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<HotelFormValues>({
    resolver: zodResolver(hotelFormSchema) as unknown as Resolver<HotelFormValues>,
    defaultValues: defaults,
  });

  const pending = isSubmitting || create.isPending || update.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Hotel created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Saved');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  async function onSubmit(values: HotelFormValues) {
    try {
      if (hotel) {
        const pct = values.commissionPct === '' ? null : Number(values.commissionPct);
        const includePct = hotel.commissionPct !== pct;
        await update.mutateAsync({
          id: hotel.id,
          input: {
            ...hotelFormToUpdate(values),
            ...(includePct ? { commissionPct: pct } : {}),
          },
        });
      } else {
        await create.mutateAsync(hotelFormToPayload(values));
      }
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit hotel' : 'Add hotel'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the details. Zone changes use Move to zone in Details.'
              : 'Create a new hotel in the chosen zone (starts as Pending).'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hotel-zone">
              Zone <span className="text-danger">*</span>
            </Label>
            <Controller
              control={control}
              name="zoneId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
                  <SelectTrigger id="hotel-zone">
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
              <Label htmlFor="hotel-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input id="hotel-name" placeholder="Grand Palace Inn" {...register('name')} />
              {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hotel-owner">
                Owner <span className="text-danger">*</span>
              </Label>
              <Input id="hotel-owner" placeholder="Ravi Kumar" {...register('ownerName')} />
              {errors.ownerName && (
                <p className="text-xs text-danger">{errors.ownerName.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hotel-phone">
                Phone <span className="text-danger">*</span>
              </Label>
              <Input id="hotel-phone" placeholder="9876543210" {...register('phone')} />
              {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hotel-email">Email</Label>
              <Input
                id="hotel-email"
                type="email"
                placeholder="owner@example.com"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hotel-address">
              Address <span className="text-danger">*</span>
            </Label>
            <Input
              id="hotel-address"
              placeholder="12 Anna Salai, Chennai"
              {...register('address')}
            />
            {errors.address && <p className="text-xs text-danger">{errors.address.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hotel-area">Area</Label>
              <Input id="hotel-area" placeholder="T. Nagar" {...register('area')} />
              {errors.area && <p className="text-xs text-danger">{errors.area.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hotel-rooms">
                Total rooms <span className="text-danger">*</span>
              </Label>
              <Input
                id="hotel-rooms"
                inputMode="numeric"
                placeholder="24"
                {...register('totalRooms')}
              />
              {errors.totalRooms && (
                <p className="text-xs text-danger">{errors.totalRooms.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hotel-commission">Commission %</Label>
              <Input
                id="hotel-commission"
                inputMode="decimal"
                placeholder="15"
                {...register('commissionPct')}
              />
              <p className="text-xs text-muted">0–50%. Super Admin only (doc 04).</p>
              {errors.commissionPct && (
                <p className="text-xs text-danger">{errors.commissionPct.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hotel-gst">GST No.</Label>
              <Input id="hotel-gst" placeholder="33AAAAA0000A1Z5" {...register('gstNo')} />
              {errors.gstNo && <p className="text-xs text-danger">{errors.gstNo.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create hotel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
