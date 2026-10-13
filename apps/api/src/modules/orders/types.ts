import type { ListOrdersInput, OrderStatusInput } from './schemas';

export type { ListOrdersInput };
export type OrderStatus = OrderStatusInput;

export interface OrderActor {
  userId: string;
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  zoneIds?: readonly string[];
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  restaurantName: string;
  itemCount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  status: OrderStatus;
  createdAt: Date;
  version: number;
}

export interface PaginatedOrders {
  items: OrderListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface OrderDashboardSummary {
  totalOrders: number;
  pendingOrders: number;
  outForDeliveryOrders: number;
  deliveredOrders: number;
}
