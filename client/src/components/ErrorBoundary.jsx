import React from 'react';
export default class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(error){ return { hasError:true, error }; }
  componentDidCatch(error, info){
    if (import.meta?.env?.DEV) {
      console.error("ErrorBoundary:", error, info);
    }
  }
  render(){
    if (this.state.hasError){
      return (
        <div style={{padding:16}}>
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            <div className="font-semibold mb-1 text-red-100">Ops! Algo saiu do esperado.</div>
            <div className="text-xs opacity-80">
              Não conseguimos carregar este conteúdo agora. Você pode tentar recarregar a página.
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-red-300/40 bg-red-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-100 hover:border-red-300/70"
              >
                Recarregar
              </button>
              <span className="text-[11px] text-red-200/70">Se o problema persistir, avise o suporte.</span>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
