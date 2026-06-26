import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import './Valg.css'

const OPTION_STYLES = [
  { bg: '#f0fdf4', accent: '#16a34a', text: '#14532d' },
  { bg: '#eff6ff', accent: '#2563eb', text: '#1e3a8a' },
  { bg: '#fff7ed', accent: '#ea580c', text: '#7c2d12' },
  { bg: '#fdf4ff', accent: '#9333ea', text: '#581c87' },
  { bg: '#fef2f2', accent: '#dc2626', text: '#7f1d1d' },
  { bg: '#f0fdfa', accent: '#0891b2', text: '#164e63' },
]

export default function ValgPage() {
  const { token } = useParams()

  const [valg, setValg] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [alreadyVoted, setAlreadyVoted] = useState(false)
  const [alreadyVotedChoice, setAlreadyVotedChoice] = useState('')

  const [step, setStep] = useState('options') // 'options' | 'done'
  const [submitState, setSubmitState] = useState({ loading: false, error: '' })
  const [result, setResult] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const openFn = httpsCallable(functions, 'openValgInvite')
        const res = await openFn({ token })
        const { valgId, alreadyVoted: voted, choice } = res.data
        if (voted) {
          setAlreadyVoted(true)
          setAlreadyVotedChoice(choice || '')
        }
        const valgSnap = await getDoc(doc(db, 'valg', valgId))
        if (!valgSnap.exists()) { setLoadError('Valget finnes ikke.'); return }
        setValg({ id: valgSnap.id, ...valgSnap.data() })
      } catch (err) {
        setLoadError(err?.message || 'Ugyldig eller utløpt lenke.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  async function onSubmitChoice(optionLabel) {
    setSubmitState({ loading: true, error: '' })
    try {
      const res = await httpsCallable(functions, 'submitValgChoice')({ token, choice: optionLabel })
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
          <div className="valg-header"><div className="valg-logo">Crust n&apos; Trust</div></div>
          <div className="valg-body"><p style={{ color: '#6b7280' }}>Laster...</p></div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="valg-page">
        <div className="valg-card">
          <div className="valg-header">
            <div className="valg-logo">Crust n&apos; Trust</div>
            <h1 className="valg-title">Ugyldig lenke</h1>
          </div>
          <div className="valg-body">
            <p style={{ color: '#6b7280' }}>{loadError}</p>
          </div>
        </div>
      </div>
    )
  }

  if (alreadyVoted) {
    return (
      <div className="valg-page">
        <div className="valg-card">
          <div className="valg-header">
            <div className="valg-logo">Crust n&apos; Trust</div>
            <h1 className="valg-title">{valg?.title}</h1>
          </div>
          <div className="valg-done-box">
            <div className="valg-done-icon">✓</div>
            <h2 className="valg-done-title">Allerede registrert</h2>
            <p className="valg-done-message">
              Du har allerede valgt <strong>{alreadyVotedChoice}</strong>.
            </p>
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
          <h1 className="valg-title">{valg?.title}</h1>
          {valg?.description && <p className="valg-description">{valg.description}</p>}
        </div>

        {valg?.status === 'closed' && step !== 'done' ? (
          <div className="valg-closed-notice">Dette valget er avsluttet.</div>
        ) : step === 'done' ? (
          <div className="valg-done-box">
            <div className="valg-done-icon">✓</div>
            <h2 className="valg-done-title">Valg registrert!</h2>
            <p className="valg-done-choice">Du valgte: <strong>{result?.choice}</strong></p>
            <p className="valg-done-message">{result?.confirmationMessage || 'Takk for ditt valg!'}</p>
          </div>
        ) : (
          <div className="valg-body">
            <div className="valg-options">
              {(valg?.options || []).map((opt, i) => {
                const s = OPTION_STYLES[i % OPTION_STYLES.length]
                return (
                  <button
                    key={opt.id}
                    className="valg-option-btn"
                    style={{ background: s.bg, borderColor: s.accent, color: s.text }}
                    disabled={submitState.loading}
                    onClick={() => onSubmitChoice(opt.label)}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {submitState.error && <p className="valg-error-msg">{submitState.error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
