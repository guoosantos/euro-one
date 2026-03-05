import http from "node:http";
import { PassThrough } from "node:stream";

export function requestApp(app, { method = "GET", url = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new PassThrough();
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    req.socket = socket;
    req.connection = socket;

    let payload = body;
    if (typeof payload !== "undefined" && payload !== null) {
      if (typeof payload === "object" && !Buffer.isBuffer(payload)) {
        payload = JSON.stringify(payload);
        if (!req.headers["content-type"]) {
          req.headers["content-type"] = "application/json";
        }
      }
      if (!req.headers["content-length"]) {
        req.headers["content-length"] = String(Buffer.byteLength(payload));
      }
      req.push(payload);
    }
    req.push(null);
    req.complete = true;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    const chunks = [];
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = (chunk, encoding, cb) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }
      return originalWrite(chunk, encoding, cb);
    };

    res.end = (chunk, encoding, cb) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }
      return originalEnd(chunk, encoding, cb);
    };

    res.on("finish", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode ?? 200,
        headers: res.getHeaders(),
        text: () => Promise.resolve(bodyText),
        json: async () => (bodyText ? JSON.parse(bodyText) : null),
      });
    });
    res.on("error", reject);

    app.handle(req, res);
  });
}
