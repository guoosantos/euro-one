import React from 'react';
export default class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(error){ return { hasError:true, error }; }
  componentDidCatch(error, info){ console.error('ErrorBoundary:', error, info); }
  render(){
    if (this.state.hasError){
      return (
        <div style={{padding:16}}>
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <div className="font-semibold mb-1">Houve um erro ao renderizar esta página.</div>
            <div className="text-xs opacity-80">{String(this.state.error)}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
