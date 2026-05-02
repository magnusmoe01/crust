/**
 * Normalize Zettle transactions into clean format
 */
export function parseZettleData(rawTransactions = []) {
  return rawTransactions
    .map((t) => ({
      id: t.id || null,
      amount: Number(t.amount || 0),
      date: t.date || null,
      location: t.location || "Unknown",
      type: t.type || "sale",
    }))
    .filter((t) => !isNaN(t.amount));
}