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
  const reviewerLabel = isTest ? "TEST" : (reviewedBy || null);
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

  const needsConfirm = (neutralCount > 0 || sadCount > 0 || Boolean(generalFeedback)) && reviewUrl;
  const confirmBlock = needsConfirm ? `
    <div style="margin:20px 0 0;padding:16px 20px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
      <p style="margin:0 0 12px;font-size:14px;color:#78350f;line-height:1.5;">Du har fått en eller flere tilbakemeldinger. Bekreft at du har lest dem.</p>
      <a href="${reviewUrl}" style="display:block;width:100%;box-sizing:border-box;padding:12px 20px;background:#d97706;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;text-align:center;">Bekreft at du har lest tilbakemeldingen →</a>
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
        ${confirmBlock}
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
    const { locationId, locationName, items, total, customerPhone, customerName, customerNote } = data || {};
    if (!locationId || !Array.isArray(items) || items.length === 0 || !customerPhone || !customerName) {
      throw new HttpsError("invalid-argument", "Missing required order fields");
    }

    const smsPhone = formatPhoneForSms(customerPhone);
    const noteValue = typeof customerNote === "string" && customerNote.trim() ? customerNote.trim() : null;

    const orderRef = await admin.firestore().collection("orders").add({
      locationId,
      locationName,
      items,
      total: Number(total) || 0,
      customerPhone: smsPhone,
      customerName,
      ...(noteValue ? { customerNote: noteValue } : {}),
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
      return { status: order.status, customerName: order.customerName, customerPhone: order.customerPhone, total: order.total, locationId: order.locationId, locationName: order.locationName, items: order.items || [], orderId };
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
        return { status: "paid", customerName: order.customerName, customerPhone: order.customerPhone, total: order.total, locationId: order.locationId, locationName: order.locationName, items: order.items || [], orderId };
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
    const phone    = String(order.customerPhone || "").trim();
    const template = config.smsTexts?.ready || SMS_DEFAULTS.ready;

    if (phone) {
      await sendElksSms(
        phone,
        renderSmsTemplate(template, { name, location: order.locationName || "" }),
      );
    }

    await orderRef.update({
      status:          "ready",
      readyAt:         admin.firestore.FieldValue.serverTimestamp(),
      feedbackSmsSent: !phone,
    });

    return { sent: Boolean(phone) };
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

  // Load stengeskjema form definition, active locations, and manual edits in parallel
  const [formsSnap, locationsSnap, inventoryUpdatesSnap] = await Promise.all([
    db.collection("forms").where("slug", "==", "stengeskjema").limit(1).get(),
    db.collection("locations").get(),
    db.collection("inventoryUpdates").where("formSlug", "==", "stengeskjema").get(),
  ]);
  if (formsSnap.empty) throw new Error("stengeskjema form not found");

  const activeLocationNames = new Set(
    locationsSnap.docs
      .map((d) => String(d.data().name || "").trim())
      .filter(Boolean),
  );

  // Build map of manual inventory edits per location
  const inventoryUpdatesByLocation = new Map();
  inventoryUpdatesSnap.forEach((d) => {
    const data = d.data();
    if (data.location) {
      inventoryUpdatesByLocation.set(String(data.location).trim(), {
        answers: data.answers || {},
        answerLogs: data.answerLogs || {},
        updatedAt: data.updatedAt?.toDate?.() || null,
      });
    }
  });

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

    const manualUpdate = inventoryUpdatesByLocation.get(location);
    const submissionDate = submission.submittedAt?.toDate?.()
      || (submission.submittedAt?.seconds ? new Date(submission.submittedAt.seconds * 1000) : null);

    for (const question of analysisQuestions) {
      if (question.excludeFromLocationStatus) continue;
      // Skip if a refill/ordered action already exists
      const action = submission.analysisActions?.[question.id];
      const actionType = String(action?.type || "").toLowerCase();
      if (actionType === "refill" || actionType === "ordered") continue;

      const submissionValue = String(submission.answers?.[question.id] || "").trim();
      const manualValue = String(manualUpdate?.answers?.[question.id] || "").trim();

      // Use per-answer log timestamp if available, fall back to doc-level updatedAt
      const answerLog = manualUpdate?.answerLogs?.[question.id];
      const manualTs = answerLog?.[0]?.updatedAt
        ? new Date(answerLog[0].updatedAt)
        : (manualUpdate?.updatedAt || null);

      // Use manual edit only if it exists and is newer than the latest submission
      const manualIsNewer = manualValue && manualTs
        ? (submissionDate ? manualTs > submissionDate : true)
        : false;

      const value = manualIsNewer ? manualValue : submissionValue;
      const adminEdited = manualIsNewer;
      if (!value) continue;

      const category = getSelectOptionHistoryCategory(question, value);
      const label = (question.analysisLabel || question.label || question.id).trim();
      const item = { label, value, category, adminEdited };

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
    const rows = items.map(({ label, value, category, adminEdited }) => {
      const isRed = category === "red";
      const borderColor = isRed ? "#dc2626" : "#d97706";
      const bgColor     = isRed ? "#fef2f2"  : "#fffbeb";
      const labelColor  = isRed ? "#7f1d1d" : "#78350f";
      const valueColor  = adminEdited ? "#1d4ed8" : labelColor;
      return `
        <div style="border-left:4px solid ${borderColor};background:${bgColor};padding:10px 14px;margin-bottom:8px;border-radius:0 6px 6px 0;">
          <strong style="color:${labelColor};">${label}</strong><span style="color:${valueColor};">: ${value}</span>
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
        <div style="border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:10px;">
          <h3 style="margin:0;font-size:1rem;color:#374151;">📍 ${location}</h3>
          ${submittedLabel ? `<span style="display:block;margin-top:4px;font-size:0.78rem;color:#9ca3af;">Siste skjema: <strong style="color:#374151;">${submittedLabel}</strong></span>` : ""}
        </div>
        ${rows}
      </div>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
      <h2 style="margin:0 0 4px;">Varebeholdning – ${dateStr}</h2>
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
  const html = buildInventoryAlertEmailHtml(alertData, dateStr);
  const subject = alertData.length > 0
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

