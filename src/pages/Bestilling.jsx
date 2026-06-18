import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faTruckFast,
  faCalendarCheck,
  faPizzaSlice,
  faEnvelope,
} from "@fortawesome/free-solid-svg-icons";
import foodtruckImg from "../assets/optimized/foodtruck-600.png";
import crustPizza from "../assets/Crust-pizza.jpeg";
import "./Bestilling.css";

const FOODORA_URL =
  "https://www.foodora.no/en/restaurant/o1ss/crustn-trust";

function Bestilling() {
  return (
    <div className="bestilling-page">
      <header className="bestilling-header">
        <p className="eyebrow">Bestill fra Crust n' Trust</p>
        <h1>Hvordan vil du bestille?</h1>
        <p>
          Velg den bestillingsmåten som passer deg best — enten det er levering,
          catering, storbestilling eller noe helt spesielt.
        </p>
      </header>

      <div className="bestilling-grid">
        <a
          href={FOODORA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="bestilling-card is-clickable"
          aria-label="Bestill levering med Foodora"
        >
          <div className="bestilling-card-img-placeholder">
            <FontAwesomeIcon icon={faTruckFast} />
          </div>
          <div className="bestilling-card-body">
            <h2>Foodora</h2>
            <p>Bestill levering med Foodora — rett til døra di.</p>
            <span className="bestilling-card-cta">
              Bestill pizza med Foodora <FontAwesomeIcon icon={faArrowRight} />
            </span>
          </div>
        </a>

        <Link
          to="/bestilling/event"
          className="bestilling-card is-clickable"
          aria-label="Bestill catering til arrangement"
        >
          <img
            className="bestilling-card-img"
            src={foodtruckImg}
            alt="Crust pizzavogn på arrangement"
            loading="lazy"
            decoding="async"
          />
          <div className="bestilling-card-body">
            <h2>Catering / Event</h2>
            <p>
              Vi kommer til deg med vogn og pizza servert av ungdommer i sin
              første jobb.
            </p>
            <span className="bestilling-card-cta">
              Bestill catering <FontAwesomeIcon icon={faCalendarCheck} />
            </span>
          </div>
        </Link>

        <Link
          to="/bestilling/myepizza"
          className="bestilling-card is-clickable"
          aria-label="Bestill mange pizzaer"
        >
          <img
            className="bestilling-card-img"
            src={crustPizza}
            alt="Mange Crust-pizzaer"
            loading="lazy"
            decoding="async"
          />
          <div className="bestilling-card-body">
            <h2>Storbestilling</h2>
            <p>Vil du bestille mange pizzaer? Vi ordner det.</p>
            <span className="bestilling-card-cta">
              Bestill mange pizzaer <FontAwesomeIcon icon={faPizzaSlice} />
            </span>
          </div>
        </Link>

        <div className="bestilling-card">
          <div className="bestilling-card-img-placeholder">
            <FontAwesomeIcon icon={faEnvelope} />
          </div>
          <div className="bestilling-card-body">
            <h2>Spesialbestilling</h2>
            <p>
              Ønsker du noe unikt eller noe som ikke er listet her? Ta kontakt
              med oss direkte.
            </p>
            <a
              href="mailto:event@crust.no"
              className="bestilling-card-email"
              aria-label="Send e-post til event@crust.no"
            >
              <FontAwesomeIcon icon={faEnvelope} /> event@crust.no
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Bestilling;
