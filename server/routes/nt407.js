import express from "express";
import createError from "http-errors";

import { authenticate } from "../middleware/auth.js";
import { authorizePermission } from "../middleware/permissions.js";
import {
  buildLivePlaylist,
  getLiveSegmentPath,
  getNt407Health,
  getNt407MediaById,
  listNt407Devices,
  listNt407Faces,
  listNt407Fatigue,
  listNt407Videos,
  startNt407Live,
  stopNt407Live,
} from "../services/nt407/nt407-server.js";

const router = express.Router();

router.use(authenticate);

router.get(
  "/nt407/health",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "live" }),
  (_req, res) => {
    res.json(getNt407Health());
  },
);

router.get(
  "/nt407/devices",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "live" }),
  async (_req, res, next) => {
    try {
      const devices = await listNt407Devices();
      res.json({ devices });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/nt407/videos",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "videos" }),
  async (req, res, next) => {
    try {
      const videos = await listNt407Videos({
        deviceId: req.query?.deviceId,
        from: req.query?.from,
        to: req.query?.to,
        type: req.query?.type,
        channel: req.query?.channel,
        limit: req.query?.limit,
      });
      res.json({ videos });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/nt407/faces",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "face" }),
  async (req, res, next) => {
    try {
      const faces = await listNt407Faces({
        deviceId: req.query?.deviceId,
        from: req.query?.from,
        to: req.query?.to,
        limit: req.query?.limit,
      });
      res.json({ faces });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/nt407/fatigue",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "fatigue" }),
  async (req, res, next) => {
    try {
      const fatigue = await listNt407Fatigue({
        deviceId: req.query?.deviceId,
        from: req.query?.from,
        to: req.query?.to,
        severity: req.query?.severity,
        limit: req.query?.limit,
      });
      res.json({ fatigue });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/nt407/live/start",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "live" }),
  (req, res, next) => {
    try {
      const deviceId = req.body?.deviceId || req.query?.deviceId;
      const channel = req.body?.channel ?? req.query?.channel ?? 1;
      if (!deviceId) {
        throw createError(400, "deviceId é obrigatório");
      }
      const live = startNt407Live({
        deviceId,
        channel,
        dataType: req.body?.dataType ?? 0,
        streamType: req.body?.streamType ?? 0,
        requestedBy: req.user?.id || null,
      });
      res.status(201).json({
        live,
        playbackUrl: live.playbackUrl,
        wsUrl: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/nt407/live/stop",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "live" }),
  (req, res, next) => {
    try {
      const live = stopNt407Live({
        liveId: req.body?.liveId || req.query?.liveId,
        deviceId: req.body?.deviceId || req.query?.deviceId,
        channel: req.body?.channel ?? req.query?.channel ?? 1,
      });
      res.json({ live });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/nt407/live/stream/:liveId.m3u8",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "live" }),
  (req, res, next) => {
    try {
      const playlist = buildLivePlaylist(req.params.liveId);
      if (!playlist) {
        throw createError(404, "Sessão live não encontrada");
      }
      res.type(playlist.contentType).send(playlist.body);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/nt407/live/segments/:liveId/:fileName",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "live" }),
  (req, res, next) => {
    try {
      const segmentPath = getLiveSegmentPath(req.params.liveId, req.params.fileName);
      if (!segmentPath) {
        throw createError(404, "Segmento live não encontrado");
      }
      res.sendFile(segmentPath);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/nt407/media/:id/download",
  authorizePermission({ menuKey: "telemetry", pageKey: "euro-view", subKey: "videos" }),
  async (req, res, next) => {
    try {
      const media = await getNt407MediaById(req.params.id);
      if (!media) {
        throw createError(404, "Mídia não encontrada");
      }
      if (!media.filePath) {
        throw createError(404, "Arquivo de mídia não disponível");
      }
      res.sendFile(media.filePath);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