// Confirm that staff has read their feedback on a reviewed closing form
exports.confirmFeedbackRead = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const db = admin.firestore();
    const { receiptToken } = data || {};
    if (!receiptToken || typeof receiptToken !== "string") {
      throw new HttpsError("invalid-argument", "receiptToken required");
    }
    const receiptSnap = await db.collection("formSubmissionReceipts").doc(receiptToken).get();
    if (!receiptSnap.exists) throw new HttpsError("not-found", "Receipt not found");
    const { submissionId } = receiptSnap.data() || {};
    if (!submissionId) throw new HttpsError("failed-precondition", "Receipt has no submissionId");
    const now = admin.firestore.FieldValue.serverTimestamp();
    await Promise.all([
      db.collection("formSubmissions").doc(submissionId).update({
        feedbackReadConfirmed: true,
        feedbackReadAt: now,
      }),
      db.collection("formSubmissionReceipts").doc(receiptToken).update({
        feedbackReadConfirmed: true,
      }),
    ]);
    return { confirmed: true };
  },
);

// Return review data for a receipt (bypasses auth since receipt token is the secret)
exports.getReceiptReviewData = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const db = admin.firestore();
    const { receiptToken } = data || {};
    if (!receiptToken || typeof receiptToken !== "string") {
      throw new HttpsError("invalid-argument", "receiptToken required");
    }
    const receiptSnap = await db.collection("formSubmissionReceipts").doc(receiptToken).get();
    if (!receiptSnap.exists) return null;
    const { submissionId } = receiptSnap.data() || {};
    if (!submissionId) return null;
    const subSnap = await db.collection("formSubmissions").doc(submissionId).get();
    if (!subSnap.exists) return null;
    const sub = subSnap.data();
    return {
      status: sub.status || null,
      rejected: sub.rejected || false,
      reviewScoreSummary: sub.reviewScoreSummary || null,
      generalFeedback: sub.generalFeedback || null,
      feedbackReadConfirmed: sub.feedbackReadConfirmed || false,
    };
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

// ── Bestilling email notifications ───────────────────────────────────────────

const BESTILLING_RECIPIENTS = ["event@crust.no", "brandon@crust.no", "magnus@crust.no"];
const MIN_ADVANCE_DAYS = 3;

function isDeliveryDateValid(dateStr) {
  if (!dateStr) return false;
  const deliveryDate = new Date(dateStr);
  if (isNaN(deliveryDate.getTime())) return false;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + MIN_ADVANCE_DAYS);
  minDate.setHours(0, 0, 0, 0);
  return deliveryDate >= minDate;
}

async function sendBestillingEmail(subject, html, toAddresses) {
  const axios = require("axios");
  const token = await getAzureAccessToken();
  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
    {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: toAddresses.map((a) => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: false,
    },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
  );
}

function cateringInternalHtml(d) {
  const row = (label, val) => val ? `<tr><td style="padding:6px 0;font-weight:700;width:130px;">${label}</td><td style="padding:6px 0;">${val}</td></tr>` : "";
  return `<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 14px">Ny cateringforespørsel</h2>
    <table style="width:100%;border-collapse:collapse;">
      ${row("Navn", d.name)}${row("Telefon", d.phone)}${row("E-post", d.email)}
      ${row("Adresse", d.address)}${row("Type", d.cateringType)}${row("Dato", d.date)}
      ${row("Kommentar", d.comments)}
    </table>
    <p style="margin-top:20px;color:#6b7280;font-size:13px">— Crust bestillingssystem</p>
  </body></html>`;
}

function cateringConfirmHtml(d) {
  return `<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 14px">Takk for din forespørsel!</h2>
    <p>Hei ${d.name || ""},</p>
    <p>Vi har mottatt din cateringforespørsel for <strong>${d.date || "ønsket dato"}</strong>.</p>
    <p>Vi tar kontakt med deg snart for å bekrefte detaljer.</p>
    <p style="margin-top:20px;color:#6b7280;font-size:13px">— Crust n' Trust</p>
  </body></html>`;
}

function largeOrderInternalHtml(d) {
  const snap = d.priceSnapshot || {};
  const row = (label, val) => val ? `<tr><td style="padding:6px 0;font-weight:700;width:130px;">${label}</td><td style="padding:6px 0;">${val}</td></tr>` : "";
  return `<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 14px">Ny storbestilling</h2>
    <table style="width:100%;border-collapse:collapse;">
      ${row("Navn", d.name)}${row("Telefon", d.phone)}${row("E-post", d.email)}${row("Adresse", d.address)}
      ${row("Pizzaer", `${d.pizzaQuantity || 0} stk`)}${row("Brus", `${d.sodaQuantity || 0} stk`)}
      ${row("Dressinger", `${d.dressingQuantity || 0} stk`)}${row("Levering", d.deliveryDate)}
      ${row("Estimert pris", snap.estimatedTotal ? `${snap.estimatedTotal.toLocaleString("nb-NO")} kr` : "—")}
      ${row("Leveringskomm.", d.deliveryComments)}${row("Utvalgsønsker", d.selectionComments)}
    </table>
    <p style="margin-top:20px;color:#6b7280;font-size:13px">— Crust bestillingssystem</p>
  </body></html>`;
}

function largeOrderConfirmHtml(d) {
  const snap = d.priceSnapshot || {};
  return `<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 14px">Takk for din bestilling!</h2>
    <p>Hei ${d.name || ""},</p>
    <p>Vi har mottatt din storbestilling:</p>
    <ul>
      <li>${d.pizzaQuantity || 0} pizzaer</li>
      ${d.sodaQuantity ? `<li>${d.sodaQuantity} brus</li>` : ""}
      ${d.dressingQuantity ? `<li>${d.dressingQuantity} dressinger</li>` : ""}
    </ul>
    ${snap.estimatedTotal ? `<p><strong>Estimert pris: ${snap.estimatedTotal.toLocaleString("nb-NO")} kr</strong></p>` : ""}
    <p>Vi kontakter deg for å bekrefte detaljer og endelig pris.</p>
    <p style="margin-top:20px;color:#6b7280;font-size:13px">— Crust n' Trust</p>
  </body></html>`;
}

