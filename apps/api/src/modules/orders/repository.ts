import type { ListOrdersInput } from './schemas';
import type { OrderDashboardSummary, OrderListItem, OrderStatus, PaginatedOrders } from './types';

export interface OrderRepository {
  list(filters: ListOrdersInput): Promise<PaginatedOrders>;

  getDashboard(from?: Date, to?: Date): Promise<OrderDashboardSummary>;

  findStatusById(id: string): Promise<{
    status: OrderStatus;
    version: number;
  } | null>;

  updateStatus(input: {
    id: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    expectedVersion: number;
    actorId: string;
  }): Promise<OrderListItem>;
}
