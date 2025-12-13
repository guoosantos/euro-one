import express from "express";
import createError from "http-errors";

import { createTtlCache } from "../utils/ttl-cache.js";
import { formatAddress, resolveShortAddress } from "../utils/address.js";

const router = express.Router();

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const cache = createTtlCache(10 * 60 * 1000);
const pending = new Map();

function sanitizeTerm(term) {
  if (typeof term !== "string") return "";
  return term.replace(/\s+/g, " ").trim();
}

function normalizeResult(item, fallbackLabel) {
  const lat = Number(item?.lat);
  const lng = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = item?.address || {};
  const conciseAddress = [
    address.road,
    address.neighbourhood,
    address.city || address.town || address.village,
    address.state,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: String(item?.place_id ?? `${lat},${lng}`),
    lat,
    lng,
    label: item?.display_name || fallbackLabel,
    concise: conciseAddress || formatAddress(item?.display_name || fallbackLabel),
    boundingBox: item?.boundingbox,
    raw: item,
  };
}

async function queryProvider(term, limit = 5) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "0");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Euro-One Monitoring Server",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const err = createError(response.status, "Falha ao buscar endereços");
    throw err;
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

router.get("/geocode/search", async (req, res) => {
  const query = sanitizeTerm(req.query.q ?? req.query.query ?? "");
  if (!query || query.length < 3) {
    return res.json({ data: [] });
  }

  const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 10));
  const cacheKey = `${query.toLowerCase()}|${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  if (pending.has(cacheKey)) {
    const shared = await pending.get(cacheKey).catch(() => []);
    return res.json({ data: shared });
  }

  const promise = (async () => {
    const rawResults = await queryProvider(query, limit);
    const normalized = rawResults
      .map((item) => normalizeResult(item, query))
      .filter(Boolean)
      .slice(0, limit);
    cache.set(cacheKey, normalized);
    return normalized;
  })();

  pending.set(cacheKey, promise);

  try {
    const results = await promise;
    return res.json({ data: results });
  } catch (error) {
    const message =
      error?.status === 429
        ? "Limite de consultas atingido. Tente novamente em instantes."
        : "Não foi possível buscar endereços agora. Tente novamente em instantes.";
    return res.status(error?.status || 502).json({ data: [], error: { message } });
  } finally {
    pending.delete(cacheKey);
  }
});

router.get("/geocode/reverse", async (req, res) => {
  const lat = Number(req.query.lat ?? req.query.latitude);
  const lng = Number(req.query.lng ?? req.query.lon ?? req.query.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: { message: "Coordenadas inválidas." } });
  }

  try {
    const resolved = await resolveShortAddress(lat, lng);
    if (!resolved) {
      return res.json({ lat, lng, address: null, formattedAddress: null, shortAddress: null });
    }

    return res.json({
      lat,
      lng,
      address: resolved.address || resolved.formattedAddress || resolved.shortAddress,
      formattedAddress: resolved.formattedAddress || resolved.address || resolved.shortAddress,
      shortAddress: resolved.shortAddress || resolved.formattedAddress || resolved.address,
    });
  } catch (_error) {
    return res.status(502).json({ error: { message: "Não foi possível obter o endereço agora." } });
  }
});

export default router;
