import React, { useState } from "react";

export default function ServiceOrderImport() {
  const [file, setFile] = useState(null);
  const [clientId, setClientId] = useState("");
  const [mode, setMode] = useState("dry-run");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const toBase64 = async (selectedFile) => {
    const buffer = await selectedFile.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const runImport = async () => {
    if (!file) {
      alert("Selecione um XLSX.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const contentBase64 = await toBase64(file);
      const response = await fetch("/api/core/euro/import-xlsx", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || undefined,
          fileName: file.name,
          contentBase64,
          mode,
        }),
      });

      const payload = await response.json();
      setResult(payload);
    } catch (error) {
      console.error("Falha no import", error);
      alert("Falha no import.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">Importar base (XLSX)</div>
          <p className="text-sm text-white/60">
            Use o XLSX consolidado para popular veículos, equipamentos e OS.
          </p>
        </div>
        <button type="button" onClick={runImport} disabled={loading} className="btn btn-primary">
          {loading ? "Processando..." : mode === "dry-run" ? "Prévia (dry-run)" : "Importar (apply)"}
        </button>
      </div>

      <div className="card grid gap-4 md:grid-cols-2">
        <label>
          <div className="text-xs text-white/60 mb-2">Arquivo</div>
          <input
            type="file"
            accept=".xlsx"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="block w-full text-white/70"
          />
        </label>

        <label>
          <div className="text-xs text-white/60 mb-2">Modo</div>
          <select value={mode} onChange={(event) => setMode(event.target.value)} className="input">
            <option value="dry-run">dry-run (somente prévia)</option>
            <option value="apply">apply (aplicar no banco)</option>
          </select>
        </label>

        <label className="md:col-span-2">
          <div className="text-xs text-white/60 mb-2">clientId (opcional)</div>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Se seu importador exigir clientId, preencha aqui."
            className="input"
          />
        </label>
      </div>

      <div className="card">
        <div className="text-sm font-semibold text-white mb-2">Resultado</div>
        <pre className="text-xs text-white/70 overflow-auto">{result ? JSON.stringify(result, null, 2) : "—"}</pre>
      </div>
    </div>
  );
}
