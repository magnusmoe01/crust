import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, serverTimestamp, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { STENGESKJEMA_ID } from '../forms/defaultForms'
import './Forms.css'

function normalizeImageZoom(rawZoom) {
  const parsed = Number(rawZoom)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(2.5, Math.max(0.5, Math.round(parsed * 100) / 100))
}

export default function VarerPage() {
  const [questions, setQuestions] = useState([])
  const [locations, setLocations] = useState([])
  const [selectedLocation, setSelectedLocation] = useState('')
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [formsSnap, locSnap] = await Promise.all([
          getDocs(query(collection(db, 'forms'), where('slug', '==', STENGESKJEMA_ID))),
          getDocs(collection(db, 'locations')),
        ])
        const formData = formsSnap.docs[0]?.data() || {}
        const qs = (formData.questions || []).filter(
          (q) => q.includeInVarer && q.type !== 'section',
        )
        setQuestions(qs)

        const locs = locSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const orderDiff = (a.sortOrder ?? 99) - (b.sortOrder ?? 99)
            return orderDiff !== 0
              ? orderDiff
              : String(a.name || '').localeCompare(String(b.name || ''), 'nb')
          })
        setLocations(locs)
      } catch {
        setError('Kunne ikke laste skjema.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function setAnswer(id, value) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!selectedLocation) return
    setSubmitting(true)
    setError('')
    try {
      await addDoc(collection(db, 'varerSubmissions'), {
        formSlug: STENGESKJEMA_ID,
        location: selectedLocation,
        answers,
        submittedAt: serverTimestamp(),
      })
      setSubmitted(true)
    } catch {
      setError('Kunne ikke lagre. Prøv igjen.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="forms-page public-form-page">
        <p>Laster...</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="forms-page public-form-page">
        <div className="submit-overlay-card is-success" style={{ marginTop: 60 }}>
          <div className="submit-overlay-check" aria-hidden="true">✓</div>
          <p>Varebeholdning registrert!</p>
          <button
            className="ghost"
            onClick={() => { setSubmitted(false); setAnswers({}); setSelectedLocation('') }}
          >
            Registrer ny
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="forms-page public-form-page">
      <header className="forms-hero">
        <h1>Varebeholdning</h1>
      </header>

      <section className="form-entry">
        {questions.length === 0 ? (
          <p>Ingen varer er konfigurert ennå.</p>
        ) : (
          <form className="dynamic-form" onSubmit={onSubmit}>
            {/* Location picker */}
            <label
              className={`field-block form-question-block is-striped-light ${selectedLocation ? 'is-answered' : ''}`}
            >
              <div className="question-copy">
                <span className="question-label">Lokasjon</span>
              </div>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                required
              >
                <option value="">Velg lokasjon...</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.name || loc.id}>
                    {loc.name || loc.id}
                  </option>
                ))}
              </select>
            </label>

            {questions.map((q, i) => {
              const zoom = normalizeImageZoom(q.imageZoom)
              const isAnswered = Boolean(String(answers[q.id] || '').trim())
              const stripe = i % 2 === 0 ? 'is-striped-dark' : 'is-striped-light'
              return (
                <label
                  key={q.id}
                  htmlFor={q.id}
                  className={`field-block form-question-block ${stripe} ${isAnswered ? 'is-answered' : ''}`}
                >
                  <div className="question-copy">
                    <span className="question-label">{q.label}</span>
                  </div>
                  {q.imageUrl ? (
                    <div
                      className="question-image-frame"
                      style={{ '--question-image-scale': zoom }}
                    >
                      <img
                        className="question-image"
                        src={q.imageUrl}
                        alt={q.label}
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  {q.type === 'select' ? (
                    <select
                      id={q.id}
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    >
                      <option value="">Velg...</option>
                      {(q.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : q.type === 'textarea' ? (
                    <textarea
                      id={q.id}
                      rows={4}
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                      placeholder={q.placeholder || ''}
                    />
                  ) : (
                    <input
                      id={q.id}
                      type={q.type === 'number' ? 'number' : 'text'}
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                      placeholder={q.placeholder || ''}
                    />
                  )}
                </label>
              )
            })}

            {error ? <p className="forms-error">{error}</p> : null}

            <button type="submit" className="cta" disabled={submitting || !selectedLocation}>
              {submitting ? 'Lagrer...' : 'Send inn'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
