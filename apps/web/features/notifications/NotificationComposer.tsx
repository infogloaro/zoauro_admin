'use client';

import { useQueries } from '@tanstack/react-query';
import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_BODY,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TITLE,
  createNotificationSchema,
  settingDef,
  updateNotificationSchema,
  type NotificationAudience,
  type NotificationChannel,
  type NotificationKind,
} from '@zoauro/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import type { ScopeZone } from '../../lib/zone-scope';
import { fieldErrors, isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateNotifications } from './api';
import {
  AUDIENCE_LABEL,
  CHANNEL_LABEL,
  KIND_LABEL,
  istTime,
  scheduleAt,
  sendPreview,
} from './labels';

// Compose or edit a notification (D94, D99, D100, D134–D137). A Zonal Admin picks one or more of their zones; a Super
// Admin may send to every zone. A Zonal Admin's promotion waits for Super Admin approval. Promotions outside a zone's
// window go out at its next opening: the preview shows each zone's send time (the Super Admin sees each zone's own
// window; a Zonal Admin sees the default window, as zone settings are Super Admin only). Edit sends only what changed.

const DEFAULT_WINDOW = settingDef('notifications.timing')?.default as {
  promotionalFrom: string;
  promotionalTo: string;
};

export interface ComposeTarget {
  id: string;
  version: number;
  kind: NotificationKind;
  audience: NotificationAudience;
  zones: { id: string }[];
  title: string;
  body: string;
  channels: NotificationChannel[];
}

