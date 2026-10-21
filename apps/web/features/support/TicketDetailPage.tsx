'use client';

import type { TicketMessageVisibility, TicketStatus } from '@zoauro/shared';
import { Lock, MessageSquare, UserCheck, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormAlert, FormField } from '../../components/ui/field';
import { inputClass } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useApiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { CardSkeleton, DetailError } from '../dashboard/parts';
import { relativeTime } from '../dashboard/time';
import { useInvalidateTickets, useTicket } from './api';
import {
  CATEGORY_LABEL,
  MOVE_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  slaState,
  supportPath,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from './labels';
import type { SupportPageProps } from './support-page-props';

// One ticket (D139–D141): its customer, linked order, SLA deadlines (first response, resolution, escalation; the clock
// pauses while waiting on the customer), the conversation (public replies and internal notes), a reply box, the status
// moves the API allows right now, and (re)assignment (to me, or the automatic choice). Every move and assignment is sent
// at the version seen; a stale one says so and reloads.

const problem = (err: unknown) =>
  isApiError(err, 'STALE_VERSION')
    ? 'Someone changed this ticket a moment ago. It has been reloaded: check it and try again.'
    : isApiError(err)
      ? err.message || TRY_AGAIN
      : TRY_AGAIN;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export function TicketDetailPage({ id, role, meId, can }: SupportPageProps & { id: string }) {
  const client = useApiClient();
  const ticket = useTicket(id);
  const invalidate = useInvalidateTickets();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [move, setMove] = useState<TicketStatus | null>(null);
  const listPath = supportPath(role);
  const base = role === 'SUPER_ADMIN' ? '/super-admin' : '/zone';

  if (ticket.isError)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Ticket"
          crumbs={[{ label: 'Support Tickets', href: listPath }, { label: 'Not found' }]}
        />
        <DetailError
          error={ticket.error}
          what="Ticket"
          backHref={listPath}
          backLabel="Back to Support Tickets"
          onRetry={() => void ticket.refetch()}
        />
      </div>
    );
  if (!ticket.data) return <CardSkeleton rows={8} />;
  const t = ticket.data;
  const sla = slaState(t);

  const assign = async (assigneeId: string | null) => {
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/support/tickets/{id}/assign', {
        params: { id: t.id },
        body: { assigneeId },
        ifMatch: t.version,
      });
      toast({ title: assigneeId ? 'Assigned to you' : 'Assigned automatically' });
    } catch (err) {
      setAlert(problem(err));
    } finally {
      await invalidate();
      setBusy(false);
    }
  };

  const facts: [string, React.ReactNode][] = [
    ['Category', CATEGORY_LABEL[t.category]],
    ['Opened', `${when(t.createdAt)} · ${t.source === 'APP' ? 'from the app' : 'by an admin'}`],
    [
      'First reply due',
      t.firstRespondedAt
        ? `Replied ${relativeTime(t.firstRespondedAt)}`
        : when(t.firstResponseDueAt),
    ],
    ['Resolve by', when(t.resolutionDueAt)],
    [
      'Escalates at',
      t.escalatedAt ? `Escalated ${relativeTime(t.escalatedAt)}` : when(t.escalationDueAt),
    ],
    [
      'Reopened',
      t.reopenCount ? `${t.reopenCount} time${t.reopenCount === 1 ? '' : 's'}` : 'Never',
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.subject}
        crumbs={[
          {
            label: 'Dashboard',
            href: role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/zone/dashboard',
          },
          { label: 'Support Tickets', href: listPath },
          { label: t.ticketNo },
        ]}
        description={`Ticket ${t.ticketNo}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TICKET_STATUS_TONE[t.status]} dot>
          {TICKET_STATUS_LABEL[t.status]}
        </Badge>
        <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]} priority</Badge>
        <Badge tone={sla.tone}>{sla.label}</Badge>
        <span className="text-sm text-muted">
          {t.assignee ? `Assigned to ${t.assignee.name}` : 'Not assigned yet'}
        </span>
      </div>

      {can.edit ? (
        <Card aria-labelledby="ticket-actions">
          <CardHeader id="ticket-actions" title="Actions" />
          <CardBody className="flex flex-wrap gap-2">
            {t.allowedTransitions.map((s) => (
              <Button
                key={s}
                variant={s === 'RESOLVED' ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => setMove(s)}
              >
                {MOVE_LABEL[s] ?? TICKET_STATUS_LABEL[s]}
              </Button>
            ))}
            {t.status !== 'CLOSED' && t.assignee?.id !== meId ? (
              <Button variant="secondary" disabled={busy} onClick={() => void assign(meId)}>
                <UserCheck aria-hidden className="size-4" /> Assign to me
              </Button>
            ) : null}
            {t.status !== 'CLOSED' ? (
              <Button variant="ghost" disabled={busy} onClick={() => void assign(null)}>
                <Wand2 aria-hidden className="size-4" /> Assign automatically
              </Button>
            ) : null}
          </CardBody>
          {alert ? (
            <div className="px-5 pb-4">
              <FormAlert>{alert}</FormAlert>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card aria-labelledby="ticket-conversation">
            <CardHeader
              id="ticket-conversation"
              title="Conversation"
              subtitle="Replies go to the customer; internal notes stay with the team."
            />
            <CardBody className="flex flex-col gap-4">
              {t.messages.length === 0 ? (
                <p className="text-sm text-muted">No messages yet.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {t.messages.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        'rounded-card border p-3 text-sm',
                        m.visibility === 'INTERNAL'
                          ? 'border-warning/40 bg-warning-soft'
                          : 'border-line bg-surface',
                      )}
                    >
                      <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-semibold text-text">{m.author.name}</span>
                        {m.visibility === 'INTERNAL' ? (
                          <Badge tone="warning">
                            <Lock aria-hidden className="size-3" /> Internal note
                          </Badge>
                        ) : (
                          <Badge tone="info">
                            <MessageSquare aria-hidden className="size-3" /> Reply
                          </Badge>
                        )}
                        <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      {m.attachmentKeys.length ? (
                        <p className="mt-1 text-xs text-muted">
                          {m.attachmentKeys.length} attachment
                          {m.attachmentKeys.length === 1 ? '' : 's'}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {can.edit && t.status !== 'CLOSED' ? (
                <Composer ticketId={t.id} onSent={() => void invalidate()} />
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card aria-labelledby="ticket-customer">
            <CardHeader id="ticket-customer" title="Customer" />
            <CardBody className="flex flex-col gap-1 text-sm">
              <a href={`${base}/customers/${t.customerId}`} className="font-medium hover:underline">
                {t.customerName}
              </a>
              <span className="text-muted tabular-nums">{t.customerPhoneMasked}</span>
              {t.orderId ? (
                <a
                  href={`${base}/orders/${t.orderId}`}
                  className="mt-2 text-primary-strong hover:underline"
                >
                  Open the linked order
                </a>
              ) : (
                <span className="mt-2 text-xs text-muted">Not linked to an order</span>
              )}
            </CardBody>
          </Card>
          <Card aria-labelledby="ticket-sla">
            <CardHeader id="ticket-sla" title="Service time" />
            <CardBody>
              <dl className="flex flex-col gap-2 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      {move ? (
        <MoveDialog
          ticket={{ id: t.id, version: t.version, ticketNo: t.ticketNo }}
          to={move}
          onClose={() => setMove(null)}
          onDone={() => void invalidate()}
        />
      ) : null}
    </div>
  );
}

function Composer({ ticketId, onSent }: { ticketId: string; onSent: () => void }) {
  const client = useApiClient();
  const { toast } = useToast();
  const [visibility, setVisibility] = useState<TicketMessageVisibility>('PUBLIC');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/support/tickets/{id}/messages', {
        params: { id: ticketId },
        body: { visibility, body: text, attachmentKeys: [] },
      });
      toast({ title: visibility === 'PUBLIC' ? 'Reply sent' : 'Note added' });
      setBody('');
      onSent();
    } catch (err) {
      setAlert(problem(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Who sees it</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="ticket-visibility"
            checked={visibility === 'PUBLIC'}
            onChange={() => setVisibility('PUBLIC')}
          />
          Reply to the customer
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="ticket-visibility"
            checked={visibility === 'INTERNAL'}
            onChange={() => setVisibility('INTERNAL')}
          />
          Internal note
        </label>
      </fieldset>
      {alert ? <FormAlert>{alert}</FormAlert> : null}
      <label className="sr-only" htmlFor="ticket-message">
        Message
      </label>
      <textarea
        id="ticket-message"
        className={inputClass('min-h-24 py-2')}
        maxLength={5000}
        placeholder={visibility === 'PUBLIC' ? 'Write to the customer…' : 'A note for the team…'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button disabled={busy || body.trim() === ''} onClick={() => void send()}>
          {visibility === 'PUBLIC' ? 'Send reply' : 'Add note'}
        </Button>
      </div>
    </div>
  );
}

function MoveDialog({
  ticket,
  to,
  onClose,
  onDone,
}: {
  ticket: { id: string; version: number; ticketNo: string };
  to: TicketStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const client = useApiClient();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const verb = MOVE_LABEL[to] ?? TICKET_STATUS_LABEL[to];

  const run = async () => {
    setAlert(null);
    setBusy(true);
    try {
      await client.post('/support/tickets/{id}/transition', {
        params: { id: ticket.id },
        body: {
          to: to as Exclude<TicketStatus, 'OPEN'>,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ifMatch: ticket.version,
      });
      toast({ title: `${ticket.ticketNo}: ${TICKET_STATUS_LABEL[to].toLowerCase()}` });
      onDone();
      onClose();
    } catch (err) {
      setAlert(problem(err));
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <div>
          <DialogTitle>
            {verb} {ticket.ticketNo}?
          </DialogTitle>
          <DialogDescription>
            {to === 'WAITING_CUSTOMER'
              ? 'The service-time clock pauses until the customer answers or you resume it.'
              : to === 'RESOLVED'
                ? 'The customer can still reopen it within the reopen window set in the Control Panel.'
                : to === 'REOPENED'
                  ? 'The ticket goes back to the queue and its clock runs again.'
                  : to === 'CLOSED'
                    ? 'Closed tickets cannot be reopened.'
                    : 'The clock runs again.'}
          </DialogDescription>
        </div>
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <FormField label="Note (optional)">
          <textarea
            className={inputClass('min-h-20 py-2')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            variant={to === 'CLOSED' ? 'danger' : 'primary'}
            onClick={() => void run()}
            disabled={busy}
          >
            {verb}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
