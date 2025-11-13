import EuroCards from "../components/EuroCards";
import { Link } from "react-router-dom";

export default function Home(){
  return (
    <div className="p-4 text-white max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Euro One — Visão Geral</h1>
      <EuroCards />
      <div className="mt-4 grid md:grid-cols-3 gap-3">
        <Link to="/monitoring" className="rounded-2xl p-4 bg-white/5 border border-white/10 hover:bg-white/10">Mapa de Monitoramento</Link>
        <Link to="/devices" className="rounded-2xl p-4 bg-white/5 border border-white/10 hover:bg-white/10">Equipamentos</Link>
        <Link to="/devices?tab=modelos" className="rounded-2xl p-4 bg-white/5 border border-white/10 hover:bg-white/10">Modelos & Portas</Link>
      </div>
    </div>
  );
}
