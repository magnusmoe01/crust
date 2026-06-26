import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  addDoc, collection, doc, deleteDoc, onSnapshot, orderBy, query,
  setDoc, updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import './Bonus.css'
import './Valg.css'

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.length === 8 && /^\d+$/.test(p)) p = '47' + p
  return p
}

const FALLBACK_SMS_TEMPLATE = `Hei! Du er invitert til å gjøre et valg for Crust n' Trust: "{tittel}". Klikk her: {link}`

// GSM-7 basic character set (each = 1 credit)
const GSM7_SET = new Set(`@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà`)
// GSM-7 extended characters (each = 2 credits due to escape prefix)
const GSM7_EXT = new Set(`^{}\\[~]|€`)

function smsInfo(text) {
  let len = 0
  for (const ch of text) {
    if (GSM7_EXT.has(ch)) len += 2
    else if (GSM7_SET.has(ch)) len += 1
    else {
      // non-GSM-7 → UCS-2 encoding
      const uLen = [...text].length
      const parts = uLen <= 70 ? 1 : Math.ceil(uLen / 67)
      return { len: uLen, parts, limit: parts === 1 ? 70 : parts * 67, unicode: true }
    }
  }
  const parts = len <= 160 ? 1 : Math.ceil(len / 153)
  return { len, parts, limit: parts === 1 ? 160 : parts * 153, unicode: false }
}

