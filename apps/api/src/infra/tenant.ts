import type { Pool, PoolClient } from 'pg';

/**
 * Define a empresa da transação atual (spec §6.6). A política de RLS só deixa
 * ler e gravar linhas desta empresa. O `true` do set_config faz o valor valer só
 * até o fim da transação: a conexão volta limpa para o pool.
 */
export async function setTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

/**
 * Roda `fn` numa transação. Com `tenantId`, a transação já começa restrita à
 * empresa; com `null`, só funções SECURITY DEFINER e tabelas sem RLS respondem.
 */
export async function transaction<T>(
  pool: Pool,
  tenantId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId) await setTenant(client, tenantId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}