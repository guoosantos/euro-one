import { useEffect, useRef } from "react";
import { useUI } from "../store.js";

export default function useOverlayActivity(isOpen) {
  const registerOverlay = useUI((state) => state.registerOverlay);
  const cleanupRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return;
    }

    if (!cleanupRef.current) {
      cleanupRef.current = registerOverlay();
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [isOpen, registerOverlay]);
}
