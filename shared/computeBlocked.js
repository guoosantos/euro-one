export function computeBlocked({ input2, input4, out1 } = {}) {
  if (typeof input2 !== "boolean" || typeof input4 !== "boolean" || typeof out1 !== "boolean") {
    return null;
  }
  const notBlocked = input2 === false && input4 === false && out1 === true;
  return notBlocked ? "Não" : "Sim";
}
