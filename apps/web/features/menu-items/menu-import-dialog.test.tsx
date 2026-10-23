import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MenuImportReport } from '@zoauro/shared';
import { describeImportReport, MENU_IMPORT_COLUMNS } from './menu-import-dialog';
import { MenuItemsToolbar } from './menu-items-toolbar';

const dryRunReport: MenuImportReport = {
  dryRun: true,
  total: 5,
  valid: 4,
  invalid: 1,
  duplicates: 0,
  created: 0,
  errors: [{ row: 3, field: 'price', issue: 'Price must be a whole number of rupees' }],
};

const finalReport: MenuImportReport = {
  dryRun: false,
  total: 4,
  valid: 3,
  invalid: 1,
  duplicates: 1,
  created: 2,
  errors: [{ row: 4, field: 'provider', issue: 'No restaurant named "Ghost" in zone "A"' }],
};

describe('describeImportReport', () => {
  it('summarises a dry run with importable / fixing / duplicate counts', () => {
    expect(describeImportReport(dryRunReport)).toBe(
      'Dry run: 4 of 5 rows will be imported, 1 need fixing, 0 already on the menu.',
    );
  });

  it('counts duplicates as not importable in a dry run', () => {
    expect(describeImportReport({ ...dryRunReport, valid: 4, duplicates: 3 })).toBe(
      'Dry run: 1 of 5 rows will be imported, 1 need fixing, 3 already on the menu.',
    );
  });

  it('summarises the final import with created / duplicate / error counts', () => {
    expect(describeImportReport(finalReport)).toBe(
      '2 items imported, 1 skipped as duplicates, 1 rows with errors.',
    );
  });
});

describe('MENU_IMPORT_COLUMNS', () => {
  it('lists every required CSV header in order', () => {
    expect(MENU_IMPORT_COLUMNS.replace(/ /g, '').split(',')).toEqual([
      'zone',
      'provider',
      'type',
      'name',
      'description',
      'category',
      'price',
      'dietary',
    ]);
  });
});

describe('MenuItemsToolbar Import button (Figma doc 37 row 12)', () => {
  const base = {
    value: {
      q: '',
      status: '',
      zoneId: '',
      vendorType: '',
      dietary: '',
      category: '',
      availability: '',
      featured: '',
    },
    zones: [],
    categories: [],
    onChange: () => {},
    onExport: () => {},
  };

  it('renders an Import button with an accessible name when onImport is given', () => {
    const html = renderToStaticMarkup(<MenuItemsToolbar {...base} onImport={() => {}} />);
    expect(html).toContain('aria-label="Import CSV"');
    expect(html).toContain('Import');
  });

  it('omits the Import button when the handler is absent', () => {
    const html = renderToStaticMarkup(<MenuItemsToolbar {...base} />);
    expect(html).not.toContain('aria-label="Import CSV"');
  });
});