exports.sendCateringNotification = onCall(
  { region: "europe-west1", invoker: "public", secrets: ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"] },
  async ({ data }) => {
    if (!data?.email || !data?.name) throw new HttpsError("invalid-argument", "email and name required");
    if (!isDeliveryDateValid(data.date)) throw new HttpsError("invalid-argument", "Leveringsdato må være minst 3 dager frem i tid");
    const result = { internalSent: false, confirmSent: false };
    try {
      await sendBestillingEmail(`Ny cateringforespørsel: ${data.name}`, cateringInternalHtml(data), BESTILLING_RECIPIENTS);
      result.internalSent = true;
      logger.info("Catering internal email sent", { name: data.name, recipients: BESTILLING_RECIPIENTS });
    } catch (e) {
      logger.error("Catering internal email failed", { error: e?.message, status: e?.response?.status, name: data.name });
    }
    try {
      await sendBestillingEmail("Vi har mottatt din cateringforespørsel — Crust n' Trust", cateringConfirmHtml(data), [data.email]);
      result.confirmSent = true;
      logger.info("Catering confirmation email sent", { to: data.email });
    } catch (e) {
      logger.error("Catering confirm email failed", { error: e?.message, status: e?.response?.status, to: data.email });
    }
    if (!result.internalSent && !result.confirmSent) {
      throw new HttpsError("internal", "Failed to send notification emails");
    }
    return result;
  },
);

exports.sendLargeOrderNotification = onCall(
  { region: "europe-west1", invoker: "public", secrets: ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"] },
  async ({ data }) => {
    if (!data?.email || !data?.name) throw new HttpsError("invalid-argument", "email and name required");
    if (!isDeliveryDateValid(data.deliveryDate)) throw new HttpsError("invalid-argument", "Leveringsdato må være minst 3 dager frem i tid");
    const result = { internalSent: false, confirmSent: false };
    try {
      await sendBestillingEmail(`Ny storbestilling: ${data.name} (${data.pizzaQuantity || 0} pizzaer)`, largeOrderInternalHtml(data), BESTILLING_RECIPIENTS);
      result.internalSent = true;
      logger.info("Large order internal email sent", { name: data.name, recipients: BESTILLING_RECIPIENTS });
    } catch (e) {
      logger.error("Large order internal email failed", { error: e?.message, status: e?.response?.status, name: data.name });
    }
    try {
      await sendBestillingEmail("Vi har mottatt din storbestilling — Crust n' Trust", largeOrderConfirmHtml(data), [data.email]);
      result.confirmSent = true;
      logger.info("Large order confirmation email sent", { to: data.email });
    } catch (e) {
      logger.error("Large order confirm email failed", { error: e?.message, status: e?.response?.status, to: data.email });
    }
    if (!result.internalSent && !result.confirmSent) {
      throw new HttpsError("internal", "Failed to send notification emails");
    }
    return result;
  },
);

// ── Bonus system ──────────────────────────────────────────────────────────────

const BONUS_HOURLY_RATE = 166.34;
// OPA model: revenue above threshold × bonus_rate → pool split proportionally by hours
const BONUS_THRESHOLD_RATE = 400; // kr per employee-hour (normal expected revenue)
const BONUS_RATE = 0.15;          // legacy fallback rate

// Tiered pool rate: 0% below baseRevenue, then baseRatePct + steps * stepRatePct
function tieredPoolRate(revenue, baseRevenue, baseRatePct, stepKr, stepRatePct) {
  const rev = Number(revenue), base = Number(baseRevenue) || 20000;
  const rate = Number(baseRatePct) || 20, step = Number(stepKr) || 10000, inc = Number(stepRatePct) || 5;
  if (rev < base) return 0;
  const steps = Math.floor((rev - base) / Math.max(step, 1));
  return rate + steps * inc;
}

function bonusPool(revenue, totalHours) {
  const surplus = Number(revenue) - BONUS_THRESHOLD_RATE * totalHours;
  if (surplus <= 0) return 0;
  return surplus * BONUS_RATE;
}

function calcShiftBonuses(shifts, approvedRevenue, thresholdKr, bonusRate, nonBonusHours = 0) {
  const surplus = Number(approvedRevenue) - Number(thresholdKr);
  const pool = surplus > 0 ? surplus * bonusRate : 0;
  const bonusOnlyHours = shifts.reduce((s, sh) => s + (Number(sh.hoursWorked) || 0), 0);
  const totalHours = bonusOnlyHours + nonBonusHours;
  if (totalHours <= 0 || pool <= 0) return shifts.map(() => 0);
  return shifts.map((sh) => Math.round((pool * (Number(sh.hoursWorked) || 0) / totalHours) * 100) / 100);
}

function normalizePhone(raw) {
  let p = String(raw || "").replace(/[\s\-().]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.length === 8 && /^\d+$/.test(p)) p = "47" + p;
  return p;
}

async function sendBonusEmailMsg(toEmail, name, date, startTime, endTime, hoursWorked, approvedRevenue, basePayKr, bonusKr, totalKr, hourlyRate) {
  const axios = require("axios");
  const accessToken = await getAzureAccessToken();
  const h = Math.floor(hoursWorked);
  const m = Math.round((hoursWorked - h) * 60);
  const months = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
  const [yr, mo, da] = (date || "").split("-");
  const dateStr = yr && mo && da ? `${parseInt(da)}. ${months[parseInt(mo) - 1]} ${yr}` : date;
  const fmt = (n) => Number(n).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rateDisplay = fmt(hourlyRate || BONUS_HOURLY_RATE);
  const html = `<!DOCTYPE html><html lang="no"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)"><div style="background:#1a3a2a;padding:28px 32px"><h1 style="color:#fff;margin:0;font-size:1.4rem">Crust n' Trust</h1><p style="color:#a8d5b5;margin:6px 0 0;font-size:.9rem">Bonusoppgjør</p></div><div style="padding:28px 32px"><p style="margin:0 0 6px;font-size:1rem;color:#222">Hei ${name}!</p><p style="margin:0 0 20px;color:#555;font-size:.9rem">Her er ditt bonusoppgjør for <strong>${dateStr}</strong>.</p><table style="width:100%;border-collapse:collapse;font-size:.9rem"><tr style="background:#f9f9f9"><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#555">Vakt</td><td style="padding:9px 12px;border:1px solid #e5e5e5;font-weight:600;text-align:right">${startTime}–${endTime} (${h}t ${m}min)</td></tr><tr><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#555">Omsetning</td><td style="padding:9px 12px;border:1px solid #e5e5e5;font-weight:600;text-align:right">${fmt(approvedRevenue)} kr</td></tr><tr style="background:#f9f9f9"><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#555">Timelønn (${rateDisplay} kr/t)</td><td style="padding:9px 12px;border:1px solid #e5e5e5;text-align:right">${fmt(basePayKr)} kr</td></tr><tr><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#555">Omsetningsbonus</td><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#16a34a;font-weight:700;text-align:right">+ ${fmt(bonusKr)} kr</td></tr><tr style="background:#f0fdf4"><td style="padding:11px 12px;border:1px solid #bbf7d0;font-weight:700;color:#222">Totalsum</td><td style="padding:11px 12px;border:1px solid #bbf7d0;font-weight:700;font-size:1.05rem;color:#16a34a;text-align:right">${fmt(totalKr)} kr</td></tr></table><p style="margin:20px 0 0;color:#888;font-size:.8rem">Spørsmål? Kontakt Crust n' Trust admin.</p></div></div></body></html>`;
  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
    {
      message: {
        subject: `Bonusoppgjør ${dateStr}`,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: toEmail } }],
        ccRecipients: REVIEW_EMAIL_CC
          .filter((e) => e.toLowerCase() !== toEmail.toLowerCase())
          .map((e) => ({ emailAddress: { address: e } })),
      },
      saveToSentItems: false,
    },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
  );
}

