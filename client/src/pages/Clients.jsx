import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api
      .get(API_ROUTES.clients)
      .then((response) => {
        if (mounted) {
          setClients(response?.data?.clients || response?.data || []);
        }
      })
      .catch((err) => mounted && setError(err));
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4 text-white/80">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clientes</h1>
      </div>
      {error && <div className="rounded-lg bg-red-500/20 p-3 text-red-100">{error.message}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => (
          <div key={client.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-lg font-semibold text-white">{client.companyName || client.name}</div>
            <div className="text-sm text-white/60">Status financeiro: {client.status || "OK"}</div>
          </div>
        ))}
        {!clients.length && !error && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/60">
            Nenhum cliente cadastrado.
          </div>
        )}
      </div>
    </div>
  );
}
