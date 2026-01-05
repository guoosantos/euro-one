import { createRequire } from "module";

const require = createRequire(import.meta.url);

let BullQueue = null;
let BullQueueScheduler = null;
let BullWorker = null;
let IORedis = null;

const shouldLogDriverWarnings = process.env.NODE_ENV !== "test";
let warnedMissingRedisUrl = false;
let warnedMemoryDriver = false;

try {
  ({ Queue: BullQueue, QueueScheduler: BullQueueScheduler, Worker: BullWorker } = require("bullmq"));
} catch (error) {
  if (shouldLogDriverWarnings) {
    console.warn("[geocode-queue] BullMQ indisponível, ativando modo em memória.", error?.message || error);
  }
}

try {
  // eslint-disable-next-line n/no-missing-require
  IORedis = require("ioredis");
} catch (error) {
  if (shouldLogDriverWarnings) {
    console.warn("[geocode-queue] ioredis indisponível, ativando modo em memória.", error?.message || error);
  }
}

const GEOCODE_QUEUE_NAME = "geocode";
const DEFAULT_PRECISION = 5;
const PRIORITY_MAP = {
  high: 1,
  normal: 5,
};

const state = {
  queue: null,
  scheduler: null,
  connection: null,
  worker: null,
  driver:
    BullQueue && BullQueueScheduler && IORedis && process.env.GEOCODE_QUEUE_DISABLED !== "true" && process.env.NODE_ENV !== "test"
      ? "bullmq"
      : "memory",
  memory: {
    jobs: new Map(),
    pending: [],
    processor: null,
    concurrency: 1,
    processing: 0,
  },
};

function normalizeCoordinate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(DEFAULT_PRECISION));
}

export function buildGridKey(lat, lng) {
  const normalizedLat = normalizeCoordinate(lat);
  const normalizedLng = normalizeCoordinate(lng);
  if (normalizedLat === null || normalizedLng === null) return null;
  return `${normalizedLat},${normalizedLng}`;
}

function getRedisUrl() {
  const envUrl = process.env.GEOCODE_REDIS_URL || process.env.REDIS_URL;
  if (!envUrl && shouldLogDriverWarnings && process.env.NODE_ENV === "production" && !warnedMissingRedisUrl) {
    console.warn("[geocode-queue] GEOCODE_REDIS_URL/REDIS_URL não configurado; usando redis://127.0.0.1:6379.");
    warnedMissingRedisUrl = true;
  }
  return envUrl || "redis://127.0.0.1:6379";
}

function ensureConnection() {
  if (state.driver !== "bullmq") return null;
  if (state.connection) return state.connection;

  try {
    const client = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    client.on("error", (error) => {
      const code = error?.code || error?.name;
      if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
        state.driver = "memory";
      }
      console.warn("[geocode-queue] Redis connection error", error?.message || error);
    });
    state.connection = client;
    return client;
  } catch (error) {
    console.warn("[geocode-queue] Failed to initialize Redis connection", error?.message || error);
    state.driver = "memory";
    return null;
  }
}

export function getGeocodeQueueConnection() {
  return ensureConnection();
}

class MemoryJob {
  constructor(id, data) {
    this.id = id;
    this.data = data;
  }

  async update(nextData) {
    this.data = { ...this.data, ...nextData };
    return this;
  }
}

function processMemoryJobs() {
  if (!state.memory.processor) return;
  while (state.memory.processing < state.memory.concurrency && state.memory.pending.length) {
    const job = state.memory.pending.shift();
    state.memory.processing += 1;
    Promise.resolve()
      .then(() => state.memory.processor(job))
      .catch((error) => {
        console.warn("[geocode-queue] Falha ao processar job em memória", error?.message || error);
      })
      .finally(() => {
        state.memory.processing -= 1;
        processMemoryJobs();
      });
  }
}

function createMemoryQueue() {
  return {
    async add(_name, data, { jobId } = {}) {
      const id = jobId || `${Date.now()}-${Math.random()}`;
      if (state.memory.jobs.has(id)) {
        return state.memory.jobs.get(id);
      }
      const job = new MemoryJob(id, data);
      state.memory.jobs.set(id, job);
      state.memory.pending.push(job);
      processMemoryJobs();
      return job;
    },
    async getJob(id) {
      return state.memory.jobs.get(id) || null;
    },
    async close() {
      state.memory.pending = [];
      state.memory.jobs.clear();
    },
  };
}

