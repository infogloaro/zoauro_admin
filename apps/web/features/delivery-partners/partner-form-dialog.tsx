'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
  DELIVERY_PARTNER_STATUSES,
  deliveryPartnerEditFormSchema,
  deliveryPartnerEditFormToUpdate,
  deliveryPartnerFormSchema,
  deliveryPartnerFormToPayload,
  type DeliveryPartner,
  type DeliveryPartnerFormValues,
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
import { useCreateDeliveryPartner, useUpdateDeliveryPartner } from './api';
import type { ZoneOption } from './partner-filters';

/**
 * Add/Edit overlay for M10 (doc 20 Add/Edit, doc 22 Delivery partner form
 * row). The form row's `documents` input is dropped: doc 09 documents no
 * partner document endpoints (handoff gap), so documents can only arrive with
 * partner self-registration (intake, doc 42). Editing follows intake
 * `PartnerPatch` — name, vehicle, area; phone/zone stay fixed (one writer per
 * field, doc 44).
 */
const STATUS_LABELS: Record<string, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  VERIFIED: 'Verified',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

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

function defaultsFor(partner: DeliveryPartner | null): DeliveryPartnerFormValues {
  const base: DeliveryPartnerFormValues = {
    zoneId: '',
    name: '',
    phone: '',
    vehicleType: '',
    vehicleNo: '',
    area: '',
    status: 'PENDING_VERIFICATION',
  };
  if (!partner) return base;
  return {
    ...base,
    name: partner.name,
    // The list hands us the masked phone; edits never send it (D26).
    phone: '',
    vehicleType: partner.vehicleType,
    vehicleNo: partner.vehicleNo ?? '',
    area: partner.area ?? '',
    status: partner.status,
  };
}

export function PartnerFormDialog({
  partner,
  zones,
  vehicleTypeSuggestions = [],
  areaSuggestions = [],
  onClose,
}: {
  partner: DeliveryPartner | null;
  zones: ZoneOption[];
  /** Vehicle types stored on partners (list facets, doc 20). */
  vehicleTypeSuggestions?: string[];
  /** Real areas stored on partners (list facets, doc 20). */
  areaSuggestions?: string[];
  onClose: () => void;
}) {
  const editing = partner !== null;
  const create = useCreateDeliveryPartner();
  const update = useUpdateDeliveryPartner();
  const schema = editing ? deliveryPartnerEditFormSchema : deliveryPartnerFormSchema;

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DeliveryPartnerFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<DeliveryPartnerFormValues>,
    defaultValues: defaultsFor(partner),
  });

  const pending = isSubmitting || create.isPending || update.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Delivery partner created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Saved');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  async function onSubmit(values: DeliveryPartnerFormValues) {
    try {
      if (partner) {
        await update.mutateAsync({
          id: partner.id,
          input: deliveryPartnerEditFormToUpdate(values),
        });
      } else {
        await create.mutateAsync(deliveryPartnerFormToPayload(values));
      }
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit delivery partner' : 'Add delivery partner'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the profile fields. Phone and zone stay fixed after creation.'
              : 'Create a delivery partner in the chosen zone (starts as Pending verification).'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="partner-zone">
                Zone <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="zoneId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="partner-zone">
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
          )}

          <div className="space-y-1.5">
            <Label htmlFor="partner-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input id="partner-name" placeholder="Karthik Raja" {...register('name')} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>

          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="partner-phone">
                Phone <span className="text-danger">*</span>
              </Label>
              <Input id="partner-phone" placeholder="9876543210" {...register('phone')} />
              {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="partner-vehicle-type">
                Vehicle type <span className="text-danger">*</span>
              </Label>
              <Input
                id="partner-vehicle-type"
                list="partner-vehicle-type-options"
                placeholder="BIKE / SCOOTER / VAN"
                autoComplete="off"
                {...register('vehicleType')}
              />
              <datalist id="partner-vehicle-type-options">
                {vehicleTypeSuggestions.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
              {errors.vehicleType && (
                <p className="text-xs text-danger">{errors.vehicleType.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-vehicle-no">
                Vehicle number <span className="text-danger">*</span>
              </Label>
              <Input
                id="partner-vehicle-no"
                placeholder="TN 09 AB 1234"
                {...register('vehicleNo')}
              />
              {errors.vehicleNo && (
                <p className="text-xs text-danger">{errors.vehicleNo.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="partner-area">Area</Label>
            <Input
              id="partner-area"
              list="partner-area-options"
              placeholder="Start typing or pick a stored area"
              autoComplete="off"
              {...register('area')}
            />
            <datalist id="partner-area-options">
              {areaSuggestions.map((area) => (
                <option key={area} value={area} />
              ))}
            </datalist>
            {errors.area && <p className="text-xs text-danger">{errors.area.message}</p>}
          </div>

          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="partner-status">Status</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="partner-status">
                      <SelectValue placeholder="Choose a status" />
                    </SelectTrigger>
                    <SelectContent>
                      {DELIVERY_PARTNER_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABELS[status] ?? status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.status && <p className="text-xs text-danger">{errors.status.message}</p>}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {editing ? 'Save changes' : 'Create delivery partner'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
