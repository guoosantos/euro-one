import express from "express";

import { requireAuth } from "../middleware/auth.js";
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

router.use(requireAuth);

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
        .map((column) =>
          formatValue(
            position?.[column] ??
              position?.attributes?.[column] ??
              position?.device?.[column] ??
              (column === "deviceId" ? position?.device_id || position?.deviceId : undefined),
          ),
        )
        .join(","),
    );
    const csv = [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=positions.csv");
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

export default router;
