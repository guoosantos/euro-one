import React from "react";

const DEFAULT_PAGE_SIZES = [20, 50, 100];

function PaginationButton({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-[88px] items-center justify-center rounded-md border px-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
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
    <div className={`sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap">Itens por página</span>
        <select
          value={isAll ? "all" : String(numericPageSize)}
          onChange={handlePageSizeChange}
          className="rounded-md border border-white/10 bg-[#0d1117] px-2 py-1 text-xs text-white"
          disabled={disabled}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option} className="bg-[#0d1117] text-white">
              {option === "all" ? "Todos" : option}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Página {resolvedCurrentPage} de {resolvedTotalPages}
        </span>
        <span className="text-white/50">•</span>
        <span>{resolvedTotalItems} itens</span>
        {showRange && (
          <>
            <span className="text-white/50">•</span>
            <span>
              {pageStart}–{pageEnd}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
  );
}
