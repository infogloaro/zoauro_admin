import type { DemoClient } from './client';
import { DemoHttpError } from './client';

// Step: Control Panel values the demo shows as "dynamic" (D144: every business value is a setting with a default):
// reward points switched on (with a zone override), two orders per partner, tighter refund caps in one zone, and the
// commission-edit switch for Zonal Admins. Each save goes through the real settings route (re-authenticated, audited).

type Log = (m: string) => void;

async function save(
  sa: DemoClient,
  path: string,
  values: Record<string, unknown>,
  reason: string,
  log: Log,
): Promise<void> {
  try {
    await sa.put(path, { values, reason });
    log(`${path}: ${Object.keys(values).join(', ')}`);
  } catch (e) {
    log(
      `${path} skipped: ${e instanceof DemoHttpError ? `${e.status} ${e.code ?? ''} ${JSON.stringify(e.body).slice(0, 160)}` : 'error'}`,
    );
  }
}

export async function seedSettings(
  sa: DemoClient,
  zoneId: Record<string, string>,
  log: Log,
): Promise<void> {
  await save(
    sa,
    '/settings/loyalty',
    {
      'loyalty.values': {
        earnRatePercent: 5,
        pointsExpiryDays: 365,
        pointValuePaise: 100,
        minRedeemPoints: 100,
        maxRedeemPercentPerOrder: 20,
        monthlyEarnCapPoints: 2000,
        walletConversionEnabled: true,
      },
    },
    'Launch reward points for the pilot: 5% back, 1 point = ₹1',
    log,
  );
  await save(
    sa,
    `/zones/${zoneId['CBN']}/settings/loyalty`,
    {
      'loyalty.values': {
        earnRatePercent: 3,
        pointsExpiryDays: 180,
        pointValuePaise: 100,
        minRedeemPoints: 200,
        maxRedeemPercentPerOrder: 10,
        monthlyEarnCapPoints: 1000,
        walletConversionEnabled: false,
      },
    },
    'Coimbatore North launches with a smaller reward programme',
    log,
  );
  await save(
    sa,
    '/settings/orders',
    { 'delivery.maxConcurrentOrders': { perPartner: 2 } },
    'Lunch peak: let partners batch two nearby orders',
    log,
  );
  await save(
    sa,
    `/zones/${zoneId['CBE']}/settings/orders`,
    { 'delivery.maxConcurrentOrders': { perPartner: 3 } },
    'Coimbatore Central is dense enough for three orders per ride',
    log,
  );
  await save(
    sa,
    `/zones/${zoneId['TUP']}/settings/refunds`,
    {
      'refunds.limits': {
        perRefundPaise: 50_000,
        perDayPaise: 200_000,
        secondApproverAbovePaise: 300_000,
      },
    },
    'New zone: smaller refund caps for the first quarter',
    log,
  );
  await save(
    sa,
    '/settings/access',
    { 'access.commissionEditGrantable': { enabled: true } },
    'Zone leads may be trusted with commission edits case by case',
    log,
  );
}
