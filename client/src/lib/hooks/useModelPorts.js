import { useEffect, useState } from "react";

import { CoreApi } from "../coreApi.js";

let cachedPortsIndex = null;
let cachedPortsPromise = null;

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildPortsIndex(models = []) {
  const index = new Map();
  models.forEach((model) => {
    const ports = Array.isArray(model?.ports) ? model.ports : [];
    if (!ports.length) return;
    const protocolKey = normalizeKey(model?.protocol);
    const nameKey = normalizeKey(model?.name);
    if (protocolKey && !index.has(protocolKey)) {
      index.set(protocolKey, ports);
    }
    if (nameKey && !index.has(nameKey)) {
      index.set(nameKey, ports);
    }
  });
  return index;
}

async function loadPortsIndex() {
  if (cachedPortsIndex) return cachedPortsIndex;
  if (!cachedPortsPromise) {
    cachedPortsPromise = CoreApi.models()
      .then((models) => buildPortsIndex(Array.isArray(models) ? models : []))
      .catch(() => new Map());
  }
  cachedPortsIndex = await cachedPortsPromise;
  return cachedPortsIndex;
}

export function useModelPorts() {
  const [portsIndex, setPortsIndex] = useState(cachedPortsIndex);
  const [loading, setLoading] = useState(!cachedPortsIndex);

  useEffect(() => {
    let mounted = true;
    if (cachedPortsIndex) {
      setPortsIndex(cachedPortsIndex);
      setLoading(false);
      return undefined;
    }
    loadPortsIndex()
      .then((index) => {
        if (!mounted) return;
        setPortsIndex(index);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setPortsIndex(new Map());
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return { portsIndex, loading };
}

export function resolvePortLabel(portsIndex, { protocol, model, index, fallback }) {
  const protocolKey = normalizeKey(protocol);
  const modelKey = normalizeKey(model);
  const ports = portsIndex?.get?.(protocolKey) || portsIndex?.get?.(modelKey) || [];
  const label = ports?.[index - 1]?.label;
  return label || fallback;
}
