# Relatório técnico – Euro One

## Resumo geral do estado atual
- Arquitetura monorepo com backend Express em `server/` e frontend React/Vite em `src/`. Backend exposto via `/api`, com proxy adicional `/api/core` para recursos internos e `/api` para proxy Traccar.
- Persistência em arquivos JSON via `server/services/storage.js` (sem banco relacional); seed de administrador padrão `admin@euro.one` com senha `admin`.
- Integração com Traccar inclui proxy REST (`server/services/traccar.js`), sincronização periódica (`server/services/traccar-sync.js`) e gateway WebSocket que reusa sessão admin (`server/services/traccar-socket.js`).
- Frontend usa contexto de tenant/autenticação (`src/lib/tenant-context.jsx`) com sessões em `localStorage` e Axios com interceptors (`src/lib/api.js`). Rotas privadas encapsuladas em `PrivateRoute` e layout global.

## Backend: rotas, autenticação, autorização e integração
- **Autenticação JWT**: `POST /api/login` em `server/routes/auth.js` valida credenciais via `verifyUserCredentials`, gera token com `signSession` usando `JWT_SECRET`/`JWT_EXPIRES_IN` e retorna `{ token, user }`. Middleware `authenticate` em `server/middleware/auth.js` aceita header Bearer ou cookie `token`, valida expiração e popula `req.user`. Logout apenas limpa cookie (API stateless).
- **Controle de acesso**: `requireRole` implementa hierarquia simples (`admin` > `manager` > `user`). Rotas de clientes/usuários/grupos e core usam `authenticate` + `requireRole` para restringir operações e checam `clientId` para isolar tenants.
- **Rotas principais**:
  - `/api/clients` (GET/POST/PUT/DELETE) para CRUD de clientes; admin tem visão global, gestores acessam somente seu `clientId`.
  - `/api/users` (GET/POST/PUT/DELETE) cria e gerencia usuários vinculados a clientes; admin pode criar qualquer papel, gestor cria somente `user` no próprio cliente.
  - `/api/core/models`, `/devices`, `/devices/import`, `/chips`, `/vehicles` consolidam lógica de inventário, vínculos chip↔device↔veículo e enriquecimento com dados do Traccar (status de conexão, últimas comunicações) usando cache sincronizado.
  - `/api/core/devices/import` usa cache do Traccar para sugerir novos devices e `/api/core/devices` lista apenas equipamentos do cliente solicitado.
  - `/api/core` exige autenticação; `/api/proxy` expõe pass-through para endpoints Traccar com filtros de dispositivos/grupos conforme tenant, evitando vazamento entre clientes.
- **Modelos/persistência**: dados guardados em Map + JSON local. Users têm papéis `admin|manager|user`; clients mantêm limites de devices/users; devices, models, chips e vehicles têm referências cruzadas e atributos custom.
- **Tratamento de erros**: uso consistente de `http-errors` com mensagens em português; handler global converte para JSON com `message` e `details` (fora de produção). 404 genérico para rotas não mapeadas.

## Frontend: autenticação, rotas, UX e comunicação com API
- **Sessão**: `src/lib/api.js` cria Axios com `baseURL=/api`, `withCredentials=true`, anexa `Authorization: Bearer <token>` se existir e limpa sessão em 401 via `clearStoredSession` + notificações a handlers.
- **Tenant/auth context**: `TenantProvider` (em `src/lib/tenant-context.jsx`) restaura sessão do storage, chama `/api/session`, define `tenantId` conforme papel, carrega clientes para admin (`/api/clients`), expõe `login/logout/refreshClients`. Logout chama `/api/logout` mas fluxo é totalmente JWT stateless.
- **Roteamento**: `src/App.jsx` define rotas protegidas por `<PrivateRoute />`, incluindo dashboard, monitoramento, equipamentos, veículos, relatórios, etc. Há duas rotas `*`: uma dentro do guard (renderiza NotFound) e outra pública (NotFound), o que pode levar a redirecionamentos diferentes conforme estado de login.
- **NotFound**: página detecta autenticação para decidir CTA (dashboard ou login) e oferece atalho para `/monitoring` quando logado.
- **UX**: há estados de carregamento/erro básicos no contexto; páginas usam componentes de tabela/cards, mas mensagens de erro nas telas (ex.: importação de dispositivos) refletem respostas HTTP do backend.

## Integração com Traccar
- **Proxy REST**: `server/services/traccar.js` monta `BASE_URL=<TRACCAR_BASE_URL>/api`, suporta auth via token/bearer/basic ou sessão admin (`JSESSIONID`). `traccarProxy` repassa método/url/params com tratamento de erros e usa credenciais admin por padrão.
- **Sincronização**: `startTraccarSyncJob` (config `TRACCAR_SYNC_INTERVAL_MS`, default 5 min) sincroniza dispositivos, grupos, motoristas e geofences para cache em memória, usado por `/api/core/devices` e importação.
- **WebSocket**: `server/services/traccar-socket.js` abre conexão com `/api/socket` usando sessão admin, repassa frames para clientes conectados e filtra posições/eventos por `deviceId` pertencente ao cliente do token JWT do WS. Requer `JSESSIONID` válido; reconecta automaticamente.
- **Fluxos de importação**: `/api/core/devices/import` GET compara cache do Traccar com devices locais para sugerir novos; POST garante `clientId` coerente, valida duplicidade por `uniqueId`/`traccarId`, cria/associa grupo do cliente no Traccar se necessário, atualiza atributos (modelo) e grava dispositivo local.
- **Segurança de escopo**: proxy `/api/proxy` força filtros de `deviceId`/`groupId` para usuários não-admin antes de encaminhar ao Traccar, evitando acesso a recursos de outros clientes mesmo via relatórios ou endpoints brutos.

