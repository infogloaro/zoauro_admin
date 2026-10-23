import { describe, expect, it } from 'vitest';
import {
  MENU_IMPORT_MAX_ROWS,
  buildMenuImportReport,
  menuItemImportSchema,
  parseMenuImportCsv,
  sanitizeImportText,
  validateMenuImportRows,
} from './menu-import';

const HEADER = 'zone,provider,type,name,description,category,price,dietary';

describe('sanitizeImportText (doc 13 T16)', () => {
  it('prefixes a formula head with a quote', () => {
    expect(sanitizeImportText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(sanitizeImportText('+91 98765')).toBe("'+91 98765");
    expect(sanitizeImportText('-danger')).toBe("'-danger");
    expect(sanitizeImportText('@import')).toBe("'@import");
  });

  it('leaves ordinary text alone and trims edges', () => {
    expect(sanitizeImportText('  Masala Dosa  ')).toBe('Masala Dosa');
    expect(sanitizeImportText('50% off')).toBe('50% off');
  });
});

describe('parseMenuImportCsv', () => {
  it('parses a header plus rows with CRLF, quotes and a BOM', () => {
    const csv = `\uFEFF${HEADER}\r\nChennai,"Spice, Route",restaurant,"Dosa, crisp",Nice breakfast,Breakfast,120,VEGETARIAN\r\n`;
    const result = parseMenuImportCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.row).toBe(1);
    expect(result.rows[0]?.values).toEqual({
      zone: 'Chennai',
      provider: 'Spice, Route',
      type: 'restaurant',
      name: 'Dosa, crisp',
      description: 'Nice breakfast',
      category: 'Breakfast',
      price: '120',
      dietary: 'VEGETARIAN',
    });
  });

  it('handles "" escapes, blank trailing lines and extra columns', () => {
    const csv = `${HEADER},notes\nChennai,TK,restaurant,"Say ""hi""",,Main,90,egg,ignore-me\n\n`;
    const result = parseMenuImportCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.values.name).toBe('Say "hi"');
    expect(result.rows[0]?.values.description).toBe('');
  });

  it('rejects a file without a header, with missing columns or an open quote', () => {
    expect(parseMenuImportCsv('')).toEqual({ ok: false, issue: 'The file is empty' });
    const missing = parseMenuImportCsv('name,price\nDosa,90\n');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issue).toContain('Missing required column(s)');
    const open = parseMenuImportCsv(`${HEADER}\nChennai,TK,restaurant,"Dosa,90,VEGETARIAN\n`);
    expect(open).toEqual({ ok: false, issue: 'A quoted value is not closed' });
  });

  it('enforces the row cap', () => {
    const dataRow = 'Chennai,TK,restaurant,Dosa,Breakfast,90,VEGETARIAN';
    const csv = [HEADER, ...Array.from({ length: MENU_IMPORT_MAX_ROWS + 1 }, () => dataRow)].join(
      '\n',
    );
    const result = parseMenuImportCsv(csv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toContain('Too many rows');
  });
});

describe('validateMenuImportRows', () => {
  const good: Record<string, string> = {
    zone: 'Chennai',
    provider: 'TK Kitchen',
    type: 'Restaurant',
    name: 'Masala Dosa',
    description: 'Crisp dosa',
    category: 'Breakfast',
    price: '120',
    dietary: 'Vegetarian',
  };

  it('accepts the documented aliases and converts rupees to paise', () => {
    const { valid, errors } = validateMenuImportRows([{ row: 1, values: good }]);
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({
      type: 'restaurant',
      dietary: 'VEGETARIAN',
      price: 12_000,
      description: 'Crisp dosa',
      category: 'Breakfast',
    });
  });

  it('neutralises a hostile formula name before it validates', () => {
    const { valid, errors } = validateMenuImportRows([
      { row: 1, values: { ...good, name: '=SUM(A1)' } },
    ]);
    expect(errors).toEqual([]);
    expect(valid[0]?.name).toBe("'=SUM(A1)");
  });

  it('reports every bad field with its row number and keeps the good rows', () => {
    const { valid, errors } = validateMenuImportRows([
      { row: 1, values: { ...good, price: '12.5', dietary: 'Vegan', name: 'X' } },
      { row: 2, values: { ...good, zone: '', provider: '  ', type: 'cloud' } },
      { row: 3, values: good },
    ]);
    expect(valid.map((v) => v.row)).toEqual([3]);
    expect(new Set(errors.map((e) => e.row))).toEqual(new Set([1, 2]));
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['name', 'price', 'dietary', 'zone', 'provider', 'type']),
    );
  });

  it('bounds the optional text fields', () => {
    const { errors } = validateMenuImportRows([
      {
        row: 1,
        values: {
          ...good,
          name: 'x',
          description: 'd'.repeat(301),
          category: 'c'.repeat(61),
        },
      },
    ]);
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['name', 'description', 'category']),
    );
  });
});

describe('menuItemImportSchema + buildMenuImportReport', () => {
  it('accepts csv + dryRun and rejects an empty body', () => {
    expect(menuItemImportSchema.safeParse({ csv: `${HEADER}\n`, dryRun: true }).success).toBe(true);
    expect(menuItemImportSchema.safeParse({ csv: '', dryRun: true }).success).toBe(false);
    expect(menuItemImportSchema.safeParse({ csv: 'x', dryRun: 'yes' }).success).toBe(false);
  });

  it('counts invalid rows distinctly even with several errors each', () => {
    const report = buildMenuImportReport({
      dryRun: true,
      total: 3,
      errors: [
        { row: 1, field: 'price', issue: 'bad' },
        { row: 1, field: 'dietary', issue: 'bad' },
        { row: 2, field: 'zone', issue: 'bad' },
      ],
      duplicates: 1,
      created: 0,
      validRows: 2,
    });
    expect(report).toMatchObject({
      dryRun: true,
      total: 3,
      valid: 2,
      invalid: 2,
      duplicates: 1,
      created: 0,
    });
    expect(report.errors).toHaveLength(3);
  });
});
