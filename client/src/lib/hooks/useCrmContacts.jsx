import { useCallback, useEffect, useMemo, useState } from "react";
import { CoreApi } from "../coreApi.js";
import { logCrmError } from "./useCrmClients.js";

export default function useCrmContacts(clientId, options) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Normaliza os parâmetros (podem vir null/undefined)
  const requestParams = useMemo(() => {
    const base =
      options && typeof options === "object"
        ? options
        : {};

    // Se não tiver cliente selecionado, não chama a API
    if (!clientId) {
      return null;
    }

    return {
      ...base,
      clientId, // ID do cliente selecionado na tela de CRM
    };
  }, [clientId, options]);

  const load = useCallback(() => {
    // Sem cliente selecionado: só limpa a lista e não chama nada
    if (!requestParams) {
      setContacts([]);
      setError(null);
      return Promise.resolve();
    }

    setLoading(true);
    setError(null);

    return CoreApi.listCrmContacts(requestParams)
      .then((response) => {
        // Pode vir { contacts: [...] } ou direto um array
        const raw = response?.contacts ?? response ?? [];
        const list = Array.isArray(raw) ? raw : [];
        setContacts(list);
      })
      .catch((err) => {
        logCrmError(err, "listCrmContacts");
        setError(
          new Error("Não foi possível carregar as interações deste cliente. Tente novamente."),
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [requestParams]);

  useEffect(() => {
    load();
  }, [load]);

  const addContact = useCallback(
    async (data) => {
      if (!clientId) {
        throw new Error("Selecione um cliente para registrar a interação do CRM.");
      }

      const payload = {
        ...data,
        clientId,
      };

      try {
        const created = await CoreApi.createCrmContact(payload);
        // já inclui o contato novo na lista local
        setContacts((current) => [created, ...(current || [])]);
        return created;
      } catch (err) {
        logCrmError(err, "createCrmContact");
        throw err;
      }
    },
    [clientId],
  );

  return {
    contacts,
    loading,
    error,
    addContact,
    refresh: load,
  };
}
