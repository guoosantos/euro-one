#!/usr/bin/env node
import { backfillPositionFullAddresses } from "../services/full-address-backfill.js";

const DEFAULT_BATCH = 500;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RATE = 1;
const DEFAULT_MAX = 1000;

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
    max: Number(args.max || DEFAULT_MAX),
    dryRun: args["dry-run"] === "true" || args["dry-run"] === true,
  };
}

async function main() {
  const options = parseArgs();
  const result = await backfillPositionFullAddresses({ ...options, logger: console });
  console.info("[backfill] concluído", result);
  process.exit(0);
}

main().catch((error) => {
  console.error("[backfill] erro fatal", error?.message || error);
  process.exit(1);
});
