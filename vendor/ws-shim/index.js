import { WebSocket as UndiciWebSocket } from "undici";

const runtimeWebSocket = globalThis.WebSocket || UndiciWebSocket;

if (!runtimeWebSocket) {
  throw new Error("Nenhum suporte a WebSocket foi encontrado neste runtime.");
}

export default runtimeWebSocket;
export { runtimeWebSocket as WebSocket };
