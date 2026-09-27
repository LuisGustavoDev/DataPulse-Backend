# DataPulse Analytics — Backend

Backend para importar arquivos CSV grandes (até 1 GiB) sem travar a interface. O processamento roda em segundo plano, o progresso é enviado em tempo real, e os dados consolidados alimentam endpoints de analytics.

> **Status:** em desenvolvimento. Já funcionam a infraestrutura de dev, o banco completo com isolamento por empresa (Row-Level Security) e a `api` com health check e autenticação completa: cadastro, login, token de acesso, refresh token com rotação e logout. Ainda faltam o upload de lotes, o `worker` e o `realtime`.

## Sumário

- [Stack](#stack)
- [Pré-requisitos](#pré-requisitos)
- [Como rodar](#como-rodar)
- [API](#api)
- [Autenticação](#autenticação)
- [Isolamento entre empresas](#isolamento-entre-empresas)
- [Banco de dados](#banco-de-dados)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts](#scripts)
- [Serviços locais](#serviços-locais)
- [Estrutura](#estrutura)
- [Testes](#testes)
- [Problemas comuns](#problemas-comuns)
- [Licença](#licença)

## Stack

| Camada | Tecnologia |
| --- | --- |
| Linguagem e runtime | TypeScript 6 + Node.js 24 |
| Framework | NestJS 12 |
| Banco | PostgreSQL 16, migrações com node-pg-migrate, Row-Level Security |
| Fila | BullMQ sobre Redis 7 |
| Arquivos | Storage compatível com S3 (RustFS em dev) |
| Autenticação | JWT RS256 (`jose`), refresh token em cookie, senhas com argon2id |
| Validação | zod |
| Monorepo | pnpm workspaces + Nx |
| Testes | Vitest |

Tudo é gratuito e open source. Nenhum serviço pago nem conta em nuvem é necessário.

## Pré-requisitos

- **Linux** (único sistema suportado)
- **Docker** com o Compose v2 (`docker compose version`)
- **git**
- **nvm** ([instalação](https://github.com/nvm-sh/nvm#installing-and-updating))

O Node e o pnpm são instalados pelos passos abaixo, nas versões certas.

## Como rodar

```bash
# 1. Clonar
git clone https://github.com/LuisGustavoDev/DataPulse-Backend.git
cd DataPulse-Backend

# 2. Node 24 (lido do .nvmrc) e pnpm (versão fixada no package.json)
nvm install
corepack enable

# 3. Dependências
pnpm install

# 4. Variáveis de ambiente
cp .env.example .env

# 5. Chaves que assinam os tokens de login (só na primeira vez)
pnpm keys:generate

# 6. Subir PostgreSQL, Redis e storage
pnpm infra:up

# 7. Criar as tabelas do banco e o usuário da API
pnpm db:setup

# 8. Conferir se está tudo de pé
pnpm check

# 9. Subir a API
pnpm --filter @datapulse/api dev
```

Saída esperada do `pnpm check`:

```text
✔ postgres   versão 16.x (…)
✔ redis      PONG, maxmemory-policy=noeviction (…)
✔ storage    buckets dp-incoming e dp-archive ok (…)

Ambiente pronto.
```

Com a API no ar, em outro terminal:

```bash
curl -i localhost:3001/api/v1/health
```

## API

Todas as rotas ficam sob `http://localhost:3001/api/v1`.

| Método e rota | Autenticação | Resposta |
| --- | --- | --- |
| `GET /health` | — | `200` quando PostgreSQL, Redis e storage estão de pé; `503` quando algum está fora, dizendo qual e por quê |
| `POST /auth/signup` | — | `201`: cria a empresa e o primeiro usuário (admin), devolve o token de acesso e grava o cookie de sessão |
| `POST /auth/login` | — | `200`: devolve o token de acesso e grava o cookie de sessão |
| `POST /auth/refresh` | Cookie `dp_rt` | `200`: troca o refresh token e devolve um token de acesso novo |
| `POST /auth/logout` | Cookie `dp_rt` | `204`: encerra a sessão e apaga o cookie |
| `GET /me` | Token de acesso | `200`: dados do usuário logado e da empresa dele |

### `GET /health`

```json
{
  "status": "ok",
  "checks": {
    "postgres": { "status": "up", "latency_ms": 8 },
    "redis": { "status": "up", "latency_ms": 7 },
    "storage": { "status": "up", "latency_ms": 13 }
  }
}
```

### `POST /auth/signup`

```bash
curl -i -c /tmp/cookies -H 'Content-Type: application/json' \
  -d '{"company_name":"Acme Ltda","email":"helena@acme.com","password":"senha-bem-longa-123"}' \
  localhost:3001/api/v1/auth/signup
```

| Campo | Regra |
| --- | --- |
| `company_name` | 2 a 120 caracteres |
| `email` | E-mail válido; único no sistema, sem diferenciar maiúsculas |
| `password` | 12 a 128 caracteres |

Resposta `201` (igual à do login e à do refresh):

```json
{
  "user": { "id": "01a0df2f-…", "email": "helena@acme.com", "role": "admin" },
  "tenant": { "id": "01a0df2f-…", "name": "Acme Ltda" },
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "token_type": "Bearer",
  "expires_in": 900
}
```

E nos headers, o cookie de sessão:

```text
Set-Cookie: dp_rt=…; Max-Age=2592000; Path=/api/v1/auth; HttpOnly; SameSite=Strict
```

### `POST /auth/login`

```bash
curl -i -c /tmp/cookies -H 'Content-Type: application/json' \
  -d '{"email":"helena@acme.com","password":"senha-bem-longa-123"}' \
  localhost:3001/api/v1/auth/login
```

### `POST /auth/refresh` e `POST /auth/logout`

O `-b` envia o cookie guardado e o `-c` grava o cookie novo, como o navegador faz sozinho:

```bash
curl -i -b /tmp/cookies -c /tmp/cookies -X POST localhost:3001/api/v1/auth/refresh

curl -i -b /tmp/cookies -c /tmp/cookies -X POST localhost:3001/api/v1/auth/logout
```

### `GET /me`

```bash
TOKEN=$(curl -s -H 'Content-Type: application/json' \
  -d '{"email":"helena@acme.com","password":"senha-bem-longa-123"}' \
  localhost:3001/api/v1/auth/login | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

curl -i -H "Authorization: Bearer $TOKEN" localhost:3001/api/v1/me
```

### Erros

Os erros vêm com um `code` estável, para o frontend tratar sem depender do texto da mensagem:

```json
{ "code": "EMAIL_TAKEN", "message": "Este e-mail já está cadastrado" }
```

| HTTP | `code` | Quando |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Corpo inválido; o campo `errors` lista cada campo com problema |
| `401` | `INVALID_CREDENTIALS` | E-mail ou senha incorretos (a mesma mensagem nos dois casos) |
| `401` | `UNAUTHENTICATED` | Token de acesso ausente, inválido, adulterado ou expirado |
| `401` | `REFRESH_INVALID` | Refresh token ausente, inválido, expirado ou reutilizado |
| `404` | `NOT_FOUND` | Recurso inexistente |
| `409` | `EMAIL_TAKEN` | E-mail já cadastrado |
| `423` | `USER_DISABLED` | Usuário ou empresa desativados |
| `503` | — | Health check com algum serviço fora |

## Autenticação

- **Senhas** nunca são guardadas. O banco guarda só o hash **argon2id** (64 MiB, 3 passadas), com salt aleatório.
- **Token de acesso**: JWT assinado com **RS256**, válido por **15 minutos**. Contém o usuário (`sub`), a empresa (`tid`) e o papel (`role`). Vai no header `Authorization: Bearer <token>`.
- **Refresh token**: 32 bytes aleatórios, válido por **30 dias**, no cookie `dp_rt` (`HttpOnly`, `SameSite=Strict`, só em `/api/v1/auth`). O banco guarda só o SHA-256. Nunca aparece no corpo da resposta.
- **Rotação**: cada refresh troca o token. Se um token já trocado aparecer de novo, alguém o copiou, e a sessão inteira (todos os tokens daquele login) é revogada.
- **Chaves**: o par RSA é gerado por `pnpm keys:generate` e fica **só no `.env`**, nunca no git. Rodar de novo não troca as chaves, porque isso invalidaria todas as sessões.
- **Login** responde com a mesma mensagem e no mesmo tempo para e-mail inexistente e senha errada, para não revelar quais e-mails têm conta.
- **Rotas protegidas** usam `@UseGuards(JwtAuthGuard)`, e os dados do usuário chegam ao método por `@CurrentUser()`.

## Isolamento entre empresas

O isolamento é garantido pelo **próprio PostgreSQL** (Row-Level Security), não só pelo código:

- A API se conecta com o usuário **`datapulse_api`**, sem superpoderes. As migrações usam o dono do banco, `datapulse`.
- A cada transação, a API define a empresa em `app.tenant_id`. O banco só deixa **ler e gravar** as linhas daquela empresa, mesmo numa consulta sem nenhum `WHERE`.
- Consulta **sem empresa definida dá erro**, em vez de devolver vazio: esquecer o tenant aparece no log na hora.
- Gravar uma linha de outra empresa é barrado (`violates row-level security policy`).
- As partições de `transactions` não são acessíveis diretamente, só pela tabela-mãe.
- No login e no refresh, quando a empresa ainda não é conhecida, a API usa duas funções `SECURITY DEFINER` que buscam **um** usuário por e-mail ou por id.

No código, use `transaction(pool, tenantId, fn)`, de `apps/api/src/infra/tenant.ts`, para qualquer consulta a dados de empresa.

## Banco de dados

As tabelas são criadas por migrações em SQL puro, em `db/migrations/`, aplicadas em ordem. O banco anota em `pgmigrations` quais já rodaram.

| Migração | O que cria |
| --- | --- |
| `identidade` | `tenants` (empresas), `users`, `refresh_tokens` |
| `lotes` | `batches`: cada upload de CSV, com o estado na máquina de estados, progresso e regra de arquivo duplicado |
| `dados-e-analytics` | `transactions` (particionada em 16 por empresa), `batch_anomalies`, `batch_error_counts`, `rollup_daily`, `batch_top_clients` |
| `seguranca-por-empresa` | Row-Level Security nas tabelas com `tenant_id`, papel `dp_api` e funções de login |

Destaques:

- **IDs** são UUIDv7, gerados pela aplicação (ordenados pelo tempo, bons para índice).
- **Regras no próprio banco** (`CHECK`, `UNIQUE`, chaves estrangeiras): um bug no código não consegue gravar um status inexistente, um e-mail duplicado ou contagens incoerentes.
- **`transactions`** tem chave natural `(tenant_id, batch_id, line_number)`: reprocessar um lote não duplica linhas.
- **`rollup_daily`** guarda totais pré-calculados; o dashboard nunca soma milhões de linhas na hora.

Para criar uma migração nova:

```bash
pnpm db:new nome-da-mudanca
```

Uma migração já commitada **nunca é editada**. Mudanças no banco sempre entram numa migração nova.

## Variáveis de ambiente

Todas as variáveis da API são validadas na subida. Se faltar alguma ou o formato estiver errado, a API não sobe e lista os problemas.

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `NODE_ENV` | Não | `development` | `development`, `test` ou `production`. Em `production`, o cookie de sessão só trafega por HTTPS |
| `API_PORT` | Não | `3001` | Porta da API |
| `DATABASE_URL` | Sim | — | Conexão da API com o PostgreSQL, com o usuário sem superpoderes (`datapulse_api`) |
| `MIGRATION_DATABASE_URL` | Sim | — | Conexão do dono do banco, usada só pelas migrações e pelo `db:app-user` |
| `REDIS_URL` | Sim | — | Conexão com o Redis (`redis://…`) |
| `S3_ENDPOINT` | Sim | — | Endereço do storage S3 |
| `S3_REGION` | Sim | — | Região S3 (ignorada pelo RustFS) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Sim | — | Credenciais do storage |
| `S3_BUCKET_INCOMING` / `S3_BUCKET_ARCHIVE` | Sim | — | Nomes dos buckets |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Sim | — | Chaves RSA em base64, geradas por `pnpm keys:generate` |
| `JWT_ACCESS_TTL_SECONDS` | Não | `900` | Validade do token de acesso (60 a 3600 s) |
| `REFRESH_TOKEN_TTL_DAYS` | Não | `30` | Validade do refresh token (1 a 90 dias) |

`POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` são usadas só pelo container do banco.

## Scripts

| Comando | O que faz |
| --- | --- |
| `pnpm infra:up` | Sobe os containers em segundo plano |
| `pnpm infra:down` | Para os containers (os dados continuam salvos) |
| `pnpm infra:ps` | Mostra o estado dos containers |
| `pnpm infra:logs` | Acompanha os logs |
| `pnpm check` | Testa a conexão com os três serviços |
| `pnpm keys:generate` | Gera as chaves do JWT no `.env` (só na primeira vez) |
| `pnpm db:setup` | Aplica as migrações e cria o usuário da API no banco |
| `pnpm db:migrate` | Aplica as migrações pendentes |
| `pnpm db:rollback` | Desfaz a última migração |
| `pnpm db:app-user` | Cria ou atualiza o usuário da API com a senha do `DATABASE_URL` |
| `pnpm db:new <nome>` | Cria um arquivo de migração vazio |
| `pnpm --filter @datapulse/api dev` | Sobe a API em modo desenvolvimento (porta 3001), reiniciando a cada arquivo salvo |
| `pnpm --filter @datapulse/api test` | Roda os testes da API |
| `pnpm build` / `test` / `lint` | Roda em todos os pacotes, via Nx |

Para apagar **todos** os dados locais e começar do zero:

```bash
docker compose -f deploy/compose/docker-compose.yml down -v
```

Depois, `pnpm infra:up` e `pnpm db:setup` recriam tudo vazio.

## Serviços locais

| Serviço | Endereço | Acesso |
| --- | --- | --- |
| API | http://localhost:3001/api/v1 | — |
| PostgreSQL (dono) | `localhost:5432` | usuário `datapulse`, senha `datapulse`, banco `datapulse` |
| PostgreSQL (API) | `localhost:5432` | usuário `datapulse_api`, senha `datapulse_api`, sujeito ao RLS |
| Redis | `localhost:6379` | sem senha |
| Storage (API S3) | http://localhost:9000 | chave `datapulse` / `datapulse-secret` |
| Storage (console web) | http://localhost:9001 | mesmo acesso acima |

Buckets criados automaticamente:

- `dp-incoming`: arquivos recém-enviados; expiram em 3 dias.
- `dp-archive`: arquivos já processados; expiram em 30 dias (retenção da LGPD).

Para abrir o terminal do banco como dono (vê tudo):

```bash
docker compose -f deploy/compose/docker-compose.yml exec postgres psql -U datapulse -d datapulse
```

Como a API (vê só a empresa definida em `app.tenant_id`):

```bash
docker compose -f deploy/compose/docker-compose.yml exec -e PGPASSWORD=datapulse_api postgres psql -h localhost -U datapulse_api -d datapulse
```

Essas senhas são só para desenvolvimento local.

## Estrutura

```text
DataPulse-Backend/
├── apps/
│   └── api/                        # API REST (NestJS)
│       └── src/
│           ├── main.ts             # ponto de entrada
│           ├── app.module.ts       # junta os módulos
│           ├── config/             # leitura e validação do .env
│           ├── infra/              # conexões externas e transação por empresa (tenant.ts)
│           ├── common/             # utilitários (UUIDv7, validação com zod)
│           ├── health/             # GET /health
│           └── auth/               # cadastro, login, JWT, refresh token, logout e /me
├── db/
│   └── migrations/                 # migrações SQL do banco
├── deploy/compose/                 # docker-compose e configuração do storage
├── scripts/                        # check-env, chaves JWT e usuário da API no banco
├── libs/                           # código compartilhado entre os apps
├── tests/                          # testes de ponta a ponta
├── tsconfig.base.json              # config TypeScript herdada por todos os pacotes
└── nx.json                         # ordem e cache dos builds
```

Cada funcionalidade da API fica numa pasta própria, com seu módulo, controller, service e testes lado a lado.

## Testes

```bash
pnpm --filter @datapulse/api test
```

Os testes automatizados (21) cobrem:

- **Configuração:** valores padrão, conversão de tipos, erro listando todas as variáveis com problema.
- **Health check:** tempo limite, falhas e mensagens de erro legíveis.
- **Senhas:** hash sem a senha original, salt diferente a cada hash, verificação certa e errada.
- **Tokens de acesso:** emissão e leitura, recusa de token adulterado, assinado por outra chave ou expirado.
- **Refresh token:** aleatoriedade, tamanho e hash estável.
- **Validação:** remoção de campos extras e resposta `400` com os campos inválidos.

Os testes automatizados rodam sem banco, sem Redis e sem Docker. O fluxo completo pela API (cadastro, login, refresh, reuso de token, logout) e o isolamento entre empresas no banco foram verificados manualmente, com os comandos das seções [API](#api) e [Serviços locais](#serviços-locais).

## Problemas comuns

**`permission denied` ao rodar o Docker:** seu usuário não está no grupo `docker`. Rode `sudo usermod -aG docker $USER`, saia e entre de novo na sessão.

**`couldn't find env file`:** falta o `.env`. Rode `cp .env.example .env`.

**Containers parados depois de reiniciar o computador:** os containers não sobem sozinhos. Rode `pnpm infra:up`.

**`port is already allocated`:** outro programa usa a porta 5432, 6379, 9000 ou 9001. Pare o programa, ou troque a porta da esquerda em `deploy/compose/docker-compose.yml` (ex.: `'5433:5432'`) e ajuste o `.env`.

**`Configuração inválida` ao subir a API:** falta alguma variável no `.env` ou o formato está errado. A mensagem lista cada uma; compare com o `.env.example`. Se forem `JWT_PRIVATE_KEY` e `JWT_PUBLIC_KEY`, rode `pnpm keys:generate`.

**`password authentication failed for user "datapulse_api"`:** o usuário da API ainda não foi criado, ou a senha no `DATABASE_URL` mudou. Rode `pnpm db:app-user`.

**`app.tenant_id não definido: consulta sem empresa`:** uma consulta a dados de empresa rodou fora de `transaction(pool, tenantId, …)`. É o Row-Level Security funcionando: use o helper de `infra/tenant.ts`.

**`relation "users" does not exist`:** as tabelas não foram criadas. Rode `pnpm db:setup`.

**`EADDRINUSE` na porta 3001 ao subir a API:** outra instância já está rodando. Pare a outra, ou suba em outra porta com `API_PORT=3002 pnpm --filter @datapulse/api dev`.

**`ERR_PNPM_IGNORED_BUILDS` citando `argon2`:** o pnpm bloqueou a compilação do argon2. Em `pnpm-workspace.yaml`, deixe `argon2: true` em `allowBuilds` e rode `pnpm install`.

**`pnpm: command not found`:** rode `nvm use` e depois `corepack enable`.

**`pnpm check` falha em um serviço:** veja o estado com `pnpm infra:ps` e os logs com `pnpm infra:logs`.

**Health responde `503`:** o corpo da resposta diz qual serviço está fora e o erro. Suba a infra com `pnpm infra:up`; a API reconecta sozinha, sem precisar reiniciar.

**`401` em todas as rotas com token:** o token de acesso vale 15 minutos. Use `POST /auth/refresh` para pegar outro, ou faça login de novo. Se as chaves do `.env` mudaram, todos os tokens antigos deixam de valer.

## Licença

[MIT](LICENSE) © 2026 LuisGustavoDev
