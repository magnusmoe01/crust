import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import './Bonus.css'

const BONUS_HOURLY_RATE = 166.34
const BONUS_THRESHOLD_RATE = 400
const BONUS_RATE = 0.15
const SESSION_KEY = 'crust-bonus-session'

function bonusPool(revenue, totalHours) {
  const surplus = Number(revenue) - BONUS_THRESHOLD_RATE * totalHours
  if (surplus <= 0) return 0
  return surplus * BONUS_RATE
}

function calcHours(start, end) {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let h = ((eh * 60 + em) - (sh * 60 + sm)) / 60
  if (h <= 0) h += 24
  return Math.round(h * 100) / 100
}

function fmtHours(h) {
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return `${hrs}t ${min}min`
}

function fmtKr(n) {
  return Number(n).toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']
  const [yr, mo, da] = dateStr.split('-')
  return `${parseInt(da)}. ${months[parseInt(mo) - 1]} ${yr}`
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s.token || !s.savedAt || Date.now() - s.savedAt > 7 * 24 * 3600 * 1000) return null
    return s
  } catch { return null }
}

function saveSession(token, name, phone) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, name, phone, savedAt: Date.now() }))
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export default function BonusPage() {
  const [session, setSession] = useState(loadSession)

  // Login
  const [phone, setPhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [loginState, setLoginState] = useState({ loading: false, error: '' })

  // Form
  const today = new Date().toISOString().slice(0, 10)
  const [shiftDate, setShiftDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [revenue, setRevenue] = useState('')
  const [submitState, setSubmitState] = useState({ loading: false, error: '' })

  // Multi-step flow
  const [formStep, setFormStep] = useState('form') // 'form' | 'alone_or_more' | 'waiting' | 'done'
  const [dayInfo, setDayInfo] = useState(null) // { dayId, participants, revenueKr, hoursWorked }
  const [approvalState, setApprovalState] = useState({ loading: false, error: '' })

  // Open day for today (joined by others but not yet by me)
  const [openDay, setOpenDay] = useState(null)
  const [openDayLoading, setOpenDayLoading] = useState(false)

  // History
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Formula explainer toggle
  const [showFormula, setShowFormula] = useState(false)

  useEffect(() => {
    if (session) {
      loadHistory()
      checkOpenDay(today)
    }
  }, [session])

  async function checkOpenDay(date) {
    if (!session) return
    setOpenDayLoading(true)
    try {
      const res = await httpsCallable(functions, 'getOpenDayForDate')({ sessionToken: session.token, date })
      setOpenDay(res.data || null)
    } catch { /* ignore */ } finally { setOpenDayLoading(false) }
  }

  async function loadHistory() {
    if (!session) return
    setHistoryLoading(true)
    try {
      const res = await httpsCallable(functions, 'getMyBonusShifts')({ sessionToken: session.token })
      setHistory(res.data || [])
    } catch { /* ignore */ } finally { setHistoryLoading(false) }
  }

  async function onSendOtp(e) {
    e.preventDefault()
    setLoginState({ loading: true, error: '' })
    try {
      await httpsCallable(functions, 'sendBonusOtp')({ phone })
      setOtpSent(true)
      setLoginState({ loading: false, error: '' })
    } catch (err) {
      setLoginState({ loading: false, error: err?.message || 'Noe gikk galt. Prøv igjen.' })
    }
  }

  async function onVerifyOtp(e) {
    e.preventDefault()
    setLoginState({ loading: true, error: '' })
    try {
      const res = await httpsCallable(functions, 'verifyBonusOtp')({ phone, code: otp })
      const { token, name, phone: verifiedPhone } = res.data
      saveSession(token, name, verifiedPhone)
      setSession({ token, name, phone: verifiedPhone, savedAt: Date.now() })
      setLoginState({ loading: false, error: '' })
    } catch (err) {
      setLoginState({ loading: false, error: err?.message || 'Feil kode. Prøv igjen.' })
    }
  }

  async function onSubmitShift(e) {
    e.preventDefault()
    setSubmitState({ loading: true, error: '' })
    try {
      const isJoining = openDay && !openDay.hasJoined && shiftDate === today
      const res = await httpsCallable(functions, 'createOrJoinBonusDay')({
        sessionToken: session.token,
        date: shiftDate,
        startTime,
        endTime,
        revenueKr: isJoining ? undefined : Number(revenue),
      })
      const { dayId, hoursWorked, dayRevenueKr, participants } = res.data
      setDayInfo({ dayId, hoursWorked, revenueKr: dayRevenueKr, participants })
      setFormStep('alone_or_more')
      setSubmitState({ loading: false, error: '' })
    } catch (err) {
      const msg = err?.message || 'Noe gikk galt. Prøv igjen.'
      if (msg.includes('økt') || msg.includes('Logg inn')) { clearSession(); setSession(null) }
      setSubmitState({ loading: false, error: msg })
    }
  }

  async function onSendForApproval() {
    setApprovalState({ loading: true, error: '' })
    try {
      await httpsCallable(functions, 'submitDayForApproval')({ sessionToken: session.token, dayId: dayInfo.dayId })
      setFormStep('done')
      loadHistory()
      setApprovalState({ loading: false, error: '' })
    } catch (err) {
      setApprovalState({ loading: false, error: err?.message || 'Noe gikk galt. Prøv igjen.' })
    }
  }

  async function onSendForApprovalFromHistory(dayId) {
    setApprovalState({ loading: true, error: '' })
    try {
      await httpsCallable(functions, 'submitDayForApproval')({ sessionToken: session.token, dayId })
      loadHistory()
      setApprovalState({ loading: false, error: '' })
    } catch (err) {
      setApprovalState({ loading: false, error: err?.message || 'Noe gikk galt. Prøv igjen.' })
    }
  }

  function resetForm() {
    setFormStep('form')
    setDayInfo(null)
    setStartTime('')
    setEndTime('')
    setRevenue('')
    setShiftDate(today)
    setOpenDay(null)
    checkOpenDay(today)
    loadHistory()
  }

  const previewHours = startTime && endTime ? calcHours(startTime, endTime) : null
  const isJoiningOpenDay = openDay && !openDay.hasJoined && shiftDate === today
  const previewRevenue = isJoiningOpenDay ? openDay.revenueKr : (revenue ? Number(revenue) : null)
  const previewPool = (previewHours && previewRevenue) ? bonusPool(previewRevenue, previewHours) : 0
  const previewBase = previewHours ? Math.round(previewHours * BONUS_HOURLY_RATE) : 0

  if (!session) {
    return (
      <div className="bonus-page">
        <div className="bonus-card">
          <div className="bonus-header">
            <div className="bonus-logo">Crust n&apos; Trust</div>
            <h1 className="bonus-title">Bonusregistrering</h1>
            <p className="bonus-subtitle">Logg inn med ditt telefonnummer for å registrere vakt og omsetning.</p>
          </div>
          {!otpSent ? (
            <form onSubmit={onSendOtp} className="bonus-form">
              <label className="bonus-label">Telefonnummer</label>
              <input
                className="bonus-input"
                type="tel"
                placeholder="12345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
              {loginState.error && <p className="bonus-error">{loginState.error}</p>}
              <button className="bonus-btn" type="submit" disabled={loginState.loading}>
                {loginState.loading ? 'Sender kode…' : 'Send kode via SMS'}
              </button>
            </form>
          ) : (
            <form onSubmit={onVerifyOtp} className="bonus-form">
              <p className="bonus-hint">En 6-sifret kode er sendt til <strong>{phone}</strong>. Koden er gyldig i 10 minutter.</p>
              <label className="bonus-label">Kode</label>
              <input
                className="bonus-input bonus-input--otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
              />
              {loginState.error && <p className="bonus-error">{loginState.error}</p>}
              <button className="bonus-btn" type="submit" disabled={loginState.loading || otp.length < 6}>
                {loginState.loading ? 'Bekrefter…' : 'Bekreft'}
              </button>
              <button
                type="button"
                className="bonus-btn-ghost"
                onClick={() => { setOtpSent(false); setOtp(''); setLoginState({ loading: false, error: '' }) }}
              >
                ← Endre telefonnummer
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bonus-page">
      <div className="bonus-card">
        <div className="bonus-header">
          <div className="bonus-header-row">
            <div>
              <div className="bonus-logo">Crust n&apos; Trust</div>
              <h1 className="bonus-title">Hei, {session.name}!</h1>
            </div>
            <button type="button" className="bonus-logout" onClick={() => { clearSession(); setSession(null) }}>
              Logg ut
            </button>
          </div>
        </div>

        {formStep === 'form' && (
          <>
            {openDayLoading && <p className="bonus-hint">Sjekker åpne registreringer…</p>}

            {isJoiningOpenDay && (
              <div className="bonus-open-day-banner">
                <div className="bonus-open-day-title">Åpen registrering for i dag</div>
                <div className="bonus-open-day-participants">
                  {openDay.participants.map(p => p.name).join(', ')} har allerede registrert seg.
                </div>
                <div className="bonus-open-day-revenue">Omsetning: {fmtKr(openDay.revenueKr)} kr (satt av første person)</div>
              </div>
            )}

            <form onSubmit={onSubmitShift} className="bonus-form">
              {!isJoiningOpenDay && (
                <div className="bonus-field">
                  <label className="bonus-label">Dato</label>
                  <input
                    className="bonus-input"
                    type="date"
                    value={shiftDate}
                    onChange={(e) => { setShiftDate(e.target.value); if (e.target.value !== today) setOpenDay(null) }}
                    required
                    max={today}
                  />
                </div>
              )}
              <div className="bonus-field-row">
                <div className="bonus-field">
                  <label className="bonus-label">Starttid</label>
                  <input className="bonus-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
                </div>
                <div className="bonus-field">
                  <label className="bonus-label">Sluttid</label>
                  <input className="bonus-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
                </div>
              </div>
              {previewHours != null && (
                <p className="bonus-hours-preview">Arbeidet tid: {fmtHours(previewHours)}</p>
              )}
              {!isJoiningOpenDay && (
                <div className="bonus-field">
                  <label className="bonus-label">Omsetning for dagen (kr)</label>
                  <input
                    className="bonus-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="F.eks. 32 500"
                    value={revenue}
                    onChange={(e) => setRevenue(e.target.value)}
                    required
                  />
                </div>
              )}

              {previewHours && previewRevenue ? (
                <div className="bonus-preview">
                  <p className="bonus-preview-title">Estimert utbetaling</p>
                  <div className="bonus-preview-row">
                    <span>Timelønn ({fmtHours(previewHours)})</span>
                    <span>{fmtKr(previewBase)} kr</span>
                  </div>
                  <div className="bonus-preview-row bonus-preview-row--bonus">
                    <span>Omsetningsbonus (hvis du er alene)</span>
                    <span>+ {fmtKr(previewPool)} kr</span>
                  </div>
                  <div className="bonus-preview-row bonus-preview-row--total">
                    <span>Totalsum</span>
                    <span>{fmtKr(previewBase + previewPool)} kr</span>
                  </div>
                  <p className="bonus-preview-note">Faktisk bonus fordeles proporsjonalt mellom alle som jobbet.</p>
                </div>
              ) : null}

              {submitState.error && <p className="bonus-error">{submitState.error}</p>}
              <button className="bonus-btn" type="submit" disabled={submitState.loading}>
                {submitState.loading ? 'Registrerer…' : isJoiningOpenDay ? 'Bli med og registrer vakt' : 'Registrer vakt'}
              </button>
            </form>
          </>
        )}

        {formStep === 'alone_or_more' && dayInfo && (
          <div className="bonus-step-card">
            <div className="bonus-step-icon">✓</div>
            <h2 className="bonus-step-title">Vakt registrert!</h2>
            <p className="bonus-step-body">
              Du har registrert <strong>{fmtHours(dayInfo.hoursWorked)}</strong> for {fmtDate(shiftDate || today)}.
            </p>
            <p className="bonus-step-question">Jobbet det andre i dag?</p>
            <div className="bonus-step-actions">
              <button
                className="bonus-btn"
                onClick={() => setFormStep('waiting')}
              >
                Ja, det jobbet flere
              </button>
              <button
                className="bonus-btn-secondary"
                onClick={onSendForApproval}
                disabled={approvalState.loading}
              >
                {approvalState.loading ? 'Sender…' : 'Nei, bare meg — send for godkjenning'}
              </button>
            </div>
            {approvalState.error && <p className="bonus-error">{approvalState.error}</p>}
          </div>
        )}

        {formStep === 'waiting' && dayInfo && (
          <div className="bonus-step-card">
            <div className="bonus-step-icon bonus-step-icon--waiting">⏳</div>
            <h2 className="bonus-step-title">Venter på andre</h2>
            <p className="bonus-step-body">Andre kan nå logge inn og legge inn sin vakt for {fmtDate(shiftDate || today)}.</p>
            {dayInfo.participants.length > 0 && (
              <div className="bonus-participants">
                <p className="bonus-participants-label">Registrert så langt:</p>
                <div className="bonus-participants-list">
                  {dayInfo.participants.map((p, i) => (
                    <span key={i} className="bonus-participant-chip">{p.name}</span>
                  ))}
                </div>
              </div>
            )}
            <button
              className="bonus-btn bonus-btn--submit-day"
              onClick={onSendForApproval}
              disabled={approvalState.loading}
            >
              {approvalState.loading ? 'Sender…' : 'Alle har lagt inn — send for godkjenning'}
            </button>
            {approvalState.error && <p className="bonus-error">{approvalState.error}</p>}
          </div>
        )}

        {formStep === 'done' && (
          <div className="bonus-step-card">
            <div className="bonus-step-icon">📨</div>
            <h2 className="bonus-step-title">Sendt for godkjenning!</h2>
            <p className="bonus-step-body">Admin vil godkjenne vakten og sende bonusinformasjon på e-post.</p>
            <button className="bonus-btn" onClick={resetForm}>Registrer ny vakt</button>
          </div>
        )}

        {/* Formula explainer */}
        <div className="bonus-formula-section">
          <button
            className="bonus-formula-toggle"
            type="button"
            onClick={() => setShowFormula(v => !v)}
          >
            {showFormula ? '▲' : '▼'} Slik beregnes bonusen
          </button>
          {showFormula && (
            <div className="bonus-formula-body">
              <p className="bonus-formula-intro">
                Bonusen er basert på <strong>omsetning per ansattime (OPA)</strong> — jo høyere omsetning per time dere jobbet, desto større bonus.
              </p>
              <div className="bonus-formula-steps">
                <div className="bonus-formula-step">
                  <span className="bonus-formula-step-num">1</span>
                  <div>
                    <strong>Terskel</strong> = {fmtKr(BONUS_THRESHOLD_RATE)} kr/t × antall timer totalt<br/>
                    <em>Dette er forventet «normalt» nivå.</em>
                  </div>
                </div>
                <div className="bonus-formula-step">
                  <span className="bonus-formula-step-num">2</span>
                  <div>
                    <strong>Overskudd</strong> = omsetning − terskel<br/>
                    <em>Alt over normalnivå er bonusgrunnlag.</em>
                  </div>
                </div>
                <div className="bonus-formula-step">
                  <span className="bonus-formula-step-num">3</span>
                  <div>
                    <strong>Bonuspott</strong> = overskudd × {Math.round(BONUS_RATE * 100)} %<br/>
                    <em>15 % av overskuddet fordeles mellom dere.</em>
                  </div>
                </div>
                <div className="bonus-formula-step">
                  <span className="bonus-formula-step-num">4</span>
                  <div>
                    <strong>Din andel</strong> = bonuspott × (dine timer / total timer)<br/>
                    <em>Jobbet du mer, får du mer.</em>
                  </div>
                </div>
              </div>
              <div className="bonus-formula-example">
                <p className="bonus-formula-example-title">Eksempel — 42 840 kr omsetning</p>
                <div className="bonus-formula-example-row"><span>2 ansatte: 8t 43min + 7t 50min = 16,5t</span></div>
                <div className="bonus-formula-example-row"><span>Terskel: {fmtKr(400)} × 16,5 = {fmtKr(400 * 16.5)} kr</span></div>
                <div className="bonus-formula-example-row"><span>Overskudd: 42 840 − {fmtKr(400 * 16.5)} = {fmtKr(42840 - 400 * 16.5)} kr</span></div>
                <div className="bonus-formula-example-row"><span>Bonuspott (15 %): {fmtKr(Math.round((42840 - 400 * 16.5) * 0.15))} kr</span></div>
                <div className="bonus-formula-example-row bonus-formula-example-row--result"><span>Ansatt 1 (8,73t): ≈ {fmtKr(Math.round((42840 - 400 * 16.5) * 0.15 * 8.73 / 16.5))} kr bonus</span></div>
                <div className="bonus-formula-example-row bonus-formula-example-row--result"><span>Ansatt 2 (7,83t): ≈ {fmtKr(Math.round((42840 - 400 * 16.5) * 0.15 * 7.83 / 16.5))} kr bonus</span></div>
              </div>
            </div>
          )}
        </div>

        {/* History */}
        {!historyLoading && history.length > 0 && (
          <div className="bonus-history">
            <h2 className="bonus-history-title">Dine registreringer</h2>
            {approvalState.error && <p className="bonus-error">{approvalState.error}</p>}
            {history.map((shift) => {
              const status = shift.dayStatus || shift.status
              return (
                <div key={shift.id} className={`bonus-history-item bonus-history-item--${status}`}>
                  <div className="bonus-history-top">
                    <span className="bonus-history-date">{fmtDate(shift.date)}</span>
                    <span className={`bonus-status-badge bonus-status-badge--${status}`}>
                      {status === 'open' ? 'Åpen' : status === 'pending_approval' ? 'Venter godkjenning' : 'Godkjent'}
                    </span>
                  </div>
                  <div className="bonus-history-detail">
                    {shift.startTime}–{shift.endTime} · {fmtHours(shift.hoursWorked)}
                  </div>
                  {status === 'open' && (
                    <button
                      className="bonus-btn-small bonus-btn-small--send"
                      onClick={() => onSendForApprovalFromHistory(shift.dayId)}
                      disabled={approvalState.loading}
                    >
                      {approvalState.loading ? 'Sender…' : 'Alle har lagt inn — send for godkjenning'}
                    </button>
                  )}
                  {status === 'approved' && shift.bonusKr != null && (
                    <div className="bonus-history-payout">
                      Timelønn: {fmtKr(shift.basePayKr)} kr + Bonus: {fmtKr(shift.bonusKr)} kr
                      = <strong>{fmtKr((shift.basePayKr || 0) + (shift.bonusKr || 0))} kr</strong>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
