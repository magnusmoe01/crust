import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db, functions } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Admin.css";

function parsePhones(raw) {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatTs(ts) {
  const date = ts?.toDate?.();
  if (!date) return "";
  return date.toLocaleString("nb-NO");
}

function Sms() {
  const { isAdmin, loading, user } = useAdminSession();
  const [phones, setPhones]     = useState("");
  const [message, setMessage]   = useState("");
  const [state, setState]       = useState({ sending: false, sentCount: 0, error: "" });
  const [history, setHistory]   = useState([]);

  useEffect(() => {
    const q = query(collection(db, "smsHistory"), orderBy("sentAt", "desc"));
    return onSnapshot(q, (snap) => {
      setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  if (loading) return <div className="loading-box">Laster...</div>;
  if (!isAdmin) return <Navigate to="/admin" replace />;

  const phoneList = parsePhones(phones);

  async function onSend(e) {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!phoneList.length || !trimmedMessage) return;

    setState({ sending: true, sentCount: 0, error: "" });
    try {
      await httpsCallable(functions, "sendManualSms")({
        phones:  phoneList,
        message: trimmedMessage,
      });
      await addDoc(collection(db, "smsHistory"), {
        phones:   phoneList,
        message:  trimmedMessage,
        sentBy:   user?.email || "ukjent",
        sentAt:   serverTimestamp(),
      });
      setState({ sending: false, sentCount: phoneList.length, error: "" });
      setPhones("");
      setMessage("");
    } catch (err) {
      setState({ sending: false, sentCount: 0, error: err.message || "Sending feilet" });
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Send SMS</h1>
      </div>

      <section className="admin-panel">
        <form className="admin-sms-form" onSubmit={onSend}>
          <label>
            <span>Telefonnummer</span>
            <textarea
              rows={4}
              value={phones}
              onChange={(e) => setPhones(e.target.value)}
              placeholder={"+4712345678\n+4787654321"}
            />
            <span className="field-hint">
              {phoneList.length > 0
                ? `${phoneList.length} mottaker${phoneList.length !== 1 ? "e" : ""}`
                : "Ett per linje, eller kommaseparert"}
            </span>
          </label>

          <label>
            <span>Melding</span>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Skriv melding her..."
              required
            />
            <span className="field-hint">{message.length} tegn</span>
          </label>

          {state.error ? <p className="forms-error">{state.error}</p> : null}
          {state.sentCount > 0 ? (
            <p className="forms-success">
              SMS sendt til {state.sentCount} mottaker{state.sentCount !== 1 ? "e" : ""}!
            </p>
          ) : null}

          <button
            type="submit"
            className="admin-button"
            disabled={state.sending || phoneList.length === 0}
          >
            {state.sending
              ? "Sender..."
              : phoneList.length > 1
                ? `Send til ${phoneList.length} mottakere`
                : "Send SMS"}
          </button>
        </form>
      </section>

      {history.length > 0 && (
        <section className="admin-panel">
          <h2>Historikk</h2>
          <div className="admin-sms-history">
            {history.map((item) => (
              <div key={item.id} className="admin-sms-history-item">
                <div className="admin-sms-history-meta">
                  <span className="admin-sms-history-time">{formatTs(item.sentAt)}</span>
                  <span className="admin-muted">av {item.sentBy}</span>
                </div>
                <p className="admin-sms-history-message">{item.message}</p>
                <p className="admin-sms-history-phones">
                  {Array.isArray(item.phones) ? item.phones.join(", ") : item.phones}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default Sms;
