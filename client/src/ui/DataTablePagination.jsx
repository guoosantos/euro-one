import React from "react";

const DEFAULT_PAGE_SIZES = [20, 50, 100];

function PaginationButton({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 min-w-[88px] items-center justify-center rounded border px-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${
        disabled
          ? "cursor-not-allowed border-white/5 bg-white/5 text-white/30"
          : "border-white/15 bg-white/10 text-white hover:border-primary/60 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export default function DataTablePagination({
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageSizeChange,
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
  disabled = false,
  className = "",
  showRange = true,
}) {
  const resolvedTotalPages = Math.max(1, Number(totalPages) || 1);
  const resolvedCurrentPage = Math.min(Math.max(1, Number(currentPage) || 1), resolvedTotalPages);
  const resolvedTotalItems = Number.isFinite(Number(totalItems)) ? Number(totalItems) : 0;
  const isAll = pageSize === "all";
  const numericPageSize = isAll ? resolvedTotalItems || 1 : Number(pageSize) || DEFAULT_PAGE_SIZES[0];
  const isFirstPage = resolvedCurrentPage <= 1;
  const isLastPage = resolvedCurrentPage >= resolvedTotalPages;

  const pageStart = resolvedTotalItems === 0 ? 0 : isAll ? 1 : (resolvedCurrentPage - 1) * numericPageSize + 1;
  const pageEnd = isAll ? resolvedTotalItems : Math.min(resolvedTotalItems, resolvedCurrentPage * numericPageSize);

  const handlePageSizeChange = (event) => {
    const { value } = event.target;
    onPageSizeChange?.(value === "all" ? "all" : Number(value));
  };

  const handlePageChange = (target) => {
    if (disabled) return;
    const next = Math.max(1, Math.min(resolvedTotalPages, target));
    if (next === resolvedCurrentPage) return;
    onPageChange?.(next);
  };

  return (
    <div className={`shrink-0 border-t border-white/10 bg-[#0f141c] px-2 py-1 text-[10px] leading-tight text-white/70 ${className}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-white/70">
          <label className="text-[9px] uppercase tracking-[0.1em] text-white/50">
            Itens por página
          </label>
          <select
            value={isAll ? "all" : String(numericPageSize)}
            onChange={handlePageSizeChange}
            className="h-7 min-w-[72px] rounded border border-white/10 bg-[#0b0f17] px-1.5 py-1 text-[10px] font-semibold text-white shadow-inner focus:border-primary focus:outline-none"
            disabled={disabled}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "Todos" : option}
              </option>
            ))}
          </select>

          <span className="text-[9px] uppercase tracking-[0.1em] text-white/50">
            Página {resolvedCurrentPage} de {resolvedTotalPages}
          </span>
          {showRange && (
            <span className="text-[9px] uppercase tracking-[0.1em] text-white/50">
              Mostrando {pageStart}–{pageEnd} de {resolvedTotalItems}
            </span>
          )}
          {!showRange && (
            <span className="text-[9px] uppercase tracking-[0.1em] text-white/50">
              Total de {resolvedTotalItems} itens
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <PaginationButton disabled={disabled || isFirstPage} onClick={() => handlePageChange(1)}>
            Primeira
          </PaginationButton>
          <PaginationButton disabled={disabled || isFirstPage} onClick={() => handlePageChange(resolvedCurrentPage - 1)}>
            Anterior
          </PaginationButton>
          <PaginationButton disabled={disabled || isLastPage} onClick={() => handlePageChange(resolvedCurrentPage + 1)}>
            Próxima
          </PaginationButton>
          <PaginationButton disabled={disabled || isLastPage} onClick={() => handlePageChange(resolvedTotalPages)}>
            Última
          </PaginationButton>
        </div>
      </div>
    </div>
  );
}
