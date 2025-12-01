# Plano técnico de execução

Este plano resume as quatro fases aplicadas na reestruturação do Euro One e orienta a ordem de execução em ambientes novos ou atualizados.

## Fase 1 – Prisma e migração de dados
- Configurar variáveis `DATABASE_URL` e `DATABASE_PROVIDER` para o banco relacional.
- Aplicar as migrações do Prisma para criar as tabelas (`Users`, `Clients`, `Devices`, `Deals`, `Activities`, etc.).
- Executar o script de migração do `storage.json` para o banco com `npm run migrate-storage-to-db` quando houver dados legados.
- Rodar o seed inicial (`npx prisma db seed`) para garantir o usuário admin padrão.
- **Status:** Concluída. O backend opera 100% sobre o banco relacional.

## Fase 2 – Refatoração de menus e RBAC
- Remover rotas duplicadas de clientes/usuários e consolidar as telas únicas com comportamento condicionado por papel (admin/manager).
- Garantir que middlewares de autorização bloqueiem managers fora do próprio tenant e que o frontend oculte ações não permitidas.
- **Status:** Concluída. Sidebar e páginas usam RBAC centralizado e sem duplicidades.

## Fase 3 – Modernização de UI
- Adotar componentes shadcn/UI e tema Tailwind com glassmorphism, além de microinterações com Framer Motion.
- Refatorar o dashboard para layout arrastável/redimensionável e componentes responsivos.
- **Status:** Concluída. Interface padronizada, responsiva e animada.

## Fase 4 – CRM 2.0 e integrações
- Criar modelos e CRUDs para Pipeline, Deals, Activities e Reminders, com Kanban drag-and-drop no frontend.
- Implementar a conversão automática de leads em clientes reais, criando usuário/grupo no Traccar e vinculando dispositivos e lembretes.
- **Status:** Concluída. Fluxo de vendas a contrato está automatizado e integrado ao Traccar.

## Ordem recomendada para subir ambientes
1) Executar migrações (`npx prisma migrate deploy`).
2) Rodar seeds (`npx prisma db seed`).
3) Migrar dados legados com `npm run migrate-storage-to-db` (se aplicável).
4) Iniciar backend (`npm run start:server`) e frontend (`npm run dev`) com variáveis `.env` preenchidas.

Seguir esta ordem garante que todas as funcionalidades dependentes do banco e das permissões estejam consistentes antes de liberar o ambiente.
