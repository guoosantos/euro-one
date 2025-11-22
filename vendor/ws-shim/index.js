import { EventEmitter } from "events";

const runtimeWebSocket = globalThis.WebSocket;

if (!runtimeWebSocket) {
  throw new Error(
    "Nenhum suporte a WebSocket foi encontrado neste runtime. Instale 'undici' ou use um ambiente com WebSocket nativo.",
  );
}

class WsAdapter extends EventEmitter {
  constructor(url, protocols = [], options = {}) {
    super();

    const socket = new runtimeWebSocket(url, protocols, options);
    this._socket = socket;
    this.readyState = socket.readyState;

    const forward = (type, mapper = (payload) => payload) => {
      socket.addEventListener(type, (event) => {
        this.readyState = socket.readyState;
        const mapped = mapper(event);
        if (Array.isArray(mapped)) {
          this.emit(type, ...mapped);
        } else {
          this.emit(type, mapped);
        }
      });
    };

    forward("open");
    forward("close", (event) => [event.code, event.reason]);
    forward("error", (event) => event?.error || event);
    forward("message", (event) => event.data);
  }

  send(data) {
    return this._socket.send(data);
  }

  close(code, reason) {
    return this._socket.close(code, reason);
  }
}

export default WsAdapter;
export { WsAdapter as WebSocket };
