import { Route, Routes, Link, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAnglesRight,
  faBuildingCircleCheck,
  faChildReaching,
  faMapPin,
  faPizzaSlice,
  faSchool,
  faUserGraduate,
  faHandshake,
  faTruckFast,
} from "@fortawesome/free-solid-svg-icons";
import {
  faCalendar as faCalendarRegular,
  faCircleCheck,
} from "@fortawesome/free-regular-svg-icons";
import Layout from "./components/Layout";
import alesund600 from "./assets/optimized/alesund-600.jpg";
import alesund1200 from "./assets/optimized/alesund-1200.jpg";
import crustPizza from "./assets/pizzabilde.jpeg";
import pizzaeske from "./assets/pizzaeske.jpeg";
import prosess600 from "./assets/optimized/prosess-600.png";
import prosess1200 from "./assets/optimized/prosess-1200.png";
import "./App.css";
import Varsling from "./pages/Varsling";
import { useAdminSession } from "./hooks/useAdminSession";

// Pages (lazy loaded)
const Apply = lazy(() => import("./pages/Apply"));
const Locations = lazy(() => import("./pages/Locations"));
const Partners = lazy(() => import("./pages/Partners"));
const About = lazy(() => import("./pages/About"));
const Event = lazy(() => import("./pages/Event"));
const Frende = lazy(() => import("./pages/Frende"));
const Contact = lazy(() => import("./pages/Contact"));
const Forms = lazy(() => import("./pages/Forms"));
const FormPage = lazy(() => import("./pages/FormPage"));
const VarigHadeland = lazy(() => import("./pages/VarigHadeland"));
const Obos = lazy(() => import("./pages/Obos"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLocations = lazy(() => import("./pages/AdminLocations"));
const Publications = lazy(() => import("./pages/Publications"));
const Sales = lazy(() => import("./pages/Sales"));

// ✅ FIX ADDED: Missing import that caused crash
const FinancialReport = lazy(() => import("./pages/FinancialReport"));

const Order = lazy(() => import("./pages/Order"));
const OrderDashboard = lazy(() => import("./pages/OrderDashboard"));
const OrderAdmin = lazy(() => import("./pages/OrderAdmin"));
const AllOrders = lazy(() => import("./pages/AllOrders"));
const Sms = lazy(() => import("./pages/Sms"));

function withPageLoader(element) {
  return (
    <Suspense fallback={<div className="loading-box">Laster...</div>}>
      {element}
    </Suspense>
  );
}

function RoutedFormPage() {
  const location = useLocation();
  return <FormPage key={location.pathname} />;
}

function RequireAdminRoute({ children }) {
  const { isAdmin, loading } = useAdminSession();

  if (loading) {
    return <div className="loading-box">Laster admin-tilgang...</div>;
  }

  if (!isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}

function Home() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <section className="hero">
        <div className="hero-header">
          <p className="eyebrow">Kvalitet og mening i hver bit</p>
          <h1>
            Ungdom på jobb <br />
            med pizza som skaper muligheter!
          </h1>
        </div>
        <div className="hero-content">
          <div className="hero-copy">
            <p className="lead">
              I 2025 ga vi, under navnet Toastmasters, 100 ungdommer sin aller
              første jobb og en fot innenfor arbeidslivet. <br />
            </p>
            <p className="lead">
              Nå er vi Crust n' Trust, hvor vi skal gi 100 nye ungdommer dobbelt
              så mye erfaring, mestring og muligheter, samtidig som vi serverer
              skikkelig god pizza.
            </p>
            <div className="hero-actions">
              <Link className="cta" to="/plasseringer">
                Hent pizza nå! <FontAwesomeIcon icon={faPizzaSlice} />
              </Link>
              <a className="ghost" href="/event">
                Bestill til et arrangement{" "}
                <FontAwesomeIcon icon={faCalendarRegular} />
              </a>
            </div>
          </div>
          <div className="hero-media">
            <img
              className="hero-main"
              src={crustPizza}
              alt="Crust-pizza på serveringsbrett"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <div className="hero-notes">
            <span>
              <FontAwesomeIcon icon={faAnglesRight} /> Tidligere Toastmasters
            </span>
            <span>
              <FontAwesomeIcon icon={faChildReaching} /> Ansetter 15 til 19 år
            </span>
            <span>
              <FontAwesomeIcon icon={faSchool} /> Jobb både i og utenfor
              skoletid
            </span>
          </div>
        </div>
      </section>

      <section id="resultater" className="impact">
        <div className="section-header impact-header-box">
          <h2>
            Resultater du kan smake <FontAwesomeIcon icon={faCircleCheck} />
          </h2>
          <p>
            Crust kombinerer god opplæring, veiledning, tarifflønn og fleksible
            vakter, slik at ungdom får en arena for mestring og erfaring, bygger
            selvtillit, og får efaring som åpner dører videre i arbeidslivet.
          </p>
        </div>
        <div className="impact-grid">
          <article>
            <h3>
              <FontAwesomeIcon icon={faUserGraduate} /> 100 første jobber
            </h3>
            <p>
              Vi ansetter 100 nye ungdommer i 2026 og gir dem sin aller første
              lønn.
            </p>
          </article>
          <article>
            <h3>
              <FontAwesomeIcon icon={faHandshake} /> Grundig opplæring
            </h3>
            <p>
              Opplæring og kurs i kundeservice, matsikkerhet, renhold og ledelse
              - rett ut i praksis.
            </p>
          </article>
          <article>
            <h3>
              <FontAwesomeIcon icon={faTruckFast} /> Selvstendighet
            </h3>
            <p>
              Hver ungdom får ansvar for egen vogn, fra åpning til stenging,
              fordi vi vet at tillit bygger mestring.
            </p>
          </article>
        </div>
      </section>

      <section id="program" className="program">
        <div className="program-copy">
          <h2>
            Ditt steg inn i arbeidslivet{" "}
            <FontAwesomeIcon icon={faBuildingCircleCheck} />
          </h2>
          <p>
            Hos oss utvikler ungdom sterke arbeidsvaner, fra punktlighet til god
            kundeservice. De får tillit og ansvar i praksis. <br />
            Her er det ungdommen som styrer vogna!
          </p>
          <img
            className="program-image"
            src={prosess600}
            srcSet={`${prosess600} 600w, ${prosess1200} 1200w`}
            sizes="(max-width: 900px) 90vw, 520px"
            alt="Prosess for første jobb hos Crust"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="program-steps">
          <div>
            <h3>
              <span className="step-number">1</span> Intervju
            </h3>
            <p>
              Vi ser deg for den du er, ikke hva du har eller ikke har på CV-en.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">2</span> Tjen og lær
            </h3>
            <p>
              Jobb med tarifflønn, veiledning og en fantastisk mulighet til å få
              erfaring.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">3</span> Steget videre
            </h3>
            <p>
              Få hjelp med CV, attest og oppfølging videre etterpå.
            </p>
          </div>
        </div>
      </section>

      <section id="historie" className="story">
        <div className="story-milestones">
          <div>
            <span>2024</span>
            <p>
              Åpnet vår første vogn på Sognsvann i Oslo, hvor vi fikk testet ut
              konseptet.
            </p>
          </div>
          <div>
            <span>2025</span>
            <p>
              Åpnet ytterligere 9 vogner. Nådde målet om 100 ungdommer i jobb på
              ett år.
            </p>
          </div>
          <div>
            <span>Nå - 2026</span>
            <p>
              Vi dobler sesongvarigheten og antallet arbeidstimer for ungdommen.
              Vi utvider til pizza for å nå flere kunder, skape flere
              arbeidstimer for ungdommen og bygge en mer bærekraftig bedrift.
            </p>
          </div>
        </div>
        <div className="story-card">
          <h2 className="story-heading">
            Fra Toastmasters til{" "}
            <span className="no-break">Crust n' Trust</span>
          </h2>
          <div className="story-text">
            <p>
              Vi startet som Toastmasters, en lokalt forankret toastvogn med
              store ambisjoner. Så fikk vi Frende Forsikring med på laget, som
              så verdien i å gi muligheter til ungdom. <br />
              <br />I år bytter vi navn til Crust, med pizza på menyen og enda
              flere muligheter og arbeidstimer for ungdom.
            </p>
          </div>
          <div className="story-image">
            <img
              src={pizzaeske}
              alt="Crust pizzaeske"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section id="visit" className="visit">
        <div className="visit-card">
          <h2>Sulten, nysgjerrig, eller kanskje begge?</h2>
          <p>
            Kom innom for den beste pizzaen, eller book oss for et arrangement.{" "}
            <br />
            Hver slice støtter en ungdom i sin aller første jobb!
          </p>
          <div className="visit-actions">
            <a className="cta" href="/event">
              Bestill servering <FontAwesomeIcon icon={faPizzaSlice} />
            </a>

            <a className="ghost" href="/plasseringer">
              Hvor finner du oss <FontAwesomeIcon icon={faMapPin} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function App() {
  const location = useLocation();

  return (
    <Routes location={location} key={location.pathname}>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/jobb" element={withPageLoader(<Apply />)} />
        <Route path="/plasseringer" element={withPageLoader(<Locations />)} />
        <Route path="/partnere" element={withPageLoader(<Partners />)} />
        <Route path="/event" element={withPageLoader(<Event />)} />
        <Route path="/frende" element={withPageLoader(<Frende />)} />
        <Route path="/kontakt" element={withPageLoader(<Contact />)} />
        <Route path="/om-oss" element={withPageLoader(<About />)} />
        <Route path="/omtale" element={withPageLoader(<Publications />)} />
        <Route path="/varsling" element={withPageLoader(<Varsling />)} />
        <Route path="/varig-hadeland" element={withPageLoader(<VarigHadeland />)} />
        <Route path="/obos" element={withPageLoader(<Obos />)} />
        <Route path="/admin" element={withPageLoader(<Admin />)} />

        <Route
          path="/admin/lokasjoner"
          element={<Navigate to="/admin/leverandører" replace />}
        />
        <Route
          path="/admin/leverandorer"
          element={<Navigate to="/admin/leverandører" replace />}
        />
        <Route
          path="/admin/leverandører"
          element={withPageLoader(
            <RequireAdminRoute>
              <AdminLocations />
            </RequireAdminRoute>
          )}
        />

        {/* Financial report (FIXED IMPORT) */}
        <Route
          path="/admin/financial-report"
          element={withPageLoader(
            <RequireAdminRoute>
              <FinancialReport />
            </RequireAdminRoute>
          )}
        />

        <Route
          path="/admin/ordre"
          element={withPageLoader(
            <RequireAdminRoute>
              <OrderAdmin />
            </RequireAdminRoute>
          )}
        />

        <Route
          path="/admin/all-orders"
          element={withPageLoader(
            <RequireAdminRoute>
              <AllOrders />
            </RequireAdminRoute>
          )}
        />

        <Route
          path="/admin/sms"
          element={withPageLoader(
            <RequireAdminRoute>
              <Sms />
            </RequireAdminRoute>
          )}
        />

        <Route path="/sales" element={withPageLoader(<Sales />)} />
        <Route path="/skjema" element={withPageLoader(<Forms />)} />
        <Route
          path="/skjema/:formSlug/kvittering/:receiptToken"
          element={withPageLoader(<RoutedFormPage />)}
        />
        <Route
          path="/skjema/:formSlug/review/:submissionId"
          element={withPageLoader(<RoutedFormPage />)}
        />
        <Route path="/skjema/:formSlug/*" element={withPageLoader(<RoutedFormPage />)} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="/worker" element={withPageLoader(<OrderDashboard />)} />
      <Route path="/order" element={withPageLoader(<Order />)} />
      <Route path="/ordre" element={<Navigate to="/order" replace />} />
    </Routes>
  );
}

export default App;
