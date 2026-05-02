/**
 * functions/index.js
 *
 * Cloud Function: financialReport
 */

const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const { getIncomeByDateAndLocation } = require("./services/zettle/zettle");
const { getSalaryByLocation }        = require("./services/planday/planday-payroll");

if (!admin.apps.length) {
  admin.initializeApp();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(v) {
  return Math.round((v || 0) * 100) / 100;
}

function parseLocations(raw) {
  if (!raw) return ["all"];
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean) || ["all"];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ["all"];
  } catch {
    return String(raw).split(",").map((s) => s.trim()).filter(Boolean) || ["all"];
  }
}

function summarizeError(error) {
  return {
    message: error?.message || "Unknown error",
    status: error?.response?.status || null,
    code: error?.response?.data?.error?.code || error?.code || null,
    url: error?.config?.url || null,
  };
}

function daySpan(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function getBearerToken(req) {
  const authHeader = String(req.headers?.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

async function verifyAdminRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error("Missing Authorization token");
    err.statusCode = 401;
    throw err;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    const err = new Error("Invalid or expired token");
    err.statusCode = 401;
    throw err;
  }

  const email = String(decoded.email || "").toLowerCase();
  if (!email.endsWith("@crust.no")) {
    const err = new Error("Forbidden: admin access required");
    err.statusCode = 403;
    throw err;
  }

  return decoded;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value || "").trim().replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

const DEPARTMENT_ID_TO_NAME = {
  19766: "Oslo",
  19767: "Bergen",
  19768: "Gjøvik",
};

function normalizeEmployeeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, "");
  return cleaned.replace(/^0+/, "");
}

function addEmployeeKey(map, key, data) {
  const raw = String(key || "").trim();
  if (!raw) return;
  map.set(raw, data);
  const normalized = normalizeEmployeeKey(raw);
  if (normalized) map.set(normalized, data);
}

function resolvePayrollLocation(row, employee, override) {
  const departmentId = String(row.departmentId || row.department?.id || "").trim();
  const departmentName = String(row.department || row.departmentName || row.location || "").trim();
  return (
    String(override || "").trim() ||
    departmentName ||
    DEPARTMENT_ID_TO_NAME[Number(departmentId)] ||
    employee?.location ||
    "Unknown"
  );
}

async function groupCsvPayrollRowsByLocation(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const snapshot = await admin.firestore().collection("employees").get();
  const employeeMap = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    addEmployeeKey(employeeMap, doc.id, data);
    addEmployeeKey(employeeMap, data.id, data);
    addEmployeeKey(employeeMap, data.employeeId, data);
    addEmployeeKey(employeeMap, data.employeeNumber, data);
    addEmployeeKey(employeeMap, data.plandayId, data);
    addEmployeeKey(employeeMap, data.plandayEmployeeId, data);
  });

  const grouped = new Map();
  const unmatchedEmployeeIds = new Set();

  rows.forEach((row) => {
    const employeeId = String(row.employeeId || "").trim();
    const employee =
      employeeMap.get(employeeId) ||
      employeeMap.get(normalizeEmployeeKey(employeeId));
    const location = resolvePayrollLocation(row, employee);
    const hours = toNumber(row.units || row.hours);
    const rate = toNumber(row.rate);
    const amount = toNumber(row.amount || (hours * rate));

    if (location === "Unknown" && employeeId) {
      unmatchedEmployeeIds.add(employeeId);
    }

    if (!grouped.has(location)) {
      grouped.set(location, { location, totalHours: 0, totalSalary: 0 });
    }

    const target = grouped.get(location);
    target.totalHours += hours;
    target.totalSalary += amount;
  });

  return {
    groupedRows: Array.from(grouped.values()).map((row) => ({
      location: row.location,
      totalHours: round2(row.totalHours),
      totalSalary: round2(row.totalSalary),
    })),
    unmatchedEmployeeIds: Array.from(unmatchedEmployeeIds),
  };
}

