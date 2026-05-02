const axios = require("axios");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PLANDAY_OAUTH_BASE_URL = "https://id.planday.com";
const PLANDAY_API_BASE_URL = "https://openapi.planday.com";
const SHIFT_ENDPOINT = "/scheduling/v1.0/shifts";

const EMPLOYEE_ENDPOINT_CANDIDATES = [
  "/hr/v1.0/employees",
  "/employees/v1.0/employees",
];

const REQUEST_TIMEOUT_MS = 20000;
const PAGE_SIZE = 200;

// -------------------- DEPARTMENTS --------------------
const DEPARTMENT_ID_TO_NAME = {
  19766: "Oslo",
  19767: "Bergen",
  19768: "Gjøvik",
};

// -------------------- AUTH --------------------
function getPlandayConfig() {
  const clientId = String(process.env.PLANDAY_CLIENT_ID || "").trim();
  const refreshToken = String(process.env.PLANDAY_TOKEN || "").trim();

  if (!clientId) throw new Error("Missing PLANDAY_CLIENT_ID");
  if (!refreshToken) throw new Error("Missing PLANDAY_TOKEN");

  return { clientId, refreshToken };
}

async function getPlandayAccessToken() {
  const { clientId, refreshToken } = getPlandayConfig();

  const res = await axios.post(
    `${PLANDAY_OAUTH_BASE_URL}/connect/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
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
      "X-ClientId": process.env.PLANDAY_CLIENT_ID,
      Accept: "application/json",
    },
  });
}

// -------------------- HELPERS --------------------
function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.items || data?.employees || data?.shifts || [];
}

function toIsoDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().split("T")[0];
}

function round(v) {
  return Number((v || 0).toFixed(2));
}

// -------------------- EMPLOYEES --------------------
async function getEmployees({ token } = {}) {
  const accessToken = token || (await getPlandayAccessToken());
  const client = createClient(accessToken);

  for (const endpoint of EMPLOYEE_ENDPOINT_CANDIDATES) {
    try {
      const res = await client.get(endpoint, {
        params: { limit: PAGE_SIZE },
      });

      const employees = extractItems(res.data);

      return employees.map((e) => ({
        id: String(e?.id || e?.employeeId || "").trim(),
        name: `${e?.firstName || ""} ${e?.lastName || ""}`.trim(),
        departmentId: e?.departmentId || e?.department?.id || null,
        location:
          DEPARTMENT_ID_TO_NAME[e?.departmentId || e?.department?.id] ||
          e?.department?.name ||
          "Unknown",
      }));
    } catch (err) {
      if (err?.response?.status === 404) continue;
      throw err;
    }
  }

  throw new Error("No employee endpoint found");
}

// -------------------- SYNC EMPLOYEES --------------------
async function syncEmployeesToFirestore() {
  const employees = await getEmployees();

  for (const emp of employees) {
    if (!emp.id) continue;

    const ref = db.collection("employees").doc(emp.id);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        id: emp.id,
        name: emp.name,
        location: emp.location,
        rate: null,
        active: true,
        createdAt: new Date(),
      });
    } else {
      await ref.update({
        location: emp.location,
      });
    }
  }

  return true;
}

// -------------------- SHIFTS --------------------
async function getShifts({ token, from, to } = {}) {
  const accessToken = token || (await getPlandayAccessToken());
  const client = createClient(accessToken);

  const res = await client.get(SHIFT_ENDPOINT, {
    params: { from, to, limit: PAGE_SIZE },
  });

  const shifts = extractItems(res.data);

  return shifts.map((s) => ({
    employeeId: String(s?.employee?.id || s?.employeeId || "").trim(),
    departmentId: s?.departmentId || s?.department?.id || null,
    date: toIsoDate(s?.startDateTime),

    hours: (() => {
      if (s?.hoursWorked) return Number(s.hoursWorked);
      if (s?.hours) return Number(s.hours);
      if (s?.startDateTime && s?.endDateTime) {
        const start = new Date(s.startDateTime);
        const end = new Date(s.endDateTime);
        return (end - start) / (1000 * 60 * 60);
      }
      return 0;
    })(),
  }));
}

// -------------------- SALARY ENGINE (FIXED CORE) --------------------
async function getSalaryByDateAndLocation(startDate, endDate) {
  const shifts = await getShifts({ from: startDate, to: endDate });

  const snapshot = await db.collection("employees").get();

  const employeeMap = new Map();
  snapshot.forEach((doc) => {
    employeeMap.set(doc.id, doc.data());
  });

  const grouped = new Map();

  for (const shift of shifts) {
    if (!shift.date) continue;

    const emp = employeeMap.get(shift.employeeId);

    const rate = Number(emp?.rate || 0);
    const location = emp?.location || "Unknown";

    const cost = shift.hours * rate;

    const key = `${shift.date}::${location}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        date: shift.date,
        location,
        totalHours: 0,
        salaryCost: 0,
      });
    }

    const row = grouped.get(key);

    row.totalHours += shift.hours;
    row.salaryCost += cost;
  }

  return Array.from(grouped.values()).map((r) => ({
    ...r,
    totalHours: round(r.totalHours),
    salaryCost: round(r.salaryCost),
  }));
}

// -------------------- EXPORTS --------------------
module.exports = {
  getPlandayAccessToken,
  getEmployees,
  getShifts,
  syncEmployeesToFirestore,
  getSalaryByDateAndLocation,
};