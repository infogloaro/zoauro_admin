# 15 — Data Privacy and Retention Policy

Applicable law: India's Digital Personal Data Protection Act, 2023 (confirm with legal counsel), plus any customer-region laws if expanded.

## 1. Personal data inventory
| Data | Subject | Where | Sensitivity |
|---|---|---|---|
| Name, phone, email, addresses | Customers | customers, customer_addresses, orders snapshot | Personal |
| Name, email, phone, password hash, MFA secret | Admins | users | Personal + credential |
| ID documents, vehicle docs | Delivery partners | S3, vendor_documents | High |
| Business and owner documents (FSSAI, GST, PAN, bank) | Vendors | S3, payouts | High / financial |
| Payment references | Customers | payments | Financial (no card data stored) |
| IP, user agent | Admins | login_history, audit_logs | Personal |

## 2. Principles
Collect minimum; use only for operations; role-based access; zone limits; encrypt; log access to sensitive records.

## 3. Rules
- No card numbers, CVV, or UPI PINs stored; the gateway handles them (PCI scope minimised).
- Mask phone/email in lists (e.g. `98****1234`) with reveal on detail view, audited for high-sensitivity documents.
- Document downloads use short-lived signed URLs and are logged.
- Exports require permission, are zone-filtered, audited, and expire after 24 h.

## 4. Retention
| Data | Retention | End of life |
|---|---|---|
| Orders, payments, refunds, ledger | 8 years (tax/accounting; confirm with accountant) | Archive, then delete or anonymise |
| Customer profile | While active + 3 years after last order | Anonymise |
| Customer on deletion request | Delete or anonymise PII within 30 days unless legally retained | Order records keep anonymised reference |
| Vendor/partner documents | Contract duration + 3 years | Delete from S3 |
| Audit logs | 3 years (hot 12 months, then archive) | Delete |
| Login history | 12 months | Delete |
| Sessions, reset tokens | Expiry + 30 days | Purge job |
| Webhook payloads | 90 days | Purge |
| Application logs | 30 days hot, 1 year cold | Delete |
| Backups | 35 days PITR + monthly snapshots 12 months | Expire |

## 5. Data subject requests
Process: verify identity → Super Admin creates request record → export or anonymise via admin tool/script → confirm within 30 days → log. Anonymisation replaces PII with hashes, keeps order totals.

## 6. Consent and notices
Consent and privacy notice are captured in customer-facing apps; admin panel displays consent flags if provided by the backend. Admins accept an acceptable-use and confidentiality agreement at onboarding.

## 7. Access logging
Viewing documents, exporting data, and changing personal data are recorded in `audit_logs` with actor, zone, entity, time.

## 8. Third parties
Gateway, SMS, email, Sentry, AWS are processors; keep a vendor list with DPAs; scrub PII from Sentry.
