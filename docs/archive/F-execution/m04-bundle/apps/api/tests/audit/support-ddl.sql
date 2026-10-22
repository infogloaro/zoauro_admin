-- TEST ONLY. Mirrors what `prisma migrate` creates from audit.model.prisma and doc 08 access_changes.
CREATE TYPE "AuditActorType" AS ENUM ('USER','APP_CLIENT','SYSTEM','WEBHOOK');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS','DENIED');
CREATE TYPE "AuditSensitivity" AS ENUM ('NORMAL','HIGH');
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_type "AuditActorType" NOT NULL,
  actor_id uuid, actor_name text NOT NULL, actor_role text,
  zone_id uuid, module text NOT NULL, action text NOT NULL,
  entity_type text NOT NULL, entity_id uuid, entity_label text,
  outcome "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
  sensitivity "AuditSensitivity" NOT NULL DEFAULT 'NORMAL',
  before_json jsonb, after_json jsonb, note text,
  ip inet, user_agent text, request_id text
);
CREATE INDEX audit_logs_zone_idx     ON audit_logs (zone_id, id DESC);
CREATE INDEX audit_logs_zone_mod_idx ON audit_logs (zone_id, module, id DESC);
CREATE INDEX audit_logs_entity_idx   ON audit_logs (entity_type, entity_id, id DESC);
CREATE INDEX audit_logs_actor_idx    ON audit_logs (actor_id, id DESC);
CREATE INDEX audit_logs_modact_idx   ON audit_logs (module, action, id DESC);
CREATE INDEX audit_logs_sens_idx     ON audit_logs (sensitivity, id DESC);
CREATE TABLE access_changes (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL, member_id uuid NOT NULL, zone_id uuid,
  change_type text NOT NULL, before_json jsonb, after_json jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
