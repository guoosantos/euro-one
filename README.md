# Euro One Front-end

Interface web construída com React, Vite e Tailwind para integrar-se ao servidor [Traccar](https://www.traccar.org/). O projeto oferece monitoramento em tempo real, dashboards avançados, gestão de eventos, geofences, relatórios e módulos de vídeo/visão computacional.

## Pré-requisitos

- Node.js 20.x
- Servidor Traccar acessível (ex.: `http://3.17.172.94:8082`)

## Configuração

1. Copie `.env.example` para `.env` e preencha com as credenciais do Traccar:

   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_TRACCAR_BASE_URL=http://3.17.172.94:8082
   VITE_TRACCAR_USERNAME=seu_usuario
   VITE_TRACCAR_PASSWORD=sua_senha
   # Opcional: caso utilize token
   VITE_TRACCAR_TOKEN=
   ```

   O token pode ser obtido na interface do Traccar. Caso informe usuário/senha, o front-end utilizará Basic Auth; se preferir token JWT/API, basta definir `VITE_TRACCAR_TOKEN`.

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Execute o projeto em modo desenvolvimento:

   ```bash
   npm run dev
   ```

   O aplicativo ficará disponível em `http://localhost:5173`.

## Autenticação

- Utilize o usuário e a senha do Traccar no formulário de login.
- A sessão é mantida em `localStorage` (token `Basic` ou `Bearer`).
- Todas as requisições usam automaticamente o header `Authorization` configurado no módulo `src/lib/api.js`.

## Funcionalidades

- **Dashboard**: KPIs de telemetria, ranking de motoristas e gráficos Recharts (velocidade média, distância, eventos, consumo CAN).
- **Monitoramento**: dispositivos e posições em tempo real com polling a cada 10 segundos.
- **Eventos**: listagem ao vivo com filtros, configuração de alertas e notificações.
- **Geofences**: criação/edição via Leaflet, associação de dispositivos e sincronização com o Traccar.
- **Relatórios**: geração de relatórios de viagens (`/api/reports/trips`) e exportação CSV.
- **Vídeo**: player HLS/RTSP com suporte a URLs nos atributos do dispositivo e streams manuais.
- **Reconhecimento facial**: consumo do endpoint `/media/face/alerts` (ou stub) para alertas de cabine.
- **Temas e i18n**: tema claro/escuro e tradução pt-BR/en-US (Topbar > ícone de idioma).

## Testes

### Unitários

Os testes unitários utilizam Jest + React Testing Library.

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

## Suporte ao Traccar

- Devices: `/api/devices`
- Posições: `/api/positions/last`
- Eventos: `/api/events`
- Geofences: `/api/geofences` + `/api/permissions`
- Relatórios: `/api/reports/trips`
- Reconhecimento facial (personalizado): `/api/media/face/alerts`

> Certifique-se de ativar CORS no servidor Traccar ou proxy reverso para permitir chamadas do front-end.
