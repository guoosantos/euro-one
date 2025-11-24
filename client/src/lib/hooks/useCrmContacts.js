import { useEffect, useState } from "react";

import { CoreApi } from "../coreApi";

export function useCrmContacts(clientId) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientId) {
      setContacts([]);
      return undefined;
    }
    let mounted = true;
    setLoading(true);
    CoreApi.listCrmContacts(clientId)
      .then((response) => {
        if (!mounted) return;
        if (Array.isArray(response?.contacts)) {
          setContacts(response.contacts);
        } else if (Array.isArray(response)) {
          setContacts(response);
        } else {
          setContacts([]);
        }
      })
      .catch((err) => mounted && setError(err))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [clientId]);

  return { contacts, setContacts, loading, error };
}

export default useCrmContacts;
