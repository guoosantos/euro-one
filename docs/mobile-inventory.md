# Inventário Real do Web (EURO ONE)

## Fontes analisadas
- Menu e permissões: `client/src/lib/permissions/registry.js`
- Rotas da aplicação web: `client/src/routes.jsx`
- Endpoints usados pelo frontend: `client/src/lib/api-routes.js`, `client/src/lib/api.js`, `client/src/lib/coreApi.js`
- Contextos e hooks que consomem API: `client/src/contexts/*.jsx`, `client/src/lib/hooks/*.js`
- Rotas do backend: `server/app.js`, `server/routes/*.js`
- OpenAPI disponível no repositório: `XDM_API_v3_251003.json`

## Regra do zero dado fictício
Este inventário foi gerado exclusivamente a partir do código do web (menus, rotas, hooks e rotas de API). Onde uma tela não consome API no web atual, isso está indicado explicitamente como “tela sem consumo de API no web”.

## Árvore de menus do web (sidebar)
Tabela achatada preservando ordem do sidebar.

| Seção | Item | Rota web | Permissão (menu/page/sub) | Observações |
| --- | --- | --- | --- | --- |
| NEGÓCIOS | Dashboard | `/dashboard` | `business/dashboard` | Página usa hooks de eventos/relatórios/dispositivos via contexts. |
| NEGÓCIOS | Financeiro | `/finance` | `business/finance` | Consome `finance/summary` e `finance/entries`. |
| NEGÓCIOS | CRM | `/crm` | `business/crm` | Consome endpoints de CRM via `CoreApi` (clientes, pipeline, tags, etc). |
| PRINCIPAIS | Home | `/home` | `primary/home` | Consome posições, alertas, tarefas e veículos. |
| PRINCIPAIS | Monitoramento | `/monitoring` | `primary/monitoring` | Tela principal de mapa/telemetria. |
| PRINCIPAIS | Trajetos / Replay | `/trips` | `primary/trips` | Replay e rotas por período. |
| PRINCIPAIS | Dispositivos · Equipamentos | `/devices` | `primary/devices/devices-list` | Gestão de equipamentos. |
| PRINCIPAIS | Dispositivos · Chip | `/devices/chips` | `primary/devices/devices-chips` | Gestão de chips. |
| PRINCIPAIS | Dispositivos · Modelos & Portas | `/devices/products` | `primary/devices/devices-models` | Gestão de modelos. |
| PRINCIPAIS | Dispositivos · Estoque | `/devices/stock` | `primary/devices/devices-stock` | Estoque e técnicos. |
| PRINCIPAIS | Dispositivos · Comandos | `/commands` | `primary/commands` | Envio e histórico de comandos. |
| PRINCIPAIS | Eventos | `/events` | `primary/events` | Protocolos e configuração de severidade. |
| FROTAS | Veículos | `/vehicles` | `fleet/vehicles` | CRUD veículos e vínculo com dispositivos. |
| FROTAS | Documentos · Motorista | `/drivers` | `fleet/documents/drivers` | CRUD motoristas. |
| FROTAS | Documentos · Contratos | `/documents` | `fleet/documents/contracts` | Tela sem consumo de API no web atual. |
| FROTAS | Serviços · Ordem de Serviço | `/services` | `fleet/services/service-orders` | Lista e detalhes de OS. |
| FROTAS | Serviços · Solicitações | `/service-requests` | `fleet/services/service-requests` | Solicitações e aprovação. |
| FROTAS | Serviços · Agendamentos | `/appointments` | `fleet/services/appointments` | Agendamentos baseados em tasks. |
| FROTAS | Serviços · VAR / Auditoria ao vivo | `/var` | `fleet/services/var-live` | Lista de tasks. |
| FROTAS | Serviços · Técnico | `/technicians` | `fleet/services/technicians` | Técnicos e OS vinculadas. |
| FROTAS | Rotas | `/routes` | `fleet/routes` | CRUD rotas e geocoding. |
| FROTAS | Cercas | `/geofences` | `fleet/geofences` | CRUD cercas e mapa. |
| FROTAS | Alvos | `/targets` | `fleet/targets` | Usa a mesma tela de cercas em modo “targets”. |
| FROTAS | Embarcar Itinerários | `/itineraries` | `fleet/itineraries` | Embarque, status e histórico. |
| FROTAS | Entregas | `/deliveries` | `fleet/deliveries` | Tela sem consumo de API no web atual. |
| TELEMETRIA EURO | Euro View · Vídeos | `/videos` | `telemetry/euro-view/videos` | Tela sem consumo de API no web atual. |
| TELEMETRIA EURO | Euro View · Reconhecimento Facial | `/face` | `telemetry/euro-view/face` | Consome alertas de face. |
| TELEMETRIA EURO | Euro View · Live | `/live` | `telemetry/euro-view/live` | Tela sem consumo de API no web atual. |
| TELEMETRIA EURO | Euro CAN · Combustível | `/fuel` | `telemetry/euro-can/fuel` | Tela sem consumo de API no web atual. |
| TELEMETRIA EURO | Euro CAN · Compliance | `/compliance` | `telemetry/euro-can/compliance` | Tela sem consumo de API no web atual. |
| TELEMETRIA EURO | Euro CAN · Drive Behavior | `/driver-behavior` | `telemetry/euro-can/driver-behavior` | Tela sem consumo de API no web atual. |
| TELEMETRIA EURO | Euro CAN · Manutenção | `/maintenance` | `telemetry/euro-can/maintenance` | Tela sem consumo de API no web atual. |
| ADMINISTRAÇÃO | Relatórios · Relatório de Posições | `/reports/positions` | `admin/reports/reports-positions` | Relatórios com exportação. |
| ADMINISTRAÇÃO | Relatórios · Relatório Analítico | `/reports/analytic` | `admin/reports/reports-analytic` | Relatórios com exportação. |
| ADMINISTRAÇÃO | Análises · Mapa de Calor | `/analytics/heatmap` | `admin/analytics/analytics-heatmap` | Mapa de calor de eventos. |
| ADMINISTRAÇÃO | Análises · Ranking | `/ranking` | `admin/analytics/ranking` | Tela sem consumo de API no web atual. |
| ADMINISTRAÇÃO | Análises · Área de Risco | `/analytics/risk-area` | `admin/analytics/risk-area` | Tela sem consumo de API no web atual. |
| ADMINISTRAÇÃO | Análises · Segurança | `/analytics/security` | `admin/analytics/security-events` | Tela sem consumo de API no web atual. |
| ADMINISTRAÇÃO | Clientes | `/clients` | `admin/clients` | CRUD clientes e espelhamento. |
| ADMINISTRAÇÃO | Usuários | `/users` | `admin/users` | CRUD usuários e grupos. |
| ADMINISTRAÇÃO | Espelhamento | `/mirrors/received` | `admin/mirrors` | Configuração e controle de espelho. |
| ADMINISTRAÇÃO | Importar Base (XLSX) | `/admin/import-euro-xlsx` | `admin/import` | Importação de base. |

