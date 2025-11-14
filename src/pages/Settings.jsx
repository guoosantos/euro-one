import React, { useState } from "react";

export default function Settings() {
  const [websocket, setWebsocket] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-4 p-6">
        <header>
          <div className="text-sm font-medium text-white">Telemetria</div>
          <p className="mt-1 text-xs text-white/50">
            Configure como a plataforma consome dados em tempo real do Traccar e quais canais devem ser atualizados.
          </p>
        </header>
        <label className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80">
          <span>Atualizações via WebSocket</span>
          <input type="checkbox" checked={websocket} onChange={(event) => setWebsocket(event.target.checked)} />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80">
          <span>Notificações por e-mail</span>
          <input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} />
        </label>
      </section>

      <section className="card space-y-4 p-6">
        <header>
          <div className="text-sm font-medium text-white">Experiência</div>
          <p className="mt-1 text-xs text-white/50">Personalize aparência e preferências da interface.</p>
        </header>
        <label className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80">
          <span>Habilitar dark mode</span>
          <input type="checkbox" checked={darkMode} onChange={(event) => setDarkMode(event.target.checked)} />
        </label>
        <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-xs text-white/50">
          Ajustes visuais são aplicados imediatamente e sincronizados com o perfil do usuário.
        </div>
      </section>
    </div>
  );
}
