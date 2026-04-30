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
import pizza2_480 from "./assets/optimized/pizza2-480.jpeg";
import pizza2_960 from "./assets/optimized/pizza2-960.jpeg";
import pizza2_1600 from "./assets/optimized/pizza2-1600.jpeg";
import prosess600 from "./assets/optimized/prosess-600.png";
import prosess1200 from "./assets/optimized/prosess-1200.png";
import "./App.css";
import Varsling from "./pages/Varsling";

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
            med byens beste Pizza!
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
          element={withPageLoader(<AdminLocations />)}
        />

        {/* Financial report (FIXED IMPORT) */}
        <Route
          path="/admin/financial-report"
          element={withPageLoader(<FinancialReport />)}
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
    </Routes>
  );
}

export default App;
