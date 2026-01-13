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
  - `XDM_GEOZONE_GROUP_OVERRIDE_ID`: **legado**. ID numérico (int32) do override que aponta para o Geozone Group (ex.: `1234`).
    - Válido apenas para o grupo de Itinerário (slot 1). Para Targets/Entry, use IDs dedicados por role.
    - O `overrideId` representa o campo/configuração na base do XDM e costuma ser o mesmo para todos os devices da mesma config.
    - O `geozoneGroupId` é o valor aplicado no override (ID do grupo no XDM) e varia conforme o itinerário.
  - Para múltiplos grupos (Itinerário/Alvos/Entrada), defina overrides dedicados (prioridade por role):
    - `XDM_GEOZONE_GROUP_OVERRIDE_ID_ITINERARY`, `XDM_GEOZONE_GROUP_OVERRIDE_ID_TARGETS`, `XDM_GEOZONE_GROUP_OVERRIDE_ID_ENTRY`
    - `XDM_GEOZONE_GROUP_OVERRIDE_KEY_ITINERARY`, `XDM_GEOZONE_GROUP_OVERRIDE_KEY_TARGETS`, `XDM_GEOZONE_GROUP_OVERRIDE_KEY_ENTRY`
    - Alternativamente, use listas ordenadas por índice: `XDM_GEOZONE_GROUP_OVERRIDE_IDS="123,456,789"` e `XDM_GEOZONE_GROUP_OVERRIDE_KEYS="geoGroup1,geoGroup2,geoGroup3"`.
      - **Ordem obrigatória**: `itinerary`, `targets`, `entry` (3 IDs únicos e int32).
    - Para o template `XG37 common settings V5 - EURO`, os nomes esperados são `Itinerario`, `Alvos`, `Entrada`.
      - Para evitar lookup em `geoGroup2/3`, defina sempre as chaves por role (prioridade máxima).
      - Se os nomes não forem definidos via env, o resolver tenta em cascata (primeiro `Itinerario/Alvos/Entrada` quando `XDM_CONFIG_NAME` contém XG37/EURO, depois `geoGroup1/2/3`).
  - `XDM_GEOZONE_GROUP_OVERRIDE_KEY`: legado. Use apenas se não houver `XDM_GEOZONE_GROUP_OVERRIDE_ID`/keys por role.
  - `XDM_ITINERARY_SIGNATURE_OVERRIDE_ID`: overrideId (int32) do sensor configurável U32 usado para a assinatura do itinerário (ex.: `Sensor_U32UserDefined0`).
  - `XDM_ITINERARY_SIGNATURE_OVERRIDE_KEY`: nome do elemento na config (opcional, usado apenas para diagnóstico/logs).
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
  - Aplica o Geozone Group via `settingsOverrides` (XDM) usando `XDM_GEOZONE_GROUP_OVERRIDE_ID`.
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

Use o script abaixo para encontrar o ID numérico do override associado ao geozone group no XDM (via configuração/Template) e salvar no storage local:

```bash
node scripts/xdm-discover-override-element.js
```

O script consulta o template configurado em `XDM_CONFIG_NAME`, percorre categorias/elementos e persiste o `userElementId` encontrado para o override `XDM_GEOZONE_GROUP_OVERRIDE_KEY` (padrão `geoGroup`).
- Garanta que `XDM_DEALER_ID` e `XDM_CONFIG_NAME` estejam configurados no `.env`.

#### Observação sobre templates sem `geoGroup2`

Alguns templates de produção (ex.: `XG37 common settings V5 - EURO`) não possuem os campos de geozone group nomeados como `geoGroup1/2/3`. Nesses casos, o resolver:

- tenta primeiro encontrar o override pelo nome exato do elemento (`overrideKey`);
- se `XDM_CONFIG_NAME` identificar o template XG37/EURO, o fallback inicial é `Itinerario`/`Alvos`/`Entrada`;
- senão, o fallback inicial é `geoGroup1`/`geoGroup2`/`geoGroup3`;
- se o nome principal falhar, tenta o nome alternativo em cascata por role;
- se não encontrar, faz um fallback automático por índice dentro da seção de **Geofencing** (identificando elementos com label de “Geozone group”);
- a ordem do fallback é fixa: **1=Itinerário**, **2=Alvos**, **3=Entrada**.

Isso garante que o deploy use três slots distintos mesmo quando o template não nomeia `geoGroup2`/`geoGroup3`.
