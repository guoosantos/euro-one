import React from "react";

export default function MonitoringTable({ rows, columns, loading, selectedDeviceId, onSelect, emptyText }) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        <div className="animate-pulse">Carregando dados da frota...</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        {emptyText || "Nenhum veículo encontrado."}
      </div>
    );
  }

  return (
    <div className="min-w-full inline-block align-middle">
      <table className="min-w-full text-left border-collapse">
        <thead className="bg-[#161b22] sticky top-0 z-10 shadow-sm border-b border-white/10">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-[11px] font-bold text-white/60 uppercase tracking-wider whitespace-nowrap bg-[#161b22]"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-[#0b0f17]">
          {rows.map((row) => (
            <tr
              key={row.key}
              onClick={() => onSelect(row.deviceId)}
              className={`
                group cursor-pointer transition-colors hover:bg-white/[0.03]
                ${selectedDeviceId === row.deviceId ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent"}
              `}
            >
              {columns.map((col) => {
                // --- TRATAMENTO SEGURO DE DADOS ---
                // Verifica se tem render customizado, senão pega o valor direto
                let cellValue = col.render ? col.render(row) : row[col.key];

                // Proteção extra contra [object Object] se o render falhar ou não existir
                if (typeof cellValue === 'object' && cellValue !== null && !React.isValidElement(cellValue)) {
                   // Se for um objeto de endereço, tenta formatar, senão stringify
                   if (cellValue.formattedAddress) {
                       cellValue = cellValue.formattedAddress;
                   } else if (cellValue.address) {
                       cellValue = cellValue.address;
                   } else {
                       cellValue = ""; // Valor vazio em vez de [object Object]
                   }
                }

                return (
                  <td key={`${row.key}-${col.key}`} className="px-4 py-3 text-sm text-white/80 whitespace-nowrap">
                    {cellValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
