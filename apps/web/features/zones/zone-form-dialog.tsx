'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  ZONE_STATUSES,
  ZONE_DOT_PALETTE,
  zoneFormSchema,
  zoneFormToPayload,
  type Zone,
  type ZoneFormValues,
  type ZoneUpdateInput,
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
import { Input, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ApiError } from '../../lib/api';
import { MoneyInput } from './money-input';
import { useCreateZone, useUpdateZone } from './api';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  UPCOMING: 'Upcoming',
};

function editPayload(form: ZoneFormValues): Partial<ZoneUpdateInput> {
  const base = zoneFormToPayload(form);
  return {
    ...base,
    pincodeFrom: form.pincodeFrom === '' ? null : form.pincodeFrom,
    pincodeTo: form.pincodeTo === '' ? null : form.pincodeTo,
    description: form.description === '' ? null : form.description,
    colorHex: undefined, // colour is not a form field (doc 22); keep existing / let server pick
  };
}

function defaultsFor(zone: Zone | null): ZoneFormValues {
  return zone
    ? {
        name: zone.name,
        code: zone.code,
        city: zone.city,
        state: zone.state,
        pincodeFrom: zone.pincodeFrom ?? '',
        pincodeTo: zone.pincodeTo ?? '',
        deliveryCharge: zone.deliveryCharge,
        status: zone.status,
        description: zone.description ?? '',
        colorHex: zone.colorHex,
      }
    : {
        name: '',
        code: '',
        city: '',
        state: '',
        pincodeFrom: '',
        pincodeTo: '',
        deliveryCharge: 0,
        status: 'ACTIVE',
        description: '',
        colorHex: ZONE_DOT_PALETTE[0],
      };
}

/**
 * Add/Edit overlay (doc 20; Add/Edit frame absent from Figma — D47, built
 * from docs 20/22). Mount fresh per open (parent keys by zone id).
 */
export function ZoneFormDialog({ zone, onClose }: { zone: Zone | null; onClose: () => void }) {
  const create = useCreateZone();
  const update = useUpdateZone();
  const editing = zone !== null;

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneFormSchema),
    defaultValues: defaultsFor(zone),
  });

  const pending = isSubmitting || create.isPending || update.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Zone created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Zone updated');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  function applyApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      toast.error('Could not reach the server. Try again.');
      return;
    }
    const fields = error.fieldErrors();
    for (const [field, issue] of Object.entries(fields)) {
      setError(field as keyof ZoneFormValues, { message: issue });
    }
    if (Object.keys(fields).length === 0) {
      toast.error(error.message);
    }
  }

  async function onSubmit(values: ZoneFormValues) {
    try {
      if (editing) {
        await update.mutateAsync({ id: zone.id, input: editPayload(values) });
      } else {
        const { colorHex: _ignored, ...payload } = zoneFormToPayload(values);
        void _ignored;
        await create.mutateAsync(payload);
      }
    } catch (error) {
      applyApiError(error);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit zone' : 'Add zone'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update the zone details.' : 'Create a new service zone.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="zone-name">
              Zone Name <span className="text-danger">*</span>
            </Label>
            <Input id="zone-name" placeholder="Chennai" {...register('name')} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="zone-code">Code</Label>
              <Input
                id="zone-code"
                placeholder="MAA"
                className="uppercase"
                {...register('code', {
                  setValueAs: (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : v),
                })}
              />
              <p className="text-xs text-muted">2–10 A–Z/0–9. Auto-generated when blank.</p>
              {errors.code && <p className="text-xs text-danger">{errors.code.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-status">
                Status <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="zone-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ZONE_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.status && <p className="text-xs text-danger">{errors.status.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="zone-city">
                City <span className="text-danger">*</span>
              </Label>
              <Input id="zone-city" placeholder="Chennai" {...register('city')} />
              {errors.city && <p className="text-xs text-danger">{errors.city.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-state">
                State <span className="text-danger">*</span>
              </Label>
              <Input id="zone-state" placeholder="Tamil Nadu" {...register('state')} />
              {errors.state && <p className="text-xs text-danger">{errors.state.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="zone-pincode-from">Pincode from</Label>
              <Input
                id="zone-pincode-from"
                inputMode="numeric"
                maxLength={6}
                placeholder="600001"
                {...register('pincodeFrom')}
              />
              {errors.pincodeFrom && (
                <p className="text-xs text-danger">{errors.pincodeFrom.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-pincode-to">Pincode to</Label>
              <Input
                id="zone-pincode-to"
                inputMode="numeric"
                maxLength={6}
                placeholder="600119"
                {...register('pincodeTo')}
              />
              {errors.pincodeTo && (
                <p className="text-xs text-danger">{errors.pincodeTo.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zone-delivery-charge">
              Delivery Charge <span className="text-danger">*</span>
            </Label>
            <Controller
              control={control}
              name="deliveryCharge"
              render={({ field }) => (
                <MoneyInput
                  id="zone-delivery-charge"
                  value={field.value}
                  onValueChange={field.onChange}
                  onInvalid={() =>
                    setError('deliveryCharge', { message: 'Enter an amount like 49 or 49.50' })
                  }
                />
              )}
            />
            {errors.deliveryCharge && (
              <p className="text-xs text-danger">{errors.deliveryCharge.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zone-description">Description</Label>
            <Textarea
              id="zone-description"
              maxLength={500}
              placeholder="Optional notes about this zone"
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-danger">{errors.description.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create zone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
