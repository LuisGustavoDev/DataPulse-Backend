-- Up Migration
-- Identidade e tenants (spec §6.1): empresas, usuários e tokens de sessão.

-- Texto que compara sem diferenciar maiúsculas: "Ana@x.com" = "ana@x.com"
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE tenants (
  id                          uuid PRIMARY KEY,
  name                        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  status                      text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'offboarding')),
  max_concurrent_batches      smallint NOT NULL DEFAULT 2 CHECK (max_concurrent_batches > 0),
  monthly_upload_quota_bytes  bigint NOT NULL DEFAULT 53687091200, -- 50 GiB
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  email          citext NOT NULL UNIQUE, -- 1 usuário = 1 tenant no MVP
  password_hash  text NOT NULL,          -- argon2id, nunca a senha
  role           text NOT NULL CHECK (role IN ('admin', 'analyst')),
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('invited', 'active', 'disabled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE INDEX users_tenant ON users (tenant_id);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,          -- rotação com detecção de reuso (§11.2)
  token_hash  bytea NOT NULL UNIQUE,  -- SHA-256 do token, nunca o token
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

-- Down Migration

DROP TABLE refresh_tokens;
DROP TABLE users;
DROP TABLE tenants;