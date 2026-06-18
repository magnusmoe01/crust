import { useState, useRef } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faPaperPlane,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import PizzaMenu from "../components/PizzaMenu";
import crustPizza from "../assets/Crust-pizza.jpeg";
import foodtruck600 from "../assets/optimized/foodtruck-600.png";
import foodtruck1200 from "../assets/optimized/foodtruck-1200.png";
import "./EventCatering.css";

const CATERING_TYPES = [
  "Bedriftsevent",
  "Privat arrangement",
  "Skolearrangement",
  "Festival / marked",
  "Annet",
];

const INITIAL_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  cateringType: "",
  date: "",
  comments: "",
};

function EventCatering() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const honeypotRef = useRef(null);
  const formRef = useRef(null);

  function scrollToForm() {
    document
      .getElementById("booking-form")
      ?.scrollIntoView({ behavior: "smooth" });
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = "Navn er påkrevd";
    if (!form.phone.trim()) errs.phone = "Telefon er påkrevd";
    if (!form.email.trim()) {
      errs.email = "E-post er påkrevd";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = "Ugyldig e-postadresse";
    }
    if (!form.address.trim()) errs.address = "Adresse er påkrevd";
    if (!form.cateringType) errs.cateringType = "Velg type catering";
    if (!form.date) errs.date = "Velg dato";
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    if (honeypotRef.current?.value) return;

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "cateringRequests"), {
        ...form,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);

      httpsCallable(functions, "sendCateringNotification")(form).catch(() => {});
    } catch {
      setSubmitError("Noe gikk galt. Prøv igjen eller send e-post til event@crust.no.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="event-catering-page">
      {/* ── Hero ────────────────────────────────────── */}
      <section className="ec-hero">
        <div className="ec-hero-text">
          <p className="eyebrow">Crust n' Trust Catering</p>
          <h1>Pizza servert med mening</h1>
          <p>
            Vi kommer til deg med pizza, en vogn og ungdommer i sin aller første
            jobb.
          </p>
          <button
            type="button"
            className="ec-hero-btn"
            onClick={scrollToForm}
            aria-label="Gå til bestillingsskjema"
          >
            Book catering <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </div>
        <div className="ec-hero-images">
          <img
            className="ec-hero-img-full"
            src={crustPizza}
            alt="Crust-pizza på serveringsbrett"
            loading="eager"
            decoding="async"
          />
        </div>
      </section>

      {/* ── Highlights ──────────────────────────────── */}
      <section className="ec-highlights" aria-label="Om cateringen">
        <div className="ec-highlight">
          <div className="ec-highlight-text">
            <h2>Mer enn bare mat</h2>
            <p>
              Når du bestiller catering fra Crust n' Trust, støtter du ungdom
              som får sin aller første jobberfaring. Hver pizza er laget og
              servert av unge mennesker som lærer samarbeid, service og
              ansvar — i praksis. Du får ikke bare god mat, men en
              meningsfull opplevelse for gjestene dine.
            </p>
          </div>
          <img
            className="ec-highlight-img"
            src={foodtruck600}
            srcSet={`${foodtruck600} 600w, ${foodtruck1200} 1200w`}
            sizes="(max-width: 900px) 90vw, 460px"
            alt="Ungdom serverer pizza fra Crust-vogn"
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className="ec-highlight reverse">
          <div className="ec-highlight-text">
            <h2>Fleksibel catering</h2>
            <p>
              Vi tilpasser oss ditt arrangement — enten det er en bedriftsfest
              for 30, en bursdag i hagen eller en skoleavslutning for 200. Vi
              kommer med alt utstyr, vogn og ingredienser. Du trenger bare
              å si hvor og når, så ordner vi resten.
            </p>
          </div>
          <img
            className="ec-highlight-img"
            src={crustPizza}
            alt="Pizza klar til servering"
            loading="lazy"
            decoding="async"
          />
        </div>
      </section>

      {/* ── Menu ────────────────────────────────────── */}
      <section className="ec-menu" aria-label="Vårt utvalg">
        <h2>Vårt utvalg</h2>
        <p>Her er pizzaene du kan velge mellom.</p>
        <PizzaMenu />
      </section>

      {/* ── Booking form ────────────────────────────── */}
      <section className="ec-booking" id="booking-form" aria-label="Bestillingsskjema">
        <h2>Book catering</h2>
        <p>Det er gratis og uforpliktende å sende en forespørsel.</p>

        {submitted ? (
          <div className="ec-success" role="status">
            <div className="ec-success-icon">
              <FontAwesomeIcon icon={faCircleCheck} />
            </div>
            <h3>Forespørselen din er mottatt!</h3>
            <p>
              Vi tar kontakt med deg for å bekrefte detaljer og se hvordan vi
              best kan gjennomføre arrangementet ditt.
            </p>
          </div>
        ) : (
          <form
            className="ec-form"
            onSubmit={handleSubmit}
            ref={formRef}
            noValidate
          >
            <div className="ec-hp" aria-hidden="true">
              <label>
                Ikke fyll ut dette feltet
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  ref={honeypotRef}
                />
              </label>
            </div>

            <div className="ec-form-row">
              <label>
                Navn *
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className={errors.name ? "is-invalid" : ""}
                  autoComplete="name"
                  required
                />
                {errors.name && (
                  <span className="ec-field-error" role="alert">{errors.name}</span>
                )}
              </label>
              <label>
                Telefon *
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  className={errors.phone ? "is-invalid" : ""}
                  autoComplete="tel"
                  required
                />
                {errors.phone && (
                  <span className="ec-field-error" role="alert">{errors.phone}</span>
                )}
              </label>
            </div>

            <label>
              E-post *
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className={errors.email ? "is-invalid" : ""}
                autoComplete="email"
                required
              />
              {errors.email && (
                <span className="ec-field-error" role="alert">{errors.email}</span>
              )}
            </label>

            <label>
              Adresse (leveringssted) *
              <input
                type="text"
                name="address"
                value={form.address}
                onChange={handleChange}
                className={errors.address ? "is-invalid" : ""}
                placeholder="Gateadresse, postnummer, by"
                autoComplete="street-address"
                required
              />
              {errors.address && (
                <span className="ec-field-error" role="alert">{errors.address}</span>
              )}
            </label>

            <div className="ec-form-row">
              <label>
                Type catering *
                <select
                  name="cateringType"
                  value={form.cateringType}
                  onChange={handleChange}
                  className={errors.cateringType ? "is-invalid" : ""}
                  required
                >
                  <option value="">Velg type...</option>
                  {CATERING_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {errors.cateringType && (
                  <span className="ec-field-error" role="alert">{errors.cateringType}</span>
                )}
              </label>
              <label>
                Ønsket dato *
                <input
                  type="date"
                  name="date"
                  value={form.date}
                  onChange={handleChange}
                  className={errors.date ? "is-invalid" : ""}
                  min={new Date().toISOString().split("T")[0]}
                  required
                />
                {errors.date && (
                  <span className="ec-field-error" role="alert">{errors.date}</span>
                )}
              </label>
            </div>

            <label>
              Levering / adkomst / kommentarer
              <textarea
                name="comments"
                value={form.comments}
                onChange={handleChange}
                placeholder="F.eks. antall gjester, tidspunkt, spesielle ønsker..."
              />
            </label>

            {submitError && (
              <p className="ec-form-error" role="alert">{submitError}</p>
            )}

            <p className="ec-form-note">
              * Det er gratis og uforpliktende å sende en forespørsel.
            </p>

            <button
              type="submit"
              className="ec-form-submit"
              disabled={submitting}
            >
              {submitting ? "Sender..." : "Send forespørsel"}
              {!submitting && <FontAwesomeIcon icon={faPaperPlane} />}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export default EventCatering;
