'use client';

import {
  SETTING_REASON_MAX,
  SETTING_REASON_MIN,
  renderOrderNumber,
  type SettingsPreview as PreviewSchema,
} from '@zoauro/shared';
import { ArrowRight, CircleAlert, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { Input, inputClass } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../account/useReauthGuard';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { useInvalidateSettings, type SettingItem } from './api';
import {
  KEY_SPECS,
  OPTION_LABEL,
  describeValue,
  formatMinutes,
  fromDraft,
  toDraft,
  validate,
  type Draft,
  type DraftRow,
  type DraftValue,
  type FieldSpec,
} from './fields';

// The settings change workflow of the owner's spec 2.8: open → edit → validate → preview the impact → reason →
// re-authenticate (D112: password, or password and a code for refund limits and the SMS provider) → save → confirm.
// Nothing is reported as saved unless the API said so; a concurrent save is a 409 STALE_VERSION and asks to reopen.

export interface EditTarget {
  setting: SettingItem;
  /** null = the platform value; a zone = that zone's own value (zone-overridable keys only) */
  zone: { id: string; name: string; code: string } | null;
}

function failure(err: unknown): string {
  if (isApiError(err, 'STALE_VERSION'))
    return 'Someone else saved this setting a moment ago. Close this window and open it again to see their value.';
  if (isApiError(err)) return err.message || TRY_AGAIN;
  return TRY_AGAIN;
}

export function SettingEditor({
  target,
  onClose,
}: {
  target: EditTarget | null;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateSettings();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    value: unknown;
    result: Pick<PreviewSchema, 'membersAboveCap' | 'orderNumberExample'>;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setDraft(target ? toDraft(target.setting.key, target.setting.effective) : null);
    setErrors({});
    setPreview(null);
    setReason('');
    setAlert(null);
  }, [target]);

  if (!target || !draft) return dialog;
  const { setting, zone } = target;
  const spec = KEY_SPECS[setting.key];
  const where = zone ? ` in ${zone.name}` : '';
  const current = zone ? setting.zone : setting.platform;

  const review = async () => {
    setAlert(null);
    const value = fromDraft(setting.key, draft);
    const found = validate(setting.key, value);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (JSON.stringify(value) === JSON.stringify(setting.effective)) {
      setAlert('Nothing changed: this is already the value in effect.');
      return;
    }
    setBusy(true);
    try {
      const result = await client.post('/settings/{group}/preview', {
        params: { group: setting.group },
        body: { values: { [setting.key]: value }, ...(zone ? { zoneId: zone.id } : {}) },
      });
      setPreview({ value, result });
    } catch (err) {
      setAlert(failure(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setAlert(null);
    setBusy(true);
    const body = {
      values: { [setting.key]: preview.value },
      reason: reason.trim(),
      ...(current ? { versions: { [setting.key]: current.version } } : {}),
    };
    try {
      await guarded(`Save ${setting.label}${where}`, setting.reauth, async () => {
        if (zone)
          await client.put('/zones/{id}/settings/{group}', {
            params: { id: zone.id, group: setting.group },
            body,
          });
        else await client.put('/settings/{group}', { params: { group: setting.group }, body });
      });
      toast({
        title: `${setting.label} saved${where}`,
        description:
          setting.effect.state === 'ENFORCED'
            ? 'The new value applies from the next request.'
            : `Saved. It takes effect when ${setting.effect.module ?? 'its module'} is built.`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (!(err instanceof ReauthCancelled)) setAlert(failure(err));
    } finally {
      setBusy(false);
    }
  };

  const reasonOk = reason.trim().length >= SETTING_REASON_MIN;
  const before = describeValue(setting.key, setting.effective);
  const after = preview ? describeValue(setting.key, preview.value) : [];

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-2xl">
          <div>
            <DialogTitle>
              {preview ? 'Review the change' : `Edit ${setting.label}`}
              {where}
            </DialogTitle>
            <DialogDescription>{setting.description}</DialogDescription>
          </div>

          {alert ? <FormAlert>{alert}</FormAlert> : null}

          {!preview ? (
            <div className="flex flex-col gap-4">
              {spec?.nullable ? (
                <div className="flex items-center gap-3 text-sm font-medium">
                  <Switch
                    checked={draft.configured}
                    onChange={(configured) => setDraft({ ...draft, configured })}
                    label="Configure this setting"
                  />
                  <span aria-hidden>Configure this setting</span>
                </div>
              ) : null}
              {spec?.nullable && !draft.configured ? (
                <p className="rounded-input bg-surface-muted p-3 text-sm text-muted">
                  Not configured: the behaviour that depends on it stays off.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {(spec?.fields ?? []).map((f) => (
                    <FieldControl
                      key={f.path}
                      field={f}
                      value={draft.fields[f.path] ?? null}
                      error={errors[f.path]}
                      onChange={(v) =>
                        setDraft({ ...draft, fields: { ...draft.fields, [f.path]: v } })
                      }
                    />
                  ))}
                </div>
              )}
              {errors[''] ? <FormAlert>{errors['']}</FormAlert> : null}
              {setting.key === 'orders.numberFormat' &&
              typeof draft.fields['template'] === 'string' ? (
                <p className="text-sm text-muted">
                  Example:{' '}
                  <span className="font-mono font-semibold text-text">
                    {renderOrderNumber(
                      draft.fields['template'],
                      zone?.code ?? 'ANN',
                      1,
                      new Date(),
                    )}
                  </span>
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={() => void review()} disabled={busy}>
                  Review change <ArrowRight aria-hidden className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <table className="w-full text-sm">
                <caption className="sr-only">Before and after</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1.5 font-medium">
                      Setting
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Now
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      After saving
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {after.map((row, i) => {
                    const was = before.find((b) => b.label === row.label)?.text ?? before[i]?.text;
                    const changed = was !== row.text;
                    return (
                      <tr key={row.label}>
                        <th scope="row" className="py-2 pr-3 text-left font-medium">
                          {row.label}
                        </th>
                        <td className="py-2 pr-3 text-muted">{was ?? '—'}</td>
                        <td className={changed ? 'py-2 font-semibold text-primary-strong' : 'py-2'}>
                          {row.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {preview.result.membersAboveCap.length > 0 ? (
                <div className="flex gap-3 rounded-input border border-amber-200 bg-warning-soft p-3 text-sm">
                  <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold text-warning">
                      {preview.result.membersAboveCap.length} member
                      {preview.result.membersAboveCap.length === 1 ? ' has' : 's have'} a limit
                      above the new cap
                    </p>
                    <p className="mt-0.5 text-muted">
                      They can never refund more than the cap; their own limit is kept until it is
                      edited (D110).
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {preview.result.membersAboveCap.slice(0, 5).map((m) => (
                        <li key={`${m.memberId}-${m.zoneId}`}>
                          {m.name} · {m.zoneName}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {preview.result.orderNumberExample ? (
                <p className="text-sm text-muted">
                  The next order number would look like{' '}
                  <span className="font-mono font-semibold text-text">
                    {preview.result.orderNumberExample}
                  </span>
                  . Existing order numbers never change.
                </p>
              ) : null}

              <FormField
                label="Reason for the change"
                hint={`Recorded in Settings History (${SETTING_REASON_MIN}–${SETTING_REASON_MAX} characters)`}
              >
                <textarea
                  className={inputClass('min-h-20 py-2')}
                  value={reason}
                  maxLength={SETTING_REASON_MAX}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FormField>
              <p className="text-xs text-muted">
                {setting.reauth === 'STRONG'
                  ? 'Saving asks for your password and a 2-step code.'
                  : 'Saving asks for your password.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
                  Back
                </Button>
                <Button onClick={() => void save()} disabled={busy || !reasonOk}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

function FieldControl({
  field: f,
  value,
  error,
  onChange,
}: {
  field: FieldSpec;
  value: DraftValue;
  error: string | undefined;
  onChange: (v: DraftValue) => void;
}) {
  const groupId = useId();
  if (f.kind === 'bool')
    return (
      <div className="flex items-center justify-between gap-3 rounded-input border border-line p-3">
        <span id={groupId} className="text-sm font-medium">
          {f.label}
        </span>
        <Switch checked={value === true} onChange={onChange} labelledBy={groupId} />
        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
      </div>
    );
  if (f.kind === 'checks') {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">{f.label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(f.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(o)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))
                }
              />
              {OPTION_LABEL[o] ?? o}
            </label>
          ))}
        </div>
        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
      </fieldset>
    );
  }
  if (f.kind === 'rows')
    return <RowsControl field={f} value={value} error={error} onChange={onChange} />;
  const text = typeof value === 'string' ? value : '';
  const hint =
    f.kind === 'minutes' && text.trim() !== '' && Number.isFinite(Number(text))
      ? `${formatMinutes(Number(text))} (in minutes)`
      : f.kind === 'minutes'
        ? 'In minutes'
        : f.kind === 'money'
          ? 'In rupees'
          : f.hint;
  if (f.kind === 'select')
    return (
      <FormField label={f.label} error={error}>
        <select className={inputClass()} value={text} onChange={(e) => onChange(e.target.value)}>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {OPTION_LABEL[o] ?? o}
            </option>
          ))}
        </select>
      </FormField>
    );
  if (f.kind === 'lines')
    return (
      <FormField
        label={f.label}
        hint={hint}
        error={error}
        className="flex flex-col gap-1.5 sm:col-span-2"
      >
        <textarea
          className={inputClass('min-h-24 py-2')}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  return (
    <FormField
      label={f.label}
      hint={hint}
      error={error}
      className={f.kind === 'text' ? 'flex flex-col gap-1.5 sm:col-span-2' : undefined}
    >
      <Input
        type={f.kind === 'time' ? 'time' : f.kind === 'text' ? 'text' : 'number'}
        inputMode={f.kind === 'text' || f.kind === 'time' ? undefined : 'decimal'}
        step={f.kind === 'money' ? '0.01' : f.kind === 'number' ? 'any' : '1'}
        min={f.kind === 'text' || f.kind === 'time' ? undefined : 0}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

/** A small table (refund reasons, onboarding documents): edit cells, add and remove rows, or leave it not configured. */
function RowsControl({
  field: f,
  value,
  error,
  onChange,
}: {
  field: FieldSpec;
  value: DraftValue;
  error: string | undefined;
  onChange: (v: DraftValue) => void;
}) {
  const rows = Array.isArray(value) ? (value as DraftRow[]) : null;
  const columns = f.columns ?? [];
  const setCell = (i: number, key: string, cell: string | boolean | string[]) =>
    rows && onChange(rows.map((r, j) => (j === i ? { ...r, [key]: cell } : r)));
  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className="mb-1 text-sm font-medium">{f.label}</legend>
      {f.hint ? <p className="text-xs text-muted">{f.hint}</p> : null}
      {f.nullable ? (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={rows === null}
            onChange={(e) => onChange(e.target.checked ? null : [])}
          />
          Not configured yet
        </label>
      ) : null}
      {rows !== null ? (
        <div className="overflow-x-auto rounded-input border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-1.5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {columns.map((c) => {
                    const cellLabel = `${c.label}, row ${i + 1}`;
                    const cell = r[c.key];
                    return (
                      <td key={c.key} className="px-2 py-1.5">
                        {c.kind === 'checks' ? (
                          <span className="flex flex-wrap gap-x-3 gap-y-1">
                            {(c.options ?? []).map((o) => {
                              const picked = Array.isArray(cell) ? cell : [];
                              return (
                                <label key={o} className="flex items-center gap-1 text-xs">
                                  <input
                                    type="checkbox"
                                    aria-label={`${OPTION_LABEL[o] ?? o}, ${cellLabel}`}
                                    checked={picked.includes(o)}
                                    onChange={(e) =>
                                      setCell(
                                        i,
                                        c.key,
                                        e.target.checked
                                          ? [...picked, o]
                                          : picked.filter((x) => x !== o),
                                      )
                                    }
                                  />
                                  {OPTION_LABEL[o] ?? o}
                                </label>
                              );
                            })}
                          </span>
                        ) : c.kind === 'bool' ? (
                          <input
                            type="checkbox"
                            aria-label={cellLabel}
                            checked={cell === true}
                            onChange={(e) => setCell(i, c.key, e.target.checked)}
                          />
                        ) : c.kind === 'select' ? (
                          <select
                            aria-label={cellLabel}
                            className={inputClass('h-8 min-w-28')}
                            value={String(cell ?? '')}
                            onChange={(e) => setCell(i, c.key, e.target.value)}
                          >
                            {(c.options ?? []).map((o) => (
                              <option key={o} value={o}>
                                {OPTION_LABEL[o] ?? o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            aria-label={cellLabel}
                            className={c.kind === 'code' ? 'h-8 font-mono uppercase' : 'h-8'}
                            maxLength={c.kind === 'code' ? 40 : 60}
                            value={String(cell ?? '')}
                            onChange={(e) =>
                              setCell(
                                i,
                                c.key,
                                c.kind === 'code' ? e.target.value.toUpperCase() : e.target.value,
                              )
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove row ${i + 1}`}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line p-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChange([...rows, { ...(f.newRow ?? {}) }])}
            >
              Add a row
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
    </fieldset>
  );
}

/** "Reset to default" (platform) or "Remove the zone's own value": a reason and the re-auth, then DELETE. */
export function ResetSettingDialog({
  target,
  onClose,
}: {
  target: EditTarget | null;
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateSettings();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setAlert(null);
  }, [target]);

  if (!target) return dialog;
  const { setting, zone } = target;
  const title = zone
    ? `Remove ${zone.name}'s own ${setting.label}?`
    : `Reset ${setting.label} to the default?`;

  const run = async () => {
    setBusy(true);
    setAlert(null);
    const body = { reason: reason.trim() };
    try {
      await guarded(title, setting.reauth, async () => {
        if (zone)
          await client.delete('/zones/{id}/settings/{group}/{key}', {
            params: { id: zone.id, group: setting.group, key: setting.key },
            body,
          });
        else
          await client.delete('/settings/{group}/{key}', {
            params: { group: setting.group, key: setting.key },
            body,
          });
      });
      toast({
        title: zone
          ? `${zone.name} follows the platform value again`
          : `${setting.label} is back to the default`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (!(err instanceof ReauthCancelled)) setAlert(failure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning"
            >
              <RotateCcw className="size-5" />
            </span>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {zone
                  ? 'The zone then uses the platform value (or the default when none is saved).'
                  : 'The decided default rule applies again until a Super Admin saves a new value (D109).'}
              </DialogDescription>
            </div>
          </div>
          {alert ? <FormAlert>{alert}</FormAlert> : null}
          <FormField
            label="Reason"
            hint={`Recorded in Settings History (at least ${SETTING_REASON_MIN} characters)`}
          >
            <textarea
              className={inputClass('min-h-20 py-2')}
              value={reason}
              maxLength={SETTING_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void run()}
              disabled={busy || reason.trim().length < SETTING_REASON_MIN}
            >
              {zone ? 'Remove' : 'Reset'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
