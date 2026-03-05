import React, { useEffect, useMemo, useRef, useState } from "react";

import eagleSpriteUrl from "../../assets/eagle_sprite_48_12x4.png";

const COLUMNS = 12;
const ROWS = 4;
const TOTAL_FRAMES = COLUMNS * ROWS;

const SAFE_FRAMES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 42, 43, 44, 45,
];
const REST_FRAME = 44;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReduced(media.matches);
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return reduced;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export default function EagleSprite({ className = "" }) {
  const [frameIndex, setFrameIndex] = useState(REST_FRAME);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const spriteRef = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const node = spriteRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setFrameSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setFrameIndex(REST_FRAME);
      return undefined;
    }

    let isCancelled = false;
    let timeoutId;
    let phase = "rest";
    let safeIndex = Math.floor(Math.random() * SAFE_FRAMES.length);
    let framesRemaining = 0;

    const tick = () => {
      if (isCancelled) return;

      if (phase === "rest") {
        setFrameIndex(REST_FRAME);
        phase = "flap";
        framesRemaining = Math.floor(randomBetween(14, 28));
        timeoutId = window.setTimeout(tick, randomBetween(220, 520));
        return;
      }

      const nextFrame = SAFE_FRAMES[safeIndex % SAFE_FRAMES.length] ?? REST_FRAME;
      setFrameIndex(nextFrame);
      safeIndex = (safeIndex + 1) % SAFE_FRAMES.length;
      framesRemaining -= 1;

      if (framesRemaining <= 0) {
        phase = "rest";
        timeoutId = window.setTimeout(tick, randomBetween(700, 1400));
      } else {
        timeoutId = window.setTimeout(tick, randomBetween(42, 70));
      }
    };

    tick();

    return () => {
      isCancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [prefersReducedMotion]);

  const { width, height } = frameSize;
  const col = frameIndex % COLUMNS;
  const row = Math.floor(frameIndex / COLUMNS);

  const style = useMemo(() => {
    const sizeWidth = width ? `${width * COLUMNS}px` : undefined;
    const sizeHeight = height ? `${height * ROWS}px` : undefined;
    const positionX = width ? `${-col * width}px` : "0px";
    const positionY = height ? `${-row * height}px` : "0px";

    return {
      backgroundImage: `url(${eagleSpriteUrl})`,
      backgroundSize: sizeWidth && sizeHeight ? `${sizeWidth} ${sizeHeight}` : undefined,
      backgroundPosition: `${positionX} ${positionY}`,
    };
  }, [col, row, width, height]);

  return <span ref={spriteRef} className={className} style={style} aria-hidden="true" />;
}
