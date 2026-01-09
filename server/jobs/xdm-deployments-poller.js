import { listDeploymentsByStatus, updateDeployment, appendDeploymentLog } from "../models/xdm-deployment.js";
import XdmClient from "../services/xdm/xdm-client.js";

const POLL_INTERVAL_MS = Number(process.env.XDM_DEPLOYMENT_POLL_INTERVAL_MS) || 10_000;
const TIMEOUT_MS = Number(process.env.XDM_DEPLOYMENT_TIMEOUT_MS) || 15 * 60_000;

function isFinalStatus(status) {
  return status === "DEPLOYED" || status === "FAILED" || status === "TIMEOUT";
}

function mapRolloutStatus(status) {
  if (!status) return null;
  const value = String(status).toLowerCase();
  if (value.includes("finished") || value.includes("completed") || value.includes("success")) {
    return "DEPLOYED";
  }
  if (value.includes("failed") || value.includes("canceled") || value.includes("terminated")) {
    return "FAILED";
  }
  return null;
}

async function fetchDeviceState({ rolloutId, deviceUid, correlationId }) {
  if (!rolloutId || !deviceUid) return null;
  const xdmClient = new XdmClient();
  try {
    const response = await xdmClient.request(
      "GET",
      "/api/external/v1/rollouts/devices",
      {
        filter: {
          id: rolloutId,
          uid: deviceUid,
        },
      },
      { correlationId },
    );
    const state = response?.results?.[0]?.state || null;
    return mapRolloutStatus(state);
  } catch (error) {
    console.warn("[xdm] falha ao consultar estado do rollout", {
      correlationId,
      rolloutId,
      message: error?.message || error,
    });
    return null;
  }
}

async function fetchRolloutStatus({ rolloutId, correlationId }) {
  if (!rolloutId) return null;
  const xdmClient = new XdmClient();
  const response = await xdmClient.request("GET", `/api/external/v1/rollouts/${rolloutId}`, null, { correlationId });
  return mapRolloutStatus(response?.status || response?.state || response?.metadata);
}

async function pollDeploymentStatus() {
  const deployments = listDeploymentsByStatus(["DEPLOYING"]);
  if (!deployments.length) return;

  for (const deployment of deployments) {
    if (isFinalStatus(deployment.status)) continue;

    const startedAt = new Date(deployment.startedAt || 0).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt > TIMEOUT_MS) {
      updateDeployment(deployment.id, {
        status: "TIMEOUT",
        finishedAt: new Date().toISOString(),
        errorMessage: "Timeout ao aguardar deploy",
      });
      appendDeploymentLog(deployment.id, { step: "POLL_STATUS", status: "timeout" });
      continue;
    }

    const correlationId = deployment.correlationId || deployment.id;
    const deviceUid = deployment.deviceImei;
    const rolloutId = deployment.xdmDeploymentId;

    let status = await fetchDeviceState({ rolloutId, deviceUid, correlationId });
    if (!status) {
      status = await fetchRolloutStatus({ rolloutId, correlationId });
    }

    if (!status) {
      appendDeploymentLog(deployment.id, { step: "POLL_STATUS", status: "pending" });
      continue;
    }

    updateDeployment(deployment.id, {
      status,
      finishedAt: new Date().toISOString(),
      errorMessage: status === "DEPLOYED" ? null : "Falha no deploy",
    });
    appendDeploymentLog(deployment.id, { step: "POLL_STATUS", status });
  }
}

export function startXdmDeploymentsPoller() {
  if (!process.env.XDM_BASE_URL) {
    console.warn("[xdm] XDM_BASE_URL não configurado; poller desativado");
    return () => {};
  }

  const interval = setInterval(() => {
    void pollDeploymentStatus();
  }, POLL_INTERVAL_MS);

  console.info("[xdm] poller de deploy iniciado", { intervalMs: POLL_INTERVAL_MS });

  return () => {
    clearInterval(interval);
  };
}

export default {
  startXdmDeploymentsPoller,
};
