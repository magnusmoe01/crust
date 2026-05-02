function round(v) {
  return Number((v || 0).toFixed(2));
}

function normalizeLocation(v = "") {
  return String(v).trim().toLowerCase();
}

/**
 * MERGE CLEAN DATA
 */
function mergeData(zettleRows, plandayRows, employeeMap) {
  const merged = [];

  // ZETTLE (INCOME)
  (zettleRows || []).forEach((z) => {
    merged.push({
      date: z.date,
      location: normalizeLocation(z.location),
      income: Number(z.amount || 0),
      salaryCost: 0,
    });
  });

  // PLANDAY (SALARY)
  (plandayRows || []).forEach((p) => {
    const emp = employeeMap.get(p.employeeId);

    merged.push({
      date: p.date,
      location: normalizeLocation(emp?.location || "unknown"),
      income: 0,
      salaryCost: Number(p.cost || 0),
    });
  });

  return merged;
}

/**
 * SUMMARY TOTALS
 */
function getSummary(merged) {
  let income = 0;
  let cost = 0;

  merged.forEach((r) => {
    income += r.income;
    cost += r.salaryCost;
  });

  const profit = income - cost;

  return {
    totalIncome: round(income),
    totalSalaryCost: round(cost),
    totalProfit: round(profit),
    profitOrLoss: profit >= 0 ? "Profit" : "Loss",
    profitMargin: income > 0 ? round((profit / income) * 100) : 0,
  };
}

/**
 * BREAKDOWN BY LOCATION
 */
function buildBreakdown(merged) {
  const map = new Map();

  merged.forEach((r) => {
    if (!map.has(r.location)) {
      map.set(r.location, {
        location: r.location,
        income: 0,
        salaryCost: 0,
      });
    }

    const entry = map.get(r.location);
    entry.income += r.income;
    entry.salaryCost += r.salaryCost;
  });

  return Array.from(map.values()).map((l) => {
    const profit = l.income - l.salaryCost;

    return {
      location: l.location,
      income: round(l.income),
      salaryCost: round(l.salaryCost),
      profit: round(profit),
      profitOrLoss: profit >= 0 ? "Profit" : "Loss",
      profitMargin: l.income > 0 ? round((profit / l.income) * 100) : 0,
    };
  }).sort((a, b) => b.profit - a.profit);
}

module.exports = {
  mergeData,
  getSummary,
  buildBreakdown,
  round,
  normalizeLocation,
};