import { useRef, useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { getDoc, doc } from 'firebase/firestore'
import { db, functions } from '../firebase'
import './Bonus.css'

const BONUS_HOURLY_RATE = 166.34
const BONUS_THRESHOLD_RATE = 400
const BONUS_RATE = 0.15
const BONUS_START_DATE = '2026-06-25'
const SESSION_EXPIRY_MS = 365 * 24 * 3600 * 1000 // 1 year

function tieredPoolRate(revenue, baseRevenue, baseRatePct, stepKr, stepRatePct) {
  const rev = Number(revenue), base = Number(baseRevenue), rate = Number(baseRatePct)
  const step = Number(stepKr), inc = Number(stepRatePct)
  if (!base || rev < base) return 0
  const steps = Math.floor((rev - base) / Math.max(step, 1))
  return rate + steps * inc
}
const SESSION_KEY = 'crust-bonus-session'

function bonusPool(revenue, totalHours) {
  const surplus = Number(revenue) - BONUS_THRESHOLD_RATE * totalHours
  if (surplus <= 0) return 0
  return surplus * BONUS_RATE
}

function BonusCalcChart({ thresholdKr, poolConfig, myHours, totalHours, hourlyRate, maxRevenue = 100000 }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const W = 424, H = 160
  const PAD = { t: 16, r: 12, b: 36, l: 56 }
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b
  const n = totalHours > 0 ? totalHours / Math.max(myHours, 0.01) : 1

  const poolAt = (rev) => {
    const rate = tieredPoolRate(rev, poolConfig.poolBaseRevenue, poolConfig.poolBaseRatePct, poolConfig.poolStepKr, poolConfig.poolStepRatePct)
    return Math.max(0, (rev - thresholdKr) * rate / 100)
  }
  const myShareAt = (rev) => (totalHours > 0 ? poolAt(rev) * myHours / totalHours : 0)
  const basePay = myHours * hourlyRate
  const totalAt = (rev) => basePay + myShareAt(rev)

  const yMax = Math.max(totalAt(maxRevenue) * 1.2, basePay * 2, 500)
  const x = (r) => (r / maxRevenue) * iW
  const y = (v) => iH - (v / yMax) * iH

  const nPts = 80
  const pts = Array.from({ length: nPts + 1 }, (_, i) => ({ rev: (i / nPts) * maxRevenue }))
  const totalPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.rev).toFixed(1)} ${y(totalAt(p.rev)).toFixed(1)}`).join(' ')

  const threshIdx = pts.findIndex(p => p.rev >= thresholdKr)
  const areaPts = pts.slice(Math.max(0, threshIdx - 1))
  const areaPath = areaPts.length > 1
    ? `M ${x(areaPts[0].rev).toFixed(1)} ${iH} ` + areaPts.map(p => `L ${x(p.rev).toFixed(1)} ${y(totalAt(p.rev)).toFixed(1)}`).join(' ') + ` L ${iW} ${iH} Z`
    : ''

  const xTicks = [0, 20000, 40000, 60000, 80000, 100000].filter(v => v <= maxRevenue)
  const ySteps = 4
  const yTicks = Array.from({ length: ySteps + 1 }, (_, i) => (yMax * i) / ySteps)
  const fmt = (n) => n >= 1000 ? `${Math.round(n / 100) / 10}k` : Math.round(n)

  function handleMouseMove(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const rawX = ((e.clientX - rect.left) / rect.width) * W - PAD.l
    if (rawX < 0 || rawX > iW) { setHover(null); return }
    const rev = Math.round((rawX / iW) * maxRevenue / 500) * 500
    setHover({ rev, total: totalAt(rev), bonus: myShareAt(rev), px: x(rev) })
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
      <g transform={`translate(${PAD.l},${PAD.t})`}>
        {yTicks.map((v, i) => <line key={i} x1={0} y1={y(v)} x2={iW} y2={y(v)} stroke="#f3f4f6" />)}
        {areaPath && <path d={areaPath} fill="#ede9fe" opacity={0.7} />}
        {basePay > 0 && basePay < yMax && <line x1={0} y1={y(basePay)} x2={iW} y2={y(basePay)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" />}
        {thresholdKr > 0 && thresholdKr < maxRevenue && <line x1={x(thresholdKr)} y1={0} x2={x(thresholdKr)} y2={iH} stroke="#f59e0b" strokeWidth={1.2} strokeDasharray="4 3" />}
        <path d={totalPath} fill="none" stroke="#7c3aed" strokeWidth={2.5} strokeLinecap="round" />
        {hover && (
          <>
            <line x1={hover.px} y1={0} x2={hover.px} y2={iH} stroke="#c4b5fd" strokeWidth={1} strokeDasharray="3 2" />
            <circle cx={hover.px} cy={y(hover.total)} r={4} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} />
            {(() => {
              const tx = hover.px > iW * 0.6 ? hover.px - 120 : hover.px + 8
              return (
                <g>
                  <rect x={tx} y={4} width={112} height={38} rx={5} fill="#4c1d95" opacity={0.93} />
                  <text x={tx + 8} y={16} fontSize={8} fill="#ddd6fe">{(hover.rev / 1000).toFixed(0)}k kr omsetning</text>
                  <text x={tx + 8} y={28} fontSize={9} fill="#fff">Totalt: {fmt(hover.total)} kr</text>
                  <text x={tx + 8} y={39} fontSize={8} fill="#c4b5fd">Bonus: +{fmt(hover.bonus)} kr</text>
                </g>
              )
            })()}
          </>
        )}
        <line x1={0} y1={iH} x2={iW} y2={iH} stroke="#e5e7eb" />
        <line x1={0} y1={0} x2={0} y2={iH} stroke="#e5e7eb" />
        {xTicks.map(v => (
          <g key={v}>
            <line x1={x(v)} y1={iH} x2={x(v)} y2={iH + 4} stroke="#d1d5db" />
            <text x={x(v)} y={iH + 13} textAnchor="middle" fontSize={8.5} fill="#9ca3af">{v === 0 ? '0' : `${v / 1000}k`}</text>
          </g>
        ))}
        {yTicks.filter((_, i) => i > 0).map(v => (
          <g key={v}>
            <line x1={-4} y1={y(v)} x2={0} y2={y(v)} stroke="#d1d5db" />
            <text x={-7} y={y(v) + 3.5} textAnchor="end" fontSize={8.5} fill="#9ca3af">{fmt(v)}</text>
          </g>
        ))}
        <text x={iW / 2} y={iH + 26} textAnchor="middle" fontSize={9} fill="#9ca3af">Omsetning (kr)</text>
      </g>
    </svg>
  )
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
    const sim = sessionStorage.getItem('bonusSimSession')
    if (sim) {
      const s = JSON.parse(sim)
      if (s.token && s.savedAt && Date.now() - s.savedAt < 3600 * 1000) return s
      sessionStorage.removeItem('bonusSimSession')
    }
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s.token || !s.savedAt || Date.now() - s.savedAt > SESSION_EXPIRY_MS) return null
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
  const [numWorkers, setNumWorkers] = useState('')
  const [submitState, setSubmitState] = useState({ loading: false, error: '' })

  // Multi-step flow
  const [formStep, setFormStep] = useState('form') // 'form' | 'alone_or_more' | 'waiting' | 'done'
  const [dayInfo, setDayInfo] = useState(null) // { dayId, participants, revenueKr, hoursWorked }
  const [approvalState, setApprovalState] = useState({ loading: false, error: '' })
  const [deleteState, setDeleteState] = useState({})

  // Open day for today (joined by others but not yet by me)
  const [openDay, setOpenDay] = useState(null)
  const [openDayLoading, setOpenDayLoading] = useState(false)

  // History
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Formula explainer toggle
  const [showFormula, setShowFormula] = useState(false)
  const [showRegModal, setShowRegModal] = useState(false)

  // Bonus calculator
  const [bonusConfig, setBonusConfig] = useState({
    poolBaseRevenue: 20000, poolBaseRatePct: 20, poolStepEnabled: true, poolStepKr: 10000, poolStepRatePct: 5,
    fallbackHourlyRate: BONUS_HOURLY_RATE,
  })
  const [showCalc, setShowCalc] = useState(false)
  const [calcRevenue, setCalcRevenue] = useState('')
  const [calcMyHours, setCalcMyHours] = useState('')
  const [calcNumEmp, setCalcNumEmp] = useState('2')

  useEffect(() => {
    getDoc(doc(db, 'siteSettings', 'bonusConfig')).then(d => {
      if (d.exists()) {
        const cfg = d.data()
        setBonusConfig({
          poolBaseRevenue:  cfg.poolBaseRevenue  ?? 20000,
          poolBaseRatePct:  cfg.poolBaseRatePct  ?? 20,
          poolStepEnabled:  cfg.poolStepEnabled  ?? true,
          poolStepKr:       cfg.poolStepKr       ?? 10000,
          poolStepRatePct:  cfg.poolStepRatePct  ?? 5,
          fallbackHourlyRate: cfg.fallbackHourlyRate || BONUS_HOURLY_RATE,
        })
      }
    }).catch(() => {})
  }, [])

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
      const day = res.data || null
      setOpenDay(day)
      if (day?.revenueKr != null) setRevenue(String(day.revenueKr))
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
        revenueKr: Number(revenue),
      })
      const { dayId, hoursWorked, dayRevenueKr, participants } = res.data
      setDayInfo({ dayId, hoursWorked, revenueKr: dayRevenueKr, participants })
      setFormStep('alone_or_more')
      setShowRegModal(false)
      setSubmitState({ loading: false, error: '' })
    } catch (err) {
      const msg = err?.message || 'Noe gikk galt. Prøv igjen.'
      if (msg.includes('økt') || msg.includes('Logg inn')) { clearSession(); setSession(null) }
      setSubmitState({ loading: false, error: msg })
    }
  }

  async function onDeleteShift(shiftId) {
    if (!window.confirm('Slette denne vakten?')) return
    setDeleteState(p => ({ ...p, [shiftId]: { loading: true } }))
    try {
      await httpsCallable(functions, 'deleteBonusShift')({ shiftId, sessionToken: session.token })
      setDeleteState(p => ({ ...p, [shiftId]: { done: true } }))
      await loadHistory()
    } catch (err) {
      setDeleteState(p => ({ ...p, [shiftId]: { error: err?.message || 'Noe gikk galt' } }))
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
    setNumWorkers('')
    setShiftDate(today)
    setOpenDay(null)
    checkOpenDay(today)
    loadHistory()
  }

  function startNewDay() {
    setFormStep('form')
    setDayInfo(null)
    setStartTime('')
    setEndTime('')
    setRevenue('')
    setNumWorkers('')
    setShiftDate(today)
    setOpenDay(null)
    checkOpenDay(today)
  }

  const previewHours = startTime && endTime ? calcHours(startTime, endTime) : null
  const isJoiningOpenDay = openDay && !openDay.hasJoined && shiftDate === today
  const previewRevenue = isJoiningOpenDay ? openDay.revenueKr : (revenue ? Number(revenue) : null)
  const previewBase = previewHours ? Math.round(previewHours * BONUS_HOURLY_RATE) : 0
  const effectiveNumWorkers = isJoiningOpenDay
    ? (openDay.participants.length + 1)
    : (numWorkers ? Number(numWorkers) : null)
  const previewPoolPerPerson = (previewHours && previewRevenue && effectiveNumWorkers)
    ? Math.max(0, bonusPool(previewRevenue, previewHours * effectiveNumWorkers) / effectiveNumWorkers)
    : null

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

  const isSimulation = !!session?.isSimulation

  return (
    <>
      {isSimulation && (
        <div className="bonus-sim-banner">
          <span>Simulerer <strong>{session.name}</strong></span>
          <a href="/bonus/admin" className="bonus-sim-back" onClick={() => sessionStorage.removeItem('bonusSimSession')}>← Tilbake til admin</a>
        </div>
      )}
      <div className="bonus-page">
      <div className="bonus-card">
        <div className="bonus-header">
          <div className="bonus-header-row">
            <div>
              <div className="bonus-logo">Crust n&apos; Trust</div>
              <h1 className="bonus-title">Hei, {session.name}!</h1>
            </div>
            {!isSimulation && (
            <button type="button" className="bonus-logout" onClick={() => { clearSession(); setSession(null) }}>
              Logg ut
            </button>
            )}
          </div>
        </div>

        {formStep === 'form' && (
          <>
            <button
              type="button"
              className="bonus-btn bonus-btn--register"
              onClick={() => setShowRegModal(true)}
            >
              + Registrer vakt
            </button>
          </>
        )}

        {showRegModal && (
          <div className="bonus-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowRegModal(false) }}>
            <div className="bonus-modal">
              <div className="bonus-modal-header">
                <span className="bonus-modal-title">Registrer vakt</span>
                <button type="button" className="bonus-modal-close" onClick={() => setShowRegModal(false)}>×</button>
              </div>

            {openDayLoading && <p className="bonus-hint">Sjekker åpne registreringer…</p>}

            {isJoiningOpenDay && (
              <div className="bonus-open-day-banner">
                <div className="bonus-open-day-title">Åpen registrering for i dag</div>
                <div className="bonus-open-day-participants">
                  {openDay.participants.map(p => p.name).join(', ')} har allerede registrert seg.
                </div>
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
                    onChange={(e) => { setShiftDate(e.target.value); setOpenDay(null); if (e.target.value) checkOpenDay(e.target.value) }}
                    required
                    min={BONUS_START_DATE}
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
              <p className="bonus-time-hint">Kopier innstempling og utstemplingstid i Planday</p>
              {previewHours != null && (
                <p className="bonus-hours-preview">Arbeidet tid: {fmtHours(previewHours)}</p>
              )}
              {!isJoiningOpenDay && (
                <div className="bonus-field">
                  <label className="bonus-label">Hvor mange jobbet i dag?
                    <span className="bonus-label-hint">Gjelder ikke ekstrahelp-vakter</span>
                  </label>
                  <input
                    className="bonus-input"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Antall personer"
                    value={numWorkers}
                    onChange={(e) => setNumWorkers(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="bonus-field">
                <label className="bonus-label">Omsetning for dagen (kr)
                  {isJoiningOpenDay && <span className="bonus-label-hint">Satt av første person — oppdater hvis feil</span>}
                </label>
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

              {previewHours && previewRevenue && effectiveNumWorkers ? (
                <div className="bonus-preview">
                  <p className="bonus-preview-title">Estimert utbetaling for deg</p>
                  <div className="bonus-preview-row">
                    <span>Timelønn ({fmtHours(previewHours)})</span>
                    <span>{fmtKr(previewBase)} kr</span>
                  </div>
                  {previewPoolPerPerson != null && (
                    <div className="bonus-preview-row bonus-preview-row--bonus">
                      <span>Bonusestimering ({effectiveNumWorkers} pers., lik arbeidstid)</span>
                      <span>+ {fmtKr(previewPoolPerPerson)} kr</span>
                    </div>
                  )}
                  <div className="bonus-preview-row bonus-preview-row--total">
                    <span>Ca. totalsum</span>
                    <span>{fmtKr(previewBase + (previewPoolPerPerson || 0))} kr</span>
                  </div>
                  <p className="bonus-preview-note">Nøyaktig bonus beregnes etter at alle har registrert tidene sine.</p>
                </div>
              ) : null}

              {submitState.error && <p className="bonus-error">{submitState.error}</p>}
              <button className="bonus-btn" type="submit" disabled={submitState.loading}>
                {submitState.loading ? 'Registrerer…' : isJoiningOpenDay ? 'Bli med og registrer vakt' : 'Registrer vakt'}
              </button>
            </form>
            </div>
          </div>
        )}

        {formStep === 'alone_or_more' && dayInfo && (
          <div className="bonus-step-card">
            <div className="bonus-step-icon">✓</div>
            <h2 className="bonus-step-title">Vakt registrert!</h2>
            <p className="bonus-step-body">
              Du har registrert <strong>{fmtHours(dayInfo.hoursWorked)}</strong> for {fmtDate(shiftDate || today)}.
            </p>
            <p className="bonus-step-question">Jobbet det andre {shiftDate === today ? 'i dag' : 'denne dagen'}?</p>
            <div className="bonus-step-actions">
              <button className="bonus-btn" onClick={() => setFormStep('waiting')}>
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
            <button type="button" className="bonus-btn-ghost bonus-btn-ghost--center" onClick={startNewDay}>
              + Registrer en annen dag
            </button>
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
            <button type="button" className="bonus-btn-ghost bonus-btn-ghost--center" onClick={startNewDay}>
              + Registrer en annen dag
            </button>
          </div>
        )}

        {formStep === 'done' && (
          <div className="bonus-step-card">
            <div className="bonus-step-icon">📨</div>
            <h2 className="bonus-step-title">Sendt for godkjenning!</h2>
            <p className="bonus-step-body">Admin vil godkjenne vakten og sende bonusinformasjon på e-post.</p>
            <div className="bonus-step-actions">
              <button className="bonus-btn" onClick={resetForm}>Registrer ny dag</button>
            </div>
          </div>
        )}

        {/* Bonus calculator */}
        {session && (() => {
          const hrRate = bonusConfig.fallbackHourlyRate
          const myH = Number(calcMyHours) || 0
          const nEmp = Math.max(1, Number(calcNumEmp) || 1)
          const totH = myH * nEmp
          const thresh = totH * hrRate
          const rev = Number(calcRevenue) || 0
          const pct = tieredPoolRate(rev, bonusConfig.poolBaseRevenue, bonusConfig.poolBaseRatePct, bonusConfig.poolStepKr, bonusConfig.poolStepEnabled ? bonusConfig.poolStepRatePct : 0)
          const pool = Math.max(0, (rev - thresh) * pct / 100)
          const myBonus = totH > 0 ? pool * (myH / totH) : 0
          const myBase = myH * hrRate
          const myTotal = myBase + myBonus
          const hasInput = myH > 0 && rev > 0
          return (
            <div className="bonus-calc-section">
              <button className="bonus-calc-toggle" type="button" onClick={() => setShowCalc(v => !v)}>
                {showCalc ? '▲' : '▼'} Bonuskalkulator
              </button>
              {showCalc && (
                <div className="bonus-calc-body">
                  <div className="bonus-calc-inputs">
                    <div className="bonus-calc-field">
                      <label className="bonus-calc-label">Forventet omsetning</label>
                      <div className="bonus-calc-input-wrap">
                        <input
                          type="number" min="0" step="500" placeholder="f.eks. 35000"
                          className="bonus-calc-input"
                          value={calcRevenue} onChange={e => setCalcRevenue(e.target.value)}
                        />
                        <span className="bonus-calc-unit">kr</span>
                      </div>
                    </div>
                    <div className="bonus-calc-field">
                      <label className="bonus-calc-label">Dine timer</label>
                      <div className="bonus-calc-input-wrap">
                        <input
                          type="number" min="0" max="24" step="0.5" placeholder="f.eks. 6"
                          className="bonus-calc-input bonus-calc-input--sm"
                          value={calcMyHours} onChange={e => setCalcMyHours(e.target.value)}
                        />
                        <span className="bonus-calc-unit">t</span>
                      </div>
                    </div>
                    <div className="bonus-calc-field">
                      <label className="bonus-calc-label">Antall ansatte totalt</label>
                      <div className="bonus-calc-input-wrap">
                        <input
                          type="number" min="1" max="10" step="1" placeholder="f.eks. 2"
                          className="bonus-calc-input bonus-calc-input--sm"
                          value={calcNumEmp} onChange={e => setCalcNumEmp(e.target.value)}
                        />
                        <span className="bonus-calc-unit">stk</span>
                      </div>
                    </div>
                  </div>

                  {hasInput && (
                    <>
                      <div className="bonus-calc-result">
                        <div className="bonus-calc-row">
                          <span className="bonus-calc-row-label">Terskel (lønnskostnad)</span>
                          <span className="bonus-calc-row-val">{fmtKr(Math.round(thresh))} kr</span>
                        </div>
                        <div className="bonus-calc-row">
                          <span className="bonus-calc-row-label">Bonuspott <span style={{ color: '#aaa', fontWeight: 400 }}>{pct > 0 ? `(${pct}%)` : ''}</span></span>
                          <span className={`bonus-calc-row-val ${pool > 0 ? 'bonus-calc-row-val--green' : 'bonus-calc-row-val--dim'}`}>
                            {pool > 0 ? `${fmtKr(Math.round(pool))} kr` : 'Ingen bonus'}
                          </span>
                        </div>
                        <div className="bonus-calc-row bonus-calc-row--sep">
                          <span className="bonus-calc-row-label">Din timelønn</span>
                          <span className="bonus-calc-row-val">{fmtKr(Math.round(myBase))} kr</span>
                        </div>
                        {pool > 0 && (
                          <div className="bonus-calc-row">
                            <span className="bonus-calc-row-label">Din bonusandel</span>
                            <span className="bonus-calc-row-val bonus-calc-row-val--purple">+ {fmtKr(Math.round(myBonus))} kr</span>
                          </div>
                        )}
                        <div className="bonus-calc-row bonus-calc-row--total">
                          <span className="bonus-calc-row-label">Totalt</span>
                          <span className="bonus-calc-row-val">{fmtKr(Math.round(myTotal))} kr</span>
                        </div>
                      </div>

                      <BonusCalcChart
                        thresholdKr={thresh}
                        poolConfig={bonusConfig}
                        myHours={myH}
                        totalHours={totH}
                        hourlyRate={hrRate}
                      />
                      <p className="bonus-calc-hint">Hold pekeren over grafen for å se inntjening ved ulik omsetning.</p>
                    </>
                  )}

                  {!hasInput && (
                    <p className="bonus-calc-empty">Fyll inn omsetning og dine timer for å se estimert bonus.</p>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Formula explainer */}
        <div className="bonus-formula-section">
          <button
            className="bonus-formula-toggle"
            type="button"
            onClick={() => setShowFormula(v => !v)}
          >
            {showFormula ? '▲' : '▼'} Slik beregnes bonusen
          </button>
          {showFormula && (() => {
            const hr = bonusConfig.fallbackHourlyRate
            const baseRev = bonusConfig.poolBaseRevenue
            const baseRate = bonusConfig.poolBaseRatePct
            const stepEnabled = bonusConfig.poolStepEnabled !== false
            const stepKr = bonusConfig.poolStepKr
            const stepRate = stepEnabled ? bonusConfig.poolStepRatePct : 0

            // Example: 2 employees × 6h each
            const exH1 = 6, exH2 = 6, exTot = 12
            const exRev = 30000
            const exThresh = Math.round(exTot * hr)
            const exRate = tieredPoolRate(exRev, baseRev, baseRate, stepKr, stepRate)
            const exSurplus = exRev - exThresh
            const exPool = exSurplus > 0 ? Math.round(exSurplus * exRate / 100) : 0
            const exShare1 = Math.round(exPool * exH1 / exTot)
            const exShare2 = Math.round(exPool * exH2 / exTot)

            return (
              <div className="bonus-formula-body">
                <p className="bonus-formula-intro">
                  Bonusen er basert på <strong>omsetning per ansattime (OPA)</strong> — jo høyere omsetning per time dere jobbet, desto større bonus.
                </p>
                <div className="bonus-formula-steps">
                  <div className="bonus-formula-step">
                    <span className="bonus-formula-step-num">1</span>
                    <div>
                      <strong>Terskel</strong> = sum av timelønn × timer for alle ansatte<br/>
                      <em>Timelønn er {fmtKr(hr)} kr/t (kan variere per ansatt). Terskel = total lønnskostnad.</em>
                    </div>
                  </div>
                  <div className="bonus-formula-step">
                    <span className="bonus-formula-step-num">2</span>
                    <div>
                      <strong>Overskudd</strong> = omsetning − terskel<br/>
                      <em>Alt over lønnskostnaden er bonusgrunnlag.</em>
                    </div>
                  </div>
                  <div className="bonus-formula-step">
                    <span className="bonus-formula-step-num">3</span>
                    <div>
                      <strong>Bonuspott</strong> = overskudd × sats<br/>
                      <em>
                        {stepEnabled
                          ? `Satsen øker med omsetningen: ${baseRate}% fra ${fmtKr(baseRev / 1000)}k kr, +${bonusConfig.poolStepRatePct}% for hver ${fmtKr(stepKr / 1000)}k kr over det.`
                          : `Fast sats: ${baseRate}% av overskuddet.`}
                      </em>
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
                  <p className="bonus-formula-example-title">Eksempel — {fmtKr(exRev)} kr omsetning</p>
                  <div className="bonus-formula-example-row"><span>2 ansatte: {exH1}t + {exH2}t = {exTot}t totalt</span></div>
                  <div className="bonus-formula-example-row"><span>Terskel: {exTot}t × {fmtKr(hr)} kr/t = {fmtKr(exThresh)} kr</span></div>
                  <div className="bonus-formula-example-row"><span>Overskudd: {fmtKr(exRev)} − {fmtKr(exThresh)} = {fmtKr(exSurplus)} kr</span></div>
                  <div className="bonus-formula-example-row"><span>Sats ved {fmtKr(exRev / 1000)}k kr: {exRate}%</span></div>
                  <div className="bonus-formula-example-row"><span>Bonuspott: {fmtKr(exSurplus)} × {exRate}% = {fmtKr(exPool)} kr</span></div>
                  <div className="bonus-formula-example-row bonus-formula-example-row--result"><span>Ansatt 1 ({exH1}t): {fmtKr(exShare1)} kr bonus</span></div>
                  <div className="bonus-formula-example-row bonus-formula-example-row--result"><span>Ansatt 2 ({exH2}t): {fmtKr(exShare2)} kr bonus</span></div>
                </div>
              </div>
            )
          })()}
        </div>

        <hr className="bonus-section-divider" />

        {/* Monthly salary overview */}
        {session && history.length > 0 && (() => {
          const now = new Date()
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
          const monthShifts = history.filter(s => s.date && s.date.startsWith(currentMonth))
          const approvedThisMonth = monthShifts.filter(s => (s.dayStatus || s.status) === 'approved')
          const pendingThisMonth = monthShifts.filter(s => ['open', 'pending_approval'].includes(s.dayStatus || s.status))
          if (monthShifts.length === 0) return null

          const totalBase = approvedThisMonth.reduce((s, sh) => s + (sh.basePayKr || 0), 0)
          const totalBonus = approvedThisMonth.reduce((s, sh) => s + (sh.bonusKr || 0), 0)
          const totalFeriepenger = Math.round((totalBase + totalBonus) * 0.102)
          const totalHoursApproved = approvedThisMonth.reduce((s, sh) => s + (sh.hoursWorked || 0), 0)
          const totalHoursPending = pendingThisMonth.reduce((s, sh) => s + (sh.hoursWorked || 0), 0)
          const monthName = now.toLocaleString('nb-NO', { month: 'long' })
          const isStartMonth = currentMonth === BONUS_START_DATE.slice(0, 7)

          return (
            <div className="bonus-month-overview">
              <h2 className="bonus-month-title">Lønn {monthName}{isStartMonth && <span className="bonus-month-note"> (fra 25. juni)</span>}</h2>
              {approvedThisMonth.length > 0 && (
                <div className="bonus-month-rows">
                  <div className="bonus-month-row">
                    <span>Timelønn</span>
                    <span>{fmtKr(Math.round(totalBase))} kr</span>
                  </div>
                  <div className="bonus-month-row">
                    <span>Bonus</span>
                    <span className={totalBonus > 0 ? 'bonus-month-bonus' : 'bonus-month-zero'}>
                      {totalBonus > 0 ? `+ ${fmtKr(Math.round(totalBonus))} kr` : '0 kr'}
                    </span>
                  </div>
                  <div className="bonus-month-row">
                    <span>Feriepenger <span className="bonus-month-note">(10.2%)</span></span>
                    <span className="bonus-month-ferie">+ {fmtKr(totalFeriepenger)} kr</span>
                  </div>
                  <div className="bonus-month-row bonus-month-row--total">
                    <span>Totalt ({fmtHours(totalHoursApproved)})</span>
                    <span>{fmtKr(Math.round(totalBase + totalBonus + totalFeriepenger))} kr</span>
                  </div>
                </div>
              )}
              {pendingThisMonth.length > 0 && (
                <p className="bonus-month-pending">
                  + {pendingThisMonth.length} vakt{pendingThisMonth.length !== 1 ? 'er' : ''} venter godkjenning ({fmtHours(totalHoursPending)})
                </p>
              )}
              {approvedThisMonth.length === 0 && pendingThisMonth.length === 0 && (
                <p className="bonus-month-empty">Ingen godkjente vakter ennå denne måneden.</p>
              )}
            </div>
          )
        })()}

        {/* History — always visible once logged in */}
        {(history.length > 0 || historyLoading) && (
          <div className="bonus-history">
            <div className="bonus-history-header">
              <h2 className="bonus-history-title">Dine dager</h2>
              {formStep !== 'form' && (
                <button type="button" className="bonus-history-new-btn" onClick={startNewDay}>
                  + Ny dag
                </button>
              )}
            </div>

            {/* Status summary */}
            {history.length > 0 && (() => {
              const openCount = history.filter(s => (s.dayStatus || s.status) === 'open').length
              const pendingCount = history.filter(s => (s.dayStatus || s.status) === 'pending_approval').length
              const approvedCount = history.filter(s => (s.dayStatus || s.status) === 'approved').length
              const rejectedCount = history.filter(s => (s.dayStatus || s.status) === 'rejected').length
              return (
                <div className="bonus-history-summary">
                  {openCount > 0 && <span className="bonus-summary-chip bonus-summary-chip--open">{openCount} åpen</span>}
                  {pendingCount > 0 && <span className="bonus-summary-chip bonus-summary-chip--pending">{pendingCount} venter godkjenning</span>}
                  {approvedCount > 0 && <span className="bonus-summary-chip bonus-summary-chip--approved">{approvedCount} godkjent</span>}
                  {rejectedCount > 0 && <span className="bonus-summary-chip bonus-summary-chip--rejected">{rejectedCount} avslått</span>}
                </div>
              )
            })()}

            {historyLoading && <p className="bonus-hint" style={{ margin: '0 0 8px' }}>Laster…</p>}
            {approvalState.error && <p className="bonus-error">{approvalState.error}</p>}

            {history.map((shift) => {
              const status = shift.dayStatus || shift.status
              return (
                <div key={shift.id} className={`bonus-history-item bonus-history-item--${status}`}>
                  <div className="bonus-history-top">
                    <span className="bonus-history-date">{fmtDate(shift.date)}</span>
                    <span className={`bonus-status-badge bonus-status-badge--${status}`}>
                      {status === 'open' ? 'Åpen' : status === 'pending_approval' ? 'Venter godkjenning' : status === 'rejected' ? 'Avslått' : 'Godkjent'}
                    </span>
                  </div>
                  <div className="bonus-history-detail">
                    {shift.startTime}–{shift.endTime} · {fmtHours(shift.hoursWorked)}
                  </div>
                  {status === 'open' && (
                    <div className="bonus-history-open-actions">
                      <button
                        className="bonus-btn-small bonus-btn-small--send"
                        onClick={() => onSendForApprovalFromHistory(shift.dayId)}
                        disabled={approvalState.loading}
                      >
                        {approvalState.loading ? 'Sender…' : 'Alle har lagt inn — send for godkjenning'}
                      </button>
                      <button
                        className="bonus-btn-small bonus-btn-small--delete"
                        onClick={() => onDeleteShift(shift.id)}
                        disabled={deleteState[shift.id]?.loading}
                      >
                        {deleteState[shift.id]?.loading ? 'Sletter…' : deleteState[shift.id]?.error ? '⚠ Feil' : 'Slett vakt'}
                      </button>
                    </div>
                  )}
                  {status === 'approved' && shift.bonusKr != null && (() => {
                    const base = shift.basePayKr || 0
                    const bonus = shift.bonusKr || 0
                    const ferie = Math.round((base + bonus) * 0.102)
                    return (
                      <div className="bonus-history-payout">
                        <div>Timelønn: {fmtKr(base)} kr + Bonus: {fmtKr(bonus)} kr + Feriepenger: {fmtKr(ferie)} kr = <strong>{fmtKr(base + bonus + ferie)} kr</strong></div>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
