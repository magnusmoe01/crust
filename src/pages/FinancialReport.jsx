import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAdminSession } from "../hooks/useAdminSession";
import { loadFinancialReport } from "../services/financialReportApi";
import "./Admin.css";
import "./FinancialReport.css";

/* =========================
   CACHE CONFIG
========================= */
const CACHE_TTL = 60 * 60 * 1000; // 1 hour (payroll data can change during the day)

function getCacheKey(startDate, endDate, locations, csvSignature = "none") {
  return `financial_report_${startDate}_${endDate}_${locations.sort().join(",")}_${csvSignature}`;
}

function setCache(key, data) {
  localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
}

function getCache(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/* =========================
   HELPERS
========================= */
function getDefaultRange() {
  const end   = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  return { startDate: fmt(start), endDate: fmt(end) };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("nb-NO", {
    style:    "currency",
    currency: "NOK",
  }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function toNumber(value) {
  const text = String(value || "").trim().replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findHeaderIndex(headers, candidates) {
  return headers.findIndex((h) => candidates.some((candidate) => h === candidate));
}

function normalizeReportLocation(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "bergen") return "Bergen";
  if (raw === "gj\u00f8vik" || raw === "gjovik" || (raw.includes("gj") && raw.includes("vik"))) return "Gj\u00f8vik";
  return "Oslo";
}
function parsePayrollCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
  const idxEmp = headers.findIndex((h) => h === "ansattnummer" || h === "employeeid" || h === "employee id");
  const idxUnits = headers.findIndex((h) => h === "antall" || h === "hours");
  const idxRate = headers.findIndex((h) => h === "sats" || h === "rate");
  const idxDepartmentId = headers.findIndex((h) => h === "departmentid" || h === "department id");
  const idxDepartment = headers.findIndex((h) => h === "department" || h === "avdeling");
  const idxLocation = headers.findIndex((h) => h === "location" || h === "lokasjon");

  if (idxEmp < 0 || idxUnits < 0 || idxRate < 0) {
    throw new Error("CSV headers must include Ansattnummer, Antall, and Sats.");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(";");
    const employeeId = String(cols[idxEmp] || "").trim();
    const units = toNumber(cols[idxUnits]);
    const rate = toNumber(cols[idxRate]);
    const departmentId = idxDepartmentId >= 0 ? String(cols[idxDepartmentId] || "").trim() : "";
    const department = idxDepartment >= 0 ? String(cols[idxDepartment] || "").trim() : "";
    const location = idxLocation >= 0 ? String(cols[idxLocation] || "").trim() : "";
    if (!employeeId || units <= 0 || rate < 0) continue;
    rows.push({
      employeeId,
      units,
      rate,
      amount: units * rate,
      departmentId,
      department,
      location,
    });
  }

  return rows;
}

function parseIncomeCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
  const idxLoc = headers.findIndex((h) => h === "location" || h === "lokasjon" || h === "department");
  const idxAmount = headers.findIndex((h) => h === "income" || h === "amount" || h === "bel�p" || h === "belop");
  if (idxLoc < 0 || idxAmount < 0) {
    throw new Error("Income CSV needs Location and Amount columns.");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(";");
    const location = String(cols[idxLoc] || "").trim();
    const amount = toNumber(cols[idxAmount]);
    if (!location) continue;
    rows.push({ location, amount });
  }
  return rows;
}

function parseEmployeeLocationCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return {};
  const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
  const idxEmp = findHeaderIndex(headers, [
    "ansattnummer",
    "ansatt nr",
    "ansatt number",
    "employeeid",
    "employee id",
    "employee number",
    "empid",
    "emp id",
  ]);
  const idxSalary = findHeaderIndex(headers, [
    "salaryid",
    "salary id",
    "salary number",
    "salarynr",
    "salary nr",
  ]);
  const idxPlanday = findHeaderIndex(headers, [
    "plandayid",
    "planday id",
    "planday employee id",
    "planday employeeid",
    "planday employee",
  ]);
  const idxLoc = findHeaderIndex(headers, ["location", "lokasjon", "site"]);
  if (idxLoc < 0 || (idxEmp < 0 && idxSalary < 0 && idxPlanday < 0)) {
    throw new Error("Employee map CSV needs Ansattnummer/EmployeeId/SalaryId/PlandayId and Location columns.");
  }

  const map = {};
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(";");
    const employeeId = idxEmp >= 0 ? String(cols[idxEmp] || "").trim() : "";
    const salaryId = idxSalary >= 0 ? String(cols[idxSalary] || "").trim() : "";
    const plandayId = idxPlanday >= 0 ? String(cols[idxPlanday] || "").trim() : "";
    const key = employeeId || salaryId || plandayId;
    const location = normalizeReportLocation(cols[idxLoc]);
    if (key && location) map[key] = location;
  }
  return map;
}

