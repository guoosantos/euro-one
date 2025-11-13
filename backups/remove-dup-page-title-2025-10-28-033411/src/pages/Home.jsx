import React from 'react'
import Layout from '../layout/Layout'
import StatCard from '../components/StatCard'
import SimpleBar from '../components/SimpleBar'
import QuickCard from '../components/QuickCard'
import { Camera, Route, Wrench, Video } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const alerts24h = [
  {name:'10h',value:5},{name:'11h',value:7},{name:'12h',value:9},
  {name:'13h',value:8},{name:'14h',value:7},{name:'15h',value:6},
  {name:'16h',value:8},{name:'17h',value:9},{name:'18h',value:7},
  {name:'19h',value:11},{name:'20h',value:14},{name:'21h',value:5},
]

export default function Home() {
  const nav = useNavigate()
  return (
    <Layout title="Dashboard">
      <div className="flex items-center justify-between">
        <div className="sync-bar">Última sincronização: 0s</div>
        <div className="sync-bar">Atualiza a cada 30s</div>
      </div>

      <div className="grid-cards mt-2">
        <StatCard title="VEÍCULOS (TOTAL)" value="1200" series={[5,6,6,6,7,7,6,6]} />
        <StatCard title="ATIVOS" value="1045" subtitle="86% câmeras OK" series={[6,6,7,7,7,8,7,7]} />
        <StatCard title="INATIVOS" value="122" subtitle="14 câmeras OFF" series={[3,3,4,4,5,5,4,4]} />
        <StatCard title="BLOQUEADOS" value="33" series={[2,2,2,3,3,3,2,2]} />
      </div>

      <div className="grid-cards mt-2">
        <QuickCard icon={Camera} title="Câmeras" subtitle="Euro View / ADAS / DSM" onClick={()=>nav('/view/videos')} />
        <QuickCard icon={Route} title="Rotas / Trajetos" subtitle="Replays e desempenho" onClick={()=>nav('/trips')} />
        <QuickCard icon={Wrench} title="Serviços / Entregas" subtitle="OS, SLA e histórico" onClick={()=>nav('/services')} />
        <QuickCard icon={Video} title="Euro View" subtitle="Eventos, vídeos e Live" onClick={()=>nav('/view/events')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-2">
        <div className="card">
          <div className="font-medium mb-2">ALERTAS NAS ÚLTIMAS 24H</div>
          <SimpleBar data={alerts24h}/>
        </div>

        <div className="card">
          <div className="font-medium mb-2">STATUS NO MAPA (RESUMO)</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="chip green"></span> Conectados</div>
            <div className="flex items-center gap-2"><span className="chip"></span> Inativos</div>
            <div className="flex items-center gap-2"><span className="chip red"></span> Erro</div>
            <div className="mt-3 muted">Placeholder do mapa — carregue o mapa real apenas nas páginas que usam Leaflet para manter o bundle leve.</div>
            <div className="text-sm mt-2">
              Conectados: 980<br/>Inativos: 180<br/>Erro: 40
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="font-medium mb-2">ÚLTIMOS EVENTOS IMPORTANTES</div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left muted">
              <tr>
                <th className="py-2">DATA/HORA</th>
                <th>EVENTO</th>
                <th>VEÍCULO</th>
                <th>SEVERIDADE</th>
                <th>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-stroke/60">
                <td className="py-2">26/10/2025, 21:05:43</td>
                <td>Excesso de velocidade</td>
                <td>EU-100</td>
                <td><span className="chip red">Crítico</span></td>
                <td>
                  <button className="btn">Replay</button>
                  <button className="btn ml-2">No mapa</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
