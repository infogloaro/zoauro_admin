import { describe, expect, it } from 'vitest';
import {
  MENU_TABS,
  menuTabForStatus,
  menuTabStatus,
  normalizeMenuTab,
  type MenuTabId,
} from './tabs';

describe('normalizeMenuTab', () => {
  it('accepts every documented tab id', () => {
    for (const { id } of MENU_TABS) {
      expect(normalizeMenuTab(id)).toBe(id);
    }
  });

  it('collapses unknown or missing deep links to All Food Items', () => {
    expect(normalizeMenuTab(null)).toBe('allItems');
    expect(normalizeMenuTab('')).toBe('allItems');
    expect(normalizeMenuTab('nonsense')).toBe('allItems');
  });
});

describe('menuTabStatus — each tab shows a genuinely different dataset', () => {
  it('pins the four status tabs to distinct approval statuses', () => {
    const statuses = (
      ['pendingItems', 'approvedItems', 'rejectedItems', 'archivedItems'] as MenuTabId[]
    ).map((tab) => menuTabStatus(tab, ''));
    expect(statuses).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED']);
    expect(new Set(statuses).size).toBe(4);
  });

  it('gives All Food Items no status of its own', () => {
    expect(menuTabStatus('allItems', '')).toBe('');
  });

  it('never lets All Food Items inherit a previous status filter', () => {
    // The screen clears `?status=` on every tab change; if a stale value
    // survives anyway, the pinned-tab branch still wins and All Food Items
    // falls back to the explicit toolbar value only.
    expect(menuTabStatus('pendingItems', 'REJECTED')).toBe('PENDING');
    expect(menuTabStatus('allItems', '')).toBe('');
  });

  it('leaves the All Menus tab unfiltered (it shows the aggregate, not a status)', () => {
    expect(menuTabStatus('menus', 'APPROVED')).toBe('');
  });
});

describe('menuTabForStatus — the toolbar status select mirrors the tabs', () => {
  it('maps each approval status to its tab', () => {
    expect(menuTabForStatus('PENDING')).toBe('pendingItems');
    expect(menuTabForStatus('APPROVED')).toBe('approvedItems');
    expect(menuTabForStatus('REJECTED')).toBe('rejectedItems');
    expect(menuTabForStatus('ARCHIVED')).toBe('archivedItems');
  });

  it('maps "all statuses" and unknown values back to All Food Items', () => {
    expect(menuTabForStatus('')).toBe('allItems');
    expect(menuTabForStatus('NOT_A_STATUS')).toBe('allItems');
  });
});