exports.sendBonusOtp = onCall(
  { region: "europe-west1", invoker: "public", secrets: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"] },
  async ({ data }) => {
    const phone = normalizePhone(data?.phone);
    if (!phone || !/^\d{10,15}$/.test(phone)) throw new HttpsError("invalid-argument", "Ugyldig telefonnummer");
    const db = admin.firestore();
    const accessDoc = await db.doc(`bonusAccess/${phone}`).get();
    if (!accessDoc.exists) throw new HttpsError("permission-denied", "Dette nummeret har ikke tilgang til bonussystemet");
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
    await db.doc(`bonusOtp/${phone}`).set({ code, expiresAt, attempts: 0 });
    await sendElksSms(`+${phone}`, `Din kode for Crust Bonus er: ${code}. Gyldig i 10 minutter.`);
    return { sent: true };
  },
);

exports.verifyBonusOtp = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const phone = normalizePhone(data?.phone);
    const code = String(data?.code || "").trim();
    if (!phone || !code) throw new HttpsError("invalid-argument", "Mangler telefon eller kode");
    const db = admin.firestore();
    const otpRef = db.doc(`bonusOtp/${phone}`);
    const otpDoc = await otpRef.get();
    if (!otpDoc.exists) throw new HttpsError("not-found", "Ingen kode funnet. Send en ny kode.");
    const otp = otpDoc.data();
    if (otp.attempts >= 5) throw new HttpsError("resource-exhausted", "For mange forsøk. Send en ny kode.");
    await otpRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
    if (otp.expiresAt.toMillis() < Date.now()) throw new HttpsError("deadline-exceeded", "Koden er utløpt. Send en ny kode.");
    if (otp.code !== code) throw new HttpsError("unauthenticated", "Feil kode. Prøv igjen.");
    await otpRef.delete();
    const accessSnap = await db.doc(`bonusAccess/${phone}`).get();
    const { name = "", email = "" } = accessSnap.data() || {};
    const crypto = require("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    await db.doc(`bonusSessions/${token}`).set({
      phone,
      name,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 365 * 24 * 3600 * 1000),
    });
    return { token, name, phone };
  },
);

async function sendBonusApprovalRequestEmail(date, participantNames) {
  const axios = require("axios");
  const accessToken = await getAzureAccessToken();
  const months = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
  const [yr, mo, da] = (date || "").split("-");
  const dateStr = yr && mo && da ? `${parseInt(da)}. ${months[parseInt(mo) - 1]} ${yr}` : date;
  const names = participantNames.join(", ");
  const html = `<!DOCTYPE html><html lang="no"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)"><div style="background:#1a3a2a;padding:28px 32px"><h1 style="color:#fff;margin:0;font-size:1.4rem">Crust n' Trust</h1><p style="color:#a8d5b5;margin:6px 0 0;font-size:.9rem">Bonusgodkjenning</p></div><div style="padding:28px 32px"><p style="margin:0 0 16px;font-size:1rem;color:#222">Ny bonusregistrering venter på godkjenning.</p><table style="width:100%;border-collapse:collapse;font-size:.9rem"><tr style="background:#f9f9f9"><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#555">Dato</td><td style="padding:9px 12px;border:1px solid #e5e5e5;font-weight:600">${dateStr}</td></tr><tr><td style="padding:9px 12px;border:1px solid #e5e5e5;color:#555">Ansatte</td><td style="padding:9px 12px;border:1px solid #e5e5e5;font-weight:600">${names}</td></tr></table><p style="margin:20px 0 0;color:#888;font-size:.85rem">Logg inn på bonus admin for å godkjenne.</p></div></div></body></html>`;
  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
    {
      message: {
        subject: `Bonusgodkjenning kreves – ${dateStr}`,
        body: { contentType: "HTML", content: html },
        toRecipients: REVIEW_EMAIL_CC.map((e) => ({ emailAddress: { address: e } })),
      },
      saveToSentItems: false,
    },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
  );
}

async function sendBonusReversalEmail(toEmail, name, date) {
  const axios = require("axios");
  const accessToken = await getAzureAccessToken();
  const months = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
  const [yr, mo, da] = (date || "").split("-");
  const dateStr = yr && mo && da ? `${parseInt(da)}. ${months[parseInt(mo) - 1]} ${yr}` : date;
  const html = `<!DOCTYPE html><html lang="no"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)"><div style="background:#1a3a2a;padding:28px 32px"><h1 style="color:#fff;margin:0;font-size:1.4rem">Crust n' Trust</h1><p style="color:#a8d5b5;margin:6px 0 0;font-size:.9rem">Bonusgodkjenning reversert</p></div><div style="padding:28px 32px"><p style="margin:0 0 16px;font-size:1rem;color:#222">Hei ${name},</p><p style="margin:0 0 16px;color:#444">Den godkjente bonusen din for <strong>${dateStr}</strong> er blitt reversert av en administrator. Ta kontakt med ledelsen for mer informasjon.</p></div></div></body></html>`;
  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
    { message: { subject: `Bonus reversert – ${dateStr}`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: toEmail } }], ccRecipients: [{ emailAddress: { address: "magnus@crust.no" } }] }, saveToSentItems: false },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
  );
}

exports.setNonBonusWorkers = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { dayId, workers } = data || {};
    if (!dayId) throw new HttpsError("invalid-argument", "Mangler dag-ID");
    const validated = (workers || []).map((w) => {
      const name = String(w.name || "").trim();
      let hours = Math.max(0, Number(w.hours) || 0);
      const startTime = String(w.startTime || "");
      const endTime = String(w.endTime || "");
      if (startTime && endTime) {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        let h = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
        if (h <= 0) h += 24;
        hours = Math.round(h * 100) / 100;
      }
      return { name, startTime, endTime, hours, hourlyRate: 0 };
    }).filter((w) => w.name && w.hours > 0);
    const db = admin.firestore();
    await db.doc(`bonusDays/${dayId}`).update({ nonBonusWorkers: validated });
    return { saved: true };
  },
);

