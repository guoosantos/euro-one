import React from "react";
import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";

import Card from "../ui/Card";

export default function Trainings() {
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-white">Treinamentos</h1>
        <p className="text-sm text-white/70">Gestão de treinamentos vinculados ao atendimento de serviços.</p>
      </header>
      <Card>
        <div className="flex items-start gap-3">
          <GraduationCap className="mt-0.5 h-5 w-5 text-sky-300" />
          <div className="space-y-2">
            <p className="text-sm text-white/80">
              Esta tela restaura o fluxo funcional de Treinamentos sem depender do dist compilado.
            </p>
            <Link className="text-sm font-medium text-sky-300 hover:text-sky-200" to="/services">
              Voltar para Ordem de Serviço
            </Link>
          </div>
        </div>
      </Card>
    </section>
  );
}
