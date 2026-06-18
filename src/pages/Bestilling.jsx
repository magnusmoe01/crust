import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faPizzaSlice,
  faEnvelope,
  faLocationDot,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import foodtruckImg from "../assets/optimized/foodtruck-600.png";
import pizzaeskeImg from "../assets/pizzaeske.jpeg";
import ivognaImg from "../assets/i-vogna.jpeg";
import "./Bestilling.css";

function useFoodoraLocations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "locations"), (snap) => {
      const locs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((l) => !l.disabled && l.foodoraUrl)
        .sort((a, b) => {
          const oa = typeof a.order === "number" ? a.order : Infinity;
          const ob = typeof b.order === "number" ? b.order : Infinity;
          return oa - ob || (a.name || "").localeCompare(b.name || "", "nb");
        });
      setLocations(locs);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { locations, loading };
}

function Bestilling() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { locations, loading } = useFoodoraLocations();
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e) { if (e.key === "Escape") setPickerOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  return (
    <div className="bestilling-page">
      <header className="bestilling-hero">
        <p className="eyebrow">Bestill fra Crust n' Trust</p>
        <h1>Hvordan vil du bestille?</h1>
        <p>
          Velg den bestillingsmåten som passer deg best — levering,
          storbestilling eller noe helt spesielt.
        </p>
      </header>

      <div className="bestilling-grid">
        {/* Foodora — location picker */}
        <div className="bestilling-card is-link" ref={pickerRef}>
          <button
            type="button"
            className="bestilling-card-btn"
            onClick={() => setPickerOpen((o) => !o)}
            aria-expanded={pickerOpen}
            aria-haspopup="true"
          >
            <div className="bestilling-card-visual">
              <img src={pizzaeskeImg} alt="Bestill pizza med Foodora" loading="lazy" decoding="async" />
            </div>
            <div className="bestilling-card-body">
              <h2>Foodora</h2>
              <p>Bestill levering med Foodora — velg lokasjon.</p>
              <span className="bestilling-card-cta">
                Bestill med Foodora <FontAwesomeIcon icon={faArrowRight} />
              </span>
            </div>
          </button>

          {pickerOpen && (
            <div className="foodora-picker" role="dialog" aria-label="Velg lokasjon">
              <div className="foodora-picker-header">
                <h3>Velg lokasjon</h3>
                <button
                  type="button"
                  className="foodora-picker-close"
                  onClick={() => setPickerOpen(false)}
                  aria-label="Lukk"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              {loading ? (
                <p className="foodora-picker-loading">Laster lokasjoner…</p>
              ) : locations.length === 0 ? (
                <p className="foodora-picker-empty">Ingen Foodora-lokasjoner tilgjengelig akkurat nå.</p>
              ) : (
                <ul className="foodora-picker-list">
                  {locations.map((loc) => (
                    <li key={loc.id}>
                      <a
                        href={loc.foodoraUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="foodora-picker-item"
                        onClick={() => setPickerOpen(false)}
                      >
                        <FontAwesomeIcon icon={faLocationDot} className="foodora-picker-icon" />
                        <div>
                          <strong>{loc.city || loc.name}</strong>
                          {loc.city && loc.name && loc.city !== loc.name && (
                            <span className="foodora-picker-address">{loc.name}</span>
                          )}
                        </div>
                        <FontAwesomeIcon icon={faArrowRight} className="foodora-picker-arrow" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Large orders & Catering */}
        <Link to="/bestilling/storbestilling" className="bestilling-card is-link" aria-label="Storbestilling og catering">
          <div className="bestilling-card-visual">
            <img src={foodtruckImg} alt="Crust pizzavogn" loading="lazy" decoding="async" />
          </div>
          <div className="bestilling-card-body">
            <h2>Storbestilling</h2>
            <p>Trenger du mange pizzaer — med eller uten vogn og servering? Vi ordner det.</p>
            <span className="bestilling-card-cta">
              Se alternativer <FontAwesomeIcon icon={faPizzaSlice} />
            </span>
          </div>
        </Link>

        {/* Custom — NOT clickable */}
        <div className="bestilling-card">
          <div className="bestilling-card-visual">
            <img src={ivognaImg} alt="Spesialbestilling og catering" loading="lazy" decoding="async" />
          </div>
          <div className="bestilling-card-body">
            <h2>Spesialbestilling</h2>
            <p>Ønsker du noe unikt eller noe som ikke er listet her? Ta kontakt direkte.</p>
            <a href="mailto:event@crust.no" className="bestilling-card-email" aria-label="Send e-post til event@crust.no">
              <FontAwesomeIcon icon={faEnvelope} /> event@crust.no
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Bestilling;