async function groupCsvPayrollRowsByLocationWithOverrides(rows, employeeLocationMap = {}) {
  const base = await groupCsvPayrollRowsByLocation(rows);
  if (!Array.isArray(rows) || rows.length === 0) return base;

  const overrides = new Map();
  Object.entries(employeeLocationMap || {}).forEach(([k, v]) => {
    const key = normalizeEmployeeKey(k) || String(k || "").trim();
    const loc = String(v || "").trim();
    if (key && loc) overrides.set(key, loc);
  });

  if (!overrides.size) return base;

  const snapshot = await admin.firestore().collection("employees").get();
  const employeeMap = new Map();
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    addEmployeeKey(employeeMap, doc.id, data);
    addEmployeeKey(employeeMap, data.id, data);
    addEmployeeKey(employeeMap, data.employeeId, data);
    addEmployeeKey(employeeMap, data.employeeNumber, data);
    addEmployeeKey(employeeMap, data.plandayId, data);
    addEmployeeKey(employeeMap, data.plandayEmployeeId, data);
  });

  const regrouped = new Map();
  const unmatched = new Set();

  rows.forEach((row) => {
    const employeeIdRaw = String(row.employeeId || "").trim();
    const employeeKey = normalizeEmployeeKey(employeeIdRaw) || employeeIdRaw;
    const employee =
      employeeMap.get(employeeIdRaw) || employeeMap.get(employeeKey);
    const hours = toNumber(row.units || row.hours);
    const rate = toNumber(row.rate);
    const amount = toNumber(row.amount || (hours * rate));
    const overrideLocation = overrides.get(employeeKey);
    const location = resolvePayrollLocation(row, employee, overrideLocation);

    if (!overrideLocation && location === "Unknown" && employeeIdRaw) {
      unmatched.add(employeeIdRaw);
    }

    if (!regrouped.has(location)) {
      regrouped.set(location, { location, totalHours: 0, totalSalary: 0 });
    }
    const target = regrouped.get(location);
    target.totalHours += hours;
    target.totalSalary += amount;
  });

  return {
    groupedRows: Array.from(regrouped.values()).map((row) => ({
      location: row.location,
      totalHours: round2(row.totalHours),
      totalSalary: round2(row.totalSalary),
    })),
    unmatchedEmployeeIds: Array.from(unmatched),
  };
}

