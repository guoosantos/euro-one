import { listDeploymentsByStatus, updateDeployment, appendDeploymentLog } from "../models/xdm-deployment.js";
import { resolveDeviceConfirmationStatus } from "../services/xdm/deployment-confirmation.js";
import XdmClient from "../services/xdm/xdm-client.js";

const POLL_INTERVAL_MS = Number(process.env.XDM_DEPLOYMENT_POLL_INTERVAL_MS) || 10_000;
const TIMEOUT_MS = Number(process.env.XDM_DEPLOYMENT_TIMEOUT_MS) || 15 * 60_000;
const CONFIRM_TIMEOUT_MS = Number(process.env.XDM_DEPLOYMENT_CONFIRM_TIMEOUT_MS) || 6 * 60 * 60_000;
const ACTIVE_DEPLOYMENT_STATUSES = ["QUEUED", "SYNCING", "DEPLOYING", "STARTED", "RUNNING"];
const AWAITING_CONFIRMATION_STATUSES = ["DEPLOYED", "CLEARED"];
const TERMINAL_STATUSES = new Set(["FAILED", "TIMEOUT", "CONFIRMED"]);

function isAwaitingConfirmationStatus(status) {
  return AWAITING_CONFIRMATION_STATUSES.includes(String(status || "").toUpperCase());
}

