# Migração para o novo IP público `3.19.229.124`

Checklist para trocar todo o stack (backend, frontend e integrações) para o novo IP.

## 0) Pré-checks de rede e infraestrutura

- Confirme acesso SSH à nova EC2 (`ssh ec2-user@3.19.229.124`) e se a porta 22 está liberada para o seu IP no Security Group.
- Garanta que o Security Group exponha as portas necessárias:
  - 22 (SSH).
  - 80/443 (web via reverse proxy, se aplicável).
  - 3001 ou 5189 (API/SPA servida direto pelo Node/PM2).
  - 8082 (Traccar).
- Se houver Elastic IP disponível, associe-o à instância para evitar trocas futuras de IP.

## 1) Variáveis de ambiente (backend + frontend)

Atualize as cópias de `.env` usadas em produção com o novo endpoint:

```env
# Frontend / client
VITE_API_BASE_URL=http://3.19.229.124:3001

# Backend / server
TRACCAR_BASE_URL=http://3.19.229.124:8082
ALLOWED_ORIGINS=http://3.19.229.124:5189,http://3.19.229.124:5190,http://localhost:5189,http://127.0.0.1:5189
```

- O WebSocket `/ws/live` é montado automaticamente a partir de `VITE_API_BASE_URL`, então não precisa de variável extra: o host novo cobrirá HTTP(S) e WS(S).
- Se estiver usando Vite para debug remoto, libere as portas 5189/5190 no Security Group (ou ajuste `ALLOWED_ORIGINS` para as portas escolhidas).

## 2) Validação pós-mudança

- **API**: `curl -I http://3.19.229.124:3001/health` deve responder `200 OK`.
- **Frontend/SPA**: abra `http://3.19.229.124` (ou a porta/proxy configurada) e confirme que chamadas `/api/*` usam o novo host.
- **WebSocket**: testar `wscat -c ws://3.19.229.124:3001/ws/live` após login para validar sessões em tempo real.
- **PDF (Playwright/Chromium)**: execute `npm run provision:playwright` se a VM for nova e gere um relatório/exportação para confirmar que o binário do Chromium está presente.
- **Traccar/external**: garanta que o Traccar continue apontando para `http://3.19.229.124:8082` e que os rastreadores externos tenham a rota liberada.
