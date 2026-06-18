import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare } from "@fortawesome/free-regular-svg-icons";
import { faLocationDot, faTruck } from "@fortawesome/free-solid-svg-icons";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Forms.css";
import "./Locations.css";
import foodtruck600 from "../assets/optimized/foodtruck-600.png";
import foodtruck1200 from "../assets/optimized/foodtruck-1200.png";

const emptyLocationForm = {
  name: "",
  city: "",
  weekdayHours: "",
  weekendHours: "",
  weekdayOrderDeadline: "",
  weekdayDeliveryTime: "",
  weekendOrderDeadline: "",
  weekendDeliveryTime: "",
  mapUrl: "",
  foodoraUrl: "",
  imageUrl: "",
  order: "",
  orderEnabled: false,
  excludeFromCount: false,
  disabled: false,
};

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function sanitizeFileName(name) {
  return String(name || "image")
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-");
}

function toSortOrder(item) {
  if (typeof item?.order === "number" && Number.isFinite(item.order)) {
    return item.order;
  }
  if (typeof item?.order === "string" && item.order.trim()) {
    const parsed = Number(item.order);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function getLocationErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Ingen tilgang til plasseringer. Sjekk admin-innlogging og Firestore-regler.";
  }
  if (code === "unauthenticated") {
    return "Du må være logget inn som admin for å lagre.";
  }
  if (code === "storage/unauthorized") {
    return "Ingen tilgang til bildeopplasting i Storage.";
  }
  if (code === "storage/canceled") {
    return "Opplastingen ble avbrutt.";
  }
  if (code === "storage/unknown") {
    return "Ukjent Storage-feil under opplasting.";
  }
  return code ? `${fallbackMessage} (${code})` : fallbackMessage;
}

function getLocationOpeningHoursEntries(location) {
  const entries = [];

  if (location?.weekdayHours) {
    entries.push({
      label: "Ukedag",
      value: location.weekdayHours,
    });
  }
  if (location?.weekendHours) {
    entries.push({
      label: "Helg",
      value: location.weekendHours,
    });
  }

  return entries;
}

