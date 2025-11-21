import { useEffect, useMemo, useState } from "react";
import { CoreApi } from "../lib/coreApi.js";

function ModelosPortas({models}){
  if (!Array.isArray(models) || !models.length) return <div className="opacity-60">Sem modelos.</div>;
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {models.map(m => (
        <div key={m.id||m.key||m.name} className="rounded-2xl p-4 bg-white/5 border border-white/10 text-white">
          <div className="font-semibold">{m.name || m.model || m.id}</div>
          <div className="text-xs opacity-70">{m.vendor || m.brand || ""}</div>
          <div className="mt-2">
            <div className="text-sm opacity-70 mb-1">Portas / IO</div>
            <div className="grid grid-cols-2 gap-2">
              {(m.ports || m.io || []).map((p,idx) => (
                <div key={idx} className="rounded-lg p-2 bg-white/10 text-xs">
                  <div className="font-medium">{p.label||p.key||p.name}</div>
                  <div className="opacity-70">{p.type||p.mode||"digital"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Equipamentos(){
  const [tab, setTab] = useState(()=> new URLSearchParams(location.search).get("tab") || "lista");
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState({ name:"", uniqueId:"", modelId:"" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [devs, mods] = await Promise.all([CoreApi.listDevices(), CoreApi.models()]);
        setDevices(Array.isArray(devs)?devs:[]);
        setModels(Array.isArray(mods)?mods:[]);
      } catch(e){ console.error(e); }
    })();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name || undefined,
        uniqueId: form.uniqueId,
        modelId: form.modelId || undefined
      };
      await CoreApi.createDevice(payload);
      const devs = await CoreApi.listDevices();
      setDevices(Array.isArray(devs)?devs:[]);
      setForm({ name:"", uniqueId:"", modelId:"" });
      setTab("lista");
    } catch(e){ alert(e.message); }
    finally { setBusy(false); }
  };

  const modeloById = useMemo(() => {
    const map = {};
    for (const m of models) map[m.id||m.key] = m;
    return map;
  }, [models]);

  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={()=>setTab("lista")} className={"px-3 py-2 rounded-lg "+(tab==="lista"?"bg-white/10":"bg-white/5")}>Lista</button>
        <button onClick={()=>setTab("cadastro")} className={"px-3 py-2 rounded-lg "+(tab==="cadastro"?"bg-white/10":"bg-white/5")}>Cadastro</button>
        <button onClick={()=>setTab("modelos")} className={"px-3 py-2 rounded-lg "+(tab==="modelos"?"bg-white/10":"bg-white/5")}>Modelos & Portas</button>
      </div>

      {tab==="cadastro" && (
        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-3">
          <div className="col-span-1">
            <label className="text-sm opacity-70">Nome (opcional)</label>
            <input className="w-full p-2 rounded-lg bg-white/5 border border-white/10"
              value={form.name} onChange={e=>setForm(v=>({...v, name:e.target.value}))}/>
          </div>
          <div className="col-span-1">
            <label className="text-sm opacity-70">IMEI / uniqueId *</label>
            <input required className="w-full p-2 rounded-lg bg-white/5 border border-white/10"
              value={form.uniqueId} onChange={e=>setForm(v=>({...v, uniqueId:e.target.value}))}/>
          </div>
          <div className="col-span-1">
            <label className="text-sm opacity-70">Modelo (opcional)</label>
            <select className="w-full p-2 rounded-lg bg-white/5 border border-white/10"
              value={form.modelId} onChange={e=>setForm(v=>({...v, modelId:e.target.value}))}>
              <option value="">— selecione —</option>
              {models.map(m => <option key={m.id||m.key} value={m.id||m.key}>{m.name||m.model||m.id}</option>)}
            </select>
          </div>
          <div className="col-span-3">
            <button disabled={busy} className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20">
              {busy? "Salvando…" : "Cadastrar"}
            </button>
          </div>
        </form>
      )}

      {tab==="lista" && (
        <div className="rounded-2xl border border-white/10 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left">
                <th className="p-2">Nome</th>
                <th className="p-2">IMEI</th>
                <th className="p-2">Modelo</th>
              </tr>
            </thead>
            <tbody>
              {devices.length===0 && <tr><td className="p-3 opacity-60" colSpan={3}>Nenhum equipamento.</td></tr>}
              {devices.map(d => (
                <tr key={d.id} className="border-t border-white/10">
                  <td className="p-2">{d.name||"—"}</td>
                  <td className="p-2">{d.uniqueId||d.phone||d.id}</td>
                  <td className="p-2">{(modeloById[d.modelId||""]?.name) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab==="modelos" && (<ModelosPortas models={models} />)}
    </div>
  );
}
