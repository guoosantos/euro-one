# Trust Center

Módulo dedicado para gestão de acessos ESP32, auditoria operacional e geração de contra-senhas.

## Permissões

- `trust_center.view`
- `trust_center.audit_view`
- `trust_center.manage_counter_key`

## Rotas frontend

- `/trust-center/users` (padrão)
- `/trust-center/activity`
- `/trust-center/counter-key`

## Endpoints REST

- `GET /api/trust-center/options`
- `GET /api/trust-center/users`
- `GET /api/trust-center/users/:stateId/summary`
- `POST /api/trust-center/challenge/rotate`
- `POST /api/trust-center/counter-keys/simulate`
- `GET /api/trust-center/counter-keys`
- `POST /api/trust-center/counter-keys`
- `POST /api/trust-center/counter-keys/:id/use`
- `POST /api/trust-center/counter-keys/:id/cancel`
- `GET /api/trust-center/activity`
- `GET /api/trust-center/activity/export`
- `GET /api/trust-center/audit`

## Segurança

- Senha base de 6 dígitos nunca é persistida em texto puro.
- Persistência usa hash criptográfico (`hashPassword`) em `basePinHash`.
- Operações sensíveis são registradas em auditoria.

## Expiração de contra-senha (.env)

- `TRUST_CENTER_COUNTER_KEY_TTL_MINUTES`
- `TRUST_CENTER_COUNTER_KEY_MAX_USES`
- `TRUST_CENTER_COUNTER_KEY_SECRET`
- `TRUST_CENTER_CHALLENGE_LENGTH`
- `TRUST_CENTER_COUNTER_KEY_LENGTH`

## Banco de dados

Migração Prisma:

- `prisma/migrations/20260305190000_add_trust_center_module/migration.sql`

Tabelas criadas:

- `trust_center_user_states`
- `trust_center_activity_events`
- `trust_center_counter_keys`
