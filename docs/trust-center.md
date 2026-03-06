# Trust Center

## Visao geral
Modulo dedicado para gestao de acesso de usuarios ESP32, auditoria de eventos e ciclo de contra-senha.

- rota base: `/trust-center`
- rotas internas:
  - `/trust-center/users` (padrao)
  - `/trust-center/activity`
  - `/trust-center/counter-key`
- item de menu: `Trust Center` (icone escudo)

## Frontend
Arquivo principal:
- `client/src/pages/trust-center/TrustCenterPage.jsx`

Recursos:
- layout padrao (sidebar, topbar e container principal)
- tabs sincronizadas com URL
- querystring para filtros, paginacao e ordenacao
- aba `Usuarios` com tabela unica, selecao de colunas e painel lateral (Status/Historico)
- aba `Historico` com filtros server-side e exportacao CSV
- aba `Contra-senha` com criacao, listagem, uso e cancelamento

## Backend
Arquivos:
- `server/routes/trust-center.js`
- `server/services/trust-center.js`
- `server/middleware/trust-center-permissions.js`

Endpoints REST (montados em `/api` e tambem em `/api/core`):
- `GET /trust-center/users/options`
- `GET /trust-center/users`
- `GET /trust-center/users/:id/summary`
- `GET /trust-center/users/:id/history`
- `GET /trust-center/activity`
- `GET /trust-center/audit`
- `GET /trust-center/activity/export`
- `GET /trust-center/counter-keys`
- `POST /trust-center/counter-keys`
- `POST /trust-center/counter-keys/:id/use`
- `POST /trust-center/counter-keys/:id/cancel`
- `POST /trust-center/challenge/rotate`
- `POST /trust-center/counter-key/simulate`
- `POST /trust-center/counter-keys/simulate` (alias)

## Permissoes
- `trust_center.view`
- `trust_center.audit_view`
- `trust_center.manage_counter_key`

## Seguranca
- senha base nunca e armazenada em texto simples
- persistencia usa hash (`basePasswordHash`) e chave derivada no backend
- acoes sensiveis registram auditoria

## Expiracao e uso
Configuracoes por ambiente:
- `TRUST_CENTER_COUNTER_KEY_TTL_MINUTES` (default: `30`)
- `TRUST_CENTER_COUNTER_KEY_MAX_USES` (default: `1`)
- `TRUST_CENTER_COUNTER_KEY_SECRET` (default: `trust-center-secret`)

## Banco de dados
Migrations:
- `prisma/migrations/20260305213300_add_trust_center_tables/migration.sql`
- `prisma/migrations/20260306093000_add_trust_center_module/migration.sql`

Tabelas principais:
- `trust_center_user_state`
- `trust_center_event`
- `trust_center_counter_key`

## Build/versao
No build do frontend, `version.json` deve conter:
- `builtAt`
- `hotfix` (via `BUILD_HOTFIX` ou `HOTFIX`)
