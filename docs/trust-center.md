# Trust Center

## Visão Geral
O módulo **Trust Center** foi implementado como módulo novo e isolado no source do Euro One.

- Rota base: `/trust-center`
- Rotas internas:
  - `/trust-center/users`
  - `/trust-center/activity`
  - `/trust-center/counter-key`
- Item de menu: **Trust Center** (ícone escudo)

## Frontend
Arquivo principal:
- `client/src/pages/trust-center/TrustCenterPage.jsx`

Funcionalidades:
- Layout padrão da aplicação (sidebar + topbar + container)
- Tabs sincronizadas com URL
- Aba **Usuários** com:
  - toolbar de filtros
  - tabela única principal
  - ordenação e paginação
  - seleção de colunas com persistência em `localStorage`
  - drawer lateral de detalhes com abas Status e Histórico
- Aba **Histórico** com filtros server-side e exportação CSV
- Aba **Contra-senha** com criação, listagem server-side, uso e cancelamento

## Backend
Arquivos:
- `server/routes/trust-center.js`
- `server/services/trust-center.js`
- `server/middleware/trust-center-permissions.js`

Endpoints:
- `GET /api/core/trust-center/users/options`
- `GET /api/core/trust-center/users`
- `GET /api/core/trust-center/users/:id/summary`
- `POST /api/core/trust-center/challenge/rotate`
- `POST /api/core/trust-center/counter-key/simulate`
- `GET /api/core/trust-center/activity`
- `GET /api/core/trust-center/activity/export`
- `GET /api/core/trust-center/audit`
- `GET /api/core/trust-center/counter-keys`
- `POST /api/core/trust-center/counter-keys`
- `POST /api/core/trust-center/counter-keys/:id/use`
- `POST /api/core/trust-center/counter-keys/:id/cancel`

## Permissões
Validadas no backend:
- `trust_center.view`
- `trust_center.audit_view`
- `trust_center.manage_counter_key`

## Regras de Segurança
- Senha base nunca é armazenada em texto puro (apenas hash SHA-256 com segredo de ambiente)
- Ações sensíveis geram auditoria (`recordAuditEvent`)

## Variáveis de Ambiente
- `TRUST_CENTER_COUNTER_KEY_TTL_MINUTES` (default: `30`)
- `TRUST_CENTER_COUNTER_KEY_MAX_USES` (default: `1`)
- `TRUST_CENTER_COUNTER_KEY_SECRET` (default: `trust-center-secret`)

## Migration
Migration SQL adicionada em:
- `prisma/migrations/20260305213300_add_trust_center_tables/migration.sql`

Inclui tabelas e índices:
- `trust_center_user_access`
- `trust_center_activity`
- `trust_center_counter_keys`
