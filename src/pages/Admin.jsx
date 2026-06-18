import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAuth, getIdToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db, functions } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import {
  JOB_APPLICATIONS_DOC_ID,
  JOB_PORTAL_STATUS_CLOSED,
  JOB_PORTAL_STATUS_OPEN,
  JOB_PORTAL_STATUS_WAITLIST,
  JOB_PORTAL_WAITLIST_COLLECTION,
  SITE_SETTINGS_COLLECTION,
} from "../config/siteSettings";
import "./Admin.css";

const JOB_PORTAL_STATUS_LABELS = {
  [JOB_PORTAL_STATUS_OPEN]: "Apply (open)",
  [JOB_PORTAL_STATUS_CLOSED]: "Closed",
  [JOB_PORTAL_STATUS_WAITLIST]: "Register email",
};

const PLANDAY_SETTINGS_DOC_ID = "plandayIntegration";

function getPortalStatus(data) {
  const status = data?.jobPortalStatus;
  if (
    status === JOB_PORTAL_STATUS_OPEN ||
    status === JOB_PORTAL_STATUS_CLOSED ||
    status === JOB_PORTAL_STATUS_WAITLIST
  ) {
    return status;
  }
  if (typeof data?.acceptingApplications === "boolean") {
    return data.acceptingApplications
      ? JOB_PORTAL_STATUS_OPEN
      : JOB_PORTAL_STATUS_CLOSED;
  }
  return JOB_PORTAL_STATUS_OPEN;
}

function getSettingsErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "No access to change settings. Make sure you're logged in with @crust.no and that Firestore rules are deployed.";
  }
  if (code === "unauthenticated") {
    return "You must be logged in to change settings.";
  }
  return fallbackMessage;
}

function formatDateTime(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date) return "Unknown time";
  return date.toLocaleString("en-GB");
}

function getIntegrationErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return "No access to the integration. Check the admin login.";
  }
  if (code === "functions/unauthenticated" || code === "unauthenticated") {
    return "You must be logged in as admin to connect.";
  }
  return fallbackMessage;
}

function getZettleStatusLabel(status) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  if (status === "pending") return "Pending";
  return "Not connected";
}

function getPlandayStatusLabel(status) {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  if (status === "pending") return "Pending";
  return "Not connected";
}

function parseDepartmentIdsInput(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => /^\d+$/.test(entry)),
    ),
  );
}

