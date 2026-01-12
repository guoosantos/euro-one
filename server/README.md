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
- **Integração XDM (Embarque de Itinerário):**
  - `XDM_AUTH_URL`: endpoint OAuth2 (client_credentials) do XDM.
  - `XDM_BASE_URL`: base URL da API XDM (sem `/` no final).
  - `XDM_CLIENT_ID` / `XDM_CLIENT_SECRET`: credenciais do client OAuth2.
  - `XDM_AUTH_MODE`: `post` (default) usa `client_secret_post`; `basic` usa `client_secret_basic`.
  - `XDM_OAUTH_SCOPE`: escopo OAuth2 opcional (enviado no token request).
  - `XDM_OAUTH_AUDIENCE`: audience OAuth2 opcional (enviado no token request).
  - `XDM_DEALER_ID`: dealerId exigido para criação/atualização de Geozone Groups.
  - `XDM_CONFIG_ID` **ou** `XDM_CONFIG_NAME`: configuração base a ser aplicada no deploy.
  - `XDM_GEOZONE_GROUP_OVERRIDE_ID`: opcional. ID numérico (int32) do override que aponta para o Geozone Group (ex.: `1234`).
    - Use quando já conhece o ID do override; ele tem precedência sobre a descoberta automática.
  - `XDM_GEOZONE_GROUP_OVERRIDE_KEY`: chave lógica do campo de Geozone Group no template (default `geoGroup`).
    - Quando `XDM_GEOZONE_GROUP_OVERRIDE_ID` não está definido, o backend busca o `userElementId` automaticamente no XDM via `AdminTemplates/filter` e cacheia o resultado (memória + storage).
  - `XDM_TIMEOUT_MS`: timeout (ms) de chamadas XDM.
  - `XDM_MAX_RETRIES`: número máximo de tentativas em 429/5xx.
  - `XDM_RETRY_BASE_MS`: base do backoff exponencial (ms).
  - `XDM_DEPLOYMENT_POLL_INTERVAL_MS`: intervalo de polling do status (ms).
  - `XDM_DEPLOYMENT_TIMEOUT_MS`: timeout máximo do deploy antes de marcar `TIMEOUT` (ms).
  - `XDM_GEOFENCE_MAX_POINTS`: limite máximo de pontos enviados por geofence. Se vazio/`0`, não limita. Se o XDM rejeitar payload grande, ajuste os pontos ou configure este limite.

## Fluxo de Embarque (EuroOne → XDM → Device)

1. O usuário confirma o embarque em **Itinerários** no front-end.
2. O backend cria um deployment por par `itineraryId + vehicleId` e inicia o processamento assíncrono.
3. Para cada deployment:
   - Sincroniza as geofences (cercas/rotas/alvos) no XDM via endpoints `geozones`.
   - Garante que o Geozone Group do itinerário exista e esteja atualizado.
  - Aplica o Geozone Group via `settingsOverrides` (XDM); em caso de falha, tenta fallback no endpoint interno `Devices2/UpdateDeviceSdk`.
   - Cria um rollout de configuração para o device usando `serializedConfigId`.
4. Um poller periódico consulta o rollout e atualiza o status para `DEPLOYED`, `FAILED` ou `TIMEOUT`.
5. A aba **Histórico** do front reflete o status atual (Enviado/Deploying/Deployed/Failed/Timeout).

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

## Execução em produção com PM2

1. Mantenha o `ecosystem.config.cjs` mínimo (sem secrets). As credenciais e variáveis `XDM_*`, `JWT_*`, `TRACCAR_*` devem ficar em `server/.env`.
2. Inicie o backend com PM2:

   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   ```

3. Verifique se as variáveis foram aplicadas:

   ```bash
   pm2 show euro-one-server
   pm2 logs euro-one-server --lines 200
   ```

4. Para confirmar que o backend carregou as variáveis corretas, procure no log por mensagens `[startup]` e pelos diagnósticos `[xdm]`.
5. Em produção (`NODE_ENV=production`), o backend carrega automaticamente `/home/ubuntu/euro-one/server/.env` sem precisar de `source`. Sempre reinicie com:

   ```bash
   pm2 restart --update-env
   ```

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

## Smoke test de autenticação XDM

Para diagnosticar `invalid_client` (401) no OAuth2 do XDM, execute:

```bash
node scripts/xdm-auth-smoke.js
```

O script usa `XDM_AUTH_URL`, `XDM_CLIENT_ID` e `XDM_CLIENT_SECRET` do `.env` (com `XDM_OAUTH_SCOPE`/`XDM_OAUTH_AUDIENCE` opcionais) e testa automaticamente os modos `post` e `basic`, imprimindo status/preview do token sem expor o secret.

### Checklist de troubleshooting para `401 invalid_client`

- Confirme se o client permite o grant `client_credentials` no realm correto (`XDM_AUTH_URL`).
- Verifique se `XDM_CLIENT_ID` e `XDM_CLIENT_SECRET` correspondem ao client OAuth informado no XDM.
- Teste ambos os modos:
  - `XDM_AUTH_MODE=post` (client_secret_post)
- `XDM_AUTH_MODE=basic` (client_secret_basic)

### Descobrir o ID do override de Geozone Group

Use o script abaixo para descobrir e salvar o `userElementId` do override associado ao Geozone Group:

```bash
node scripts/xdm-discover-geoGroup-override-id.js
```

O script consulta `/api/external/v1/AdminTemplates/filter`, busca pela chave definida em `XDM_GEOZONE_GROUP_OVERRIDE_KEY` e salva o ID encontrado no storage local (`xdm_override_elements`).

### Sincronizar itinerário manualmente

```bash
node scripts/xdm-sync-itinerary.js <itineraryId> [clientId]
```
- Garanta que não há espaços/aspas extras no `.env` (o backend remove aspas automaticamente).
