-- Local development only. Real environments create these roles through infrastructure with secrets from the secrets manager.
-- zoauro_owner runs prisma migrate; zoauro_app is what the API and worker connect as; zoauro_purge is used only by the audit retention job.
-- Runs once, as the PostgreSQL superuser, when the data volume is first created (docs/F-execution/50 section 3.2, D64).
CREATE ROLE zoauro_owner LOGIN PASSWORD 'zoauro_owner_dev' CREATEDB;
CREATE ROLE zoauro_app   LOGIN PASSWORD 'zoauro_app_dev';
CREATE ROLE zoauro_purge LOGIN PASSWORD 'zoauro_purge_dev';

CREATE DATABASE zoauro OWNER zoauro_owner;

\connect zoauro

GRANT USAGE ON SCHEMA public TO zoauro_app, zoauro_purge;
-- Tables and sequences created later by zoauro_owner (prisma migrate) are usable by the app role.
-- zoauro_purge gets nothing by default; the audit migration grants it the two audit tables.
ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zoauro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE zoauro_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO zoauro_app;
