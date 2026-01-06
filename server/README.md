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
- `GEOCODER_PROVIDER`: provider de reverse geocoding (`nominatim` ou `locationiq`).
- `GEOCODER_URL`: URL base do provider (`https://nominatim.openstreetmap.org` ou endpoint do LocationIQ).
- `GEOCODER_API_KEY`: chave do provider (necessária para LocationIQ).
- `GEOCODER_TIMEOUT_MS`: timeout das chamadas de geocoding (ms).
- `GEOCODER_QPS_LIMIT`: limite de chamadas por segundo ao provider.
- `GEOCODER_USER_AGENT`: user-agent enviado ao provider.
- `GEOCODER_GRID_PRECISION`: precisão de grid (casas decimais) para cache persistente.
- `GEOCODER_REUSE_DISTANCE_METERS`: distância máxima (m) para reutilizar endereço por veículo.
- `GEOCODER_MAX_CONCURRENT`: concorrência máxima de chamadas externas de geocode.
- `GEOCODE_QUEUE_DISABLED`: desativa BullMQ/Redis (modo memória).
- `GEOCODE_REDIS_URL`: URL do Redis do BullMQ.
- `GEOCODE_SCAN_INTERVAL_MS`: intervalo do scanner automático de posições sem endereço.
- `GEOCODE_SCAN_LOOKBACK_MINUTES`: janela (min) do scanner para buscar posições recentes.
- `GEOCODE_SCAN_BATCH`: lote máximo por varredura automática.
- `GEOCODE_RETRY_INTERVAL_MS`: intervalo do job recorrente para reprocessar FAILED.
- `GEOCODE_RETRY_BACKOFF_MINUTES`: cooldown mínimo (min) para reprocessar FAILED.
- `ENABLE_DEMO_FALLBACK`: mantenha `false`/ausente em produção. Só habilite (`true`) para ambientes de demonstração sem banco, permitindo o tenant `demo-client` como último recurso.
- `DEMO_LOGIN_ONLY`: modo de demonstração explícito. Quando `true`, a API ignora o banco e usa apenas o tenant de demo **somente se** as credenciais do usuário demo forem informadas.
- `ALLOW_DEMO_FALLBACK_IN_PRODUCTION`: default `false`. Se `ENABLE_DEMO_FALLBACK=true` com `NODE_ENV=production`, o startup emitirá um warning; defina como `true` apenas para permitir esse modo em ambientes de produção controlados.
- `FAIL_ON_DEMO_FALLBACK_IN_PRODUCTION`: default `false`. Quando `true`, o startup aborta se `ENABLE_DEMO_FALLBACK=true` em ambiente de produção sem a permissão explícita acima.

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

### Smoke rápido de autenticação/tenant

```bash
EMAIL="meu-usuario@dominio.com"
PASSWORD="minha-senha"
BASE_URL="http://localhost:3001"

TOKEN=$(curl -s -X POST "$BASE_URL/api/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .token)

# Deve listar os clientes reais vinculados ao usuário autenticado
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/clients"

# Deve listar veículos usando o clientId do token (sem fallback para demo-client)
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/core/vehicles"

# Em produção, qualquer falha de banco deve retornar erro 5xx — nunca deve trocar para o tenant demo-client de forma silenciosa.
```

## Testes

Execute os testes do backend com:

```bash
npm test
```

Eles cobrem rotas críticas (CRM, telemetria) e a integração de leitura com o banco do Traccar mockado.
