import { formatFullAddress, ensurePositionAddress } from "../utils/address.js";
import { queryTraccarDb, updatePositionFullAddress } from "./traccar-db.js";

const DEFAULT_BATCH = 500;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RATE = 1; // requests per second
const DEFAULT_MAX = 1000;
const DEFAULT_MAX_RETRIES = 1;

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildWhereClause({ from, to, lastId = null }) {
  const clauses = ["(full_address IS NULL OR full_address = '')"];
  const params = [];

  if (from) {
    clauses.push("fixtime >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("fixtime <= ?");
    params.push(to);
  }
  if (lastId != null) {
    clauses.push("id > ?");
    params.push(lastId);
  }

  return { where: clauses.join(" AND "), params };
}

async function fetchBatch({ from, to, limit, lastId }) {
  const { where, params } = buildWhereClause({ from, to, lastId });
  const sql = `
    SELECT id, deviceid, fixtime, latitude, longitude, address, full_address, attributes
    FROM tc_positions
    WHERE ${where}
    ORDER BY id ASC
    LIMIT ${Number(limit)}
  `;

  const rows = await queryTraccarDb(sql, params);
  return Array.isArray(rows) ? rows : [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLimiter(concurrency, minIntervalMs) {
  const queue = [];
  let active = 0;
  let lastStart = 0;

  async function run(task) {
    if (active >= concurrency) {
      await new Promise((resolve) => queue.push(resolve));
    }
    const now = Date.now();
    const elapsed = now - lastStart;
    if (elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed);
    }
    lastStart = Date.now();
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  }

  return (task) => run(task);
}

async function processRow(row, { dryRun, maxRetries }) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= maxRetries) {
    try {
      const enriched = await ensurePositionAddress({
        id: row.id,
        latitude: row.latitude,
        longitude: row.longitude,
        address: row.address,
        fullAddress: row.full_address,
        attributes: row.attributes,
      });
      const formatted = formatFullAddress(
        enriched.fullAddress || enriched.formattedAddress || enriched.address || row.full_address || row.address,
      );
      if (!formatted || formatted === "—") {
        return { updated: false };
      }
      if (!dryRun) {
        await updatePositionFullAddress(row.id, formatted);
      }
      return { updated: true, fullAddress: formatted };
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > maxRetries) {
        throw error;
      }
    }
  }

  if (lastError) throw lastError;
  return { updated: false };
}

export async function backfillPositionFullAddresses(options = {}) {
  const {
    from = null,
    to = null,
    batch = DEFAULT_BATCH,
    concurrency = DEFAULT_CONCURRENCY,
    rate = DEFAULT_RATE,
    max = DEFAULT_MAX,
    dryRun = false,
    maxRetries = DEFAULT_MAX_RETRIES,
    logger = console,
  } = options;

  const limitPerBatch = parsePositiveNumber(batch, DEFAULT_BATCH);
  const maxPerRun = parsePositiveNumber(max, DEFAULT_MAX);
  const concurrencyLimit = parsePositiveNumber(concurrency, DEFAULT_CONCURRENCY);
  const requestsPerSecond = parsePositiveNumber(rate, DEFAULT_RATE);
  const limiter = createLimiter(concurrencyLimit, Math.max(0, 1000 / requestsPerSecond));
  let processed = 0;
  let updated = 0;
  let errors = 0;
  let lastId = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (processed >= maxPerRun) break;
    const remaining = maxPerRun - processed;
    const rows = await fetchBatch({ from, to, limit: Math.min(limitPerBatch, remaining), lastId });
    if (!rows.length) break;

    const tasks = rows.map((row) =>
      limiter(async () => {
        try {
          const result = await processRow(row, { dryRun, maxRetries: parsePositiveNumber(maxRetries, DEFAULT_MAX_RETRIES) });
          if (result.updated) {
            updated += 1;
          }
        } catch (error) {
          errors += 1;
          logger.warn?.("[backfill] falha ao resolver full_address", row?.id, error?.message || error);
        } finally {
          processed += 1;
        }
      }),
    );

    await Promise.all(tasks);
    lastId = rows[rows.length - 1]?.id ?? lastId;
    logger.info?.("[backfill] progresso", {
      processed,
      updated,
      errors,
      lastId,
      dryRun,
    });
  }

  return {
    processed,
    updated,
    errors,
    remaining: Math.max(0, maxPerRun - processed),
    lastId,
    dryRun,
  };
}
