/**
 * functions/index.js
 *
 * Cloud Functions: financialReport, sendReviewEmail
 */

const admin = require("firebase-admin");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

function buildReviewEmailHtml(formTitle, flaggedAnswers, approvedAnswers, reviewScoreSummary, submittedAtSeconds, reviewUrl, reviewedBy, isTest, { generalFeedback, rejected, rejectionComment } = {}) {
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
  const rawName = reviewedBy ? reviewedBy.replace(/@.*/, "") : null;
  const reviewerName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : null;
  const reviewerLabel = isTest ? "TEST" : (reviewerName || null);
  const countBar = `
    <div style="display:flex;align-items:center;padding:14px 18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;">
      <span style="display:inline-flex;align-items:center;gap:8px;color:#166534;font-weight:700;font-size:18px;margin-right:32px;">${svgHappy}&nbsp;${happyCount}</span>
      <span style="display:inline-flex;align-items:center;gap:8px;color:#d97706;font-weight:700;font-size:18px;margin-right:32px;">${svgNeutral}&nbsp;${neutralCount}</span>
      <span style="display:inline-flex;align-items:center;gap:8px;color:#dc2626;font-weight:700;font-size:18px;">${svgSad}&nbsp;${sadCount}</span>
    </div>
    ${reviewerLabel ? `<p style="margin:0 0 20px;font-size:13px;color:#6b7280;">Vurdert av: <strong style="color:#1f2937;">${reviewerLabel}</strong></p>` : `<p style="margin:0 0 20px;"></p>`}`;

  // ── Flagged section ────────────────────────────────────────────────────────
  let flaggedSection = "";
  if (flagsCapped.length > 0) {
    flaggedSection += `<p style="margin:24px 0 14px;font-weight:700;font-size:16px;color:#1f2937">Se på dette:</p>`;
    for (const item of flagsCapped) {
      const isSad        = item.reviewStatus === "flagged_sad";
      const borderColor  = isSad ? "#dc2626" : "#d97706";
      const bgColor      = isSad ? "#fef2f2" : "#fffbeb";
      const commentBg    = isSad ? "#fca5a5" : "#fde68a";
      const commentColor = isSad ? "#7f1d1d" : "#78350f";
      const faceSvg      = isSad ? svgSad : svgNeutral;

      flaggedSection += `
        <div style="margin:14px 0;border-left:4px solid ${borderColor};background:${bgColor};border-radius:0 8px 8px 0;overflow:hidden;">
          <div style="padding:12px 16px 10px;">
            <p style="font-weight:700;margin:0 0 8px;font-size:14px;color:#1f2937;display:flex;align-items:center;gap:6px;">${faceSvg} ${item.label}</p>`;

      if (item.comment) {
        flaggedSection += `
            <div style="margin:0 0 10px;padding:10px 14px;background:${commentBg};border-radius:6px;">
              <p style="margin:0;font-size:14px;color:${commentColor};"><strong>Tilbakemelding:</strong> ${item.comment}</p>
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
  const intro = `<p style="color:#6b7280;font-size:14px;margin:0 0 16px;">Skjema innsendt: <strong style="color:#1f2937;">${dateStr || formTitle}</strong></p>`;

  const moreButton = hiddenCount > 0 && reviewUrl ? `
    <div style="margin:28px 0 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
      <p style="margin:0 0 14px;color:#374151;font-size:14px;">+ ${hiddenCount} flere svar ikke vist her.</p>
      <a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Se full gjennomgang</a>
    </div>` : "";

  const generalFeedbackBlock = generalFeedback
    ? `<div style="margin:0 0 20px;padding:14px 18px;background:#f0f4ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;">
         <p style="margin:0;font-size:14px;color:#1e3a5f;line-height:1.6;">${generalFeedback}</p>
       </div>`
    : "";

  if (rejected) {
    return `
      <html>
        <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
          <h2 style="margin:0 0 10px;color:#b91c1c;">Stengeskjemaet ditt ble avvist</h2>
          ${intro}
          ${reviewerLabel ? `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Vurdert av: <strong style="color:#1f2937;">${reviewerLabel}</strong></p>` : ""}
          <div style="margin:0 0 24px;padding:14px 18px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 8px 8px 0;">
            <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.6;"><strong>Årsak:</strong> ${rejectionComment || ""}</p>
          </div>
          <p style="margin-top:36px;color:#6b7280;font-size:13px">— Crust</p>
        </body>
      </html>`;
  }

  return `
    <html>
      <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 10px">Stengeskjemaet ditt har blitt gjennomgått</h2>
        ${intro}
        ${countBar}
        ${generalFeedbackBlock}
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

    const { submitterEmail, formTitle, flaggedAnswers, approvedAnswers, reviewScoreSummary, submittedAtSeconds, reviewUrl, testRecipient, generalFeedback, rejected, rejectionComment } = data || {};
    if (!submitterEmail) {
      throw new HttpsError("invalid-argument", "submitterEmail is required");
    }

    const axios = require("axios");
    const accessToken = await getAzureAccessToken();

    const hasFlags = Array.isArray(flaggedAnswers) && flaggedAnswers.length > 0;
    const isTest   = Boolean(testRecipient);
    const subject  = rejected
      ? (isTest ? `[TEST] Stengeskjemaet ditt ble avvist` : `Stengeskjemaet ditt ble avvist`)
      : (isTest ? `[TEST] Ditt stengeskjema har blitt vurdert` : `Ditt stengeskjema har blitt vurdert`);

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
        content:     buildReviewEmailHtml(formTitle, flaggedAnswers, approvedAnswers, reviewScoreSummary, submittedAtSeconds, reviewUrl, data.reviewedBy, isTest, { generalFeedback, rejected, rejectionComment }),
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


// ── Order / Vipps / SMS ───────────────────────────────────────────────────────

const crypto = require("crypto");

const VIPPS_API      = "https://api.vipps.no";
const WORKER_ALERT_PHONE = "+4795885852";
const ORDER_ALERT_MINUTES = 2;

function formatPhoneForSms(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("47") && digits.length === 10) return `+${digits}`;
  if (digits.length === 8) return `+47${digits}`;
  return `+${digits}`;
}

function formatPhoneForVipps(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("47") && digits.length === 10) return digits.slice(2);
  if (digits.length === 8) return digits;
  return digits;
}

function capitalizeFirst(str) {
  const s = String(str || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
}

function renderSmsTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

const SMS_DEFAULTS = {
  confirmation: "Hei {name}! Vi har mottatt bestillingen din ({items}) fra Crust n' Trust. Du får ny SMS når den er klar for henting. 🍕",
  ready:        "Hei {name}! 🍕 Bestillingen din er klar for henting hos Crust n' Trust — {location}. God appetitt!",
  feedback:     "Hei {name}! Håper maten smakte godt. Del gjerne din tilbakemelding: {link} 🍕",
};

async function getVippsToken() {
  const axios = require("axios");
  const res = await axios.post(
    `${VIPPS_API}/accesstoken/get`,
    {},
    {
      headers: {
        "client_id":                    process.env.VIPPS_CLIENT_ID,
        "client_secret":                process.env.VIPPS_CLIENT_SECRET,
        "Ocp-Apim-Subscription-Key":    process.env.VIPPS_SUBSCRIPTION_KEY,
        "Merchant-Serial-Number":       process.env.VIPPS_MSN,
      },
    },
  );
  return res.data.access_token;
}

function vippsHeaders(token, requestId) {
  return {
    Authorization:                `Bearer ${token}`,
    "Ocp-Apim-Subscription-Key":  process.env.VIPPS_SUBSCRIPTION_KEY,
    "Merchant-Serial-Number":     process.env.VIPPS_MSN,
    "X-Request-Id":               requestId || crypto.randomBytes(8).toString("hex"),
    "X-Timestamp":                new Date().toISOString(),
    "Content-Type":               "application/json",
  };
}

async function sendElksSms(to, message) {
  const axios = require("axios");
  const username = process.env.ELKS_API_USERNAME;
  const password = process.env.ELKS_API_PASSWORD;
  if (!username || !password) throw new Error("ELKS_API_USERNAME/ELKS_API_PASSWORD not configured");

  await axios.post(
    "https://api.46elks.com/a1/sms",
    new URLSearchParams({ from: "Crust", to, message }).toString(),
    {
      auth: { username, password },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
  );
}

async function getOrderConfig() {
  const snap = await admin.firestore().doc("orderConfig/default").get();
  return snap.exists ? snap.data() : {};
}

// Initiate Vipps payment and create order doc
exports.initiateVippsOrder = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["VIPPS_CLIENT_ID", "VIPPS_CLIENT_SECRET", "VIPPS_SUBSCRIPTION_KEY", "VIPPS_MSN"],
  },
  async ({ data }) => {
    const { locationId, locationName, items, total, customerPhone, customerName } = data || {};
    if (!locationId || !Array.isArray(items) || items.length === 0 || !customerPhone || !customerName) {
      throw new HttpsError("invalid-argument", "Missing required order fields");
    }

    const smsPhone = formatPhoneForSms(customerPhone);

    const orderRef = await admin.firestore().collection("orders").add({
      locationId,
      locationName,
      items,
      total: Number(total) || 0,
      customerPhone: smsPhone,
      customerName,
      status:     "pending_payment",
      alertSent:  false,
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    });
    const orderId = orderRef.id;

    const token     = await getVippsToken();
    const authToken = crypto.randomBytes(32).toString("hex");
    await orderRef.update({ vippsAuthToken: authToken });

    const axios = require("axios");
    const res = await axios.post(
      `${VIPPS_API}/ecomm/v2/payments`,
      {
        merchantInfo: {
          merchantSerialNumber: process.env.VIPPS_MSN,
          callbackPrefix: "https://europe-west1-crust-11575.cloudfunctions.net/vippsCallback",
          fallBack: `https://crust.no/order?orderId=${orderId}&vipps=return`,
          authToken,
          isApp: false,
          paymentType: "eComm Regular Payment",
        },
        customerInfo: { mobileNumber: formatPhoneForVipps(customerPhone) },
        transaction: {
          orderId,
          amount: Math.round((Number(total) || 0) * 100),
          transactionText: "Crust n' Trust pizza bestilling",
          skipLandingPage: false,
        },
      },
      { headers: vippsHeaders(token, orderId) },
    );

    return { orderId, redirectUrl: res.data.url };
  },
);

// Vipps payment callback — called by Vipps after user pays
exports.vippsCallback = onRequest(
  {
    region:  "europe-west1",
    secrets: ["VIPPS_CLIENT_ID", "VIPPS_CLIENT_SECRET", "VIPPS_SUBSCRIPTION_KEY", "VIPPS_MSN", "ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    // Extract orderId from path: /v2/payments/{orderId}
    const parts   = req.path.split("/").filter(Boolean);
    const orderId = parts[parts.length - 1];
    if (!orderId) { res.status(400).send("Missing orderId"); return; }

    const orderRef = admin.firestore().doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) { res.status(404).send("Order not found"); return; }

    const order = orderSnap.data();

    // Verify Vipps auth token
    const incomingToken = req.headers["authorization"] || "";
    if (order.vippsAuthToken && incomingToken !== order.vippsAuthToken) {
      res.status(401).send("Unauthorized"); return;
    }

    const body = req.body || {};
    const transactionInfo = body.transactionInfo || {};
    const status          = String(transactionInfo.status || "").toUpperCase();

    if (status === "RESERVE" || status === "SALE") {
      // Capture immediately if RESERVE
      if (status === "RESERVE") {
        try {
          const axios  = require("axios");
          const token  = await getVippsToken();
          await axios.post(
            `${VIPPS_API}/ecomm/v2/payments/${orderId}/capture`,
            {
              merchantInfo: { merchantSerialNumber: process.env.VIPPS_MSN },
              transaction: {
                amount: Math.round((order.total || 0) * 100),
                transactionText: "Crust pizza bestilling",
              },
            },
            { headers: vippsHeaders(token, `capture-${orderId}`) },
          );
        } catch (err) {
          logger.error("Vipps capture failed", { orderId, error: err?.message });
        }
      }

      await orderRef.update({
        status:     "paid",
        paidAt:     admin.firestore.FieldValue.serverTimestamp(),
      });

      // Send confirmation SMS to customer
      try {
        const cfg      = await getOrderConfig();
        const template = cfg.smsTexts?.confirmation || SMS_DEFAULTS.confirmation;
        const name     = capitalizeFirst(order.customerName || "");
        await sendElksSms(
          order.customerPhone,
          renderSmsTemplate(template, { name, items: formatOrderItems(order.items) }),
        );
      } catch (err) {
        logger.error("Confirmation SMS failed", { orderId, error: err?.message });
      }

    } else if (status === "CANCELLED" || status === "FAILED") {
      await orderRef.update({ status: "cancelled" });
    }

    res.status(200).json({ ok: true });
  },
);

// Check Vipps order status (called by frontend after return from Vipps)
exports.checkVippsOrder = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["VIPPS_CLIENT_ID", "VIPPS_CLIENT_SECRET", "VIPPS_SUBSCRIPTION_KEY", "VIPPS_MSN", "ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async ({ data }) => {
    const { orderId } = data || {};
    if (!orderId) throw new HttpsError("invalid-argument", "orderId required");

    const snap = await admin.firestore().doc(`orders/${orderId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found");

    const order = snap.data();

    // Already paid — return early
    if (order.status === "paid" || order.status === "confirmed" || order.status === "ready") {
      return { status: order.status, customerName: order.customerName, customerPhone: order.customerPhone, total: order.total };
    }

    // Fallback: check Vipps API directly
    try {
      const axios = require("axios");
      const token = await getVippsToken();
      const res   = await axios.get(
        `${VIPPS_API}/ecomm/v2/payments/${orderId}/details`,
        { headers: vippsHeaders(token, `check-${orderId}`) },
      );
      const history = Array.isArray(res.data?.transactionLogHistory) ? res.data.transactionLogHistory : [];
      const captured = history.find((h) => (h.operation === "CAPTURE" || h.operation === "SALE") && h.operationSuccess);
      const reserved = history.find((h) => h.operation === "RESERVE" && h.operationSuccess);

      if (captured || reserved) {
        if (reserved && !captured) {
          try {
            await axios.post(
              `${VIPPS_API}/ecomm/v2/payments/${orderId}/capture`,
              {
                merchantInfo: { merchantSerialNumber: process.env.VIPPS_MSN },
                transaction: {
                  amount: Math.round((order.total || 0) * 100),
                  transactionText: "Crust pizza bestilling",
                },
              },
              { headers: vippsHeaders(token, `capture-${orderId}`) },
            );
          } catch (err) {
            logger.error("Fallback capture failed", { orderId, error: err?.message });
          }
        }

        await admin.firestore().doc(`orders/${orderId}`).update({
          status: "paid",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Send SMS if not already sent
        if (!order.smsSent) {
          try {
            const cfg      = await getOrderConfig();
            const template = cfg.smsTexts?.confirmation || SMS_DEFAULTS.confirmation;
            const name     = capitalizeFirst(order.customerName || "");
            await sendElksSms(
              order.customerPhone,
              renderSmsTemplate(template, { name, items: formatOrderItems(order.items) }),
            );
            await admin.firestore().doc(`orders/${orderId}`).update({ smsSent: true });
          } catch (err) {
            logger.error("Fallback SMS failed", { orderId, error: err?.message });
          }
        }
        return { status: "paid", customerName: order.customerName, customerPhone: order.customerPhone, total: order.total };
      }
    } catch (err) {
      logger.error("Vipps status check failed", { orderId, error: err?.message });
    }

    return { status: order.status || "pending_payment" };
  },
);

// Manual SMS — send arbitrary message to one or more numbers (admin only)
exports.sendManualSms = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async ({ data }) => {
    const message = (data?.message || "").trim();
    if (!message) throw new HttpsError("invalid-argument", "message required");

    const phones = Array.isArray(data?.phones)
      ? data.phones.map((p) => String(p).trim()).filter(Boolean)
      : [(data?.phone || "").trim()].filter(Boolean);

    if (!phones.length) throw new HttpsError("invalid-argument", "phone required");

    await Promise.all(phones.map((phone) => sendElksSms(phone, message)));
    return { sent: true, count: phones.length };
  },
);

// Test SMS (admin only)
exports.sendTestSms = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async ({ data }) => {
    const { phone } = data || {};
    if (!phone) throw new HttpsError("invalid-argument", "phone required");
    await sendElksSms(phone, "Test-SMS fra Crust n' Trust. 46elks er riktig konfigurert!");
    return { sent: true };
  },
);

// Send unconfirmed order alert SMS to store workers
exports.sendUnconfirmedOrderAlert = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async ({ data }) => {
    const { orderId, workerPin } = data || {};
    if (!orderId) throw new HttpsError("invalid-argument", "orderId required");

    const snap = await admin.firestore().doc(`orders/${orderId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found");

    const order = snap.data();
    const config = await getOrderConfig();
    const locPin = String(config.locationSettings?.[order.locationId]?.workerPin || "");
    if (!locPin || locPin !== String(workerPin || "")) {
      throw new HttpsError("permission-denied", "Invalid PIN");
    }

    if (order.alertSent) return { skipped: true };
    if (order.status !== "paid") return { skipped: true };

    await admin.firestore().doc(`orders/${orderId}`).update({ alertSent: true });

    await sendElksSms(
      WORKER_ALERT_PHONE,
      `⚠️ Ubehandlet bestilling fra Crust n' Trust: ${order.customerName} — ${order.locationName} — ${order.total} kr. Ikke bekreftet på ${ORDER_ALERT_MINUTES} minutter. Sjekk dashbordet!`,
    );

    return { sent: true };
  },
);

// Notify customer that order is ready for pickup
exports.sendOrderReadySms = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async ({ data }) => {
    const { orderId, workerPin } = data || {};
    if (!orderId) throw new HttpsError("invalid-argument", "orderId required");

    const orderRef = admin.firestore().doc(`orders/${orderId}`);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found");

    const config = await getOrderConfig();
    const locPin = String(config.locationSettings?.[snap.data().locationId]?.workerPin || "");
    if (!locPin || locPin !== String(workerPin || "")) {
      throw new HttpsError("permission-denied", "Invalid PIN");
    }

    const order    = snap.data();
    const name     = capitalizeFirst(order.customerName || "");
    const template = config.smsTexts?.ready || SMS_DEFAULTS.ready;

    await sendElksSms(
      order.customerPhone,
      renderSmsTemplate(template, { name, location: order.locationName || "" }),
    );

    await orderRef.update({
      status:          "ready",
      readyAt:         admin.firestore.FieldValue.serverTimestamp(),
      feedbackSmsSent: false,
    });

    return { sent: true };
  },
);

// Send feedback SMS 15 min after order is ready
exports.scheduledFeedbackSms = onSchedule(
  {
    schedule: "every 5 minutes",
    region:   "europe-west1",
    timeZone: "Europe/Oslo",
    secrets:  ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"],
  },
  async () => {
    const db     = admin.firestore();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const config = await getOrderConfig();
    const template     = config.smsTexts?.feedback     || SMS_DEFAULTS.feedback;
    const feedbackLink = config.smsTexts?.feedbackLink || "";

    const snap = await db.collection("orders")
      .where("status", "==", "ready")
      .where("readyAt", "<=", admin.firestore.Timestamp.fromDate(cutoff))
      .get();

    await Promise.all(
      snap.docs
        .filter((d) => d.data().feedbackSmsSent !== true)
        .map(async (docSnap) => {
          const order = docSnap.data();
          const name  = capitalizeFirst(order.customerName || "");
          const msg   = renderSmsTemplate(template, { name, link: feedbackLink });
          try {
            await sendElksSms(order.customerPhone, msg);
            await docSnap.ref.update({ feedbackSmsSent: true });
          } catch (err) {
            logger.error("Feedback SMS failed", { orderId: docSnap.id, error: err?.message });
          }
        }),
    );
  },
);

// ── Inventory alert ───────────────────────────────────────────────────────────

const AZURE_SECRETS_INVENTORY = ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"];
const SELECT_OPTION_HISTORY_CATEGORIES = ["normal", "orange", "red"];
const INVENTORY_EMAIL_RECIPIENTS = ["magnus@crust.no"];

function getSelectOptionHistoryCategory(question, selectedOption) {
  if (!selectedOption || question?.type !== "select") return "normal";
  const detail = question?.selectOptionDetails?.[selectedOption];
  return SELECT_OPTION_HISTORY_CATEGORIES.includes(detail?.historyCategory)
    ? detail.historyCategory
    : "normal";
}

async function buildInventoryAlertData() {
  const db = admin.firestore();

  // Load stengeskjema form definition and active locations in parallel
  const [formsSnap, locationsSnap] = await Promise.all([
    db.collection("forms").where("slug", "==", "stengeskjema").limit(1).get(),
    db.collection("locations").get(),
  ]);
  if (formsSnap.empty) throw new Error("stengeskjema form not found");

  const activeLocationNames = new Set(
    locationsSnap.docs
      .map((d) => String(d.data().name || "").trim())
      .filter(Boolean),
  );

  const formDoc = formsSnap.docs[0].data();
  const allQuestions = Array.isArray(formDoc.questions) ? formDoc.questions : [];

  const locationQuestion = allQuestions.find((q) => q.type === "location");
  const analysisQuestions = allQuestions.filter(
    (q) => q.type === "select" && Boolean(q.includeInAnalysis),
  );

  if (analysisQuestions.length === 0 || !locationQuestion) return [];

  // Query recent submissions (last 60 days to ensure at least one per location)
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const submissionsSnap = await db.collection("formSubmissions")
    .where("formSlug", "==", "stengeskjema")
    .where("submittedAt", ">=", admin.firestore.Timestamp.fromDate(since))
    .orderBy("submittedAt", "desc")
    .get();

  // Group by location, keep only the most recent per location
  const latestByLocation = new Map();
  for (const doc of submissionsSnap.docs) {
    const data = doc.data();
    const loc = String(data.answers?.[locationQuestion.id] || "").trim() || "Ukjent lokasjon";
    if (!latestByLocation.has(loc)) {
      latestByLocation.set(loc, data);
    }
  }

  // Build alert data per location — only for locations active on /analyse
  const result = [];
  for (const [location, submission] of latestByLocation.entries()) {
    if (!activeLocationNames.has(location)) continue;
    const redItems = [];
    const orangeItems = [];

    for (const question of analysisQuestions) {
      if (question.excludeFromLocationStatus) continue;
      // Skip if a refill/ordered action already exists
      const action = submission.analysisActions?.[question.id];
      const actionType = String(action?.type || "").toLowerCase();
      if (actionType === "refill" || actionType === "ordered") continue;

      const value = String(submission.answers?.[question.id] || "").trim();
      if (!value) continue;

      const category = getSelectOptionHistoryCategory(question, value);
      const label = (question.analysisLabel || question.label || question.id).trim();
      const item = { label, value, category };

      if (category === "red") redItems.push(item);
      else if (category === "orange") orangeItems.push(item);
    }

    const submittedAtSeconds = submission.submittedAt?.seconds || null;
    if (redItems.length > 0 || orangeItems.length > 0) {
      result.push({ location, items: [...redItems, ...orangeItems], submittedAtSeconds });
    }
  }

  // Sort by most recently submitted first; locations without a timestamp go last
  result.sort((a, b) => (b.submittedAtSeconds || 0) - (a.submittedAtSeconds || 0));

  return result;
}

function buildInventoryAlertEmailHtml(alertData, dateStr) {
  if (alertData.length === 0) {
    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
        <h2 style="margin:0 0 8px;">Varebeholdning – ${dateStr}</h2>
        <p style="color:#6b7280;">Ingen røde eller oransje varer i dag. Alt ser bra ut! ✅</p>
      </div>`;
  }

  const sections = alertData.map(({ location, items, submittedAtSeconds }) => {
    const rows = items.map(({ label, value, category }) => {
      const isRed = category === "red";
      const borderColor = isRed ? "#dc2626" : "#d97706";
      const bgColor     = isRed ? "#fef2f2"  : "#fffbeb";
      const textColor   = isRed ? "#7f1d1d"  : "#78350f";
      return `
        <div style="border-left:4px solid ${borderColor};background:${bgColor};color:${textColor};padding:10px 14px;margin-bottom:8px;border-radius:0 6px 6px 0;">
          <strong>${label}</strong>: ${value}
        </div>`;
    }).join("");

    const submittedLabel = submittedAtSeconds
      ? (() => {
          const d = new Date(submittedAtSeconds * 1000);
          const days2 = ["søn","man","tir","ons","tor","fre","lør"];
          const pad = (n) => String(n).padStart(2, "0");
          return `${days2[d.getDay()]} ${d.getDate()}. kl. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        })()
      : null;

    return `
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:baseline;gap:10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:10px;">
          <h3 style="margin:0;font-size:1rem;color:#374151;">📍 ${location}</h3>
          ${submittedLabel ? `<span style="font-size:0.78rem;color:#9ca3af;">Siste skjema: <strong style="color:#374151;">${submittedLabel}</strong></span>` : ""}
        </div>
        ${rows}
      </div>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
      <h2 style="margin:0 0 4px;">🔴 Varebeholdning – ${dateStr}</h2>
      <p style="color:#6b7280;margin:0 0 24px;font-size:0.9rem;">
        Rød og oransje status per lokasjon, basert på siste stengeskjema.
        Rød er øverst per lokasjon.
      </p>
      ${sections}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;" />
      <p style="font-size:0.8rem;color:#9ca3af;margin:0;">
        Se full analyse på
        <a href="https://crust.no/skjema/stengeskjema/analyse" style="color:#1f2937;">crust.no/skjema/stengeskjema/analyse</a>
      </p>
    </div>`;
}

async function doSendInventoryAlert(testRecipient) {
  const days    = ["søndag","mandag","tirsdag","onsdag","torsdag","fredag","lørdag"];
  const months  = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
  const now     = new Date();
  const dateStr = `${days[now.getDay()]} ${now.getDate()}. ${months[now.getMonth()]} ${now.getFullYear()}`;

  const alertData = await buildInventoryAlertData();
  const html      = buildInventoryAlertEmailHtml(alertData, dateStr);
  const subject   = alertData.length > 0
    ? `Varebeholdning ${now.getDate()}. ${months[now.getMonth()]}: ${alertData.reduce((s, l) => s + l.items.filter(i => i.category === "red").length, 0)} røde, ${alertData.reduce((s, l) => s + l.items.filter(i => i.category === "orange").length, 0)} oransje`
    : `Varebeholdning ${now.getDate()}. ${months[now.getMonth()]}: Alt OK`;

  const toRecipients = testRecipient
    ? [{ emailAddress: { address: testRecipient } }]
    : INVENTORY_EMAIL_RECIPIENTS.map((a) => ({ emailAddress: { address: a } }));

  const token = await getAzureAccessToken();
  const res = await require("axios").post(
    `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
    {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients,
      },
      saveToSentItems: false,
    },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
  );

  if (res.status !== 202) throw new Error(`Graph API returned ${res.status}`);
  logger.info("Inventory alert email sent", { recipients: toRecipients.map(r => r.emailAddress.address), itemCount: alertData.length });
  return { sent: true, locationCount: alertData.length };
}

exports.sendInventoryAlertEmail = onCall(
  { region: "europe-west1", invoker: "public", secrets: AZURE_SECRETS_INVENTORY },
  async (req) => {
    const testRecipient = typeof req.data?.testRecipient === "string" ? req.data.testRecipient.trim() : null;
    return doSendInventoryAlert(testRecipient || null);
  },
);

// Toggle pause state for a location (worker PIN auth)
exports.toggleLocationPause = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const { workerPin, paused } = data || {};
    if (!workerPin) throw new HttpsError("invalid-argument", "workerPin required");

    const configRef = admin.firestore().doc("orderConfig/default");
    const snap = await configRef.get();
    const locSettings = snap.data()?.locationSettings || {};

    const matchedLocId = Object.entries(locSettings).find(
      ([, s]) => s.workerPin && String(s.workerPin) === String(workerPin)
    )?.[0];

    if (!matchedLocId) throw new HttpsError("permission-denied", "Invalid PIN");

    await configRef.update({
      [`locationSettings.${matchedLocId}.paused`]: Boolean(paused),
    });

    return { paused: Boolean(paused) };
  },
);

// Refund a paid/confirmed/ready order via Vipps (admin only)
exports.refundVippsOrder = onCall(
  {
    region:  "europe-west1",
    invoker: "public",
    secrets: ["VIPPS_CLIENT_ID", "VIPPS_CLIENT_SECRET", "VIPPS_SUBSCRIPTION_KEY", "VIPPS_MSN"],
  },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) {
      throw new HttpsError("permission-denied", "Admin access required");
    }

    const { orderId } = data || {};
    if (!orderId) throw new HttpsError("invalid-argument", "orderId required");

    const orderRef = admin.firestore().doc(`orders/${orderId}`);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found");

    const order = snap.data();
    const refundableStatuses = ["paid", "confirmed", "ready"];
    if (!refundableStatuses.includes(order.status)) {
      throw new HttpsError("failed-precondition", `Cannot refund order with status: ${order.status}`);
    }

    const axios = require("axios");
    const token = await getVippsToken();
    await axios.post(
      `${VIPPS_API}/ecomm/v2/payments/${orderId}/refund`,
      {
        merchantInfo: { merchantSerialNumber: process.env.VIPPS_MSN },
        transaction: {
          amount: Math.round((order.total || 0) * 100),
          transactionText: "Refusjon fra Crust n' Trust",
        },
      },
      { headers: vippsHeaders(token, `refund-${orderId}`) },
    );

    await orderRef.update({
      status:     "refunded",
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      refundedBy: auth.token.email,
    });

    logger.info("Order refunded", { orderId, by: auth.token.email });
    return { refunded: true };
  },
);

exports.scheduledInventoryAlert = onSchedule(
  {
    schedule: "0 8 * * *",
    region: "europe-west1",
    timeZone: "Europe/Oslo",
    secrets: AZURE_SECRETS_INVENTORY,
  },
  async () => {
    await doSendInventoryAlert(null);
  },
);
