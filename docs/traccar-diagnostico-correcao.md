# Diagnóstico e correções para falhas de telemetria/Traccar

## 1. Causas prováveis dos erros observados
- **Backend não alcança o Traccar**: os logs `Não foi possível consultar o Traccar` indicam que as chamadas HTTP para `/api/positions` e `/api/events` retornam erro ou timeout. Se o host/porta ou as credenciais estiverem incorretas, o gateway perde a sessão e cada polling falha.
- **Polling agressivo no frontend**: hooks como `useLivePositions` e `usePollingTask` disparam requisições contínuas. Quando o backend retorna erro, o front continua abrindo novos requests, gerando milhares de conexões simultâneas (`net::ERR_INSUFFICIENT_RESOURCES`).
- **Dados nulos propagados**: respostas vazias ou `null` para posições são consumidas sem validação e componentes React acessam `position.address.street`, provocando `TypeError: Cannot read properties of null` e falhas no Leaflet ao acessar métodos de objetos nulos.
- **Rota inexistente**: o frontend chama `/api/media/face/alerts`, que não existe no Express, resultando em 404 e ruído adicional nos logs.
- **Ausência de tratamento de erros detalhado**: mensagens genéricas escondem status HTTP reais, dificultando identificar se o problema é autenticação (401), rede (ECONNREFUSED/ETIMEDOUT) ou formatação da requisição.

## 2. Correções sugeridas para o backend
### 2.1 Serviço de telemetria resiliente
Use a sessão administrativa (cookie `JSESSIONID`) em todas as requisições e adicione timeout, retries limitados e logs ricos.

```js
// server/services/traccar-client.js
import axios from 'axios';
import pino from 'pino';
import { TRACCAR_URL, TRACCAR_JSESSIONID } from '../config/env.js';

const log = pino({ name: 'traccar' });

const client = axios.create({
  baseURL: TRACCAR_URL,
  timeout: 5000,
  withCredentials: true,
  headers: { Cookie: `JSESSIONID=${TRACCAR_JSESSIONID}` }
});

async function fetchWithRetry(path, { retries = 2, params } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await client.get(path, { params });
      return res.data;
    } catch (err) {
      attempt += 1;
      const code = err.response?.status;
      const message = err.code || err.message;
      log.warn({ path, attempt, code, message }, 'Traccar request failed');
      if (attempt > retries || code === 401) throw err; // não insiste se for auth
      await new Promise(r => setTimeout(r, attempt * 500)); // backoff linear
    }
  }
}

export async function getLastPositions(deviceId) {
  try {
    const data = await fetchWithRetry('/api/positions/last', { params: { deviceId } });
    return { data };
  } catch (err) {
    const code = err.response?.status;
    return { error: `Falha ao consultar Traccar (${code ?? err.message})` };
  }
}
```
- Retorna `{ data }` ou `{ error }` para o controller decidir o HTTP (200 ou 503).
- Logs incluem `status`, `attempt` e `message` reais.
- Timeout padrão evita requests pendurados.

### 2.2 Controller Express com respostas claras

```js
// server/controllers/telemetry.js
import { getLastPositions } from '../services/traccar-client.js';

export async function lastPositions(req, res) {
  const { deviceId } = req.query;
  const result = await getLastPositions(deviceId);

  if (result.error) {
    return res.status(503).json({ error: result.error });
  }

  const safeData = (result.data ?? []).map(pos => ({
    ...pos,
    address: pos?.address ?? {},
    deviceId: pos?.deviceId ?? null,
  }));

  return res.json({ positions: safeData });
}
```
- Se houver erro no Traccar, devolve 503 com payload de erro.
- Normaliza `address` para objeto vazio, evitando `undefined` no front.

### 2.3 Limitar polling e evitar concorrência duplicada

```js
// server/telemetry/polling.js
let inFlight = false;
let lastRun = 0;
const MIN_INTERVAL_MS = 5000;

export async function pollTelemetry() {
  const now = Date.now();
  if (inFlight || now - lastRun < MIN_INTERVAL_MS) return;
  inFlight = true;
  try {
    // chamar serviços aqui
  } finally {
    lastRun = Date.now();
    inFlight = false;
  }
}
```
- Ignora disparos se já houver requisição em andamento ou se o intervalo mínimo não foi respeitado.

### 2.4 Rota `/api/media/face/alerts`
Opcionalmente implemente uma rota dummy para evitar 404 até o módulo existir:

```js
// server/routes/media.js
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.get('/face/alerts', authenticate, (req, res) => {
  return res.json({ alerts: [], message: 'Módulo de reconhecimento facial desativado' });
});

export default router;
```
- Ou remova/feature-flag a rota no frontend enquanto não implementada.