function groupIncomeCsvRows(rows) {
  const grouped = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const location = String(row.location || "").trim();
    if (!location) return;
    const income = toNumber(row.income || row.amount);
    if (!grouped.has(location)) grouped.set(location, { location, income: 0 });
    grouped.get(location).income += income;
  });

  return Array.from(grouped.values()).map((r) => ({
    location: r.location,
    income: round2(r.income),
  }));
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function getFinancialReport(startDate, endDate, locations, options = {}) {
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required.");
  }

  const warnings = [];
  const spanDays = daySpan(startDate, endDate);
  const includeIncome = options.includeIncome !== false && spanDays <= 45;
  let incomeSource = "zettle_api";
  let salarySource = "planday_api";
  let unmatchedEmployeeIds = [];

  if (!includeIncome && options.includeIncome !== false) {
    warnings.push("Income fetch skipped for large date range. Reduce range to 45 days or less to include Zettle income.");
  }

  const SOURCE_TIMEOUT_MS = 50_000;
  const [incomeRows, apiSalaryRows] = await Promise.all([
    includeIncome
      ? withTimeout(
        getIncomeByDateAndLocation(startDate, endDate),
        SOURCE_TIMEOUT_MS,
        "Income fetch"
      ).catch((error) => {
        logger.error("Income fetch failed", summarizeError(error));
        warnings.push("Could not fetch income data from Zettle. Showing salary only.");
        return [];
      })
      : Promise.resolve([]),
    withTimeout(
      getSalaryByLocation(startDate, endDate),
      SOURCE_TIMEOUT_MS,
      "Salary fetch"
    ).catch((error) => {
      logger.error("Salary fetch failed", summarizeError(error));
      warnings.push("Could not fetch salary data from Planday. Showing income only.");
      return [];
    }),
  ]);

  let salaryRows = apiSalaryRows;
  let usedCsvFallback = false;
  if ((!salaryRows || salaryRows.length === 0) && Array.isArray(options.csvPayrollRows) && options.csvPayrollRows.length) {
    const grouped = await groupCsvPayrollRowsByLocationWithOverrides(
      options.csvPayrollRows,
      options.employeeLocationMap || {}
    );
    salaryRows = grouped.groupedRows;
    unmatchedEmployeeIds = grouped.unmatchedEmployeeIds || [];
    usedCsvFallback = true;
    salarySource = "payroll_csv_fallback";
    warnings.push("Planday API returned no salary rows. Used uploaded CSV payroll fallback.");
  }

  let resolvedIncomeRows = incomeRows;
  if ((!resolvedIncomeRows || resolvedIncomeRows.length === 0) && Array.isArray(options.csvIncomeRows) && options.csvIncomeRows.length) {
    resolvedIncomeRows = groupIncomeCsvRows(options.csvIncomeRows);
    incomeSource = "income_csv_fallback";
    warnings.push("Zettle API returned no income rows. Used uploaded income CSV fallback.");
  }

  const allLocations = new Set([
    ...resolvedIncomeRows.map((r) => r.location),
    ...salaryRows.map((r) => r.location),
  ]);

  const byLocation = {};

  for (const loc of allLocations) {
    const includeUnknownCsvLocation = usedCsvFallback && loc === "Unknown";
    if (!locations.includes("all") && !locations.includes(loc) && !includeUnknownCsvLocation) continue;

    const income = resolvedIncomeRows
      .filter((r) => r.location === loc)
      .reduce((sum, r) => sum + (r.income || 0), 0);

    const salaryRow     = salaryRows.find((r) => r.location === loc);
    const salary        = salaryRow?.totalSalary || 0;
    const hours         = salaryRow?.totalHours  || 0;
    const profit        = income - salary;
    const marginPercent = income > 0 ? round2((profit / income) * 100) : 0;

    byLocation[loc] = {
      income:        round2(income),
      salary:        round2(salary),
      hours:         round2(hours),
      profit:        round2(profit),
      marginPercent,
    };
  }

  const vals          = Object.values(byLocation);
  const totalIncome   = round2(vals.reduce((s, r) => s + r.income,  0));
  const totalSalary   = round2(vals.reduce((s, r) => s + r.salary,  0));
  const totalHours    = round2(vals.reduce((s, r) => s + r.hours,   0));
  const totalProfit   = round2(totalIncome - totalSalary);
  const marginPercent = totalIncome > 0
    ? round2((totalProfit / totalIncome) * 100)
    : 0;

  return {
    startDate,
    endDate,
    locations,
    warnings,
    incomeSource,
    salarySource,
    unmatchedEmployeeIds,
    totalIncome,
    totalSalary,
    totalHours,
    totalProfit,
    marginPercent,
    byLocation,
  };
}

// ── Cloud Function ────────────────────────────────────────────────────────────

exports.financialReport = onRequest(
  {
    region:         "europe-west1",
    timeoutSeconds: 120,
    memory:         "512MiB",
    secrets:        ["PLANDAY_CLIENT_ID", "PLANDAY_TOKEN", "ZETTLE_CLIENT_ID", "ZETTLE_CLIENT_SECRET"],
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin",  "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      await verifyAdminRequest(req);

      const source    = req.method === "GET" ? req.query : (req.body || {});
      const startDate = source.startDate;
      const endDate   = source.endDate;
      const locations = parseLocations(source.locations);
      const includeIncome = String(source.includeIncome || "true").toLowerCase() !== "false";
      const csvPayrollRows = Array.isArray(source.csvPayrollRows) ? source.csvPayrollRows : [];
      const csvIncomeRows = Array.isArray(source.csvIncomeRows) ? source.csvIncomeRows : [];
      const employeeLocationMap =
        source.employeeLocationMap && typeof source.employeeLocationMap === "object"
          ? source.employeeLocationMap
          : {};

      const result = await getFinancialReport(startDate, endDate, locations, {
        includeIncome,
        csvPayrollRows,
        csvIncomeRows,
        employeeLocationMap,
      });
      res.status(200).json(result);
    } catch (error) {
      logger.error("financialReport error", summarizeError(error));
      const statusCode = Number(error?.statusCode) || 500;

      const upstreamCode =
        error?.response?.data?.error?.code ||
        error?.response?.data?.code ||
        null;
      const message =
        error?.message ||
        (upstreamCode ? `Upstream API error: ${upstreamCode}` : null) ||
        "Failed to generate financial report.";

      res.status(statusCode).json({
        error:   message,
        details: error.response?.data   || null,
        status:  error.response?.status || null,
        url:     error.config?.url      || null,
      });
    }
  }
);