/* =========================
   LOCATION DROPDOWN
========================= */
function LocationDropdown({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  const values     = options.filter((o) => o.value !== "all").map((o) => o.value);
  const allSelected = values.every((v) => selected.includes(v));

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleAll = () => onChange(allSelected ? [] : [...values]);
  const toggle    = (val) =>
    onChange(
      selected.includes(val)
        ? selected.filter((v) => v !== val)
        : [...selected, val]
    );

  return (
    <div className="location-dropdown" ref={ref}>
      <button
        className="location-dropdown-trigger"
        onClick={() => setOpen(!open)}
      >
        {allSelected || selected.length === 0 ? "All locations" : `${selected.length} selected`}
        <span className={`location-dropdown-arrow ${open ? "open" : ""}`}>v</span>
      </button>

      {open && (
        <div className="location-dropdown-menu">
          <label className="location-dropdown-item">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            All locations
          </label>
          <div className="location-dropdown-divider" />
          {values.map((v, i) => (
            <label key={`${v}-${i}`} className="location-dropdown-item">
              <input
                type="checkbox"
                checked={selected.includes(v)}
                onChange={() => toggle(v)}
              />
              {v}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================
   MAIN COMPONENT
========================= */
export default function FinancialReport() {
  const { isAdmin } = useAdminSession();

  const defaults = useMemo(() => getDefaultRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate,   setEndDate]   = useState(defaults.endDate);
  const [locations, setLocations] = useState([]);
  const [locationOptions, setLocationOptions] = useState([{ value: "all", label: "All" }]);

  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [csvPayrollRows, setCsvPayrollRows] = useState([]);
  const [csvStatus, setCsvStatus] = useState("");
  const [csvIncomeRows, setCsvIncomeRows] = useState([]);
  const [incomeCsvStatus, setIncomeCsvStatus] = useState("");
  const [employeeLocationMap, setEmployeeLocationMap] = useState({});
  const [employeeMapStatus, setEmployeeMapStatus] = useState("");

  const csvSignature = useMemo(() => {
    if (!csvPayrollRows.length) return "none";
    const total = csvPayrollRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return `${csvPayrollRows.length}_${Math.round(total * 100)}`;
  }, [csvPayrollRows]);
  const incomeCsvSignature = useMemo(() => {
    if (!csvIncomeRows.length) return "none";
    const total = csvIncomeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return `${csvIncomeRows.length}_${Math.round(total * 100)}`;
  }, [csvIncomeRows]);
  const employeeMapSignature = useMemo(
    () => `${Object.keys(employeeLocationMap || {}).length}`,
    [employeeLocationMap]
  );

  /* =========================
     LOAD LOCATIONS
  ========================= */
  useEffect(() => {
    if (!isAdmin) return;
    setLocationOptions([
      { value: "all", label: "All" },
      { value: "Oslo", label: "Oslo" },
      { value: "Bergen", label: "Bergen" },
      { value: "Gj\u00f8vik", label: "Gj\u00f8vik" },
    ]);
    if (locations.length === 0) setLocations(["Oslo", "Bergen", "Gj\u00f8vik"]);
  }, [isAdmin, locations.length]);

  /* =========================
     GENERATE REPORT
  ========================= */
  const generateReport = async () => {
    setLoading(true);
    setError("");
    setProgress(15);
    setProgressLabel("Preparing request...");

    try {
      const fullSignature = `${csvSignature}_${incomeCsvSignature}_${employeeMapSignature}`;
      const cacheKeyWithCsv = getCacheKey(startDate, endDate, locations, fullSignature);
      const cached   = getCache(cacheKeyWithCsv);

      if (cached) {
        setReport(cached);
        setProgress(100);
        setProgressLabel("Report loaded from cache");
        setLoading(false);
        return;
      }

      setProgress(35);
      setProgressLabel("Fetching payroll and income data...");

      // Salary + income fetched automatically from Planday & Zettle APIs
      const data = await loadFinancialReport(
        startDate,
        endDate,
        locations,
        csvPayrollRows,
        csvIncomeRows,
        employeeLocationMap
      );

      setProgress(85);
      setProgressLabel("Finalizing report...");
      setReport(data);
      setCache(cacheKeyWithCsv, data);
      setProgress(100);
      setProgressLabel("Report ready");
    } catch (err) {
      console.error("REPORT ERROR:", err);
      setError(err.message || "Could not generate report");
      setProgress(100);
      setProgressLabel("Report failed");
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     PDF EXPORT
  ========================= */
  const exportPDF = () => {
    if (!report) return;

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Financial Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${report.startDate} -> ${report.endDate}`, 14, 28);

    const rows = Object.entries(report.byLocation || {}).map(([loc, d]) => [
      loc,
      formatCurrency(d.income),
      formatCurrency(d.salary),
      d.hours?.toFixed(2) ?? "-",
      formatCurrency(d.profit),
      formatPercent(d.marginPercent),
    ]);

    autoTable(doc, {
      startY: 35,
      head:   [["Location", "Income", "Salary", "Hours", "Profit", "Margin"]],
      body:   rows,
      foot:   [[
        "TOTAL",
        formatCurrency(report.totalIncome),
        formatCurrency(report.totalSalary),
        report.totalHours?.toFixed(2) ?? "-",
        formatCurrency(report.totalProfit),
        formatPercent(report.marginPercent),
      ]],
    });

    doc.save(`financial-report-${report.startDate}-${report.endDate}.pdf`);
  };

  /* =========================
     UI
  ========================= */
  return (
    <div className="admin-page financial-report-page">
      <div className="financial-report-top-row">
        <Link className="admin-button admin-button-secondary financial-back-btn" to="/admin">
          Back to Admin
        </Link>
      </div>
      <h1>Financial Report</h1>

      {/* -- Filters -- */}
      <div className="financial-filter-grid">
        <div className="financial-filter-field">
          <span>Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setReport(null); setProgress(0); setProgressLabel(""); }}
          />
        </div>

        <div className="financial-filter-field">
          <span>End</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setReport(null); setProgress(0); setProgressLabel(""); }}
          />
        </div>

        <div className="financial-filter-field">
          <span>Locations</span>
          <LocationDropdown
            options={locationOptions}
            selected={locations}
            onChange={(v) => { setLocations(v); setReport(null); setProgress(0); setProgressLabel(""); }}
          />
        </div>
      </div>

      <div className="financial-csv-upload">
        <span>Payroll CSV Fallback (optional)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            setReport(null);
            setCsvStatus("");
            setProgress(0);
            setProgressLabel("");
            setProgress(0);
            setProgressLabel("");
            const file = e.target.files?.[0];
            if (!file) {
              setCsvPayrollRows([]);
              return;
            }
            try {
              const text = await file.text();
              const rows = parsePayrollCsv(text);
              setCsvPayrollRows(rows);
              setCsvStatus(`Loaded ${rows.length} payroll rows from ${file.name}.`);
            } catch (parseError) {
              setCsvPayrollRows([]);
              setCsvStatus(parseError.message || "Could not parse CSV.");
            }
          }}
        />
        {csvStatus ? <small>{csvStatus}</small> : null}
      </div>

      <div className="financial-csv-upload">
        <span>Income CSV Fallback (optional)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            setReport(null);
            setIncomeCsvStatus("");
            setProgress(0);
            setProgressLabel("");
            setProgress(0);
            setProgressLabel("");
            const file = e.target.files?.[0];
            if (!file) {
              setCsvIncomeRows([]);
              return;
            }
            try {
              const text = await file.text();
              const rows = parseIncomeCsv(text);
              setCsvIncomeRows(rows);
              setIncomeCsvStatus(`Loaded ${rows.length} income rows from ${file.name}.`);
            } catch (parseError) {
              setCsvIncomeRows([]);
              setIncomeCsvStatus(parseError.message || "Could not parse income CSV.");
            }
          }}
        />
        {incomeCsvStatus ? <small>{incomeCsvStatus}</small> : null}
      </div>

      <div className="financial-csv-upload">
        <span>Employee Location Map CSV (optional)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            setReport(null);
            setEmployeeMapStatus("");
            setProgress(0);
            setProgressLabel("");
            const file = e.target.files?.[0];
            if (!file) {
              setEmployeeLocationMap({});
              return;
            }
            try {
              const text = await file.text();
              const map = parseEmployeeLocationCsv(text);
              setEmployeeLocationMap(map);
              setEmployeeMapStatus(`Loaded ${Object.keys(map).length} employee-location mappings from ${file.name}.`);
            } catch (parseError) {
              setEmployeeLocationMap({});
              setEmployeeMapStatus(parseError.message || "Could not parse mapping CSV.");
            }
          }}
        />
        {employeeMapStatus ? <small>{employeeMapStatus}</small> : null}
      </div>

      {/* -- Actions -- */}
      <div className="financial-actions-row">
        <button onClick={generateReport} disabled={loading}>
          {loading ? "Fetching from Planday & Zettle�" : "Generate Report"}
        </button>

        {report && (
          <button onClick={exportPDF} className="export-pdf-btn">
            Export PDF
          </button>
        )}
      </div>


      {(loading || progress > 0) && (
        <div className="financial-progress-container">
          <div className="financial-progress-bar-wrapper">
            <div
              className="financial-progress-bar"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <div className="financial-progress-label">
            {progressLabel || (loading ? "Generating report..." : "")}
          </div>
        </div>
      )}
      {error && <p className="financial-error">{error}</p>}
      {report?.warnings?.length ? (
        <div className="financial-warning-box">
          {report.warnings.join(" ")}
          {(report.incomeSource || report.salarySource) ? ` Sources: income=${report.incomeSource || "unknown"}, salary=${report.salarySource || "unknown"}.` : ""}
          {Array.isArray(report.unmatchedEmployeeIds) && report.unmatchedEmployeeIds.length
            ? ` Unmatched employee IDs: ${report.unmatchedEmployeeIds.slice(0, 10).join(", ")}${report.unmatchedEmployeeIds.length > 10 ? "..." : ""}.`
            : ""}
        </div>
      ) : null}

      {report?.unmatchedEmployeeIds?.length > 0 && (
        <div className="financial-unmatched-box">
          <h3>Unmatched Salary IDs ({report.unmatchedEmployeeIds.length})</h3>
          <p>These salary IDs could not be matched to locations automatically.</p>
          <ol>
            <li>Create a CSV file with columns: <code>SalaryId</code> and <code>Location</code></li>
            <li>Set location to one of: <code>Oslo</code>, <code>Bergen</code>, <code>Gj�vik</code></li>
            <li>Upload it in the Employee Location Map CSV field above</li>
          </ol>
          <details>
            <summary>Show unmatched IDs</summary>
            <div className="financial-unmatched-list">
              {report.unmatchedEmployeeIds.map((id, idx) => (
                <code key={idx}>{id}</code>
              ))}
            </div>
          </details>
          <button
            onClick={() => {
              const csv = ["SalaryId;Location"];
              report.unmatchedEmployeeIds.forEach((id) => {
                csv.push(`${id};Oslo`);
              });
              const blob = new Blob([csv.join("\n")], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `employee-mapping-template-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="admin-button admin-button-secondary"
          >
            Download CSV Template
          </button>
        </div>
      )}

      {/* -- Summary cards -- */}
      {report && (
        <>
          <div className="financial-summary-grid">
            <div className="financial-stat-card">
              <span>Total Income</span>
              <strong>{formatCurrency(report.totalIncome)}</strong>
            </div>

            <div className="financial-stat-card">
              <span>Total Salary Cost</span>
              <strong>{formatCurrency(report.totalSalary)}</strong>
            </div>

            <div className="financial-stat-card">
              <span>Total Hours</span>
              <strong>{report.totalHours?.toFixed(2)} hrs</strong>
            </div>

            <div className="financial-stat-card">
              <span>Profit / Loss</span>
              <strong style={{ color: report.totalProfit >= 0 ? "#22c55e" : "#ef4444" }}>
                {formatCurrency(report.totalProfit)}
              </strong>
            </div>

            <div className="financial-stat-card">
              <span>Margin</span>
              <strong style={{ color: report.marginPercent >= 0 ? "#22c55e" : "#ef4444" }}>
                {formatPercent(report.marginPercent)}
              </strong>
            </div>
          </div>

          {/* -- Per-location breakdown -- */}
          {report.byLocation && Object.keys(report.byLocation).length > 0 && (
            <div className="financial-table-wrapper">
              <table className="financial-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Income</th>
                    <th>Salary</th>
                    <th>Hours</th>
                    <th>Profit</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.byLocation).map(([loc, d]) => (
                    <tr key={loc}>
                      <td>{loc}</td>
                      <td>{formatCurrency(d.income)}</td>
                      <td>{formatCurrency(d.salary)}</td>
                      <td>{d.hours?.toFixed(2)}</td>
                      <td style={{ color: d.profit >= 0 ? "#22c55e" : "#ef4444" }}>
                        {formatCurrency(d.profit)}
                      </td>
                      <td style={{ color: d.marginPercent >= 0 ? "#22c55e" : "#ef4444" }}>
                        {formatPercent(d.marginPercent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td><strong>{formatCurrency(report.totalIncome)}</strong></td>
                    <td><strong>{formatCurrency(report.totalSalary)}</strong></td>
                    <td><strong>{report.totalHours?.toFixed(2)}</strong></td>
                    <td>
                      <strong style={{ color: report.totalProfit >= 0 ? "#22c55e" : "#ef4444" }}>
                        {formatCurrency(report.totalProfit)}
                      </strong>
                    </td>
                    <td>
                      <strong style={{ color: report.marginPercent >= 0 ? "#22c55e" : "#ef4444" }}>
                        {formatPercent(report.marginPercent)}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}














