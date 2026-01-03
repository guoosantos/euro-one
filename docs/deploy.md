# Deploy (produção)

## Como o front é servido

O backend (`server/`) **não** serve arquivos estáticos do front. O build do client é gerado em `client/dist` (Vite) e precisa ser servido por um servidor web (Nginx, Caddy, etc.) apontando para esse diretório.

Isso explica o comportamento observado após `pm2 restart all`: o PM2 reinicia **apenas o backend**. Se o build estático não foi refeito, o navegador continuará entregando o bundle antigo.

## Playwright/Chromium (exportação de PDF)

A exportação de PDF depende de Playwright + Chromium. O workspace `server` já possui o Playwright como dependência e o script `server/scripts/install-playwright.js` instala o Chromium necessário.

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

2) Gere o build do front (arquivo estático):

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

5) Reinicie o backend com PM2:

```bash
pm2 reload ecosystem.config.cjs --update-env
```

### Observações sobre o front

- Se o Nginx/Caddy estiver configurado para apontar para `client/dist` **dentro do repo**, basta executar o build para atualizar o front.
- Se o servidor web utiliza outro diretório (ex.: `/var/www/html`), copie o build:

```bash
rsync -a --delete client/dist/ /var/www/html/
```

- Após o build/rsync, não é necessário reiniciar o Nginx para arquivos estáticos, mas é recomendado limpar cache/CDN se houver.
