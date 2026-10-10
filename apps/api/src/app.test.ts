import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('health endpoints', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/ready returns ok', async () => {
    const res = await request(createApp()).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
