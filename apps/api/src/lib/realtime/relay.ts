import { Redis } from 'ioredis';
import { realtimeMessagesOf, type RealtimeMessage } from './events';

// Worker -> API: the outbox publisher runs in the worker, the sockets live in the API process. Published rows are
// mapped to realtime messages and sent over one Redis pub/sub channel; every API instance delivers what its own
// sockets may see. Fire-and-forget by design: a missed message is covered by the 15 s polling fallback (doc 06).

export const REALTIME_CHANNEL = 'zoauro:realtime:v1';

interface Publisher {
  publish(channel: string, message: string): Promise<number>;
}

/** An outbox PublishedListener for the worker. */
export function realtimeRelay(redis: Publisher) {
  return async (
    rows: readonly { eventType: string; zoneId: string | null; payload: unknown }[],
  ) => {
    const messages = rows.flatMap(realtimeMessagesOf);
    if (messages.length > 0) await redis.publish(REALTIME_CHANNEL, JSON.stringify(messages));
  };
}

function isMessage(v: unknown): v is RealtimeMessage {
  if (v === null || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (m['kind'] === 'scope') return typeof m['userId'] === 'string';
  return (
    m['kind'] === 'zone' &&
    typeof m['zoneId'] === 'string' &&
    typeof m['module'] === 'string' &&
    typeof m['event'] === 'string' &&
    typeof m['payload'] === 'object'
  );
}

/** API side: its own subscriber connection (a subscribed ioredis client can run no other command). */
export async function subscribeRealtime(
  redisUrl: string,
  onMessages: (messages: RealtimeMessage[]) => void,
): Promise<{ close(): Promise<void> }> {
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
  sub.on('error', () => undefined); // reconnects on its own; clients poll meanwhile
  sub.on('message', (channel, raw) => {
    if (channel !== REALTIME_CHANNEL) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) onMessages(parsed.filter(isMessage));
    } catch {
      // not ours or malformed: ignored
    }
  });
  await sub.subscribe(REALTIME_CHANNEL);
  return {
    close: async () => {
      await sub.quit();
    },
  };
}
