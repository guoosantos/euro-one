# Trust Center

Modulo dedicado para gestao de acesso ESP32, auditoria de eventos e ciclo de contra-senha.

## Rotas Frontend

- `/trust-center/users` (padrao)
- `/trust-center/activity`
- `/trust-center/counter-key`

## Permissoes

- `trust_center.view`
- `trust_center.audit_view`
- `trust_center.manage_counter_key`

No frontend, o modulo e controlado em `admin -> trust-center` com subniveis `users`, `activity` e `counter-key`.

## Endpoints REST

- `GET /api/trust-center/users`
- `GET /api/trust-center/users/:userId/summary`
- `GET /api/trust-center/users/:userId/history`
- `GET /api/trust-center/activity`
- `GET /api/trust-center/audit`
- `GET /api/trust-center/activity/export`
- `GET /api/trust-center/counter-keys`
- `POST /api/trust-center/counter-keys`
- `POST /api/trust-center/counter-keys/use`
- `POST /api/trust-center/counter-keys/:id/cancel`
- `POST /api/trust-center/challenge/rotate`
- `POST /api/trust-center/counter-keys/simulate`

## Banco de Dados

Migration: `prisma/migrations/20260306093000_add_trust_center_module/migration.sql`

Tabelas:

- `trust_center_user_state`
- `trust_center_event`
- `trust_center_counter_key`

Indices focados em filtros por cliente, estado, dispositivo e data.

## Regras de Seguranca

- senha base (6 digitos) nunca e salva em texto simples
- persistencia usa `base_password_hash` + `base_password_salt`
- acoes sensiveis gravam auditoria em `trust_center_event`
- uso/cancelamento/geracao atualizam trilha de auditoria

## Variaveis de Ambiente (.env)

- `TRUST_CENTER_SECRET` (obrigatoria para producao)
- `TRUST_CENTER_COUNTER_KEY_TTL_MINUTES` (padrao: `30`)
- `TRUST_CENTER_COUNTER_KEY_MAX_USES` (padrao: `1`)
- `TRUST_CENTER_CHALLENGE_SIZE` (padrao: `8`)
- `TRUST_CENTER_COUNTER_KEY_DIGITS` (padrao: `6`)

As regras de expiracao sao aplicadas por tempo e/ou por limite de usos.
