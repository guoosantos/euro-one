export function computeBlocked({ input2, input4, out1 } = {}) {
  const notBlocked = input2 === false && input4 === false && out1 === true;
  return notBlocked ? "Não" : "Sim";
}
