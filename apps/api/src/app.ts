import express, { type Express } from 'express';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  // Parse JSON request bodies.
  app.use(express.json({ limit: '1mb' }));

  // Liveness: process is up.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: placeholder until DB and Redis exist (F0.4 / F1.1).
  app.get('/api/ready', (_req, res) => {
    res.json({ status: 'ok', checks: {} });
  });

  return app;
}
