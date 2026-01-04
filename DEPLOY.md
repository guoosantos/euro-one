# Deploy e validação

Guia rápido para subir e validar o backend do Euro One (PM2 + geração de relatórios) e para rodar o backfill de endereços.

## Preparar ambiente

1. Node.js 20+ e PM2 instalados no host.
2. Clone o repositório e instale as dependências em modo workspace:
   ```bash
   npm install --workspaces --include-workspace-root
   ```
3. Gere os artefatos do cliente (se for servir assets estáticos):
   ```bash
   npm run build --workspace client
   ```

## Variáveis de ambiente

O PM2 lê o arquivo `.env` na raiz (via `env_file` no `ecosystem.config.cjs`). As variáveis `PORT`, `HOST` e `NODE_ENV` são propagadas para o processo. Para ambientes em que o PM2 interpreta números de forma inconsistente, defina `PORT` como string (`PORT="5189"`).

## Subir com PM2

```bash
pm2 start ecosystem.config.cjs --only euro-one-server --update-env --time
pm2 logs euro-one-server --lines 200
```

No startup, os logs devem exibir:

- `[startup] env PORT=... HOST=... NODE_ENV=...`
- `[startup] listening on http://0.0.0.0:PORT`

## Validação pós-start

Use o script auxiliar para validar o bind e o healthcheck (porta padrão 5189):

```bash
HOST=127.0.0.1 PORT=5189 ./scripts/validate-server-start.sh
```

O script executa `curl http://127.0.0.1:PORT/health` e `ss -ltnp | grep PORT`. Em caso de falha, imprime `pm2 logs euro-one-server --lines 200` e retorna erro.

## Backfill de full_address (batch)

Há duas formas de popular `tc_positions.full_address` em lote:

1) **Via script** (limite padrão de 1000 registros por execução):
   ```bash
   node server/scripts/backfill-position-addresses.mjs --batch=500 --concurrency=3 --rate=2 --max=1000 --dry-run=false
   ```
   - `--from` e `--to` aceitam datas (ISO) para recorte temporal.
   - `--dry-run=true` processa sem gravar.

2) **Via endpoint autenticado (admin)**:
   ```bash
   curl -X POST https://<host>/api/maintenance/positions/full-address/backfill \
     -H "Authorization: Bearer <token_admin>" \
     -H "Content-Type: application/json" \
     -d '{"max":1000,"batch":500,"concurrency":3,"rate":2,"dryRun":false}'
   ```

O job registra progresso com contadores de processados/atualizados/erros e paginação por `id`, permitindo rodadas repetidas até zerar o backlog.