## Variáveis de ambiente e deploy
- `.env.example` define `PORT`, `VITE_API_BASE_URL`, `TRACCAR_BASE_URL`, credenciais admin (`TRACCAR_ADMIN_USER/PASSWORD` ou `TRACCAR_ADMIN_TOKEN`), `JWT_SECRET`, `ALLOWED_ORIGINS`. `config.js` também aceita `JWT_EXPIRES_IN` e `TRACCAR_SYNC_INTERVAL_MS`.
- Vite proxy em `vite.config.js` direciona `/api` e `/core` para backend (host configurável por `VITE_API_BASE_URL`).
- CORS dinâmico: backend permite origens do Vite (localhost:5173-5190) e lista `ALLOWED_ORIGINS`; responde 403 para origem não autorizada. Payloads JSON limitados a 10MB.
- Sem Docker/nginx no repositório; storage em disco (`server/data/*.json`) exige volume persistente no deploy real. Port padrão 3001.

## Fluxos ponta-a-ponta
1. **Login**: frontend envia `/api/login` com email/senha → backend valida credenciais locais → retorna JWT + usuário; Axios salva em `localStorage`, TenantProvider hidrata sessão e carrega clientes.
2. **Dashboard/monitoramento**: chamadas via Axios para `/api/core/devices`, `/api/core/vehicles`, etc., retornam dados enriquecidos com status do Traccar via cache; para dados brutos/relatórios, frontend usa `/api/proxy/...` que aplica filtros por `deviceId`/`groupId` antes de alcançar o Traccar.
3. **Importar dispositivo**: frontend chama `/api/core/devices/import` GET para lista pendente; POST envia `traccarId`/`uniqueId` e opcional `modelId` → backend garante grupo do cliente no Traccar, atualiza device remoto se necessário, cria device local vinculado ao cliente e retorna objeto já enriquecido (modelo, chip, veículo, status de conexão).
4. **Vínculos chip/veículo**: endpoints de `/api/core/chips` e `/api/core/vehicles` gerenciam associações bidirecionais, garantindo coerência e desassociação ao mover recursos.
5. **Relatórios/posições**: frontend pode consumir `/api/proxy/reports/...` ou WebSocket; middleware aplica filtragem por devices do cliente antes de repassar ao Traccar.

## Erros comuns e riscos
- **Armazenamento em arquivo**: sem locking/concurrency; risco de corrupção em múltiplas instâncias ou pods.
- **Sessão admin do Traccar**: falha de autenticação gera 401 em proxies/importação; falta de retry persistente se `TRACCAR_ADMIN_*` ausente/errado.
- **Rotas `*` duplicadas no React Router**: pode gerar comportamento inconsistente (ex.: usuário logado acessando rota inexistente pode receber layout + 404, enquanto anônimo recebe 404 simples), dificultando SEO/analytics e tratamento de erro uniforme.
- **Sem refresh token**: JWT de longa duração (`7d` por padrão) sem mecanismo de revogação; logout só limpa storage local.
- **Exposure via `/api/proxy/devices`**: embora filtre por `deviceId`/`groupId`, ainda expõe estrutura do Traccar diretamente; requer confiança de que cache/local mapping está atualizado.

## Sugestões de melhoria (priorizadas)
1. **Persistência robusta**: migrar para banco relacional (ex.: Postgres + Prisma) com migrations; remover storage em arquivo para evitar perda/corrupção.
2. **Hardening de autenticação**: acrescentar refresh token + blacklist/opção de rotação; expirar tokens curtos (ex.: 1h) e renovar via refresh seguro. Implementar `/api/logout` invalidando refresh.
3. **Isolamento multi-tenant total**: mover consumo do Traccar do frontend para backend (evitar depender de `/api/proxy` aberto); criar endpoints específicos (`/api/monitoring/positions`, `/api/reports/...`) que retornem apenas dados filtrados por cliente.
4. **UX e rotas 404**: unificar rota `*` para renderizar `NotFound` com redirect condicional, removendo `<Navigate>` implícito; adicionar toasts/mensagens amigáveis para erros de importação/login.
5. **Monitoramento do Traccar**: reforçar reconexão/relogin automático no WebSocket/admin token; expor métricas de saúde (ex.: `/health/traccar` indicando status da sessão).
6. **Configuração de deploy**: adicionar Dockerfile/docker-compose e configuração de volumes para `server/data`; parametrizar CORS e Vite proxy para produção; documentar `TRACCAR_ADMIN_TOKEN` como alternativa a user/pass.
7. **Auditoria e logs**: registrar operações sensíveis (criação de usuário/cliente, importação de devices) com `req.user` e `clientId` para rastreabilidade.

## Checklist pronto para produção
- [ ] Definir e armazenar `JWT_SECRET` forte; reduzir `JWT_EXPIRES_IN` e adicionar refresh tokens.
- [ ] Preencher `TRACCAR_BASE_URL` e `TRACCAR_ADMIN_*` ou `TRACCAR_ADMIN_TOKEN`; validar conectividade inicial.
- [ ] Configurar `ALLOWED_ORIGINS` com domínios reais; revisar CORS para HTTPS.
- [ ] Migrar storage para banco persistente; criar seeds/migrações para admin inicial e clientes.
- [ ] Implementar observabilidade: logs estruturados, métricas de saúde Traccar, alertas de falha de sync/import.
- [ ] Revisar rotas do frontend (`*`) e tratamentos de erro para UX consistente.
- [ ] Prover containerização (Docker/Compose) e instruções de deploy, incluindo volumes para dados e build Vite servido por CDN/Nginx.
