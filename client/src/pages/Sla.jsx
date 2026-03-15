import React from "react";
import { Link } from "react-router-dom";
import { Timer } from "lucide-react";

import Card from "../ui/Card";

export default function Sla() {
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-white">SLA</h1>
        <p className="text-sm text-white/70">Acompanhamento de indicadores de SLA para serviços e solicitações.</p>
      </header>
      <Card>
        <div className="flex items-start gap-3">
          <Timer className="mt-0.5 h-5 w-5 text-amber-300" />
          <div className="space-y-2">
            <p className="text-sm text-white/80">
              Base inicial restaurada no source para manter o caminho funcional e independente do dist.
            </p>
            <Link className="text-sm font-medium text-amber-300 hover:text-amber-200" to="/services">
              Voltar para Ordem de Serviço
            </Link>
          </div>
        </div>
      </Card>
    </section>
  );
}
