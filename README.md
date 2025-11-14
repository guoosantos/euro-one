# Euro One Front-end

Interface web construída com React, Vite e Tailwind para integrar-se ao servidor [Traccar](https://www.traccar.org/). O projeto oferece monitoramento em tempo real, dashboards avançados, gestão de eventos, geofences, relatórios e módulos de vídeo/visão computacional.

## Pré-requisitos

- Node.js 20.x
- Servidor Traccar acessível (ex.: `http://3.17.172.94:8082`)

## Configuração

1. Copie `.env.example` para `.env` e configure as variáveis de ambiente que serão compartilhadas entre front-end (Vite) e o backend Node:

   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_API_BASE_URL=http://localhost:3001

   # Backend
   TRACCAR_BASE_URL=http://3.17.172.94:8082
   TRACCAR_ADMIN_USER=admin@euro-one
   TRACCAR_ADMIN_PASSWORD=senha_segura
   JWT_SECRET=altere-esta-chave
   ALLOWED_ORIGINS=http://localhost:5173
   ```

   - `VITE_API_BASE_URL` aponta para o backend da plataforma Euro One (por padrão `http://localhost:3001`).
   - O backend utiliza as variáveis `TRACCAR_*` para autenticar-se junto ao Traccar e executar operações administrativas (criação de clientes, usuários, geofences etc.).
   - `JWT_SECRET` define a chave usada para assinar os tokens de sessão emitidos pelo backend.
   - `ALLOWED_ORIGINS` lista as origens autorizadas a consumir a API (separe múltiplas origens por vírgula).

2. Instale as dependências (front-end + backend):

   ```bash
   npm install
   ```

3. Suba o backend que faz proxy/autenticação com o Traccar:

   ```bash
   npm run server
   ```

   O servidor Express ficará disponível em `http://localhost:3001` por padrão.

4. Em um segundo terminal, execute o front-end:

   ```bash
   npm run dev
   ```

   A aplicação React ficará disponível em `http://localhost:5173` consumindo automaticamente o backend configurado na etapa anterior.

   Para facilitar, deixe ambos os terminais abertos ou utilize ferramentas como `tmux`/`foreman` à sua escolha.

## Autenticação

- Utilize seu e-mail e senha cadastrados no backend Euro One (os dados são validados no Traccar via `/api/session`).
- O backend emite um token JWT com papel (`admin`, `manager`, `driver`) e identificador do usuário; o front-end armazena esse token com segurança (localStorage ou cookie HttpOnly).
- Todos os requests utilizam o módulo `src/lib/api.js`, que injeta automaticamente o cabeçalho `Authorization: Bearer <token>` e inclui o token em chamadas subsequentes.
- O endpoint `/api/session` do backend permite restaurar a sessão em recarregamentos; `/api/logout` encerra a sessão.

## Funcionalidades

- **Dashboard**: KPIs de telemetria, ranking de motoristas e gráficos Recharts (velocidade média, distância, eventos, consumo CAN).
- **Monitoramento**: dispositivos e posições em tempo real com polling a cada 10 segundos (via `/api/devices` e `/api/positions/last`).
- **Gestão de clientes**: cadastro, edição e remoção de tenants (usuários *manager* no Traccar) por meio das rotas `/api/clients`.
- **Gestão de usuários**: criação de operadores, gestores e motoristas vinculados a um cliente com controle de permissões (`/api/users`).
- **Eventos**: listagem em tempo real com filtros, configuração de alertas e integração direta com `/api/events`.
- **Geofences**: criação/edição via Leaflet, associação de dispositivos/grupos e sincronização com o Traccar (`/api/geofences`, `/api/permissions`).
- **Relatórios**: geração de relatórios de viagens (`/api/reports/trips`) e exportação CSV/Excel.
- **Vídeo**: player HLS/RTSP com suporte a streams configuradas nos atributos dos dispositivos; exibe status on-line/off-line.
- **Reconhecimento facial**: módulo com integração simulada/real para identificação de motoristas e alertas de fadiga.
- **Temas e i18n**: tema claro/escuro e tradução pt-BR/en-US (Topbar > ícone de idioma).

## Testes

### Unitários

Os testes unitários utilizam o runner nativo do Node (`node --test`) com Jest DOM/RTL para validar hooks e utilitários.

```bash
npm run test
```

### End-to-end

Os testes E2E são implementados com Cypress.

```bash
npm run cypress:open
```

> Ajuste as variáveis de ambiente conforme o ambiente do servidor Traccar de homologação/produção.

## Estrutura principal

- `src/lib/api.js` – cliente Axios configurado com autenticação.
- `src/lib/hooks` – hooks para dispositivos, eventos, geofences, relatórios etc.
- `src/pages` – páginas de monitoramento, dashboard, eventos, geofences, relatórios, vídeo e reconhecimento facial.

## Boas práticas

- Todas as chamadas à API devem utilizar o cliente `api` para garantir headers consistentes.
- Utilize `useTranslation` para textos exibidos ao usuário.
- Prefira componentes responsivos do Tailwind (`md:`, `lg:`) e classes utilitárias definidas em `src/styles.css`.

## Scripts úteis

- `npm run dev` – ambiente de desenvolvimento.
- `npm run build` – build de produção (verifica variáveis de ambiente obrigatórias).
- `npm run preview` – preview local após build.
- `npm run test` – testes unitários.
- `npm run cypress:open` – runner do Cypress.
- `npm run server` – executa o backend Express com integração ao Traccar.

## Suporte ao Traccar

- Devices: `/api/devices`
- Posições: `/api/positions/last`
- Eventos: `/api/events`
- Geofences: `/api/geofences` + `/api/permissions`
- Relatórios: `/api/reports/trips`
- Reconhecimento facial (personalizado): `/api/media/face/alerts`

> Certifique-se de que o Traccar esteja acessível a partir do backend (teste com `curl $TRACCAR_BASE_URL/api/server`) e que o usuário administrador possua privilégios para criar outros usuários/managers.

> Certifique-se de ativar CORS no servidor Traccar ou proxy reverso para permitir chamadas do front-end.
