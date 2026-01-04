#!/usr/bin/env node
import { formatFullAddress, ensurePositionAddress } from "../utils/address.js";
import { queryTraccarDb, updatePositionFullAddress } from "../services/traccar-db.js";

const DEFAULT_BATCH = 500;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RATE = 1; // requests por segundo

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((item) => {
      const [key, value] = item.replace(/^--/, "").split("=");
      return [key, value ?? true];
    }),
  );

  return {
    from: args.from ? new Date(args.from).toISOString() : null,
    to: args.to ? new Date(args.to).toISOString() : null,
    batch: Number(args.batch || DEFAULT_BATCH),
    concurrency: Number(args.concurrency || DEFAULT_CONCURRENCY),
    rate: Number(args.rate || DEFAULT_RATE),
    dryRun: args["dry-run"] === "true" || args["dry-run"] === true,
  };
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

function buildWhereClause({ from, to }) {
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
  return { where: clauses.join(" AND "), params };
}

async function fetchBatch(where, params, limit, offset) {
  const sql = `
    SELECT id, deviceid, fixtime, latitude, longitude, address, full_address, attributes
    FROM tc_positions
    WHERE ${where}
    ORDER BY fixtime ASC
    LIMIT ${Number(limit)}
    OFFSET ${Number(offset)}
  `;
  const rows = await queryTraccarDb(sql, params);
  return rows || [];
}

async function main() {
  const { from, to, batch, concurrency, rate, dryRun } = parseArgs();
  const minIntervalMs = rate > 0 ? Math.max(0, 1000 / rate) : 0;
  const limit = createLimiter(Math.max(1, concurrency), minIntervalMs);
  const { where, params } = buildWhereClause({ from, to });

  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  /* eslint-disable no-constant-condition */
  while (true) {
    const batchRows = await fetchBatch(where, params, batch, offset);
    if (!batchRows.length) break;

    const tasks = batchRows.map((row) =>
      limit(async () => {
        try {
          const enriched = await ensurePositionAddress({
            id: row.id,
            latitude: row.latitude,
            longitude: row.longitude,
            address: row.address,
            fullAddress: row.full_address,
            attributes: row.attributes,
          });
          const formatted = formatFullAddress(enriched.fullAddress || enriched.formattedAddress || enriched.address);
          if (!formatted || formatted === "—") return;
          if (!dryRun) {
            await updatePositionFullAddress(row.id, formatted);
          }
          totalUpdated += 1;
        } catch (error) {
          totalErrors += 1;
          console.warn("[backfill-position-addresses] falha ao processar", row.id, error?.message || error);
        } finally {
          totalProcessed += 1;
        }
      }),
    );

    await Promise.all(tasks);
    offset += batchRows.length;
    console.info(
      `[backfill] offset=${offset} processed=${totalProcessed} updated=${totalUpdated} errors=${totalErrors} dryRun=${dryRun}`,
    );
    if (batchRows.length < batch) break;
  }

  console.info("[backfill] concluído", { totalProcessed, totalUpdated, totalErrors, dryRun });
  process.exit(0);
}

main().catch((error) => {
  console.error("[backfill] erro fatal", error?.message || error);
  process.exit(1);
});