exports.unapproveDay = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { dayId } = data || {};
    if (!dayId) throw new HttpsError("invalid-argument", "Mangler dag-ID");
    const db = admin.firestore();
    const dayDoc = await db.doc(`bonusDays/${dayId}`).get();
    if (!dayDoc.exists) throw new HttpsError("not-found", "Dag ikke funnet");
    if (dayDoc.data().status !== "approved") throw new HttpsError("failed-precondition", "Dag er ikke godkjent");
    const shiftsSnap = await db.collection("bonusShifts").where("dayId", "==", dayId).get();
    const batch = db.batch();
    batch.update(db.doc(`bonusDays/${dayId}`), {
      status: "pending_approval",
      approvedAt: null,
      approvedBy: null,
      approvedRevenue: null,
      approvedThresholdKr: null,
      approvedBonusRatePct: null,
    });
    shiftsSnap.docs.forEach((d) => {
      batch.update(d.ref, { status: "submitted", bonusKr: null, basePayKr: null, hourlyRateUsed: null, approvedAt: null, approvedBy: null, emailSent: false });
    });
    await batch.commit();
    return { unapproved: true };
  },
);

exports.createOrJoinBonusDay = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const { sessionToken, date, startTime, endTime, revenueKr } = data || {};
    if (!sessionToken || !date || !startTime || !endTime) {
      throw new HttpsError("invalid-argument", "Mangler påkrevde felt");
    }
    const db = admin.firestore();
    const sessionDoc = await db.doc(`bonusSessions/${sessionToken}`).get();
    if (!sessionDoc.exists || sessionDoc.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("unauthenticated", "Ugyldig eller utløpt økt. Logg inn på nytt.");
    }
    const { phone, name, email } = sessionDoc.data();

    // multiple shifts per employee per day are allowed

    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let hoursWorked = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    if (hoursWorked <= 0) hoursWorked += 24;
    hoursWorked = Math.round(hoursWorked * 100) / 100;
    if (hoursWorked > 16 || hoursWorked < 0.5) throw new HttpsError("invalid-argument", "Ugyldig vaktlengde.");

    const daySnap = await db.collection("bonusDays").where("date", "==", date).get();
    const openDayDoc = daySnap.docs.find((d) => d.data().status === "open");

    let dayId;
    let dayRevenueKr;

    if (openDayDoc) {
      dayId = openDayDoc.id;
      const update = { participantPhones: admin.firestore.FieldValue.arrayUnion(phone) };
      if (revenueKr != null) {
        const newRev = Number(revenueKr);
        if (Number.isFinite(newRev) && newRev >= 0 && newRev !== openDayDoc.data().revenueKr) {
          update.revenueKr = newRev;
          dayRevenueKr = newRev;
        } else {
          dayRevenueKr = openDayDoc.data().revenueKr;
        }
      } else {
        dayRevenueKr = openDayDoc.data().revenueKr;
      }
      await db.doc(`bonusDays/${dayId}`).update(update);
    } else {
      if (revenueKr == null) throw new HttpsError("invalid-argument", "Omsetning er påkrevd");
      const rev = Number(revenueKr);
      if (!Number.isFinite(rev) || rev < 0 || rev > 500000) throw new HttpsError("invalid-argument", "Ugyldig omsetning.");
      dayRevenueKr = rev;
      const deadlineMs = new Date(date + "T23:59:59+02:00").getTime() + 24 * 3600 * 1000;
      if (Date.now() > deadlineMs) throw new HttpsError("deadline-exceeded", "Fristen for registrering er 24 timer etter vakten.");
      if (new Date(date + "T00:00:00").getTime() > Date.now() + 2 * 3600 * 1000) throw new HttpsError("invalid-argument", "Kan ikke registrere fremtidige vakter.");
      const dayRef = await db.collection("bonusDays").add({
        date,
        revenueKr: rev,
        status: "open",
        participantPhones: [phone],
        createdByPhone: phone,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        submittedForApprovalAt: null,
        submittedBy: null,
        approvedAt: null,
        approvedBy: null,
      });
      dayId = dayRef.id;
    }

    await db.collection("bonusShifts").add({
      dayId,
      phone,
      name,
      email: email || "",
      date,
      startTime,
      endTime,
      hoursWorked,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "submitted",
      bonusKr: null,
      basePayKr: null,
      adminStartTime: null,
      adminEndTime: null,
      adminHours: null,
      adminNote: "",
      approvedAt: null,
      approvedBy: null,
      emailSent: false,
    });

    const shiftsSnap = await db.collection("bonusShifts").where("dayId", "==", dayId).get();
    const participants = shiftsSnap.docs.map((d) => ({ name: d.data().name, phone: d.data().phone }));
    return { dayId, hoursWorked, dayRevenueKr, participants };
  },
);

exports.submitDayForApproval = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const { sessionToken, dayId } = data || {};
    if (!sessionToken || !dayId) throw new HttpsError("invalid-argument", "Mangler økt eller dag-ID");
    const db = admin.firestore();
    const sessionDoc = await db.doc(`bonusSessions/${sessionToken}`).get();
    if (!sessionDoc.exists || sessionDoc.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("unauthenticated", "Ugyldig eller utløpt økt. Logg inn på nytt.");
    }
    const { phone } = sessionDoc.data();
    const dayDoc = await db.doc(`bonusDays/${dayId}`).get();
    if (!dayDoc.exists) throw new HttpsError("not-found", "Dag ikke funnet");
    const day = dayDoc.data();
    if (day.status !== "open") throw new HttpsError("failed-precondition", "Denne dagen er allerede sendt for godkjenning");
    if (!(day.participantPhones || []).includes(phone)) throw new HttpsError("permission-denied", "Du er ikke del av denne gruppen");
    await db.doc(`bonusDays/${dayId}`).update({
      status: "pending_approval",
      submittedForApprovalAt: admin.firestore.FieldValue.serverTimestamp(),
      submittedBy: phone,
    });
    return { submitted: true };
  },
);

