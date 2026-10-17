'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import {
  useForm,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import { toast } from 'sonner';
import { bookingFormSchema, bookingFormToPayload, type BookingFormValues } from '@zoauro/shared';
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
import { ApiError } from '../../lib/api';
import { useCreateBooking } from './api';

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
 * Add booking dialog (reference "Add Booking" overlay). Dates are date-only
 * `YYYY-MM-DD` and stored as UTC midnights; the double-booking overlap
 * check runs server-side and surfaces as a 409 conflict toast.
 */
export function BookingFormDialog({
  hotelId,
  hotelName,
  onClose,
}: {
  hotelId: string;
  hotelName: string;
  onClose: () => void;
}) {
  const create = useCreateBooking();

  const defaults: BookingFormValues = {
    customerName: '',
    customerPhone: '',
    roomType: '',
    checkIn: '',
    checkOut: '',
    guests: '1',
    amount: '',
    note: '',
  };

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema) as unknown as Resolver<BookingFormValues>,
    defaultValues: defaults,
  });

  const pending = isSubmitting || create.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Booking created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  async function onSubmit(values: BookingFormValues) {
    try {
      await create.mutateAsync({ hotelId, input: bookingFormToPayload(values) });
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add booking — {hotelName}</DialogTitle>
          <DialogDescription>
            Create a room booking. Double-booking is prevented server-side.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="booking-name">
                Customer <span className="text-danger">*</span>
              </Label>
              <Input id="booking-name" placeholder="Lakshmi Iyer" {...register('customerName')} />
              {errors.customerName && (
                <p className="text-xs text-danger">{errors.customerName.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-phone">
                Phone <span className="text-danger">*</span>
              </Label>
              <Input id="booking-phone" placeholder="9876543210" {...register('customerPhone')} />
              {errors.customerPhone && (
                <p className="text-xs text-danger">{errors.customerPhone.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="booking-room">
              Room type <span className="text-danger">*</span>
            </Label>
            <Input id="booking-room" placeholder="Deluxe" {...register('roomType')} />
            {errors.roomType && <p className="text-xs text-danger">{errors.roomType.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="booking-checkin">
                Check-in <span className="text-danger">*</span>
              </Label>
              <Input id="booking-checkin" type="date" {...register('checkIn')} />
              {errors.checkIn && <p className="text-xs text-danger">{errors.checkIn.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-checkout">
                Check-out <span className="text-danger">*</span>
              </Label>
              <Input id="booking-checkout" type="date" {...register('checkOut')} />
              {errors.checkOut && <p className="text-xs text-danger">{errors.checkOut.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="booking-guests">
                Guests <span className="text-danger">*</span>
              </Label>
              <Input
                id="booking-guests"
                inputMode="numeric"
                placeholder="2"
                {...register('guests')}
              />
              {errors.guests && <p className="text-xs text-danger">{errors.guests.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-amount">
                Amount (₹) <span className="text-danger">*</span>
              </Label>
              <Input
                id="booking-amount"
                inputMode="numeric"
                placeholder="8400"
                {...register('amount')}
              />
              {errors.amount && <p className="text-xs text-danger">{errors.amount.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="booking-note">Note</Label>
            <Input id="booking-note" placeholder="Special request" {...register('note')} />
            {errors.note && <p className="text-xs text-danger">{errors.note.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Create booking
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
