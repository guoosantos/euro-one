import React from 'react'
import Layout from '../layout/Layout'

export default function Monitoring() {
  return (
    <Layout title="Monitoramento">
      {/* Header compacto (sem título duplicado gigante) */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold text-white">Monitoramento</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#9AA3B2]">Última sincronização: 0s</span>
          <select className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-1">
            <option>A cada 30s</option>
            <option>A cada 60s</option>
          </select>
          <button className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-1">
            Atualizar
          </button>
        </div>
      </div>

      {/* Cards de status (placeholders — mantém o visual) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-[#0f141c] border border-[#1f2430] rounded-2xl p-4">
          <div className="text-[#9AA3B2] text-sm">ONLINE</div>
          <div className="text-2xl text-white mt-2">0</div>
        </div>
        <div className="bg-[#0f141c] border border-[#1f2430] rounded-2xl p-4">
          <div className="text-[#9AA3B2] text-sm">EM ALERTA</div>
          <div className="text-2xl text-white mt-2">0</div>
        </div>
        <div className="bg-[#0f141c] border border-[#1f2430] rounded-2xl p-4">
          <div className="text-[#9AA3B2] text-sm">CÂMERAS OK</div>
          <div className="text-2xl text-white mt-2">0</div>
        </div>
        <div className="bg-[#0f141c] border border-[#1f2430] rounded-2xl p-4">
          <div className="text-[#9AA3B2] text-sm">SEM SINAL (+1H)</div>
          <div className="text-2xl text-white mt-2">0</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-[#0f141c] border border-[#1f2430] rounded-2xl p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input className="flex-1 bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2" placeholder="Buscar (veículo, placa…)" />
          <select className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2"><option>Status: Todos</option></select>
          <select className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2"><option>Grupo: Todos</option></select>
          <select className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2"><option>Período: Intervalo</option></select>
          <input className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2" placeholder="dd/mm/aaaa" />
          <input className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2" placeholder="dd/mm/aaaa" />
          <button className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2">Limpar filtros</button>
          <button className="bg-[#131a24] border border-[#1f2430] rounded-lg px-3 py-2">Atualizar</button>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-[#0f141c] border border-[#1f2430] rounded-2xl p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[#9AA3B2]">
              <tr className="text-left">
                <th className="py-2 pr-6">VEÍCULO</th>
                <th className="py-2 pr-6">PLACA</th>
                <th className="py-2 pr-6">STATUS</th>
                <th className="py-2 pr-6">ÚLTIMA TRANSMISSÃO</th>
                <th className="py-2 pr-6">ENDEREÇO</th>
                <th className="py-2 pr-6">VEL (KM/H)</th>
                <th className="py-2 pr-6">IGNAÇÃO</th>
                <th className="py-2 pr-6">BATERIA</th>
                <th className="py-2 pr-6">RSSI</th>
                <th className="py-2 pr-6">SATÉLITES</th>
                <th className="py-2 pr-6">ALERTAS (GRAU)</th>
                <th className="py-2 pr-6">AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="py-6 text-[#9AA3B2]" colSpan={12}>Sem dados.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 mt-4 text-sm">
          <button className="px-3 py-1 bg-[#131a24] border border-[#1f2430] rounded-lg">‹</button>
          <span>Página 1</span>
          <button className="px-3 py-1 bg-[#131a24] border border-[#1f2430] rounded-lg">›</button>
        </div>
      </div>
    </Layout>
  )
}
