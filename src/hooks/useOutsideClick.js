import { useEffect, useRef } from "react";

/**
 * Hook para detectar cliques fora de um elemento.
 * Útil para fechar modais, dropdowns e popups.
 * * @param {Function} callback Função a ser executada ao clicar fora
 * @returns {React.RefObject} Ref para anexar ao elemento container
 */
export default function useOutsideClick(callback) {
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      // Se a ref existe e o clique NÃO foi dentro dela
      if (ref.current && !ref.current.contains(event.target)) {
        callback();
      }
    };

    document.addEventListener("mousedown", handleClick);
    
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [callback]);

  return ref;
}
