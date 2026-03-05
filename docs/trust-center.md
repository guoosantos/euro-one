# Trust Center

## Visão geral

O módulo **Trust Center** é isolado e dedicado a:

- gerenciamento de acessos de usuários/dispositivos ESP32;
- auditoria de ações;
- geração, uso e cancelamento de contra-senha.

Rotas frontend:

- `/trust-center/users`
- `/trust-center/activity`
- `/trust-center/counter-key`

## Permissões funcionais

As permissões funcionais do módulo são:

- `trust_center.view`
- `trust_center.audit_view`
- `trust_center.manage_counter_key`

Fallback por papel (quando não há configuração explícita):

- `admin`, `tenant_admin`, `manager`: todas as permissões;
- `user`: apenas `trust_center.view`.

## Endpoints REST

Base: `/api/trust-center`

- `GET /capabilities`
- `GET /users`
- `GET /users/:id/summary`
- `POST /users/state`
- `GET /activity`
- `GET /activity/export`
- `GET /counter-keys`
- `POST /counter-keys`
- `POST /counter-keys/:id/use`
- `POST /counter-keys/:id/cancel`
- `POST /challenge/rotate`
- `POST /counter-keys/simulate`
- `GET /audit`

## Segurança

- senha base nunca é persistida em texto simples;
- persistência usa `base_password_hash` + `base_password_salt`;
- ações sensíveis registram auditoria (`trust_center`);
- contra-senha usa cálculo com HMAC SHA-256 e segredo `TRUST_CENTER_SECRET`.

## Variáveis de ambiente

- `TRUST_CENTER_SECRET`
- `TRUST_CENTER_COUNTER_KEY_TTL_MINUTES` (default: `60`)
- `TRUST_CENTER_COUNTER_KEY_MAX_USES` (default: `1`)
- `TRUST_CENTER_MAX_ACTIVITY_ROWS` (default: `50000`)
- `TRUST_CENTER_MAX_AUDIT_ROWS` (default: `20000`)

## Migrations

Arquivos de migration SQL:

- `server/migrations/app/20260305193000_create_trust_center_tables.sql`
- `server/migrations/app/20260305193100_create_trust_center_indexes.sql`
