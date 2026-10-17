import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pagination, pageWindow, totalPagesFor } from './pagination';

const noop = () => {};

const restaurants = { one: 'restaurant', many: 'restaurants' };
const zones = { one: 'zone', many: 'zones' };

describe('totalPagesFor', () => {
  it('always returns at least one page', () => {
    expect(totalPagesFor(0, 6)).toBe(1);
    expect(totalPagesFor(1, 6)).toBe(1);
    expect(totalPagesFor(18, 6)).toBe(3);
    expect(totalPagesFor(19, 6)).toBe(4);
  });
});

describe('pageWindow', () => {
  it('lists every page when the total is small (≤7)', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('compacts large ranges around the current page with gaps', () => {
    expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, 'gap', 10]);
    expect(pageWindow(10, 10)).toEqual([1, 'gap', 9, 10]);
  });
});

describe('Pagination', () => {
  it('shows six-record ranges with the entity name', () => {
    const pageOne = renderToStaticMarkup(
      <Pagination page={1} pageSize={6} total={18} entity={restaurants} onPage={noop} />,
    );
    expect(pageOne).toContain('Showing 1–6 of 18 restaurants');

    const pageTwo = renderToStaticMarkup(
      <Pagination page={2} pageSize={6} total={18} entity={restaurants} onPage={noop} />,
    );
    expect(pageTwo).toContain('Showing 7–12 of 18 restaurants');

    const pageThree = renderToStaticMarkup(
      <Pagination page={3} pageSize={6} total={18} entity={restaurants} onPage={noop} />,
    );
    expect(pageThree).toContain('Showing 13–18 of 18 restaurants');
  });

  it('uses the singular entity for a single record and handles empty lists', () => {
    expect(
      renderToStaticMarkup(
        <Pagination page={1} pageSize={6} total={1} entity={zones} onPage={noop} />,
      ),
    ).toContain('Showing 1–1 of 1 zone');

    const empty = renderToStaticMarkup(
      <Pagination page={1} pageSize={6} total={0} entity={zones} onPage={noop} />,
    );
    expect(empty).toContain('Showing 0–0 of 0 zones');
    expect(empty).toContain('disabled=""');
  });

  it('folds page-1 leading rows (vendors reference rows) into the range', () => {
    const pageOne = renderToStaticMarkup(
      <Pagination
        page={1}
        pageSize={6}
        total={12}
        entity={restaurants}
        leadingCount={6}
        onPage={noop}
      />,
    );
    expect(pageOne).toContain('Showing 1–12 of 18 restaurants');

    const pageTwo = renderToStaticMarkup(
      <Pagination
        page={2}
        pageSize={6}
        total={12}
        entity={restaurants}
        leadingCount={6}
        onPage={noop}
      />,
    );
    expect(pageTwo).toContain('Showing 13–18 of 18 restaurants');
  });

  it('disables prev on page 1, next on the last page, and marks the current page', () => {
    const first = renderToStaticMarkup(
      <Pagination page={1} pageSize={6} total={18} entity={restaurants} onPage={noop} />,
    );
    expect(first).toContain('disabled=""');
    expect(first).toContain('aria-current="page"');

    const last = renderToStaticMarkup(
      <Pagination page={3} pageSize={6} total={18} entity={restaurants} onPage={noop} />,
    );
    expect(last).toContain('aria-current="page"');
    expect(last.match(/disabled=""/g)?.length).toBe(1);
  });

  it('renders an ellipsis for compacted ranges', () => {
    const html = renderToStaticMarkup(
      <Pagination page={5} pageSize={6} total={60} entity={restaurants} onPage={noop} />,
    );
    expect(html).toContain('…');
    expect(html).toContain('aria-label="Page 1"');
    expect(html).toContain('aria-label="Page 10"');
  });
});
