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
  DIETARY_LABELS,
  DIETARY_TYPES,
  MENU_OWNER_KINDS,
  menuItemFormSchema,
  menuItemFormToPayload,
  menuItemFormToUpdate,
  type MenuItem,
  type MenuItemFormValues,
  type MenuOwnerKind,
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
import { useCreateMenuItem, useUpdateMenuItem } from './api';

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

const OWNER_KIND_LABELS: Record<MenuOwnerKind, string> = {
  restaurant: 'Restaurant',
  homemaker: 'Home food',
  hotel: 'Hotel',
};

/**
 * Add/Edit dialog for a menu item. Owner and zone are immutable (an item
 * belongs to exactly one provider in one zone), and approval status only
 * moves through the review endpoint. `menu_items` has no image column
 * (doc 08 reshape), so no image field is offered here.
 */
export function MenuItemFormDialog({
  item,
  providers,
  providerErrors,
  onClose,
}: {
  item: MenuItem | null;
  providers: Record<MenuOwnerKind, Array<{ id: string; name: string; zoneId?: string }>>;
  providerErrors?: Partial<Record<MenuOwnerKind, boolean>>;
  onClose: () => void;
}) {
  const editing = item !== null;
  const create = useCreateMenuItem();
  const update = useUpdateMenuItem();

  const defaults: MenuItemFormValues = {
    vendorType: item?.vendorType ?? 'restaurant',
    vendorId: item?.vendorId ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    category: item?.category ?? '',
    price: item ? String(Math.round(item.price / 100)) : '',
    stock: item?.stock != null ? String(item.stock) : '',
    isAvailable: item?.isAvailable ?? true,
    isFeatured: item?.isFeatured ?? false,
    dietary: item?.dietary ?? 'VEGETARIAN',
  };

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MenuItemFormValues>({
    resolver: zodResolver(menuItemFormSchema) as unknown as Resolver<MenuItemFormValues>,
    defaultValues: defaults,
  });

  const vendorType = watch('vendorType');
  const pending = isSubmitting || create.isPending || update.isPending;
  const providerOptions = providers?.[vendorType] ?? [];
  const providerLoadFailed = providerErrors?.[vendorType] === true;

  useEffect(() => {
    // If provider type changes, clear a selection belonging to the previous type.
    if (!editing) {
      setValue('vendorId', '', { shouldDirty: true, shouldValidate: true });
    }
  }, [vendorType, editing, setValue]);

  useEffect(() => {
    if (create.isSuccess) {
      toast.success('Menu item created');
      onClose();
    }
  }, [create.isSuccess, onClose]);

  useEffect(() => {
    if (update.isSuccess) {
      toast.success('Saved');
      onClose();
    }
  }, [update.isSuccess, onClose]);

  async function onSubmit(values: MenuItemFormValues) {
    try {
      if (item) {
        await update.mutateAsync({ id: item.id, input: menuItemFormToUpdate(values) });
      } else {
        const provider = providerOptions.find((p) => p.id === values.vendorId);
        if (!provider) {
          setError('vendorId', {
            message: providerOptions.length
              ? 'Choose a provider from the list.'
              : 'No providers are available for this provider type.',
          });
          return;
        }

        if (!provider.zoneId) {
          setError('vendorId', { message: 'This provider has no zone assigned.' });
          return;
        }

        await create.mutateAsync(menuItemFormToPayload(values, provider.zoneId));
      }
    } catch (error) {
      applyApiError(error, setError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit menu item' : 'Add menu item'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the details. The owner and zone are fixed; approval status is unchanged by edits.'
              : 'Create a new menu item. It enters as Pending and moves through the approval workflow.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="item-owner-kind">
                Provider type <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="vendorType"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={editing || pending}
                  >
                    <SelectTrigger id="item-owner-kind">
                      <SelectValue placeholder="Choose provider type" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[100]">
                      {MENU_OWNER_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {OWNER_KIND_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.vendorType && (
                <p className="text-xs text-danger">{errors.vendorType.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="item-provider">
                Provider <span className="text-danger">*</span>
              </Label>
              <Controller
                control={control}
                name="vendorId"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    disabled={editing || pending || providerOptions.length === 0}
                  >
                    <SelectTrigger id="item-provider" aria-describedby="item-provider-help">
                      <SelectValue
                        placeholder={
                          providerOptions.length ? 'Choose a provider' : 'No providers available'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[100]">
                      {editing && item && !providerOptions.some((p) => p.id === item.vendorId) && (
                        <SelectItem value={item.vendorId}>{item.vendorName}</SelectItem>
                      )}
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p id="item-provider-help" className="text-xs text-muted-foreground">
                {editing
                  ? 'Provider cannot be changed when editing an item.'
                  : providerLoadFailed
                    ? `Could not load ${OWNER_KIND_LABELS[vendorType].toLowerCase()} providers — the provider list request failed. Retry or check the API.`
                    : providerOptions.length
                      ? `${providerOptions.length} provider${providerOptions.length === 1 ? '' : 's'} available`
                      : `No ${OWNER_KIND_LABELS[vendorType].toLowerCase()} providers were loaded. Check the provider list/API.`}
              </p>
              {errors.vendorId && <p className="text-xs text-danger">{errors.vendorId.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input id="item-name" placeholder="Paneer Butter Masala" {...register('name')} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-description">Description</Label>
            <Input
              id="item-description"
              placeholder="Cottage cheese in a creamy tomato gravy"
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-danger">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="item-category">Category</Label>
              <Input id="item-category" placeholder="Main course" {...register('category')} />
              {errors.category && <p className="text-xs text-danger">{errors.category.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-price">
                Price (₹) <span className="text-danger">*</span>
              </Label>
              <Input id="item-price" inputMode="numeric" placeholder="260" {...register('price')} />
              {errors.price && <p className="text-xs text-danger">{errors.price.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-dietary">
              Dietary <span className="text-danger">*</span>
            </Label>
            <Controller
              control={control}
              name="dietary"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="item-dietary">
                    <SelectValue placeholder="Choose dietary type" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100]">
                    {DIETARY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {DIETARY_LABELS[type] ?? type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.dietary && <p className="text-xs text-danger">{errors.dietary.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
