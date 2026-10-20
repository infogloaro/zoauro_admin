import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  GatewayError,
  type GatewayOrder,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type GatewayRefund,
  type GatewayRefundStatus,
  type PaymentGateway,
} from './gateway';

// Razorpay adapter (D6) over plain HTTPS: basic auth with the key id and secret, JSON bodies. No SDK (agreed with the
// coordinator, doc 32). Keys come from the environment only (PAYMENT_KEY_ID, PAYMENT_KEY_SECRET,
// PAYMENT_WEBHOOK_SECRET) and are never logged; errors carry the status and Razorpay's error code, not the body.

const BASE_URL = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;

/** `X-Razorpay-Signature` = hex HMAC-SHA256 of the raw body with the webhook secret. */
export function razorpaySignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyRazorpaySignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(razorpaySignature(rawBody, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface RzOrder {
  id: string;
  amount: number;
  receipt: string;
}
interface RzPayment {
  id: string;
  order_id: string | null;
  amount: number;
  status: GatewayPaymentStatus;
  method: string | null;
  amount_refunded: number;
}
interface RzRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: GatewayRefundStatus;
}

const toPayment = (p: RzPayment): GatewayPayment => ({
  id: p.id,
  orderId: p.order_id,
  amountPaise: p.amount,
  status: p.status,
  method: p.method,
  amountRefundedPaise: p.amount_refunded,
});
const toRefund = (r: RzRefund): GatewayRefund => ({
  id: r.id,
  paymentId: r.payment_id,
  amountPaise: r.amount,
  status: r.status,
});

export function createRazorpayGateway(config: {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetch?: Fetch;
  baseUrl?: string;
}): PaymentGateway {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl ?? BASE_URL;
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: auth,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new GatewayError(
        `Razorpay unreachable (${err instanceof Error ? err.name : 'unknown'})`,
        true,
      );
    }
    if (!res.ok) {
      let code = 'unknown';
      try {
        const parsed = (await res.json()) as { error?: { code?: string } };
        code = parsed.error?.code ?? code;
      } catch {
        // no JSON body
      }
      throw new GatewayError(
        `Razorpay ${method} ${path.split('/')[1] ?? ''} failed: ${res.status} ${code}`,
        res.status >= 500 || res.status === 429,
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  return {
    provider: 'razorpay',
    async createOrder(input): Promise<GatewayOrder> {
      const o = await call<RzOrder>('POST', '/orders', {
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt.slice(0, 40),
        ...(input.notes ? { notes: input.notes } : {}),
      });
      return { id: o.id, amountPaise: o.amount, receipt: o.receipt };
    },
    async fetchPayment(paymentId) {
      return toPayment(await call<RzPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`));
    },
    async createRefund(input) {
      return toRefund(
        await call<RzRefund>('POST', `/payments/${encodeURIComponent(input.paymentId)}/refund`, {
          amount: input.amountPaise,
          speed: 'normal',
          receipt: input.receipt.slice(0, 40),
          ...(input.notes ? { notes: input.notes } : {}),
        }),
      );
    },
    async fetchRefund(refundId) {
      return toRefund(await call<RzRefund>('GET', `/refunds/${encodeURIComponent(refundId)}`));
    },
    verifyWebhook(rawBody, signature) {
      return verifyRazorpaySignature(rawBody, signature, config.webhookSecret);
    },
  };
}
