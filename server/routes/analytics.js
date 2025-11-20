import express from "express";

import { authenticate } from "../middleware/auth.js";
import { ensureReportDateRange, enforceClientGroupInQuery, enforceDeviceFilterInQuery, normalizeReportDeviceIds, buildSearchParams, normaliseJsonList } from "../utils/report-helpers.js";
import { traccarRequest } from "../services/traccar.js";
import { aggregateHeatmapEvents, rankHeatmapZones } from "../utils/heatmap.js";

const router = express.Router();

router.use(authenticate);

router.get("/events/heatmap", async (req, res, next) => {
  try {
    let params = normalizeReportDeviceIds({ ...(req.query || {}) });
    if (!params.type && params.eventType) {
      params.type = params.eventType;
    }
    if (Array.isArray(params.eventTypes) && !params.type) {
      params.type = params.eventTypes.join(",");
    }
    enforceDeviceFilterInQuery(req, params);
    enforceClientGroupInQuery(req, params);
    params = ensureReportDateRange(params);

    const search = buildSearchParams(params);
    const url = `/reports/events?${search.toString()}`;
    const response = await traccarRequest(
      { method: "get", url, headers: { Accept: "application/json" } },
      null,
      { asAdmin: true },
    );
    const events = normaliseJsonList(response?.data, ["events", "data", "items"]);
    const points = aggregateHeatmapEvents(events);
    res.json({ points, topZones: rankHeatmapZones(points, 10), total: events.length });
  } catch (error) {
    next(error);
  }
});

export default router;
