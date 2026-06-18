import { useState, useEffect } from "react";
import {
  doc, onSnapshot, setDoc, serverTimestamp,
  collection, addDoc, query, orderBy, limit, getDocs,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSave } from "@fortawesome/free-solid-svg-icons";
import "./BestillingAdmin.css";

const PRICES_DOC = doc(db, "siteSettings", "bestillingPrices");
const AUDIT_COL = collection(db, "priceAuditLog");

function BestillingAdmin() {
  const [pizzaPrice, setPizzaPrice] = useState("");
  const [sodaPrice, setSodaPrice] = useState("");
  const [dressingPrice, setDressingPrice] = useState("");
  const [prevPrices, setPrevPrices] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", msg: "" });
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cateringOrders, setCateringOrders] = useState([]);
  const [largeOrders, setLargeOrders] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(PRICES_DOC, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPizzaPrice(String(d.pizzaPrice ?? ""));
        setSodaPrice(String(d.sodaPrice ?? ""));
        setDressingPrice(String(d.dressingPrice ?? ""));
        setPrevPrices({ pizzaPrice: d.pizzaPrice, sodaPrice: d.sodaPrice, dressingPrice: d.dressingPrice });
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    getDocs(query(AUDIT_COL, orderBy("changedAt", "desc"), limit(20)))
      .then((snap) => setAuditLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [saving]);

  useEffect(() => {
    const unsub1 = onSnapshot(
      query(collection(db, "cateringRequests"), orderBy("createdAt", "desc"), limit(15)),
      (snap) => setCateringOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    const unsub2 = onSnapshot(
      query(collection(db, "largeOrders"), orderBy("createdAt", "desc"), limit(15)),
      (snap) => setLargeOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    return () => { unsub1(); unsub2(); };
  }, []);

  async function handleSave() {
    const pp = Number(pizzaPrice);
    const sp = Number(sodaPrice);
    const dp = Number(dressingPrice);
    if ([pp, sp, dp].some((v) => !Number.isFinite(v) || v < 0)) {
      setStatus({ type: "error", msg: "Alle priser må være gyldige tall ≥ 0." });
      return;
    }

    setSaving(true);
    setStatus({ type: "", msg: "" });
    try {
      const email = auth.currentUser?.email || "unknown";
      await setDoc(PRICES_DOC, { pizzaPrice: pp, sodaPrice: sp, dressingPrice: dp, updatedAt: serverTimestamp(), updatedBy: email }, { merge: true });

      const changes = [];
      if (prevPrices?.pizzaPrice !== pp) changes.push({ field: "pizzaPrice", oldValue: prevPrices?.pizzaPrice, newValue: pp });
      if (prevPrices?.sodaPrice !== sp) changes.push({ field: "sodaPrice", oldValue: prevPrices?.sodaPrice, newValue: sp });
      if (prevPrices?.dressingPrice !== dp) changes.push({ field: "dressingPrice", oldValue: prevPrices?.dressingPrice, newValue: dp });
      for (const c of changes) {
        await addDoc(AUDIT_COL, { ...c, changedBy: email, changedAt: serverTimestamp() });
      }
      setStatus({ type: "success", msg: "Priser oppdatert!" });
    } catch {
      setStatus({ type: "error", msg: "Kunne ikke lagre. Prøv igjen." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="ba-loading">Laster priser…</div>;

  return (
    <div className="ba-page">
      <h1>Bestillingspriser</h1>
      <p>Endre prisene som brukes i priskalkulatoren for storbestillinger. Endringer trer i kraft umiddelbart.</p>

      <div className="ba-card">
        <h2>Priser per enhet</h2>
        <div className="ba-fields">
          <div className="ba-field">
            <label>Pizza (per stk)<input type="number" min="0" step="1" value={pizzaPrice} onChange={(e) => setPizzaPrice(e.target.value)} /></label>
            <span className="ba-unit">kr</span>
          </div>
          <div className="ba-field">
            <label>Brus (per stk)<input type="number" min="0" step="1" value={sodaPrice} onChange={(e) => setSodaPrice(e.target.value)} /></label>
            <span className="ba-unit">kr</span>
          </div>
          <div className="ba-field">
            <label>Dressing (per stk)<input type="number" min="0" step="1" value={dressingPrice} onChange={(e) => setDressingPrice(e.target.value)} /></label>
            <span className="ba-unit">kr</span>
          </div>
        </div>
        <div className="ba-actions">
          <button className="ba-save" onClick={handleSave} disabled={saving}>
            {saving ? "Lagrer…" : "Lagre priser"} {!saving && <FontAwesomeIcon icon={faSave} />}
          </button>
          {status.msg && <span className={`ba-status ${status.type}`}>{status.msg}</span>}
        </div>

        <div className="ba-audit">
          <h3>Endringslogg</h3>
          {auditLog.length === 0 ? (
            <p className="ba-audit-empty">Ingen endringer ennå.</p>
          ) : (
            <div className="ba-audit-list">
              {auditLog.map((entry) => {
                const d = entry.changedAt?.toDate?.();
                const dateStr = d ? `${d.toLocaleDateString("nb-NO")} ${d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}` : "";
                return (
                  <div key={entry.id} className="ba-audit-item">
                    <strong>{entry.field}</strong>: {entry.oldValue} → {entry.newValue} kr — {entry.changedBy} — {dateStr}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="ba-card">
        <h2>Siste cateringforespørsler</h2>
        {cateringOrders.length === 0 ? <p className="ba-empty">Ingen forespørsler ennå.</p> : cateringOrders.map((o) => {
          const d = o.createdAt?.toDate?.();
          return (
            <div key={o.id} className="ba-order-item">
              <strong>{o.name}</strong> — {o.cateringType}
              <div className="ba-order-meta">{o.email} · {o.phone} · {o.date}{d && ` · ${d.toLocaleDateString("nb-NO")}`}</div>
              {o.address && <div className="ba-order-meta">{o.address}</div>}
            </div>
          );
        })}
      </div>

      <div className="ba-card">
        <h2>Siste storbestillinger</h2>
        {largeOrders.length === 0 ? <p className="ba-empty">Ingen bestillinger ennå.</p> : largeOrders.map((o) => {
          const d = o.createdAt?.toDate?.();
          return (
            <div key={o.id} className="ba-order-item">
              <strong>{o.name}</strong> — {o.pizzaQuantity} pizza, {o.sodaQuantity} brus, {o.dressingQuantity} dressing
              <div className="ba-order-meta">{o.email} · {o.phone}{o.priceSnapshot?.estimatedTotal && ` · ${o.priceSnapshot.estimatedTotal.toLocaleString("nb-NO")} kr`}{d && ` · ${d.toLocaleDateString("nb-NO")}`}</div>
              {o.address && <div className="ba-order-meta">{o.address}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BestillingAdmin;
