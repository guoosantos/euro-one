import React from "react";

import PageHeader from "../../components/ui/PageHeader.jsx";

export default function SecurityAnalytics() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Segurança"
        subtitle="Área dedicada a análises e indicadores de segurança."
      />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
        <p className="text-sm">
          Em breve: indicadores de segurança, alertas críticos e análises personalizadas.
        </p>
      </div>
    </div>
  );
}
