import React from "react";

import PageHeader from "../../components/ui/PageHeader.jsx";
import DataState from "../../ui/DataState.jsx";

export default function RiskArea() {
  return (
    <div className="space-y-4">
      <PageHeader
        overline="Análises"
        title="Área de Risco"
        subtitle="Visualize as áreas de risco associadas aos veículos autorizados."
      />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <DataState
          state="info"
          title="Nenhuma área de risco disponível"
          description="Selecione filtros de monitoramento para visualizar zonas críticas."
        />
      </div>
    </div>
  );
}
