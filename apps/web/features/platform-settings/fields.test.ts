import { SETTINGS, settingDef } from '@zoauro/shared';
import { describe, expect, it } from 'vitest';
import { KEY_SPECS, fromDraft, toDraft, validate } from './fields';

// W1 (demo-day audit): an editable setting whose key has no field spec opens an empty editor that cannot be saved.
// Every editable registry key must have a spec, and the spec must cover every field of the key's schema.

/** The leaf field paths of a zod object schema ("ADMIN.allowedBefore"); arrays, unions and scalars are leaves. */
function leafPaths(schema: unknown, prefix = ''): string[] {
  let s = schema as {
    def?: { type?: string; innerType?: unknown; shape?: Record<string, unknown> };
  };
  // nullable / optional / default wrappers
  while (s.def && s.def.innerType && s.def.type !== 'object') s = s.def.innerType as typeof s;
  const shape = s.def?.type === 'object' ? s.def.shape : undefined;
  if (!shape) return prefix ? [prefix] : [];
  return Object.entries(shape).flatMap(([k, v]) => {
    const inner = v as typeof s;
    const isObject =
      inner.def?.type === 'object' ||
      (inner.def?.innerType as typeof s | undefined)?.def?.type === 'object';
    const path = prefix ? `${prefix}.${k}` : k;
    return isObject ? leafPaths(v, path) : [path];
  });
}

describe('settings specs (W1)', () => {
  const editable = SETTINGS.filter((s) => s.editable);

  it('reads the schemas it checks (nested, nullable and refined objects)', () => {
    expect(leafPaths(settingDef('orders.cancellationRules')?.schema)).toContain(
      'ADMIN.allowedBefore',
    );
    expect(leafPaths(settingDef('loyalty.values')?.schema)).toContain('monthlyEarnCapPoints');
    expect(leafPaths(settingDef('onboarding.ageWarnings')?.schema)).toEqual([
      'warnHours',
      'lateHours',
    ]);
  });

  it('every editable key has a field spec covering every field of its schema', () => {
    const gaps: string[] = [];
    for (const def of editable) {
      const spec = KEY_SPECS[def.key];
      if (!spec) {
        gaps.push(`${def.key}: no spec`);
        continue;
      }
      const covered = spec.fields.map((f) => f.path);
      for (const p of leafPaths(def.schema))
        if (!covered.includes(p)) gaps.push(`${def.key}: ${p} not editable`);
    }
    expect(gaps).toEqual([]);
  });

  it('each default round-trips through the form and passes its own schema', () => {
    for (const def of editable) {
      if (def.default === null) continue;
      const value = fromDraft(def.key, toDraft(def.key, def.default));
      expect(validate(def.key, value), def.key).toEqual({});
    }
  });

  it('loyalty: an empty monthly cap is "no cap" (null), a number is kept', () => {
    const value = {
      earnRatePercent: 1,
      pointsExpiryDays: 365,
      pointValuePaise: 25,
      minRedeemPoints: 100,
      maxRedeemPercentPerOrder: 20,
      monthlyEarnCapPoints: null,
      walletConversionEnabled: true,
    };
    const draft = toDraft('loyalty.values', value);
    expect(fromDraft('loyalty.values', draft)).toEqual(value);
    draft.fields['monthlyEarnCapPoints'] = '5000';
    expect(fromDraft('loyalty.values', draft)).toMatchObject({ monthlyEarnCapPoints: 5000 });
    expect(
      settingDef('loyalty.values')?.schema.safeParse(fromDraft('loyalty.values', draft)).success,
    ).toBe(true);
  });
});
