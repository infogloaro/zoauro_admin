'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Combobox, type ComboOption } from '../../../components/shared/Combobox';
import { CONTROL_CLASS, Field, FilterBar } from '../../../components/shared/FilterBar';
import type { UrlPatch } from '../../../lib/url-state';
import { ROLE_LABEL } from '../AuditDetailDrawer';
import {
  ACTOR_TYPES,
  ACTOR_TYPE_LABEL,
  ENTITY_TYPE_SUGGESTIONS,
  type ActivityFilters,
  type SignInFilters,
} from './filters';
import { useActorSearch, useAuditCatalogue, useAuditZones } from './useSystemLogs';
import { useZoneOptions } from '../../platform-settings/api';

const SEARCH_COMMIT_MS = 300;
const label = (module: string): string => module.charAt(0).toUpperCase() + module.slice(1);

/**
 * Text box that writes to the URL 300 ms after the last keystroke (one request per pause, not per letter), and follows
 * the URL when it changes from elsewhere (Reset).
 */
function DebouncedInput({
  id,
  value,
  placeholder,
  onCommit,
  type = 'search',
  list,
  maxLength = 100,
}: {
  id: string;
  value: string | null;
  placeholder: string;
  onCommit: (v: string | null) => void;
  type?: 'search' | 'text';
  /** id of a <datalist> with suggestions */
  list?: string;
  maxLength?: number;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if (text.trim() === (value ?? '')) return;
    const t = setTimeout(() => onCommit(text.trim() === '' ? null : text.trim()), SEARCH_COMMIT_MS);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <input
      id={id}
      type={type}
      list={list}
      value={text}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      className={CONTROL_CLASS}
    />
  );
}

/** Admin typeahead shared by the Actor filter and the Sign-ins user filter. */
function AdminPicker({
  id,
  selectedId,
  selectedName,
  onPick,
}: {
  id: string;
  selectedId: string | null;
  selectedName: string | null;
  onPick: (o: ComboOption | null) => void;
}) {
  const [text, setText] = useState<string | null>(null); // null until the user touches the field: no request before
  const search = useActorSearch(text ?? '', text !== null);
  const options = useMemo<ComboOption[]>(
    () =>
      (search.data?.data ?? []).map((a) => ({
        id: a.id,
        label: a.name,
        ...(a.role ? { hint: ROLE_LABEL[a.role] ?? a.role } : {}),
      })),
    [search.data],
  );
  return (
    <Combobox
      id={id}
      value={selectedId ? { id: selectedId, label: selectedName ?? 'Selected admin' } : null}
      options={options}
      loading={search.isFetching}
      placeholder="Search by name"
      onInputChange={setText}
      onSelect={onPick}
    />
  );
}

function DateRange({
  from,
  to,
  patch,
  idPrefix,
}: {
  from: string | null;
  to: string | null;
  patch: (p: UrlPatch) => void;
  idPrefix: string;
}) {
  return (
    <>
      <Field label="From" htmlFor={`${idPrefix}-from`}>
        <input
          id={`${idPrefix}-from`}
          type="date"
          value={from ?? ''}
          max={to ?? undefined}
          onChange={(e) => patch({ from: e.target.value })}
          className={CONTROL_CLASS}
        />
      </Field>
      <Field label="To" htmlFor={`${idPrefix}-to`}>
        <input
          id={`${idPrefix}-to`}
          type="date"
          value={to ?? ''}
          min={from ?? undefined}
          onChange={(e) => patch({ to: e.target.value })}
          className={CONTROL_CLASS}
        />
      </Field>
    </>
  );
}

