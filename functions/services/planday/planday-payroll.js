/**
 * functions/services/planday/planday-payroll.js
 *
 * Fetches salary data directly from the Planday Payroll API —
 * no CSV upload needed. The API returns the same figures as the
 * Planday payroll CSV export (Antall × Sats already calculated).
 *
 * Endpoint: GET /payroll/v1.0/payroll
 * Params:   from, to, departmentIds (required)
 *
 * Returns salary grouped by location, resolved via Firestore employee map.
 */

const axios = require("axios");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PLANDAY_OAUTH_BASE_URL = "https://id.planday.com";
const PLANDAY_API_BASE_URL   = "https://openapi.planday.com";
const PAYROLL_ENDPOINT       = "/payroll/v1.0/payroll";
const REQUEST_TIMEOUT_MS     = 30000;
const PAGE_SIZE              = 200;
const PLANDAY_SETTINGS_DOC_ID = "plandayIntegration";

// Department ID → location name
const DEPARTMENT_ID_TO_NAME = {
  19766: "Oslo",
  19767: "Bergen",
  19768: "Gj\u00f8vik",
};

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getPlandayAccessToken() {
  const clientId     = String(process.env.PLANDAY_CLIENT_ID || "").trim();
  const refreshToken = String(process.env.PLANDAY_TOKEN     || "").trim();

  if (!clientId)     throw new Error("Missing PLANDAY_CLIENT_ID");
  if (!refreshToken) throw new Error("Missing PLANDAY_TOKEN");

  const res = await axios.post(
    `${PLANDAY_OAUTH_BASE_URL}/connect/token`,
    new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     clientId,
      refresh_token: refreshToken,
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      timeout: REQUEST_TIMEOUT_MS,
    }
  );

  const token = res.data?.access_token;
  if (!token) throw new Error("No access token from Planday");
  return token;
}

function createClient(token) {
  return axios.create({
    baseURL: PLANDAY_API_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-ClientId":  process.env.PLANDAY_CLIENT_ID,
      Accept:        "application/json",
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(v) {
  return Math.round((v || 0) * 100) / 100;
}

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return (
    data?.data    ||
    data?.items   ||
    data?.payroll ||
    []
  );
}

function normalizeEmployeeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, "");
  return cleaned.replace(/^0+/, "");
}

function normalizePlandayLocation(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "bergen") return "Bergen";
  if (raw === "gj\u00f8vik" || raw === "gjovik") return "Gj\u00f8vik";
  return "Oslo";
}

function resolveLocationFromPlandayRow(rawRowLocation, rawDepartmentName, departmentLocation, employeeLocation) {
  const rawValue = String(rawRowLocation || rawDepartmentName || employeeLocation || "").trim();
  if (!rawValue) return departmentLocation || "Oslo";

  const normalizedValue = rawValue.toLowerCase();
  if (normalizedValue.includes("bergen")) return "Bergen";
  if (normalizedValue.includes("gj\u00f8vik") || normalizedValue.includes("gjovik")) return "Gj\u00f8vik";
  return "Oslo";
}

// ── Payroll API fetch ─────────────────────────────────────────────────────────

async function getConfiguredDepartmentIds() {
  const snapshot = await db.collection("siteSettings").doc(PLANDAY_SETTINGS_DOC_ID).get();
  const raw = snapshot.data()?.departmentIds;
  const ids = Array.isArray(raw) ? raw : [];
  const allowedIds = new Set(Object.keys(DEPARTMENT_ID_TO_NAME).map((id) => Number(id)));

  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && allowedIds.has(id));
}

