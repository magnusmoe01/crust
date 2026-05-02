const admin = require("firebase-admin");

// ✅ SAFE IMPORT (prevents deployment crash)
let getIncomeByDateAndLocation;

try {
  ({ getIncomeByDateAndLocation } = require("./zettle/zettle"));
} catch (err) {
  console.error("❌ Failed to load Zettle module:", err.message);
}

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * MAIN FINANCIAL REPORT FUNCTION
 */
async function getFinancialReport(
  startDate,
  endDate,
  locations = ["all"]
) {
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required.");
  }

  if (!getIncomeByDateAndLocation) {
    throw new Error(
      "Zettle income service is not available. Check module path."
    );
  }

  const incomeData = await getIncomeByDateAndLocation(startDate, endDate);

  let filtered = incomeData;

  // Filter by location
  if (!locations.includes("all")) {
    filtered = incomeData.filter((item) =>
      locations.includes(item.location)
    );
  }

  let totalIncome = 0;
  const byLocation = {};
  const byDate = {};

  for (const item of filtered) {
    const income = Number(item.income || 0);

    totalIncome += income;

    // by location
    if (!byLocation[item.location]) {
      byLocation[item.location] = 0;
    }
    byLocation[item.location] += income;

    // by date
    if (!byDate[item.date]) {
      byDate[item.date] = 0;
    }
    byDate[item.date] += income;
  }

  return {
    startDate,
    endDate,
    locations,
    totalIncome: Number(totalIncome.toFixed(2)),
    byLocation,
    byDate,
    rows: filtered,
  };
}

module.exports = {
  getFinancialReport,
};