import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

// AU-6 against the real stack: 2,000,000 seeded audit rows, the real API and the production web build.
// The page must render in under 2 seconds and every filter must work (and answer in under 2 seconds) on that data.

interface State {
  password: string;
  superAdmin: { email: string };
  zonalAdmin: { email: string };
  rows: number;
}
const state = JSON.parse(readFileSync(process.env['E2E_STATE'] ?? '', 'utf8')) as State;
const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:3720';
const PATH = '/super-admin/settings/logs';
const BUDGET_MS = 2000;
// A failing test restarts the Playwright worker, so timings are appended to a file as they happen (run.ts empties it first).
const REPORT_DIR = path.resolve(__dirname, '../../../apps/api/test-reports');
const TIMINGS_FILE = path.join(REPORT_DIR, 'system-logs-e2e.jsonl');
const timings = {
  push(...items: { what: string; ms: number }[]): void {
    mkdirSync(REPORT_DIR, { recursive: true });
    for (const i of items) appendFileSync(TIMINGS_FILE, `${JSON.stringify(i)}\n`);
  },
};

// Signing in is rate limited (10 a minute per account), as in production, so each user signs in once and every test
// reuses that session cookie.
const cookieValues = new Map<string, string>();

async function signIn(
  context: BrowserContext,
  email: string,
  tab: 'SUPER_ADMIN' | 'ZONAL_ADMIN',
): Promise<void> {
  const known = cookieValues.get(email);
  if (known) {
    await context.addCookies([{ name: 'zoauro_session', value: known, url: BASE }]);
    return;
  }
  const res = await context.request.post('/api/v1/auth/login', {
    data: { email, password: state.password, tab },
    headers: { Origin: BASE },
  });
  expect(res.ok(), `login as ${email}: ${res.status()} ${(await res.text()).slice(0, 300)}`).toBe(
    true,
  );
  const header = res
    .headersArray()
    .find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('zoauro_session='));
  expect(header, 'session cookie').toBeTruthy();
  // the cookie is Secure; add it by URL so a plain-http localhost run sends it as a browser on https would
  const value = (header?.value ?? '').split(';')[0]!.slice('zoauro_session='.length);
  cookieValues.set(email, value);
  await context.addCookies([{ name: 'zoauro_session', value, url: BASE }]);
}

const table = (page: Page) => page.getByRole('table', { name: 'Activity log' });
const rowButtons = (page: Page) => table(page).getByRole('button', { name: /View details of/ });
/** Rows are on screen: the real table (not the skeleton) has activators. */
const rowsShown = async (page: Page) =>
  expect(rowButtons(page).first()).toBeVisible({ timeout: BUDGET_MS });

async function columnTexts(page: Page, header: string): Promise<string[]> {
  const headers = await table(page).getByRole('columnheader').allTextContents();
  const idx = headers.indexOf(header);
  expect(idx, `column ${header}`).toBeGreaterThanOrEqual(0);
  return table(page)
    .locator('tbody tr')
    .evaluateAll((trs, i) => trs.map((tr) => tr.children[i as number]?.textContent ?? ''), idx);
}

/** Runs an action and waits for the table to settle on what the predicate accepts, within the 2 s budget. */
async function measured(
  what: string,
  page: Page,
  action: () => Promise<unknown>,
  settled: () => Promise<unknown>,
): Promise<void> {
  const t0 = Date.now();
  await action();
  await settled();
  const ms = Date.now() - t0;
  timings.push({ what, ms });
  expect(ms, `${what} took ${ms} ms`).toBeLessThan(BUDGET_MS);
}