async function fetchPayrollRows(startDate, endDate) {
  const token  = await getPlandayAccessToken();
  const client = createClient(token);

  const configuredDepartmentIds = await getConfiguredDepartmentIds();
  const fallbackDepartmentIds = Object.keys(DEPARTMENT_ID_TO_NAME).map((id) => Number(id));
  const selectedDepartmentIds = configuredDepartmentIds.length
    ? configuredDepartmentIds
    : fallbackDepartmentIds;
  const departmentIds = selectedDepartmentIds.join(",");

  logger.info("Planday payroll fetch: request configuration", {
    startDate,
    endDate,
    configuredDepartmentIds,
    fallbackDepartmentIds,
    selectedDepartmentIds,
  });

  async function fetchWithDepartmentIds(ids) {
    const departmentIds = ids.join(",");
    let allRows = [];
    let offset = 0;

    while (true) {
      const res = await client.get(PAYROLL_ENDPOINT, {
        params: {
          from: startDate,
          to: endDate,
          departmentIds,
          limit: PAGE_SIZE,
          offset,
        },
      });

      const rows = extractItems(res.data);
      logger.info("Planday payroll fetch: page result", {
        departmentIds,
        offset,
        limit: PAGE_SIZE,
        pageRows: rows.length,
      });
      if (!rows.length) break;

      allRows = allRows.concat(rows);
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return allRows;
  }

  try {
    return await fetchWithDepartmentIds(selectedDepartmentIds);
  } catch (error) {
    const shouldRetryWithFallback =
      configuredDepartmentIds.length > 0 &&
      selectedDepartmentIds.join(",") !== fallbackDepartmentIds.join(",");

    if (!shouldRetryWithFallback) throw error;

    logger.warn("Planday payroll fetch failed for configured departments, retrying with fallback departments", {
      configuredDepartmentIds,
      fallbackDepartmentIds,
      errorStatus: error?.response?.status || null,
      errorData: error?.response?.data || null,
    });

    return fetchWithDepartmentIds(fallbackDepartmentIds);
  }
}

// ── Location resolver ─────────────────────────────────────────────────────────

async function groupPayrollByLocation(rows) {
  if (!rows.length) {
    logger.warn("Planday payroll grouping: no rows returned from API");
    return [];
  }

  const snapshot = await db.collection("employees").get();
  const employeeMap = new Map();
  const plandayIdMap = new Map(); // Primary map by Planday ID

  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const keys = [
      String(doc.id || "").trim(),
      String(data.id || "").trim(),
      String(data.employeeId || "").trim(),
      String(data.employeeNumber || "").trim(),
      String(data.plandayId || "").trim(),
      String(data.plandayEmployeeId || "").trim(),
    ];

    for (const key of keys) {
      if (!key) continue;
      employeeMap.set(key, data);
      const normalized = normalizeEmployeeKey(key);
      if (normalized) employeeMap.set(normalized, data);
    }

    // Create primary Planday ID map for faster matching
    const plandayId = String(data.plandayId || data.plandayEmployeeId || "").trim();
    if (plandayId) {
      plandayIdMap.set(plandayId, data);
      const normalized = normalizeEmployeeKey(plandayId);
      if (normalized) plandayIdMap.set(normalized, data);
    }
  });

  const grouped = new Map();
  const unmatchedEmployees = [];

  for (const row of rows) {
    const deptIdRaw = row.departmentId || row.department?.id;
    const deptId = Number(deptIdRaw);
    const isBergen = deptId === 19767;
    const isGjovik = deptId === 19768;
    const departmentLocation = isBergen
      ? "Bergen"
      : isGjovik
      ? "Gj\u00f8vik"
      : "Oslo";

    // Try multiple ways to match employee
    const empIdRaw = String(row.employeeId || row.employeeNumber || "").trim();
    let emp = null;
    let matchMethod = "none";

    // 1. Try exact Planday ID match first
    if (plandayIdMap.has(empIdRaw)) {
      emp = plandayIdMap.get(empIdRaw);
      matchMethod = "planday_exact";
    }

    // 2. Try normalized Planday ID
    const normalized = normalizeEmployeeKey(empIdRaw);
    if (!emp && normalized && plandayIdMap.has(normalized)) {
      emp = plandayIdMap.get(normalized);
      matchMethod = "planday_normalized";
    }

    // 3. Try general employee map
    if (!emp) {
      emp = employeeMap.get(empIdRaw) || employeeMap.get(normalized);
      matchMethod = emp ? "employee_map" : "none";
    }

    const rawRowLocation = String(row.location || "").trim();
    const rawDepartmentName = String(row.department?.name || row.departmentName || "").trim();
    const location = resolveLocationFromPlandayRow(
      rawRowLocation,
      rawDepartmentName,
      departmentLocation,
      emp?.location
    );

    // Track unmatched employees
    if (!emp) {
      unmatchedEmployees.push({
        plandayId: empIdRaw,
        department: departmentLocation,
        matchMethod: matchMethod,
      });
    }

    const hours = Number(row.units || row.hours || 0);
    const salary = Number(row.amount || row.total || (hours * Number(row.rate || 0)));

    if (!grouped.has(location)) {
      grouped.set(location, { location, totalHours: 0, totalSalary: 0 });
    }

    const g = grouped.get(location);
    g.totalHours += hours;
    g.totalSalary += salary;
  }

  const groupedRows = Array.from(grouped.values()).map((g) => ({
    location:    g.location,
    totalHours:  round2(g.totalHours),
    totalSalary: round2(g.totalSalary),
  }));

  if (unmatchedEmployees.length > 0) {
    logger.warn("Planday payroll grouping: unmatched employees", {
      count: unmatchedEmployees.length,
      samples: unmatchedEmployees.slice(0, 10),
    });
  }

  logger.info("Planday payroll grouping: computed totals", {
    inputRows: rows.length,
    groupedCount: groupedRows.length,
    unmatchedCount: unmatchedEmployees.length,
    groupedRows,
  });

  return groupedRows;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function getSalaryByLocation(startDate, endDate) {
  const rows = await fetchPayrollRows(startDate, endDate);
  return groupPayrollByLocation(rows);
}

module.exports = { getSalaryByLocation, fetchPayrollRows, groupPayrollByLocation };

