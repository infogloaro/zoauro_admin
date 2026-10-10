/** Money is always integer paise (AGENTS.md). These helpers convert at the edges only. */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) {
    throw new TypeError('paise must be an integer');
  }
  return paise / 100;
}
