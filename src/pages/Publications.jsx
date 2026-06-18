import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare } from "@fortawesome/free-regular-svg-icons";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Forms.css";
import "./Publications.css";

const emptyForm = {
  title: "",
  description: "",
  imageUrl: "",
  articleUrl: "",
  publicationDate: "",
  accessType: "public",
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

async function optimizePublicationImage(file) {
  if (!file || !file.type?.startsWith("image/")) {
    return file;
  }

  const maxSize = 1200;
  const quality = 0.8;

  try {
    const imageUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = imageUrl;
    await img.decode();

    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    const targetWidth = Math.max(1, Math.round(img.width * scale));
    const targetHeight = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(imageUrl);
      return file;
    }

    context.drawImage(img, 0, 0, targetWidth, targetHeight);
    URL.revokeObjectURL(imageUrl);

    const compressedBlob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });

    if (!compressedBlob) {
      return file;
    }

    if (compressedBlob.size >= file.size) {
      return file;
    }

    const baseName = sanitizeFileName(file.name).replace(/\.[^.]+$/, "");
    return new File([compressedBlob], `${baseName}.jpg`, {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

function toSortTime(item) {
  const dateValue = item?.publicationDate;
  if (typeof dateValue === "string" && dateValue) {
    const parsed = new Date(`${dateValue}T00:00:00`).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const createdAt = item?.createdAt;
  if (typeof createdAt?.toDate === "function") {
    return createdAt.toDate().getTime();
  }
  return 0;
}

function formatPublicationDate(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString("nb-NO");
}

function resolveAccessType(item) {
  if (
    item?.accessType === "public" ||
    item?.accessType === "paywall" ||
    item?.accessType === "internal"
  ) {
    return item.accessType;
  }
  if (typeof item?.isPublic === "boolean") {
    return item.isPublic ? "public" : "paywall";
  }
  return "public";
}

function getPublicationErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Ingen tilgang til å publisere. Sjekk at du er logget inn med @crust.no og at Firestore/Storage-regler er deployet.";
  }
  if (code === "unauthenticated") {
    return "Du må være logget inn som admin for å publisere.";
  }
  if (code === "storage/unauthorized") {
    return "Ingen tilgang til å laste opp bilder i Storage.";
  }
  if (code === "storage/canceled") {
    return "Opplastingen ble avbrutt.";
  }
  if (code === "storage/unknown") {
    return "Ukjent Storage-feil under opplasting.";
  }
  return code ? `${fallbackMessage} (${code})` : fallbackMessage;
}

function Publications() {
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState("");
  const [newItem, setNewItem] = useState(emptyForm);
  const [newImageFile, setNewImageFile] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formState, setFormState] = useState({ saving: false, error: "" });
  const [editId, setEditId] = useState("");
  const [editItem, setEditItem] = useState(emptyForm);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editState, setEditState] = useState({ saving: false, error: "" });
  const { user, isAdmin, loading, error, signOutAdmin } = useAdminSession();

  useEffect(() => {
    const publicationsQuery = query(collection(db, "publications"));

    const unsubscribe = onSnapshot(
      publicationsQuery,
      (snapshot) => {
        const nextItems = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        nextItems.sort((a, b) => toSortTime(b) - toSortTime(a));
        setItems(nextItems);
        setItemsError("");
        setLoadingItems(false);
      },
      (err) => {
        console.error("Feil ved henting av publications:", err);
        setItemsError(
          getPublicationErrorMessage(
            err,
            "Kunne ikke hente omtaler akkurat nå.",
          ),
        );
        setLoadingItems(false);
      },
    );

    return unsubscribe;
  }, []);

  const hasItems = useMemo(() => items.length > 0, [items]);

  function validatePublication(formData) {
    if (!formData.title.trim()) {
      return "Overskrift er påkrevd.";
    }
    if (!formData.description.trim()) {
      return "Beskrivelse er påkrevd.";
    }
    if (!formData.articleUrl.trim()) {
      return "Lenke til artikkel er påkrevd.";
    }
    if (!formData.publicationDate) {
      return "Dato er påkrevd.";
    }

    const normalizedArticleUrl = normalizeUrl(formData.articleUrl);

    try {
      new URL(normalizedArticleUrl);
    } catch {
      return "Lenken til artikkelen er ikke gyldig.";
    }

    return "";
  }

  async function onCreatePublication(event) {
    event.preventDefault();
    setFormState({ saving: false, error: "" });

    if (!newImageFile) {
      setFormState({ saving: false, error: "Bilde er påkrevd." });
      return;
    }

    const validationError = validatePublication(newItem);
    if (validationError) {
      setFormState({ saving: false, error: validationError });
      return;
    }

    setFormState({ saving: true, error: "" });
    try {
      const optimizedImage = await optimizePublicationImage(newImageFile);
      const imagePath = `publications/images/${Date.now()}-${sanitizeFileName(optimizedImage.name)}`;
      await uploadBytes(ref(storage, imagePath), optimizedImage, {
        contentType: optimizedImage.type || "image/jpeg",
      });
      const imageUrl = await getDownloadURL(ref(storage, imagePath));

      await addDoc(collection(db, "publications"), {
        title: newItem.title.trim(),
        description: newItem.description.trim(),
        imageUrl,
        articleUrl: normalizeUrl(newItem.articleUrl),
        publicationDate: newItem.publicationDate,
        accessType: newItem.accessType,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setNewItem(emptyForm);
      setNewImageFile(null);
      setIsAddModalOpen(false);
      setFormState({ saving: false, error: "" });
    } catch (err) {
      console.error("Feil ved oppretting av publication:", err);
      setFormState({
        saving: false,
        error: getPublicationErrorMessage(
          err,
          "Kunne ikke legge til omtale. Prøv igjen.",
        ),
      });
    }
  }

  function onStartEdit(item) {
    setEditId(item.id);
    setEditItem({
      title: item.title || "",
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      articleUrl: item.articleUrl || "",
      publicationDate: item.publicationDate || "",
      accessType: resolveAccessType(item),
    });
    setEditImageFile(null);
    setEditState({ saving: false, error: "" });
  }

  async function onSaveEdit(event) {
    event.preventDefault();
    setEditState({ saving: false, error: "" });

    const validationError = validatePublication(editItem);
    if (validationError) {
      setEditState({ saving: false, error: validationError });
      return;
    }
    if (!editItem.imageUrl && !editImageFile) {
      setEditState({ saving: false, error: "Image is required." });
      return;
    }

    setEditState({ saving: true, error: "" });
    try {
      let imageUrl = editItem.imageUrl || "";
      if (editImageFile) {
        const optimizedImage = await optimizePublicationImage(editImageFile);
        const imagePath = `publications/images/${Date.now()}-${sanitizeFileName(optimizedImage.name)}`;
        await uploadBytes(ref(storage, imagePath), optimizedImage, {
          contentType: optimizedImage.type || "image/jpeg",
        });
        imageUrl = await getDownloadURL(ref(storage, imagePath));
      }

      await updateDoc(doc(db, "publications", editId), {
        title: editItem.title.trim(),
        description: editItem.description.trim(),
        imageUrl,
        articleUrl: normalizeUrl(editItem.articleUrl),
        publicationDate: editItem.publicationDate,
        accessType: editItem.accessType,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setEditId("");
      setEditItem(emptyForm);
      setEditImageFile(null);
      setEditState({ saving: false, error: "" });
    } catch (err) {
      console.error("Feil ved oppdatering av publication:", err);
      setEditState({
        saving: false,
        error: getPublicationErrorMessage(
          err,
          "Kunne ikke oppdatere omtale. Prøv igjen.",
        ),
      });
    }
  }

  return (
    <div className="publications-page">
      <header className="publications-hero">
        <p className="eyebrow">Medieomtale</p>
        <h1>Presseomtale og mediedekning</h1>
        <p className="lead">
          Her finner du presseomtale av Crust n&apos; Trust (tidligere Toastmasters).
          Klikk deg inn på artikkelen for å lese mer.
        </p>
      </header>

      <section className="publications-grid" aria-live="polite">
        {loadingItems ? <p>Laster omtaler...</p> : null}
        {itemsError ? <p className="forms-error">{itemsError}</p> : null}
        {!loadingItems && !hasItems ? (
          <p>Ingen omtaler lagt til ennå.</p>
        ) : null}

        {items.map((item) => (
          <article key={item.id} className="publication-card">
            <img
              src={item.imageUrl}
              alt="Artikkelbilder"
              loading="lazy"
              decoding="async"
            />
            <div className="publication-body">
              <div className="publication-meta">
                <p className="publication-date">
                  {item.publicationDate
                    ? formatPublicationDate(item.publicationDate)
                    : "Ingen dato"}
                </p>
                {isAdmin ? (
                  <button
                    type="button"
                    className="publication-edit-icon"
                    aria-label="Rediger omtale"
                    onClick={() => onStartEdit(item)}
                  >
                    <FontAwesomeIcon icon={faPenToSquare} />
                  </button>
                ) : null}
              </div>
              <h3 className="publication-title">
                {item.title || "Ingen tittel"}
                {resolveAccessType(item) === "internal" ? (
                  <span className="publication-internal-tag">Intern</span>
                ) : null}
              </h3>
              <p className="publication-description">
                {item.description || "Ingen beskrivelse ennå."}
              </p>
              <a
                className="cta publication-link"
                href={item.articleUrl}
                target="_blank"
                rel="noreferrer"
              >
                Les artikkel{resolveAccessType(item) === "paywall" ? " (+)" : ""}
              </a>
            </div>
          </article>
        ))}
      </section>

      <section className={isAdmin ? "admin-box" : "admin-login-line"}>
        {loading ? <p>Sjekker innlogging...</p> : null}
        {error ? <p className="forms-error">{error}</p> : null}

        {isAdmin ? (
          <>
            <div className="admin-actions publications-admin-actions">
              <p>Logget inn som {user?.email}</p>
              <div className="publication-admin-controls">
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    setFormState({ saving: false, error: "" });
                    setIsAddModalOpen(true);
                  }}
                >
                  Legg til omtale
                </button>
                <button
                  type="button"
                  className="ghost admin-logout-mini"
                  onClick={signOutAdmin}
                >
                  Logg ut
                </button>
              </div>
            </div>

            {isAddModalOpen ? (
              <div
                className="publication-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="publication-modal-title"
              >
                <div className="publication-modal">
                  <form
                    className="publications-admin-form"
                    onSubmit={onCreatePublication}
                  >
                    <h3 id="publication-modal-title">Legg til omtale</h3>

                    <label
                      className="field-block"
                      htmlFor="publication-image-url"
                    >
                      <span>Bilde</span>
                      <input
                        id="publication-image-url"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setNewImageFile(event.target.files?.[0] || null)
                        }
                        required
                      />
                    </label>

                    <label className="field-block" htmlFor="publication-title">
                      <span>Overskrift</span>
                      <input
                        id="publication-title"
                        type="text"
                        value={newItem.title}
                        onChange={(event) =>
                          setNewItem((previous) => ({
                            ...previous,
                            title: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="publication-description"
                    >
                      <span>Beskrivelse</span>
                      <textarea
                        id="publication-description"
                        rows={3}
                        value={newItem.description}
                        onChange={(event) =>
                          setNewItem((previous) => ({
                            ...previous,
                            description: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="publication-article-url"
                    >
                      <span>Lenke til artikkel</span>
                      <input
                        id="publication-article-url"
                        type="url"
                        value={newItem.articleUrl}
                        onChange={(event) =>
                          setNewItem((previous) => ({
                            ...previous,
                            articleUrl: event.target.value,
                          }))
                        }
                        placeholder="https://..."
                        required
                      />
                    </label>

                    <label className="field-block" htmlFor="publication-date">
                      <span>Dato</span>
                      <input
                        id="publication-date"
                        type="date"
                        value={newItem.publicationDate}
                        onChange={(event) =>
                          setNewItem((previous) => ({
                            ...previous,
                            publicationDate: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="publication-access-status"
                    >
                      <span>Tilgang</span>
                      <select
                        id="publication-access-status"
                        value={newItem.accessType}
                        onChange={(event) =>
                          setNewItem((previous) => ({
                            ...previous,
                            accessType: event.target.value,
                          }))
                        }
                      >
                        <option value="public">
                          Åpen (ingen betalingsmur)
                        </option>
                        <option value="paywall">Bak betalingsmur</option>
                        <option value="internal">Intern</option>
                      </select>
                    </label>

                    {formState.error ? (
                      <p className="forms-error">{formState.error}</p>
                    ) : null}
                    <div className="publication-edit-actions">
                      <button
                        type="submit"
                        className="cta"
                        disabled={formState.saving}
                      >
                        {formState.saving ? "Lagrer..." : "Publiser omtale"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setIsAddModalOpen(false);
                          setNewItem(emptyForm);
                          setNewImageFile(null);
                          setFormState({ saving: false, error: "" });
                        }}
                      >
                        Avbryt
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {editId ? (
              <div
                className="publication-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="publication-edit-modal-title"
              >
                <div className="publication-modal">
                  <form
                    className="publications-admin-form"
                    onSubmit={onSaveEdit}
                  >
                    <h3 id="publication-edit-modal-title">Rediger omtale</h3>

                    <label
                      className="field-block"
                      htmlFor="edit-publication-image-url"
                    >
                      <span>Last opp nytt bilde (valgfritt)</span>
                      <input
                        id="edit-publication-image-url"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setEditImageFile(event.target.files?.[0] || null)
                        }
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-publication-title"
                    >
                      <span>Overskrift</span>
                      <input
                        id="edit-publication-title"
                        type="text"
                        value={editItem.title}
                        onChange={(event) =>
                          setEditItem((previous) => ({
                            ...previous,
                            title: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-publication-description"
                    >
                      <span>Beskrivelse</span>
                      <textarea
                        id="edit-publication-description"
                        rows={3}
                        value={editItem.description}
                        onChange={(event) =>
                          setEditItem((previous) => ({
                            ...previous,
                            description: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-publication-article-url"
                    >
                      <span>Lenke til artikkel</span>
                      <input
                        id="edit-publication-article-url"
                        type="url"
                        value={editItem.articleUrl}
                        onChange={(event) =>
                          setEditItem((previous) => ({
                            ...previous,
                            articleUrl: event.target.value,
                          }))
                        }
                        placeholder="https://..."
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-publication-date"
                    >
                      <span>Dato</span>
                      <input
                        id="edit-publication-date"
                        type="date"
                        value={editItem.publicationDate}
                        onChange={(event) =>
                          setEditItem((previous) => ({
                            ...previous,
                            publicationDate: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-publication-access-status"
                    >
                      <span>Tilgang</span>
                      <select
                        id="edit-publication-access-status"
                        value={editItem.accessType}
                        onChange={(event) =>
                          setEditItem((previous) => ({
                            ...previous,
                            accessType: event.target.value,
                          }))
                        }
                      >
                        <option value="public">
                          Åpen (ingen betalingsmur)
                        </option>
                        <option value="paywall">Bak betalingsmur</option>
                        <option value="internal">Intern</option>
                      </select>
                    </label>

                    {editState.error ? (
                      <p className="forms-error">{editState.error}</p>
                    ) : null}
                    <div className="publication-edit-actions">
                      <button
                        type="submit"
                        className="cta"
                        disabled={editState.saving}
                      >
                        {editState.saving ? "Oppdaterer..." : "Lagre endringer"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setEditId("");
                          setEditItem(emptyForm);
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
          </>
        ) : null}
      </section>
    </div>
  );
}

export default Publications;
