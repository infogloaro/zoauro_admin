// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, RowActivator, type Column } from './DataTable';

// Rows as links (QA): the row's opener is stretched over the row, so every other control in it must sit above that
// layer (app/globals.css, tr[data-row-link]), or "Decide" in the onboarding queue opens the vendor instead. jsdom has
// no layout: the stacking itself was checked in a browser; here the row marker and the rule are pinned.

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [{ id: 'r1', name: 'Thudiyalur Dosa Corner' }];
const columns: Column<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (r, ctx) => <RowActivator ctx={ctx}>{r.name}</RowActivator>,
  },
  { id: 'actions', header: 'Actions', cell: () => <button type="button">Decide</button> },
];

describe('DataTable rows as links', () => {
  it('a row that opens a record is marked; its own controls are not the opener', () => {
    render(
      <DataTable
        caption="Vendors"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onActivate={vi.fn()}
        rowHref={(r) => `/super-admin/restaurants/${r.id}`}
        status="ready"
        empty="None"
      />,
    );
    const open = screen.getByRole('link', { name: 'Thudiyalur Dosa Corner' });
    expect(open.closest('tr')?.hasAttribute('data-row-link')).toBe(true);
    expect(open.hasAttribute('data-row-activate')).toBe(true);
    expect(screen.getByRole('button', { name: 'Decide' }).hasAttribute('data-row-activate')).toBe(
      false,
    );
  });

  it('a row that opens nothing is not marked', () => {
    render(
      <DataTable
        caption="Vendors"
        columns={[columns[1] as Column<Row>]}
        rows={rows}
        getRowId={(r) => r.id}
        status="ready"
        empty="None"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Decide' }).closest('tr')?.hasAttribute('data-row-link'),
    ).toBe(false);
  });

  it('the stylesheet lifts the other controls of a marked row above the stretched opener', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain('tr[data-row-link] :is(');
    expect(css).toContain(':not([data-row-activate]) { position: relative; z-index: 1; }');
  });
});