## Autenticação, tenant-context e RBAC

### Endpoints reais usados no web
| Função | Método | Rota | Observações |
| --- | --- | --- | --- |
| Login | `POST` | `/api/login` | Payload `email`, `password`, `remember`. Alternativa: `/api/auth/login`. |
| Sessão | `GET` | `/api/session` | Retorna `user`, `client`, `clients`, `clientId`. Alternativa: `/api/auth/session`. |
| Refresh | `POST` | `/api/auth/refresh` | Reemite token. |
| Logout | `POST` | `/api/logout` | Alternativa: `/api/auth/logout`. |
| Bootstrap | `GET` | `/api/bootstrap` | Retorna `context`, `mePermissions`, `mirrorsContext`. |
| Contexto de tenant | `GET` | `/api/context` | Lista clientes/tenants e contexto atual. |
| Permissões (contexto) | `GET` | `/api/permissions/context` | RBAC completo. Retorna `permissionGroupId` e árvore de permissões. |
| Permissões (me) | `GET` | `/api/me/permissions` | Permissões básicas e escopo de espelhamento. |
| Contexto de espelhamento | `GET` | `/api/mirrors/context` | Mirror mode, owners permitidos, etc. |

### Headers e parâmetros observados no web
| Item | Como é usado no web | Arquivo de origem |
| --- | --- | --- |
| `Authorization: Bearer <token>` | Adicionado automaticamente pelo client HTTP. | `client/src/lib/api.js` |
| `X-Owner-Client-Id` | Anexado quando há modo espelho (mirror). | `client/src/lib/api.js`, `client/src/lib/mirror-params.js` |
| `X-Mirror-Mode` | `target` quando em espelho, senão `self`. | `client/src/lib/api.js` |
| Tenant por query | Uso de `clientId` (ou `tenantId` em alguns payloads) via query string. | `client/src/lib/mirror-params.js` |
| Request ID | Backend retorna `X-Correlation-Id` em endpoints de permissões. | `server/routes/permissions.js` |

