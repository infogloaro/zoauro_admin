import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const up = async (): Promise<void> => undefined;
const down = async (): Promise<void> => {
  throw new Error('connect ECONNREFUSED secret-host:5432');
};

describe('health endpoints', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(createApp({ readiness: { database: up, redis: up } })).get(
      '/api/health',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/ready returns ok when database and redis are reachable', async () => {
    const res = await request(createApp({ readiness: { database: up, redis: up } })).get(
      '/api/ready',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('GET /api/ready returns 503 and hides error details when a dependency is down', async () => {
    const res = await request(createApp({ readiness: { database: up, redis: down } })).get(
      '/api/ready',
    );
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'ok', redis: 'down' } });
    expect(JSON.stringify(res.body)).not.toContain('secret-host');
  });
});
