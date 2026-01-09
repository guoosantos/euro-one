import React from "react";

const LOGO_URL = "https://eurosolucoes.tech/wp-content/uploads/2024/10/logo-3-2048x595.png";

function formatHeaderDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export default function HeaderBar({
  vehicleName,
  plate,
  client,
  from,
  to,
  logoUrl = LOGO_URL,
  className = "",
}) {
  const line = [
    { label: "VEÍCULO", value: vehicleName },
    { label: "PLACA", value: plate },
    { label: "CLIENTE", value: client },
    { label: "PERÍODO", value: `${formatHeaderDate(from)} → ${formatHeaderDate(to)}` },
  ];

  return (
    <div
      className={`flex min-h-[44px] w-full items-center gap-3 rounded-2xl border border-primary/40 bg-primary px-4 py-2 text-white shadow-glass ${className}`}
    >
      <div className="flex h-7 w-16 items-center justify-center rounded-md bg-white/10 px-2">
        {logoUrl ? (
          <img src={logoUrl} alt="Euro One" className="h-5 w-auto object-contain" />
        ) : (
          <span className="text-[9px] font-bold tracking-[0.2em]">EURO</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90 sm:text-xs">
        {line.map((item, index) => (
          <React.Fragment key={item.label}>
            <span className="whitespace-nowrap">
              <span className="text-white/60">{item.label}:</span>{" "}
              <span className="text-white">{item.value || "—"}</span>
            </span>
            {index < line.length - 1 ? <span className="text-white/40">|</span> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
