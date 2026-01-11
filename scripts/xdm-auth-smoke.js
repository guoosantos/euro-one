import { loadEnv } from "../server/utils/env.js";

await loadEnv();

const authUrl = process.env.XDM_AUTH_URL;
const clientId = process.env.XDM_CLIENT_ID;
const clientSecret = process.env.XDM_CLIENT_SECRET;
const scope = process.env.XDM_OAUTH_SCOPE;
const audience = process.env.XDM_OAUTH_AUDIENCE;
const secretLen = clientSecret ? String(clientSecret).length : 0;

console.log("[xdm-auth-smoke] env", {
  authUrl,
  clientId,
  secretLen,
});

if (!authUrl || !clientId || !clientSecret) {
  console.error("Missing required env vars: XDM_AUTH_URL, XDM_CLIENT_ID, XDM_CLIENT_SECRET");
  process.exit(1);
}

async function requestToken(authMode) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
  });

  if (authMode === "post") {
    body.set("client_secret", clientSecret);
  }

  if (scope && String(scope).trim()) {
    body.set("scope", String(scope).trim());
  }

  if (audience && String(audience).trim()) {
    body.set("audience", String(audience).trim());
  }

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (authMode === "basic") {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }

  const response = await fetch(authUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    return {
      ok: false,
      status: response.status,
      body: message,
    };
  }

  const payload = await response.json();
  const token = payload?.access_token || "";
  const tokenPreview = token ? `${token.slice(0, 20)}...` : null;

  return {
    ok: true,
    status: response.status,
    body: {
      access_token: tokenPreview,
      expires_in: payload?.expires_in ?? null,
    },
  };
}

const modes = ["post", "basic"];
let anySuccess = false;

for (const mode of modes) {
  try {
    const result = await requestToken(mode);
    if (result.ok) {
      anySuccess = true;
      console.log("[xdm-auth-smoke] auth ok", {
        mode,
        status: result.status,
        body: result.body,
        clientId,
        authUrl,
        secretLen,
      });
    } else {
      console.error("[xdm-auth-smoke] auth failed", {
        mode,
        status: result.status,
        body: result.body,
        clientId,
        authUrl,
        secretLen,
      });
    }
  } catch (error) {
    console.error("[xdm-auth-smoke] request error", {
      mode,
      message: error?.message || error,
      clientId,
      authUrl,
      secretLen,
    });
  }
}

if (!anySuccess) {
  process.exit(1);
}
