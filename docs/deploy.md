# Deploy (produção)

## Como o front é servido

O backend (`server/`) agora entrega o build do front diretamente a partir de `client/dist` com fallback de SPA. Não existe Vite/`npm run dev` em produção: é sempre o bundle estático gerado por `npm run build --workspace client`.

Ao reiniciar com `pm2` apenas o backend é iniciado; portanto, antes de um reload é obrigatório gerar novamente o `client/dist`. Se o diretório não existir, o Express registra um aviso no log e continua servindo apenas a API.

## Playwright/Chromium (exportação de PDF)

A exportação de PDF depende de Playwright + Chromium. O workspace `server` já possui o Playwright como dependência e o script `server/scripts/install-playwright.js` instala o Chromium necessário.

O Chromium é iniciado em modo *headless* com as flags `--no-sandbox`, `--disable-setuid-sandbox` e `--disable-dev-shm-usage`, adequadas para servidores Linux/containers. Se o binário não estiver disponível, a geração do PDF retornará erro com a instrução para rodar o script abaixo.

Durante o deploy, garanta a execução **uma vez** deste script (ou use o `postinstall` do workspace):

```bash
npm run provision:playwright
```

Isso executa `npx playwright install chromium --with-deps --force` e garante que o Chromium esteja disponível em produção.

## Passo-a-passo de atualização (front + back)

> Ajuste o caminho do repositório conforme o seu servidor.

1) Atualize o código e dependências:

```bash
cd /var/www/euro-one

git pull
npm install --omit=dev
```

2) Gere o build do front (bundle estático que será servido pelo Express):

```bash
npm run build --workspace client
```

3) Garanta o Chromium do Playwright (apenas se ainda não foi provisionado ou após rebuild da imagem/VM):

```bash
npm run provision:playwright
```

4) (Opcional) Rode migrations do Prisma se houver mudanças de schema:

```bash
npm run prisma:migrate:deploy --workspace server
```

5) Reinicie o backend com PM2 (ele já serve o `client/dist`):

```bash
pm2 reload ecosystem.config.cjs --update-env
```

### Observações sobre o front

- Se o Nginx/Caddy estiver configurado para apontar para `client/dist` **dentro do repo**, basta executar o build para atualizar o front; o Express também o servirá na mesma porta do backend.
- Se o servidor web utiliza outro diretório (ex.: `/var/www/html`), copie o build:

```bash
rsync -a --delete client/dist/ /var/www/html/
```

- Após o build/rsync, não é necessário reiniciar o Nginx para arquivos estáticos, mas é recomendado limpar cache/CDN se houver.

### Por que Vite não roda em produção

O Vite é apenas um dev server; em produção ele não deve ficar ativo porque:

- não aplica otimizações de bundle/caching;
- mantém watchers/timers desnecessários consumindo CPU/memória;
- não integra com o fallback SPA do Express/PM2.

O fluxo correto é sempre: `npm run build --workspace client` → `pm2 reload ...`.
