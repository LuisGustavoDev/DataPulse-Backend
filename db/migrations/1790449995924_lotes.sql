-- Up Migration
-- Lotes (spec §6.2): cada upload de CSV e o estado dele na máquina de estados (§4).

CREATE TABLE batches (
  -- Identificação
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  created_by            uuid NOT NULL REFERENCES users (id),

  -- Arquivo
  original_filename     text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  declared_size_bytes   bigint NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 1073741824),
  size_bytes            bigint CHECK (size_bytes BETWEEN 0 AND 1073741824), -- tamanho real, via HEAD
  sha256_client         bytea CHECK (octet_length(sha256_client) = 32),   -- informado pelo navegador
  sha256                bytea CHECK (octet_length(sha256) = 32),          -- calculado pelo worker
  allow_duplicate       boolean NOT NULL DEFAULT false,
  object_bucket         text NOT NULL,
  object_key            text NOT NULL,                                    -- {tenant_id}/{batch_id}/source.csv
  multipart_upload_id   text,
  encoding              text CHECK (encoding IN ('utf-8', 'windows-1252')),
  delimiter             text CHECK (delimiter IN (',', ';')),
  column_order          text[],

  -- Estado (máquina de estados do §4)
  status                text NOT NULL DEFAULT 'AWAITING_UPLOAD' CHECK (status IN (
                          'AWAITING_UPLOAD', 'QUEUED', 'PROCESSING', 'CONSOLIDATING',
                          'SUCCEEDED', 'PARTIAL', 'FAILED_VALIDATION', 'FAILED_TECHNICAL',
                          'REJECTED_SCHEMA', 'REJECTED_DUPLICATE', 'ABANDONED',
                          'DELETING', 'DELETED')),
  status_reason         text,           -- código: ERROR_RATE_EXCEEDED, EMPTY_FILE, OBJECT_EXPIRED...
  status_detail         jsonb,
  queue                 text CHECK (queue IN ('express', 'heavy')),
  attempt               smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 4),
  next_attempt_at       timestamptz,
  heartbeat_at          timestamptz,

  -- Progresso e resultado
  bytes_read            bigint NOT NULL DEFAULT 0 CHECK (bytes_read >= 0),
  rows_total            bigint NOT NULL DEFAULT 0,
  rows_valid            bigint NOT NULL DEFAULT 0 CHECK (rows_valid >= 0),
  rows_invalid          bigint NOT NULL DEFAULT 0 CHECK (rows_invalid >= 0),
  anomalies_stored      integer NOT NULL DEFAULT 0 CHECK (anomalies_stored BETWEEN 0 AND 50000),
  anomalies_object_key  text,
  unique_clients        bigint,
  date_min              date,
  date_max              date,
  trace_id              text,

  -- Linha do tempo
  created_at            timestamptz NOT NULL DEFAULT now(),
  uploaded_at           timestamptz,
  queued_at             timestamptz,
  started_at            timestamptz,
  finished_at           timestamptz,
  status_changed_at     timestamptz NOT NULL DEFAULT now(),
  raw_purged_at         timestamptz,
  deleted_at            timestamptz,

  CONSTRAINT batches_rows_sum CHECK (rows_total = rows_valid + rows_invalid),
  CONSTRAINT batches_date_range CHECK (date_min IS NULL OR date_max IS NULL OR date_min <= date_max)
);

-- Histórico do tenant, mais recente primeiro (GET /batches)
CREATE INDEX batches_tenant_created ON batches (tenant_id, created_at DESC);

-- Lotes em andamento, para o reconciliador (§12.5). Parcial: só indexa os não terminais.
CREATE INDEX batches_active ON batches (status, status_changed_at)
  WHERE status IN ('AWAITING_UPLOAD', 'QUEUED', 'PROCESSING', 'CONSOLIDATING', 'DELETING');

-- Mesmo arquivo não pode ser importado duas vezes pelo mesmo tenant (§5, P7),
-- a menos que o usuário peça explicitamente (allow_duplicate)
CREATE UNIQUE INDEX batches_dedup ON batches (tenant_id, sha256)
  WHERE status IN ('SUCCEEDED', 'PARTIAL') AND NOT allow_duplicate;

-- Down Migration

DROP TABLE batches;