### 2.5 Comandos de verificação de infraestrutura
- Validar sessão e API do Traccar:
  - `curl -i http://TRACCAR_HOST:PORT/api/session`
  - `curl -i http://TRACCAR_HOST:PORT/api/positions`
- Testar conectividade e firewall: `nc -vz TRACCAR_HOST PORT`
- Confirmar env: `echo $TRACCAR_URL $TRACCAR_USER $TRACCAR_PASSWORD`
- Ajustar `axios`/HTTP keep-alive para muitas conexões simultâneas e aumentar `timeout` se a latência for alta.

## 3. Correções sugeridas para o frontend
### 3.1 Contratos de hooks com estado consistente

```ts
// client/src/hooks/useLivePositions.ts
export type LivePositionsState = {
  data: Position[] | null;
  loading: boolean;
  error: string | null;
};

const initial: LivePositionsState = { data: null, loading: false, error: null };

export function useLivePositions(deviceId?: number): LivePositionsState {
  const [state, setState] = useState(initial);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState(prev => ({ ...prev, loading: true, error: null }));

    fetchPositions(deviceId, controller.signal)
      .then(data => active && setState({ data, loading: false, error: null }))
      .catch(err => active && setState({ data: null, loading: false, error: err.message }));

    return () => {
      active = false;
      controller.abort();
    };
  }, [deviceId]);

  return state;
}
```
- Sempre retorna objeto completo; componentes usam `(state.data ?? [])` ao iterar.

### 3.2 Fallbacks e optional chaining

```jsx
const street = position?.address?.street ?? 'Endereço não disponível';
const positions = state.data ?? [];
if (!positions.length) return <MensagemSemDados />;
```
- Evita `TypeError` em dados ausentes e exibe mensagem amigável.

### 3.3 Controle de polling no frontend

```js
// client/src/hooks/usePollingTask.js
export function usePollingTask(task, intervalMs = 5000) {
  const savedTask = useRef(task);
  const timer = useRef(null);

  useEffect(() => { savedTask.current = task; }, [task]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await savedTask.current();
      timer.current = window.setTimeout(tick, intervalMs);
    };
    timer.current = window.setTimeout(tick, intervalMs);
    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [intervalMs]);
}
```
- Cancela timers ao desmontar e evita múltiplos timers concorrentes.
- Pode-se adicionar backoff exponencial ao detectar 503/abort errors.

### 3.4 Tratamento de erros de rede na camada de API

```js
// client/src/lib/api.js
export async function request(url, options = {}) {
  const controller = new AbortController();
  const signal = options.signal || controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 8000);

  try {
    const res = await fetch(url, { ...options, signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Tempo de resposta excedido');
    throw new Error(err.message || 'Falha de rede');
  } finally {
    clearTimeout(timeoutId);
  }
}
```
- Garante mensagens claras e converte AbortError em feedback amigável.

### 3.5 Feature flag para `/api/media/face/alerts`
- Só chamar se `process.env.ENABLE_FACE_ALERTS === 'true'` ou se o backend anunciar suporte via `/api/config`.

## 4. Checklist final
### Backend
- [ ] Verificar conectividade com Traccar (`curl`/`nc`) e variáveis de ambiente (host/porta/credenciais).
- [ ] Adicionar timeout, retries limitados e logs detalhados no cliente Traccar.
- [ ] Normalizar payloads (address como objeto) e retornar 503 com `{ error }` em falhas.
- [ ] Reduzir polling concorrente e impor intervalo mínimo.
- [ ] Implementar rota `/api/media/face/alerts` (dummy) ou remover chamadas.

### Frontend
- [ ] Ajustar hooks (`useLivePositions`, `useDevices`, etc.) para sempre retornar `{ data, loading, error }` e usar `positions ?? []`.
- [ ] Aplicar optional chaining e fallbacks para campos opcionais (street, coordinates, etc.).
- [ ] Melhorar `usePollingTask` para evitar timers múltiplos e aplicar backoff quando houver erro.
- [ ] Exibir mensagens de erro amigáveis em vez de deixar a página quebrar.
- [ ] Feature-flag/remover chamadas para `/api/media/face/alerts` até o backend suportar.

### Testes
- [ ] Confirmar que o backend consulta o Traccar sem erros de log.
- [ ] Recarregar `/monitoring`, `/reports/trips` e `/maintenance` verificando ausência de `Cannot read properties of null`.
- [ ] Garantir que não há flood de requisições `telemetry` e que erros de rede aparecem de forma controlada na UI.
