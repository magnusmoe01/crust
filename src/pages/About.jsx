import "./About.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrophy } from "@fortawesome/free-solid-svg-icons";
import christian300 from "../assets/optimized/christian-300.png";
import christian600 from "../assets/optimized/christian-600.png";
import haakon300 from "../assets/optimized/haakon-300.jpeg";
import haakon600 from "../assets/optimized/haakon-600.jpeg";
import magnus300 from "../assets/optimized/magnus-300.jpeg";
import magnus600 from "../assets/optimized/magnus-600.jpeg";
import silje from "../assets/silje.jpeg";
import historie600 from "../assets/optimized/historie-600.jpeg";
import historie1200 from "../assets/optimized/historie-1200.jpeg";
import iVogna from "../assets/i-vogna.jpeg";
import werner from "../assets/werner.jpeg";
import brandon from "../assets/brandon.jpeg";

function About() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='420' viewBox='0 0 360 420'><rect width='360' height='420' fill='%23fff1e2'/><rect x='18' y='18' width='324' height='384' rx='18' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='4'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%231c140f'>Crust team</text></svg>";

  const team = [
    {
      name: "Magnus Heide",
      role: "Gründer og Daglig leder",
      email: "magnus@crust.no",
      phone: "+47 958 85 852",
      image: {
        src: magnus600,
        srcSet: `${magnus300} 300w, ${magnus600} 600w`,
      },
    },
    {
      name: "Haakon Aarseth",
      role: "Partneransvarlig",
      email: "haakon@crust.no",
      phone: "+47 473 88 646",
      image: {
        src: haakon600,
        srcSet: `${haakon300} 300w, ${haakon600} 600w`,
      },
    },
    {
      name: "Brandon Okoth",
      role: "Driftsmedarbeider",
      email: "brandon@crust.no",
      phone: "",
      image: {
        src: brandon,
        srcSet: `${brandon} 600w`,
      },
    },
    {
      name: "Christian Træland",
      role: "Gründer og Styremedlem",
      email: "",
      phone: "",
      image: {
        src: christian600,
        srcSet: `${christian300} 300w, ${christian600} 600w`,
      },
    },
    {
      name: "Christian W. Hansen",
      role: "Styremedlem",
      email: "",
      phone: "",
      image: {
        src: werner,
        srcSet: `${werner} 600w`,
      },
    },
    {
      name: "Silje Johansen",
      role: "Styreleder",
      email: "",
      phone: "",
      image: {
        src: silje,
        srcSet: `${silje} 600w`,
      },
    },
  ];

  return (
    <div className="about-page">
      <header className="about-hero">
        <div>
          <p className="eyebrow">Om oss</p>
          <h1>Vi gir muligheter</h1>
          <p className="lead">
            Crust er pizza-vogner som gir muligheter til ungdom som står
            utenfor. Målet vårt er å gi unge arbeidserfaring, mestring og en
            trygg vei inn i arbeidslivet.
          </p>
        </div>
        <div className="about-card">
          <h2>
            <FontAwesomeIcon icon={faTrophy} /> Crust n' Trust
          </h2>
          <p>
            Vi gir ungdom ansvar for egen butikk, samtidig som vi tilbyr tett
            oppfølging og opplæring. Resultatet er nye ferdigheter, selvtillit,
            og muligheter for framtiden.
          </p>
        </div>
      </header>

      <section className="about-history">
        <div className="history-layout">
          <div>
            <div className="section-header">
              <h2>Vår historie</h2>
            </div>
            <div className="history-body">
              <p>
                Flere og flere ungdom i Norge faller fra et tradisjonelt
                utdanningsløp. Crust (tidligere Toastmasters) er et nytt konsept
                som satser på ungdom og gir dem en vei inn i arbeidslivet - en
                mulighet til å utvikle seg, få arbeidserfaring og åpne dører til
                nye muligheter.
              </p>
              <p>
                For å møte dette behovet og bidra til å forhindre utenforskap,
                startet vi Crust. Vårt mål er å gi ungdommer en plattform hvor
                de kan oppleve mestring, tilegne seg arbeidslivsferdigheter og
                bygge selvtillit.
              </p>
            </div>
          </div>
          <div className="history-media">
            <img
              src={historie600}
              srcSet={`${historie600} 600w, ${historie1200} 1200w`}
              sizes="(max-width: 900px) 90vw, 520px"
              alt="Crust sin historie i bilder"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
        <div className="history-layout history-layout-reverse">
          <div>
            <div className="history-body">
              <p>
                Gjennom praktisk arbeid og ansvar i en trygg og støttende
                arbeidskultur, hjelper vi dem med å bygge en sterkere fremtid og
                bryte barrierer som kan lede til marginalisering.
              </p>
              <p>
                Vi satser på ungdommen ved å gi dem ansvar for egen butikk,
                samtidig som vi gir dem verdifull erfaring de kan ta med seg
                videre i livet. Gjennom praktisk arbeid og ansvar, utvikler de
                ferdigheter som selvstendighet, ledelse og problemløsning, og
                forbereder seg på fremtidige utfordringer både i arbeidslivet og
                i samfunnet.
              </p>
            </div>
          </div>
          <div className="history-media">
            <img
              src={iVogna}
              sizes="(max-width: 900px) 90vw, 520px"
              alt="Crust sin historie i bilder"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section className="about-team">
        <div className="section-header">
          <h2>Teamet</h2>
          <p className="history-body">
            Engasjement og lidenskap for å gi muligheter til ungdom er kjernen
            som binder oss i Crust n' Trust-teamet sammen. Magnus har jobbet som
            lærer på østkanten i Oslo og startet en skole i Kenya. Sammen med
            Christian Træland som gir ungdom sommerjobb med is i LICC, bestemte
            de seg i 2024 for å gjøre noe for ungdommen som faller utenfor.
            Haakon kom inn for å vokse selskapet, og hans driv for å hjelpe
            ungdommen har gjort han en integrert del av Crust. Hansen, Træland
            og Hjellegjerde har alle erfaringer som løfter teamet i Crust opp og
            fram. Resultatet er solid erfaring kombinert med ung energi - og
            snart flere hundre ungdom i jobb.
          </p>
        </div>
        <div className="team-grid">
          {team.map((member) => (
            <article key={member.name}>
              <img
                src={member.image?.src || placeholder}
                srcSet={member.image?.srcSet}
                sizes="(max-width: 700px) 80vw, 260px"
                alt={`Portrett av ${member.name}`}
                loading="lazy"
                decoding="async"
              />
              <div className="team-card">
                <h3>{member.name}</h3>
                <span>{member.role}</span>
                {member.email && (
                  <p className="team-contact-line">
                    <a href={`mailto:${member.email}`}>{member.email}</a>
                  </p>
                )}
                {member.phone && (
                  <p className="team-contact-line">{member.phone}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default About;