test.afterAll(() => {
  if (!existsSync(TIMINGS_FILE)) return;
  const rows = readFileSync(TIMINGS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { what: string; ms: number });
  const lines = [
    '# System Logs end-to-end timings',
    '',
    `${state.rows.toLocaleString('en-IN')} seeded audit rows, production build, real Chromium. Budget ${BUDGET_MS} ms.`,
    '',
    '| Step | ms |',
    '|---|---|',
    ...rows.map((t) => `| ${t.what} | ${t.ms} |`),
  ];
  writeFileSync(path.join(REPORT_DIR, 'system-logs-e2e.md'), `${lines.join('\n')}\n`);
});

/** How long each API call the page makes takes (time to the last byte), so a slow load can be traced to its request. */
function trackApi(page: Page): void {
  page.on('requestfinished', async (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/v1/')) return;
    const t = req.timing();
    if (t.responseEnd < 0) return;
    timings.push({
      what: `api ${url.pathname.replace('/api/v1', '')}`,
      ms: Math.round(t.responseEnd),
    });
  });
}

test.describe('route guard (Super Admin only)', () => {
  test('no session: sent to sign in, with the page to come back to', async ({ page }) => {
    await page.goto(PATH);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe(PATH);
  });

  test('a Zonal Admin gets a 404 and nothing of the page', async ({ page, context }) => {
    await signIn(context, state.zonalAdmin.email, 'ZONAL_ADMIN');
    const res = await page.goto(PATH);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'System Logs' })).toHaveCount(0);
    await expect(page.getByText('Activity log')).toHaveCount(0);
  });

  test('the API refuses the same Zonal Admin the listing and the option endpoints', async ({
    context,
  }) => {
    await signIn(context, state.zonalAdmin.email, 'ZONAL_ADMIN');
    for (const p of [
      '/api/v1/audit-logs',
      '/api/v1/audit-logs/actors',
      '/api/v1/audit-logs/zones',
      '/api/v1/login-history',
    ])
      expect((await context.request.get(p)).status(), p).toBe(403);
  });
});

