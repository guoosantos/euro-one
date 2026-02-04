import React from "react";

import EagleSprite from "./EagleSprite";
import { useEagleLoaderStore } from "../../lib/eagle-loader-store";

export default function EagleLoaderOverlay() {
  const count = useEagleLoaderStore((state) => state.count);
  const message = useEagleLoaderStore((state) => state.message);
  const isVisible = count > 0;

  return (
    <div
      className={`eagle-loader ${isVisible ? "" : "is-hidden"}`.trim()}
      aria-hidden={!isVisible}
      aria-live="polite"
      role="alert"
    >
      <div className="eagle-bg" />
      <div className="eagle-grid" />
      <div className="eagle-noise" />
      <div className="eagle-loader-content">
        <EagleSprite className="eagle-sprite eagle-sprite--loader" />
        {message ? <div className="eagle-loader-text">{message}</div> : null}
      </div>
    </div>
  );
}
