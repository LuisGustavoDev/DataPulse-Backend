// Cria (ou atualiza) o usuário de login da API no PostgreSQL, com o papel dp_api.
// Usuário e senha vêm do DATABASE_URL; a conexão usa o dono do banco (MIGRATION_DATABASE_URL).
// Rode depois de "pnpm db:migrate", que cria o papel dp_api.
import pg from 'pg';

const app = new URL(process.env.DATABASE_URL ?? '');
const user = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);

if (!user || !password) {
  console.error('DATABASE_URL precisa ter usuário e senha, ex.: postgres://datapulse_api:senha@localhost:5432/datapulse');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await client.connect();
try {
  // format('%I', ...) e '%L' escapam nome e senha: nada do .env vira SQL solto
  const { rows } = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = $1) AS exists',
    [user],
  );
  const verb = rows[0]?.exists ? 'ALTER' : 'CREATE';
  const { rows: sql } = await client.query<{ q: string }>(
    `SELECT format('${verb} ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS q`,
    [user, password],
  );
  await client.query(sql[0]!.q);
  const { rows: grant } = await client.query<{ q: string }>(`SELECT format('GRANT dp_api TO %I', $1::text) AS q`, [user]);
  await client.query(grant[0]!.q);
  console.log(`Usuário "${user}" ${verb === 'CREATE' ? 'criado' : 'atualizado'} com o papel dp_api.`);
} finally {
  await client.end();
}