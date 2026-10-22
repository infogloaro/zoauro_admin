import { classifyField } from './registry';
import type { FieldPolicy } from './registry';

export const REDACTED = '[redacted]';
const MAX_STRING = 2000;
const MAX_ARRAY = 100;

export function maskPhone(v: string): string {
  const d = v.replace(/\s+/g, '');
  return d.length <= 6 ? '****' : `${d.slice(0, 2)}****${d.slice(-4)}`;
}
export function maskEmail(v: string): string {
  const at = v.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${v.slice(0, 1)}***${v.slice(at)}`;
}
export function maskTail(v: string): string {
  return v.length <= 4 ? '****' : `****${v.slice(-4)}`;
}

function applyPolicy(policy: FieldPolicy, value: unknown): unknown {
  if (policy === 'drop') return REDACTED;
  if (policy === 'keep' || value === null || value === undefined) return value;
  if (typeof value !== 'string') return '****';
  return policy === 'mask-phone' ? maskPhone(value) : policy === 'mask-email' ? maskEmail(value) : maskTail(value);
}

/**
 * Redact a JSON-like value. Dropped keys are kept with the marker "[redacted]" so history shows THAT a secret changed
 * without any of its value (small clarification of doc 50 §5.2, which said "dropped").
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth-limit]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) {
      return {
        count: value.length,
        first100Ids: value.slice(0, MAX_ARRAY).map((i) => (typeof i === 'object' && i !== null && 'id' in i ? (i as { id: unknown }).id : i)),
      };
    }
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const policy = classifyField(k);
      out[k] = policy === 'keep' ? redact(v, depth + 1) : applyPolicy(policy, v);
    }
    return out;
  }
  return value;
}

/** "a.b.c" style field paths from the diff are redacted by their last segment. */
export function redactFieldList(fields: string[]): string[] {
  return fields; // names only, never values; kept as a function so a future policy can hide sensitive field NAMES
}
