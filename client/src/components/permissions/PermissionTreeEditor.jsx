import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { PERMISSION_REGISTRY } from "../../lib/permissions/registry";
import {
  buildPermissionEditorState,
  normalizePermissionLevel,
} from "../../lib/permissions/permission-utils";

const ACCESS_OPTIONS = [
  { value: "read", label: "Somente visualizar" },
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

  const getEntry = (menuKey, pageKey, subKey) => {
    const menu = normalizedPermissions?.[menuKey] || {};
    const page = menu?.[pageKey];
    if (subKey) {
      if (page && typeof page === "object") {
        const subEntry = page.subpages?.[subKey];
        if (subEntry && typeof subEntry === "object") {
          return subEntry;
        }
      }
      return { visible: false, access: null };
    }
    if (page && typeof page === "object") {
      return page;
    }
    const legacyLevel = normalizePermissionLevel(page);
    if (legacyLevel === "full") return { visible: true, access: "full" };
    if (legacyLevel === "read" || legacyLevel === "view") return { visible: true, access: "read" };
    return { visible: false, access: null };
  };

  const updatePermissions = (updater) => {
    const next = buildPermissionEditorState(normalizedPermissions, registry);
    updater(next);
    onChange?.(next);
  };

  const setPageVisibility = (menuKey, pageKey, visible, pageConfig) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
      const nextAccess = visible ? page.access || "read" : null;
      const updated = { ...page, visible, access: nextAccess };
      if (!visible && pageConfig.subpages?.length) {
        const subpages = { ...updated.subpages };
        pageConfig.subpages.forEach((subpage) => {
          subpages[subpage.subKey] = { visible: false, access: null };
        });
        updated.subpages = subpages;
      }
      menu[pageKey] = updated;
      next[menuKey] = menu;
    });
  };

  const setPageAccess = (menuKey, pageKey, access, pageConfig) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
      const updated = { ...page, visible: true, access };
      if (pageConfig.subpages?.length) {
        const subpages = { ...updated.subpages };
        pageConfig.subpages.forEach((subpage) => {
          const current = subpages[subpage.subKey] || { visible: false, access: null };
          subpages[subpage.subKey] = { ...current };
        });
        updated.subpages = subpages;
      }
      menu[pageKey] = updated;
      next[menuKey] = menu;
    });
  };

  const setSubpageVisibility = (menuKey, pageKey, subKey, visible) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
      const subpages = { ...(page.subpages || {}) };
      const current = subpages[subKey] || {};
      subpages[subKey] = { ...current, visible, access: visible ? current.access || "read" : null };
      menu[pageKey] = {
        ...page,
        visible: page.visible ?? true,
        access: page.access || "read",
        subpages,
      };
      next[menuKey] = menu;
    });
  };

  const setSubpageAccess = (menuKey, pageKey, subKey, access) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
      const subpages = { ...(page.subpages || {}) };
      subpages[subKey] = { visible: true, access };
      menu[pageKey] = {
        ...page,
        visible: page.visible ?? true,
        access: page.access || "read",
        subpages,
      };
      next[menuKey] = menu;
    });
  };

  const applyMenuLevel = (menuKey, access, pages) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      pages.forEach((page) => {
        if (page.subpages?.length) {
          const subpages = {};
          page.subpages.forEach((subpage) => {
            subpages[subpage.subKey] = { visible: true, access };
          });
          menu[page.pageKey] = { visible: true, access, subpages };
        } else {
          menu[page.pageKey] = { visible: true, access };
        }
      });
      next[menuKey] = menu;
    });
  };

  const applyPageToChildren = (menuKey, pageKey, access, visible, subpages) => {
    updatePermissions((next) => {
      const menu = next[menuKey] || {};
      const page = typeof menu[pageKey] === "object" && menu[pageKey] !== null ? menu[pageKey] : {};
      const nextSubpages = { ...(page.subpages || {}) };
      subpages.forEach((subpage) => {
        nextSubpages[subpage.subKey] = visible
          ? { visible: true, access }
          : { visible: false, access: null };
      });
      menu[pageKey] = { ...page, visible, access: visible ? access : page.access, subpages: nextSubpages };
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
          const bulkLevel = bulkLevels[menu.menuKey] || "read";
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
                    {ACCESS_OPTIONS.map((option) => (
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
                    const pageEntry = getEntry(menu.menuKey, page.pageKey);
                    const isPageVisible = Boolean(pageEntry.visible);
                    const pageAccess = pageEntry.access || "read";
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
                                  setPageVisibility(menu.menuKey, page.pageKey, !isPageVisible, page)
                                }
                              />
                              Mostrar
                            </label>
                            {isPageVisible && (
                              <select
                                value={pageAccess}
                                onChange={(event) =>
                                  setPageAccess(menu.menuKey, page.pageKey, event.target.value, page)
                                }
                                className="min-w-[200px] rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                              >
                                {ACCESS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            {page.subpages?.length ? (
                              <button
                                type="button"
                                onClick={() =>
                                  applyPageToChildren(
                                    menu.menuKey,
                                    page.pageKey,
                                    pageAccess,
                                    isPageVisible,
                                    page.subpages,
                                  )
                                }
                                className="rounded-lg border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.08em] text-white/60 transition hover:border-white/30"
                              >
                                Aplicar aos filhos
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {page.subpages?.length ? (
                          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                            <p className="text-[10px] uppercase tracking-[0.08em] text-white/40">
                              {isPageVisible
                                ? `Aplicará ${pageAccess === "full" ? "Acesso completo" : "Somente visualizar"} aos filhos`
                                : "Aplicará Sem acesso aos filhos"}
                            </p>
                            {page.subpages.map((subpage) => {
                              const subEntry = getEntry(menu.menuKey, page.pageKey, subpage.subKey);
                              const isSubVisible = Boolean(subEntry.visible);
                              const subAccess = subEntry.access || "read";
                              return (
                                <div key={subpage.subKey} className="flex flex-wrap items-center justify-between gap-3">
                                  <span className="text-xs text-white/70">{subpage.label}</span>
                                  <div className="flex flex-wrap items-center gap-3 text-xs">
                                    <label className="flex items-center gap-2 text-white/70">
                                      <input
                                        type="checkbox"
                                        checked={isSubVisible}
                                        onChange={() =>
                                          setSubpageVisibility(
                                            menu.menuKey,
                                            page.pageKey,
                                            subpage.subKey,
                                            !isSubVisible,
                                          )
                                        }
                                        disabled={!isPageVisible}
                                      />
                                      Mostrar
                                    </label>
                                    {isSubVisible && (
                                      <select
                                        value={subAccess}
                                        onChange={(event) =>
                                          setSubpageAccess(
                                            menu.menuKey,
                                            page.pageKey,
                                            subpage.subKey,
                                            event.target.value,
                                          )
                                        }
                                        className="min-w-[180px] rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                                        disabled={!isPageVisible}
                                      >
                                        {ACCESS_OPTIONS.map((option) => (
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
