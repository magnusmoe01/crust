import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import './Valg.css'

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.length === 8 && /^\d+$/.test(p)) p = '47' + p
  return p
}

export default function ValgPage() {
  const { valgId } = useParams()

  const [valg, setValg] = useState(null)
  const [loading, setLoading] = useState(true)

  const [phone, setPhone] = useState('')
  const [step, setStep] = useState('phone') // 'phone' | 'options' | 'done'
  const [submitState, setSubmitState] = useState({ loading: false, error: '' })
  const [result, setResult] = useState(null) // { choice, confirmationMessage }

  useEffect(() => {
    getDoc(doc(db, 'valg', valgId))
      .then((snap) => {
        if (snap.exists()) setValg({ id: snap.id, ...snap.data() })
      })
      .finally(() => setLoading(false))
  }, [valgId])

  async function onSubmitChoice(optionLabel) {
    setSubmitState({ loading: true, error: '' })
    try {
      const res = await httpsCallable(functions, 'submitValgChoice')({
        valgId,
        phone: normalizePhone(phone),
        choice: optionLabel,
      })
      setResult(res.data)
      setStep('done')
      setSubmitState({ loading: false, error: '' })
    } catch (err) {
      setSubmitState({ loading: false, error: err?.message || 'Noe gikk galt. Prøv igjen.' })
    }
  }

  if (loading) {
    return (
      <div className="valg-page">
        <div className="valg-card">
          <div className="valg-header">
            <div className="valg-logo">Crust n&apos; Trust</div>
          </div>
          <div className="valg-body"><p style={{ color: '#6b7280' }}>Laster...</p></div>
        </div>
      </div>
    )
  }

  if (!valg) {
    return (
      <div className="valg-page">
        <div className="valg-card">
          <div className="valg-header">
            <div className="valg-logo">Crust n&apos; Trust</div>
            <h1 className="valg-title">Ikke funnet</h1>
          </div>
          <div className="valg-body">
            <p style={{ color: '#6b7280' }}>Dette valget finnes ikke eller er slettet.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="valg-page">
      <div className="valg-card">
        <div className="valg-header">
          <div className="valg-logo">Crust n&apos; Trust</div>
          <h1 className="valg-title">{valg.title}</h1>
          {valg.description && <p className="valg-description">{valg.description}</p>}
        </div>

        {valg.status === 'closed' && step !== 'done' ? (
          <div className="valg-closed-notice">
            Dette valget er avsluttet.
          </div>
        ) : step === 'done' ? (
          <div className="valg-done-box">
            <div className="valg-done-icon">✓</div>
            <h2 className="valg-done-title">Valg registrert!</h2>
            <p className="valg-done-message">
              {result?.confirmationMessage || 'Takk for ditt valg!'}
            </p>
          </div>
        ) : step === 'phone' ? (
          <div className="valg-body">
            <label className="valg-label">Ditt telefonnummer</label>
            <input
              className="valg-input"
              type="tel"
              placeholder="12345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
            <button
              className="valg-btn"
              onClick={() => setStep('options')}
              disabled={!phone.trim()}
            >
              Neste →
            </button>
          </div>
        ) : (
          <div className="valg-body">
            <p className="valg-phone-display">
              Telefon: {phone}
              <button onClick={() => { setStep('phone'); setSubmitState({ loading: false, error: '' }) }}>
                Endre
              </button>
            </p>
            <div className="valg-options">
              {(valg.options || []).map((opt) => (
                <button
                  key={opt.id}
                  className="valg-option-btn"
                  disabled={submitState.loading}
                  onClick={() => onSubmitChoice(opt.label)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {submitState.error && (
              <p className="valg-error-msg">{submitState.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
