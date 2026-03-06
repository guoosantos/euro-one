import React from "react";
import { Timer } from "lucide-react";
import PageHeader from "../components/ui/PageHeader.jsx";

export default function Sla() {
  return (
    <div className="space-y-4">
      <PageHeader title="SLA de Atendimento" subtitle="Indicadores e metas de nível de serviço." />
      <section className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3 text-sm text-text/80">
          <Timer size={18} className="text-primary" />
          <span>Painel de SLA disponível nesta rota.</span>
        </div>
      </section>
    </div>
  );
}