export function ActivityFilterBar({
  filters,
  patch,
  onReset,
}: {
  filters: ActivityFilters;
  patch: (p: UrlPatch) => void;
  onReset: () => void;
}) {
  const uid = useId();
  const catalogue = useAuditCatalogue();
  const zones = useAuditZones();
  // the zone switcher's ?zone=<CODE>: each zone's code from the zone list (the audit list has id and name)
  const zoneCodes = useZoneOptions();
  const codeOf = (zoneId: string) => zoneCodes.data?.data.find((z) => z.id === zoneId)?.code;
  const modules = catalogue.data?.modules ?? [];
  const actions = useMemo(() => catalogue.data?.actions ?? [], [catalogue.data]);
  const grouped = useMemo(() => {
    const byModule = new Map<string, typeof actions>();
    for (const a of actions) {
      if (filters.module && a.module !== filters.module) continue;
      byModule.set(a.module, [...(byModule.get(a.module) ?? []), a]);
    }
    return [...byModule].sort(([x], [y]) => x.localeCompare(y));
  }, [actions, filters.module]);
  const id = (name: string) => `${uid}-${name}`;

  return (
    <FilterBar label="Activity filters" onReset={onReset}>
      <DateRange from={filters.from} to={filters.to} patch={patch} idPrefix={uid} />
      <Field label="Actor" htmlFor={id('actor')}>
        <AdminPicker
          id={id('actor')}
          selectedId={filters.actorId}
          selectedName={filters.actorName}
          onPick={(o) => patch({ actor: o?.id ?? null, actorName: o?.label ?? null })}
        />
      </Field>
      <Field label="Actor type" htmlFor={id('actorType')}>
        <select
          id={id('actorType')}
          value={filters.actorType ?? ''}
          onChange={(e) => patch({ actorType: e.target.value || null })}
          className={CONTROL_CLASS}
        >
          <option value="">All</option>
          {ACTOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTOR_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Module" htmlFor={id('module')}>
        <select
          id={id('module')}
          value={filters.module ?? ''}
          onChange={(e) => {
            const nextModule = e.target.value || null;
            // an action belongs to one module: keep it only if it still fits
            const keep =
              filters.action &&
              actions.find((a) => a.key === filters.action)?.module === nextModule;
            patch({ module: nextModule, ...(keep ? {} : { action: null }) });
          }}
          className={CONTROL_CLASS}
        >
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Action" htmlFor={id('action')}>
        <select
          id={id('action')}
          value={filters.action ?? ''}
          onChange={(e) => {
            const key = e.target.value || null;
            const actionModule = actions.find((a) => a.key === key)?.module;
            patch({ action: key, ...(actionModule ? { module: actionModule } : {}) });
          }}
          className={CONTROL_CLASS}
        >
          <option value="">All actions</option>
          {grouped.map(([module, list]) => (
            <optgroup key={module} label={label(module)}>
              {list.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Zone" htmlFor={id('zone')}>
        <select
          id={id('zone')}
          value={filters.zoneId ? (codeOf(filters.zoneId) ?? filters.zoneId) : ''}
          onChange={(e) => patch({ zone: e.target.value || null })}
          className={CONTROL_CLASS}
        >
          <option value="">All zones</option>
          {(zones.data?.data ?? []).map((z) => (
            <option key={z.id} value={codeOf(z.id) ?? z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Entity type" htmlFor={id('entityType')}>
        <DebouncedInput
          id={id('entityType')}
          type="text"
          list={id('entityTypes')}
          value={filters.entityType}
          maxLength={60}
          placeholder="e.g. restaurant"
          onCommit={(entityType) => patch({ entityType })}
        />
        <datalist id={id('entityTypes')}>
          {ENTITY_TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <Field label="Search" htmlFor={id('q')}>
        <DebouncedInput
          id={id('q')}
          value={filters.q}
          placeholder="Record or actor name"
          onCommit={(q) => patch({ q })}
        />
      </Field>
      <Field label="Outcome" htmlFor={id('outcome')}>
        <select
          id={id('outcome')}
          value={filters.outcome ?? ''}
          onChange={(e) => patch({ outcome: e.target.value || null })}
          className={CONTROL_CLASS}
        >
          <option value="">All</option>
          <option value="SUCCESS">Success</option>
          <option value="DENIED">Denied</option>
        </select>
      </Field>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.sensitive}
          onChange={(e) => patch({ sensitive: e.target.checked ? '1' : null })}
          className="size-4"
        />
        Sensitive only
      </label>
      {filters.entityId ? (
        <div className="flex h-9 items-center gap-1 text-sm sm:col-span-2">
          <span className="truncate rounded-full bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
            Record: {filters.entityType ?? 'any'} · {filters.entityId.slice(0, 8)}…
          </span>
          <button
            type="button"
            aria-label="Remove record filter"
            onClick={() => patch({ entityId: null, entityType: null })}
            className="rounded p-1 hover:bg-neutral-100 focus-visible:outline-2 dark:hover:bg-neutral-800"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : null}
    </FilterBar>
  );
}

export function SignInFilterBar({
  filters,
  patch,
  onReset,
}: {
  filters: SignInFilters;
  patch: (p: UrlPatch) => void;
  onReset: () => void;
}) {
  const uid = useId();
  return (
    <FilterBar label="Sign-in filters" onReset={onReset}>
      <DateRange from={filters.from} to={filters.to} patch={patch} idPrefix={uid} />
      <Field label="User" htmlFor={`${uid}-user`}>
        <AdminPicker
          id={`${uid}-user`}
          selectedId={filters.userId}
          selectedName={filters.userName}
          onPick={(o) => patch({ user: o?.id ?? null, userName: o?.label ?? null })}
        />
      </Field>
      <Field label="Result" htmlFor={`${uid}-success`}>
        <select
          id={`${uid}-success`}
          value={filters.success ?? ''}
          onChange={(e) => patch({ success: e.target.value || null })}
          className={CONTROL_CLASS}
        >
          <option value="">All</option>
          <option value="true">Successful</option>
          <option value="false">Failed</option>
        </select>
      </Field>
    </FilterBar>
  );
}
