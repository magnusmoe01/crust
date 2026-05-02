const axios = require("axios");
const admin = require("firebase-admin");

const PURCHASE_ENDPOINT_CANDIDATES = [
  "/purchases/v2",
  "/purchase/v2/purchases",
];

const REQUEST_TIMEOUT_MS = 60_000;
const PAGE_SIZE = 200;
const ZETTLE_BASE_URL = "https://purchase.izettle.com";
const ZETTLE_OAUTH_BASE_URL = "https://oauth.zettle.com";
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;

// ✅ Maps Zettle cash register names to Planday department names
const ZETTLE_LOCATION_TO_DEPARTMENT = {
  "bergen": "Bergen",
  "gjøvik": "Gjøvik",
  "josefines park": "Oslo",
  "nydalen": "Oslo",
  "katten": "Oslo",
  "operastranda": "Oslo",
  "torshov": "Oslo",
  "tjuvholmen": "Oslo",
  "ullevål hageby": "Oslo",
  "sognsvann": "Oslo",
  "julemarked": "Oslo",
  "ålesund": "Ålesund",
};

// ✅ Locations that are sub-locations of a parent
const SUB_LOCATION_PARENTS = {
  "josefines park": "Oslo",
  "nydalen": "Oslo",
  "katten": "Oslo",
  "operastranda": "Oslo",
  "torshov": "Oslo",
  "tjuvholmen": "Oslo",
  "ullevål hageby": "Oslo",
  "sognsvann": "Oslo",
  "julemarked": "Oslo",
};

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function getValidZettleToken(forceRefresh = false) {
  const snapshot = await db.collection("zettlePrivate").doc("default").get();

  if (!snapshot.exists) {
    throw new Error("Zettle integration not found. Please connect Zettle first.");
  }

  const data = snapshot.data() || {};
  const accessToken = String(data.accessToken || "").trim();
  const refreshToken = String(data.refreshToken || "").trim();
  const expiresAt = data.expiresAt?.toDate?.();

  if (!accessToken) {
    throw new Error("Zettle access token is missing. Please reconnect Zettle.");
  }

  if (!refreshToken) {
    throw new Error("Zettle refresh token is missing. Please reconnect Zettle.");
  }

  if (!forceRefresh && expiresAt && expiresAt.getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return accessToken;
  }

  console.log("🔄 Zettle token expired, auto-refreshing...");

  const clientId = String(process.env.ZETTLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.ZETTLE_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    console.warn("⚠️ Zettle secrets not available for refresh, trying existing token.");
    return accessToken;
  }

  const tokenResponse = await fetch(`${ZETTLE_OAUTH_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    console.error("❌ Zettle token refresh failed, trying existing token.");
    return accessToken;
  }

  const tokenData = await tokenResponse.json();
  const newAccessToken = String(tokenData.access_token || "").trim();

  if (!newAccessToken) return accessToken;

  const expiresInSeconds = Number(tokenData.expires_in || 7200);
  const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await db.collection("zettlePrivate").doc("default").set(
    {
      accessToken: newAccessToken,
      refreshToken: String(tokenData.refresh_token || refreshToken).trim(),
      expiresAt: admin.firestore.Timestamp.fromDate(newExpiresAt),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log("✅ Zettle token refreshed successfully.");
  return newAccessToken;
}

async function createZettleClient(forceRefresh = false) {
  const token = await getValidZettleToken(forceRefresh);

  return axios.create({
    baseURL: ZETTLE_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

function toIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(value) {
  return Number((value || 0).toFixed(2));
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.data,
    payload?.items,
    payload?.results,
    payload?.purchases,
    payload?.value,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function normalizePurchase(purchase) {
  const displayName = String(purchase?.cashRegister?.displayName || "").trim();
  const locationRaw = displayName.toLowerCase();

  const department = ZETTLE_LOCATION_TO_DEPARTMENT[locationRaw] || displayName;
  const isSubLocation = locationRaw in SUB_LOCATION_PARENTS;

  const date =
    toIsoDate(purchase?.timestamp) ||
    toIsoDate(purchase?.date) ||
    toIsoDate(purchase?.created) ||
    toIsoDate(purchase?.createdAt);

  const income = parseAmount(purchase?.amount);

  return {
    location: department,
    subLocationName: isSubLocation ? displayName : null,
    date,
    income,
  };
}

async function fetchIncomeRows(startDate, endDate) {
  const fromIso = toIsoDate(startDate);
  const toIso = toIsoDate(endDate);

  if (!fromIso || !toIso) {
    throw new Error("Invalid startDate or endDate. Use YYYY-MM-DD format.");
  }

  if (new Date(fromIso) > new Date(toIso)) {
    throw new Error("startDate must be before or equal to endDate.");
  }

  for (const endpoint of PURCHASE_ENDPOINT_CANDIDATES) {
    for (const forceRefresh of [false, true]) {
      let offset = 0;
      const allItems = [];

      try {
        const client = await createZettleClient(forceRefresh);
        while (true) {
          const response = await client.get(endpoint, {
            params: {
              startDate: fromIso,
              endDate: toIso,
              limit: PAGE_SIZE,
              offset,
            },
          });

          const items = extractItems(response.data);
          if (!items || items.length === 0) break;
          allItems.push(...items);
          if (items.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }

        return allItems.map(normalizePurchase);
      } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;
        const code = error.code || "";
        console.error("🚨 ZETTLE API ERROR");
        console.error("Endpoint:", endpoint, "forceRefresh:", forceRefresh);
        console.error("Status:", status);
        console.error("Code:", code);
        console.error("Response:", JSON.stringify(data, null, 2));

        const isRetryable = !status || status === 401 || code === "ECONNABORTED";
        if (forceRefresh || !isRetryable) {
          if (status && status !== 404) {
            throw new Error(`Zettle API failed (status ${status}). Check token or permissions.`);
          }
          break;
        }
      }
    }
  }

  throw new Error("All Zettle endpoints failed. Check base URL, token, and API access.");
}

async function getIncomeByDateAndLocation(startDate, endDate) {
  const rows = await fetchIncomeRows(startDate, endDate);

  // ✅ Group by date + location, tracking sub-locations separately
  const grouped = new Map();

  for (const row of rows) {
    if (!row.date || !row.location) continue;

    const key = `${row.date}::${row.location}`;

    const current = grouped.get(key) || {
      location: row.location,
      date: row.date,
      income: 0,
      subLocations: new Map(),
    };

    current.income += parseAmount(row.income);

    // ✅ Track sub-location income separately
    if (row.subLocationName) {
      const subCurrent = current.subLocations.get(row.subLocationName) || {
        name: row.subLocationName,
        income: 0,
      };
      subCurrent.income += parseAmount(row.income);
      current.subLocations.set(row.subLocationName, subCurrent);
    }

    grouped.set(key, current);
  }

  return Array.from(grouped.values()).map((e) => ({
    location: e.location,
    date: e.date,
    income: round(e.income),
    // ✅ Pass sub-locations as array
    subLocations: Array.from(e.subLocations.values()).map((s) => ({
      name: s.name,
      income: round(s.income),
    })),
  })).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.location.localeCompare(b.location);
  });
}

module.exports = {
  getIncomeByDateAndLocation,
};
