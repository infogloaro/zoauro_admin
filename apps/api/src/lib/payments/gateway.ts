// Payment gateway port (D6: Razorpay, behind an interface so tests use a fake; doc 16). Amounts are integer paise.
// The server never trusts the browser: a payment is confirmed only by a signed webhook plus a re-fetch from the
// gateway (doc 16 section 1).

export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
export type GatewayRefundStatus = 'pending' | 'processed' | 'failed';

export interface GatewayOrder {
  id: string;
  amountPaise: number;
  receipt: string;
}

export interface GatewayPayment {
  id: string;
  orderId: string | null;
  amountPaise: number;
  status: GatewayPaymentStatus;
  method: string | null;
  /** paise already refunded at the gateway */
  amountRefundedPaise: number;
}

export interface GatewayRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: GatewayRefundStatus;
}

export interface PaymentGateway {
  readonly provider: string;
  /** A gateway order the customer pays against; `receipt` is our order id (max 40 characters at Razorpay). */
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** `receipt` carries our refund id so a retry can be matched to an earlier attempt. */
  createRefund(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayRefund>;
  fetchRefund(refundId: string): Promise<GatewayRefund>;
  /** HMAC check of the raw webhook body (doc 16: verify against the raw body). */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
}

/** A gateway call failed (network, 5xx, or a refusal); `retryable` = worth retrying later with the same key. */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
