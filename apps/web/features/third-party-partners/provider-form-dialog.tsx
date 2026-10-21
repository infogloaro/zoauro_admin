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
  INTEGRATION_STATUSES,
  THIRD_PARTY_PROVIDER_STATUSES,
  thirdPartyProviderEditFormSchema,
  thirdPartyProviderEditFormToUpdate,
  thirdPartyProviderFormSchema,
  thirdPartyProviderFormToPayload,
  type ThirdPartyProvider,
  type ThirdPartyProviderFormValues,
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
import { cn } from '../../lib/cn';
import { ApiError } from '../../lib/api';
import { useCreateThirdPartyProvider, useUpdateThirdPartyProvider } from './api';

/**
 * Add/Edit overlay for Third-Party Partners (task: Add/Edit provider form).
 *
 * Coverage is many-to-many, so the form uses a checkbox group per zone instead
 * of the single Select used by the own-partner (M10) form. At least one zone is
 * required (doc 36). A deactivated zone stays selectable: coverage describes
 * where a company operates, not a live duty roster, so an inactive zone can
 * keep appearing on an existing company's coverage.
 *
 * The list hands back masked contact values (D26), so the edit form leaves
 * contact fields blank rather than prefiling placeholders — the same gap M10
 * logged (handoff: no reveal endpoint exists).
 */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

const INTEGRATION_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'Not configured',
  CONFIGURED: 'Configured',
};

export interface ZoneOption {
  id: string;
  name: string;
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

function defaultsFor(provider: ThirdPartyProvider | null): ThirdPartyProviderFormValues {
  const base: ThirdPartyProviderFormValues = {
    name: '',
    providerType: '',
    contactPerson: '',
    contactEmail: '',
    contactPhone: '',
    zoneIds: [],
    status: 'ACTIVE',
    integrationStatus: 'NOT_CONFIGURED',
  };
  if (!provider) return base;
  return {
    ...base,
    name: provider.name,
    providerType: provider.providerType,
    contactPerson: provider.contactPerson,
    // Masked in the list (D26) — blank on edit so the masked form is never saved.
    contactEmail: '',
    contactPhone: '',
    zoneIds: provider.zones.map((zone) => zone.id),
    integrationStatus: provider.integrationStatus,
  };
}

export function ProviderFormDialog({
  provider,
  zones,
  onClose,
}: {
  provider: ThirdPartyProvider | null;
  zones: ZoneOption[];
  onClose: () => void;
}) {
  const editing = provider !== null;
  const create = useCreateThirdPartyProvider();
  const update = useUpdateThirdPartyProvider();
  const schema = editing ? thirdPartyProviderEditFormSchema : thirdPartyProviderFormSchema;

  const {
    register,
    handleSubmit,
    control,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ThirdPartyProviderFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ThirdPartyProviderFormValues>,
    defaultValues: defaultsFor(provider),
  });

  const watchedZoneIds = watch('zoneIds');
  const pending = isSubmitting || create.isPending || update.isPending;

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Third-party provider created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Saved');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  function toggleZone(zoneId: string) {
    const next = watchedZoneIds.includes(zoneId)
      ? watchedZoneIds.filter((id) => id !== zoneId)
      : [...watchedZoneIds, zoneId];
    setValue('zoneIds', next, { shouldValidate: true });
  }

  async function onSubmit(values: ThirdPartyProviderFormValues) {
    try {
      if (provider) {
        await update.mutateAsync({
          id: provider.id,
          input: thirdPartyProviderEditFormToUpdate(values),
        });
      } else {
        await create.mutateAsync(thirdPartyProviderFormToPayload(values));
      }
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit provider' : 'Add third-party provider'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the company profile and its service coverage. Contact details are masked in lists, so they are left blank here — retype to change them.'
              : 'Register an external delivery company and the zones it covers. Coverage is a list, not a single zone.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">
              Company name <span className="text-danger">*</span>
            </Label>
            <Input id="provider-name" placeholder="Swift Logistics" {...register('name')} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-type">
              Provider type <span className="text-danger">*</span>
            </Label>
            <Input
              id="provider-type"
              placeholder="API / Webhook / Manual"
              autoComplete="off"
              {...register('providerType')}
            />
            {errors.providerType && (
              <p className="text-xs text-danger">{errors.providerType.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-contact-person">
              Contact person <span className="text-danger">*</span>
            </Label>
            <Input
              id="provider-contact-person"
              placeholder="Ops lead name"
              {...register('contactPerson')}
            />
            {errors.contactPerson && (
              <p className="text-xs text-danger">{errors.contactPerson.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider-contact-email">
                Contact email <span className="text-danger">*</span>
              </Label>
              <Input
                id="provider-contact-email"
                type="email"
                placeholder={editing ? 'Retype to change' : 'ops@company.example'}
                autoComplete="off"
                {...register('contactEmail')}
              />
              {errors.contactEmail && (
                <p className="text-xs text-danger">{errors.contactEmail.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-contact-phone">
                Contact phone <span className="text-danger">*</span>
              </Label>
              <Input
                id="provider-contact-phone"
                placeholder={editing ? 'Retype to change' : '+91 98765 43210'}
                autoComplete="off"
                {...register('contactPhone')}
              />
              {errors.contactPhone && (
                <p className="text-xs text-danger">{errors.contactPhone.message}</p>
              )}
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-text">
              Service zones <span className="text-danger">*</span>
            </legend>
            <p className="text-xs text-muted">
              Tick every zone this company covers. At least one is required.
            </p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {zones.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted">No zones available.</p>
              ) : (
                zones.map((zone) => (
                  <label
                    key={zone.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                      'hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[#FF5A1F]"
                      checked={watchedZoneIds.includes(zone.id)}
                      onChange={() => toggleZone(zone.id)}
                    />
                    <span>{zone.name}</span>
                  </label>
                ))
              )}
            </div>
            {errors.zoneIds && <p className="text-xs text-danger">{errors.zoneIds.message}</p>}
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="provider-status">Status</Label>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="provider-status">
                        <SelectValue placeholder="Choose a status" />
                      </SelectTrigger>
                      <SelectContent>
                        {THIRD_PARTY_PROVIDER_STATUSES.map((status) => (
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

            <div className="space-y-1.5">
              <Label htmlFor="provider-integration">Integration status</Label>
              <Controller
                control={control}
                name="integrationStatus"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="provider-integration">
                      <SelectValue placeholder="Choose a status" />
                    </SelectTrigger>
                    <SelectContent>
                      {INTEGRATION_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {INTEGRATION_LABELS[status] ?? status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted">
                A configuration flag only. Configured does not mean a live connection.
              </p>
              {errors.integrationStatus && (
                <p className="text-xs text-danger">{errors.integrationStatus.message}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {editing ? 'Save changes' : 'Create provider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
