import React, { useEffect } from "react";
import useEagleLoader from "../lib/hooks/useEagleLoader";

export default function Loading({ message = "Carregando..." }) {
  const { register } = useEagleLoader();

  useEffect(() => {
    const cleanup = register(message);
    return () => {
      cleanup?.();
    };
  }, [message, register]);

  return null;
}
