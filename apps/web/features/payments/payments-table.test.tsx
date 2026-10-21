import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Payment } from '@zoauro/shared';
import { PaymentsTable } from './payments-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/payments',
}));

const success: Payment = {
  id: 'a1000001-0000-4000-8000-000000000001',
  paymentRef: 'PAY-8F3K2M',
  orderRef: 'ORD-20418',
  customerName: 'Aarti Menon',
  method: 'UPI',
  amountPaise: 129_900,
  refundAmountPaise: 0,
  currency: 'INR',
  status: 'SUCCESS',
  demo: false,
  createdAt: '2026-08-14T05:20:00.000Z',
  updatedAt: '2026-08-14T05:20:00.000Z',
};

const partialRefund: Payment = {
  id: 'a2000002-0000-4000-8000-000000000002',
  paymentRef: 'PAY-9Q7X1N',
  orderRef: 'ORD-20419',
  customerName: 'Rahul Verma',
  method: 'CARD',
  amountPaise: 250_000,
  refundAmountPaise: 50_000,
  currency: 'INR',
  status: 'PARTIALLY_REFUNDED',
  demo: false,
  createdAt: '2026-09-01T11:45:00.000Z',
  updatedAt: '2026-09-28T07:05:00.000Z',
};

const noop = () => {};

describe('PaymentsTable', () => {
  it('renders the list columns for a real record with Indian-grouped money', () => {
    const html = renderToStaticMarkup(<PaymentsTable payments={[success]} onView={noop} />);
    expect(html).toContain('PAY-8F3K2M');
    expect(html).toContain('ORD-20418');
    expect(html).toContain('Aarti Menon');
    expect(html).toContain('UPI');
    expect(html).toContain('₹1,299');
    expect(html).toContain('14 Aug 2026');
    expect(html).toContain('title="View"');
  });

  it('maps status to the pill colours and shows the refunded sub-line', () => {
    const successHtml = renderToStaticMarkup(<PaymentsTable payments={[success]} onView={noop} />);
    expect(successHtml).toMatch(/bg-green-50 text-green-700">Success</);
    expect(successHtml).not.toContain('refunded');

    const partialHtml = renderToStaticMarkup(
      <PaymentsTable payments={[partialRefund]} onView={noop} />,
    );
    expect(partialHtml).toMatch(/bg-blue-50 text-blue-700">Partial refund</);
    expect(partialHtml).toContain('₹2,500');
    expect(partialHtml).toContain('₹500 refunded');
  });

  it('renders one row per payment', () => {
    const html = renderToStaticMarkup(
      <PaymentsTable payments={[success, partialRefund]} onView={noop} />,
    );
    expect(html).toContain('PAY-8F3K2M');
    expect(html).toContain('PAY-9Q7X1N');
  });
});
