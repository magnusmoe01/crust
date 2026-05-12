/**
 * functions/index.js
 *
 * Cloud Functions: financialReport, sendReviewEmail
 */

const admin = require("firebase-admin");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
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
  19768: "Gj\u00f8vik",
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
  // Also add prefixed keys for specific ID types
  map.set(`planday_${raw}`, data);
  map.set(`salary_${raw}`, data);
  if (normalized) {
    map.set(`planday_${normalized}`, data);
    map.set(`salary_${normalized}`, data);
  }
}

function getEmployeeFromMap(employeeMap, ...keys) {
  for (const raw of keys) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const normalized = normalizeEmployeeKey(value) || value;
    
    // Try exact match first
    if (employeeMap.has(value)) return employeeMap.get(value);
    
    // Try normalized match
    if (employeeMap.has(normalized)) return employeeMap.get(normalized);
    
    // Try prefixed keys for Planday and Salary IDs
    if (employeeMap.has(`planday_${value}`)) return employeeMap.get(`planday_${value}`);
    if (employeeMap.has(`salary_${value}`)) return employeeMap.get(`salary_${value}`);
    if (employeeMap.has(`planday_${normalized}`)) return employeeMap.get(`planday_${normalized}`);
    if (employeeMap.has(`salary_${normalized}`)) return employeeMap.get(`salary_${normalized}`);
  }
  return null;
}

function normalizeReportLocation(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "bergen") return "Bergen";
  if (raw === "gj\u00f8vik" || raw === "gjovik" || (raw.includes("gj") && raw.includes("vik"))) return "Gj\u00f8vik";
  return "Oslo";
}

function resolvePayrollLocation(row, employee, override) {
  const departmentId = String(row.departmentId || row.department?.id || "").trim();
  const departmentName = String(row.department || row.departmentName || row.location || "").trim();
  const preferred = String(override || "").trim() || departmentName || DEPARTMENT_ID_TO_NAME[Number(departmentId)] || employee?.location || "Oslo";
  return normalizeReportLocation(preferred);
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
    addEmployeeKey(employeeMap, data.employee_id, data);
    addEmployeeKey(employeeMap, data.employee_number, data);
    addEmployeeKey(employeeMap, data.ansattnummer, data);
    addEmployeeKey(employeeMap, data.ansatt_nr, data);
    addEmployeeKey(employeeMap, data.salaryId, data);
    addEmployeeKey(employeeMap, data.salary_number, data);
    addEmployeeKey(employeeMap, data.plandayId, data);
    addEmployeeKey(employeeMap, data.plandayEmployeeId, data);
    addEmployeeKey(employeeMap, data.planday_employee_id, data);
  });

  const grouped = new Map();
  const unmatchedEmployeeIds = new Set();

  rows.forEach((row) => {
    const employeeId = String(row.employeeId || "").trim();
    const salaryId = String(row.salaryId || "").trim();
    const plandayId = String(row.plandayId || "").trim();
    const employeeKey = employeeId || salaryId || plandayId;
    const employee = getEmployeeFromMap(employeeMap, employeeId, salaryId, plandayId);
    const location = resolvePayrollLocation(row, employee);
    const hours = toNumber(row.units || row.hours);
    const rate = toNumber(row.rate);
    const amount = toNumber(row.amount || (hours * rate));

    if (!grouped.has(location)) {
      grouped.set(location, { location, totalHours: 0, totalSalary: 0 });
    }

    if (!employee && employeeKey) {
      unmatchedEmployeeIds.add(employeeKey);
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
    addEmployeeKey(employeeMap, data.employee_id, data);
    addEmployeeKey(employeeMap, data.employee_number, data);
    addEmployeeKey(employeeMap, data.ansattnummer, data);
    addEmployeeKey(employeeMap, data.ansatt_nr, data);
    addEmployeeKey(employeeMap, data.salaryId, data);
    addEmployeeKey(employeeMap, data.salary_number, data);
    addEmployeeKey(employeeMap, data.plandayId, data);
    addEmployeeKey(employeeMap, data.plandayEmployeeId, data);
    addEmployeeKey(employeeMap, data.planday_employee_id, data);
  });

  const regrouped = new Map();
  const unmatched = new Set();

  rows.forEach((row) => {
    const employeeIdRaw = String(row.employeeId || "").trim();
    const salaryId = String(row.salaryId || "").trim();
    const plandayId = String(row.plandayId || "").trim();
    const employeeKey = normalizeEmployeeKey(employeeIdRaw || salaryId || plandayId) || (employeeIdRaw || salaryId || plandayId);
    const employee = getEmployeeFromMap(employeeMap, employeeIdRaw, salaryId, plandayId);
    const hours = toNumber(row.units || row.hours);
    const rate = toNumber(row.rate);
    const amount = toNumber(row.amount || (hours * rate));
    const overrideLocation = overrides.get(employeeKey);
    const location = resolvePayrollLocation(row, employee, overrideLocation);

    if (!overrideLocation && !employee && employeeKey) {
      unmatched.add(employeeKey);
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
    const location = normalizeReportLocation(String(row.location || "").trim());
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

function normalizeIncomeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    location: normalizeReportLocation(row?.location),
  }));
}

function normalizeSalaryRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    location: normalizeReportLocation(row?.location),
  }));
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function getFinancialReport(startDate, endDate, locations, options = {}) {
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required.");
  }

  const warnings = [];
  const includeIncome = options.includeIncome !== false;
  let incomeSource = "zettle_api";
  let salarySource = "planday_api";
  let unmatchedEmployeeIds = [];


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

  let salaryRows = normalizeSalaryRows(apiSalaryRows);
  let usedCsvFallback = false;
  if ((!salaryRows || salaryRows.length === 0) && Array.isArray(options.csvPayrollRows) && options.csvPayrollRows.length) {
    const grouped = await groupCsvPayrollRowsByLocationWithOverrides(
      options.csvPayrollRows,
      options.employeeLocationMap || {}
    );
    salaryRows = normalizeSalaryRows(grouped.groupedRows);
    unmatchedEmployeeIds = grouped.unmatchedEmployeeIds || [];
    usedCsvFallback = true;
    salarySource = "payroll_csv_fallback";
    warnings.push("Planday API returned no salary rows. Used uploaded CSV payroll fallback.");
  }

  let resolvedIncomeRows = normalizeIncomeRows(incomeRows);
  if ((!resolvedIncomeRows || resolvedIncomeRows.length === 0) && Array.isArray(options.csvIncomeRows) && options.csvIncomeRows.length) {
    resolvedIncomeRows = normalizeIncomeRows(groupIncomeCsvRows(options.csvIncomeRows));
    incomeSource = "income_csv_fallback";
    warnings.push("Zettle API returned no income rows. Used uploaded income CSV fallback.");
  }

  const canonicalLocations = ["Oslo", "Bergen", "Gj\u00f8vik"];
  const selectedLocations = locations.includes("all")
    ? canonicalLocations
    : locations.map((loc) => normalizeReportLocation(loc)).filter((loc, idx, arr) => arr.indexOf(loc) === idx);

  const incomeByLocation = new Map();
  resolvedIncomeRows.forEach((r) => {
    const loc = normalizeReportLocation(r.location);
    incomeByLocation.set(loc, (incomeByLocation.get(loc) || 0) + (r.income || 0));
  });

  const salaryByLocation = new Map();
  salaryRows.forEach((r) => {
    const loc = normalizeReportLocation(r.location);
    const current = salaryByLocation.get(loc) || { totalSalary: 0, totalHours: 0 };
    current.totalSalary += r.totalSalary || 0;
    current.totalHours += r.totalHours || 0;
    salaryByLocation.set(loc, current);
  });

  const byLocation = {};

  for (const loc of selectedLocations) {
    const income = incomeByLocation.get(loc) || 0;
    const salaryRow = salaryByLocation.get(loc);
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

// ── Review email ──────────────────────────────────────────────────────────────

// The mailbox used as sender — must exist in the Microsoft 365 tenant.
const REVIEW_EMAIL_FROM = "noreply@crust.no";

// Always CC'd regardless of who submitted.
const REVIEW_EMAIL_CC = ["brandon@crust.no", "magnus@crust.no"];

async function getAzureAccessToken() {
  const axios = require("axios");
  const params = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope:         "https://graph.microsoft.com/.default",
  });

  const res = await axios.post(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    params.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  return res.data.access_token;
}

