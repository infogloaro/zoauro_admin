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
  CUSTOMER_STATUSES,
  customerEditFormSchema,
  customerEditFormToUpdate,
  customerFormSchema,
  customerFormToPayload,
  type Customer,
  type CustomerStatus,
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
import { useCreateCustomer, useUpdateCustomer } from './api';
import type { ZoneOption } from './customers-filters';

/**
 * Add/Edit overlay for M09 (doc 20 Add/Edit, doc 22 Customer form row). The
 * first address is create-only: doc 09 has no admin endpoint for customer
 * addresses, so editing covers the profile fields (name, email, status) and
 * phone stays stable per D26 (reveal, not edit).
 */
interface CustomerFormValues {
  name: string;
  phone: string;
  email: string;
  zoneId: string;
  address: string;
  area: string;
  status: CustomerStatus;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  BLOCKED: 'Blocked',
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

function defaultsFor(customer: Customer | null): CustomerFormValues {
  const base: CustomerFormValues = {
    name: '',
    phone: '',
    email: '',
    zoneId: '',
    address: '',
    area: '',
    status: 'ACTIVE',
  };
  if (!customer) return base;
  return {
    ...base,
    name: customer.name,
    // The list hands us the masked phone; edits do not touch it (D26).
    phone: '',
    email: customer.email ?? '',
    status: customer.status,
  };
}

export function CustomerFormDialog({
  customer,
  zones,
  areaSuggestions = [],
  onClose,
}: {
  customer: Customer | null;
  zones: ZoneOption[];
  /** Real areas stored on customer addresses (list facets, doc 20). */
  areaSuggestions?: string[];
  onClose: () => void;
}) {
  const editing = customer !== null;
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const schema = editing ? customerEditFormSchema : customerFormSchema;

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<CustomerFormValues>,
    defaultValues: defaultsFor(customer),
  });

  const pending = isSubmitting || create.isPending || update.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Customer created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Saved');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  async function onSubmit(values: CustomerFormValues) {
    try {
      if (customer) {
        await update.mutateAsync({
          id: customer.id,
          input: customerEditFormToUpdate(values),
        });
      } else {
        await create.mutateAsync(customerFormToPayload(values));
      }
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit customer' : 'Add customer'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the profile fields. The first address is fixed after creation.'
              : 'Create a customer with their first address. Registered as an admin-created customer.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="customer-zone">
                Zone <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="zoneId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="customer-zone">
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
            <Label htmlFor="customer-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input id="customer-name" placeholder="Aarti Menon" {...register('name')} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>

          {!editing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">
                  Phone <span className="text-danger">*</span>
                </Label>
                <Input id="customer-phone" placeholder="9876543210" {...register('phone')} />
                {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-email">Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  placeholder="customer@example.com"
                  {...register('email')}
                />
                {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
              </div>
            </div>
          )}

          {editing && (
            <div className="space-y-1.5">
              <Label htmlFor="customer-email">Email</Label>
              <Input
                id="customer-email"
                type="email"
                placeholder="customer@example.com"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
          )}

          {!editing && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="customer-address">
                  Address <span className="text-danger">*</span>
                </Label>
                <Input
                  id="customer-address"
                  placeholder="14 Kamaraj Salai, Adyar"
                  {...register('address')}
                />
                {errors.address && <p className="text-xs text-danger">{errors.address.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="customer-area">Area</Label>
                <Input
                  id="customer-area"
                  list="customer-area-options"
                  placeholder="Start typing or pick a stored area"
                  autoComplete="off"
                  {...register('area')}
                />
                <datalist id="customer-area-options">
                  {areaSuggestions.map((area) => (
                    <option key={area} value={area} />
                  ))}
                </datalist>
                {errors.area && <p className="text-xs text-danger">{errors.area.message}</p>}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="customer-status">Status</Label>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="customer-status">
                    <SelectValue placeholder="Choose a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_STATUSES.map((status) => (
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {editing ? 'Save changes' : 'Create customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