exports.deleteBonusShift = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    const db = admin.firestore();
    const { shiftId, sessionToken } = data || {};
    if (!shiftId) throw new HttpsError("invalid-argument", "Mangler vakt-ID");

    const shiftDoc = await db.doc(`bonusShifts/${shiftId}`).get();
    if (!shiftDoc.exists) throw new HttpsError("not-found", "Vakt ikke funnet");
    const shift = shiftDoc.data();

    const isAdmin = String(auth?.token?.email || "").endsWith("@crust.no");

    if (!isAdmin) {
      if (!sessionToken) throw new HttpsError("unauthenticated", "Logg inn på nytt");
      const sessionDoc = await db.doc(`bonusSessions/${sessionToken}`).get();
      if (!sessionDoc.exists || sessionDoc.data().expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("unauthenticated", "Ugyldig eller utløpt økt");
      }
      if (shift.phone !== sessionDoc.data().phone) throw new HttpsError("permission-denied", "Du kan ikke slette andres vakt");
      const dayDoc = await db.doc(`bonusDays/${shift.dayId}`).get();
      if (dayDoc.exists && dayDoc.data().status !== "open") {
        throw new HttpsError("failed-precondition", "Kan ikke slette vakt etter innsending");
      }
    } else {
      if (shift.status === "approved") throw new HttpsError("failed-precondition", "Cannot delete an approved shift");
    }

    await db.doc(`bonusShifts/${shiftId}`).delete();
    await db.doc(`bonusDays/${shift.dayId}`).update({
      participantPhones: admin.firestore.FieldValue.arrayRemove(shift.phone),
    });
    const remaining = await db.collection("bonusShifts").where("dayId", "==", shift.dayId).get();
    if (remaining.empty) {
      await db.doc(`bonusDays/${shift.dayId}`).delete();
    }
    return { deleted: true };
  },
);

exports.getOpenDayForDate = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const { sessionToken, date } = data || {};
    if (!sessionToken || !date) return null;
    const db = admin.firestore();
    const sessionDoc = await db.doc(`bonusSessions/${sessionToken}`).get();
    if (!sessionDoc.exists || sessionDoc.data().expiresAt.toMillis() < Date.now()) return null;
    const { phone } = sessionDoc.data();
    const daySnap = await db.collection("bonusDays").where("date", "==", date).get();
    const openDayDoc = daySnap.docs.find((d) => d.data().status === "open");
    if (!openDayDoc) return null;
    const day = openDayDoc.data();
    const shiftsSnap = await db.collection("bonusShifts").where("dayId", "==", openDayDoc.id).get();
    const participants = shiftsSnap.docs.map((d) => ({ name: d.data().name, phone: d.data().phone }));
    return {
      dayId: openDayDoc.id,
      date: day.date,
      revenueKr: day.revenueKr,
      participants,
      hasJoined: false,
    };
  },
);

exports.getMyBonusShifts = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const { sessionToken } = data || {};
    if (!sessionToken) throw new HttpsError("unauthenticated", "Logg inn på nytt.");
    const db = admin.firestore();
    const sessionDoc = await db.doc(`bonusSessions/${sessionToken}`).get();
    if (!sessionDoc.exists || sessionDoc.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("unauthenticated", "Økten er utløpt. Logg inn på nytt.");
    }
    const { phone } = sessionDoc.data();
    const snaps = await db.collection("bonusShifts").where("phone", "==", phone).get();
    const dayIds = [...new Set(snaps.docs.map((d) => d.data().dayId).filter(Boolean))];
    const dayDocs = dayIds.length > 0
      ? await Promise.all(dayIds.map((id) => db.doc(`bonusDays/${id}`).get()))
      : [];
    const dayMap = {};
    dayDocs.forEach((d) => { if (d.exists) dayMap[d.id] = d.data(); });
    return snaps.docs
      .map((d) => {
        const raw = d.data();
        const day = dayMap[raw.dayId] || null;
        return {
          id: d.id,
          ...raw,
          submittedAt: raw.submittedAt?.toMillis() || null,
          approvedAt: raw.approvedAt?.toMillis() || null,
          dayStatus: day?.status || null,
          dayRevenueKr: day?.revenueKr || null,
        };
      })
      .sort((a, b) => (b.date > a.date ? 1 : -1))
      .slice(0, 30);
  },
);

exports.approveBonusDay = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { dayId, shiftUpdates, approvedRevenue, thresholdKr, bonusRatePct } = data || {};
    if (!dayId || !Array.isArray(shiftUpdates) || !shiftUpdates.length || approvedRevenue == null) {
      throw new HttpsError("invalid-argument", "Mangler dag-ID, vakter eller omsetning");
    }
    const db = admin.firestore();
    const dayDoc = await db.doc(`bonusDays/${dayId}`).get();
    if (!dayDoc.exists) throw new HttpsError("not-found", "Dag ikke funnet");
    const dayData = dayDoc.data();
    const docs = await Promise.all(shiftUpdates.map((u) => db.doc(`bonusShifts/${u.id}`).get()));
    const shifts = docs.map((doc, i) => {
      if (!doc.exists) throw new HttpsError("not-found", `Vakt ikke funnet: ${shiftUpdates[i].id}`);
      const u = shiftUpdates[i];
      const hoursWorked = u.hoursWorked != null ? Number(u.hoursWorked) : doc.data().hoursWorked;
      return { id: doc.id, ...doc.data(), hoursWorked, _update: u };
    });
    // Load per-employee hourly rates
    const accessDocs = await Promise.all(shifts.map((s) => db.doc(`bonusAccess/${s.phone}`).get()));
    const rateMap = {};
    accessDocs.forEach((d, i) => {
      rateMap[shifts[i].phone] = d.exists ? Number(d.data().hourlyRate || BONUS_HOURLY_RATE) : BONUS_HOURLY_RATE;
    });
    // Non-bonus workers (loaded from day doc)
    const nonBonusWorkers = dayData.nonBonusWorkers || [];
    const nonBonusThresholdContrib = nonBonusWorkers.reduce((sum, w) => sum + w.hours * w.hourlyRate, 0);
    const nonBonusTotalHours = nonBonusWorkers.reduce((sum, w) => sum + w.hours, 0);
    // Threshold: admin override or auto-calculated from actual wages (including non-bonus workers)
    const autoThreshold = shifts.reduce((sum, sh) => sum + sh.hoursWorked * (rateMap[sh.phone] || BONUS_HOURLY_RATE), 0) + nonBonusThresholdContrib;
    const effectiveThreshold = thresholdKr != null ? Number(thresholdKr) : autoThreshold;
    let effectiveRate;
    if (bonusRatePct != null) {
      effectiveRate = Number(bonusRatePct) / 100;
    } else {
      const cfgDoc = await db.doc('siteSettings/bonusConfig').get();
      const cfg = cfgDoc.exists ? cfgDoc.data() : {};
      const autoRatePct = tieredPoolRate(approvedRevenue, cfg.poolBaseRevenue, cfg.poolBaseRatePct, cfg.poolStepKr, cfg.poolStepRatePct);
      effectiveRate = autoRatePct / 100;
    }
    const bonuses = calcShiftBonuses(shifts, approvedRevenue, effectiveThreshold, effectiveRate, nonBonusTotalHours);
    const totalPoolHours = shifts.reduce((s, sh) => {
      const u = sh._update;
      return s + (u.hoursWorked != null ? Number(u.hoursWorked) : sh.hoursWorked);
    }, 0) + nonBonusTotalHours;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    shifts.forEach((shift, i) => {
      const u = shift._update;
      const hoursWorked = u.hoursWorked != null ? Number(u.hoursWorked) : shift.hoursWorked;
      const empRate = rateMap[shift.phone] || BONUS_HOURLY_RATE;
      batch.update(db.doc(`bonusShifts/${shift.id}`), {
        status: "approved",
        adminStartTime: u.startTime || null,
        adminEndTime: u.endTime || null,
        adminHours: u.hoursWorked != null ? Number(u.hoursWorked) : null,
        adminNote: u.adminNote || "",
        hoursWorked,
        bonusKr: Math.round(bonuses[i] * 100) / 100,
        basePayKr: Math.round(hoursWorked * empRate * 100) / 100,
        hourlyRateUsed: empRate,
        totalPoolHours: Math.round(totalPoolHours * 100) / 100,
        approvedAt: now,
        approvedBy: auth.token.email,
      });
    });
    batch.update(db.doc(`bonusDays/${dayId}`), {
      status: "approved",
      approvedRevenue: Number(approvedRevenue),
      approvedThresholdKr: effectiveThreshold,
      approvedBonusRatePct: effectiveRate * 100,
      approvedNonBonusWorkers: nonBonusWorkers,
      approvedAt: now,
      approvedBy: auth.token.email,
    });
    await batch.commit();
    return { approved: true };
  },
);

