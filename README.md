# DataPulse Analytics

Plataforma para importar arquivos CSV grandes (até 1 GiB) sem travar a interface. O processamento roda em segundo plano, o progresso aparece em tempo real, e o resultado vira um dashboard.

> **Status:** ambiente de desenvolvimento pronto. Os apps (`api`, `worker`, `realtime`, `web`) ainda não foram criados.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | Next.js |
| Backend | Node.js 24 + TypeScript + NestJS |
| Fila | BullMQ sobre Redis 7 |
| Banco | PostgreSQL 16 |
| Arquivos | Storage compatível com S3 (RustFS em dev) |
| Monorepo | pnpm workspaces + Nx |

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
git clone <url-do-repositório> datapulse
cd datapulse

# 2. Node 24 (lido do .nvmrc) e pnpm (versão fixada no package.json)
nvm install
corepack enable

# 3. Dependências
pnpm install

# 4. Variáveis de ambiente
cp .env.example .env

# 5. Subir PostgreSQL, Redis e storage
pnpm infra:up

# 6. Conferir se está tudo de pé
pnpm check
```

Saída esperada do `pnpm check`:

```text
✔ postgres   versão 16.x (…)
✔ redis      PONG, maxmemory-policy=noeviction (…)
✔ storage    buckets dp-incoming e dp-archive ok (…)

Ambiente pronto.
```

## Scripts

| Comando | O que faz |
| --- | --- |
| `pnpm infra:up` | Sobe os containers em segundo plano |
| `pnpm infra:down` | Para os containers (os dados continuam salvos) |
| `pnpm infra:ps` | Mostra o estado dos containers |
| `pnpm infra:logs` | Acompanha os logs |
| `pnpm check` | Testa a conexão com os três serviços |
| `pnpm build` / `test` / `lint` | Roda em todos os pacotes, via Nx |

Para apagar **todos** os dados locais e começar do zero:

```bash
docker compose -f deploy/compose/docker-compose.yml down -v
```

## Serviços locais

| Serviço | Endereço | Acesso |
| --- | --- | --- |
| PostgreSQL | `localhost:5432` | usuário `datapulse`, senha `datapulse`, banco `datapulse` |
| Redis | `localhost:6379` | sem senha |
| Storage (API S3) | http://localhost:9000 | chave `datapulse` / `datapulse-secret` |
| Storage (console web) | http://localhost:9001 | mesmo acesso acima |

Buckets criados automaticamente:

- `dp-incoming`: arquivos recém-enviados; expiram em 3 dias.
- `dp-archive`: arquivos já processados; expiram em 30 dias (retenção da LGPD).

Essas senhas são só para desenvolvimento local.

## Estrutura

```text
datapulse/
├── apps/              # aplicações (web, api, worker, realtime)
├── libs/              # código compartilhado entre os apps
├── deploy/compose/    # docker-compose e configuração do storage
├── scripts/           # utilitários (check-env)
├── tests/             # testes de ponta a ponta
├── tsconfig.base.json # config TypeScript herdada por todos os pacotes
└── nx.json            # ordem e cache dos builds
```

## Problemas comuns

**`permission denied` ao rodar o Docker:** seu usuário não está no grupo `docker`. Rode `sudo usermod -aG docker $USER`, saia e entre de novo na sessão.

**`couldn't find env file`:** falta o `.env`. Rode `cp .env.example .env`.

**`port is already allocated`:** outro programa usa a porta 5432, 6379, 9000 ou 9001. Pare o programa, ou troque a porta da esquerda em `deploy/compose/docker-compose.yml` (ex.: `'5433:5432'`) e ajuste o `.env`.

**`pnpm: command not found`:** rode `nvm use` e depois `corepack enable`.

**`pnpm check` falha em um serviço:** veja o estado com `pnpm infra:ps` e os logs com `pnpm infra:logs`.

## Licença

[MIT](LICENSE) © 2026 LuisGustavoDev
