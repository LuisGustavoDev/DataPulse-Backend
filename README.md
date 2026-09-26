# DataPulse Analytics — Backend

Backend para importar arquivos CSV grandes (até 1 GiB) sem travar a interface. O processamento roda em segundo plano, o progresso é enviado em tempo real, e os dados consolidados alimentam endpoints de analytics.

> **Status:** em desenvolvimento. A `api` já sobe, valida a configuração e expõe `GET /api/v1/health`. O `worker` e o `realtime` ainda não foram criados.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js 24 + TypeScript + NestJS |
| Fila | BullMQ sobre Redis 7 |
| Banco | PostgreSQL 16 |
| Arquivos | Storage compatível com S3 (RustFS em dev) |
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

# 5. Subir PostgreSQL, Redis e storage
pnpm infra:up

# 6. Conferir se está tudo de pé
pnpm check

# 7. Subir a API
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

| Método e rota | Resposta |
| --- | --- |
| `GET /api/v1/health` | `200` quando PostgreSQL, Redis e storage estão de pé; `503` quando algum está fora, dizendo qual e por quê |

Exemplo de resposta com tudo de pé:

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

A API valida o `.env` ao subir. Se faltar uma variável ou algum valor estiver em formato errado, ela não sobe e lista todos os problemas no terminal.

## Scripts

| Comando | O que faz |
| --- | --- |
| `pnpm infra:up` | Sobe os containers em segundo plano |
| `pnpm infra:down` | Para os containers (os dados continuam salvos) |
| `pnpm infra:ps` | Mostra o estado dos containers |
| `pnpm infra:logs` | Acompanha os logs |
| `pnpm check` | Testa a conexão com os três serviços |
| `pnpm --filter @datapulse/api dev` | Sobe a API em modo desenvolvimento (porta 3001), reiniciando a cada arquivo salvo |
| `pnpm --filter @datapulse/api test` | Roda os testes da API |
| `pnpm build` / `test` / `lint` | Roda em todos os pacotes, via Nx |

Para apagar **todos** os dados locais e começar do zero:

```bash
docker compose -f deploy/compose/docker-compose.yml down -v
```

## Serviços locais

| Serviço | Endereço | Acesso |
| --- | --- | --- |
| API | http://localhost:3001/api/v1 | — |
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
DataPulse-Backend/
├── apps/
│   └── api/                   # API REST (NestJS)
│       └── src/
│           ├── main.ts        # ponto de entrada
│           ├── app.module.ts  # junta os módulos
│           ├── config/        # leitura e validação do .env
│           ├── infra/         # conexões com PostgreSQL, Redis e storage
│           └── health/        # GET /api/v1/health
├── libs/                      # código compartilhado entre os apps
├── deploy/compose/            # docker-compose e configuração do storage
├── scripts/                   # utilitários (check-env)
├── tests/                     # testes de ponta a ponta
├── tsconfig.base.json         # config TypeScript herdada por todos os pacotes
└── nx.json                    # ordem e cache dos builds
```

Cada funcionalidade da API fica numa pasta própria, com seu módulo, controller, service e testes lado a lado.

## Problemas comuns

**`permission denied` ao rodar o Docker:** seu usuário não está no grupo `docker`. Rode `sudo usermod -aG docker $USER`, saia e entre de novo na sessão.

**`couldn't find env file`:** falta o `.env`. Rode `cp .env.example .env`.

**`port is already allocated`:** outro programa usa a porta 5432, 6379, 9000 ou 9001. Pare o programa, ou troque a porta da esquerda em `deploy/compose/docker-compose.yml` (ex.: `'5433:5432'`) e ajuste o `.env`.

**`EADDRINUSE` na porta 3001 ao subir a API:** outra instância da API já está rodando. Pare a outra, ou suba em outra porta com `API_PORT=3002 pnpm --filter @datapulse/api dev`.

**`Configuração inválida` ao subir a API:** falta alguma variável no `.env` ou o formato está errado. A mensagem lista cada uma; compare com o `.env.example`.

**`pnpm: command not found`:** rode `nvm use` e depois `corepack enable`.

**`pnpm check` falha em um serviço:** veja o estado com `pnpm infra:ps` e os logs com `pnpm infra:logs`.

**Health responde `503`:** o corpo da resposta diz qual serviço está fora e o erro. Suba a infra com `pnpm infra:up`; a API reconecta sozinha, sem precisar reiniciar.

## Licença

[MIT](LICENSE) © 2026 LuisGustavoDev
