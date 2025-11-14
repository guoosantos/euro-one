# Plataforma de Rastreamento Veicular Multi-Tenant

Interface da plataforma de rastreamento veicular, mostrando a barra lateral com menus colapsáveis e a barra superior com busca global e ícones. A solução consiste em um frontend web moderno (React + Vite + Tailwind) e um backend robusto (Node/Express ou Python/FastAPI) integrados à API do Traccar para comunicação com rastreadores. O sistema suporta multi-tenancy, permitindo atender múltiplos clientes (tenants) isoladamente, com autenticação própria e controle de acesso por cliente.

## Visão Geral da Arquitetura

- **Frontend**: React + Vite + Tailwind CSS seguindo a identidade visual do projeto Euro.
- **Backend**: Node.js com Express (ou Python com FastAPI) atuando como fachada REST para o Traccar e para os dados do negócio.
- **Integração**: Comunicação contínua com a API do Traccar para telemetria, eventos e controle de dispositivos.
- **Multi-tenancy**: Isolamento lógico por cliente, com autenticação própria, papéis de usuário e filtros de acesso.

## Frontend (React + Vite + Tailwind)

A aplicação mantém a estrutura visual atual do projeto Euro, com layout responsivo, componentes reutilizáveis e experiência consistente. Elementos-chave:

- **Topbar fixa** com título, busca global (placa, nome do veículo, etc.) e ícones de notificações e perfil.
- **Sidebar colapsável** com menus hierárquicos. Quando colapsada, exibe apenas ícones.
  - *Home*: dashboard com estatísticas de frota e alertas recentes.
  - *Monitoramento*: mapa em tempo real dos veículos.
  - *Trajetos*: replay de rotas históricas.
  - *Dispositivos*: submenu com Produtos, Chips e Equipamentos para CRUD completo dos ativos de rastreamento.
  - *Frotas*: submenu para Veículos, Documentos, Serviços, Entregas e Cercas (geofences).
  - *Euro View*: módulo visual com Eventos, Vídeos, Reconhecimento Facial e Live.
  - *Analytics*: dashboards de uso, desempenho e segurança.
  - *Admin/Clientes*: gestão de tenants e usuários, com permissões distintas para administradores master e admins de cliente.

### Monitoramento em Tempo Real

- **Mapa (React-Leaflet)** com clustering de marcadores, exibição de geofences e filtros rápidos (status, grupos, alertas).
- **Segue veículo** para manter o mapa centralizado em um veículo selecionado.
- **Resumo lateral** com KPIs de veículos online/offline, alertas ativos, movimentação e telemetria.
- **Tabela configurável** listando placa, última atualização, endereço via geocodificação reversa, velocidade, ignição, odômetro, bateria, sinal, satélites e status.
- **Ações rápidas por veículo**: abrir replay, abrir Google Maps (`https://google.com/maps/search/?api=1&query={lat},{lon}`), enviar comandos e acessar detalhes completos.
- **Atualização periódica** via polling (30 s) com possibilidade de WebSocket do Traccar (`/api/socket`) para push em tempo real.

### Replay de Trajetos

- **Seleção de veículo e intervalo** para reproduzir percursos históricos.
- **Mapa com rota plotada** e marcadores de início/fim.
- **Slider temporal** com animação (play/pause) para visualizar a evolução do trajeto.
- **KPIs de percurso**: distância, duração, velocidade média, tempo parado vs. em movimento.
- **Exportação** para XLSX, CSV ou KML usando o endpoint `/api/reports/route` (com `Accept: application/json`).
- **Eventos sincronizados** via `/api/reports/events`, permitindo filtrar por tipo.

### Gestão de Dispositivos

- **Produtos**: cadastro de modelos de rastreadores com fabricante, modelo e especificações.
- **Chips**: administração de SIM cards (telefone, operadora, ICCID, plano, associação a equipamento).
- **Equipamentos**: controle de dispositivos físicos (IMEI/uniqueId, status, vinculação a veículo e chip, configurações).
- **Estoque**: visão consolidada de ativos não alocados.
- **CRUD completo** com listagens filtráveis, paginação, formulários e notificações de sucesso/erro.

### Gestão de Frotas

- **Veículos**: cadastro com placa, modelo, motorista e associação a equipamentos. Indicadores de status online/offline.
- **Documentos**: upload, data de vencimento e alertas preventivos.
- **Serviços**: registro de manutenções realizadas e agendamento de revisões.
- **Entregas**: ordens logísticas com veículo, motorista, destinos e janelas de entrega.
- **Cercas (Geofences)**: criação/edição via mapa, sincronizada com o Traccar (`/api/geofences`).
- **Notificações**: eventos de vinculação, documentos vencendo, entradas/saídas de geofences.

### Euro View (Monitoramento Visual)

- **Eventos**: listagem de eventos de câmera (distração, colisão, pânico) com miniaturas.
- **Vídeos**: galeria filtrável por veículo, data ou evento.
- **Reconhecimento Facial**: cadastro e validação de faces autorizadas.
- **Live**: streaming em tempo real das câmeras embarcadas.

### Analytics

