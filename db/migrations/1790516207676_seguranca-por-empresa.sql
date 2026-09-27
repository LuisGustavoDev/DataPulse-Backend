-- Up Migration
-- Segurança por empresa (spec §6.6): cada consulta da API só enxerga as linhas
-- do tenant definido em app.tenant_id, mesmo que o código esqueça de filtrar.

-- ─── Papel da API ─────────────────────────────────────────────────────────────
-- Sem login e sem superpoderes: superusuário e BYPASSRLS ignoram as políticas.
-- O usuário de login da API recebe este papel (pnpm db:app-user).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dp_api') THEN
    CREATE ROLE dp_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO dp_api;
GRANT SELECT, INSERT, UPDATE, DELETE
   ON tenants, users, refresh_tokens, batches, transactions,
      batch_anomalies, batch_error_counts, rollup_daily, batch_top_clients
   TO dp_api;
-- As partições de transactions não recebem permissão: só se acessa pela tabela-mãe,
-- que é onde a política vale.

-- ─── Empresa da conexão ───────────────────────────────────────────────────────
-- Lê app.tenant_id (definido pela API a cada transação). Sem ele, dá erro em vez
-- de devolver nada: esquecer o tenant falha alto, não em silêncio.
CREATE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := current_setting('app.tenant_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'app.tenant_id não definido: consulta sem empresa'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END $$;

-- ─── Políticas ────────────────────────────────────────────────────────────────
-- USING filtra o que se lê/altera; WITH CHECK barra gravar linha de outra empresa.
-- (SELECT app_tenant_id()) entre parênteses é calculado uma vez por consulta, não por linha.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = (SELECT app_tenant_id()))
  WITH CHECK (id = (SELECT app_tenant_id()));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'batches', 'transactions', 'batch_anomalies',
                           'batch_error_counts', 'rollup_daily', 'batch_top_clients']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = (SELECT app_tenant_id()))
         WITH CHECK (tenant_id = (SELECT app_tenant_id()))', t);
  END LOOP;
END $$;

-- refresh_tokens não tem tenant_id: quem acessa já tem o token (e só o hash está no banco).

-- ─── Funções de login ─────────────────────────────────────────────────────────
-- No login e no refresh a API ainda não sabe a empresa: só tem o e-mail ou o id.
-- Estas funções rodam como o dono do banco (SECURITY DEFINER), passando por cima
-- da política, e devolvem só o necessário. search_path fixo evita sequestro da função.
CREATE FUNCTION auth_find_user_by_email(p_email citext)
RETURNS TABLE (id uuid, tenant_id uuid, email citext, role text, status text,
               password_hash text, tenant_name text, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.email, u.role, u.status, u.password_hash, t.name, t.status
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
   WHERE u.email = p_email
$$;

CREATE FUNCTION auth_find_user_by_id(p_user_id uuid)
RETURNS TABLE (id uuid, tenant_id uuid, email citext, role text, status text,
               tenant_name text, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.email, u.role, u.status, t.name, t.status
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
   WHERE u.id = p_user_id
$$;

REVOKE ALL ON FUNCTION auth_find_user_by_email(citext), auth_find_user_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(citext), auth_find_user_by_id(uuid), app_tenant_id() TO dp_api;

-- Down Migration

DROP FUNCTION auth_find_user_by_id(uuid);
DROP FUNCTION auth_find_user_by_email(citext);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'users', 'batches', 'transactions', 'batch_anomalies',
                           'batch_error_counts', 'rollup_daily', 'batch_top_clients']
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP FUNCTION app_tenant_id();

-- Tira as permissões do papel e o remove (os usuários de login perdem o papel junto)
DROP OWNED BY dp_api;
DROP ROLE dp_api;