export function NotificationComposer({
  role,
  zones,
  editing,
  onClose,
  onSaved,
}: {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  zones: ScopeZone[];
  editing?: ComposeTarget;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateNotifications();
  const { toast } = useToast();
  const [kind, setKind] = useState<NotificationKind>(editing?.kind ?? 'MESSAGE');
  const [audience, setAudience] = useState<NotificationAudience>(editing?.audience ?? 'CUSTOMERS');
  const [allZones, setAllZones] = useState(editing ? editing.zones.length === 0 : false);
  const [zoneIds, setZoneIds] = useState<string[]>(editing?.zones.map((z) => z.id) ?? []);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [channels, setChannels] = useState<NotificationChannel[]>(editing?.channels ?? ['IN_APP']);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const picked = allZones ? zones : zones.filter((z) => zoneIds.includes(z.id));
  const windows = useQueries({
    queries: picked.map((z) => ({
      queryKey: ['settings', 'platform', 'zone', z.id, 'notifications'],
      enabled: role === 'SUPER_ADMIN' && kind === 'PROMOTION',
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.get('/settings/{group}', {
          params: { group: 'notifications' },
          query: { zoneId: z.id },
          signal,
        }),
      staleTime: 60_000,
    })),
  });
  const windowOf: Record<string, { promotionalFrom: string; promotionalTo: string } | undefined> =
    {};
  picked.forEach((z, i) => {
    const t = windows[i]?.data?.data.find((s) => s.key === 'notifications.timing')?.effective;
    if (t && typeof t === 'object')
      windowOf[z.id] = t as { promotionalFrom: string; promotionalTo: string };
  });
  const laterIso = later ? scheduleAt(when) : null;
  const requested = later ? (laterIso ? new Date(laterIso) : null) : new Date();
  const preview =
    kind === 'PROMOTION' && requested
      ? sendPreview(kind, requested, picked, windowOf, DEFAULT_WINDOW)
      : [];

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const save = async () => {
    setAlert(null);
    if (later && !laterIso) return setErrors({ scheduledAt: 'Pick a time in the next 30 days' });
    const full = {
      kind,
      audience,
      zoneIds: allZones ? [] : zoneIds,
      title: title.trim(),
      body: body.trim(),
      channels,
      ...(laterIso ? { scheduledAt: laterIso } : {}),
    };
    const toErrors = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) => {
      const out: Record<string, string> = {};
      for (const i of issues) out[String(i.path[0] ?? '')] ??= i.message;
      setErrors(out);
    };
    let call: () => Promise<{ id: string }>;
    if (editing) {
      const changes: Record<string, unknown> = { version: editing.version };
      if (audience !== editing.audience) changes['audience'] = audience;
      const before = editing.zones
        .map((z) => z.id)
        .sort()
        .join();
      if ((allZones ? '' : [...zoneIds].sort().join()) !== before)
        changes['zoneIds'] = full.zoneIds;
      if (full.title !== editing.title) changes['title'] = full.title;
      if (full.body !== editing.body) changes['body'] = full.body;
      if ([...channels].sort().join() !== [...editing.channels].sort().join())
        changes['channels'] = channels;
      if (later) changes['scheduledAt'] = laterIso;
      const p = updateNotificationSchema.safeParse(changes);
      if (!p.success) return toErrors(p.error.issues);
      call = () =>
        client.patch('/notifications/{id}', { params: { id: editing.id }, body: p.data });
    } else {
      if (role === 'ZONAL_ADMIN' && full.zoneIds.length === 0)
        return setErrors({ zoneIds: 'Choose at least one of your zones' });
      const p = createNotificationSchema.safeParse(full);
      if (!p.success) return toErrors(p.error.issues);
      call = () => client.post('/notifications', { body: p.data });
    }
    setErrors({});
    setBusy(true);
    try {
      const { id } = await call();
      const waits = role === 'ZONAL_ADMIN' && kind === 'PROMOTION';
      toast({
        title: editing
          ? 'Changes saved'
          : waits
            ? 'Sent for approval'
            : later
              ? 'Scheduled'
              : 'Sending now',
        ...(waits
          ? { description: 'A Super Admin approves promotions before they go out (D94).' }
          : {}),
      });
      await invalidate();
      onClose();
      onSaved?.(id);
    } catch (err) {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      const issue = isApiError(err) ? err.details[0]?.issue : undefined;
      setAlert(
        issue === 'SMS_NOT_AVAILABLE'
          ? 'SMS is not switched on yet (Platform Settings › Notification channels).'
          : issue === 'EMAIL_OFF' || issue === 'IN_APP_OFF'
            ? 'That channel is switched off in Platform Settings › Notification channels.'
            : isApiError(err, 'STALE_VERSION')
              ? 'Someone changed this notification a moment ago. Close and open it again.'
              : isApiError(err)
                ? err.message || TRY_AGAIN
                : TRY_AGAIN,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <div>
          <DialogTitle>{editing ? 'Edit notification' : 'New notification'}</DialogTitle>
          <DialogDescription>
            {role === 'ZONAL_ADMIN'
              ? 'Messages go out as scheduled; promotions wait for a Super Admin to approve them.'
              : 'Promotions go out only inside each zone’s promotion window (Platform Settings).'}
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void save();
          }}
        >
          {!editing ? (
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">Kind</legend>
              {(['MESSAGE', 'PROMOTION'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
          ) : null}
          <FormField label="Audience" error={errors['audience']}>
            <select
              className={inputClass()}
              value={audience}
              onChange={(e) => setAudience(e.target.value as NotificationAudience)}
            >
              {NOTIFICATION_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABEL[a]}
                </option>
              ))}
            </select>
          </FormField>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Zones</legend>
            {role === 'SUPER_ADMIN' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allZones}
                  onChange={(e) => setAllZones(e.target.checked)}
                />
                Every zone
              </label>
            ) : null}
            {!allZones ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {zones.map((z) => (
                  <label key={z.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={zoneIds.includes(z.id)}
                      onChange={() => setZoneIds((l) => toggle(l, z.id))}
                    />
                    {z.name}
                  </label>
                ))}
              </div>
            ) : null}
            {errors['zoneIds'] ? (
              <p className="text-xs font-medium text-danger">{errors['zoneIds']}</p>
            ) : null}
          </fieldset>
          <FormField
            label="Title"
            hint={`${title.trim().length}/${NOTIFICATION_TITLE.max}`}
            error={errors['title']}
          >
            <Input
              value={title}
              maxLength={NOTIFICATION_TITLE.max}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField
            label="Message"
            hint={`${body.trim().length}/${NOTIFICATION_BODY.max}`}
            error={errors['body']}
          >
            <textarea
              className={inputClass('min-h-28 py-2')}
              maxLength={NOTIFICATION_BODY.max}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Channels</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {NOTIFICATION_CHANNELS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channels.includes(c)}
                    onChange={() => setChannels((l) => toggle(l, c))}
                  />
                  {CHANNEL_LABEL[c]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">
              In-app and push are delivered by the apps and follow the in-app switch in Platform
              Settings; SMS waits for its provider.
            </p>
            {errors['channels'] ? (
              <p className="text-xs font-medium text-danger">{errors['channels']}</p>
            ) : null}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">When</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="when" checked={!later} onChange={() => setLater(false)} />
              Now
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="when" checked={later} onChange={() => setLater(true)} />
              Later (India time, within 30 days)
            </label>
            {later ? (
              <input
                type="datetime-local"
                aria-label="Send at"
                className={inputClass('max-w-64')}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            ) : null}
            {errors['scheduledAt'] ? (
              <p className="text-xs font-medium text-danger">{errors['scheduledAt']}</p>
            ) : null}
          </fieldset>
          {preview.length > 0 ? (
            <div className="rounded-input bg-surface-muted p-3 text-sm">
              <p className="font-medium">When it goes out</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {preview.map((p) => (
                  <li key={p.zone}>
                    {p.zone}: {istTime(p.at)}
                    {p.held ? (
                      <span className="text-muted"> (held to the promotion window)</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {role === 'ZONAL_ADMIN' ? (
                <p className="mt-1 text-xs text-muted">
                  Shown with the default window; a zone may have its own.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editing
                ? 'Save changes'
                : role === 'ZONAL_ADMIN' && kind === 'PROMOTION'
                  ? 'Send for approval'
                  : later
                    ? 'Schedule'
                    : 'Send'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
