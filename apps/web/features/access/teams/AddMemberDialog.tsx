'use client';

import { ACCESS_LIMIT_MAX_PAISE, ASSIGNMENT_NOTE_MAX, addTeamMemberSchema } from '@zoauro/shared';
import { UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormAlert, FormField } from '../../../components/ui/field';
import { inputClass } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useApiClient } from '../../../lib/api-client';
import { ReauthCancelled, useReauthGuard } from '../../account/useReauthGuard';
import { formatPaise } from '../../audit/format';
import { isApiError, TRY_AGAIN } from '../../auth/errors';
import { parseRupees } from '../../zones/ZoneFormDialog';
import { useAccessProfiles, useInvalidateTeams, useMemberOptions } from './api';

// Add member to a zone team (M03, POST /zones/{id}/team/{userId}, PASSWORD re-auth, D106–D107): pick a Zonal Admin not
// yet in the team, an access profile, optional refund limits in rupees (empty = the profile default) and a note.

const selectClass = inputClass('h-10');
const MAX_RUPEES = (ACCESS_LIMIT_MAX_PAISE / 100).toLocaleString('en-IN');

type Errors = Partial<Record<'member' | 'profile' | 'perRefund' | 'dailyRefund' | 'form', string>>;

function friendlyError(err: unknown): string {
  if (!isApiError(err)) return TRY_AGAIN;
  switch (err.code) {
    case 'CONFLICT':
      return 'This member is already in the zone team. Refresh the page to see it.';
    case 'NOT_FOUND':
      return 'The zone or the member no longer exists. Refresh the page.';
    default:
      return err.message || TRY_AGAIN;
  }
}

/** Empty = the profile default (null); otherwise rupees to paise within D106's cap, or an error message. */
function readLimit(text: string): { paise: number | null; error?: string } {
  if (text.trim() === '') return { paise: null };
  const paise = parseRupees(text);
  if (paise === null)
    return { paise: null, error: 'Enter an amount in rupees, like 2500 or 2500.50' };
  if (paise > ACCESS_LIMIT_MAX_PAISE) return { paise: null, error: `At most ₹${MAX_RUPEES}` };
  return { paise };
}

export function AddMemberDialog({
  open,
  zoneId,
  zoneName,
  teamUserIds,
  onClose,
}: {
  open: boolean;
  zoneId: string;
  zoneName: string;
  teamUserIds: readonly string[];
  onClose: () => void;
}) {
  const client = useApiClient();
  const invalidate = useInvalidateTeams();
  const { toast } = useToast();
  const { guarded, dialog } = useReauthGuard();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [memberId, setMemberId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [perRefund, setPerRefund] = useState('');
  const [dailyRefund, setDailyRefund] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const members = useMemberOptions(q, open);
  const profiles = useAccessProfiles(open);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setQ('');
    setMemberId('');
    setProfileId('');
    setPerRefund('');
    setDailyRefund('');
    setNote('');
    setErrors({});
  }, [open]);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const candidates = (members.data?.data ?? []).filter((m) => !teamUserIds.includes(m.id));
  const chosen = candidates.find((m) => m.id === memberId);
  const profile = profiles.data?.data.find((p) => p.id === profileId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!memberId) next.member = 'Choose the Zonal Admin to add';
    if (!profileId) next.profile = 'Choose an access profile';
    const per = readLimit(perRefund);
    const daily = readLimit(dailyRefund);
    if (per.error) next.perRefund = per.error;
    if (daily.error) next.dailyRefund = daily.error;
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    const withLimits = per.paise !== null || daily.paise !== null;
    const parsed = addTeamMemberSchema.safeParse({
      profileId,
      ...(withLimits
        ? {
            limits: {
              perRefund: per.paise,
              dailyRefund: daily.paise,
              canReveal: null,
              canExport: null,
            },
          }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setErrors({ form: 'Check the values and try again.' });
      return;
    }
    const body = parsed.data;
    const name = chosen?.name ?? 'The member';
    setBusy(true);
    setErrors({});
    try {
      await guarded(`Add ${name} to ${zoneName}`, 'PASSWORD', async () => {
        await client.post('/zones/{id}/team/{userId}', {
          params: { id: zoneId, userId: memberId },
          body,
        });
      });
      toast({
        title: `${name} added to ${zoneName}`,
        description: `With the ${profile?.name ?? 'chosen'} profile. Their next request sees the zone.`,
      });
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ReauthCancelled) return;
      setErrors({ form: friendlyError(err) });
      toast({ tone: 'error', title: 'The member was not added', description: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  }

  const defaultHint = (paise: number | null | undefined) =>
    profile
      ? `Empty: the profile default (${formatPaise(paise ?? 0)}). At most ₹${MAX_RUPEES}.`
      : `Empty: the profile default. At most ₹${MAX_RUPEES}.`;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-lg">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
            >
              <UserPlus className="size-5" />
            </span>
            <div>
              <DialogTitle>Add member to {zoneName}</DialogTitle>
              <DialogDescription>
                The Zonal Admin gets this zone with the chosen profile. You will be asked for your
                password.
              </DialogDescription>
            </div>
          </div>

          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            {errors.form ? <FormAlert>{errors.form}</FormAlert> : null}
            <FormField label="Search Zonal Admins" hint="Name or email">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputClass('h-10')}
              />
            </FormField>
            <FormField
              label="Member"
              error={errors.member}
              hint={
                members.isError
                  ? 'The member list could not be loaded.'
                  : members.data && candidates.length === 0
                    ? 'No Zonal Admin outside this team matches.'
                    : undefined
              }
            >
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className={selectClass}
                disabled={members.isPending}
              >
                <option value="">{members.isPending ? 'Loading…' : 'Choose a Zonal Admin'}</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.email}
                    {m.status === 'SUSPENDED' ? ' (suspended)' : ''}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Access profile"
              error={errors.profile}
              hint={
                profiles.isError
                  ? 'The profiles could not be loaded.'
                  : (profile?.description ?? undefined)
              }
            >
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className={selectClass}
                disabled={profiles.isPending}
              >
                <option value="">{profiles.isPending ? 'Loading…' : 'Choose a profile'}</option>
                {(profiles.data?.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Per-refund limit (₹)"
                error={errors.perRefund}
                hint={defaultHint(profile?.defaults.perRefund)}
              >
                <input
                  inputMode="decimal"
                  value={perRefund}
                  onChange={(e) => setPerRefund(e.target.value)}
                  className={inputClass('h-10')}
                />
              </FormField>
              <FormField
                label="Per-day limit (₹)"
                error={errors.dailyRefund}
                hint={defaultHint(profile?.defaults.dailyRefund)}
              >
                <input
                  inputMode="decimal"
                  value={dailyRefund}
                  onChange={(e) => setDailyRefund(e.target.value)}
                  className={inputClass('h-10')}
                />
              </FormField>
            </div>
            <FormField label="Note (optional)" hint="Recorded with the change.">
              <textarea
                rows={2}
                maxLength={ASSIGNMENT_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass()}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Adding…' : 'Add member'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
