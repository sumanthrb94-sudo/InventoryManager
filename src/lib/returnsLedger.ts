/**
 * returnsLedger — the ONE definition of "a return", shared by every
 * surface that shows a return count.
 *
 * The Sell page used to count voided SALE DOCS while the Returns page
 * counted UNITS, so one return that voided two sale docs (processReturn
 * voids every sale linked by unitId OR imei) made the two screens
 * disagree — Sell said 5, Returns said 4, and nobody could tell which
 * was right. Both now count units from this module, so they cannot
 * drift apart by construction.
 *
 * A return belongs to a unit, not to a sale document. That is the whole
 * rule; everything below follows from it.
 */
import type { InventoryUnit } from '../types';

/**
 * A unit in an OPEN return cycle — the ledger's membership rule.
 *
 * Multi-cycle guard: a unit returned-to-inventory and then RE-SOLD still
 * carries returnType (recordSale doesn't clear it). Without the date
 * comparison the same unit double-appears in Returns and on the Sell
 * sheet, and an operator can re-process a closed return.
 */
export function isOpenReturnUnit(u: InventoryUnit): boolean {
  if (!u.returnType) return false;
  if (u.status === 'sold' && u.saleDate && u.returnDate && u.saleDate > u.returnDate) return false;
  return true;
}

/** Every unit currently in the returns ledger. */
export function returnUnits(units: InventoryUnit[]): InventoryUnit[] {
  return units.filter(isOpenReturnUnit);
}

/**
 * Returns processed within a date window, counted by returnDate.
 * `from`/`to` are inclusive ISO yyyy-mm-dd bounds; omit either for open-ended.
 */
export function returnUnitsInPeriod(
  units: InventoryUnit[],
  from?: string,
  to?: string,
): InventoryUnit[] {
  return returnUnits(units).filter(u => {
    const d = (u.returnDate || '').split('T')[0];
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

/** Today / this-month / lifetime counts — the Sell page's return chips. */
export function returnCounts(
  units: InventoryUnit[],
  today: string,
  monthStart: string,
): { today: number; month: number; all: number } {
  const ledger = returnUnits(units);
  let todayCount = 0;
  let monthCount = 0;
  for (const u of ledger) {
    const d = (u.returnDate || '').split('T')[0];
    if (!d) continue;
    if (d === today) todayCount++;
    if (d >= monthStart && d <= today) monthCount++;
  }
  return { today: todayCount, month: monthCount, all: ledger.length };
}
