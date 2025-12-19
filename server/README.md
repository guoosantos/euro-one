# Euro One – Backend (server/)

API Node.js/Express responsável por autenticação JWT, proxy e sincronização com o Traccar. Este diretório contém apenas o backend; o front-end está em `client/`.

## Variáveis de ambiente

Crie um `.env` na pasta `server/` a partir de `server/.env.example` e preencha conforme o ambiente:

- `PORT`: porta do servidor Express (padrão `3001`).
- `TRACCAR_BASE_URL`: URL base do Traccar acessível pelo backend.
- `TRACCAR_ADMIN_USER`/`TRACCAR_ADMIN_PASSWORD` ou `TRACCAR_ADMIN_TOKEN`: credenciais administrativas do Traccar.
- `TRACCAR_SYNC_INTERVAL_MS`: intervalo de sincronização de recursos do Traccar.
- **Integração direta com o banco do Traccar (somente leitura):**
  - `TRACCAR_DB_CLIENT`: `mysql` ou `postgresql` conforme o banco do Traccar.
  - `TRACCAR_DB_HOST` / `TRACCAR_DB_PORT`: host e porta do banco Traccar.
  - `TRACCAR_DB_USER` / `TRACCAR_DB_PASSWORD`: credenciais de leitura.
  - `TRACCAR_DB_NAME`: nome do banco Traccar.
- `JWT_SECRET` / `JWT_EXPIRES_IN`: assinatura e expiração dos tokens.
- `ALLOWED_ORIGINS`: lista separada por vírgulas de origens autorizadas no CORS.

## Diferença entre leitura via DB e escrita via API

- **Leitura (relatórios, histórico e telemetria de fallback):** feita direto no banco do Traccar através de `server/services/traccar-db.js`. Use as variáveis `TRACCAR_DB_*` para apontar para o banco oficial do Traccar (MySQL/Postgres). Consultas incluem viagens por período, últimas posições por dispositivo e eventos recentes.
- **Escrita (criação/edição de dispositivos, grupos, comandos, etc.):** continua passando pela API REST do Traccar via `server/services/traccar.js` e `traccarProxy`, preservando regras de autenticação e efeito colateral controlado.

## Passos rápidos de execução

```bash
cd server
cp .env.example .env
# Ajuste as variáveis TRACCAR_* e JWT_* no .env
npm install
npm run start
```

A API ficará disponível em `http://localhost:3001` (ou porta configurada) e servirá as rotas com prefixo `/api`.

## Testes

Execute os testes do backend com:

```bash
npm test
```

Eles cobrem rotas críticas (CRM, telemetria) e a integração de leitura com o banco do Traccar mockado.
