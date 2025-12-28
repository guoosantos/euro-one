# Euro One

Monorepo com interface web (React + Vite + Tailwind) e backend Node.js para integrar-se ao servidor [Traccar](https://www.traccar.org/). O projeto oferece monitoramento em tempo real, dashboards avançados, gestão de eventos, geofences, relatórios e módulos de vídeo/visão computacional.

## Estrutura de pastas

- `client/`: front-end Vite/React (inclui testes e configuração do Tailwind/Cypress)
- `server/`: API Node/Express responsável por autenticação, proxy e sincronização com o Traccar
- `scripts/`: utilitários de build/deploy

Cada pacote é um workspace npm independente, mas as dependências são instaladas com um único `npm install` na raiz.

## Pré-requisitos

- Node.js 20.x ou superior
- Servidor Traccar acessível (ex.: `http://localhost:8082`)

## Configuração

1. Copie as variáveis de exemplo e configure os ambientes do front-end e backend:

   ```bash
   cp .env.example .env
   cp .env.example client/.env
   cp .env.example server/.env
   ```

   Variáveis principais:

   - `VITE_API_BASE_URL`: **sempre** apontar para a origem do backend Euro One (dev: `http://localhost:3001`).
   - `VITE_TRACCAR_BASE_URL`: origem do Traccar para recursos de mapa/heatmap (ex.: `http://localhost:8082`).
   - `VITE_MAP_TILE_URL`: URL do tile server para o Leaflet (padrão OSM escuro).
   - `VITE_GOOGLE_MAPS_KEY`: (opcional) chave para autocomplete/recursos do Google Maps.
   - `PORT`: porta do backend Express (padrão `3001`).
   - `TRACCAR_BASE_URL`: URL do servidor Traccar acessível pelo backend.
   - `TRACCAR_ADMIN_USER` / `TRACCAR_ADMIN_PASSWORD` ou `TRACCAR_ADMIN_TOKEN`: credenciais administrativas do Traccar.
   - `TRACCAR_SYNC_INTERVAL_MS`: intervalo (ms) entre sincronizações automáticas de devices/grupos/geofences.
- `TRACCAR_DB_CLIENT`, `TRACCAR_DB_HOST`, `TRACCAR_DB_PORT`, `TRACCAR_DB_USER`, `TRACCAR_DB_PASSWORD`, `TRACCAR_DB_NAME`: conexão
  somente leitura com o banco do Traccar (MySQL/Postgres) para relatórios e telemetria de fallback.
- `JWT_SECRET` e `JWT_EXPIRES_IN`: chaves para assinar e expirar os tokens emitidos pelo backend.
- `ALLOWED_ORIGINS`: lista de origens permitidas no CORS (inclua `http://localhost:5173` para desenvolvimento com Vite).
- `ENABLE_DEMO_FALLBACK`: defina como `true` **apenas** em ambientes de demonstração sem banco para liberar os dados `demo-client`. Em produção, deixe ausente/false para evitar quedas silenciosas para o tenant demo.

2. Instale as dependências (front-end + backend) a partir da raiz do repositório:

   ```bash
   npm install
   ```

3. Suba o backend que faz proxy/autenticação com o Traccar:

   ```bash
   npm run start:server
   ```

   O servidor Express ficará disponível em `http://localhost:3001` por padrão.

4. Em um segundo terminal, execute o front-end:

   ```bash
   npm run dev
   ```

   A aplicação React ficará disponível em `http://localhost:5173` consumindo automaticamente o backend configurado na etapa anterior.

   Para facilitar, deixe ambos os terminais abertos ou utilize ferramentas como `tmux`/`foreman` à sua escolha.

5. Para evitar erros 500 no `/api` quando o front estiver em Vite sem backend rodando, utilize o atalho abaixo que sobe client e servidor juntos:

   ```bash
   npm run dev:all
   ```

## Notas rápidas

- O WebSocket de telemetria é servido em `/ws/live` e o front monta a URL a partir de `VITE_API_BASE_URL`, alternando entre `ws://` e `wss://` conforme o protocolo.
- Para recursos de mapas/heatmap, configure `VITE_TRACCAR_BASE_URL` apontando para o mesmo host utilizado pelo backend (`TRACCAR_BASE_URL`).
- Tiles customizados para o mapa podem ser definidos via `VITE_MAP_TILE_URL`.

## Map matching (OSRM) para rotas mais precisas

- O endpoint `/api/map-matching` do backend utiliza `OSRM_BASE_URL` (ou `MAP_MATCH_BASE_URL`) para ajustar trajetos às ruas (apontando para o serviço `/match/v1/...` do OSRM, com ou sem barra no final).
- Sem essa variável o backend devolve `provider="passthrough"` e o front exibe uma rota reta apenas ligando os pontos.
- Exemplo de execução local do OSRM:

  ```bash
  docker run -p 5000:5000 osrm/osrm-backend osrm-routed --algorithm mld /data/region.osrm
  export OSRM_BASE_URL=http://localhost:5000
  ```

- Defina `OSRM_BASE_URL` no ambiente do backend e mantenha `VITE_API_BASE_URL` apontando para ele para liberar rotas “estilo Google Maps” no módulo de Trajetos.

## Autenticação

- Utilize seu e-mail e senha cadastrados no backend Euro One (os dados são validados no Traccar via `/api/session`).
- O backend emite um token JWT com papel (`admin`, `manager`, `driver`) e identificador do usuário; o front-end armazena esse token com segurança (localStorage ou cookie HttpOnly).
- Todos os requests utilizam o módulo `client/src/lib/api.js` (em conjunto com as rotas declaradas em `client/src/lib/api-routes.js`), que normaliza URLs com o prefixo `/api` e injeta automaticamente o cabeçalho `Authorization: Bearer <token>`.
- O endpoint `/api/session` do backend permite restaurar a sessão em recarregamentos; `/api/logout` encerra a sessão.

## Funcionalidades

- **Dashboard operacional**: cards de eventos recentes, heatmap inline, performance de viagens, veículos em rota/alerta e serviços do mês, todos com navegação direta para os módulos especializados.
- **Monitoramento**: filtros rápidos (online, válidos, sem sinal, zonas perigosas), mapa com popups estilo Traccar, tabela de telemetria com colunas configuráveis e exportação CSV para `/api/positions/export`.
- **Analytics / Heatmap**: filtros por período, tipo de evento (inclusive presets de crime) e grupo/tenant, renderização Leaflet + heat layer e ranking das top 10 zonas.
- **Entregas e coletas (tasks)**: cadastro, timeline e edição via `/api/tasks`, com criação de geofences automáticas e status integrados à home/monitoramento.
- **Gestão de clientes e usuários**: cadastro, edição e remoção de tenants (usuários *manager* no Traccar) e operadores/motoristas com controle de permissões (`/api/clients`, `/api/users`).
- **Eventos**: listagem em tempo real com filtros, configuração de alertas e integração direta com `/api/events`.
- **Geofences**: criação/edição via Leaflet, associação de dispositivos/grupos e sincronização com o Traccar (`/api/geofences`, `/api/permissions`).
- **Relatórios**: geração de relatórios de viagens (`/api/reports/trips`) e exportação CSV/Excel.
- **Exportação de posições**: download CSV de posições filtradas com `/api/positions/export`.
- **Vídeo e visão computacional**: player HLS/RTSP com streams configuradas nos atributos dos dispositivos, módulo de reconhecimento facial e alertas de fadiga.
- **Temas e i18n**: tema claro/escuro e tradução pt-BR/en-US (Topbar > ícone de idioma).

## Validação rápida de autenticação e tenant

Com o backend rodando em `http://localhost:3001` e um usuário real cadastrado no Postgres:

```bash
# login (gera token JWT válido)
TOKEN=$(curl -s -X POST http://localhost:3001/api/login -H "Content-Type: application/json" -d '{"email":"meu-usuario@dominio.com","password":"minha-senha"}' | jq -r .token)

# listar clientes reais vinculados ao usuário
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/clients | jq

# listar veículos usando o clientId do token (sem cair em demo-client)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/core/vehicles | jq '.vehicles | length'
```

Em produção, qualquer ausência de `clientId` em tokens ou requisições autenticadas deve retornar erro claro (401/400), sem recair no tenant `demo-client`.

## Destaques em relação aos concorrentes

- **UX fluida e responsiva**: interface React + Tailwind com microinterações (Framer Motion), experiência mobile-first e componentes shadcn padronizados, superando UIs legadas e engessadas.
- **Integração total com rastreadores**: sincronização contínua com Traccar (API e banco), telemetria em tempo real e comandos diretos, mantendo WebSocket `/ws/live` e pipelines de retry/log para estabilidade.
- **Gestão unificada**: um único painel multi-tenant para clientes, usuários, contratos e dispositivos, evitando a fragmentação típica de ERPs genéricos; admins e managers operam com filtros e permissões consistentes.
- **CRM nativo automatizado**: pipeline Kanban de vendas, deals ligados a clientes, lembretes e atividades integrados; conversão de leads cria cliente, usuário/grupo no Traccar e vincula dispositivos automaticamente.
- **Segurança e confiabilidade**: controle de acesso por papel/tenant, respostas de erro padronizadas e políticas claras de conexão com o Traccar (timeouts, retries, cache), reduzindo quedas e inconsistências.

## Fase 5 — testes finais e deploy

- Consulte `docs/fase5-checklist.md` para o checklist de aceite funcional, otimizações e passos de deploy.
- Para validar rastreadores e CRM ponta a ponta, siga o roteiro rápido em `docs/smoke-tests-traccar.md` (migrations, seeds, cadastro de tenants/usuários, associação de devices e conversão de leads).
- Antes de publicar, rode `npm run build` na raiz para validar o pacote front-end e garanta que o backend sobe com `NODE_ENV=production` e variáveis (`VITE_API_BASE_URL`, `PORT`, `TRACCAR_BASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`) configuradas no host escolhido (Vercel/Render/Railway).
- Execute `npx prisma migrate deploy` (ou equivalente na pipeline) antes de iniciar o backend em produção para garantir que os modelos Prisma estejam sincronizados com o banco.
- Registre no checklist as URLs públicas e quaisquer etapas manuais de provisionamento realizadas.

## Plano técnico de execução

O detalhamento das quatro fases concluídas (migração Prisma, unificação de menus/RBAC, modernização de UI e CRM 2.0) está documentado em `docs/plano-tecnico-execucao.md`, incluindo a ordem recomendada para preparar ambientes (migrate, seed, migração do storage e subida dos serviços).
