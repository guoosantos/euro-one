import React, { useEffect, useMemo, useState } from "react";

import PageHeader from "../ui/PageHeader";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Field from "../ui/Field";
import DataState from "../ui/DataState.jsx";
import api from "../lib/api.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";

const IMPORT_MODES = [
  { value: "singleClient", label: "Importar tudo para um único cliente" },
  { value: "byClientName", label: "Separar por Cliente (coluna Cliente)" },
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || "";
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function AdminImportXlsx() {
  const { tenant, role } = useTenant();
  const [clients, setClients] = useState([]);
  const [file, setFile] = useState(null);
  const [importMode, setImportMode] = useState("singleClient");
  const [targetClientId, setTargetClientId] = useState(tenant?.id || "");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [preview, setPreview] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [errors, setErrors] = useState(null);

  const canUseByClientName = role === "admin";

  useEffect(() => {
    if (tenant?.id && !targetClientId) {
      setTargetClientId(tenant.id);
    }
  }, [tenant, targetClientId]);

  useEffect(() => {
    if (role !== "admin") return;
    let mounted = true;
    api
      .get(API_ROUTES.clients)
      .then((response) => {
        if (!mounted) return;
        setClients(Array.isArray(response?.data) ? response.data : []);
      })
      .catch((error) => {
        console.warn("Falha ao carregar clientes", error?.message || error);
      });
    return () => {
      mounted = false;
    };
  }, [role]);

  const availableImportModes = useMemo(() => {
    if (canUseByClientName) return IMPORT_MODES;
    return IMPORT_MODES.filter((mode) => mode.value === "singleClient");
  }, [canUseByClientName]);

  const handleSubmit = async () => {
    setErrors(null);
    setSummary(null);
    setPreview(null);
    setWarnings([]);

    if (!file) {
      setErrors("Selecione um arquivo XLSX para importar.");
      return;
    }

    if (importMode === "singleClient" && !targetClientId) {
      setErrors("Selecione um cliente alvo para importar.");
      return;
    }

    setLoading(true);
    try {
      const contentBase64 = await fileToBase64(file);
      const payload = {
        mode: dryRun ? "dry-run" : "apply",
        importMode,
        targetClientId: importMode === "singleClient" ? targetClientId : undefined,
        fileName: file.name,
        contentBase64,
      };

      const result = await CoreApi.importEuroXlsx(payload);
      setSummary(result?.summary || null);
      setPreview(result?.preview || null);
      setWarnings(Array.isArray(result?.warnings) ? result.warnings : []);
      if (!result?.ok && result?.errors?.length) {
        setErrors("A importação retornou erros.");
      }
    } catch (error) {
      setErrors(error?.response?.data?.error?.message || error?.message || "Falha ao importar arquivo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Importar Base (XLSX)" description="Carregue a planilha EXPORT_VEICULO_EQUIP_OS_FINAL.xlsx" />

      <div className="grid gap-6 rounded-2xl border border-white/10 bg-white/5 p-6">
        <Field label="Arquivo XLSX">
          <Input
            type="file"
            accept=".xlsx"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </Field>

        <Field label="Modo de importação">
          <Select value={importMode} onChange={(event) => setImportMode(event.target.value)}>
            {availableImportModes.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
        </Field>

        {importMode === "singleClient" && (
          <Field label="Cliente alvo">
            <Select
              value={targetClientId}
              onChange={(event) => setTargetClientId(event.target.value)}
            >
              <option value="">Selecione um cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-white/30 bg-white/10"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Executar em modo dry-run (prévia)
        </label>

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Processando..." : dryRun ? "Gerar prévia" : "Aplicar importação"}
          </Button>
        </div>
      </div>

      {errors && <DataState tone="error" state="error" title="Falha na importação" description={errors} />}

      {summary && (
        <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-semibold">Resumo</h3>
          <div className="grid gap-2 text-sm text-white/80">
            <div>Clientes criados: {summary.clients?.created ?? 0}</div>
            <div>Clientes encontrados: {summary.clients?.matched ?? 0}</div>
            <div>Veículos criados: {summary.vehicles?.created ?? 0}</div>
            <div>Veículos atualizados: {summary.vehicles?.updated ?? 0}</div>
            <div>Produtos criados: {summary.products?.created ?? 0}</div>
            <div>Equipamentos criados: {summary.equipments?.created ?? 0}</div>
            <div>Equipamentos atualizados: {summary.equipments?.updated ?? 0}</div>
            <div>OS criadas: {summary.serviceOrders?.created ?? 0}</div>
            <div>OS atualizadas: {summary.serviceOrders?.updated ?? 0}</div>
            <div>Warnings: {summary.warnings ?? warnings.length}</div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="grid gap-3 rounded-2xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-sm text-yellow-100">
          <h3 className="text-lg font-semibold">Avisos</h3>
          <ul className="list-disc space-y-1 pl-5">
            {warnings.slice(0, 50).map((warning, index) => (
              <li key={`${warning.type || "warning"}-${index}`}>
                {warning.message || JSON.stringify(warning)}
              </li>
            ))}
          </ul>
          {warnings.length > 50 && <p>Exibindo os primeiros 50 avisos.</p>}
        </div>
      )}

      {preview && (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/80">
          <h3 className="text-lg font-semibold">Prévia de ações</h3>
          <ul className="list-disc space-y-1 pl-5">
            {preview.map((item, index) => (
              <li key={`${item.type}-${index}`}>{item.type}: {item.plate || item.internalId || item.osInternalId || item.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
