const authUrl = process.env.XDM_AUTH_URL;
const clientId = process.env.XDM_CLIENT_ID;
const clientSecret = process.env.XDM_CLIENT_SECRET;
const scope = process.env.XDM_OAUTH_SCOPE;
const audience = process.env.XDM_OAUTH_AUDIENCE;

if (!authUrl || !clientId || !clientSecret) {
  console.error("Missing required env vars: XDM_AUTH_URL, XDM_CLIENT_ID, XDM_CLIENT_SECRET");
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: "client_credentials",
  client_id: clientId,
  client_secret: clientSecret,
});

if (scope && String(scope).trim()) {
  body.set("scope", String(scope).trim());
}

if (audience && String(audience).trim()) {
  body.set("audience", String(audience).trim());
}

try {
  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("[xdm-auth-smoke] auth failed", {
      status: response.status,
      body: message,
      clientId,
      authUrl,
    });
    process.exit(1);
  }

  const payload = await response.json();
  const token = payload?.access_token || "";
  const tokenPreview = token ? `${token.slice(0, 20)}...` : null;

  console.log("[xdm-auth-smoke] auth ok", {
    status: response.status,
    tokenPreview,
    expiresIn: payload?.expires_in ?? null,
  });
} catch (error) {
  console.error("[xdm-auth-smoke] request error", {
    message: error?.message || error,
    clientId,
    authUrl,
  });
  process.exit(1);
}
