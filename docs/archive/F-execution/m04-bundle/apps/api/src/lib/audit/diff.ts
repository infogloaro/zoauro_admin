export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Normalise values so Date / bigint / undefined compare and serialise predictably. */
export function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(normalise);
  if (isPlainObject(v)) {
    const out: Obj = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = normalise(val);
    return out;
  }
  return v;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a); const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export type DiffResult = { before: Obj | null; after: Obj | null; changedFields: string[]; isNoop: boolean };

function diffObjects(b: Obj, a: Obj, prefix: string, outB: Obj, outA: Obj, fields: string[]): void {
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of [...keys].sort()) {
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const vb = b[k]; const va = a[k];
    if (inB && inA && deepEqual(vb, va)) continue;
    if (inB && inA && isPlainObject(vb) && isPlainObject(va)) {
      const nb: Obj = {}; const na: Obj = {};
      diffObjects(vb, va, `${prefix}${k}.`, nb, na, fields);
      if (Object.keys(nb).length || Object.keys(na).length) { outB[k] = nb; outA[k] = na; }
      continue;
    }
    if (inB) outB[k] = vb;
    if (inA) outA[k] = va;
    fields.push(`${prefix}${k}`);
  }
}

/**
 * Changed-fields diff (doc 50 §5.1). create: before=null, after=all non-null fields.
 * soft delete: pass the snapshot as `before` and `{deletedAt}` (or null) as `after`.
 * arrays are compared and stored as whole values. Returns isNoop only when both sides were supplied and nothing changed.
 */
export function diff(beforeRaw: unknown, afterRaw: unknown): DiffResult {
  const before = beforeRaw === undefined || beforeRaw === null ? null : normalise(beforeRaw);
  const after = afterRaw === undefined || afterRaw === null ? null : normalise(afterRaw);
  if (before === null && after === null) return { before: null, after: null, changedFields: [], isNoop: false };

  if (before === null && isPlainObject(after)) {
    const nonNull: Obj = {};
    for (const [k, v] of Object.entries(after)) if (v !== null) nonNull[k] = v;
    return { before: null, after: nonNull, changedFields: Object.keys(nonNull).sort(), isNoop: false };
  }
  if (after === null && isPlainObject(before)) {
    return { before, after: null, changedFields: Object.keys(before).sort(), isNoop: false };
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const ob: Obj = {}; const oa: Obj = {}; const fields: string[] = [];
    diffObjects(before, after, '', ob, oa, fields);
    return { before: ob, after: oa, changedFields: fields, isNoop: fields.length === 0 };
  }
  // scalars / mismatched shapes: store as a single value under "value"
  const equal = deepEqual(before, after);
  return { before: { value: before }, after: { value: after }, changedFields: equal ? [] : ['value'], isNoop: equal };
}
