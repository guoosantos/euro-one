import React, { Suspense } from "react";

const Impl = React.lazy(() => import("./_MapImpl"));

export default function LeafletMap(props) {
  return (
    <Suspense fallback={<div className="card">Carregando mapa…</div>}>
      <Impl {...props} />
    </Suspense>
  );
}
