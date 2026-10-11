import { loadEnvOrExit } from './lib/env';

loadEnvOrExit('worker');

// BullMQ processors (outbox publisher, webhooks, exports) arrive in later phases.
console.log('worker started (no processors registered yet)');
