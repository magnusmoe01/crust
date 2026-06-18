import { useState, useEffect, useRef, useMemo } from "react";
import { doc, onSnapshot, collection, addDoc, serverTimestamp, Timestamp } from "firebase/firestore";
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

const DEFAULT_PRICES = { pizzaPrice: 200, sodaPrice: 29, dressingPrice: 15 };

const MVA_RATE = 0.15;

function getVolumeDiscount(qty) {
  if (qty >= 100) return 0.20;
  if (qty >= 50) return 0.10;
  if (qty >= 25) return 0.05;
  return 0;
}

function getDiscountLabel(qty) {
  if (qty >= 100) return "20 % rabatt (100+ stk)";
  if (qty >= 50) return "10 % rabatt (50+ stk)";
  if (qty >= 25) return "5 % rabatt (25+ stk)";
  return null;
}

const MIN_ADVANCE_DAYS = 3;

function getMinDeliveryDate() {
  const d = new Date();
  d.setDate(d.getDate() + MIN_ADVANCE_DAYS);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatLocalDatetime(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
}

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

  const pricing = useMemo(() => {
    const pq = Number(form.pizzaQuantity) || 0;
    const sq = Number(form.sodaQuantity) || 0;
    const dq = Number(form.dressingQuantity) || 0;

    const pizzaSubtotal = pq * prices.pizzaPrice;
    const discountRate = getVolumeDiscount(pq);
    const discountAmount = Math.round(pizzaSubtotal * discountRate);
    const discountLabel = getDiscountLabel(pq);
    const sodaSubtotal = sq * prices.sodaPrice;
    const dressingSubtotal = dq * prices.dressingPrice;
    const totalInclMva = pizzaSubtotal - discountAmount + sodaSubtotal + dressingSubtotal;
    const totalExclMva = Math.round(totalInclMva / (1 + MVA_RATE));

    return {
      pq, sq, dq,
      pizzaSubtotal, discountRate, discountAmount, discountLabel,
      sodaSubtotal, dressingSubtotal,
      totalInclMva, totalExclMva,
    };
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
    if (!form.deliveryDate) {
      e.deliveryDate = "Velg dato og tid";
    } else {
      const selected = new Date(form.deliveryDate);
      if (isNaN(selected.getTime()) || selected < getMinDeliveryDate()) {
        e.deliveryDate = "Levering må bestilles minst 3 dager i forveien";
      }
    }
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
        deliveryTimestamp: Timestamp.fromDate(new Date(form.deliveryDate)),
        deliveryComments: form.deliveryComments.trim(),
        selectionComments: form.selectionComments.trim(),
        priceSnapshot: {
          ...prices,
          discountRate: pricing.discountRate,
          discountAmount: pricing.discountAmount,
          totalInclMva: pricing.totalInclMva,
          totalExclMva: pricing.totalExclMva,
        },
        status: "pending",
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, "largeOrders"), orderData);
      setShowSuccess(true);
      setForm(INITIAL);
      httpsCallable(functions, "sendLargeOrderNotification")(orderData).catch((e) => {
        console.error("sendLargeOrderNotification failed:", e?.message);
      });
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
                <div className="lo-price-breakdown">
                  <div className="lo-price-label">Prisestimat</div>

                  <div className="lo-breakdown-lines">
                    <div className="lo-breakdown-line">
                      <span>{pricing.pq} pizzaer × {prices.pizzaPrice} kr</span>
                      <span>{pricing.pizzaSubtotal.toLocaleString("nb-NO")} kr</span>
                    </div>
                    {pricing.discountAmount > 0 && (
                      <div className="lo-breakdown-line is-discount">
                        <span>{pricing.discountLabel}</span>
                        <span>−{pricing.discountAmount.toLocaleString("nb-NO")} kr</span>
                      </div>
                    )}
                    {pricing.sq > 0 && (
                      <div className="lo-breakdown-line">
                        <span>{pricing.sq} brus × {prices.sodaPrice} kr</span>
                        <span>{pricing.sodaSubtotal.toLocaleString("nb-NO")} kr</span>
                      </div>
                    )}
                    {pricing.dq > 0 && (
                      <div className="lo-breakdown-line">
                        <span>{pricing.dq} dressinger × {prices.dressingPrice} kr</span>
                        <span>{pricing.dressingSubtotal.toLocaleString("nb-NO")} kr</span>
                      </div>
                    )}
                  </div>

                  <div className="lo-breakdown-totals">
                    <div className="lo-breakdown-total-main">
                      <span>Totalt inkl. MVA</span>
                      <span className="lo-price-total">{pricing.totalInclMva.toLocaleString("nb-NO")} kr</span>
                    </div>
                    <div className="lo-breakdown-total-sub">
                      <span>Totalt ekskl. MVA</span>
                      <span>{pricing.totalExclMva.toLocaleString("nb-NO")} kr</span>
                    </div>
                  </div>
                </div>

                <p className="lo-price-note">Alle priser er inkl. MVA. Endelig pris bekreftes av oss etter forespørselen er mottatt.</p>
              </>
            ) : (
              <span className="lo-price-loading">Laster priser…</span>
            )}
          </div>

          <label>Ønsket leveringsdato og tid *
            <input type="datetime-local" name="deliveryDate" value={form.deliveryDate} onChange={handleChange} className={errors.deliveryDate ? "is-invalid" : ""} min={formatLocalDatetime(getMinDeliveryDate())} required />
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
