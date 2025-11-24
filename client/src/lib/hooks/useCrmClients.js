import { useEffect, useState } from "react";

import { CoreApi } from "../coreApi";

export function useCrmClients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    CoreApi.listCrmClients()
      .then((response) => {
        if (!mounted) return;
        if (Array.isArray(response?.clients)) {
          setClients(response.clients);
        } else if (Array.isArray(response)) {
          setClients(response);
        } else {
          setClients([]);
        }
      })
      .catch((err) => mounted && setError(err))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  return { clients, setClients, loading, error };
}

export default useCrmClients;