exports.resendBonusEmail = onCall(
  { region: "europe-west1", invoker: "public", secrets: ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"] },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { shiftId } = data || {};
    if (!shiftId) throw new HttpsError("invalid-argument", "shiftId required");
    const db = admin.firestore();
    const doc = await db.doc(`bonusShifts/${shiftId}`).get();
    if (!doc.exists) throw new HttpsError("not-found", "Vakt ikke funnet");
    const s = doc.data();
    if (s.status !== "approved") throw new HttpsError("failed-precondition", "Vakten er ikke godkjent");
    if (!s.email) throw new HttpsError("failed-precondition", "Ingen e-postadresse");
    const dayDoc = await db.doc(`bonusDays/${s.dayId}`).get();
    const approvedRevenue = dayDoc.exists ? (dayDoc.data().approvedRevenue || dayDoc.data().revenueKr || 0) : 0;
    const start = s.adminStartTime || s.startTime;
    const end = s.adminEndTime || s.endTime;
    const total = Math.round(((s.basePayKr || 0) + (s.bonusKr || 0)) * 100) / 100;
    await sendBonusEmailMsg(s.email, s.name, s.date, start, end, s.hoursWorked, approvedRevenue, s.basePayKr || 0, s.bonusKr || 0, total, s.hourlyRateUsed || BONUS_HOURLY_RATE);
    await db.doc(`bonusShifts/${shiftId}`).update({ emailSent: true });
    return { sent: true };
  },
);

exports.rejectBonusDay = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { dayId, reason } = data || {};
    if (!dayId) throw new HttpsError("invalid-argument", "dayId required");
    const db = admin.firestore();
    const dayDoc = await db.doc(`bonusDays/${dayId}`).get();
    if (!dayDoc.exists) throw new HttpsError("not-found", "Day not found");
    const batch = db.batch();
    batch.update(db.doc(`bonusDays/${dayId}`), {
      status: "rejected",
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectedBy: auth.token.email,
      rejectionReason: reason || "",
    });
    const shiftsSnap = await db.collection("bonusShifts").where("dayId", "==", dayId).get();
    shiftsSnap.docs.forEach((d) => batch.update(d.ref, { status: "rejected" }));
    await batch.commit();
    return { rejected: true };
  },
);

exports.adminRegisterBonusShift = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { phone, date, startTime, endTime, revenueKr, nonBonusWorkers } = data || {};
    if (!phone || !date || !startTime || !endTime || revenueKr == null) {
      throw new HttpsError("invalid-argument", "Mangler påkrevde felt");
    }
    const db = admin.firestore();
    const normPhone = normalizePhone(phone);
    const accessDoc = await db.doc(`bonusAccess/${normPhone}`).get();
    if (!accessDoc.exists) throw new HttpsError("not-found", "Ansatt ikke funnet i bonussystemet");
    const { name = "", email = "" } = accessDoc.data();
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let hoursWorked = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    if (hoursWorked <= 0) hoursWorked += 24;
    hoursWorked = Math.round(hoursWorked * 100) / 100;
    if (hoursWorked > 16 || hoursWorked < 0.5) throw new HttpsError("invalid-argument", "Ugyldig vaktlengde.");
    const rev = Number(revenueKr);
    if (!Number.isFinite(rev) || rev < 0 || rev > 500000) throw new HttpsError("invalid-argument", "Ugyldig omsetning.");
    // multiple shifts per employee per day are allowed
    const daySnap = await db.collection("bonusDays").where("date", "==", date).get();
    const openDayDoc = daySnap.docs.find((d) => d.data().status === "open");
    let dayId;
    if (openDayDoc) {
      dayId = openDayDoc.id;
      await db.doc(`bonusDays/${dayId}`).update({
        participantPhones: admin.firestore.FieldValue.arrayUnion(normPhone),
      });
    } else {
      const dayRef = await db.collection("bonusDays").add({
        date,
        revenueKr: rev,
        status: "open",
        participantPhones: [normPhone],
        createdByPhone: normPhone,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        submittedForApprovalAt: null,
        submittedBy: null,
        approvedAt: null,
        approvedBy: null,
      });
      dayId = dayRef.id;
    }
    await db.collection("bonusShifts").add({
      dayId,
      phone: normPhone,
      name,
      email: email || "",
      date,
      startTime,
      endTime,
      hoursWorked,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "submitted",
      registeredByAdmin: auth.token.email,
      bonusKr: null,
      basePayKr: null,
      adminStartTime: null,
      adminEndTime: null,
      adminHours: null,
      adminNote: "",
      approvedAt: null,
      approvedBy: null,
      emailSent: false,
    });
    if (Array.isArray(nonBonusWorkers) && nonBonusWorkers.length > 0) {
      const cleaned = nonBonusWorkers.map(w => {
        const name = String(w.name || "").trim();
        const startTime = String(w.startTime || "");
        const endTime = String(w.endTime || "");
        let hours = Number(w.hours) || 0;
        if (startTime && endTime) {
          const [sh, sm] = startTime.split(":").map(Number);
          const [eh, em] = endTime.split(":").map(Number);
          let h = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
          if (h <= 0) h += 24;
          hours = Math.round(h * 100) / 100;
        }
        return { name, startTime, endTime, hours, hourlyRate: 0 };
      }).filter(w => w.name && w.hours > 0);
      if (cleaned.length > 0) {
        const existingSnap = await db.doc(`bonusDays/${dayId}`).get();
        const existing = existingSnap.data()?.nonBonusWorkers || [];
        const merged = [...existing];
        for (const w of cleaned) {
          if (!merged.find(e => e.name.toLowerCase() === w.name.toLowerCase())) merged.push(w);
        }
        await db.doc(`bonusDays/${dayId}`).update({ nonBonusWorkers: merged });
      }
    }
    return { submitted: true, hoursWorked, name };
  },
);

