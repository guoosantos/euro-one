import express from "express";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticate);

router.get("/finance", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({ status: "OK", billableVehicles: 42, amountDue: 12990.75, nextBilling: "2024-12-15" });
});

router.get("/driver-behavior", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({
    drivers: [
      { id: "DRV-1", name: "Ana Lima", score: 92, harshEvents: 1 },
      { id: "DRV-2", name: "Carlos Silva", score: 84, harshEvents: 3 },
    ],
  });
});

router.get("/maintenance", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({
    scheduled: [
      { id: "MT-1", vehicle: "Caminhão 12", date: "2024-12-10", type: "Preventiva" },
      { id: "MT-2", vehicle: "Van 8", date: "2024-12-18", type: "Troca de óleo" },
    ],
  });
});

router.get("/reports/fuel", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({
    summary: { totalLiters: 5200, anomalies: 2 },
    records: [
      { id: 1, vehicle: "Van 8", liters: 60, when: "2024-11-30" },
      { id: 2, vehicle: "Caminhão 12", liters: 120, when: "2024-11-29" },
    ],
  });
});

router.get("/routing", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({ message: "Roteirização mockada", jobs: [] });
});

router.get("/compliance", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({ trainings: 4, hoursRemaining: 32 });
});

router.get("/iot-sensors", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({
    sensors: [
      { id: "temp-1", type: "Temperatura", value: 4.2, unit: "°C" },
      { id: "tire-3", type: "Pneu", value: 31, unit: "psi" },
    ],
  });
});

router.get("/video-telematics", requireRole("user", "manager", "admin"), (_req, res) => {
  res.json({ status: "pending", providers: ["ICase", "EagleEye"], notes: "Mock" });
});

export default router;
