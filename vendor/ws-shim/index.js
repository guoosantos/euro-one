let runtimeWebSocket = globalThis.WebSocket;

if (!runtimeWebSocket) {
  try {
    const undiciModule = await import("undici");
    runtimeWebSocket = undiciModule?.WebSocket || null;
  } catch (_error) {
    runtimeWebSocket = null;
  }
}

if (!runtimeWebSocket) {
  throw new Error(
    "Nenhum suporte a WebSocket foi encontrado neste runtime. Instale 'undici' ou use um ambiente com WebSocket nativo.",
  );
}

export default runtimeWebSocket;
export { runtimeWebSocket as WebSocket };
