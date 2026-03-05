import { useCallback } from "react";
import { useEagleLoaderStore } from "../eagle-loader-store";

export default function useEagleLoader() {
  const show = useEagleLoaderStore((state) => state.show);
  const hide = useEagleLoaderStore((state) => state.hide);
  const register = useEagleLoaderStore((state) => state.register);
  const message = useEagleLoaderStore((state) => state.message);
  const isVisible = useEagleLoaderStore((state) => state.count > 0);

  const showWithMessage = useCallback(
    (text) => {
      show(text);
    },
    [show],
  );

  return {
    show: showWithMessage,
    hide,
    register,
    message,
    isVisible,
  };
}
