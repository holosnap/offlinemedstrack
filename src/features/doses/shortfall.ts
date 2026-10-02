import { formatQuantity } from '@/lib/format';

/**
 * Warning shown when a taken dose was larger than the recorded supply. Supply never goes below
 * zero, so the count is now 0 and the person is asked to check it.
 */
export function shortfallMessage(name: string, shortfall: number): string | null {
  if (!(shortfall > 0)) return null;
  return `${name}: your recorded supply was less than this dose, so it is now 0 (short by ${formatQuantity(shortfall)}). Check how much you have and update the supply count if it is wrong.`;
}
