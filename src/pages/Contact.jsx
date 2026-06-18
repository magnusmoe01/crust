import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAddressBook } from "@fortawesome/free-regular-svg-icons";
import {
  faBriefcase,
  faCalendarCheck,
  faHandshake,
  faCommentDots,
} from "@fortawesome/free-solid-svg-icons";
import "./Contact.css";

function Contact() {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isPartnerOpen, setIsPartnerOpen] = useState(false);

  useEffect(() => {
    const isOpen = isFeedbackOpen || isPartnerOpen;
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFeedbackOpen, isPartnerOpen]);

  return (
    <div className="contact-page">
      <header className="contact-hero">
        <div>
          <p className="eyebrow">Kontakt Oss</p>
          <h1>Ta kontakt</h1>
          <p className="lead">
            Vi svarer gjerne på spørsmål om jobb, arrangement eller samarbeid.
          </p>
        </div>
        <div className="contact-card">
          <h2>
            <FontAwesomeIcon icon={faAddressBook} /> Kontaktinfo
          </h2>
          <p>
            <strong>E-post:</strong>{" "}
            <a href="mailto:hei@crust.no">hei@crust.no</a>
          </p>
          <p>
            <strong>Telefon:</strong> +47 958 85 852
          </p>
          <p>
            <strong>Adresse:</strong> Olaf Helsets vei 6, 0694 Oslo
          </p>
        </div>
      </header>

      <section className="contact-grid">
        <article>
          <h3>
            <FontAwesomeIcon icon={faBriefcase} /> Jobb
          </h3>
          <p>For søknader, bruk skjemaet vårt.</p>
          <a className="ghost" href="/jobb">
            Søk jobb
          </a>
        </article>
        <article>
          <h3>
            <FontAwesomeIcon icon={faCalendarCheck} /> Event
          </h3>
          <p>Skal du arrangere noe? Book Crust for servering.</p>
          <a className="ghost" href="/event">
            Bestill servering
          </a>
        </article>
        <article>
          <h3>
            <FontAwesomeIcon icon={faHandshake} /> Partnere
          </h3>
          <p>Vil du samarbeide med oss? Vi tar gjerne en prat.</p>
          <button
            className="ghost"
            type="button"
            onClick={() => setIsPartnerOpen(true)}
          >
            Kontakt oss
          </button>
        </article>
        <article className="contact-feedback">
          <h3>
            <FontAwesomeIcon icon={faCommentDots} /> Ris og ros
          </h3>
          <p>Hjelp oss å bli bedre. Send en tilbakemelding.</p>
          <button
            className="cta"
            type="button"
            onClick={() => setIsFeedbackOpen(true)}
          >
            Åpne skjema
          </button>
        </article>
      </section>

      {isFeedbackOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Ris og ros"
          onClick={() => setIsFeedbackOpen(false)}
        >
          <div
            className="modal-content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setIsFeedbackOpen(false)}
              aria-label="Lukk"
            >
              Lukk
            </button>
            <iframe
              title="Ris og ros - Microsoft Forms"
              src="https://forms.office.com/e/SSXWMdpUe9"
              className="feedback-iframe"
              frameBorder="0"
              marginWidth="0"
              marginHeight="0"
              style={{ border: "none" }}
              allowFullScreen
            />
          </div>
        </div>
      )}

      {isPartnerOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Kontakt oss"
          onClick={() => setIsPartnerOpen(false)}
        >
          <div
            className="modal-content partner-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setIsPartnerOpen(false)}
              aria-label="Lukk"
            >
              Lukk
            </button>
            <h3>Kontakt oss</h3>
            <p>
              <strong>E-post:</strong>{" "}
              <a href="mailto:haakon@crust.no">haakon@crust.no</a>
            </p>
            <p>
              <strong>Telefon:</strong> +47 473 88 646
            </p>
            <br />
          </div>
        </div>
      )}
    </div>
  );
}

export default Contact;
