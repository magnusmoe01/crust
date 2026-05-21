import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { defaultStengeskjema } from "../forms/defaultForms";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Forms.css";

const defaultFormsBySlug = {
  [defaultStengeskjema.slug]: defaultStengeskjema,
};

function Forms() {
  const navigate = useNavigate();
  const [forms, setForms] = useState([defaultStengeskjema]);
  const [pendingReviewCounts, setPendingReviewCounts] = useState({});
  const [flaggedCounts, setFlaggedCounts] = useState({});
  const [remarkCounts, setRemarkCounts] = useState({});
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState("");
  const [newFormSlug, setNewFormSlug] = useState("");
  const [newFormTitle, setNewFormTitle] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createState, setCreateState] = useState({
    creating: false,
    error: "",
  });
  const [deleteTargetSlug, setDeleteTargetSlug] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteState, setDeleteState] = useState({
    deleting: false,
    error: "",
    message: "",
  });
  const { user, isAdmin, loading, error, signOutAdmin } = useAdminSession();

  useEffect(() => {
    let cancelled = false;

    async function loadForms() {
      setFormsError("");
      try {
        const snapshot = await getDocs(collection(db, "forms"));
        const bySlug = new Map([
          [defaultStengeskjema.slug, defaultStengeskjema],
        ]);

        snapshot.forEach((item) => {
          const data = item.data();
          if (!data?.slug) {
            return;
          }
          const defaultForSlug = defaultFormsBySlug[data.slug] || {};
          bySlug.set(data.slug, {
            ...defaultForSlug,
            id: item.id,
            ...data,
          });
        });

        if (!cancelled) {
          const merged = Array.from(bySlug.values()).sort((a, b) =>
            (a.title || "").localeCompare(b.title || "", "nb"),
          );
          setForms(merged);
        }
      } catch {
        if (!cancelled) {
          setFormsError("Kunne ikke hente skjema akkurat nå.");
        }
      } finally {
        if (!cancelled) {
          setLoadingForms(false);
        }
      }
    }

    loadForms();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setPendingReviewCounts({});
      setFlaggedCounts({});
      setRemarkCounts({});
      return;
    }

    let cancelled = false;

    async function loadPendingReviewCounts() {
      try {
        const [submissionResult, remarkResult] = await Promise.allSettled([
          getDocs(collection(db, "formSubmissions")),
          getDocs(collection(db, "formRemarks")),
        ]);
        const nextCounts = {};
        const nextFlaggedCounts = {};
        const nextRemarkCounts = {};

        if (submissionResult.status !== "fulfilled") {
          throw submissionResult.reason;
        }

        submissionResult.value.forEach((item) => {
          const data = item.data();
          const formSlug = String(data?.formSlug || "").trim();
          if (!formSlug) {
            return;
          }

          const isCompletedFlaggedSubmission =
            String(data?.flaggedStatus || "").trim().toLowerCase() === "complete";

          const hasRatingIssues =
            (data?.reviewScoreSummary?.neutral || 0) + (data?.reviewScoreSummary?.sad || 0) > 0;
          if (
            ((Array.isArray(data?.flaggedAnswers) && data.flaggedAnswers.length > 0) || hasRatingIssues) &&
            !isCompletedFlaggedSubmission
          ) {
            nextFlaggedCounts[formSlug] = (nextFlaggedCounts[formSlug] || 0) + 1;
          }

          const warningCount = Array.isArray(data?.warnings)
            ? data.warnings.filter(
                (warning) => warning && String(warning.category || "").trim().length > 0,
              ).length
            : data?.warningRegistered || String(data?.warningCategory || "").trim()
              ? 1
              : 0;

          if (warningCount > 0) {
            nextRemarkCounts[formSlug] = (nextRemarkCounts[formSlug] || 0) + warningCount;
          }

          if (String(data?.status || "").trim().toLowerCase() === "awaiting review") {
            const submittedAt = data?.submittedAt?.toMillis?.() ?? (data?.submittedAt?.seconds ? data.submittedAt.seconds * 1000 : null)
            const ageMs = submittedAt != null ? Date.now() - submittedAt : 0
            if (ageMs <= 14 * 24 * 60 * 60 * 1000) {
              nextCounts[formSlug] = (nextCounts[formSlug] || 0) + 1
            }
          }
        });

        if (remarkResult.status === "fulfilled") {
          remarkResult.value.forEach((item) => {
            const data = item.data();
            const formSlug = String(data?.formSlug || "").trim();
            const category = String(data?.category || "").trim();
            if (!formSlug || !category) {
              return;
            }

            nextRemarkCounts[formSlug] = (nextRemarkCounts[formSlug] || 0) + 1;
          });
        }

        if (!cancelled) {
          setPendingReviewCounts(nextCounts);
          setFlaggedCounts(nextFlaggedCounts);
          setRemarkCounts(nextRemarkCounts);
        }
      } catch {
        if (!cancelled) {
          setPendingReviewCounts({});
          setFlaggedCounts({});
          setRemarkCounts({});
        }
      }
    }

    loadPendingReviewCounts();

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const visibleForms = useMemo(
    () =>
      forms.filter(
        (form) => typeof form.slug === "string" && form.slug.length > 0,
      ),
    [forms],
  );
  const deletableForms = useMemo(() => visibleForms, [visibleForms]);

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setCreateState({ creating: false, error: "" });
  }

  function closeDeleteModal() {
    setIsDeleteModalOpen(false);
    setDeleteState((previous) => ({
      deleting: false,
      error: "",
      message: previous.message,
    }));
  }

  async function onCreateForm(event) {
    event.preventDefault();
    setCreateState({ creating: false, error: "" });

    const normalizedSlug = newFormSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!normalizedSlug) {
      setCreateState({ creating: false, error: "Oppgi en gyldig URL-del." });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
      setCreateState({
        creating: false,
        error: "URL-del kan kun inneholde små bokstaver, tall og bindestrek.",
      });
      return;
    }

    if (visibleForms.some((form) => form.slug === normalizedSlug)) {
      setCreateState({
        creating: false,
        error: "Et skjema med denne URL-en finnes allerede.",
      });
      return;
    }

    const title = newFormTitle.trim() || normalizedSlug;

    setCreateState({ creating: true, error: "" });
    try {
      await setDoc(doc(db, "forms", normalizedSlug), {
        slug: normalizedSlug,
        title,
        description: "",
        warningCategories: [],
        questions: [
          {
            id: "navn",
            label: "Navn",
            type: "name",
            required: true,
            placeholder: "",
          },
        ],
        updatedAt: serverTimestamp(),
      });

      closeCreateModal();
      navigate(`/skjema/${normalizedSlug}`);
    } catch {
      setCreateState({
        creating: false,
        error: "Kunne ikke opprette skjema. Prøv igjen.",
      });
    }
  }

  async function onDeleteForm(event) {
    event.preventDefault();
    setDeleteState({ deleting: false, error: "", message: "" });

    const targetSlug = deleteTargetSlug.trim().toLowerCase();
    if (!targetSlug) {
      setDeleteState({
        deleting: false,
        error: "Velg et skjema å slette.",
        message: "",
      });
      return;
    }

    const requiredConfirmation = `SLETT ${targetSlug}`;
    if (deleteConfirmText.trim() !== requiredConfirmation) {
      setDeleteState({
        deleting: false,
        error: `Skriv "${requiredConfirmation}" for å bekrefte.`,
        message: "",
      });
      return;
    }

    const targetForm = visibleForms.find((form) => form.slug === targetSlug);
    if (!targetForm) {
      setDeleteState({
        deleting: false,
        error: "Fant ikke valgt skjema.",
        message: "",
      });
      return;
    }

    setDeleteState({ deleting: true, error: "", message: "" });
    try {
      await deleteDoc(doc(db, "forms", targetForm.id || targetSlug));
      setForms((previous) =>
        previous.filter((form) => form.slug !== targetSlug),
      );
      setDeleteTargetSlug("");
      setDeleteConfirmText("");
      setDeleteState({
        deleting: false,
        error: "",
        message: `Skjema "${targetSlug}" er slettet.`,
      });
      setIsDeleteModalOpen(false);
    } catch {
      setDeleteState({
        deleting: false,
        error: "Kunne ikke slette skjema. Prøv igjen.",
        message: "",
      });
    }
  }

  return (
    <div className="forms-page">
      {isAdmin ? (
        <form action="/admin" method="get">
          <button type="submit" className="admin-login-link">
            Tilbake til admin
          </button>
        </form>
      ) : null}

      <header className="forms-hero">
        <p className="eyebrow">Skjemaer</p>
        <h1>Velg skjema</h1>
      </header>

      <section className="forms-grid" aria-live="polite">
        {loadingForms ? <p>Laster skjema...</p> : null}
        {formsError ? <p className="forms-error">{formsError}</p> : null}

        {!loadingForms &&
          visibleForms.map((form) => (
            <article key={form.slug} className="form-card">
              <h2>{form.title || form.slug}</h2>
              <p>{form.description || "Ingen beskrivelse enda."}</p>
              <div className="form-card-actions">
                <a
                  className="cta"
                  href={`/skjema/${form.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Åpne skjema
                </a>
                {isAdmin ? (
                  <>
                    <a
                      className="ghost"
                      href={`/skjema/${form.slug}/submissions`}
                    >
                      Submissions ({pendingReviewCounts[form.slug] || 0})
                    </a>
                    <a
                      className="ghost"
                      href={`/skjema/${form.slug}/edit`}
                    >
                      Edit form
                    </a>
                  </>
                ) : null}
              </div>
              {isAdmin ? (
                <div className="form-card-admin-row">
                  <a
                    className="ghost"
                    href={`/skjema/${form.slug}/flagget`}
                  >
                    Flagged ({flaggedCounts[form.slug] || 0})
                  </a>
                  <a
                    className="ghost"
                    href={`/skjema/${form.slug}/rating`}
                  >
                    Rating
                  </a>
                  <a
                    className="ghost"
                    href={`/skjema/${form.slug}/remarks`}
                  >
                    Remarks ({remarkCounts[form.slug] || 0})
                  </a>
                  <a
                    className="ghost"
                    href={`/skjema/${form.slug}/analyse`}
                  >
                    Varebeholdning
                  </a>
                </div>
              ) : null}
            </article>
          ))}
      </section>

      {loading || error || isAdmin ? (
        <section className={isAdmin ? "admin-box" : "admin-login-line"}>
          {loading ? <p>Kontrollerer innlogging...</p> : null}
          {error ? <p className="forms-error">{error}</p> : null}
          {isAdmin ? (
          <>
            <div className="admin-session">
              <p>Innlogget som {user?.email}</p>
            </div>
            <div className="forms-admin-toolbar">
              <button
                type="button"
                className="cta"
                onClick={() => setIsCreateModalOpen(true)}
              >
                Opprett nytt skjema
              </button>
              <button
                type="button"
                className="ghost danger-button"
                onClick={() => setIsDeleteModalOpen(true)}
                disabled={deletableForms.length === 0}
              >
                Slett skjema
              </button>
              <button
                type="button"
                className="ghost admin-logout-mini"
                onClick={signOutAdmin}
              >
                Logg ut
              </button>
            </div>
            {deleteState.message ? (
              <p className="forms-success">{deleteState.message}</p>
            ) : null}

            {isCreateModalOpen ? (
              <div
                className="submission-modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-form-modal-title"
                onClick={closeCreateModal}
              >
                <div
                  className="submission-modal forms-admin-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="submission-modal-header">
                    <h4 id="create-form-modal-title">Opprett nytt skjema</h4>
                    <button type="button" className="ghost" onClick={closeCreateModal}>
                      Lukk
                    </button>
                  </div>
                  <div className="submission-modal-content">
                    <form className="admin-create-form" onSubmit={onCreateForm}>
                      <label className="field-block" htmlFor="new-form-slug">
                        <span>URL-del (blir `/skjema/[url]`)</span>
                        <input
                          id="new-form-slug"
                          type="text"
                          value={newFormSlug}
                          onChange={(event) => setNewFormSlug(event.target.value)}
                          placeholder="f.eks. ukesrapport"
                          required
                        />
                      </label>

                      <label className="field-block" htmlFor="new-form-title">
                        <span>Tittel (valgfritt)</span>
                        <input
                          id="new-form-title"
                          type="text"
                          value={newFormTitle}
                          onChange={(event) => setNewFormTitle(event.target.value)}
                          placeholder="f.eks. Ukesrapport"
                        />
                      </label>

                      {createState.error ? (
                        <p className="forms-error">{createState.error}</p>
                      ) : null}

                      <div className="forms-admin-modal-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={closeCreateModal}
                        >
                          Avbryt
                        </button>
                        <button
                          type="submit"
                          className="cta"
                          disabled={createState.creating}
                        >
                          {createState.creating ? "Oppretter..." : "Opprett skjema"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            ) : null}

            {isDeleteModalOpen ? (
              <div
                className="submission-modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-form-modal-title"
                onClick={closeDeleteModal}
              >
                <div
                  className="submission-modal forms-admin-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="submission-modal-header">
                    <h4 id="delete-form-modal-title">Slett skjema</h4>
                    <button type="button" className="ghost" onClick={closeDeleteModal}>
                      Lukk
                    </button>
                  </div>
                  <div className="submission-modal-content">
                    <form className="admin-delete-form" onSubmit={onDeleteForm}>
                      <p className="delete-help">Sletting er permanent.</p>

                      <label className="field-block" htmlFor="delete-form-slug">
                        <span>Velg skjema</span>
                        <select
                          id="delete-form-slug"
                          value={deleteTargetSlug}
                          onChange={(event) => setDeleteTargetSlug(event.target.value)}
                          required
                        >
                          <option value="">Velg skjema</option>
                          {deletableForms.map((form) => (
                            <option key={form.slug} value={form.slug}>
                              {form.title || form.slug} ({form.slug})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="field-block" htmlFor="delete-form-confirmation">
                        <span>
                          Bekreft ved å skrive{" "}
                          <code>
                            {deleteTargetSlug
                              ? `SLETT ${deleteTargetSlug}`
                              : "SLETT [slug]"}
                          </code>
                        </span>
                        <input
                          id="delete-form-confirmation"
                          type="text"
                          value={deleteConfirmText}
                          onChange={(event) => setDeleteConfirmText(event.target.value)}
                          placeholder={
                            deleteTargetSlug
                              ? `SLETT ${deleteTargetSlug}`
                              : "SLETT [slug]"
                          }
                          required
                        />
                      </label>

                      {deleteState.error ? (
                        <p className="forms-error">{deleteState.error}</p>
                      ) : null}

                      <div className="forms-admin-modal-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={closeDeleteModal}
                        >
                          Avbryt
                        </button>
                        <button
                          type="submit"
                          className="ghost danger-button"
                          disabled={deleteState.deleting || deletableForms.length === 0}
                        >
                          {deleteState.deleting ? "Sletter..." : "Slett skjema"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            ) : null}
          </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default Forms;