function Admin() {
  const { user, isAdmin, loading, error, signIn, signOutAdmin } = useAdminSession();
  const [portalStatus, setPortalStatus] = useState(JOB_PORTAL_STATUS_OPEN);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [waitlistLoading, setWaitlistLoading] = useState(true);
  const [waitlistError, setWaitlistError] = useState("");
  const [deletingEntryId, setDeletingEntryId] = useState("");
  const [zettleConnection, setZettleConnection] = useState(null);
  const [zettleLoading, setZettleLoading] = useState(false);
  const [zettleError, setZettleError] = useState("");
  const [zettleAction, setZettleAction] = useState("");
  const [zettleMessage, setZettleMessage] = useState("");
  const [plandayConnection, setPlandayConnection] = useState(null);
  const [plandayLoading, setPlandayLoading] = useState(false);
  const [plandayError, setPlandayError] = useState("");
  const [plandayAction, setPlandayAction] = useState("");
  const [plandayMessage, setPlandayMessage] = useState("");
  const [plandaySettingsLoading, setPlandaySettingsLoading] = useState(false);
  const [plandaySettingsSaving, setPlandaySettingsSaving] = useState(false);
  const [plandaySettingsError, setPlandaySettingsError] = useState("");
  const [plandaySettingsMessage, setPlandaySettingsMessage] = useState("");
  const [plandayDepartmentIdsInput, setPlandayDepartmentIdsInput] = useState("");

  // ✅ Employee rates state
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeEdits, setEmployeeEdits] = useState({});
  const [savingEmployeeId, setSavingEmployeeId] = useState("");
  const [employeeMessages, setEmployeeMessages] = useState({});
  const [newEmployeeInputs, setNewEmployeeInputs] = useState({
    name: "",
    location: "",
    salaryId: "",
    plandayId: "",
    rate: "",
  });
  const [newEmployeeMessage, setNewEmployeeMessage] = useState(null);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [showEmployeeRates, setShowEmployeeRates] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      setSettingsLoading(true);
      setSettingsError("");
      try {
        const snapshot = await getDoc(
          doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
        );
        setPortalStatus(getPortalStatus(snapshot.data()));
      } catch (err) {
        setSettingsError(
          getSettingsErrorMessage(err, "Could not load settings right now."),
        );
      } finally {
        setSettingsLoading(false);
      }
    }
    loadSettings();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setWaitlistEntries([]);
      setWaitlistLoading(false);
      setWaitlistError("");
      return;
    }
    setWaitlistLoading(true);
    setWaitlistError("");
    const waitlistQuery = query(
      collection(db, JOB_PORTAL_WAITLIST_COLLECTION),
      orderBy("createdAt", "desc"),
    );
    const unsubscribe = onSnapshot(
      waitlistQuery,
      (snapshot) => {
        setWaitlistEntries(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setWaitlistLoading(false);
      },
      () => {
        setWaitlistError("Could not load email registrations.");
        setWaitlistLoading(false);
      },
    );
    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setZettleConnection(null);
      setZettleLoading(false);
      setZettleError("");
      setZettleMessage("");
      return undefined;
    }
    setZettleLoading(true);
    setZettleError("");
    const unsubscribe = onSnapshot(
      doc(db, "integrations", "zettle"),
      (snapshot) => {
        setZettleConnection(snapshot.exists() ? snapshot.data() : null);
        setZettleLoading(false);
      },
      () => {
        setZettleError("Could not load Zettle status.");
        setZettleLoading(false);
      },
    );
    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPlandayConnection(null);
      setPlandayLoading(false);
      setPlandayError("");
      setPlandayMessage("");
      return undefined;
    }
    setPlandayLoading(true);
    setPlandayError("");
    const unsubscribe = onSnapshot(
      doc(db, "integrations", "planday"),
      (snapshot) => {
        setPlandayConnection(snapshot.exists() ? snapshot.data() : null);
        setPlandayLoading(false);
      },
      () => {
        setPlandayError("Could not load Planday status.");
        setPlandayLoading(false);
      },
    );
    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPlandayDepartmentIdsInput("");
      setPlandaySettingsLoading(false);
      setPlandaySettingsError("");
      setPlandaySettingsMessage("");
      return;
    }
    async function loadPlandaySettings() {
      setPlandaySettingsLoading(true);
      setPlandaySettingsError("");
      try {
        const snapshot = await getDoc(
          doc(db, SITE_SETTINGS_COLLECTION, PLANDAY_SETTINGS_DOC_ID),
        );
        const departmentIds = Array.isArray(snapshot.data()?.departmentIds)
          ? snapshot.data().departmentIds
          : [];
        setPlandayDepartmentIdsInput(departmentIds.join(", "));
      } catch (err) {
        setPlandaySettingsError(
          getSettingsErrorMessage(err, "Could not load Planday settings right now."),
        );
      } finally {
        setPlandaySettingsLoading(false);
      }
    }
    loadPlandaySettings();
  }, [isAdmin]);

  // ✅ Load employees from Firestore in real-time
  useEffect(() => {
    if (!isAdmin) {
      setEmployees([]);
      return undefined;
    }

    setEmployeesLoading(true);

    const unsubscribe = onSnapshot(
      query(collection(db, "employees"), orderBy("name")),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEmployees(data);

        const edits = {};
        data.forEach((emp) => {
          edits[emp.id] = {
            rate: emp.rate != null ? String(emp.rate) : "",
            location: emp.location || "",
            salaryId: emp.salaryId || "",
            plandayId: emp.plandayId || "",
          };
        });

        setEmployeeEdits((prev) => {
          const merged = { ...edits };
          Object.keys(prev).forEach((id) => {
            if (!merged[id]) {
              merged[id] = prev[id];
              return;
            }
            merged[id] = {
              rate: prev[id].rate !== undefined ? prev[id].rate : merged[id].rate,
              location: prev[id].location !== undefined ? prev[id].location : merged[id].location,
              salaryId: prev[id].salaryId !== undefined ? prev[id].salaryId : merged[id].salaryId,
              plandayId: prev[id].plandayId !== undefined ? prev[id].plandayId : merged[id].plandayId,
            };
          });
          return merged;
        });
        setEmployeesLoading(false);
      },
      (err) => {
        console.error("Could not load employees:", err);
        setEmployeesLoading(false);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  // ✅ Save a single employee's rate to Firestore
  async function onSaveEmployee(empId) {
    const edits = employeeEdits[empId] || {};
    const rawRate = String(edits.rate || "").trim().replace(",", ".");
    const location = String(edits.location || "").trim();
    const salaryId = String(edits.salaryId || "").trim();
    const plandayId = String(edits.plandayId || "").trim();

    const updates = {
      location,
      salaryId,
      plandayId,
      updatedAt: serverTimestamp(),
      updatedBy: user?.email || "admin",
    };

    if (rawRate !== "") {
      const rate = parseFloat(rawRate);
      if (Number.isNaN(rate) || rate < 0) {
        setEmployeeMessages((prev) => ({
          ...prev,
          [empId]: { type: "error", text: "Enter a valid hourly rate (e.g. 187.66)" },
        }));
        return;
      }
      updates.rate = rate;
      updates.rateUpdatedAt = serverTimestamp();
      updates.rateUpdatedBy = user?.email || "admin";
    }

    setSavingEmployeeId(empId);
    setEmployeeMessages((prev) => ({ ...prev, [empId]: null }));

    try {
      await updateDoc(doc(db, "employees", empId), updates);
      setEmployeeMessages((prev) => ({
        ...prev,
        [empId]: { type: "success", text: "✅ Saved employee details" },
      }));
      setTimeout(() => {
        setEmployeeMessages((prev) => ({ ...prev, [empId]: null }));
      }, 3000);
    } catch (err) {
      setEmployeeMessages((prev) => ({
        ...prev,
        [empId]: { type: "error", text: "Failed to save. Try again." },
      }));
    } finally {
      setSavingEmployeeId("");
    }
  }

  async function onAddEmployee() {
    const name = String(newEmployeeInputs.name || "").trim();
    const location = String(newEmployeeInputs.location || "").trim();
    const salaryId = String(newEmployeeInputs.salaryId || "").trim();
    const plandayId = String(newEmployeeInputs.plandayId || "").trim();
    const rawRate = String(newEmployeeInputs.rate || "").trim().replace(",", ".");

    if (!name) {
      setNewEmployeeMessage({ type: "error", text: "Employee name is required." });
      return;
    }

    const updates = {
      name,
      location,
      salaryId,
      plandayId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user?.email || "admin",
    };

    if (rawRate !== "") {
      const rate = parseFloat(rawRate);
      if (Number.isNaN(rate) || rate < 0) {
        setNewEmployeeMessage({ type: "error", text: "Enter a valid hourly rate (e.g. 187.66)." });
        return;
      }
      updates.rate = rate;
      updates.rateUpdatedAt = serverTimestamp();
      updates.rateUpdatedBy = user?.email || "admin";
    }

    try {
      await addDoc(collection(db, "employees"), updates);
      setNewEmployeeMessage({ type: "success", text: "✅ New employee added." });
      setNewEmployeeInputs({ name: "", location: "", salaryId: "", plandayId: "", rate: "" });
      setTimeout(() => setNewEmployeeMessage(null), 3000);
    } catch (err) {
      setNewEmployeeMessage({ type: "error", text: "Failed to add employee. Try again." });
    }
  }

  async function onSavePortalStatus() {
    setSaving(true);
    setSettingsError("");
    setStatusMessage("");
    try {
      await setDoc(
        doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
        {
          jobPortalStatus: portalStatus,
          acceptingApplications: portalStatus === JOB_PORTAL_STATUS_OPEN,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "admin",
        },
        { merge: true },
      );
      setStatusMessage(`Status for /jobb updated to: ${JOB_PORTAL_STATUS_LABELS[portalStatus]}.`);
    } catch (err) {
      setSettingsError(getSettingsErrorMessage(err, "Could not save the setting. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteWaitlistEntry(entryId) {
    setWaitlistError("");
    setDeletingEntryId(entryId);
    try {
      await deleteDoc(doc(db, JOB_PORTAL_WAITLIST_COLLECTION, entryId));
    } catch {
      setWaitlistError("Could not delete the registration. Try again.");
    } finally {
      setDeletingEntryId("");
    }
  }

  function onRequestDeleteWaitlistEntry(entry) {
    const confirmed = window.confirm("Are you sure you want to delete this registration?");
    if (!confirmed) return;
    onDeleteWaitlistEntry(entry.id);
  }

  async function onConnectZettle() {
    setZettleAction("connect");
    setZettleError("");
    setZettleMessage("");
    try {
      const createSession = httpsCallable(functions, "createZettleAuthSession");
      const result = await createSession();
      const authUrl = String(result.data?.authUrl || "");
      if (!authUrl) throw new Error("No auth URL returned.");
      window.location.assign(authUrl);
    } catch (err) {
      setZettleError(getIntegrationErrorMessage(err, "Could not start the Zettle login."));
      setZettleAction("");
    }
  }

  async function onDisconnectZettle() {
    const confirmed = window.confirm("Disconnect Zettle and delete saved tokens?");
    if (!confirmed) return;
    setZettleAction("disconnect");
    setZettleError("");
    setZettleMessage("");
    try {
      const disconnect = httpsCallable(functions, "disconnectZettle");
      await disconnect();
      setZettleMessage("Zettle disconnected.");
    } catch (err) {
      setZettleError(getIntegrationErrorMessage(err, "Could not disconnect Zettle right now."));
    } finally {
      setZettleAction("");
    }
  }

  async function onConnectPlanday() {
    setPlandayAction("connect");
    setPlandayError("");
    setPlandayMessage("");
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not authenticated");
      const idToken = await getIdToken(currentUser);
      const response = await fetch(
        "https://europe-west1-crust-11575.cloudfunctions.net/connectPlanday",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      const result = await response.json();
      const employeeCount = Number(result?.employeeCount || 0);
      setPlandayMessage(
        employeeCount > 0
          ? `Planday connected. Found ${employeeCount} employees.`
          : "Planday connected.",
      );
    } catch (err) {
      setPlandayError(getIntegrationErrorMessage(err, "Could not connect to Planday."));
    } finally {
      setPlandayAction("");
    }
  }

  async function onDisconnectPlanday() {
    const confirmed = window.confirm("Mark Planday as disconnected in admin?");
    if (!confirmed) return;
    setPlandayAction("disconnect");
    setPlandayError("");
    setPlandayMessage("");
    try {
      const disconnect = httpsCallable(functions, "disconnectPlanday");
      await disconnect();
      setPlandayMessage("Planday disconnected.");
    } catch (err) {
      setPlandayError(getIntegrationErrorMessage(err, "Could not disconnect Planday right now."));
    } finally {
      setPlandayAction("");
    }
  }

  async function onSavePlandaySettings() {
    setPlandaySettingsSaving(true);
    setPlandaySettingsError("");
    setPlandaySettingsMessage("");
    try {
      const departmentIds = parseDepartmentIdsInput(plandayDepartmentIdsInput);
      await setDoc(
        doc(db, SITE_SETTINGS_COLLECTION, PLANDAY_SETTINGS_DOC_ID),
        {
          departmentIds,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "admin",
        },
        { merge: true },
      );
      setPlandayDepartmentIdsInput(departmentIds.join(", "));
      setPlandaySettingsMessage("Planday departments saved.");
    } catch (err) {
      setPlandaySettingsError(
        getSettingsErrorMessage(err, "Could not save Planday settings. Try again."),
      );
    } finally {
      setPlandaySettingsSaving(false);
    }
  }

  const zettleStatus = String(zettleConnection?.status || "not_connected").trim();
  const plandayStatus = String(plandayConnection?.status || "not_connected").trim();

  // ✅ Filter employees by rate status
  const missingRateCount = employees.filter((e) => !e.rate).length;
  const filteredEmployees = employees.filter((emp) => {
    if (employeeFilter === "missing") return !emp.rate;
    if (employeeFilter === "set") return !!emp.rate;
    return true;
  });

  return (
    <div className="admin-page">
      <header className="admin-hero">
        <p className="eyebrow">Admin</p>
        <h1>Administration</h1>
      </header>

      {!loading && !isAdmin ? (
        <button type="button" className="admin-login-link" onClick={signIn}>
          Admin login
        </button>
      ) : null}
      {!loading && !isAdmin && error ? <p className="forms-error">{error}</p> : null}

      {isAdmin && (
        <section className="admin-panel">
          {loading ? <p>Checking login...</p> : null}
          {isAdmin ? (
            <>
              <p>Logged in as {user?.email}</p>
              <div className="admin-actions">
                <Link className="admin-button" to="/skjema">Go to /skjema</Link>
                <Link className="admin-button admin-button-secondary" to="/admin/leverandører">Suppliers</Link>
                <Link className="admin-button admin-button-secondary" to="/admin/ordre">Order Settings</Link>
                <Link className="admin-button admin-button-secondary" to="/admin/all-orders">All orders</Link>
                <Link className="admin-button admin-button-secondary" to="/order">Order Page</Link>
                <Link className="admin-button admin-button-secondary" to="/worker">Worker Dashboard</Link>
                <Link className="admin-button admin-button-secondary" to="/sales">Open sales</Link>
                <Link className="admin-button admin-button-secondary" to="/admin/financial-report">Financial report</Link>
                <Link className="admin-button admin-button-secondary" to="/admin/sms">Send SMS</Link>
                <button type="button" className="admin-button admin-button-secondary" onClick={signOutAdmin}>Log out</button>
              </div>
            </>
          ) : null}
        </section>
      )}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Zettle</h2>
          <p className={`admin-status-badge is-${zettleStatus}`}>{getZettleStatusLabel(zettleStatus)}</p>
          {zettleLoading ? <p>Loading Zettle status...</p> : null}
          {zettleError ? <p className="forms-error">{zettleError}</p> : null}
          {zettleMessage ? <p className="forms-success">{zettleMessage}</p> : null}
          <p className="admin-muted">OAuth is set up via Firebase Functions. Tokens are stored server-side and are not visible to the client.</p>
          <div className="admin-detail-list">
            <p><strong>Connected by:</strong> {zettleConnection?.connectedByEmail || "-"}</p>
            <p><strong>Connected at:</strong> {formatDateTime(zettleConnection?.connectedAt)}</p>
            <p><strong>Organization UUID:</strong> {zettleConnection?.organizationUuid || "-"}</p>
            <p><strong>User UUID:</strong> {zettleConnection?.zettleUserUuid || "-"}</p>
            <p><strong>Scope:</strong> {zettleConnection?.scope || "-"}</p>
            <p><strong>Last error:</strong> {zettleConnection?.lastError || "-"}</p>
          </div>
          <div className="admin-inline-actions">
            <button type="button" className="admin-button" onClick={onConnectZettle} disabled={zettleAction === "connect"}>
              {zettleAction === "connect" ? "Starting..." : "Connect Zettle"}
            </button>
            <button type="button" className="admin-button admin-button-secondary" onClick={onDisconnectZettle} disabled={zettleAction === "disconnect" || zettleStatus === "not_connected"}>
              {zettleAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
            </button>
            <a className="admin-button admin-button-secondary" href="https://developer.zettle.com/" target="_blank" rel="noreferrer">Open Zettle Developer Portal</a>
            <Link className="admin-button admin-button-secondary" to="/sales">Open sales</Link>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Planday</h2>
          <p className={`admin-status-badge is-${plandayStatus}`}>{getPlandayStatusLabel(plandayStatus)}</p>
          {plandayLoading ? <p>Loading Planday status...</p> : null}
          {plandayError ? <p className="forms-error">{plandayError}</p> : null}
          {plandayMessage ? <p className="forms-success">{plandayMessage}</p> : null}
          <p className="admin-muted">Used to fetch labor costs from the Time and Cost API. Tokens are stored server-side in Firebase Functions.</p>
          <div className="admin-detail-list">
            <p><strong>Connected by:</strong> {plandayConnection?.connectedByEmail || "-"}</p>
            <p><strong>Connected at:</strong> {formatDateTime(plandayConnection?.connectedAt)}</p>
            <p><strong>Scope:</strong> {plandayConnection?.scope || "-"}</p>
            <p><strong>Employees found:</strong> {plandayConnection?.employeeCount ?? "-"}</p>
            <p><strong>Last error:</strong> {plandayConnection?.lastError || "-"}</p>
          </div>
          <div className="admin-inline-actions">
            <button type="button" className="admin-button" onClick={onConnectPlanday} disabled={plandayAction === "connect"}>
              {plandayAction === "connect" ? "Connecting..." : "Connect Planday"}
            </button>
            <button type="button" className="admin-button admin-button-secondary" onClick={onDisconnectPlanday} disabled={plandayAction === "disconnect" || plandayStatus === "not_connected"}>
              {plandayAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
          <hr className="admin-divider" />
          <label htmlFor="planday-department-ids">Department IDs for labor costs</label>
          <textarea
            id="planday-department-ids"
            className="admin-text-input"
            rows={3}
            value={plandayDepartmentIdsInput}
            onChange={(event) => setPlandayDepartmentIdsInput(event.target.value)}
            disabled={plandaySettingsLoading || plandaySettingsSaving}
            placeholder="Example: 101, 102, 205"
          />
          <p className="admin-muted">Enter one or more Planday department IDs, separated by commas or line breaks.</p>
          {plandaySettingsError ? <p className="forms-error">{plandaySettingsError}</p> : null}
          {plandaySettingsMessage ? <p className="forms-success">{plandaySettingsMessage}</p> : null}
          <div className="admin-inline-actions">
            <button type="button" className="admin-button" onClick={onSavePlandaySettings} disabled={plandaySettingsLoading || plandaySettingsSaving}>
              {plandaySettingsSaving ? "Saving..." : "Save departments"}
            </button>
            <Link className="admin-button admin-button-secondary" to="/sales">Open sales</Link>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Employee Salary Rates</h2>
          <p className="admin-muted">Open this section to view and edit employee hourly salary rates.</p>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={() => setShowEmployeeRates((prev) => !prev)}
            >
              {showEmployeeRates ? "Hide Salary Rates" : "Open Salary Rates"}
            </button>
          </div>
        </section>
      ) : null}

      {/* ✅ Employee Salary Rates Section */}
      {isAdmin ? (
        <section className="admin-panel" style={{ display: showEmployeeRates ? "grid" : "none" }}>
          <h2>Employee Hourly Rates</h2>
          <p className="admin-muted">
            Set the hourly wage for each employee. Rates are used to calculate salary
            costs in the financial report. Employees are automatically synced from Planday.
          </p>

          {/* ✅ Summary badges */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
            <span style={{
              background: missingRateCount > 0 ? "#FCEBEB" : "#EAF3DE",
              color: missingRateCount > 0 ? "#A32D2D" : "#3B6D11",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: 500,
            }}>
              {missingRateCount > 0
                ? `⚠️ ${missingRateCount} employee${missingRateCount > 1 ? "s" : ""} missing rates`
                : "✅ All employees have rates set"}
            </span>
            <span style={{
              background: "var(--color-background-secondary)",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
            }}>
              {employees.length} total employees
            </span>
          </div>

          {/* ✅ Filter buttons */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            {["all", "missing", "set"].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setEmployeeFilter(f)}
                style={{
                  padding: "4px 14px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-secondary)",
                  background: employeeFilter === f ? "var(--color-background-secondary)" : "transparent",
                  fontWeight: employeeFilter === f ? 600 : 400,
                  cursor: "pointer",
                  fontSize: "13px",
                  color: "var(--color-text-primary)",
                }}
              >
                {f === "all" ? "All" : f === "missing" ? "Missing rates" : "Rates set"}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gap: "12px", marginBottom: "24px", padding: "16px", border: "1px solid var(--color-border-secondary)", borderRadius: "12px", background: "var(--color-background-secondary)" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Name"
                value={newEmployeeInputs.name}
                onChange={(e) => setNewEmployeeInputs((prev) => ({ ...prev, name: e.target.value }))}
                style={{ flex: "1 1 180px", minWidth: "180px", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border-secondary)", fontSize: "13px" }}
              />
              <input
                type="text"
                placeholder="Location"
                value={newEmployeeInputs.location}
                onChange={(e) => setNewEmployeeInputs((prev) => ({ ...prev, location: e.target.value }))}
                style={{ flex: "1 1 140px", minWidth: "140px", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border-secondary)", fontSize: "13px" }}
              />
              <input
                type="text"
                placeholder="Salary ID"
                value={newEmployeeInputs.salaryId}
                onChange={(e) => setNewEmployeeInputs((prev) => ({ ...prev, salaryId: e.target.value }))}
                style={{ flex: "1 1 120px", minWidth: "120px", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border-secondary)", fontSize: "13px" }}
              />
              <input
                type="text"
                placeholder="Planday ID"
                value={newEmployeeInputs.plandayId}
                onChange={(e) => setNewEmployeeInputs((prev) => ({ ...prev, plandayId: e.target.value }))}
                style={{ flex: "1 1 120px", minWidth: "120px", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border-secondary)", fontSize: "13px" }}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Rate"
                value={newEmployeeInputs.rate}
                onChange={(e) => setNewEmployeeInputs((prev) => ({ ...prev, rate: e.target.value }))}
                style={{ flex: "1 1 120px", minWidth: "120px", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border-secondary)", fontSize: "13px" }}
              />
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="admin-button"
                onClick={onAddEmployee}
                style={{ fontSize: "13px", padding: "8px 14px" }}
              >
                Add new employee
              </button>
              {newEmployeeMessage ? (
                <span style={{ fontSize: "13px", color: newEmployeeMessage.type === "success" ? "#3B6D11" : "#A32D2D" }}>
                  {newEmployeeMessage.text}
                </span>
              ) : null}
            </div>
          </div>

          {employeesLoading ? <p>Loading employees...</p> : null}

          {!employeesLoading && filteredEmployees.length === 0 ? (
            <p className="admin-muted">
              {employeeFilter === "missing"
                ? "✅ No employees missing rates!"
                : "No employees found. Generate a financial report to sync employees from Planday."}
            </p>
          ) : null}

          {!employeesLoading && filteredEmployees.length > 0 ? (
            <div className="financial-table-wrap">
              <table className="financial-table">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Location</th>
                    <th scope="col">Salary ID</th>
                    <th scope="col">Planday ID</th>
                    <th scope="col">Current Rate (kr/hr)</th>
                    <th scope="col">New Rate</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => {
                    const isMissing = !emp.rate;
                    const msg = employeeMessages[emp.id];
                    return (
                      <tr
                        key={emp.id}
                        style={isMissing ? { background: "rgba(252,235,235,0.4)" } : {}}
                      >
                        <td>
                          <span style={{ fontWeight: 500 }}>{emp.name || "(no name)"}</span>
                          {isMissing ? (
                            <span style={{
                              marginLeft: "8px",
                              fontSize: "11px",
                              background: "#FCEBEB",
                              color: "#A32D2D",
                              padding: "2px 6px",
                              borderRadius: "4px",
                            }}>
                              No rate
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Location"
                            value={employeeEdits[emp.id]?.location ?? ""}
                            onChange={(e) =>
                              setEmployeeEdits((prev) => ({
                                ...prev,
                                [emp.id]: {
                                  ...prev[emp.id],
                                  location: e.target.value,
                                },
                              }))
                            }
                            style={{
                              width: "140px",
                              padding: "6px 8px",
                              border: "1px solid var(--color-border-secondary)",
                              borderRadius: "6px",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Salary ID"
                            value={employeeEdits[emp.id]?.salaryId ?? ""}
                            onChange={(e) =>
                              setEmployeeEdits((prev) => ({
                                ...prev,
                                [emp.id]: {
                                  ...prev[emp.id],
                                  salaryId: e.target.value,
                                },
                              }))
                            }
                            style={{
                              width: "120px",
                              padding: "6px 8px",
                              border: "1px solid var(--color-border-secondary)",
                              borderRadius: "6px",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Planday ID"
                            value={employeeEdits[emp.id]?.plandayId ?? ""}
                            onChange={(e) =>
                              setEmployeeEdits((prev) => ({
                                ...prev,
                                [emp.id]: {
                                  ...prev[emp.id],
                                  plandayId: e.target.value,
                                },
                              }))
                            }
                            style={{
                              width: "120px",
                              padding: "6px 8px",
                              border: "1px solid var(--color-border-secondary)",
                              borderRadius: "6px",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td>
                          {emp.rate
                            ? `${Number(emp.rate).toFixed(2)} kr`
                            : <span style={{ color: "#A32D2D" }}>Not set</span>}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 187.66"
                            value={employeeEdits[emp.id]?.rate ?? ""}
                            onChange={(e) =>
                              setEmployeeEdits((prev) => ({
                                ...prev,
                                [emp.id]: {
                                  ...prev[emp.id],
                                  rate: e.target.value,
                                },
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") onSaveEmployee(emp.id);
                            }}
                            style={{
                              width: "120px",
                              padding: "6px 8px",
                              border: "1px solid var(--color-border-secondary)",
                              borderRadius: "6px",
                              fontSize: "13px",
                            }}
                          />
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <button
                              type="button"
                              className="admin-button"
                              style={{ padding: "4px 12px", fontSize: "13px" }}
                              onClick={() => onSaveEmployee(emp.id)}
                              disabled={savingEmployeeId === emp.id}
                            >
                              {savingEmployeeId === emp.id ? "Saving..." : "Save"}
                            </button>
                            {msg ? (
                              <span style={{
                                fontSize: "12px",
                                color: msg.type === "success" ? "#3B6D11" : "#A32D2D",
                              }}>
                                {msg.text}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Applications for /jobb</h2>
          {settingsLoading ? <p>Loading settings...</p> : null}
          {settingsError ? <p className="forms-error">{settingsError}</p> : null}
          <p>Status: <strong>{JOB_PORTAL_STATUS_LABELS[portalStatus]}</strong></p>
          <label htmlFor="job-portal-status">Select status</label>
          <select
            id="job-portal-status"
            className="admin-status-select"
            value={portalStatus}
            onChange={(event) => setPortalStatus(event.target.value)}
            disabled={settingsLoading || saving}
          >
            <option value={JOB_PORTAL_STATUS_OPEN}>Apply (open)</option>
            <option value={JOB_PORTAL_STATUS_CLOSED}>Closed</option>
            <option value={JOB_PORTAL_STATUS_WAITLIST}>Register email</option>
          </select>
          <button type="button" className="admin-button" onClick={onSavePortalStatus} disabled={settingsLoading || saving}>
            {saving ? "Saving..." : "Save status"}
          </button>
          {statusMessage ? <p className="forms-success">{statusMessage}</p> : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Emails for /jobb notifications</h2>
          {waitlistLoading ? <p>Loading emails...</p> : null}
          {waitlistError ? <p className="forms-error">{waitlistError}</p> : null}
          {!waitlistLoading && !waitlistError && waitlistEntries.length === 0 ? (
            <p>No registered emails yet.</p>
          ) : null}
          {!waitlistLoading && waitlistEntries.length > 0 ? (
            <div className="admin-email-list" role="list">
              {waitlistEntries.map((entry) => (
                <div key={entry.id} className="admin-email-item" role="listitem">
                  <p className="admin-email-contact">
                    <span className="admin-email-name">{entry.name || "(no name)"}</span>
                    {entry.email || "(no email)"}
                  </p>
                  <div className="admin-email-actions">
                    <span>{formatDateTime(entry.createdAt)}</span>
                    <button
                      type="button"
                      className="admin-button admin-button-danger admin-delete-button"
                      onClick={() => onRequestDeleteWaitlistEntry(entry)}
                      disabled={deletingEntryId === entry.id}
                    >
                      {deletingEntryId === entry.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default Admin;
