/**
 * src/services/financialReportApi.js
 *
 * Calls the financialReport Cloud Function.
 * Salary is fetched automatically from the Planday Payroll API
 * on the backend - no CSV upload needed from the frontend.
 */

const API_URL =
  "https://europe-west1-crust-11575.cloudfunctions.net/financialReport";

async function getAdminAuthToken() {
  const { getAuth } = await import("firebase/auth");
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in as admin to generate the report.");
  return user.getIdToken();
}

/**
 * @param {string}   startDate  "YYYY-MM-DD"
 * @param {string}   endDate    "YYYY-MM-DD"
 * @param {string[]} locations  e.g. ["Oslo","Bergen"] or [] for all
 */
export async function loadFinancialReport(
  startDate,
  endDate,
  locations = [],
  csvPayrollRows = [],
  csvIncomeRows = [],
  employeeLocationMap = {}
) {
  const authToken = await getAdminAuthToken();
  const start = new Date(startDate);
  const end = new Date(endDate);
  const spanDays = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
  const includeIncome = spanDays <= 45;

  const payload = {
    startDate,
    endDate,
    locations: locations.length > 0 ? locations : ["all"],
    includeIncome,
    csvPayrollRows: Array.isArray(csvPayrollRows) ? csvPayrollRows : [],
    csvIncomeRows: Array.isArray(csvIncomeRows) ? csvIncomeRows : [],
    employeeLocationMap:
      employeeLocationMap && typeof employeeLocationMap === "object"
        ? employeeLocationMap
        : {},
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body?.error ||
      body?.details?.error?.code ||
      response.statusText ||
      "Financial report request failed.";
    throw new Error(`${message} (HTTP ${response.status})`);
  }

  return response.json();
}
