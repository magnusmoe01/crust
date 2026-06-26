import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  addDoc, collection, doc, onSnapshot, orderBy, query,
  updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import './Valg.css'

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.length === 8 && /^\d+$/.test(p)) p = '47' + p
  return p
}

export default function ValgAdmin() {
  const { isAdmin, loading: adminLoading, signIn, error: authError } = useAdminSession()

  const [valg, setValg] = useState([])
  const [votes, setVotes] = useState([])
  const [expandedId, setExpandedId] = useState(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [createState, setCreateState] = useState({ loading: false, error: '' })

  // Per-valg state
  const [newParticipant, setNewParticipant] = useState({})
  const [addState, setAddState] = useState({})
  const [smsState, setSmsState] = useState({})

  useEffect(() => {
    if (!isAdmin) return
    const unsubValg = onSnapshot(
      query(collection(db, 'valg'), orderBy('createdAt', 'desc')),
      (snap) => setValg(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubVotes = onSnapshot(
      collection(db, 'valgVotes'),
      (snap) => setVotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return () => { unsubValg(); unsubVotes() }
  }, [isAdmin])

  async function onCreate(e) {
    e.preventDefault()
    const validOptions = options.map((o) => o.trim()).filter(Boolean)
    if (validOptions.length < 2) {
      setCreateState({ loading: false, error: 'Minst 2 alternativer er påkrevd' })
      return
    }
    setCreateState({ loading: true, error: '' })
    try {
      await addDoc(collection(db, 'valg'), {
        title: title.trim(),
        description: description.trim(),
        options: validOptions.map((label, i) => ({ id: `opt_${i}`, label })),
        confirmationMessage: confirmationMessage.trim() || 'Takk for ditt valg!',
        participants: [],
        status: 'active',
        createdAt: new Date(),
      })
      setTitle(''); setDescription(''); setOptions(['', '']); setConfirmationMessage('')
      setShowCreate(false)
      setCreateState({ loading: false, error: '' })
    } catch (err) {
      setCreateState({ loading: false, error: err?.message || 'Noe gikk galt' })
    }
  }

  async function onAddParticipant(valgId, e) {
    e.preventDefault()
    const phone = normalizePhone(newParticipant[valgId])
    if (!phone || !/^\d{10,15}$/.test(phone)) {
      setAddState((p) => ({ ...p, [valgId]: { loading: false, error: 'Ugyldig telefonnummer' } }))
      return
    }
    setAddState((p) => ({ ...p, [valgId]: { loading: true, error: '' } }))
    try {
      await updateDoc(doc(db, 'valg', valgId), { participants: arrayUnion(phone) })
      setNewParticipant((p) => ({ ...p, [valgId]: '' }))
      setAddState((p) => ({ ...p, [valgId]: { loading: false, error: '' } }))
    } catch (err) {
      setAddState((p) => ({ ...p, [valgId]: { loading: false, error: err?.message || 'Feil' } }))
    }
  }

  async function onRemoveParticipant(valgId, phone) {
    try { await updateDoc(doc(db, 'valg', valgId), { participants: arrayRemove(phone) }) } catch {}
  }

  async function onSendSms(valgId, phones) {
    setSmsState((p) => ({ ...p, [valgId]: { loading: true, error: '', done: '' } }))
    try {
      const res = await httpsCallable(functions, 'sendValgInvites')({ valgId, phones })
      setSmsState((p) => ({ ...p, [valgId]: { loading: false, error: '', done: `SMS sendt til ${res.data.sent} deltakere` } }))
    } catch (err) {
      setSmsState((p) => ({ ...p, [valgId]: { loading: false, error: err?.message || 'Feil ved sending', done: '' } }))
    }
  }

  async function onToggleStatus(valgId, currentStatus) {
    try { await updateDoc(doc(db, 'valg', valgId), { status: currentStatus === 'active' ? 'closed' : 'active' }) } catch {}
  }

  if (!adminLoading && !isAdmin) {
    return (
      <div className="valg-login-box">
        <h2>Valg Admin</h2>
        <button className="valg-create-toggle" onClick={signIn}>Admin login</button>
        {authError && <p style={{ color: '#dc2626', marginTop: 10 }}>{authError}</p>}
      </div>
    )
  }

  return (
    <div className="valg-admin-page">
      <div className="valg-admin-header">
        <div className="valg-admin-header-row">
          <h1>Valg</h1>
          <Link to="/admin" className="valg-back-btn">← Admin</Link>
        </div>
        <p>Opprett valg og send SMS-invitasjoner til ansatte.</p>
      </div>

      {/* Create */}
      <div className="valg-admin-create">
        <button className="valg-create-toggle" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? '✕ Avbryt' : '+ Nytt valg'}
        </button>
        {showCreate && (
          <form onSubmit={onCreate} className="valg-create-form">
            <div className="valg-form-field">
              <label>Tittel</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="F.eks. Sommerfest tidspunkt" />
            </div>
            <div className="valg-form-field">
              <label>Beskrivelse <span style={{ fontWeight: 400, color: '#9ca3af' }}>(valgfri)</span></label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Litt mer kontekst for deltakerne..." />
            </div>
            <div className="valg-form-field">
              <label>Alternativer</label>
              {options.map((opt, i) => (
                <div key={i} className="valg-option-row" style={{ marginBottom: 6 }}>
                  <input
                    value={opt}
                    onChange={(e) => setOptions((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                    placeholder={`Alternativ ${i + 1}`}
                  />
                  {options.length > 2 && (
                    <button type="button" className="valg-remove-option-btn" onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="valg-add-option-btn" onClick={() => setOptions((prev) => [...prev, ''])}>
                + Legg til alternativ
              </button>
            </div>
            <div className="valg-form-field">
              <label>Bekreftelsesmelding <span style={{ fontWeight: 400, color: '#9ca3af' }}>(vises etter valg)</span></label>
              <textarea
                value={confirmationMessage}
                onChange={(e) => setConfirmationMessage(e.target.value)}
                rows={2}
                placeholder="Takk for ditt valg! Vi gir deg beskjed om avgjørelsen."
              />
            </div>
            {createState.error && <p className="valg-error-msg-small" style={{ color: '#dc2626' }}>{createState.error}</p>}
            <button type="submit" className="valg-form-submit" disabled={createState.loading}>
              {createState.loading ? 'Oppretter...' : 'Opprett valg'}
            </button>
          </form>
        )}
      </div>

      {/* List */}
      {valg.length === 0 && !showCreate && <p className="valg-empty">Ingen valg opprettet ennå.</p>}

      {valg.map((v) => {
        const valgVotes = votes.filter((vote) => vote.valgId === v.id)
        const votedPhones = new Set(valgVotes.map((vote) => vote.phone))
        const pendingPhones = (v.participants || []).filter((p) => !votedPhones.has(p))
        const isOpen = expandedId === v.id
        const totalParticipants = (v.participants || []).length

        return (
          <div key={v.id} className={`valg-admin-card${v.status === 'closed' ? ' valg-admin-card--closed' : ''}`}>
            <div className="valg-admin-card-header" onClick={() => setExpandedId(isOpen ? null : v.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className="valg-admin-card-title">{v.title}</h3>
                <div className="valg-admin-card-meta">
                  <span className={`valg-status-badge valg-status-badge--${v.status}`}>
                    {v.status === 'active' ? 'Aktiv' : 'Avsluttet'}
                  </span>
                  <span>{valgVotes.length}/{totalParticipants} har svart</span>
                  <span>{(v.options || []).length} alternativer</span>
                </div>
              </div>
              <span className="valg-chevron">{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div className="valg-admin-card-body">

                {/* Results */}
                <div className="valg-results">
                  <h4>Resultater</h4>
                  {valgVotes.length === 0 ? (
                    <p className="valg-empty">Ingen svar ennå.</p>
                  ) : (
                    (v.options || []).map((opt) => {
                      const count = valgVotes.filter((vote) => vote.choice === opt.label).length
                      return (
                        <div key={opt.id} className="valg-result-row">
                          <div className="valg-result-label" title={opt.label}>{opt.label}</div>
                          <div className="valg-result-bar-wrap">
                            <div
                              className="valg-result-bar"
                              style={{ width: valgVotes.length > 0 ? `${(count / valgVotes.length) * 100}%` : '0%' }}
                            />
                          </div>
                          <div className="valg-result-count">{count}</div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Participants */}
                <div className="valg-participants">
                  <h4>Deltakere ({totalParticipants})</h4>
                  {totalParticipants === 0 && <p className="valg-empty" style={{ marginBottom: 8 }}>Ingen deltakere lagt til ennå.</p>}
                  <div className="valg-participant-list">
                    {(v.participants || []).map((phone) => {
                      const vote = valgVotes.find((vote) => vote.phone === phone)
                      const hasVoted = !!vote
                      return (
                        <div key={phone} className="valg-participant-row">
                          <span>
                            <span className={`valg-participant-phone${hasVoted ? ' valg-participant-phone--voted' : ''}`}>
                              {hasVoted ? '✓ ' : ''}{phone}
                            </span>
                            {vote && <span className="valg-participant-voted-choice">— {vote.choice}</span>}
                          </span>
                          <button className="valg-participant-remove" type="button" onClick={() => onRemoveParticipant(v.id, phone)}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                  <form onSubmit={(e) => onAddParticipant(v.id, e)} className="valg-add-participant-form">
                    <input
                      type="tel"
                      placeholder="Legg til telefonnummer"
                      value={newParticipant[v.id] || ''}
                      onChange={(e) => setNewParticipant((p) => ({ ...p, [v.id]: e.target.value }))}
                    />
                    <button type="submit" className="valg-add-participant-btn" disabled={addState[v.id]?.loading}>
                      Legg til
                    </button>
                    {addState[v.id]?.error && <p className="valg-error-msg-small">{addState[v.id].error}</p>}
                  </form>
                </div>

                {/* Send SMS */}
                <div className="valg-sms-section">
                  <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', margin: '0 0 10px' }}>Send SMS</h4>
                  <button
                    type="button"
                    className="valg-sms-btn"
                    onClick={() => onSendSms(v.id, v.participants || [])}
                    disabled={smsState[v.id]?.loading || totalParticipants === 0}
                  >
                    {smsState[v.id]?.loading ? 'Sender...' : `Send til alle (${totalParticipants})`}
                  </button>
                  {pendingPhones.length > 0 && pendingPhones.length < totalParticipants && (
                    <button
                      type="button"
                      className="valg-sms-btn valg-sms-btn--pending"
                      onClick={() => onSendSms(v.id, pendingPhones)}
                      disabled={smsState[v.id]?.loading}
                    >
                      Send kun til ikke-besvarte ({pendingPhones.length})
                    </button>
                  )}
                  {smsState[v.id]?.done && <p className="valg-success-msg">{smsState[v.id].done}</p>}
                  {smsState[v.id]?.error && <p className="valg-error-msg-small" style={{ color: '#dc2626' }}>{smsState[v.id].error}</p>}
                  <p className="valg-link-note">crust.no/valg/{v.id}</p>
                </div>

                {/* Toggle status */}
                <div>
                  <button
                    type="button"
                    className={`valg-toggle-status-btn${v.status === 'active' ? ' valg-toggle-status-btn--close' : ''}`}
                    onClick={() => onToggleStatus(v.id, v.status)}
                  >
                    {v.status === 'active' ? 'Avslutt valg' : 'Åpne valg igjen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
