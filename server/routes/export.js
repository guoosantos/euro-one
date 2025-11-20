import express from "express";

import { authenticate } from "../middleware/auth.js";
import {
  buildSearchParams,
  ensureReportDateRange,
  enforceClientGroupInQuery,
  enforceDeviceFilterInQuery,
  normalizeReportDeviceIds,
  normaliseJsonList,
} from "../utils/report-helpers.js";
import { traccarRequest } from "../services/traccar.js";

const router = express.Router();

router.use(authenticate);

function parseColumns(raw) {
  if (!raw) {
    return ["deviceId", "time", "latitude", "longitude", "speed", "address"];
  }
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatValue(value) {
  if (value === undefined || value === null) return "";
  const str = String(value).replace(/"/g, '""');
  if (str.includes(",") || str.includes("\n")) {
    return `"${str}"`;
  }
  return str;
}

router.get("/positions/export", async (req, res, next) => {
  try {
    let params = normalizeReportDeviceIds({ ...(req.query || {}) });
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    params = ensureReportDateRange(params);

    const search = buildSearchParams(params);
    const url = `/positions?${search.toString()}`;
    const response = await traccarRequest(
      { method: "get", url, headers: { Accept: "application/json" } },
      null,
      { asAdmin: true },
    );
    const positions = normaliseJsonList(response?.data, ["positions", "data", "items"]);
    const columns = parseColumns(req.query.columns);
    const header = columns.join(",");
    const rows = positions.map((position) =>
      columns
        .map((column) => {
          const fallbackDeviceId = position?.device_id || position?.deviceId || position?.device?.id;
          return formatValue(
            position?.[column] ??
              position?.attributes?.[column] ??
              position?.device?.[column] ??
              (column === "deviceId" ? fallbackDeviceId : ""),
          );
        })
        .join(","),
    );

    const csv = "\ufeff" + [header, ...rows].join("\n");

    const today = new Date();
    const filename = `positions-export-${today.toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

export default router;
