# Fase 5 — Testes finais, otimizações e deploy

Esta lista consolida as verificações de aceite, otimizações de desempenho e passos de deploy sugeridos para o Euro One. Utilize-a como checklist antes de publicar uma nova versão em produção.

## Aceite funcional (front-end)
- [ ] Login, logout e restauração de sessão via `/api/session`.
- [ ] Dashboard: cards, mapa/heatmap e indicadores carregam sem erros de rede ou dados vazios.
- [ ] Monitoramento: filtros rápidos (online, válidos, sem sinal) e tabela de telemetria respondem a mudanças sem sumir dados.
- [ ] Relatórios: criar viagens/rotas/paradas/resumo; feedback de sucesso/erro visível; entradas persistem após recarregar.
- [ ] Exportações: downloads CSV de posições e relatórios iniciam com estado de loading/disable correto.
- [ ] Geofences: criação/edição com associação de dispositivos/grupos e sincronização confirmada.
- [ ] Tasks/entregas: criação, edição e timeline funcionando e refletindo no dashboard.
- [ ] Tema/i18n: alternância de idioma e tema claro/escuro mantendo strings traduzidas (sem chaves cruas).

## Aceite funcional (backend)
- [ ] Rotas de autenticação (`/api/session`, `/api/logout`) retornam status corretos e lidam com tokens expirados.
- [ ] CRUD de clientes/usuários (`/api/clients`, `/api/users`) protegido por permissões.
- [ ] `/api/reports/*` gera respostas válidas para trips, stops, summary e route.
- [ ] `/api/positions/export` retorna CSV com filtros aplicados.
- [ ] Middlewares de erro retornam JSON estruturado sem vazamento de stack traces em produção.

## Desempenho e robustez
- [ ] Rodar `npm run build` para garantir bundles otimizados do front-end.
- [ ] Verificar code-splitting (chunks) e remover mapas de origem públicos em produção.
- [ ] Conferir métricas de rede no navegador (TTFB, tamanho de bundle principal, tempo de interação) e otimizar imports pesados.
- [ ] Backend em `NODE_ENV=production` com logs mínimos e `ALLOWED_ORIGINS` restritos.
- [ ] Validar uso de cache no navegador (headers) para assets estáticos e respostas de API sensíveis.

## Deploy sugerido
- **Front-end (Vercel)**
  - Importar repositório; definir `VITE_API_BASE_URL` apontando para o backend público.
  - Habilitar modo produção (`NODE_ENV=production`) e revisar logs após o primeiro deploy.
- **Backend (Railway/Render)**
  - Configurar variáveis `PORT`, `TRACCAR_BASE_URL`, `JWT_SECRET`, credenciais/admin do Traccar e `ALLOWED_ORIGINS` incluindo a URL do front.
  - Habilitar HTTPS ou proxy seguro; revisar logs iniciais e métricas de uso.
- **Pipelines**
  - [ ] Configurar CI para rodar lint/test/build em cada PR.
  - [ ] Automatizar deploy em push para `main` após sucesso do pipeline.

## Pós-deploy
- [ ] Monitoramento básico configurado (logs centralizados e alertas de erro, ex.: Sentry).
- [ ] Teste de fumo em produção (login, dashboard, geração de relatório) concluído.
- [ ] Documentar URLs públicas de front/back e variáveis sensíveis configuradas no host.
