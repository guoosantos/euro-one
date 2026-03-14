import { AlertTriangle, ArrowRight, Radio, ShieldAlert, Sparkles, Truck } from "lucide-react";

import Card from "../../ui/Card.jsx";
import KPI from "../../ui/KPI.jsx";
import Button from "../../ui/Button.jsx";
import { formatAddress } from "../../lib/format-address.js";

function formatStaleLabel(value) {
  if (value === null || value === undefined) return "Sem telemetria";
  return `${value} min sem atualizar`;
}

export default function SentinelOperationalWorkspace({
  assistantName,
  loading = false,
  loadError = null,
  totalVehicles = 0,
  onlineVehicles = 0,
  pendingAlerts = 0,
  openTasks = 0,
  staleVehicles = 0,
  attentionRows = [],
  selectedRow = null,
  briefing = "",
  briefingLoading = false,
  briefingError = null,
  caseInsight = "",
  caseInsightLoading = false,
  caseInsightError = null,
  onOpenChat,
  onRefresh,
  onGenerateBriefing,
  onAnalyzeCase,
  onSelectRow,
  onOpenMonitoring,
  learningAction = null,
}) {
  const activeRow = selectedRow || attentionRows[0] || null;

  return (
    <div className="flex flex-col gap-6 pb-24">
      <section className="overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_34%),linear-gradient(180deg,rgba(11,18,28,0.96),rgba(7,14,22,0.98))] p-6 shadow-[0_24px_56px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/85">Centro Operacional IA</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[0.02em] text-white sm:text-4xl">{assistantName}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/70">
              Painel operacional com leitura contextual, fila priorizada de alertas e copiloto integrado sem sair da tela.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={onOpenChat}>
              Abrir chat
            </Button>
            <Button
              onClick={() => onGenerateBriefing?.("Gere um briefing executivo e operacional do tenant atual, com foco em riscos, comunicacao, alertas e proximos passos.")}
              disabled={briefingLoading}
            >
              Gerar briefing
            </Button>
            <Button variant="secondary" onClick={onRefresh} disabled={loading}>
              Atualizar dados
            </Button>
            {learningAction}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KPI tone="blue" title="Veiculos monitorados" value={String(totalVehicles)} icon={<Truck size={16} />} hint="Base autorizada no tenant atual" />
        <KPI tone="green" title="Comunicando agora" value={String(onlineVehicles)} icon={<Radio size={16} />} hint="Ultima atualizacao em ate 15 min" />
        <KPI tone={pendingAlerts > 0 ? "yellow" : "default"} title="Alertas pendentes" value={String(pendingAlerts)} icon={<AlertTriangle size={16} />} hint="Casos que exigem triagem nesta tela" />
        <KPI tone={staleVehicles > 0 ? "red" : "default"} title="Comunicacao degradada" value={String(staleVehicles)} icon={<ShieldAlert size={16} />} hint="Sem atualizacao recente ou acima de 60 min" />
        <KPI tone="default" title="Tasks abertas" value={String(openTasks)} icon={<Sparkles size={16} />} hint="Pendencias operacionais em aberto" />
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card
          title="Alertas e fila imediata"
          subtitle="Selecione um caso para ver detalhes, prioridade sugerida e leitura operacional sem abrir outra pagina."
        >
          {loading ? (
            <div className="text-sm text-white/60">Carregando fila operacional...</div>
          ) : attentionRows.length ? (
            <div className="max-h-[38rem] space-y-3 overflow-y-auto pr-1">
              {attentionRows.map((row) => {
                const isActive = activeRow?.vehicleId && String(activeRow.vehicleId) === String(row.vehicleId);
                return (
                  <button
                    key={row.vehicleId}
                    type="button"
                    onClick={() => onSelectRow?.(row)}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                      isActive
                        ? "border-cyan-300/40 bg-cyan-400/[0.08] shadow-[0_0_0_1px_rgba(103,232,249,0.12)]"
                        : "border-white/10 bg-white/[0.03] hover:border-cyan-400/25 hover:bg-cyan-400/[0.05]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{row.plate}</span>
                        {row.critical ? (
                          <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-rose-100">
                            Critico
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-white/60">{row.name}</div>
                      <div className="mt-2 text-xs leading-5 text-white/45">{formatAddress(row.address) || "Endereco nao confirmado"}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-white">{row.alertCount} alertas</div>
                      <div className="mt-1 text-xs text-white/55">{formatStaleLabel(row.staleMinutes)}</div>
                      <div className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200">
                        Ver caso
                        <ArrowRight size={12} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-white/60">Nenhum item critico priorizado agora.</div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card
            title={activeRow ? `Caso em foco • ${activeRow.plate}` : "Caso em foco"}
            subtitle="Detalhe operacional dentro do SENTINEL, sem redirecionar automaticamente para outra tela."
            actions={activeRow ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onAnalyzeCase?.("priority", activeRow)} disabled={caseInsightLoading}>
                  Prioridade
                </Button>
                <Button variant="ghost" onClick={() => onAnalyzeCase?.("summary", activeRow)} disabled={caseInsightLoading}>
                  Ler caso
                </Button>
              </div>
            ) : null}
          >
            {activeRow ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">Endereco</div>
                    <div className="mt-2 text-sm leading-6 text-white/85">{formatAddress(activeRow.address) || "Endereco nao confirmado"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">Comunicacao</div>
                    <div className="mt-2 text-sm text-white/85">{formatStaleLabel(activeRow.staleMinutes)}</div>
                    <div className="mt-2 text-xs text-white/55">{activeRow.alertCount} alertas associados</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-400/15 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(7,17,26,0.92))] p-4">
                  {caseInsightLoading ? (
                    <div className="text-sm text-cyan-100/80">O {assistantName} esta analisando este caso...</div>
                  ) : caseInsight ? (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-white/88">{caseInsight}</div>
                  ) : (
                    <div className="text-sm text-cyan-100/80">
                      Selecione um caso e clique em <strong>Ler caso</strong> ou <strong>Prioridade</strong> para a IA explicar o contexto aqui mesmo.
                    </div>
                  )}
                  {caseInsightError ? <div className="mt-3 text-sm text-rose-200">{caseInsightError}</div> : null}
                </div>

                {onOpenMonitoring ? (
                  <Button variant="ghost" onClick={() => onOpenMonitoring(activeRow)}>
                    Abrir monitoramento detalhado
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-white/60">Selecione um alerta da fila para abrir a leitura contextual do caso.</div>
            )}
          </Card>

          <Card
            title={`Briefing ${assistantName}`}
            subtitle="Resumo executivo-operacional consolidado pelo copiloto."
            actions={(
              <Button
                variant="secondary"
                onClick={() => onGenerateBriefing?.("Resuma a situacao operacional atual do tenant, destaque riscos, comunicacao degradada, fila de alertas e proximos passos recomendados.")}
                disabled={briefingLoading}
              >
                Atualizar
              </Button>
            )}
          >
            <div className="rounded-2xl border border-cyan-400/15 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(7,17,26,0.92))] p-4">
              {briefingLoading ? (
                <div className="text-sm text-cyan-100/80">O {assistantName} esta consolidando o briefing...</div>
              ) : briefing ? (
                <div className="whitespace-pre-wrap text-sm leading-7 text-white/88">{briefing}</div>
              ) : (
                <div className="text-sm text-cyan-100/80">
                  Gere um briefing para ter uma leitura rapida do tenant atual com linguagem operacional.
                </div>
              )}
              {briefingError ? <div className="mt-3 text-sm text-rose-200">{briefingError}</div> : null}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button variant="ghost" onClick={() => onGenerateBriefing?.("Quais sao os maiores riscos operacionais agora neste tenant?")}>
                Riscos agora
              </Button>
              <Button variant="ghost" onClick={() => onGenerateBriefing?.("Priorize a fila operacional atual e sugira o que tratar primeiro.")}>
                Priorizar fila
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
