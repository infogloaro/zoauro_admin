import type { MenuApprovalStatus } from '@zoauro/shared';

/**
 * Tab ⇄ status mapping for the Menu & Food Items screen (doc 20 tabs, doc 10
 * §4 approval statuses). Each item tab pins the list to exactly one approval
 * status; "All Food Items" carries no status of its own, and the toolbar
 * status dropdown stays in sync with the active tab (picking a status moves
 * to its tab, "All statuses" returns to All Food Items). Pure so the screen
 * stays declarative and the mapping is unit-tested.
 */
export const MENU_TAB_IDS = [
  'menus',
  'allItems',
  'pendingItems',
  'approvedItems',
  'rejectedItems',
  'archivedItems',
  'changeRequests',
] as const;
export type MenuTabId = (typeof MENU_TAB_IDS)[number];

export const MENU_TABS: ReadonlyArray<{ id: MenuTabId; label: string }> = [
  { id: 'menus', label: 'All Menus' },
  { id: 'allItems', label: 'All Food Items' },
  { id: 'pendingItems', label: 'Pending Approvals' },
  { id: 'approvedItems', label: 'Approved Items' },
  { id: 'rejectedItems', label: 'Rejected Items' },
  { id: 'archivedItems', label: 'Archived Items' },
  { id: 'changeRequests', label: 'Change requests' },
];

/** Approval status each item tab shows; `menus`/`allItems` pin none. */
export const MENU_TAB_STATUS: Partial<Record<MenuTabId, MenuApprovalStatus>> = {
  pendingItems: 'PENDING',
  approvedItems: 'APPROVED',
  rejectedItems: 'REJECTED',
  archivedItems: 'ARCHIVED',
};

const STATUS_TAB: Record<MenuApprovalStatus, MenuTabId> = {
  PENDING: 'pendingItems',
  APPROVED: 'approvedItems',
  REJECTED: 'rejectedItems',
  ARCHIVED: 'archivedItems',
};

/** Unknown deep-link values collapse to All Food Items, never a dead state. */
export function normalizeMenuTab(value: string | null | undefined): MenuTabId {
  return (MENU_TAB_IDS as readonly string[]).includes(value ?? '')
    ? (value as MenuTabId)
    : 'allItems';
}

/**
 * The status the list request must carry: the active tab wins, so switching
 * tabs always changes the dataset and All Food Items never inherits a stale
 * status filter from a previous tab.
 */
export function menuTabStatus(tab: MenuTabId, toolbarStatus: string): string {
  const pinned = MENU_TAB_STATUS[tab];
  if (pinned) return pinned;
  return tab === 'allItems' ? toolbarStatus : '';
}

/** The tab a toolbar status selection should activate ('' → All Food Items). */
export function menuTabForStatus(status: string): MenuTabId {
  return status && status in STATUS_TAB ? STATUS_TAB[status as MenuApprovalStatus] : 'allItems';
}