function mapRolloutStatus(status) {
  if (!status) return null;
  const value = String(status).toLowerCase();
  if (
    value.includes("finished") ||
    value.includes("completed") ||
    value.includes("success") ||
    value.includes("applied") ||
    value.includes("confirmed") ||
    value.includes("deployed") ||
    value.includes("cleared")
  ) {
    return "DEPLOYED";
  }
  if (
    value.includes("failed") ||
    value.includes("error") ||
    value.includes("invalid") ||
    value.includes("rejected") ||
    value.includes("timeout") ||
    value.includes("canceled") ||
    value.includes("cancelled") ||
    value.includes("terminated")
  ) {
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

async function fetchDeviceConfirmation({ deviceUid, correlationId, startedAt }) {
  if (!deviceUid) return null;
  const normalizedUid = String(deviceUid).trim();
  const xdmClient = new XdmClient();
  let details = null;
  try {
    details = await xdmClient.request(
      "GET",
      `/api/external/v3/devicesSdk/${normalizedUid}/details`,
      null,
      { correlationId },
    );
  } catch (error) {
    try {
      details = await xdmClient.request(
        "GET",
        `/api/external/v1/devicesSdk/${normalizedUid}/details`,
        null,
        { correlationId },
      );
    } catch (fallbackError) {
      console.warn("[xdm] falha ao consultar confirmação no devicesSdk", {
        correlationId,
        deviceUid: normalizedUid,
        message: fallbackError?.message || fallbackError,
      });
      return null;
    }
  }
  return resolveDeviceConfirmationStatus({ details, startedAt });
}

async function pollDeploymentStatus() {
  const activeDeployments = listDeploymentsByStatus(ACTIVE_DEPLOYMENT_STATUSES);
  const awaitingConfirmations = listDeploymentsByStatus(AWAITING_CONFIRMATION_STATUSES).filter(
    (deployment) => !deployment?.confirmedAt && !deployment?.deviceConfirmedAt,
  );
  const deployments = [...activeDeployments, ...awaitingConfirmations];
  if (!deployments.length) return;

  for (const deployment of deployments) {
    const deploymentStatus = String(deployment.status || "").toUpperCase();
    if (TERMINAL_STATUSES.has(deploymentStatus)) continue;

    const startedAtMs = new Date(deployment.startedAt || 0).getTime();
    const nowIso = new Date().toISOString();
    const providerCheckAttempts = Number(deployment.providerCheckAttempts || 0) + 1;
    const baseCheckFields = {
      lastProviderCheckAt: nowIso,
      providerCheckAttempts,
    };

    const maxWaitMs = isAwaitingConfirmationStatus(deploymentStatus) ? CONFIRM_TIMEOUT_MS : TIMEOUT_MS;
    if (Number.isFinite(startedAtMs) && Date.now() - startedAtMs > maxWaitMs) {
      updateDeployment(deployment.id, {
        ...baseCheckFields,
        status: "TIMEOUT",
        finishedAt: nowIso,
        errorMessage: isAwaitingConfirmationStatus(deploymentStatus)
          ? "Timeout ao aguardar confirmação do equipamento"
          : "Timeout ao aguardar deploy",
      });
      appendDeploymentLog(deployment.id, { step: "POLL_STATUS", status: "timeout" });
      continue;
    }

    const correlationId = deployment.correlationId || deployment.id;
    const deviceUid = deployment.deviceImei;
    const rolloutId = deployment.xdmDeploymentId;
    let currentStatus = deploymentStatus;

    if (ACTIVE_DEPLOYMENT_STATUSES.includes(deploymentStatus)) {
      let rolloutStatus = await fetchDeviceState({ rolloutId, deviceUid, correlationId });
      if (!rolloutStatus) {
        rolloutStatus = await fetchRolloutStatus({ rolloutId, correlationId });
      }

      if (!rolloutStatus) {
        updateDeployment(deployment.id, baseCheckFields);
        appendDeploymentLog(deployment.id, { step: "POLL_STATUS", status: "pending" });
      } else {
        const normalizedStatus =
          deployment?.action === "DISEMBARK" && rolloutStatus === "DEPLOYED" ? "CLEARED" : rolloutStatus;
        const rolloutUpdates = {
          ...baseCheckFields,
          status: normalizedStatus,
          finishedAt: normalizedStatus === "FAILED" ? nowIso : deployment.finishedAt || null,
          errorMessage: normalizedStatus === "FAILED" ? "Falha no deploy" : null,
        };
        updateDeployment(deployment.id, rolloutUpdates);
        appendDeploymentLog(deployment.id, { step: "POLL_STATUS", status: normalizedStatus });
        currentStatus = normalizedStatus;
        if (normalizedStatus === "FAILED") {
          continue;
        }
      }
    } else {
      updateDeployment(deployment.id, baseCheckFields);
    }

    if (!isAwaitingConfirmationStatus(currentStatus)) {
      continue;
    }

    const confirmation = await fetchDeviceConfirmation({
      deviceUid,
      correlationId,
      startedAt: deployment.startedAt || null,
    });
    if (!confirmation) {
      appendDeploymentLog(deployment.id, {
        step: "POLL_CONFIRMATION",
        status: "pending",
        reason: "provider_unavailable",
      });
      continue;
    }

    const confirmationFields = {
      providerConfirmationState: confirmation.state || null,
      providerConfirmedAt:
        confirmation.confirmedAt ||
        (Number.isFinite(confirmation.updateMs) ? new Date(confirmation.updateMs).toISOString() : null),
    };

    if (confirmation.status === "failed") {
      updateDeployment(deployment.id, {
        ...confirmationFields,
        status: "FAILED",
        finishedAt: nowIso,
        errorMessage: "Falha na atualização do equipamento",
        errorDetails: confirmation.state || null,
      });
      appendDeploymentLog(deployment.id, {
        step: "POLL_CONFIRMATION",
        status: "failed",
        providerState: confirmation.state || null,
      });
      continue;
    }

    if (confirmation.status === "confirmed" && confirmation.confirmedAt) {
      updateDeployment(deployment.id, {
        ...confirmationFields,
        status: "CONFIRMED",
        confirmedAt: confirmation.confirmedAt,
        deviceConfirmedAt: confirmation.confirmedAt,
        finishedAt: confirmation.confirmedAt,
        errorMessage: null,
      });
      appendDeploymentLog(deployment.id, {
        step: "POLL_CONFIRMATION",
        status: "confirmed",
        providerState: confirmation.state || null,
        confirmedAt: confirmation.confirmedAt,
      });
      continue;
    }

    updateDeployment(deployment.id, confirmationFields);
    appendDeploymentLog(deployment.id, {
      step: "POLL_CONFIRMATION",
      status: "pending",
      providerState: confirmation.state || null,
    });
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
