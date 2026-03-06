import React from "react";
import { BookOpenCheck } from "lucide-react";
import PageHeader from "../components/ui/PageHeader.jsx";

export default function Trainings() {
  return (
    <div className="space-y-4">
      <PageHeader title="Treinamentos" subtitle="Gestão e acompanhamento de trilhas de treinamento." />
      <section className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3 text-sm text-text/80">
          <BookOpenCheck size={18} className="text-primary" />
          <span>Módulo de treinamentos disponível nesta rota.</span>
        </div>
      </section>
    </div>
  );
}
