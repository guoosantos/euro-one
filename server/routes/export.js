// server/routes/export.js
import express from "express";

import { authenticate } from "../middleware/auth.js";
import {
  ensureReportDateRange,
  enforceClientGroupInQuery,
  enforceDeviceFilterInQuery,
  normalizeReportDeviceIds,
  buildSearchParams,
} from "../utils/report-helpers.js";
import { traccarRequest } from "../services/traccar.js";

const router = express.Router();

// exige usuário autenticado em todas as rotas de export
router.use(authenticate);

function pickAccept(format = "") {
  const f = String(format).toLowerCase();
  if (f === "csv") return "text/csv";
  if (f === "gpx") return "application/gpx+xml";
  if (f === "xls") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (f === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/json";
}

/**
 * Exportação de posições
 * GET /api/positions/export
 * Query params:
 *  - deviceId / deviceIds
 *  - from / to
 *  - format=csv|xlsx|gpx|json (default json)
 */
router.get("/positions/export", async (req, res, next) => {
  try {
    let params = { ...(req.query || {}) };

    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    params = ensureReportDateRange(params);

    const search = buildSearchParams(params);
    const url = `/positions?${search.toString()}`;

    const accept = pickAccept(String(params.format || "csv"));
    const wantsBinary = accept !== "application/json";

    const response = await traccarRequest(
      {
        method: "get",
        url,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      res.json(response.data);
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Exportação de relatórios
 * GET /api/reports/:type/export
 *  - :type = route|summary|stops|trips|events (ou outros suportados)
 * Query params:
 *  - deviceId / deviceIds / groupId / groupIds
 *  - from / to
 *  - format=csv|xlsx|gpx|json (default csv)
 */
router.get("/reports/:type/export", async (req, res, next) => {
  try {
    const { type } = req.params;

    let params = normalizeReportDeviceIds({ ...(req.query || {}) });
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    params = ensureReportDateRange(params);

    const search = buildSearchParams(params);
    const url = `/reports/${type}?${search.toString()}`;

    const accept = pickAccept(String(params.format || "csv"));
    const wantsBinary = accept !== "application/json";

    const response = await traccarRequest(
      {
        method: "get",
        url,
        responseType: wantsBinary ? "arraybuffer" : "json",
        headers: { Accept: accept },
      },
      null,
      { asAdmin: true },
    );

    if (wantsBinary) {
      res.setHeader("Content-Type", accept);
      res.send(Buffer.from(response.data));
    } else {
      res.json(response.data);
    }
  } catch (error) {
    next(error);
  }
});

export default router;