function formatNorwegianDate(seconds) {
  if (!seconds) return null;
  const days   = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
  const months = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
  const d = new Date(seconds * 1000);
  return `${days[d.getDay()]} ${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const EMAIL_ITEM_LIMIT = 20;

function buildReviewEmailHtml(formTitle, flaggedAnswers, approvedAnswers, reviewScoreSummary, submittedAtSeconds, reviewUrl, reviewedBy) {
  const allFlags = Array.isArray(flaggedAnswers)  ? flaggedAnswers  : [];
  const approved = Array.isArray(approvedAnswers) ? approvedAnswers : [];

  // Sad first, then neutral
  const sadFlags     = allFlags.filter((f) => f.reviewStatus === "flagged_sad");
  const neutralFlags = allFlags.filter((f) => f.reviewStatus !== "flagged_sad");
  const flags        = [...sadFlags, ...neutralFlags];

  // Counts for the summary bar
  const happyCount   = approved.length;
  const neutralCount = neutralFlags.length;
  const sadCount     = sadFlags.length;

  // Cap total items shown at EMAIL_ITEM_LIMIT (flagged items take priority)
  const flagsCapped    = flags.slice(0, EMAIL_ITEM_LIMIT);
  const approvedBudget = Math.max(0, EMAIL_ITEM_LIMIT - flagsCapped.length);
  const approvedCapped = approved.slice(0, approvedBudget);
  const totalItems     = flags.length + approved.length;
  const hiddenCount    = Math.max(0, totalItems - EMAIL_ITEM_LIMIT);

  // ── Face icons (emoji — renders in all email clients including Outlook) ──────
  const svgHappy   = `<span style="display:inline-block;font-size:22px;line-height:1;vertical-align:middle;">&#128522;</span>`;
  const svgNeutral = `<span style="display:inline-block;font-size:22px;line-height:1;vertical-align:middle;">&#128528;</span>`;
  const svgSad     = `<span style="display:inline-block;font-size:22px;line-height:1;vertical-align:middle;">&#128577;</span>`;

  // ── Count bar ──────────────────────────────────────────────────────────────
  const countBar = `
    <div style="display:flex;gap:28px;padding:14px 18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;align-items:center;">
      <span style="display:inline-flex;align-items:center;gap:8px;color:#166534;font-weight:700;font-size:18px;">${svgHappy} ${happyCount}</span>
      <span style="display:inline-flex;align-items:center;gap:8px;color:#d97706;font-weight:700;font-size:18px;">${svgNeutral} ${neutralCount}</span>
      <span style="display:inline-flex;align-items:center;gap:8px;color:#dc2626;font-weight:700;font-size:18px;">${svgSad} ${sadCount}</span>
    </div>`;

  // ── Flagged section ────────────────────────────────────────────────────────
  let flaggedSection = "";
  if (flagsCapped.length > 0) {
    flaggedSection += `<p style="margin:24px 0 14px;font-weight:700;font-size:16px;color:#1f2937">Se på dette:</p>`;
    for (const item of flagsCapped) {
      const isSad       = item.reviewStatus === "flagged_sad";
      const borderColor = isSad ? "#dc2626" : "#d97706";
      const bgColor     = isSad ? "#fef2f2" : "#fffbeb";
      const faceSvg     = isSad ? svgSad : svgNeutral;

      flaggedSection += `
        <div style="margin:14px 0;border-left:4px solid ${borderColor};background:${bgColor};border-radius:0 8px 8px 0;overflow:hidden;">
          <div style="padding:12px 16px 10px;">
            <p style="font-weight:700;margin:0 0 8px;font-size:14px;color:#1f2937;display:flex;align-items:center;gap:6px;">${faceSvg} ${item.label}</p>`;

      if (item.comment) {
        flaggedSection += `
            <div style="margin:0 0 10px;padding:10px 14px;background:#1e293b;border-radius:6px;">
              <p style="margin:0;font-size:14px;color:#f1f5f9;"><strong style="color:#e2e8f0;">Tilbakemelding:</strong> ${item.comment}</p>
            </div>`;
      }

      if (item.imageUrl) {
        flaggedSection += `<img src="${item.imageUrl}" alt="${item.label}" style="max-width:420px;width:100%;display:block;margin:8px 0;border-radius:4px;" />`;
      } else {
        flaggedSection += `<p style="margin:0 0 8px;color:#374151;font-size:14px;">Svar: <em>${item.value}</em></p>`;
      }

      flaggedSection += `</div></div>`;
    }
  }

  // ── Approved section ───────────────────────────────────────────────────────
  let approvedSection = "";
  if (approvedCapped.length > 0) {
    approvedSection += `<p style="margin:28px 0 10px;font-weight:700;font-size:16px;color:#166534;display:flex;align-items:center;gap:6px;">${svgHappy} Dette så bra ut:</p>`;
    for (const item of approvedCapped) {
      approvedSection += `
        <div style="margin:8px 0;padding:10px 14px;border-left:4px solid #86efac;background:#f0fdf4;border-radius:0 6px 6px 0;">
          <p style="font-weight:600;margin:0 0 4px;font-size:13px;color:#166534;">${item.label}</p>`;

      if (item.imageUrl) {
        approvedSection += `<img src="${item.imageUrl}" alt="${item.label}" style="max-width:420px;width:100%;display:block;margin:6px 0;border-radius:4px;" />`;
      } else {
        approvedSection += `<p style="margin:0;color:#374151;font-size:13px;"><em>${item.value}</em></p>`;
      }

      approvedSection += `</div>`;
    }
  }

  const dateStr = formatNorwegianDate(submittedAtSeconds);
  const reviewerName = reviewedBy ? reviewedBy.replace(/@.*/, "") : null;
  const intro = `
    <p style="color:#6b7280;font-size:14px;margin:0 0 4px;">Skjema innsendt: <strong style="color:#1f2937;">${dateStr || formTitle}</strong></p>
    ${reviewerName ? `<p style="color:#6b7280;font-size:14px;margin:0 0 16px;">Vurdert av: <strong style="color:#1f2937;">${reviewerName}</strong></p>` : `<p style="margin:0 0 16px;"></p>`}`;

  const moreButton = hiddenCount > 0 && reviewUrl ? `
    <div style="margin:28px 0 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
      <p style="margin:0 0 14px;color:#374151;font-size:14px;">+ ${hiddenCount} flere svar ikke vist her.</p>
      <a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Se full gjennomgang</a>
    </div>` : "";

  return `
    <html>
      <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 10px">Stengeskjemaet ditt har blitt gjennomgått</h2>
        ${intro}
        ${countBar}
        ${flaggedSection}
        ${approvedSection}
        ${moreButton}
        <p style="margin-top:36px;color:#6b7280;font-size:13px">— Crust</p>
      </body>
    </html>`;
}