export function getGeocodeQueue() {
  if (state.driver !== "bullmq") {
    if (!warnedMemoryDriver && shouldLogDriverWarnings && process.env.NODE_ENV === "production") {
      console.warn("[geocode-queue] Modo em memória ativo em produção; configure Redis/BullMQ.");
      warnedMemoryDriver = true;
    }
    if (!state.queue) {
      state.queue = createMemoryQueue();
    }
    return state.queue;
  }

  if (state.queue) return state.queue;

  const connection = ensureConnection();
  if (!connection) {
    state.driver = "memory";
    return getGeocodeQueue();
  }

  try {
    state.scheduler =
      state.scheduler ||
      new BullQueueScheduler(GEOCODE_QUEUE_NAME, {
        connection,
      });

    state.queue =
      state.queue ||
      new BullQueue(GEOCODE_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: "fixed", delay: 3000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });
  } catch (error) {
    console.warn("[geocode-queue] Failed to initialize queue", error?.message || error);
    state.driver = "memory";
    return getGeocodeQueue();
  }

  return state.queue;
}

function mergePositionIds(existingIds = [], incomingId = null) {
  const merged = new Set((existingIds || []).filter(Boolean).map((id) => String(id)));
  if (incomingId !== null && incomingId !== undefined) {
    merged.add(String(incomingId));
  }
  return Array.from(merged);
}

function resolvePriority(priority = "normal") {
  return PRIORITY_MAP[priority] || PRIORITY_MAP.normal;
}

export async function enqueueGeocodeJob({
  positionId = null,
  positionIds = [],
  lat,
  lng,
  deviceId = null,
  reason = "warm_fill",
  priority = "normal",
} = {}) {
  const queue = getGeocodeQueue();
  if (!queue) return null;

  const gridKey = buildGridKey(lat, lng);
  if (!gridKey) return null;

  const payload = {
    lat: normalizeCoordinate(lat),
    lng: normalizeCoordinate(lng),
    deviceId: deviceId ?? null,
    positionId: positionId ?? null,
    positionIds: mergePositionIds(positionIds, positionId),
    gridKey,
    reason,
    priority,
  };

  try {
    const existing = await queue.getJob(gridKey);
    if (existing) {
      const mergedIds = mergePositionIds(existing.data?.positionIds || [], positionId);
      await existing.update({ ...existing.data, positionIds: mergedIds });
      return existing;
    }

    return await queue.add("reverse-geocode", payload, {
      jobId: gridKey,
      priority: resolvePriority(priority),
    });
  } catch (error) {
    console.warn("[geocode-queue] Failed to enqueue geocode job", {
      message: error?.message || error,
      gridKey,
      positionId,
      deviceId,
    });
    return null;
  }
}

export function registerGeocodeProcessor(processor, { concurrency = 3 } = {}) {
  if (state.driver !== "bullmq" || !BullWorker) {
    state.driver = "memory";
    state.memory.processor = processor;
    state.memory.concurrency = Math.max(1, concurrency);
    processMemoryJobs();
    console.warn("[geocode-queue] Worker iniciado em modo em memória; configure Redis para BullMQ em produção.");
    return () => {
      state.memory.processor = null;
      state.memory.pending = [];
      state.memory.processing = 0;
    };
  }

  const connection = getGeocodeQueueConnection();
  const queue = getGeocodeQueue();
  if (!connection || !queue) {
    state.driver = "memory";
    return registerGeocodeProcessor(processor, { concurrency });
  }

  state.worker =
    state.worker ||
    new BullWorker(GEOCODE_QUEUE_NAME, processor, {
      connection,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
    });

  state.worker.on("failed", (job, error) => {
    console.warn("[geocode-queue] job failed", {
      id: job?.id,
      gridKey: job?.data?.gridKey,
      positionIds: job?.data?.positionIds,
      message: error?.message || error,
    });
  });

  state.worker.on("error", (error) => {
    console.warn("[geocode-queue] worker error", error?.message || error);
  });

  return () => {
    if (state.worker) {
      state.worker.close().catch(() => {});
      state.worker = null;
    }
  };
}

export function closeGeocodeQueue() {
  const tasks = [];
  if (state.queue?.close) tasks.push(state.queue.close().catch(() => {}));
  if (state.scheduler?.close) tasks.push(state.scheduler.close().catch(() => {}));
  if (state.connection?.quit) tasks.push(state.connection.quit().catch(() => {}));
  state.memory.pending = [];
  state.memory.jobs.clear();
  return Promise.all(tasks);
}

export { GEOCODE_QUEUE_NAME };
