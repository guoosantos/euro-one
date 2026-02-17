# NT407-PRO (X3Tech) - Setup no Euro One (direto, sem Traccar)

Este guia documenta a homologacao da dashcam NT407-PRO usando ingestao direta no backend do Euro One:
- JT/T 808 para telemetria e eventos
- JT/T 1078 para video/live

## 1) Fontes de verdade (manual/protocolo)

Arquivos usados para implementar o parser e fluxo:
- `NT407 - PRO 06_V7 - GPS..pdf`
- `Manual_do_usuário_NT407-PRO_DASHCAM-_X3Tech_rev1.01.pdf`
- `Folder_NT407-PRO_-_PT_..pdf`
- `NT407-PRO V7PRO JTT 1078-2016 video communication protocol REV1.00.pdf`

Pontos aplicados no backend:
- frame JT/T 808 com delimitador `0x7e`
- escape JT/T 808 (`0x7d 0x02` para `0x7e`, `0x7d 0x01` para `0x7d`)
- checksum XOR
- parse de cabecalho (`msgId`, `terminalId`, `seq`, `bodyProps`)
- mensagens 808 principais: `0x0100`, `0x0102`, `0x0200`, `0x0704`, `0x0800`, `0x0801`, `0x0802`
- mensagens 1078 principais: `0x9101`, `0x9102`, `0x9205`, `0x1205`, `0x1206`

## 2) Variaveis de ambiente

Configure no `.env` do backend:

```env
NT407_BIND_HOST=0.0.0.0
NT407_TCP_PORT=5001
NT407_UDP_PORT=
NT407_LIVE_SERVER_IP=
NT407_LIVE_TCP_PORT=5001
NT407_LIVE_UDP_PORT=5001
NT407_AUTH_CODE=NT407-EURO-ONE
```

Observacoes:
- `NT407_TCP_PORT`: porta principal de captura JT/T 808 (padrao 5001).
- `NT407_UDP_PORT`: opcional para payload JT/T 1078 via UDP.
- `NT407_BIND_HOST`: interface de bind (padrao `0.0.0.0`).
- `NT407_LIVE_SERVER_IP`: IP publico/alcancavel pela camera para retorno de live (recomendado em ambiente produtivo).

## 3) Configuracao da camera NT407-PRO

No app/plataforma de configuracao da camera:
1. Definir protocolo compativel JT/T 808 (2013/2019 conforme firmware).
2. Apontar IP do servidor Euro One em `Server IP`.
3. Definir porta para `NT407_TCP_PORT`.
4. Configurar APN/operadora conforme SIM instalado.
5. Confirmar IMEI/terminal ID usado para vinculo no Euro One.

## 4) Subida do backend e listeners

Ao iniciar o backend (`npm run dev --workspace server`), verifique logs:

- inicio do listener:
  - `[nt407] iniciando listener NT407 { host, tcpPort, udpPort }`
- listener ativo:
  - `[nt407] listener NT407 ativo { bindHost, tcpPort, udpPort }`
- conexao recebida:
  - `[nt407] conexao TCP recebida`
- mensagem parseada:
  - `[nt407] mensagem recebida { terminalId, protocolDetected, msgId, seq, timestamp }`
- falha de parse/checksum:
  - `[nt407] falha ao parsear frame JT/T 808`
  - `[nt407] checksum invalido em mensagem JT/T 808`

## 5) Validacao funcional

### Health/listener

`GET /api/nt407/health`

Retorna bind/porta e contadores de sessoes/ingestao.

### Dispositivos

`GET /api/nt407/devices`

Lista dispositivos vinculados ao protocolo/modelo NT407.

### Videos

`GET /api/nt407/videos?deviceId=...&from=...&to=...&type=...`

Retorna midias indexadas por `deviceId`, `cameraChannel`, `startTime/endTime`, `eventType` e `downloadUrl`.

### Sensor de Fadiga

`GET /api/nt407/fatigue?deviceId=...&from=...&to=...&severity=...`

Retorna eventos de fadiga/drowsiness com score, severidade e vinculo de video quando encontrado.

### Live

- iniciar: `POST /api/nt407/live/start` com `{ "deviceId": "...", "channel": 1 }`
- parar: `POST /api/nt407/live/stop` com `{ "liveId": "..." }`

Resposta de start inclui URL de playlist `playbackUrl`.

## 6) Euro View

Menus suportados:
- `Videos`
- `Reconhecimento Facial`
- `Live`
- `Sensor de Fadiga` (novo)

As telas consomem exclusivamente `/api/nt407/*` para NT407.

## 7) Portas em uso e como trocar

- Backend HTTP: `PORT` (padrao 3001)
- NT407 TCP: `NT407_TCP_PORT` (padrao 5001)
- NT407 UDP (opcional): `NT407_UDP_PORT`

Para trocar, altere `.env` e reinicie o backend.
