-- Alembic revision 0001 runs this file in one transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgvector is available for embeddings; no table uses it yet.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS app;

-- =============================================================================
-- IDENTITY
-- =============================================================================

CREATE TABLE app.users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth0_sub    TEXT NOT NULL UNIQUE,      -- Auth0 "sub"; never assumed to be a UUID
    display_name TEXT,
    timezone     TEXT NOT NULL DEFAULT 'UTC',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
