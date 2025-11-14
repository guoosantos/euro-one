import React, { useState } from "react";

export default function Settings() {
  const [websocket, setWebsocket] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="card space-y-3">
        <div className="text-sm font-medium text-white">Telemetria</div>
        <label className="flex items-center justify-between text-sm text-white/70">
          WebSocket do Traccar
          <input type="checkbox" checked={websocket} onChange={(event) => setWebsocket(event.target.checked)} />
        </label>
        <label className="flex items-center justify-between text-sm text-white/70">
          Notificações por e-mail
          <input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} />
        </label>
      </section>

      <section className="card space-y-3">
        <div className="text-sm font-medium text-white">Experiência</div>
        <label className="flex items-center justify-between text-sm text-white/70">
          Dark mode
          <input type="checkbox" checked={darkMode} onChange={(event) => setDarkMode(event.target.checked)} />
        </label>
        <div className="text-xs text-white/50">Ajustes aplicados instantaneamente.</div>
      </section>
    </div>
  );
}