## Inventário de endpoints por menu
Abaixo está o mapeamento Menu → Tela → Endpoints reais (método + rota) usados no web. As rotas estão no formato que o frontend consome, já com o prefixo `/api` aplicado pelo client HTTP.

### NEGÓCIOS
| Tela | Endpoints (método + rota) | Observações |
| --- | --- | --- |
| Dashboard (`/dashboard`) | `GET /api/core/devices`, `GET /api/core/vehicles`, `GET /api/traccar/events`, `GET /api/traccar/reports/trips`, `GET /api/reports/trips` | Endpoints vindos dos hooks `useDevices`, `useEvents`, `useReports`. |
| Financeiro (`/finance`) | `GET /api/finance/summary`, `GET /api/finance/entries` | Usados em paralelo na tela. |
| CRM (`/crm`) | `GET /api/crm/clients`, `GET /api/crm/clients/:id`, `POST /api/crm/clients`, `PUT /api/crm/clients/:id`, `GET /api/crm/alerts`, `GET /api/crm/tags`, `POST /api/crm/tags`, `DELETE /api/crm/tags/:id`, `GET /api/crm/pipeline`, `POST /api/crm/deals`, `PUT /api/crm/deals/:id/stage`, `GET /api/crm/activities`, `POST /api/crm/activities`, `GET /api/crm/reminders`, `POST /api/crm/reminders` | Implementado via `CoreApi`. |

