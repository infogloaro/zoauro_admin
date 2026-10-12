import { Router, type RequestHandler } from 'express';
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

describe('trust proxy (TRUST_PROXY_HOPS)', () => {
  const pass: RequestHandler = (_req, _res, next) => next();
  const ipApp = (trustProxyHops?: number) => {
    const router = Router();
    router.get('/_t/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    return createApp({
      readiness: { database: up, redis: up },
      ...(trustProxyHops === undefined ? {} : { trustProxyHops }),
      v1: { sessionMiddleware: pass, authContextMiddleware: pass, routers: [router] },
    });
  };
  const ipOf = async (app: ReturnType<typeof ipApp>, forwardedFor?: string) => {
    const r = request(app).get('/api/v1/_t/ip');
    if (forwardedFor !== undefined) r.set('X-Forwarded-For', forwardedFor);
    return ((await r).body as { ip: string }).ip;
  };
  const isLoopback = (ip: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

  it('hops = 1: req.ip is the address the proxy forwarded', async () => {
    expect(await ipOf(ipApp(1), '203.0.113.7')).toBe('203.0.113.7');
  });

  it('hops = 1: only the hop next to the proxy is trusted, a client-made prefix is ignored', async () => {
    expect(await ipOf(ipApp(1), '198.51.100.9, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('hops = 0: X-Forwarded-For is ignored and req.ip is the socket address', async () => {
    const ip = await ipOf(ipApp(0), '203.0.113.7');
    expect(ip).not.toBe('203.0.113.7');
    expect(isLoopback(ip), ip).toBe(true);
  });

  it('the default is 0', async () => {
    expect(isLoopback(await ipOf(ipApp(), '203.0.113.7'))).toBe(true);
  });
});
