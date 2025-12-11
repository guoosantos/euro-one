import { useEffect } from "react";

export default function useOutsideClick(ref, handler, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;

    function handleClick(event) {
      if (!ref?.current) return;
      if (ref.current.contains(event.target)) return;
      handler?.(event);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [enabled, handler, ref]);
}
