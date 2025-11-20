import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useTranslation } from "../lib/i18n.js";
import { CoreApi } from "../lib/coreApi.js";
import { formatDate } from "../lib/fleet-utils.js";

export default function TaskDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    CoreApi.listTasks({ id })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.tasks) ? data.tasks : [];
        setTask(list.find((item) => String(item.id) === String(id)) || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const updateStatus = async (status) => {
    setUpdating(true);
    try {
      const response = await CoreApi.updateTask(task.id, { status });
      setTask(response?.task || task);
    } catch (err) {
      setError(err);
    } finally {
      setUpdating(false);
    }
  };

  const timeline = [
    { label: t("tasks.createdAt"), value: task?.createdAt },
    { label: t("tasks.arrival"), value: task?.arrivalTime },
    { label: t("tasks.serviceStart"), value: task?.serviceStartTime },
    { label: t("tasks.serviceEnd"), value: task?.serviceEndTime },
  ].filter((item) => item.value);

  if (loading) return <div className="text-white">{t("loading")}</div>;
  if (error) return <div className="text-red-200">{t("tasks.loadError")}</div>;
  if (!task) return <div className="text-white">{t("tasks.notFound")}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-white">{t("tasks.detailsTitle")}</div>
          <div className="text-sm text-white/60">{task.address || t("tasks.addressPlaceholder")}</div>
        </div>
        <button className="btn" onClick={() => navigate("/tasks")}>{t("back")}</button>
      </div>

      <div className="card space-y-2">
        <Detail label={t("tasks.vehicle")} value={task.vehicleId || "—"} />
        <Detail label={t("tasks.driver")} value={task.driverId || "—"} />
        <Detail label={t("tasks.type")} value={task.type} />
        <Detail label={t("tasks.status")} value={task.status} />
        <Detail
          label={t("tasks.expectedStart")}
          value={task.startTimeExpected ? formatDate(task.startTimeExpected) : "—"}
        />
        <Detail
          label={t("tasks.expectedEnd")}
          value={task.endTimeExpected ? formatDate(task.endTimeExpected) : "—"}
        />
        <Detail label={t("tasks.createdAt")} value={task.createdAt ? formatDate(task.createdAt) : "—"} />
        <Detail label={t("tasks.geofenceRadius")} value={task.geofenceRadius || "—"} />
        <Detail label="GeoFence" value={task.geoFenceId || "—"} />
      </div>

      {timeline.length ? (
        <div className="card space-y-2">
          <div className="text-sm font-semibold text-white">{t("tasks.timeline")}</div>
          {timeline.map((item) => (
            <Detail key={item.label} label={item.label} value={formatDate(item.value)} />
          ))}
        </div>
      ) : null}

      {Array.isArray(task.attachments) && task.attachments.length ? (
        <div className="card space-y-2">
          <div className="text-sm font-semibold text-white">{t("tasks.attachments")}</div>
          <ul className="list-disc space-y-1 pl-5 text-white/80">
            {task.attachments.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={updating} onClick={() => updateStatus("finalizada")}>
            {t("tasks.finish")}
          </button>
          <button className="btn" disabled={updating} onClick={() => updateStatus("em atendimento")}>
            {t("tasks.statusInService")}
          </button>
        </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between text-sm text-white/80">
      <span className="text-white/60">{label}</span>
      <span>{value}</span>
    </div>
  );
}
