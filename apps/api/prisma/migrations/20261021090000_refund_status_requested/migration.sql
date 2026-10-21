-- D180: REQUESTED = a customer report waiting for the zone agent (the refund.updated event already names it).
-- Alone in its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "RefundStatus" ADD VALUE 'REQUESTED';