exports.sendReviewEmail = onCall(
  {
    region:   "europe-west1",
    secrets:  ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"],
    invoker:  "public",
  },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) {
      throw new HttpsError("permission-denied", "Admin access required");
    }

    const { submitterEmail, formTitle, flaggedAnswers, approvedAnswers, reviewScoreSummary, submittedAtSeconds, reviewUrl, testRecipient } = data || {};
    if (!submitterEmail) {
      throw new HttpsError("invalid-argument", "submitterEmail is required");
    }

    const axios = require("axios");
    const accessToken = await getAzureAccessToken();

    const hasFlags = Array.isArray(flaggedAnswers) && flaggedAnswers.length > 0;
    const isTest   = Boolean(testRecipient);
    const subject  = isTest
      ? `[TEST] Ditt stengeskjema har blitt vurdert`
      : `Ditt stengeskjema har blitt vurdert`;

    const toRecipients = isTest
      ? [{ emailAddress: { address: testRecipient } }]
      : [{ emailAddress: { address: submitterEmail } }];

    const ccRecipients = isTest
      ? []
      : REVIEW_EMAIL_CC
          .filter((e) => e.toLowerCase() !== submitterEmail.toLowerCase())
          .map((e) => ({ emailAddress: { address: e } }));

    const message = {
      subject,
      body: {
        contentType: "HTML",
        content:     buildReviewEmailHtml(formTitle, flaggedAnswers, approvedAnswers, reviewScoreSummary, submittedAtSeconds, reviewUrl, data.reviewedBy),
      },
      toRecipients,
      ...(ccRecipients.length ? { ccRecipients } : {}),
    };

    await axios.post(
      `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
      { message, saveToSentItems: false },
      {
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    logger.info("Review email sent", { submitterEmail, formTitle, isTest });
    return { success: true };
  },
);