function Locations() {
  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationsError, setLocationsError] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newLocation, setNewLocation] = useState(emptyLocationForm);
  const [newImageFile, setNewImageFile] = useState(null);
  const [formState, setFormState] = useState({ saving: false, error: "" });
  const [editId, setEditId] = useState("");
  const [editLocation, setEditLocation] = useState(emptyLocationForm);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editState, setEditState] = useState({ saving: false, error: "" });
  const [banner, setBanner] = useState({ visible: false, text: "", bgColor: "#fef9c3", textColor: "#713f12" });
  const [bannerDraft, setBannerDraft] = useState({ visible: false, text: "", bgColor: "#fef9c3", textColor: "#713f12" });
  const [bannerSaving, setBannerSaving] = useState(false);
  const [bannerError, setBannerError] = useState("");
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [disabledModalOpen, setDisabledModalOpen] = useState(false);
  const [reactivating, setReactivating] = useState("");
  const { user, isAdmin, loading, error, signOutAdmin } = useAdminSession();

  useEffect(() => {
    const locationsQuery = query(collection(db, "locations"));
    const unsubscribe = onSnapshot(
      locationsQuery,
      (snapshot) => {
        const nextLocations = snapshot.docs.map((locationDoc) => ({
          id: locationDoc.id,
          ...locationDoc.data(),
        }));
        nextLocations.sort((a, b) => {
          const orderDiff = toSortOrder(a) - toSortOrder(b);
          if (orderDiff !== 0) {
            return orderDiff;
          }
          return String(a.name || "").localeCompare(String(b.name || ""), "nb");
        });
        setLocations(nextLocations);
        setLocationsError("");
        setLoadingLocations(false);
      },
      (err) => {
        console.error("Feil ved henting av locations:", err);
        setLocationsError(
          getLocationErrorMessage(
            err,
            "Kunne ikke hente plasseringer akkurat nå.",
          ),
        );
        setLoadingLocations(false);
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    getDoc(doc(db, "siteSettings", "locationsBanner"))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : { visible: false, text: "" };
        const parsed = {
          visible: Boolean(data.visible),
          text: data.text || "",
          bgColor: data.bgColor || "#fef9c3",
          textColor: data.textColor || "#713f12",
        };
        setBanner(parsed);
        setBannerDraft(parsed);
      })
      .catch(() => {});
  }, []);

  async function onSaveBanner() {
    setBannerSaving(true);
    setBannerError("");
    try {
      await setDoc(doc(db, "siteSettings", "locationsBanner"), {
        visible: bannerDraft.visible,
        text: bannerDraft.text.trim(),
        bgColor: bannerDraft.bgColor,
        textColor: bannerDraft.textColor,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setBanner({ visible: bannerDraft.visible, text: bannerDraft.text.trim(), bgColor: bannerDraft.bgColor, textColor: bannerDraft.textColor });
    } catch (err) {
      setBannerError(
        getLocationErrorMessage(err, "Kunne ikke lagre banner."),
      );
    } finally {
      setBannerSaving(false);
    }
  }

  const hasLocations = useMemo(() => locations.length > 0, [locations]);
  const locationCount = useMemo(
    () => locations.filter((l) => !l.excludeFromCount && !l.disabled).length,
    [locations],
  );
  const locationLabel = locationCount === 1 ? "vogn" : "vogner";
  const foodtruckLabel = locationCount === 1 ? "foodtruck" : "foodtrucks";
  const heroEyebrow = loadingLocations
    ? "Pizzavogner - ett mål!"
    : `${locationCount} ${locationLabel} - ett mål!`;
  const heroLead = loadingLocations
    ? "Våre pizzavogner bringer Crust n' Trust til nabolag over hele Oslo - og litt utenfor! Ta turen innom for en smak av vår crusty pizza."
    : `Våre ${locationCount} ${foodtruckLabel} bringer Crust n' Trust til nabolag over hele Oslo - og litt utenfor! Ta turen innom for en smak av vår crusty pizza.`;
  const activeLocationsLabel = loadingLocations
    ? "Aktive vogner lastes inn"
    : `${locationCount} aktive ${locationLabel}`;

  function validateLocation(formData) {
    if (!formData.name.trim()) {
      return "Adresse/sted er påkrevd.";
    }
    if (!formData.city.trim()) {
      return "By er påkrevd.";
    }

    const normalizedMapUrl = normalizeUrl(formData.mapUrl);
    if (normalizedMapUrl) {
      try {
        new URL(normalizedMapUrl);
      } catch {
        return "Kart-lenken er ikke gyldig.";
      }
    }
    return "";
  }

  async function onCreateLocation(event) {
    event.preventDefault();
    setFormState({ saving: false, error: "" });

    const validationError = validateLocation(newLocation);
    if (validationError) {
      setFormState({ saving: false, error: validationError });
      return;
    }

    setFormState({ saving: true, error: "" });
    try {
      let imageUrl = "";
      if (newImageFile) {
        const imagePath = `locations/images/${Date.now()}-${sanitizeFileName(newImageFile.name)}`;
        await uploadBytes(ref(storage, imagePath), newImageFile, {
          contentType: newImageFile.type || "image/jpeg",
        });
        imageUrl = await getDownloadURL(ref(storage, imagePath));
      }

      await addDoc(collection(db, "locations"), {
        name: newLocation.name.trim(),
        city: newLocation.city.trim(),
        address: newLocation.city.trim(),
        weekdayHours: newLocation.weekdayHours.trim(),
        weekendHours: newLocation.weekendHours.trim(),
        weekdayOrderDeadline: newLocation.weekdayOrderDeadline.trim(),
        weekdayDeliveryTime: newLocation.weekdayDeliveryTime.trim(),
        weekendOrderDeadline: newLocation.weekendOrderDeadline.trim(),
        weekendDeliveryTime: newLocation.weekendDeliveryTime.trim(),
        mapUrl: normalizeUrl(newLocation.mapUrl),
        foodoraUrl: normalizeUrl(newLocation.foodoraUrl),
        imageUrl,
        order: newLocation.order.trim() ? Number(newLocation.order) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setNewLocation(emptyLocationForm);
      setNewImageFile(null);
      setFormState({ saving: false, error: "" });
      setIsAddModalOpen(false);
    } catch (err) {
      console.error("Feil ved oppretting av location:", err);
      setFormState({
        saving: false,
        error: getLocationErrorMessage(
          err,
          "Kunne ikke legge til plassering. Prøv igjen.",
        ),
      });
    }
  }

  function onStartEdit(location) {
    setEditId(location.id);
    setEditLocation({
      name: location.name || "",
      city: location.city || location.address || "",
      weekdayHours: location.weekdayHours || "",
      weekendHours: location.weekendHours || "",
      weekdayOrderDeadline: location.weekdayOrderDeadline || "",
      weekdayDeliveryTime: location.weekdayDeliveryTime || "",
      weekendOrderDeadline: location.weekendOrderDeadline || "",
      weekendDeliveryTime: location.weekendDeliveryTime || "",
      mapUrl: location.mapUrl || "",
      foodoraUrl: location.foodoraUrl || "",
      imageUrl: location.imageUrl || "",
      order: location.order == null ? "" : String(location.order),
      orderEnabled: location.orderEnabled || false,
      excludeFromCount: location.excludeFromCount || false,
      disabled: location.disabled || false,
    });
    setEditImageFile(null);
    setEditState({ saving: false, error: "" });
  }

  async function onSaveEdit(event) {
    event.preventDefault();
    setEditState({ saving: false, error: "" });

    const validationError = validateLocation(editLocation);
    if (validationError) {
      setEditState({ saving: false, error: validationError });
      return;
    }

    setEditState({ saving: true, error: "" });
    try {
      let imageUrl = editLocation.imageUrl || "";
      if (editImageFile) {
        const imagePath = `locations/images/${Date.now()}-${sanitizeFileName(editImageFile.name)}`;
        await uploadBytes(ref(storage, imagePath), editImageFile, {
          contentType: editImageFile.type || "image/jpeg",
        });
        imageUrl = await getDownloadURL(ref(storage, imagePath));
      }

      await updateDoc(doc(db, "locations", editId), {
        name: editLocation.name.trim(),
        city: editLocation.city.trim(),
        address: editLocation.city.trim(),
        weekdayHours: editLocation.weekdayHours.trim(),
        weekendHours: editLocation.weekendHours.trim(),
        weekdayOrderDeadline: editLocation.weekdayOrderDeadline.trim(),
        weekdayDeliveryTime: editLocation.weekdayDeliveryTime.trim(),
        weekendOrderDeadline: editLocation.weekendOrderDeadline.trim(),
        weekendDeliveryTime: editLocation.weekendDeliveryTime.trim(),
        mapUrl: normalizeUrl(editLocation.mapUrl),
        foodoraUrl: normalizeUrl(editLocation.foodoraUrl),
        imageUrl,
        order: editLocation.order.trim() ? Number(editLocation.order) : null,
        orderEnabled: editLocation.orderEnabled,
        excludeFromCount: editLocation.excludeFromCount,
        disabled: editLocation.disabled,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setEditId("");
      setEditLocation(emptyLocationForm);
      setEditImageFile(null);
      setEditState({ saving: false, error: "" });
    } catch (err) {
      console.error("Feil ved oppdatering av location:", err);
      setEditState({
        saving: false,
        error: getLocationErrorMessage(
          err,
          "Kunne ikke oppdatere plassering. Prøv igjen.",
        ),
      });
    }
  }

  function closeAddModal() {
    setIsAddModalOpen(false);
    setNewLocation(emptyLocationForm);
    setNewImageFile(null);
    setFormState({ saving: false, error: "" });
  }

  return (
    <div className="locations-page">
      <header className="locations-hero">
        <div>
          <p className="eyebrow">{heroEyebrow}</p>
          <h1>Finn en pizzavogn!</h1>
          <p className="lead">{heroLead}</p>
        </div>
        <div className="locations-card">
          <h2>
            <FontAwesomeIcon icon={faTruck} /> 2026
          </h2>
          <ul>
            <li>{activeLocationsLabel}</li>
            <li>Daglig servering</li>
          </ul>
        </div>
      </header>

      {banner.visible ? (
        <div className="locations-banner" style={{ background: banner.bgColor, borderBottomColor: banner.bgColor }}>
          <p className="locations-banner-text" style={{ color: banner.textColor }}>{banner.text}</p>
        </div>
      ) : null}

      <section className="locations-grid" aria-live="polite">
        {loadingLocations ? <p>Laster plasseringer...</p> : null}
        {locationsError ? (
          <p className="forms-error">{locationsError}</p>
        ) : null}
        {!loadingLocations && !hasLocations ? (
          <p>Ingen plasseringer lagt inn enda.</p>
        ) : null}

        {locations.filter((l) => !l.disabled).map((location) => (
          <article key={location.id}>
            <img
              src={location.imageUrl || foodtruck600}
              srcSet={
                location.imageUrl
                  ? undefined
                  : `${foodtruck600} 600w, ${foodtruck1200} 1200w`
              }
              sizes="(max-width: 700px) 90vw, 320px"
              alt={`${location.name || "Crust foodtruck"} fasade`}
              loading="lazy"
              decoding="async"
            />
            <div className="location-meta">
              <h3>{location.name || "Uten navn"}</h3>
              {isAdmin ? (
                <button
                  type="button"
                  className="location-edit-icon"
                  aria-label="Rediger plassering"
                  onClick={() => onStartEdit(location)}
                >
                  <FontAwesomeIcon icon={faPenToSquare} />
                </button>
              ) : null}
            </div>
            <p className="location-neighborhood">
              <FontAwesomeIcon icon={faLocationDot} />{" "}
              {location.city || location.address || "Ukjent by"}
            </p>
            {getLocationOpeningHoursEntries(location).map((entry) => (
              <p key={`${location.id}-${entry.label}`} className="location-schedule-entry">
                {entry.value}
              </p>
            ))}
            {location.mapUrl ? (
              <a
                className="ghost location-cta"
                href={location.mapUrl}
                target="_blank"
                rel="noreferrer"
              >
                Ta meg dit
              </a>
            ) : (
              <a
                className="ghost location-cta is-disabled"
                href="#"
                aria-disabled="true"
                tabIndex={-1}
              >
                Ta meg dit
              </a>
            )}
          </article>
        ))}
      </section>

      <section className={isAdmin ? "admin-box" : "admin-login-line"}>
        {loading ? <p>Kontrollerer innlogging...</p> : null}
        {error ? <p className="forms-error">{error}</p> : null}

        {isAdmin ? (
          <>
            <div className="admin-actions location-admin-actions">
              <p>Innlogget som {user?.email}</p>
              <div className="location-admin-controls">
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    setFormState({ saving: false, error: "" });
                    setIsAddModalOpen(true);
                  }}
                >
                  Legg til plassering
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setBannerEditorOpen((prev) => !prev);
                    setBannerDraft({ visible: banner.visible, text: banner.text });
                    setBannerError("");
                  }}
                >
                  {bannerEditorOpen ? "Lukk banner-editor" : "Rediger infobanner"}
                </button>
                {locations.some((l) => l.disabled) ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setDisabledModalOpen(true)}
                  >
                    Deaktiverte ({locations.filter((l) => l.disabled).length})
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost admin-logout-mini"
                  onClick={signOutAdmin}
                >
                  Logg ut
                </button>
              </div>
            </div>

            {bannerEditorOpen ? (
              <div className="locations-banner-editor">
                <h4 className="locations-banner-editor-title">Infobanner</h4>
                <textarea
                  className="locations-banner-textarea"
                  value={bannerDraft.text}
                  onChange={(e) => setBannerDraft((prev) => ({ ...prev, text: e.target.value }))}
                  placeholder="Skriv inn bannertekst her..."
                  rows={2}
                />
                <div className="locations-banner-color-row">
                  <label className="locations-banner-color-label">
                    <span>Bakgrunn</span>
                    <input
                      type="color"
                      value={bannerDraft.bgColor}
                      onChange={(e) => setBannerDraft((prev) => ({ ...prev, bgColor: e.target.value }))}
                    />
                  </label>
                  <label className="locations-banner-color-label">
                    <span>Tekstfarge</span>
                    <input
                      type="color"
                      value={bannerDraft.textColor}
                      onChange={(e) => setBannerDraft((prev) => ({ ...prev, textColor: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="locations-banner-editor-row">
                  <label className="location-order-enabled-row" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={bannerDraft.visible}
                      onChange={(e) => setBannerDraft((prev) => ({ ...prev, visible: e.target.checked }))}
                    />
                    <span>Vis banner på siden</span>
                  </label>
                  <button
                    type="button"
                    className="cta"
                    onClick={onSaveBanner}
                    disabled={bannerSaving}
                  >
                    {bannerSaving ? "Lagrer..." : "Lagre banner"}
                  </button>
                </div>
                {bannerError ? <p className="forms-error">{bannerError}</p> : null}
                {bannerDraft.visible && bannerDraft.text ? (
                  <div className="locations-banner-preview">
                    <span className="locations-banner-preview-label">Forhåndsvisning:</span>
                    <div className="locations-banner locations-banner--preview" style={{ background: bannerDraft.bgColor, borderBottomColor: bannerDraft.bgColor }}>
                      <p className="locations-banner-text" style={{ color: bannerDraft.textColor }}>{bannerDraft.text}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isAddModalOpen ? (
              <div
                className="location-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="location-modal-title"
              >
                <div className="location-modal">
                  <form
                    className="locations-admin-form"
                    onSubmit={onCreateLocation}
                  >
                    <h3 id="location-modal-title">Legg til plassering</h3>

                    <label className="field-block" htmlFor="location-name">
                      <span>Adresse/sted</span>
                      <input
                        id="location-name"
                        type="text"
                        value={newLocation.name}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            name: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label className="field-block" htmlFor="location-address">
                      <span>By</span>
                      <input
                        id="location-address"
                        type="text"
                        value={newLocation.city}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            city: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekday-hours"
                    >
                      <span>Åpningstid ukedag</span>
                      <input
                        id="location-weekday-hours"
                        type="text"
                        value={newLocation.weekdayHours}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekdayHours: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: 11:00-20:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekend-hours"
                    >
                      <span>Åpningstid helg</span>
                      <input
                        id="location-weekend-hours"
                        type="text"
                        value={newLocation.weekendHours}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekendHours: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: 12:00-21:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekday-order-deadline"
                    >
                      <span>Bestillingsfrist ukedag</span>
                      <input
                        id="location-weekday-order-deadline"
                        type="text"
                        value={newLocation.weekdayOrderDeadline}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekdayOrderDeadline: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: kl. 10:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekday-delivery-time"
                    >
                      <span>Leveringstid ukedag</span>
                      <input
                        id="location-weekday-delivery-time"
                        type="text"
                        value={newLocation.weekdayDeliveryTime}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekdayDeliveryTime: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: kl. 14:00-15:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekend-order-deadline"
                    >
                      <span>Bestillingsfrist helg</span>
                      <input
                        id="location-weekend-order-deadline"
                        type="text"
                        value={newLocation.weekendOrderDeadline}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekendOrderDeadline: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: kl. 10:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekend-delivery-time"
                    >
                      <span>Leveringstid helg</span>
                      <input
                        id="location-weekend-delivery-time"
                        type="text"
                        value={newLocation.weekendDeliveryTime}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekendDeliveryTime: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: kl. 14:00-15:00"
                      />
                    </label>

                    <label className="field-block" htmlFor="location-map-url">
                      <span>Kart-lenke</span>
                      <input
                        id="location-map-url"
                        type="url"
                        value={newLocation.mapUrl}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            mapUrl: event.target.value,
                          }))
                        }
                        placeholder="https://maps.google.com/..."
                      />
                    </label>

                    <label className="field-block" htmlFor="location-foodora-url">
                      <span>Foodora-lenke (valgfritt)</span>
                      <input
                        id="location-foodora-url"
                        type="url"
                        value={newLocation.foodoraUrl}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            foodoraUrl: event.target.value,
                          }))
                        }
                        placeholder="https://www.foodora.no/..."
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-image-file"
                    >
                      <span>Last opp bilde (valgfritt)</span>
                      <input
                        id="location-image-file"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setNewImageFile(event.target.files?.[0] || null)
                        }
                      />
                    </label>

                    <label className="field-block" htmlFor="location-order">
                      <span>Rekkefølge (valgfritt tall)</span>
                      <input
                        id="location-order"
                        type="number"
                        inputMode="numeric"
                        value={newLocation.order}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            order: event.target.value,
                          }))
                        }
                      />
                    </label>

                    {formState.error ? (
                      <p className="forms-error">{formState.error}</p>
                    ) : null}
                    <div className="location-edit-actions">
                      <button
                        type="submit"
                        className="cta"
                        disabled={formState.saving}
                      >
                        {formState.saving ? "Lagrer..." : "Publiser plassering"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={closeAddModal}
                      >
                        Lukk
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {editId ? (
              <div
                className="location-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="location-edit-modal-title"
              >
                <div className="location-modal">
                  <form className="locations-admin-form" onSubmit={onSaveEdit}>
                    <h3 id="location-edit-modal-title">Rediger plassering</h3>

                    <label className="field-block" htmlFor="edit-location-name">
                      <span>Adresse/sted</span>
                      <input
                        id="edit-location-name"
                        type="text"
                        value={editLocation.name}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            name: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-address"
                    >
                      <span>By</span>
                      <input
                        id="edit-location-address"
                        type="text"
                        value={editLocation.city}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            city: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekday-hours"
                    >
                      <span>Åpningstid ukedag</span>
                      <input
                        id="edit-location-weekday-hours"
                        type="text"
                        value={editLocation.weekdayHours}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekdayHours: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: 11:00-20:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekend-hours"
                    >
                      <span>Åpningstid helg</span>
                      <input
                        id="edit-location-weekend-hours"
                        type="text"
                        value={editLocation.weekendHours}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekendHours: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: 12:00-21:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekday-order-deadline"
                    >
                      <span>Bestillingsfrist ukedag</span>
                      <input
                        id="edit-location-weekday-order-deadline"
                        type="text"
                        value={editLocation.weekdayOrderDeadline}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekdayOrderDeadline: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: kl. 10:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekday-delivery-time"
                    >
                      <span>Leveringstid ukedag</span>
                      <input
                        id="edit-location-weekday-delivery-time"
                        type="text"
                        value={editLocation.weekdayDeliveryTime}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekdayDeliveryTime: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: kl. 14:00-15:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekend-order-deadline"
                    >
                      <span>Bestillingsfrist helg</span>
                      <input
                        id="edit-location-weekend-order-deadline"
                        type="text"
                        value={editLocation.weekendOrderDeadline}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekendOrderDeadline: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: kl. 10:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekend-delivery-time"
                    >
                      <span>Leveringstid helg</span>
                      <input
                        id="edit-location-weekend-delivery-time"
                        type="text"
                        value={editLocation.weekendDeliveryTime}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekendDeliveryTime: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: kl. 14:00-15:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-map-url"
                    >
                      <span>Kart-lenke</span>
                      <input
                        id="edit-location-map-url"
                        type="url"
                        value={editLocation.mapUrl}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            mapUrl: event.target.value,
                          }))
                        }
                        placeholder="https://maps.google.com/..."
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-foodora-url"
                    >
                      <span>Foodora-lenke (valgfritt)</span>
                      <input
                        id="edit-location-foodora-url"
                        type="url"
                        value={editLocation.foodoraUrl}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            foodoraUrl: event.target.value,
                          }))
                        }
                        placeholder="https://www.foodora.no/..."
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-image-file"
                    >
                      <span>Last opp nytt bilde (valgfritt)</span>
                      <input
                        id="edit-location-image-file"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setEditImageFile(event.target.files?.[0] || null)
                        }
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-order"
                    >
                      <span>Rekkefølge (valgfritt tall)</span>
                      <input
                        id="edit-location-order"
                        type="number"
                        inputMode="numeric"
                        value={editLocation.order}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            order: event.target.value,
                          }))
                        }
                        placeholder="1"
                      />
                    </label>

                    <label className="field-block location-order-enabled-row">
                      <input
                        id="edit-location-order-enabled"
                        type="checkbox"
                        checked={editLocation.orderEnabled}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            orderEnabled: event.target.checked,
                          }))
                        }
                      />
                      <span>Tillat bestillinger fra denne lokasjonen</span>
                    </label>

                    <label className="field-block location-order-enabled-row">
                      <input
                        id="edit-location-exclude-from-count"
                        type="checkbox"
                        checked={editLocation.excludeFromCount}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            excludeFromCount: event.target.checked,
                          }))
                        }
                      />
                      <span>Utelat fra totalt antall foodtrucks</span>
                    </label>

                    <label className="field-block location-order-enabled-row location-disabled-row">
                      <input
                        id="edit-location-disabled"
                        type="checkbox"
                        checked={editLocation.disabled}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            disabled: event.target.checked,
                          }))
                        }
                      />
                      <span>Deaktiver plassering (skjules fra siden)</span>
                    </label>

                    {editState.error ? (
                      <p className="forms-error">{editState.error}</p>
                    ) : null}
                    <div className="location-edit-actions">
                      <button
                        type="submit"
                        className="cta"
                        disabled={editState.saving}
                      >
                        {editState.saving ? "Lagrer..." : "Lagre endringer"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setEditId("");
                          setEditLocation(emptyLocationForm);
                          setEditImageFile(null);
                          setEditState({ saving: false, error: "" });
                        }}
                      >
                        Avbryt
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {disabledModalOpen ? (
              <div
                className="location-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="disabled-locations-modal-title"
                onClick={() => setDisabledModalOpen(false)}
              >
                <div className="location-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="locations-admin-form">
                    <h3 id="disabled-locations-modal-title">Deaktiverte plasseringer</h3>
                    {locations.filter((l) => l.disabled).length === 0 ? (
                      <p style={{ margin: 0, color: "rgba(24,44,60,0.5)", fontSize: "0.9rem" }}>Ingen deaktiverte plasseringer.</p>
                    ) : (
                      <div className="disabled-locations-list">
                        {locations.filter((l) => l.disabled).map((location) => (
                          <div key={location.id} className="disabled-location-row">
                            <div className="disabled-location-info">
                              <strong>{location.name || "Uten navn"}</strong>
                              <span>{location.city || location.address || ""}</span>
                            </div>
                            <div className="disabled-location-actions">
                              <button
                                type="button"
                                className="ghost"
                                disabled={reactivating === location.id}
                                onClick={async () => {
                                  setReactivating(location.id);
                                  try {
                                    await updateDoc(doc(db, "locations", location.id), {
                                      disabled: false,
                                      updatedAt: serverTimestamp(),
                                      updatedBy: user?.email || "admin",
                                    });
                                  } catch {}
                                  setReactivating("");
                                }}
                              >
                                {reactivating === location.id ? "Reaktiverer..." : "Reaktiver"}
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => onStartEdit(location)}
                              >
                                Rediger
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="location-edit-actions" style={{ marginTop: "8px" }}>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setDisabledModalOpen(false)}
                      >
                        Lukk
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

export default Locations;
