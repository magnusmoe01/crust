import { useState, useEffect, useRef, useMemo } from "react";
import { doc, onSnapshot, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane, faCircleCheck, faArrowRight } from "@fortawesome/free-solid-svg-icons";
import PizzaMenu from "../components/PizzaMenu";
import "./LargeOrder.css";

const FOODORA_URL = "https://www.foodora.no/en/restaurant/o1ss/crustn-trust";

const PIZZA_QTYS = [20, 25, 30, 40, 50, 60, 80, 100];
const SODA_QTYS = [0, 20, 25, 30, 40, 50, 60, 80, 100];
const DRESSING_QTYS = [0, 10, 20, 25, 30, 40, 50, 60, 80, 100];

const DEFAULT_PRICES = { pizzaPrice: 89, sodaPrice: 35, dressingPrice: 15 };

const INITIAL = {
  name: "", phone: "", email: "", address: "",
  pizzaQuantity: "20", sodaQuantity: "0", dressingQuantity: "0",
  deliveryDate: "", deliveryComments: "", selectionComments: "",
};

function LargeOrder() {
  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [prices, setPrices] = useState(DEFAULT_PRICES);
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const honeypotRef = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "siteSettings", "bestillingPrices"),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setPrices({
            pizzaPrice: d.pizzaPrice ?? DEFAULT_PRICES.pizzaPrice,
            sodaPrice: d.sodaPrice ?? DEFAULT_PRICES.sodaPrice,
            dressingPrice: d.dressingPrice ?? DEFAULT_PRICES.dressingPrice,
          });
        }
        setPricesLoaded(true);
      },
      () => setPricesLoaded(true),
    );
    return unsub;
  }, []);

  const estimatedTotal = useMemo(() => {
    const pq = Number(form.pizzaQuantity) || 0;
    const sq = Number(form.sodaQuantity) || 0;
    const dq = Number(form.dressingQuantity) || 0;
    return pq * prices.pizzaPrice + sq * prices.sodaPrice + dq * prices.dressingPrice;
  }, [form.pizzaQuantity, form.sodaQuantity, form.dressingQuantity, prices]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "Navn er påkrevd";
    if (!form.phone.trim()) e.phone = "Telefon er påkrevd";
    if (!form.email.trim()) e.email = "E-post er påkrevd";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Ugyldig e-postadresse";
    if (!form.address.trim()) e.address = "Adresse er påkrevd";
    if (!form.deliveryDate) e.deliveryDate = "Velg dato og tid";
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    if (honeypotRef.current?.value) return;
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const orderData = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        pizzaQuantity: Number(form.pizzaQuantity),
        sodaQuantity: Number(form.sodaQuantity),
        dressingQuantity: Number(form.dressingQuantity),
        deliveryDate: form.deliveryDate,
        deliveryComments: form.deliveryComments.trim(),
        selectionComments: form.selectionComments.trim(),
        priceSnapshot: { ...prices, estimatedTotal },
        status: "pending",
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, "largeOrders"), orderData);
      setShowSuccess(true);
      setForm(INITIAL);
      httpsCallable(functions, "sendLargeOrderNotification")(orderData).catch(() => {});
    } catch {
      setSubmitError("Noe gikk galt. Prøv igjen eller send e-post til event@crust.no.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lo-page">
      {/* Hero */}
      <section className="lo-hero">
        <h1>Mange Pizzaer</h1>
        <p>Levert og laget av ungdommer i sin aller første jobb?</p>
        <a href={FOODORA_URL} target="_blank" rel="noopener noreferrer" className="lo-hero-link">
          For en mindre bestilling, klikk her <FontAwesomeIcon icon={faArrowRight} />
        </a>
      </section>

      {/* Menu */}
      <section className="lo-menu" aria-label="Vårt utvalg">
        <h2>Vårt utvalg</h2>
        <p>Her er pizzaene du kan velge mellom.</p>
        <PizzaMenu />
      </section>

      {/* Form */}
      <section className="lo-form-section" id="order-form" aria-label="Storbestilling skjema">
        <h2>Storbestilling</h2>
        <p>Fyll ut skjemaet for å sende en forespørsel.</p>

        <form className="lo-form" onSubmit={handleSubmit} noValidate>
          <div className="lo-hp" aria-hidden="true">
            <label>Ikke fyll ut<input type="text" name="company_url" tabIndex={-1} autoComplete="off" ref={honeypotRef} /></label>
          </div>

          <div className="lo-form-row">
            <label>Navn *
              <input type="text" name="name" value={form.name} onChange={handleChange} className={errors.name ? "is-invalid" : ""} autoComplete="name" required />
              {errors.name && <span className="lo-field-error" role="alert">{errors.name}</span>}
            </label>
            <label>Telefon *
              <input type="tel" name="phone" value={form.phone} onChange={handleChange} className={errors.phone ? "is-invalid" : ""} autoComplete="tel" required />
              {errors.phone && <span className="lo-field-error" role="alert">{errors.phone}</span>}
            </label>
          </div>

          <label>E-post *
            <input type="email" name="email" value={form.email} onChange={handleChange} className={errors.email ? "is-invalid" : ""} autoComplete="email" required />
            {errors.email && <span className="lo-field-error" role="alert">{errors.email}</span>}
          </label>

          <label>Adresse (leveringssted) *
            <input type="text" name="address" value={form.address} onChange={handleChange} className={errors.address ? "is-invalid" : ""} placeholder="Gateadresse, postnummer, by" autoComplete="street-address" required />
            {errors.address && <span className="lo-field-error" role="alert">{errors.address}</span>}
          </label>

          {/* Quantities */}
          <div className="lo-form-row-3">
            <label>Antall pizzaer
              <select name="pizzaQuantity" value={form.pizzaQuantity} onChange={handleChange}>
                {PIZZA_QTYS.map((q) => <option key={q} value={q}>{q} stk</option>)}
              </select>
            </label>
            <label>Antall brus
              <select name="sodaQuantity" value={form.sodaQuantity} onChange={handleChange}>
                {SODA_QTYS.map((q) => <option key={q} value={q}>{q === 0 ? "Ingen" : `${q} stk`}</option>)}
              </select>
            </label>
            <label>Antall dressinger
              <select name="dressingQuantity" value={form.dressingQuantity} onChange={handleChange}>
                {DRESSING_QTYS.map((q) => <option key={q} value={q}>{q === 0 ? "Ingen" : `${q} stk`}</option>)}
              </select>
            </label>
          </div>

          {/* Price calculator */}
          <div className="lo-price-calc" aria-live="polite">
            {pricesLoaded ? (
              <>
                <div>
                  <div className="lo-price-label">Estimert pris</div>
                  <div className="lo-price-total">{estimatedTotal.toLocaleString("nb-NO")} kr</div>
                </div>
                <p className="lo-price-note">Endelig pris bekreftes av oss etter forespørselen er mottatt.</p>
              </>
            ) : (
              <span className="lo-price-loading">Laster priser…</span>
            )}
          </div>

          <label>Ønsket leveringsdato og tid *
            <input type="datetime-local" name="deliveryDate" value={form.deliveryDate} onChange={handleChange} className={errors.deliveryDate ? "is-invalid" : ""} min={new Date().toISOString().slice(0, 16)} required />
            {errors.deliveryDate && <span className="lo-field-error" role="alert">{errors.deliveryDate}</span>}
          </label>

          <label>Leveringskommentarer
            <textarea name="deliveryComments" value={form.deliveryComments} onChange={handleChange} placeholder="F.eks. inngang, heis, parkering…" />
          </label>

          <label>Ønsker for utvalg / smak
            <textarea name="selectionComments" value={form.selectionComments} onChange={handleChange} placeholder="F.eks. ekstra mange Margherita, allergier…" />
          </label>

          {submitError && <p className="lo-form-error" role="alert">{submitError}</p>}

          <button type="submit" className="lo-form-submit" disabled={submitting}>
            {submitting ? "Sender…" : "Send forespørsel"} {!submitting && <FontAwesomeIcon icon={faPaperPlane} />}
          </button>
        </form>
      </section>

      {/* Success modal */}
      {showSuccess && (
        <div className="lo-modal-backdrop" role="dialog" aria-modal="true" aria-label="Forespørsel sendt"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSuccess(false); }}>
          <div className="lo-modal-card">
            <div className="lo-modal-icon"><FontAwesomeIcon icon={faCircleCheck} /></div>
            <h3>Forespørselen din er notert!</h3>
            <p>Vi kontakter deg for å bekrefte detaljer og se hvordan vi kan oppfylle bestillingen din.</p>
            <button type="button" className="lo-modal-close" onClick={() => setShowSuccess(false)}>Lukk</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LargeOrder;
