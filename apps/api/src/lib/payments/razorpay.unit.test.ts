import { describe, expect, it } from 'vitest';
import { GatewayError } from './gateway';
import { createRazorpayGateway, razorpaySignature, verifyRazorpaySignature } from './razorpay';

const SECRET = 'test-webhook-secret';
const body = Buffer.from('{"event":"payment.captured","payload":{}}');

describe('Razorpay webhook signature (doc 16: verify against the raw body)', () => {
  it('accepts the right signature and refuses a wrong, missing, malformed or re-serialised one', () => {
    const sig = razorpaySignature(body, SECRET);
    expect(verifyRazorpaySignature(body, sig, SECRET)).toBe(true);
    expect(
      verifyRazorpaySignature(body, sig.replace(/.$/, sig.endsWith('0') ? '1' : '0'), SECRET),
    ).toBe(false);
    expect(verifyRazorpaySignature(body, undefined, SECRET)).toBe(false);
    expect(verifyRazorpaySignature(body, 'not-hex', SECRET)).toBe(false);
    // the same JSON with different whitespace is a different body
    expect(
      verifyRazorpaySignature(
        Buffer.from('{ "event": "payment.captured", "payload": {} }'),
        sig,
        SECRET,
      ),
    ).toBe(false);
    expect(verifyRazorpaySignature(body, sig, 'another-secret')).toBe(false);
  });
});

describe('Razorpay adapter over fetch', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (status: number, json: unknown): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  const gw = (f: typeof fetch) =>
    createRazorpayGateway({
      keyId: 'rzp_test_key',
      keySecret: 'sekret',
      webhookSecret: SECRET,
      fetch: f,
    });

  it('creates an order with basic auth and integer paise; refunds name our id in the receipt', async () => {
    calls.length = 0;
    const order = await gw(
      fakeFetch(200, { id: 'order_1', amount: 45_000, receipt: 'abc' }),
    ).createOrder({
      amountPaise: 45_000,
      receipt: 'abc',
    });
    expect(order).toEqual({ id: 'order_1', amountPaise: 45_000, receipt: 'abc' });
    expect(calls[0]?.url).toBe('https://api.razorpay.com/v1/orders');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_key:sekret').toString('base64')}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      amount: 45_000,
      currency: 'INR',
      receipt: 'abc',
    });

    const refund = await gw(
      fakeFetch(200, { id: 'rfnd_1', payment_id: 'pay_1', amount: 1_000, status: 'pending' }),
    ).createRefund({ paymentId: 'pay_1', amountPaise: 1_000, receipt: 'refund-uuid' });
    expect(refund).toEqual({
      id: 'rfnd_1',
      paymentId: 'pay_1',
      amountPaise: 1_000,
      status: 'pending',
    });
    expect(calls[1]?.url).toBe('https://api.razorpay.com/v1/payments/pay_1/refund');
  });

  it('a 5xx or 429 is retryable, a 4xx is not; the error never carries the secret', async () => {
    const e5 = await gw(fakeFetch(502, {}))
      .fetchPayment('pay_1')
      .catch((e: unknown) => e);
    expect(e5).toBeInstanceOf(GatewayError);
    expect((e5 as GatewayError).retryable).toBe(true);
    const e4 = await gw(fakeFetch(400, { error: { code: 'BAD_REQUEST_ERROR' } }))
      .createRefund({ paymentId: 'pay_1', amountPaise: 1, receipt: 'r' })
      .catch((e: unknown) => e);
    expect((e4 as GatewayError).retryable).toBe(false);
    expect((e4 as GatewayError).message).toContain('BAD_REQUEST_ERROR');
    expect((e4 as GatewayError).message).not.toContain('sekret');
  });
});
