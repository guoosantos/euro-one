import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { PERMISSION_REGISTRY } from "../../lib/permissions/registry";
import {
  buildPermissionEditorState,
  normalizePermissionLevel,
} from "../../lib/permissions/permission-utils";

const LEVEL_OPTIONS = [
  { value: "view", label: "Somente visualizar" },
  { value: "full", label: "Acesso completo" },
];

function matchesQuery(text, query) {
  return String(text || "").toLowerCase().includes(query);
}

export default function PermissionTreeEditor({
  permissions = {},
  onChange,
  registry = PERMISSION_REGISTRY,
}) {
  const [search, setSearch] = useState("");
  const [openMenus, setOpenMenus] = useState({});
  const [bulkLevels, setBulkLevels] = useState({});

  const normalizedPermissions = useMemo(
    () => buildPermissionEditorState(permissions, registry),
    [permissions, registry],
  );

  const filteredRegistry = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return registry;
    return registry
      .map((menu) => {
        const menuMatches = matchesQuery(menu.label, query);
        const pages = menu.pages
          .map((page) => {
            const pageMatches = matchesQuery(page.label, query);
            const subpages = page.subpages?.filter((sub) => matchesQuery(sub.label, query)) || [];
            if (menuMatches || pageMatches || subpages.length) {
              return {
                ...page,
                subpages: page.subpages ? subpages : undefined,
              };
            }
            return null;
          })
          .filter(Boolean);
        if (menuMatches || pages.length) {
          return { ...menu, pages };
        }
        return null;
      })
      .filter(Boolean);
  }, [registry, search]);

  const getLevel = (menuKey, pageKey, subKey) => {
    const menu = normalizedPermissions?.[menuKey] || {};
    const page = menu?.[pageKey];
    if (subKey) {
      if (typeof page === "object" && page !== null) {
        return normalizePermissionLevel(page.subpages?.[subKey]);
      }
      return "none";
    }
    if (typeof page === "string") return normalizePermissionLevel(page);
    if (page && typeof page === "object") {
      return normalizePermissionLevel(page.level);
    }
    return "none";
  };

  const updatePermissions = (updater) => {
    const next = buildPermissionEditorState(normalizedPermissions, registry);
    updater(next);
    onChange?.(next);
  };

  const setPageLevel = (menuKey, pageKey, level, pageConfig) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      if (pageConfig.subpages?.length) {
        const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
        const updated = { ...page, level };
        if (level === "none") {
          const subpages = { ...updated.subpages };
          pageConfig.subpages.forEach((subpage) => {
            subpages[subpage.subKey] = "none";
          });
          updated.subpages = subpages;
        }
        menu[pageKey] = updated;
      } else {
        menu[pageKey] = level;
      }
      next[menuKey] = menu;
    });
  };

  const setSubpageLevel = (menuKey, pageKey, subKey, level) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
      const subpages = { ...(page.subpages || {}) };
      subpages[subKey] = level;
      menu[pageKey] = {
        level: normalizePermissionLevel(page.level || "view"),
        subpages,
      };
      next[menuKey] = menu;
    });
  };

  const applyMenuLevel = (menuKey, level, pages) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      pages.forEach((page) => {
        if (page.subpages?.length) {
          const subpages = {};
          page.subpages.forEach((subpage) => {
            subpages[subpage.subKey] = level;
          });
          menu[page.pageKey] = { level, subpages };
        } else {
          menu[page.pageKey] = level;
        }
      });
      next[menuKey] = menu;
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="block text-xs uppercase tracking-wide text-white/60">Buscar permissão</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por menu ou submenu"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        {filteredRegistry.map((menu) => {
          const isOpen = openMenus[menu.menuKey] !== false;
          const bulkLevel = bulkLevels[menu.menuKey] || "view";
          return (
            <div key={menu.menuKey} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenus((prev) => ({
                      ...prev,
                      [menu.menuKey]: prev[menu.menuKey] === false,
                    }))
                  }
                  className="flex items-center gap-2 text-left text-sm font-semibold text-white"
                >
                  <span className="text-white/70">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  {menu.label}
                </button>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={bulkLevel}
                    onChange={(event) =>
                      setBulkLevels((prev) => ({ ...prev, [menu.menuKey]: event.target.value }))
                    }
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                  >
                    {LEVEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => applyMenuLevel(menu.menuKey, bulkLevel, menu.pages)}
                    className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 transition hover:border-white/30"
                  >
                    Aplicar para todos
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-4 space-y-3">
                  {menu.pages.map((page) => {
                    const pageLevel = getLevel(menu.menuKey, page.pageKey);
                    const isPageVisible = pageLevel !== "none";
                    return (
                      <div key={page.pageKey} className="rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-white/60">{page.label}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <label className="flex items-center gap-2 text-white/70">
                              <input
                                type="checkbox"
                                checked={isPageVisible}
                                onChange={() =>
                                  setPageLevel(
                                    menu.menuKey,
                                    page.pageKey,
                                    isPageVisible ? "none" : "view",
                                    page,
                                  )
                                }
                              />
                              Mostrar
                            </label>
                            {isPageVisible && (
                              <select
                                value={pageLevel}
                                onChange={(event) =>
                                  setPageLevel(menu.menuKey, page.pageKey, event.target.value, page)
                                }
                                className="min-w-[200px] rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                              >
                                {LEVEL_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>

                        {page.subpages?.length ? (
                          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                            {page.subpages.map((subpage) => {
                              const subLevel = getLevel(menu.menuKey, page.pageKey, subpage.subKey);
                              const isSubVisible = subLevel !== "none";
                              return (
                                <div key={subpage.subKey} className="flex flex-wrap items-center justify-between gap-3">
                                  <span className="text-xs text-white/70">{subpage.label}</span>
                                  <div className="flex flex-wrap items-center gap-3 text-xs">
                                    <label className="flex items-center gap-2 text-white/70">
                                      <input
                                        type="checkbox"
                                        checked={isSubVisible}
                                        onChange={() =>
                                          setSubpageLevel(
                                            menu.menuKey,
                                            page.pageKey,
                                            subpage.subKey,
                                            isSubVisible ? "none" : "view",
                                          )
                                        }
                                        disabled={!isPageVisible}
                                      />
                                      Mostrar
                                    </label>
                                    {isSubVisible && (
                                      <select
                                        value={subLevel}
                                        onChange={(event) =>
                                          setSubpageLevel(
                                            menu.menuKey,
                                            page.pageKey,
                                            subpage.subKey,
                                            event.target.value,
                                          )
                                        }
                                        className="min-w-[180px] rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                                        disabled={!isPageVisible}
                                      >
                                        {LEVEL_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
