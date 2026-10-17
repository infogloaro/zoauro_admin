import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Zone } from '@zoauro/shared';
import { ZonesTable } from './zones-table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-admin/zones',
}));

const zone: Zone = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chennai',
  code: 'MAA',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincodeFrom: '600001',
  pincodeTo: '600119',
  deliveryCharge: 4900,
  status: 'ACTIVE',
  description: null,
  colorHex: '#2F6BFF',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('ZonesTable', () => {
  it('renders zone name, colour dot, city/state, status badge', () => {
    const html = renderToStaticMarkup(
      <ZonesTable zones={[zone]} sort="-createdAt" onSort={() => {}} onAction={() => {}} />,
    );
    expect(html).toContain('Chennai');
    expect(html).toContain('Tamil Nadu');
    expect(html).toContain('Active');
    expect(html).toContain(zone.colorHex);
    expect(html).toContain('MAA');
  });

  it('shows pending placeholders for F1.1 operational columns', () => {
    const html = renderToStaticMarkup(
      <ZonesTable zones={[zone]} sort="-createdAt" onSort={() => {}} onAction={() => {}} />,
    );
    expect(html).toContain('—');
    expect(html).toContain('Operational counts arrive with F1.1');
  });

  it('renders per-row accessible action buttons', () => {
    const html = renderToStaticMarkup(
      <ZonesTable zones={[zone]} sort="-createdAt" onSort={() => {}} onAction={() => {}} />,
    );
    expect(html).toContain('Edit Chennai');
    expect(html).toContain('More actions for Chennai');
  });
});
