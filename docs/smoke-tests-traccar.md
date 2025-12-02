# Roteiro rápido de validação (telemetria + CRM)

Use estes passos para confirmar que o Euro One está pronto para cadastrar rastreadores e operar o CRM 2.0 em um ambiente novo ou recém-atualizado.

## 1. Preparação do ambiente
1. Preencha `.env`, `server/.env` e `client/.env` com as URLs do backend, Traccar e JWT, garantindo que `TRACCAR_BASE_URL` e `VITE_TRACCAR_BASE_URL` apontam para o mesmo host (ex.: `http://localhost:8082`).
2. Suba um banco relacional e exporte `DATABASE_URL`/`DATABASE_PROVIDER` compatíveis com o `schema.prisma`.
3. Aplique as migrações e seeds:
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   npm run migrate:storage --workspace server   # opcional, só para importar storage.json legado
   ```
4. Instale dependências e suba os serviços:
   ```bash
   npm install
   npm run start:server
   npm run dev --workspace client
   ```

## 2. Login e configuração inicial
1. Acesse `http://localhost:5173` e entre como `admin@euro.one` / `admin` (seed padrão).
2. Crie um cliente real em **Clients** e confirme que ele aparece no dropdown global.
3. Crie um usuário `manager` atrelado a esse cliente; saia e entre com ele para validar o RBAC e a visibilidade restrita ao tenant.

## 3. Cadastro e teste de rastreadores
1. No Traccar, cadastre um dispositivo com `uniqueId` conhecido e associe ao grupo do cliente criado (ou deixe sem grupo para testar a vinculação automática).
2. No Euro One, acesse **Devices** e verifique se o dispositivo aparece; se não houver grupo, atribua ao cliente via UI.
3. Envie posições de teste para o `uniqueId` usando a API ou um simulador (ex.: protocolo OsmAnd apontando para `TRACCAR_BASE_URL`).
4. Confirme na tela de **Monitoramento**:
   - O WebSocket `/ws/live` marca o dispositivo como **online**.
   - A tabela de telemetria atualiza posição, velocidade e endereço (normalizado) sem erros de `null`.
   - O mapa renderiza a posição e permite abrir o popup com dados do dispositivo.
5. Gere um relatório de viagens no período dos pontos enviados para validar a leitura direta do banco do Traccar.

## 4. Pipeline e conversão de CRM
1. Em **CRM**, crie um lead e mova o cartão no Kanban até a coluna de *Fechamento*.
2. Verifique se o lead converte em cliente real: o novo tenant surge na lista de clientes e recebe grupo/usuário no Traccar.
3. Vincule dispositivos ao deal antes da conversão e confirme que eles aparecem transferidos para o novo grupo no Traccar e no dashboard do cliente.
4. Cheque os lembretes gerados (30 dias antes e na data de vencimento do contrato) na área de atividades.

## 5. Sanidade final
- Rode os testes automatizados para garantir que as integrações continuam saudáveis:
  ```bash
  npm test --workspace server
  npm test --workspace client
  ```
- Se precisar depurar o Traccar, consulte os logs no backend (erros `TRACCAR_UNAVAILABLE` já incluem status, tentativa e URL).

Seguir este roteiro confirma o fluxo completo: RBAC, cadastro de tenants/usuários, integração híbrida com o Traccar, dashboard dinâmico e automação do CRM.
