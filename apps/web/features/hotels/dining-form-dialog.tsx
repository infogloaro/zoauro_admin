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
import { diningFormSchema, diningFormToPayload, type DiningFormValues } from '@zoauro/shared';
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
import { useCreateDining } from './api';

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
 * Add dining reservation dialog (reference "Add Dining" overlay). The venue
 * is either a hotel or a restaurant; both are validated against the same
 * zone server-side (the restaurant must be in the hotel's zone).
 */
export function DiningFormDialog({
  hotels,
  restaurants,
  onClose,
}: {
  hotels: Array<{ id: string; name: string }>;
  restaurants: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const create = useCreateDining();

  const defaults: DiningFormValues = {
    venueKind: 'hotel',
    venueId: '',
    customerName: '',
    customerPhone: '',
    reservedDate: '',
    reservedTime: '19:30',
    guests: '1',
    tableArea: '',
    amount: '',
    note: '',
  };

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DiningFormValues>({
    resolver: zodResolver(diningFormSchema) as unknown as Resolver<DiningFormValues>,
    defaultValues: defaults,
  });

  const venueKind = watch('venueKind');
  const pending = isSubmitting || create.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Dining reservation created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  async function onSubmit(values: DiningFormValues) {
    try {
      await create.mutateAsync(diningFormToPayload(values));
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  const venueOptions = venueKind === 'hotel' ? hotels : restaurants;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add dining reservation</DialogTitle>
          <DialogDescription>
            Reserve a table at a hotel or restaurant. The venue must be in the same zone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dining-venue-kind">
                Venue type <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="venueKind"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="dining-venue-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hotel">Hotel</SelectItem>
                      <SelectItem value="restaurant">Restaurant</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.venueKind && (
                <p className="text-xs text-danger">{errors.venueKind.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dining-venue">
                Venue <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="venueId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="dining-venue">
                      <SelectValue placeholder="Choose a venue" />
                    </SelectTrigger>
                    <SelectContent>
                      {venueOptions.map((venue) => (
                        <SelectItem key={venue.id} value={venue.id}>
                          {venue.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.venueId && <p className="text-xs text-danger">{errors.venueId.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dining-name">
                Customer <span className="text-danger">*</span>
              </Label>
              <Input id="dining-name" placeholder="Lakshmi Iyer" {...register('customerName')} />
              {errors.customerName && (
                <p className="text-xs text-danger">{errors.customerName.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dining-phone">
                Phone <span className="text-danger">*</span>
              </Label>
              <Input id="dining-phone" placeholder="9876543210" {...register('customerPhone')} />
              {errors.customerPhone && (
                <p className="text-xs text-danger">{errors.customerPhone.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dining-date">
                Date <span className="text-danger">*</span>
              </Label>
              <Input id="dining-date" type="date" {...register('reservedDate')} />
              {errors.reservedDate && (
                <p className="text-xs text-danger">{errors.reservedDate.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dining-time">
                Time <span className="text-danger">*</span>
              </Label>
              <Input id="dining-time" type="time" {...register('reservedTime')} />
              {errors.reservedTime && (
                <p className="text-xs text-danger">{errors.reservedTime.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dining-guests">
                Guests <span className="text-danger">*</span>
              </Label>
              <Input
                id="dining-guests"
                inputMode="numeric"
                placeholder="4"
                {...register('guests')}
              />
              {errors.guests && <p className="text-xs text-danger">{errors.guests.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dining-table">Table area</Label>
              <Input id="dining-table" placeholder="Terrace" {...register('tableArea')} />
              {errors.tableArea && (
                <p className="text-xs text-danger">{errors.tableArea.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dining-amount">Amount (₹)</Label>
              <Input
                id="dining-amount"
                inputMode="numeric"
                placeholder="4500"
                {...register('amount')}
              />
              {errors.amount && <p className="text-xs text-danger">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dining-note">Note</Label>
              <Input id="dining-note" placeholder="Window seat preferred" {...register('note')} />
              {errors.note && <p className="text-xs text-danger">{errors.note.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Create reservation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
