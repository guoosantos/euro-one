import React from "react";
import useOutsideClick from "../../hooks/useOutsideClick";

export default function MonitoringLayoutSelector({ layoutVisibility, onToggle, onClose }) {
  // O hook retorna a ref que deve ser ligada ao elemento pai
  const ref = useOutsideClick(onClose);

  const options = [
    { key: "showMap", label: "Mostrar Mapa" },
    { key: "showTable", label: "Mostrar Tabela" },
  ];

  return (
    <div
      ref={ref}
      className="w-56 max-h-[75vh] bg-[#161b22] border border-white/10 rounded-xl shadow-3xl ring-1 ring-white/10 flex flex-col overflow-auto animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Cabeçalho */}
      <div className="px-4 py-3 border-b border-white/10 bg-[#1c222b]">
        <span className="text-xs font-bold text-white uppercase tracking-wider">
          Layout da Tela
        </span>
      </div>
      
      {/* Opções */}
      <div className="p-2 space-y-1">
        {options.map((option) => {
          const isChecked = layoutVisibility?.[option.key] !== false;
          
          return (
            <label 
              key={option.key} 
              className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 cursor-pointer select-none group transition-colors"
            >
              <div className="flex items-center gap-3">
                {/* Ícone visual do Checkbox */}
                <div className={`
                  w-4 h-4 rounded border flex items-center justify-center transition-all
                  ${isChecked 
                    ? 'bg-primary border-primary' 
                    : 'border-white/30 group-hover:border-white/50 bg-transparent'}
                `}>
                  {isChecked && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                
                <span className={`text-sm ${isChecked ? 'text-white' : 'text-white/50'}`}>
                  {option.label}
                </span>
              </div>

              {/* Checkbox nativo oculto (para acessibilidade e lógica) */}
              <input 
                type="checkbox" 
                className="hidden"
                checked={isChecked} 
                onChange={() => onToggle && onToggle(option.key)} 
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