### PRINCIPAIS
| Tela | Endpoints (método + rota) | Observações |
| --- | --- | --- |
| Home (`/home`) | `GET /api/positions/last`, `GET /api/alerts`, `GET /api/alerts/conjugated`, `GET /api/core/vehicles`, `GET /api/core/tasks`, `GET /api/core/devices` | Usa mirror headers quando aplicável. |
| Monitoramento (`/monitoring`) | `GET /api/core/telemetry`, `GET /api/positions/last`, `GET /api/core/vehicles`, `GET /api/core/devices`, `GET /api/alerts`, `GET /api/alerts/conjugated`, `GET /api/geocode/reverse`, `GET /api/user/preferences`, `PUT /api/user/preferences`, `DELETE /api/user/preferences` | Consumo distribuído em contexts (`Telemetry`, `LivePositions`, `Devices`) e hooks (`useUserPreferences`, `useAlerts`). |
| Trajetos / Replay (`/trips`) | `GET /api/traccar/reports/trips`, `GET /api/traccar/events`, `POST /api/map-matching`, `POST /api/map-route` | Usa endpoints de ajuste de rota e eventos. |
| Dispositivos · Equipamentos (`/devices`) | `GET /api/core/devices`, `GET /api/models`, `GET /api/core/chips`, `GET /api/core/vehicles`, `POST /api/core/devices`, `PUT /api/core/devices/:id`, `DELETE /api/core/devices/:id`, `POST /api/core/vehicles`, `POST /api/core/devices/sync`, `POST /api/core/vehicles/:vehicleId/devices/:deviceId`, `DELETE /api/core/vehicles/:vehicleId/devices/:deviceId` | CRUD + vínculo veículo/equipamento. |
| Dispositivos · Chip (`/devices/chips`) | `GET /api/core/chips`, `GET /api/core/devices`, `POST /api/core/chips`, `PUT /api/core/chips/:id`, `DELETE /api/core/chips/:id` | Lista de chips e relacionamento com devices. |
| Dispositivos · Modelos & Portas (`/devices/products`) | `GET /api/models`, `POST /api/core/models`, `PUT /api/core/models/:id` | Gestão de modelos. |
| Dispositivos · Estoque (`/devices/stock`) | `GET /api/core/devices`, `GET /api/models`, `GET /api/core/technicians`, `DELETE /api/core/devices/:id` | Estoque + técnicos. |
| Dispositivos · Comandos (`/commands`) | `GET /api/core/vehicles/:vehicleId/traccar-device`, `GET /api/protocols/:protocol/commands`, `GET /api/commands/custom`, `GET /api/commands/history`, `GET /api/commands/history/status`, `POST /api/commands/send`, `POST /api/commands/send-sms`, `DELETE /api/commands/custom/:id` | Inclui envio de comando e histórico. |
| Eventos (`/events`) | `GET /api/protocols`, `GET /api/events`, `GET /api/protocols/:protocol/events`, `GET /api/protocols/:protocol/events/config`, `PUT /api/protocols/:protocol/events/config` | Configuração de severidade por protocolo. |

### FROTAS
| Tela | Endpoints (método + rota) | Observações |
| --- | --- | --- |
| Veículos (`/vehicles`) | `GET /api/core/vehicles`, `GET /api/core/devices`, `GET /api/core/vehicle-attributes`, `POST /api/core/vehicle-attributes`, `POST /api/core/vehicles`, `DELETE /api/core/vehicles/:id`, `DELETE /api/core/vehicles/:vehicleId/devices/:deviceId` | CRUD veículos e atributos. |
| Motoristas (`/drivers`) | `GET /api/drivers`, `POST /api/drivers`, `PUT /api/drivers/:id`, `DELETE /api/drivers/:id` | CRUD motoristas. |
| Contratos (`/documents`) | Sem consumo de API no web atual | Página existe mas não consome endpoints. |
| Ordem de Serviço (`/services`) | `GET /api/core/service-orders`, `DELETE /api/core/service-orders/:id` | Lista base da OS. |
| Solicitações (`/service-requests`) | `POST /api/core/service-orders`, `PATCH /api/core/service-orders/:id`, `GET /api/core/stock`, `GET /api/core/equipment-transfers`, `GET /api/core/technician-inventory`, `POST /api/core/equipment-transfers`, `GET /api/core/tasks`, `POST /api/core/tasks`, `PUT /api/core/tasks/:id` | Aprovação, estoque e tarefas. |
| Agendamentos (`/appointments`) | `GET /api/core/technicians`, `GET /api/core/tasks`, `POST /api/core/tasks`, `PUT /api/core/tasks/:id` | Agenda baseada em tasks. |
| VAR / Auditoria ao vivo (`/var`) | `GET /api/core/tasks` | Lista de tasks ao vivo. |
| Técnico (`/technicians`) | `GET /api/core/technicians`, `POST /api/core/technicians`, `PUT /api/core/technicians/:id`, `DELETE /api/core/technicians/:id`, `POST /api/core/technicians/:id/login`, `GET /api/core/service-orders` | CRUD técnico + OS. |
| Rotas (`/routes`) | `GET /api/euro/routes`, `POST /api/euro/routes`, `PUT /api/euro/routes/:id`, `DELETE /api/euro/routes/:id`, `GET /api/geocode/lookup`, `GET /api/traccar/reports/route` | Rotas e geocoding. |
| Cercas (`/geofences`) | `GET /api/geofences`, `POST /api/geofences`, `PUT /api/geofences/:id`, `DELETE /api/geofences/:id`, `GET /api/geofence-groups`, `POST /api/geofence-groups`, `PUT /api/geofence-groups/:id`, `DELETE /api/geofence-groups/:id`, `PUT /api/geofence-groups/:id/geofences` | Cercas e grupos. |
| Alvos (`/targets`) | Mesmos endpoints de cercas | Tela reaproveitada em modo “targets”. |
| Embarcar Itinerários (`/itineraries`) | `GET /api/euro/routes`, `GET /api/itineraries`, `POST /api/itineraries`, `PUT /api/itineraries/:id`, `DELETE /api/itineraries/:id`, `GET /api/itineraries/:id/export/kml`, `GET /api/itineraries/embark/history`, `GET /api/itineraries/embark/vehicles`, `GET /api/itineraries/embark/vehicles/:vehicleId/status`, `GET /api/itineraries/embark/vehicles/:vehicleId/history`, `POST /api/itineraries/embark`, `POST /api/itineraries/disembark` | Embarque e histórico. |
| Entregas (`/deliveries`) | Sem consumo de API no web atual | Tela existe mas não consome endpoints. |

