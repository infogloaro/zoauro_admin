import type { AuthContext } from '../../lib/authz';
import type {
  OrderDetailRow,
  OrderForWrite,
  OrderHistoryRow,
  OrderListFilter,
  OrderRow,
  OrderStatusChange,
  OutboxRow,
} from './types';

/**
 * The orders repository contract. The service depends on this interface only; prisma-repository.ts is the real
 * implementation. Every method takes the AuthContext (AGENTS.md); zone checks on a single order are made by the service
 * once the order's zone is known, lists receive their zone scope in the filter.
 */
export interface OrderRepository {
  /** One page of orders inside `filter.scope`, newest first, and the total count. */
  list(ctx: AuthContext, filter: OrderListFilter): Promise<{ rows: OrderRow[]; total: number }>;

  /** The order with everything the detail screen shows; null when it does not exist. */
  findDetail(ctx: AuthContext, id: string): Promise<OrderDetailRow | null>;

  /** Inside a write transaction: the fields a status change checks. */
  findForWrite(ctx: AuthContext, id: string): Promise<OrderForWrite | null>;

  /** Applies the change only if the version still matches; returns false when another write won. */
  updateStatus(
    ctx: AuthContext,
    id: string,
    expectedVersion: number,
    change: OrderStatusChange,
  ): Promise<boolean>;

  addHistory(ctx: AuthContext, row: OrderHistoryRow): Promise<void>;

  insertOutbox(ctx: AuthContext, rows: readonly OutboxRow[]): Promise<void>;
}
