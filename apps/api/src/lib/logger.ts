import pino from 'pino';
import { env } from './env';

/** Structured JSON logs (doc 07 §7). Never log passwords, tokens or OTP data. */
export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: 'zoauro-api' },
});
