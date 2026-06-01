import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHandshake } from "@fortawesome/free-solid-svg-icons";
import frendeLogo from "../assets/Frende-logo.png";
import navLogo from "../assets/optimized/nav-logo-1200.png";
import varigLogo from "../assets/varig-hadeland.webp";
import opsahlLogo from "../assets/Opsahl-gruppen.webp";
import osloKommuneLogo from "../assets/oslo-kommune.png";
import gildeLogo from "../assets/optimized/gilde.png";
import "./Partners.css";

function Partners() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220' viewBox='0 0 360 220'><rect width='360' height='220' fill='%23fff1e2'/><rect x='18' y='18' width='324' height='184' rx='18' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='4'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%23182c3c'>Partnerlogo</text></svg>";

  const partners = [
    {
      name: "Frende Forsikring",
      focus:
        "Hovedpartner.\nFrende har gjort betydelige bidrag i 2025 og 2026 for å etablere og utvikle arbeidsplasser for ungdom, \nsamt lære opp ungdommen i Norges beste kundeservice.",
      logo: frendeLogo,
    },
    {
      name: "Varig Hadeland Forsikring",
      focus:
        "Med for første gang i 2026, \nog deler 1 vogn med Frende i Gjøvik.",
      logo: varigLogo,
    },
    {
      name: "Gilde",
      focus:
        "Leverandør av kjøttprodukter til Crusts pizzavogner, \nog partner for meningsfull ungdomssysselsetting.",
      logo: gildeLogo,
    },
    {
      name: "Opsahl Eiendom",
      focus:
        "Bidrar med kontor- og lagerlokaler på Skullerud, \nog satset tidlig på prosjektet ved å tilby kiosklokale.",
      logo: opsahlLogo,
    },
    {
      name: "NAV",
      focus:
        "Samarbeid om rekruttering, opplæring \nog oppfølging av ungdom i jobb.",
      logo: navLogo,
    },

    {
      name: "Oslo kommune",
      focus:
        "Samarbeidspartner for lokale muligheter, \naktivitet og ungdom i arbeid.",
      logo: osloKommuneLogo,
    },
  ];

  const linkMap = {
    "Frende Forsikring": "/frende",
    "Varig Hadeland Forsikring": "/varig-hadeland",
    "Gilde": "/gilde",
  };

  return (
    <div className="partners-page">
      <header className="partners-hero">
        <div>
          <p className="eyebrow">Crust n' Trust - sammen</p>
          <h1>Våre partnere</h1>
          <p className="lead">
            Vi samarbeider med private bedrifter og det offentlige for å gi
            ungdom en mulighet til sin første jobb, et reelt støttenettverk, og
            en vei videre.
          </p>
        </div>
        <div className="partners-card">
          <h2>
            <FontAwesomeIcon icon={faHandshake} /> Sammen gir vi:
          </h2>
          <ul>
            <li>En inngang til arbeidslivet og oppfølging</li>
            <li>En jobb med mestring og erfaring</li>
            <li>Videre utdanning og muligheter</li>
          </ul>
        </div>
      </header>

      <section className="partners-grid">
        {partners.map((partner, index) => {
          const isFeatured = index === 0;
          return (
            <article
              key={partner.name}
              className={
                isFeatured ? "partner-card partner-featured" : "partner-card"
              }
            >
              <img
                className={
                  partner.name === "Frende Forsikring"
                    ? "partner-logo frende-logo"
                    : partner.name === "Varig Hadeland Forsikring"
                      ? "partner-logo varig-logo"
                      : partner.name === "NAV"
                        ? "partner-logo nav-logo"
                        : partner.name === "Oslo kommune"
                          ? "partner-logo oslo-logo"
                          : "partner-logo"
                }
                src={partner.logo ?? placeholder}
                alt={`${partner.name} logo`}
                loading="lazy"
                decoding="async"
              />
              <p>{partner.focus}</p>
              {linkMap[partner.name] && (
                <Link className="ghost" to={linkMap[partner.name]}>
                  Les mer
                </Link>
              )}
            </article>
          );
        })}
      </section>
      <p className="partner-contact-line">
        Vil du gi muligheter til ungdom? Ta kontakt på{" "}
        <a href="tel:+4747388646">+47 473 88 646</a> /{" "}
        <a href="mailto:haakon@crust.no">haakon@crust.no</a>
      </p>
    </div>
  );
}

export default Partners;