function SmsCounter({ text }) {
  if (!text) return null
  const { len, parts, limit, unicode } = smsInfo(text)
  const color = parts >= 3 ? '#dc2626' : parts === 2 ? '#d97706' : '#9ca3af'
  return (
    <div style={{ textAlign: 'right', fontSize: '0.72rem', color, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
      {len}/{limit} tegn · {parts} SMS{unicode ? ' (unicode)' : ''}
    </div>
  )
}

function displayPhone(phone) {
  const s = String(phone)
  return s.startsWith('47') && s.length === 10 ? s.slice(2) : s
}

function ParticipantStatus({ phone, inviteTokens, invitesById }) {
  const token = inviteTokens?.[phone]
  if (!token) return <span className="valg-status-badge valg-status-badge--none">Ikke invitert</span>
  const invite = invitesById?.[token]
  if (!invite || !invite.openedAt) return <span className="valg-status-badge valg-status-badge--sent">Ikke åpnet</span>
  if (!invite.votedAt) return <span className="valg-status-badge valg-status-badge--opened">Åpnet</span>
  return (
    <span className="valg-status-badge valg-status-badge--voted">
      Stemt: {invite.choice}
    </span>
  )
}

export default function ValgAdmin() {
  const { isAdmin, loading: adminLoading, signIn, error: authError } = useAdminSession()

  const [valg, setValg] = useState([])
  const [invitesById, setInvitesById] = useState({}) // token → invite doc
  const [expandedId, setExpandedId] = useState(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [createState, setCreateState] = useState({ loading: false, error: '' })

  // Global default SMS template
  const [defaultSmsTemplate, setDefaultSmsTemplate] = useState(FALLBACK_SMS_TEMPLATE)
  const [defaultTemplateDraft, setDefaultTemplateDraft] = useState(null) // null = not yet loaded

  // Per-valg state
  const [newParticipant, setNewParticipant] = useState({})
  const [addState, setAddState] = useState({})
  const [smsState, setSmsState] = useState({})
  const [smsTemplates, setSmsTemplates] = useState({}) // local editing state per valg

  useEffect(() => {
    if (!isAdmin) return
    const unsubValg = onSnapshot(
      query(collection(db, 'valg'), orderBy('createdAt', 'desc')),
      (snap) => setValg(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubInvites = onSnapshot(
      collection(db, 'valgInvites'),
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => { map[d.id] = { id: d.id, ...d.data() } })
        setInvitesById(map)
      }
    )
    const unsubSettings = onSnapshot(doc(db, 'siteSettings', 'valg'), (snap) => {
      const tmpl = snap.exists() ? (snap.data().defaultSmsTemplate || FALLBACK_SMS_TEMPLATE) : FALLBACK_SMS_TEMPLATE
      setDefaultSmsTemplate(tmpl)
      setDefaultTemplateDraft((prev) => prev === null ? tmpl : prev)
    })
    return () => { unsubValg(); unsubInvites(); unsubSettings() }
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

  async function onSaveDefaultTemplate() {
    const tmpl = (defaultTemplateDraft || '').trim() || FALLBACK_SMS_TEMPLATE
    await setDoc(doc(db, 'siteSettings', 'valg'), { defaultSmsTemplate: tmpl }, { merge: true })
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

  async function onResetVote(token, phone) {
    if (!window.confirm(`Slett registrert svar for ${displayPhone(phone)}?`)) return
    try {
      await updateDoc(doc(db, 'valgInvites', token), { choice: null, choiceId: null, votedAt: null })
    } catch {}
  }

  async function onSendSms(v, phones, template) {
    setSmsState((p) => ({ ...p, [v.id]: { loading: true, error: '', done: '' } }))
    try {
      const res = await httpsCallable(functions, 'sendValgInvites')({
        valgId: v.id,
        phones,
        smsTemplate: template || null,
      })
      // persist template if changed
      if (template && template !== v.smsTemplate) {
        await updateDoc(doc(db, 'valg', v.id), { smsTemplate: template }).catch(() => {})
      }
      setSmsState((p) => ({ ...p, [v.id]: { loading: false, error: '', done: `SMS sendt til ${res.data.sent} deltakere` } }))
    } catch (err) {
      setSmsState((p) => ({ ...p, [v.id]: { loading: false, error: err?.message || 'Feil ved sending', done: '' } }))
    }
  }

  async function onToggleStatus(valgId, currentStatus) {
    try { await updateDoc(doc(db, 'valg', valgId), { status: currentStatus === 'active' ? 'closed' : 'active' }) } catch {}
  }

  async function onDeleteValg(valgId, title) {
    if (!window.confirm(`Slett "${title}"? Dette kan ikke angres.`)) return
    try { await deleteDoc(doc(db, 'valg', valgId)) } catch {}
  }

  if (!adminLoading && !isAdmin) {
    return (
      <div className="ba-page">
        <div className="ba-wrap" style={{ maxWidth: 400, marginTop: 60 }}>
          <div className="ba-header"><h1 className="ba-title">Valg Admin</h1></div>
          <button type="button" className="ba-btn ba-btn--primary" onClick={signIn}>Admin login</button>
          {authError && <p className="ba-error" style={{ marginTop: 10 }}>{authError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="ba-page">
      <div className="ba-wrap">

        <div className="ba-header">
          <div className="ba-header-row">
            <div>
              <h1 className="ba-title">Valg</h1>
              <p className="ba-subtitle">Opprett valg og send unike SMS-invitasjoner til ansatte.</p>
            </div>
            <Link to="/admin" className="ba-back-btn">← Admin</Link>
          </div>
        </div>

        {/* Default SMS template */}
        <div className="ba-panel">
          <div style={{ padding: '14px 20px' }}>
            <div className="ba-field" style={{ marginBottom: 8 }}>
              <label className="ba-label">
                Standard SMS-tekst
                <span className="ba-label-hint" style={{ marginLeft: 6 }}>— brukes som mal for alle nye valg · {'{tittel}'} og {'{link}'} erstattes automatisk</span>
              </label>
              <textarea
                className="ba-input"
                style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem' }}
                rows={3}
                value={defaultTemplateDraft ?? ''}
                onChange={(e) => setDefaultTemplateDraft(e.target.value)}
                onBlur={onSaveDefaultTemplate}
              />
              <SmsCounter text={defaultTemplateDraft ?? ''} />
            </div>
            {defaultTemplateDraft !== defaultSmsTemplate && (
              <button type="button" className="ba-btn ba-btn--primary ba-btn--sm" onClick={onSaveDefaultTemplate}>
                Lagre
              </button>
            )}
          </div>
        </div>

        {/* Create panel */}
        <div className="ba-panel">
          <button type="button" className="ba-panel-toggle" onClick={() => setShowCreate((v) => !v)}>
            <span className="ba-panel-toggle-left">
              <span className="ba-panel-toggle-icon">＋</span>
              <span className="ba-panel-toggle-label">Nytt valg</span>
            </span>
            <span className="ba-chevron">{showCreate ? '▲' : '▼'}</span>
          </button>

          {showCreate && (
            <form onSubmit={onCreate} style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="ba-field">
                <label className="ba-label">Tittel</label>
                <input className="ba-input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="F.eks. Sommerfest tidspunkt" />
              </div>
              <div className="ba-field">
                <label className="ba-label">Beskrivelse <span className="ba-label-hint">(valgfri)</span></label>
                <textarea className="ba-input" style={{ resize: 'vertical', fontFamily: 'inherit' }} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Litt mer kontekst for deltakerne..." />
              </div>
              <div className="ba-field">
                <label className="ba-label">Alternativer</label>
                {options.map((opt, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      className="ba-input"
                      style={{ flex: 1 }}
                      value={opt}
                      onChange={(e) => setOptions((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                      placeholder={`Alternativ ${i + 1}`}
                    />
                    {options.length > 2 && (
                      <button type="button" className="ba-btn ba-btn--remove" onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </div>
                ))}
                <button type="button" className="valg-add-option-btn" onClick={() => setOptions((prev) => [...prev, ''])}>
                  + Legg til alternativ
                </button>
              </div>
              <div className="ba-field">
                <label className="ba-label">Bekreftelsesmelding <span className="ba-label-hint">(vises etter valg)</span></label>
                <textarea className="ba-input" style={{ resize: 'vertical', fontFamily: 'inherit' }} rows={2} value={confirmationMessage} onChange={(e) => setConfirmationMessage(e.target.value)} placeholder="Takk for ditt valg! Vi gir deg beskjed om avgjørelsen." />
              </div>
              {createState.error && <p className="ba-error">{createState.error}</p>}
              <div>
                <button type="submit" className="ba-btn ba-btn--primary" disabled={createState.loading}>
                  {createState.loading ? 'Oppretter...' : 'Opprett valg'}
                </button>
              </div>
            </form>
          )}
        </div>

        {!adminLoading && valg.length === 0 && (
          <p className="ba-empty">Ingen valg opprettet ennå.</p>
        )}

        {valg.map((v) => {
          const inviteTokens = v.inviteTokens || {}
          const totalParticipants = (v.participants || []).length
          const votedCount = (v.participants || []).filter((phone) => {
            const token = inviteTokens[phone]
            return token && invitesById[token]?.votedAt
          }).length
          const notVotedPhones = (v.participants || []).filter((phone) => {
            const token = inviteTokens[phone]
            return !token || !invitesById[token]?.votedAt
          })
          const isOpen = expandedId === v.id
          const currentTemplate = smsTemplates[v.id] ?? v.smsTemplate ?? defaultSmsTemplate

          return (
            <div key={v.id} className="ba-panel" style={{ opacity: v.status === 'closed' ? 0.8 : 1 }}>
              <button type="button" className="ba-panel-toggle" onClick={() => setExpandedId(isOpen ? null : v.id)}>
                <span className="ba-panel-toggle-left">
                  <span className="ba-panel-toggle-icon">{v.status === 'active' ? '🗳️' : '🔒'}</span>
                  <span>
                    <span className="ba-panel-toggle-label">{v.title}</span>
                    <span style={{ marginLeft: 10, fontSize: '0.78rem', color: '#9ca3af' }}>
                      {votedCount}/{totalParticipants} svar
                      {v.status === 'closed' && <span style={{ marginLeft: 8 }}>· Avsluttet</span>}
                    </span>
                  </span>
                </span>
                <span className="ba-chevron">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 22 }}>

                  {/* Results */}
                  <div>
                    <p className="valg-section-label">Resultater</p>
                    {votedCount === 0 ? (
                      <p className="ba-empty">Ingen svar ennå.</p>
                    ) : (
                      (v.options || []).map((opt) => {
                        const count = Object.values(invitesById).filter(
                          (inv) => inv.valgId === v.id && inv.choice === opt.label
                        ).length
                        const pct = votedCount > 0 ? (count / votedCount) * 100 : 0
                        return (
                          <div key={opt.id} className="valg-result-row">
                            <div className="valg-result-label" title={opt.label}>{opt.label}</div>
                            <div className="valg-result-bar-wrap">
                              <div className="valg-result-bar" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="valg-result-count">{count}</div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Participants overview */}
                  <div>
                    <p className="valg-section-label">Deltakere ({totalParticipants})</p>
                    {totalParticipants === 0 && <p className="ba-empty" style={{ marginBottom: 8 }}>Ingen lagt til ennå.</p>}

                    {totalParticipants > 0 && (
                      <div className="valg-participant-table">
                        {(v.participants || []).map((phone) => {
                          const token = inviteTokens[phone]
                          const invite = token ? invitesById[token] : null
                          return (
                            <div key={phone} className="valg-participant-row">
                              <span className="valg-participant-phone">{displayPhone(phone)}</span>
                              <ParticipantStatus phone={phone} inviteTokens={inviteTokens} invitesById={invitesById} />
                              <div style={{ display: 'flex', gap: 4 }}>
                                {invite?.votedAt && (
                                  <button
                                    type="button"
                                    className="valg-participant-remove"
                                    title="Slett registrert svar"
                                    style={{ color: '#d97706' }}
                                    onClick={() => onResetVote(token, phone)}
                                  >↺</button>
                                )}
                                <button
                                  type="button"
                                  className="valg-participant-remove"
                                  title="Fjern deltaker"
                                  onClick={() => onRemoveParticipant(v.id, phone)}
                                >✕</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <form onSubmit={(e) => onAddParticipant(v.id, e)} className="valg-add-participant-form" style={{ marginTop: 10 }}>
                      <input
                        type="tel"
                        className="ba-input"
                        style={{ flex: 1, minWidth: 160 }}
                        placeholder="Legg til telefonnummer"
                        value={newParticipant[v.id] || ''}
                        onChange={(e) => setNewParticipant((p) => ({ ...p, [v.id]: e.target.value }))}
                      />
                      <button type="submit" className="ba-btn ba-btn--primary ba-btn--sm" disabled={addState[v.id]?.loading}>
                        Legg til
                      </button>
                      {addState[v.id]?.error && <p className="ba-error" style={{ width: '100%', margin: 0 }}>{addState[v.id].error}</p>}
                    </form>
                  </div>

                  {/* Send SMS */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p className="valg-section-label">Send SMS</p>
                    <div className="ba-field">
                      <label className="ba-label">SMS-tekst <span className="ba-label-hint">— bruk {'{link}'} for unik lenke, {'{tittel}'} for valgnavnet</span></label>
                      <textarea
                        className="ba-input"
                        style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem' }}
                        rows={3}
                        value={currentTemplate}
                        onChange={(e) => setSmsTemplates((p) => ({ ...p, [v.id]: e.target.value }))}
                      />
                      <SmsCounter text={currentTemplate} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="ba-btn ba-btn--primary ba-btn--sm"
                        onClick={() => onSendSms(v, v.participants || [], currentTemplate)}
                        disabled={smsState[v.id]?.loading || totalParticipants === 0}
                      >
                        {smsState[v.id]?.loading ? 'Sender...' : `Send til alle (${totalParticipants})`}
                      </button>
                      {notVotedPhones.length > 0 && notVotedPhones.length < totalParticipants && (
                        <button
                          type="button"
                          className="ba-btn ba-btn--sm"
                          style={{ background: '#6b7280', color: '#fff' }}
                          onClick={() => onSendSms(v, notVotedPhones, currentTemplate)}
                          disabled={smsState[v.id]?.loading}
                        >
                          Send til ikke-besvarte ({notVotedPhones.length})
                        </button>
                      )}
                    </div>
                    {smsState[v.id]?.done && <p className="ba-success">{smsState[v.id].done}</p>}
                    {smsState[v.id]?.error && <p className="ba-error">{smsState[v.id].error}</p>}
                  </div>

                  {/* Toggle status + delete */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="ba-btn ba-btn--sm"
                      style={v.status === 'active'
                        ? { background: 'none', border: '1.5px solid #fecaca', color: '#dc2626' }
                        : { background: 'none', border: '1.5px solid #d1d5db', color: '#6b7280' }}
                      onClick={() => onToggleStatus(v.id, v.status)}
                    >
                      {v.status === 'active' ? 'Avslutt valg' : 'Åpne valg igjen'}
                    </button>
                    <button
                      type="button"
                      className="ba-btn ba-btn--sm"
                      style={{ background: 'none', border: '1.5px solid #fecaca', color: '#dc2626' }}
                      onClick={() => onDeleteValg(v.id, v.title)}
                    >
                      Slett valg
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
