# 16 — Payment and Financial Controls

## 1. Payment flow (online)
Order placed → server creates payment with provider → customer pays → provider sends signed webhook → server verifies signature, re-fetches payment from provider, marks PAID in a transaction with ledger entries → order payment_status updated. Browser redirect never confirms payment.

## 2. COD flow
Delivered → partner confirms cash collected → payment PAID (method COD) → partner `cash_in_hand` increases → daily cash settlement by Zonal Admin (for partners in their zones) recording amount handed in in `cash_settlements`; variances flagged.

## 3. Controls
| Control | Rule |
|---|---|
| Signed webhooks | Reject invalid signature; verify against raw body |
| Idempotency | Unique `provider_payment_id`, `webhook_events.event_id`, refund `idempotency_key` |
| Duplicate-payment prevention | One active payment attempt per order; double submit guarded by key |
| Amount integrity | Server computes totals; client amount ignored; compare gateway amount to order total |
| Refund ceiling | Sum refunds ≤ captured |
| Zonal refund limit | limits set **per member per zone** on the assignment (defaults INR 1,000/refund and INR 5,000/day from the Access Profile, D13/D20; `refund_daily_usage` per assignment); above or none granted → Super Admin approval |
| Segregation | Requester ≠ approver |
| Reason codes | Mandatory: DELAY, QUALITY, WRONG_ITEM, VENDOR_CANCEL, CUSTOMER_REQUEST, OTHER (+ note) |
| Immutable ledger | `ledger_entries` append-only; corrections via reversing entries |
| Re-authentication | Required for refund approval and payment settings |
| Alerts | Refund spike (> N per hour per admin), failed webhook, reconciliation mismatch |

## 4. Ledger accounts (double entry, simplified)
Customer receivable/cash, Platform revenue (commission), Vendor payable, Delivery payable, Tax payable (GST), Refund expense. Each order produces balanced debit/credit sets at capture; refunds create reversal entries.

## 5. Commission and payouts
Payees: restaurants, homemakers **and delivery partners** (Figma Payments tabs, D44). Delivery partner payout = delivery charges earned − COD cash not yet settled; formula to be confirmed by finance (open).
Commission = vendor subtotal × commission_pct (stored at placement). Vendor net = subtotal − commission − refunds attributed to vendor (D8). Payout periods weekly (configurable); payout record has gross, commission, net, status; marking paid requires Super Admin.

## 6. Reconciliation
Daily job: fetch provider settlements/payments for the day, compare with `payments`; differences flagged in a reconciliation report (missing, amount mismatch, status mismatch). Unresolved items older than 48 h alert finance owner. COD reconciled against partner settlements.

## 7. Settlement controls
Payout generation job idempotent per (vendor, period); payouts frozen if open disputes; changes to commission apply to future orders only.

## 8. Audit
Every payment, refund, approval, payout and setting change is audited with before/after values.
