import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faTruckMoving, faPizzaSlice } from "@fortawesome/free-solid-svg-icons";
import foodtruck600 from "../assets/optimized/foodtruck-600.png";
import foodtruck1200 from "../assets/optimized/foodtruck-1200.png";
import pizzaImg from "../assets/pizzabilde.jpeg";
import "./StorbestillingGateway.css";

function StorbestillingGateway() {
  return (
    <div className="sg-page">
      <header className="sg-hero">
        <p className="eyebrow">Storbestilling</p>
        <h1>Hva trenger du?</h1>
        <p>Vi tilbyr to måter å bestille på — velg det som passer best.</p>
      </header>

      <div className="sg-options">
        <Link to="/bestilling/event" className="sg-option">
          <div className="sg-option-visual">
            <img
              src={foodtruck600}
              srcSet={`${foodtruck600} 600w, ${foodtruck1200} 1200w`}
              sizes="(max-width: 700px) 90vw, 480px"
              alt="Crust pizzavogn"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="sg-option-body">
            <h2>Catering med vogn</h2>
            <p>
              Vi kommer til deg med pizzavogn og ungdommer som lager og serverer
              på stedet. Perfekt for events, fester og arrangementer.
            </p>
            <span className="sg-option-cta">
              Book catering <FontAwesomeIcon icon={faTruckMoving} />
            </span>
          </div>
        </Link>

        <Link to="/bestilling/myepizza" className="sg-option">
          <div className="sg-option-visual">
            <img src={pizzaImg} alt="Mange Crust-pizzaer" loading="lazy" decoding="async" />
          </div>
          <div className="sg-option-body">
            <h2>Kun pizzalevering</h2>
            <p>
              Bestill 20–100 pizzaer levert til døra — uten vogn eller
              servering. Enkel bulkbestilling med prisestimat.
            </p>
            <span className="sg-option-cta">
              Bestill mange pizzaer <FontAwesomeIcon icon={faPizzaSlice} />
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}

export default StorbestillingGateway;