### TELEMETRIA EURO
| Tela | Endpoints (método + rota) | Observações |
| --- | --- | --- |
| Euro View · Vídeos (`/videos`) | Sem consumo de API no web atual | A tela existe mas não consome endpoints. |
| Euro View · Reconhecimento Facial (`/face`) | `GET /api/media/face/alerts` | Consumo via `safeApi`. |
| Euro View · Live (`/live`) | Sem consumo de API no web atual | A tela existe mas não consome endpoints. |
| Euro CAN · Combustível (`/fuel`) | Sem consumo de API no web atual | Placeholder. |
| Euro CAN · Compliance (`/compliance`) | Sem consumo de API no web atual | Placeholder. |
| Euro CAN · Drive Behavior (`/driver-behavior`) | Sem consumo de API no web atual | Placeholder. |
| Euro CAN · Manutenção (`/maintenance`) | Sem consumo de API no web atual | Placeholder. |

### ADMINISTRAÇÃO
| Tela | Endpoints (método + rota) | Observações |
| --- | --- | --- |
| Relatório de Posições (`/reports/positions`) | `GET /api/reports/positions`, `POST /api/reports/positions/export`, `GET /api/reports/positions/export/:jobId`, `GET /api/reports/positions/export/:jobId/download` | Exportação PDF/XLSX/CSV via export jobs. |
| Relatório Analítico (`/reports/analytic`) | `GET /api/reports/analytic`, `POST /api/reports/analytic/export`, `GET /api/reports/analytic/export/:jobId`, `GET /api/reports/analytic/export/:jobId/download` | Exportação PDF/XLSX/CSV via export jobs. |
| Análises · Mapa de Calor (`/analytics/heatmap`) | `GET /api/events/heatmap` | Consumo via `useHeatmapEvents`. |
| Análises · Ranking (`/ranking`) | Sem consumo de API no web atual | Placeholder. |
| Análises · Área de Risco (`/analytics/risk-area`) | Sem consumo de API no web atual | Placeholder. |
| Análises · Segurança (`/analytics/security`) | Sem consumo de API no web atual | Placeholder. |
| Clientes (`/clients`) | `GET /api/clients`, `POST /api/clients`, `PUT /api/clients/:id`, `DELETE /api/clients/:id`, `GET /api/clients/:id/details`, `GET /api/clients/:id`, `GET /api/users`, `GET /api/core/vehicles`, `GET /api/mirrors`, `POST /api/mirrors`, `PUT /api/mirrors/:id`, `DELETE /api/mirrors/:id` | Inclui tela detalhe do cliente. |
| Usuários (`/users`) | `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `POST /api/users/:id/transfer-config`, `GET /api/core/vehicles` | Inclui transferência de veículo/permissões. |
| Espelhamento (`/mirrors/received`) | `GET /api/mirrors/context`, `GET /api/mirrors`, `POST /api/mirrors`, `PUT /api/mirrors/:id`, `DELETE /api/mirrors/:id` | Controle de espelhamento. |
| Importar Base (XLSX) (`/admin/import-euro-xlsx`) | `POST /api/core/euro/import-xlsx` | Importação de base. |

## Telas de suporte (fora do sidebar, mas necessárias para fluxo real)
| Tela | Rota | Endpoints (método + rota) | Observações |
| --- | --- | --- | --- |
| Login | `/login` | `POST /api/login`, `GET /api/session`, `GET /api/bootstrap`, `GET /api/context` | Fluxo de entrada. |
| Notificações | `/notifications` | `GET /api/notifications`, `POST /api/notifications`, `PUT /api/notifications/:id`, `DELETE /api/notifications/:id` | Consumo via hook. |
| Configurações | `/settings` | `PUT /api/users/:id` | Atualização de dados do usuário. |
| Conta | `/account` | `PUT /api/users/:id` | Atualização de dados do usuário. |
| Criar Comandos | `/commands/create` | `GET /api/protocols`, `GET /api/commands/custom`, `POST /api/commands/custom`, `PUT /api/commands/custom/:id`, `DELETE /api/commands/custom/:id` | Fluxo complementar ao módulo de comandos. |
| Ordem de Serviço · Nova | `/services/new` | `GET /api/core/technicians`, `POST /api/core/service-orders`, `GET /api/core/devices` | Fluxo de criação. |
| Ordem de Serviço · Detalhe | `/services/:id` | `GET /api/core/service-orders/:id`, `PATCH /api/core/service-orders/:id`, `GET /api/core/service-orders/:id/pdf` | Fluxo de detalhe. |
| Ordem de Serviço · Execução | `/services/:id/execute` | `GET /api/core/service-orders/:id`, `PATCH /api/core/service-orders/:id` | Fluxo de execução. |
| Ordem de Serviço · Importar | `/services/import` | `POST /api/core/euro/import-xlsx` | Importação de OS. |
| Importar dispositivos | `/devices/import` | `GET /api/core/devices/import`, `POST /api/core/devices/import`, `POST /api/core/devices/sync`, `GET /api/models` | Fluxo de importação. |
| Veículo · Detalhe | `/vehicles/:id` | `GET /api/core/vehicles`, `GET /api/core/devices`, `GET /api/core/chips`, `GET /api/core/vehicle-attributes`, `PUT /api/core/vehicles/:id`, `DELETE /api/core/vehicles/:id`, `POST /api/core/vehicles/:vehicleId/devices/:deviceId`, `DELETE /api/core/vehicles/:vehicleId/devices/:deviceId`, `GET /api/core/service-orders` | Detalhes e vínculos. |

## Observação obrigatória sobre o menu “Serviços”
No app mobile, o item “Serviços” deve ser renomeado para “Todos” conforme regra fornecida. No web atual, o menu é “Serviços” e o primeiro item é “Ordem de Serviço”.

## Pontos que exigem implementação para cumprir “zero dado fictício”
As telas abaixo existem no web, mas não consomem API atualmente. No app, elas precisarão de endpoints reais antes de sair do MVP.

| Tela | Situação no web atual |
| --- | --- |
| `/documents` | Tela existente sem consumo de API. |
| `/deliveries` | Tela existente sem consumo de API. |
| `/videos` | Tela existente sem consumo de API. |
| `/live` | Tela existente sem consumo de API. |
| `/fuel` | Tela existente sem consumo de API. |
| `/compliance` | Tela existente sem consumo de API. |
| `/driver-behavior` | Tela existente sem consumo de API. |
| `/maintenance` | Tela existente sem consumo de API. |
| `/ranking` | Tela existente sem consumo de API. |
| `/analytics/risk-area` | Tela existente sem consumo de API. |
| `/analytics/security` | Tela existente sem consumo de API. |

