import "./Frende.css";
import gildeLogo from "../assets/optimized/gilde.png";

function Gilde() {
  return (
    <div className="frende-page gilde-page">
      <header className="frende-hero">
        <div>
          <a className="back-link" href="/partnere">
            ← Tilbake til Partnere
          </a>
          <p className="eyebrow">Mat med mening</p>
          <h1>Gilde og Crust — god mat som åpner dører.</h1>
          <p className="lead">
            Kvalitetsråvarer fra Gilde. Muligheter for ungdom fra Crust.
          </p>
        </div>
        <div className="frende-card">
          <img src={gildeLogo} alt="Gilde logo" decoding="async" />
          <p>
            Gilde er en av Norges mest kjente merkevarer innen kjøtt og
            matprodukter, og er nå partner med Crust for å gi ungdom en
            meningsfull arbeidsplass.
          </p>
        </div>
      </header>

      <section className="frende-body">
        <p>
          Samarbeidet med Gilde handler om mer enn god mat. Det handler om å
          gi ungdom en arena for mestring, ansvar og reell arbeidserfaring —
          med norske kvalitetsråvarer som bakteppe.
        </p>
        <p>
          Gilde bidrar med produkter til Crusts pizzavogner, og er med på å
          sikre at hver eneste pizza som rulles ut representerer det beste av
          norsk matkultur. For ungdommene som jobber i vognene betyr det at
          de lærer å håndtere og servere produkter de kan være stolte av.
        </p>
        <p>
          Gjennom partnerskapet med Crust støtter Gilde opp om konseptet om å
          gi 100 ungdommer sin første arbeidserfaring i 2026 — en investering
          i fremtidens arbeidsliv og i norsk matglede.
        </p>
        <p>
          Les mer om Gilde på{" "}
          <a href="https://www.gilde.no/" target="_blank" rel="noreferrer">
            gilde.no
          </a>
          .
        </p>
      </section>
    </div>
  );
}

export default Gilde;