- **Utilização da frota**: km rodados, tempo em uso vs. parado.
- **Desempenho de entregas**: SLA, atrasos, mapas de calor.
- **Alertas e segurança**: excesso de velocidade, freadas bruscas, eventos de geofence.
- **Custos operacionais**: abastecimentos, manutenções planejadas vs. realizadas.
- **Filtros dinâmicos** por período, veículo/frota e exportação de dados.

### Experiência do Usuário

- Layout mobile-responsive com Tailwind CSS.
- Sidebar converte para menu hamburger em telas menores.
- Componentes reutilizáveis (inputs, tabelas, modais, cards) garantem consistência visual.
- Fluxos principais (localizar veículo, adicionar dispositivo) otimizados para agilidade.

## Backend (API Node/Python Multi-Tenant)

### Tecnologias e Estrutura

- Implementação principal em **Node.js + Express** (alternativa em Python/FastAPI).
- Organização modular por domínio: veículos, clientes, dispositivos, etc.
- Persistência em banco relacional (PostgreSQL/MySQL) com tabelas multi-tenant (Clientes, Usuários, Veículos, Equipamentos, Chips, Produtos, Documentos, Serviços, Entregas, Geofences).
- Filtros automáticos por tenant em todas as consultas.

### Autenticação e Autorização

- Login com e-mail/senha (hash seguro), sessões via cookies HTTP-only ou JWT.
- Associação de sessão ao tenant do usuário.
- Perfis: admin global, admin de cliente e usuário comum, com rotas restritas conforme papel.
- Modo demo opcional com autenticação aberta para testes.

### Endpoints Principais

- **Clientes**: CRUD completo (`/api/clients`).
- **Usuários**: CRUD com vínculo ao tenant (`/api/users`).
- **Veículos**: listagem filtrada por tenant, criação/edição e vinculação a equipamentos (`/api/vehicles`).
- **Equipamentos, Chips, Produtos**: gestão de estoque e associação a veículos (`/api/equipments`, `/api/chips`, `/api/products`).
- **Documentos, Serviços, Entregas**: CRUD específico por veículo (`/api/vehicles/{id}/documents`, `/api/vehicles/{id}/services`, `/api/deliveries`).
- **Geofences**: CRUD sincronizado com Traccar (`/api/geofences`).
- **Monitoramento**: posições atuais (`/api/positions`), rotas (`/api/routes`), eventos (`/api/events`), sumários e relatórios (`/api/summary`, `/api/trips`, `/api/stops`).
- **Autenticação**: `/api/login`, `/api/logout`, `/api/profile`.

Todas as respostas seguem padrão JSON, com códigos HTTP adequados e mensagens de erro claras.

### Integração com o Traccar

- Utilização de usuário administrador dedicado ou credenciais Basic Auth/token.
- Organização por grupos de dispositivos no Traccar para separar tenants.
- **Dispositivos**: `GET /api/devices` para sincronização de dados e status.
- **Posições**: `GET /api/positions` para última posição (filtrada por deviceId/groupId). Possibilidade de WebSocket (`/api/socket`) para atualizações instantâneas.
- **Rotas**: `GET /api/reports/route` com parâmetros `deviceId`, `from`, `to` e header `Accept: application/json`.
- **Eventos**: `GET /api/reports/events` com filtros por tipo.
- **Comandos**: envio via `/api/commands` quando o dispositivo suporta (bloqueio, etc.).
- **Cadastro de devices**: opção de automatizar `POST /api/devices` ao cadastrar equipamentos.
- **Geofences**: criação/edição via `/api/geofences`, garantindo geração de eventos de entrada/saída.

### Atualizações em Tempo Real e Notificações

- WebSockets ou Server-Sent Events no backend para repassar atualizações do Traccar aos frontends.
- Polling configurável como fallback (30 s para posições, 60 s para eventos).
- Notificações customizadas por tenant (interface, e-mail, SMS, push) para eventos críticos.

## Deployment (Empacotamento para EC2)

- **Frontend**: build de produção Vite (arquivos estáticos em `frontend/dist`).
- **Backend**: aplicação Node.js com `package.json` e scripts `start`/`build` (ou Python com `requirements.txt`).
- **Configuração**: `.env.example` com variáveis (DB, Traccar URL/credenciais, chaves JWT/sessão). Possível configuração de Nginx para servir frontend e proxy `/api`.
- **Scripts**: `deploy.sh` ou `docker-compose.yml` para subir backend, frontend e (opcionalmente) Traccar.
- **Documentação**: README com passos de instalação, build e execução em desenvolvimento/produção.
- **Infra**: backend na porta 3000, frontend servido por Nginx na porta 80, proxy para `/api`.

Após o deploy e configuração do Traccar, o sistema entrega monitoramento em tempo real, replays, gestão de dispositivos/frota e módulos analíticos, atendendo múltiplos clientes com isolamento seguro.

## Referências

- [Traccar API Reference](https://www.traccar.org/traccar-api/)
- [Traccar OpenAPI Specification](https://raw.githubusercontent.com/traccar/traccar/master/openapi.yaml)
- [Discussão sobre `/api/reports/route`](https://www.traccar.org/forums/topic/endpoint-apireportsroute/)
- [Discussão sobre `/api/positions`](https://www.traccar.org/forums/topic/api-positions/)
- Projeto Euro (base visual reutilizada no frontend)
