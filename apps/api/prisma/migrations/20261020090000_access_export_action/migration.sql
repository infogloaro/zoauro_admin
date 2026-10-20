-- D149: per-module export action. Alone in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.
ALTER TYPE "AccessAction" ADD VALUE 'EXPORT';
