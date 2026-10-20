import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Reads one schema of docs/G-integration/contracts/intake.openapi.yaml and turns it into a strict Zod validator, so a
// test fails when our output and the contract file drift apart. The repository has no YAML or JSON-schema library
// (none may be added without approval): this reads only the subset the contract's flat schemas use — `type`,
// `enum`, `required`, `properties` and `*idNNN` aliases of a `type:` block — and throws on anything else.

export const INTAKE_CONTRACT = path.resolve(
  __dirname,
  '../../../../docs/G-integration/contracts/intake.openapi.yaml',
);

const indentOf = (line: string): number => line.length - line.trimStart().length;

interface Prop {
  type: string;
  enum?: string[];
}

function aliasType(lines: string[], alias: string): Prop {
  const at = lines.findIndex((l) => l.trimEnd().endsWith(`&${alias}`));
  if (at < 0) throw new Error(`contract: anchor &${alias} not found`);
  const own = indentOf(lines[at] ?? '');
  for (let i = at + 1; i < lines.length && indentOf(lines[i] ?? '') > own; i += 1) {
    const m = /^\s*type:\s*(\w+)\s*$/.exec(lines[i] ?? '');
    if (m?.[1]) return { type: m[1] };
  }
  throw new Error(`contract: anchor &${alias} has no type`);
}

/** The flat object schema `name` under components.schemas, as properties + required. */
export function readContractSchema(
  name: string,
  file = INTAKE_CONTRACT,
): { properties: Record<string, Prop>; required: string[] } {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l === `    ${name}:`);
  if (start < 0) throw new Error(`contract: schema ${name} not found`);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i] ?? '';
    if (l.trim() === '') continue;
    if (indentOf(l) <= 4) break;
    block.push(l);
  }
  const properties: Record<string, Prop> = {};
  const required: string[] = [];
  let section: 'properties' | 'required' | null = null;
  let current: string | null = null;
  let inEnum = false;
  for (const l of block) {
    const ind = indentOf(l);
    const t = l.trim();
    if (ind === 6) {
      inEnum = false;
      current = null;
      if (t === 'type: object') continue;
      if (t === 'properties:') section = 'properties';
      else if (t === 'required:') section = 'required';
      else throw new Error(`contract: ${name}: unsupported "${t}"`);
    } else if (section === 'required' && t.startsWith('- ')) {
      required.push(t.slice(2).trim());
    } else if (section === 'properties' && ind === 8) {
      inEnum = false;
      const m = /^(\w+):\s*(\*(\w+))?$/.exec(t);
      if (!m?.[1]) throw new Error(`contract: ${name}: unsupported "${t}"`);
      current = m[1];
      if (m[3]) properties[current] = aliasType(lines, m[3]);
    } else if (section === 'properties' && current && ind === 10) {
      const typeMatch = /^type:\s*(\w+)$/.exec(t);
      if (typeMatch?.[1]) properties[current] = { ...properties[current], type: typeMatch[1] };
      else if (t === 'enum:') inEnum = true;
      else if (inEnum && t.startsWith('- ')) {
        const p = properties[current] ?? { type: 'string' };
        properties[current] = { ...p, enum: [...(p.enum ?? []), t.slice(2).trim()] };
      } else throw new Error(`contract: ${name}.${current}: unsupported "${t}"`);
    } else if (section === 'properties' && current && inEnum && ind > 10 && t.startsWith('- ')) {
      const p = properties[current] ?? { type: 'string' };
      properties[current] = { ...p, enum: [...(p.enum ?? []), t.slice(2).trim()] };
    } else throw new Error(`contract: ${name}: unsupported line "${t}"`);
  }
  return { properties, required };
}

/** Strict: a field the contract does not list fails, like a wrong type or an enum value outside the list. */
export function contractValidator(name: string): z.ZodType {
  const { properties, required } = readContractSchema(name);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, p] of Object.entries(properties)) {
    let s: z.ZodType;
    if (p.enum) s = z.enum(p.enum as [string, ...string[]]);
    else if (p.type === 'string') s = z.string();
    else if (p.type === 'boolean') s = z.boolean();
    else if (p.type === 'integer') s = z.number().int();
    else if (p.type === 'number') s = z.number();
    else throw new Error(`contract: ${name}.${key}: type ${p.type} not supported`);
    shape[key] = required.includes(key) ? s : s.optional();
  }
  return z.object(shape).strict();
}
