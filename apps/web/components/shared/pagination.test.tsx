// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination, pageCount, pageFromParam } from './Pagination';

// Page-based list footer (doc 20: 25 rows per page): the count, the page, Previous / Next within bounds.

afterEach(cleanup);

describe('Pagination', () => {
  it('pages and the ?page parameter', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageFromParam(null)).toBe(1);
    expect(pageFromParam('3')).toBe(3);
    expect(pageFromParam('0')).toBe(1);
    expect(pageFromParam('2.5')).toBe(1);
    expect(pageFromParam('abc')).toBe(1);
  });

  it('shows the total in Indian grouping and moves within bounds', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<Pagination page={1} total={1250} noun={['vendor', 'vendors']} onPage={onPage} />);
    expect(screen.getByText('1,250 vendors · page 1 of 50')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('one item, one page: nothing to move to', () => {
    render(<Pagination page={1} total={1} noun={['vendor', 'vendors']} onPage={() => undefined} />);
    expect(screen.getByText('1 vendor · page 1 of 1')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
