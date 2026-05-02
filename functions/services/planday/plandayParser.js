const fs = require("fs");
const path = require("path");

/**
 * Clean CSV text (fix encoding + weird characters)
 */
function cleanCSV(raw) {
  return raw
    .replace(/^\uFEFF/, "") // remove BOM
    .replace(/�/g, "") // remove broken encoding chars
    .trim();
}

/**
 * Convert Norwegian number format (10,98 → 10.98)
 */
function parseNumber(value) {
  if (!value) return 0;
  return Number(String(value).replace(",", "."));
}

/**
 * Parse Planday CSV into structured salary rows
 */
function parsePlandayCSV(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const cleaned = cleanCSV(raw);

  const lines = cleaned.split("\n");

  // Remove header row safely
  const header = lines.shift();

  const rows = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const cols = line.split(";");

    // Expected structure (based on your file):
    // 0: empty
    // 1: month
    // 2: employeeId
    // 3: wageType
    // 4: comment
    // 5: hours
    // 6: rate
    // 7: projectField

    const employeeId = cols[2];
    const hours = parseNumber(cols[5]);
    const rate = parseNumber(cols[6]);

    if (!employeeId) continue;

    rows.push({
      employeeId: String(employeeId),
      date: new Date().toISOString().split("T")[0], // fallback if no date in CSV
      hours,
      rate,
      cost: round(hours * rate),
      raw: cols,
    });
  }

  return rows;
}

/**
 * helper
 */
function round(value) {
  return Number((value || 0).toFixed(2));
}

module.exports = { parsePlandayCSV };