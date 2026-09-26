-- Up Migration
-- Dados importados e analytics (spec §6.3 a §6.5): transações, anomalias e rollups.

-- ─── 6.3 Transações ───────────────────────────────────────────────────────────
-- A maior tabela do sistema: cada linha válida de cada CSV. Particionada por
-- hash do tenant em 16 pedaços, para que cada consulta leia só o pedaço da empresa.
CREATE TABLE transactions (
  tenant_id    uuid          NOT NULL,
  batch_id     uuid          NOT NULL,
  line_number  integer       NOT NULL CHECK (line_number >= 2), -- linha 1 é o cabeçalho
  tx_date      date          NOT NULL,
  amount       numeric(14,2) NOT NULL,
  client_id    text          NOT NULL CHECK (length(client_id) BETWEEN 1 AND 64),
  product_id   text          NOT NULL CHECK (length(product_id) BETWEEN 1 AND 64),
  status       text          NOT NULL
               CHECK (status IN ('aprovada', 'pendente', 'cancelada', 'estornada')),
  -- Chave natural: reprocessar o mesmo lote não duplica linhas (ADR 06)
  PRIMARY KEY (tenant_id, batch_id, line_number)
) PARTITION BY HASH (tenant_id);

-- transactions_p00 ... transactions_p15
DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format(
      'CREATE TABLE transactions_p%s PARTITION OF transactions FOR VALUES WITH (MODULUS 16, REMAINDER %s)',
      lpad(i::text, 2, '0'), i);
  END LOOP;
END $$;

-- Filtro por período (dashboard consolidado) e por lote + período (dashboard do lote)
CREATE INDEX transactions_tenant_date       ON transactions (tenant_id, tx_date);
CREATE INDEX transactions_tenant_batch_date ON transactions (tenant_id, batch_id, tx_date);

-- ─── 6.4 Anomalias ────────────────────────────────────────────────────────────
-- Linhas rejeitadas, para mostrar na tela (até 50.000 por lote; o CSV completo fica no storage)
CREATE TABLE batch_anomalies (
  tenant_id    uuid    NOT NULL,
  batch_id     uuid    NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  line_number  integer NOT NULL CHECK (line_number >= 2),
  error_code   text    NOT NULL,
  column_name  text,
  message      text    NOT NULL CHECK (length(message) <= 200),
  raw_line     text    CHECK (length(raw_line) <= 1024), -- truncado em 1 KiB; apagado em 30 dias
  PRIMARY KEY (tenant_id, batch_id, line_number)
);
CREATE INDEX batch_anomalies_code ON batch_anomalies (tenant_id, batch_id, error_code, line_number);

-- Contagem completa de erros por código, sem limite (a tabela acima guarda só amostras)
CREATE TABLE batch_error_counts (
  tenant_id   uuid   NOT NULL,
  batch_id    uuid   NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  error_code  text   NOT NULL,
  count       bigint NOT NULL CHECK (count > 0),
  PRIMARY KEY (tenant_id, batch_id, error_code)
);

-- ─── 6.5 Rollups do dashboard ─────────────────────────────────────────────────
-- Totais pré-calculados por dia, status e produto. O dashboard lê daqui, nunca
-- agrega os milhões de linhas de transactions na hora.
CREATE TABLE rollup_daily (
  tenant_id   uuid          NOT NULL,
  batch_id    uuid          NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  tx_date     date          NOT NULL,
  status      text          NOT NULL,
  product_id  text          NOT NULL,
  tx_count    bigint        NOT NULL CHECK (tx_count > 0),
  amount_sum  numeric(18,2) NOT NULL,
  PRIMARY KEY (tenant_id, batch_id, tx_date, status, product_id)
);
CREATE INDEX rollup_daily_tenant_date ON rollup_daily (tenant_id, tx_date);

-- Top 20 clientes do lote inteiro (sem filtro de período)
CREATE TABLE batch_top_clients (
  tenant_id   uuid          NOT NULL,
  batch_id    uuid          NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  rank        smallint      NOT NULL CHECK (rank BETWEEN 1 AND 20),
  client_id   text          NOT NULL,
  tx_count    bigint        NOT NULL,
  amount_sum  numeric(18,2) NOT NULL,
  PRIMARY KEY (tenant_id, batch_id, rank)
);

-- Down Migration

DROP TABLE batch_top_clients;
DROP TABLE rollup_daily;
DROP TABLE batch_error_counts;
DROP TABLE batch_anomalies;
DROP TABLE transactions; -- remove as 16 partições junto