test.describe('System Logs on the seeded data', () => {
  test.beforeEach(async ({ context, page }) => {
    trackApi(page);
    await signIn(context, state.superAdmin.email, 'SUPER_ADMIN');
  });

  test('renders in under 2 seconds (5 loads, the first one cold)', async ({ page }) => {
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.goto('about:blank');
      const t0 = Date.now();
      await page.goto(PATH);
      await rowsShown(page);
      runs.push(Date.now() - t0);
    }
    timings.push(
      ...runs.map((ms, i) => ({ what: `page load ${i + 1}${i === 0 ? ' (cold)' : ''}`, ms })),
    );
    expect(Math.max(...runs), `loads took ${runs.join(', ')} ms`).toBeLessThan(BUDGET_MS);
    await expect(page.getByRole('heading', { name: 'System Logs' })).toBeVisible();
    expect(await rowButtons(page).count()).toBe(50);
  });

  test('the default view is the last 7 days, newest first, with no total', async ({ page }) => {
    await page.goto(PATH);
    await rowsShown(page);
    const times = await table(page)
      .locator('tbody time')
      .evaluateAll((els) => els.map((e) => new Date(e.getAttribute('datetime') ?? '').getTime()));
    expect(times.length).toBe(50);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeLessThanOrEqual(times[i - 1]!);
    expect(Date.now() - times[0]!).toBeLessThan(7 * 864e5);
    await expect(page.getByText(/\b2,00,000\b|\btotal\b/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /export/i })).toHaveCount(0);
  });

  test('every filter works on 2,000,000 rows, each in under 2 seconds', async ({ page }) => {
    await page.goto(PATH);
    await rowsShown(page);

    // module
    await measured(
      'filter: module = Refunds',
      page,
      () => page.getByLabel('Module').selectOption('refunds'),
      async () => {
        await expect
          .poll(
            async () =>
              (await columnTexts(page, 'Action')).length > 0 &&
              (await columnTexts(page, 'Action')).every((t) => t.endsWith('Refunds')),
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );

    // action (grouped by module; choosing it keeps its module)
    await measured(
      'filter: action = Requested refund',
      page,
      () => page.getByLabel('Action').selectOption('refund.requested'),
      async () => {
        await expect
          .poll(async () => (await columnTexts(page, 'Action')).length > 0, { timeout: BUDGET_MS })
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();
    await rowsShown(page);
    await expect(page).toHaveURL(new RegExp(`${PATH}$`));

    // zone
    await measured(
      'filter: zone = Zone 03',
      page,
      () => page.getByLabel('Zone').selectOption({ label: 'Zone 03' }),
      async () => {
        await expect
          .poll(
            async () => {
              const z = await columnTexts(page, 'Zone');
              return z.length > 0 && z.every((t) => t === 'Zone 03');
            },
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();

    // actor type: all seeded rows are by admins, none by the system
    await measured(
      'filter: actor type = Admin',
      page,
      () => page.getByLabel('Actor type').selectOption('USER'),
      async () => rowsShown(page),
    );
    await measured(
      'filter: actor type = System (no match)',
      page,
      () => page.getByLabel('Actor type').selectOption('SYSTEM'),
      async () => {
        await expect(page.getByText('No activity matches these filters.')).toBeVisible({
          timeout: BUDGET_MS,
        });
      },
    );
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await rowsShown(page);

    // actor typeahead
    const actor = page.getByRole('combobox', { name: 'Actor', exact: true });
    await actor.fill('Member 7');
    await page
      .getByRole('option', { name: /^Member 7\b/ })
      .first()
      .click();
    await measured(
      'filter: actor = Member 7 (typeahead)',
      page,
      async () => undefined,
      async () => {
        await expect
          .poll(
            async () => {
              const a = await columnTexts(page, 'Actor');
              return a.length > 0 && a.every((t) => t.includes('Member 7'));
            },
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();
    await rowsShown(page);

    // entity type
    await measured(
      'filter: entity type = payment',
      page,
      () => page.getByLabel('Entity type').fill('payment'),
      async () => {
        await expect
          .poll(
            async () => {
              const e = await columnTexts(page, 'Entity');
              return e.length > 0 && e.every((t) => t.endsWith('payment'));
            },
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();
    await rowsShown(page);

    // search (entity label / actor name prefix); includes the 300 ms the box waits after typing
    await measured(
      'filter: search = "Entity 123"',
      page,
      () => page.getByLabel('Search').fill('Entity 123'),
      async () => {
        await expect
          .poll(
            async () => {
              const e = await columnTexts(page, 'Entity');
              return e.length > 0 && e.every((t) => /^Entity 123/.test(t));
            },
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();
    await rowsShown(page);

    // outcome
    await measured(
      'filter: outcome = Denied (no match)',
      page,
      () => page.getByLabel('Outcome').selectOption('DENIED'),
      async () => {
        await expect(page.getByText('No activity matches these filters.')).toBeVisible({
          timeout: BUDGET_MS,
        });
      },
    );
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await rowsShown(page);
    await measured(
      'filter: outcome = Success',
      page,
      () => page.getByLabel('Outcome').selectOption('SUCCESS'),
      async () => rowsShown(page),
    );
    await page.getByRole('button', { name: 'Reset' }).click();

    // sensitive only
    await measured(
      'filter: Sensitive only',
      page,
      () => page.getByLabel('Sensitive only').check(),
      async () => {
        await expect
          .poll(
            async () => {
              const f = await columnTexts(page, 'Flags');
              return f.length > 0 && f.every((t) => t.includes('HIGH'));
            },
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();
    await rowsShown(page);

    // date range two and a half years back
    await measured(
      'filter: date range 2024-03-10 to 2024-03-12',
      page,
      async () => {
        await page.getByLabel('From').fill('2024-03-10');
        await page.getByLabel('To').fill('2024-03-12');
      },
      async () => {
        await expect
          .poll(
            async () => {
              const times = await table(page)
                .locator('tbody time')
                .evaluateAll((els) => els.map((e) => e.getAttribute('datetime') ?? ''));
              return (
                times.length > 0 &&
                times.every((t) => t >= '2024-03-09T18:30:00' && t <= '2024-03-12T18:30:00')
              );
            },
            { timeout: BUDGET_MS },
          )
          .toBe(true);
      },
    );
    await page.getByRole('button', { name: 'Reset' }).click();
    await rowsShown(page);

    // Reset really returned to the default view
    expect(new URL(page.url()).search).toBe('');
    expect(await rowButtons(page).count()).toBe(50);
  });

  test('filters survive a reload and a shared link (URL state)', async ({ page }) => {
    await page.goto(`${PATH}?module=refunds&sensitive=1`);
    await rowsShown(page);
    await expect(page.getByLabel('Module')).toHaveValue('refunds');
    await expect(page.getByLabel('Sensitive only')).toBeChecked();
    expect((await columnTexts(page, 'Action')).every((t) => t.endsWith('Refunds'))).toBe(true);
    await page.reload();
    await rowsShown(page);
    await expect(page.getByLabel('Module')).toHaveValue('refunds');
  });

  test('Load more appends the next 50 rows, shows no count, and rows do not repeat', async ({
    page,
  }) => {
    await page.goto(PATH);
    await rowsShown(page);
    const ids = async () =>
      rowButtons(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-row-activate')));
    const first = await ids();
    expect(first).toHaveLength(50);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect.poll(async () => (await ids()).length, { timeout: BUDGET_MS }).toBe(100);
    timings.push({ what: 'Load more (next 50)', ms: Date.now() - t0 });
    const all = await ids();
    expect(new Set(all).size).toBe(100);
    expect(all.slice(0, 50)).toEqual(first);
  });

  test('a row opens the drawer with the field changes and the request id; Escape returns focus to the row', async ({
    page,
  }) => {
    await page.goto(PATH);
    await rowsShown(page);
    const opener = rowButtons(page).first();
    await opener.focus();
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('table', { name: 'Field changes' })).toBeVisible({
      timeout: BUDGET_MS,
    });
    timings.push({ what: 'open the drawer', ms: Date.now() - t0 });
    await expect(dialog.getByText('Request ID')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy request ID' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'More from this actor' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('the related-log links are disabled and say why', async ({ page }) => {
    await page.goto(PATH);
    await rowsShown(page);
    for (const name of ['Access change history', 'Integration events']) {
      const link: Locator = page
        .getByRole('navigation', { name: 'Related logs' })
        .getByRole('link', { name });
      await expect(link).toHaveAttribute('aria-disabled', 'true');
      await link.focus();
      await expect(page.getByRole('tooltip')).toBeVisible();
    }
  });

  test('Sign-ins tab lists successful and failed attempts and filters by result', async ({
    page,
    context,
  }) => {
    // a failed attempt to look for
    const bad = await context.request.post('/api/v1/auth/login', {
      data: {
        email: state.superAdmin.email,
        password: 'definitely not the password',
        tab: 'SUPER_ADMIN',
      },
      headers: { Origin: BASE },
    });
    expect(bad.status()).toBe(401);

    const t0 = Date.now();
    await page.goto(`${PATH}?tab=signins`);
    const signins = page.getByRole('table', { name: 'Sign-in history' });
    await expect(signins.getByText('Successful').first()).toBeVisible({ timeout: BUDGET_MS });
    timings.push({ what: 'Sign-ins tab load', ms: Date.now() - t0 });
    await expect(signins.getByText('Failed').first()).toBeVisible();

    await page.getByLabel('Result').selectOption('false');
    await expect
      .poll(async () => await signins.getByText('Successful').count(), { timeout: BUDGET_MS })
      .toBe(0);
    await expect(signins.getByText('Failed').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();
    await page.getByRole('tab', { name: 'Activity' }).click();
    await rowsShown(page);
  });
});