exports.adminCreateSimSession = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data, auth }) => {
    if (!String(auth?.token?.email || "").endsWith("@crust.no")) throw new HttpsError("permission-denied", "Admin required");
    const { phone } = data || {};
    if (!phone) throw new HttpsError("invalid-argument", "Mangler telefonnummer");
    const db = admin.firestore();
    const normPhone = normalizePhone(phone);
    const accessDoc = await db.doc(`bonusAccess/${normPhone}`).get();
    if (!accessDoc.exists) throw new HttpsError("not-found", "Ansatt ikke funnet");
    const { name, email } = accessDoc.data();
    const crypto = require("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour
    await db.doc(`bonusSessions/${token}`).set({
      phone: normPhone, name, email: email || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      simSession: true,
    });
    return { token, name, phone: normPhone };
  },
);

// ── Valg (employee choice system) ────────────────────────────────────────────

exports.sendValgInvites = onCall(
  { region: "europe-west1", invoker: "public", secrets: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD"] },
  async ({ data }) => {
    const { valgId, phones, smsTemplate } = data || {};
    if (!valgId || !Array.isArray(phones) || phones.length === 0)
      throw new HttpsError("invalid-argument", "Mangler valgId eller phones");
    const db = admin.firestore();
    const valgRef = db.doc(`valg/${valgId}`);
    const valgDoc = await valgRef.get();
    if (!valgDoc.exists) throw new HttpsError("not-found", "Valget finnes ikke");
    const valgData = valgDoc.data();
    const title = valgData.title || "Valg";
    const existingTokens = valgData.inviteTokens || {};
    const crypto = require("crypto");

    const normalized = phones.map(normalizePhone).filter((p) => /^\d{10,15}$/.test(p));
    if (normalized.length === 0) throw new HttpsError("invalid-argument", "Ingen gyldige telefonnumre");

    const batch = db.batch();
    const tokenMap = {};
    const smsTasks = [];

    for (const phone of normalized) {
      let token = existingTokens[phone];
      const isOldFormat = token && token.length > 12;
      if (!token || isOldFormat) {
        if (isOldFormat) batch.delete(db.doc(`valgInvites/${token}`));
        token = crypto.randomBytes(8).toString("base64url");
        batch.set(db.doc(`valgInvites/${token}`), {
          valgId,
          phone,
          openedAt: null,
          choice: null,
          choiceId: null,
          votedAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tokenMap[`inviteTokens.${phone}`] = token;
      }
      const url = `https://crust.no/v/${token}`;
      const defaultTemplate = `Hei! Du er invitert til å gjøre et valg for Crust n' Trust: "${title}". Klikk her: {link}`;
      const msg = (smsTemplate || defaultTemplate).replace(/\{link\}/g, url).replace(/\{tittel\}/g, title);
      smsTasks.push(sendElksSms(`+${phone}`, msg));
    }

    await batch.commit();
    if (Object.keys(tokenMap).length > 0) await valgRef.update(tokenMap);
    await Promise.all(smsTasks);
    return { sent: normalized.length };
  },
);

exports.openValgInvite = onCall(
  { region: "europe-west1", invoker: "public" },
  async ({ data }) => {
    const { token } = data || {};
    if (!token) throw new HttpsError("invalid-argument", "Mangler token");
    const db = admin.firestore();
    const ref = db.doc(`valgInvites/${token}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Ugyldig lenke");
    const d = snap.data();
    if (!d.openedAt) await ref.update({ openedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { valgId: d.valgId, phone: d.phone, alreadyVoted: !!d.choice, choice: d.choice || null };
  },
);

exports.submitValgChoice = onCall(
  { region: "europe-west1", invoker: "public", secrets: ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"] },
  async ({ data }) => {
    const { token, choice } = data || {};
    if (!token || !choice) throw new HttpsError("invalid-argument", "Mangler token eller choice");
    const db = admin.firestore();
    const inviteRef = db.doc(`valgInvites/${token}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) throw new HttpsError("not-found", "Ugyldig lenke");
    const invite = inviteSnap.data();
    if (invite.choice) throw new HttpsError("already-exists", "Du har allerede gjort et valg");
    const valgDoc = await db.doc(`valg/${invite.valgId}`).get();
    if (!valgDoc.exists) throw new HttpsError("not-found", "Valget finnes ikke");
    const valgData = valgDoc.data();
    if (valgData.status === "closed") throw new HttpsError("failed-precondition", "Dette valget er avsluttet");
    const validOption = (valgData.options || []).find((o) => o.label === choice);
    if (!validOption) throw new HttpsError("invalid-argument", "Ugyldig alternativ");

    await inviteRef.update({
      choice: validOption.label,
      choiceId: validOption.id,
      votedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const axios = require("axios");
      const accessToken = await getAzureAccessToken();
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937;">
        <h2 style="margin:0 0 16px;color:#1a3a2a;">Nytt valg registrert</h2>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;">Valg</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">${valgData.title}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;">Telefon</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${invite.phone}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;">Svar</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:#1a3a2a;">${validOption.label}</td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:0.8rem;color:#9ca3af;">Se alle svar på <a href="https://crust.no/valg/admin" style="color:#1a3a2a;">crust.no/valg/admin</a></p>
      </div>`;
      await axios.post(
        `https://graph.microsoft.com/v1.0/users/${REVIEW_EMAIL_FROM}/sendMail`,
        { message: { subject: `Valg: ${invite.phone} valgte "${validOption.label}" (${valgData.title})`, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: "magnus@crust.no" } }] }, saveToSentItems: false },
        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
      );
    } catch (e) { logger.error("Valg email failed", { error: e?.message }); }

    return { confirmationMessage: valgData.confirmationMessage || "Takk for ditt valg!", choice: validOption.label };
  },
);
