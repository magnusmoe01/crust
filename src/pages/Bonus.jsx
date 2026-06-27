import { useRef, useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { getDoc, doc } from 'firebase/firestore'
import { db, functions } from '../firebase'
import './Bonus.css'

const BONUS_HOURLY_RATE = 166.34
const BONUS_THRESHOLD_RATE = 400
const BONUS_RATE = 0.15
const BONUS_START_DATE = '2026-06-20'
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

  // History
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Month navigation
  const today = new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)
  const [viewMonth, setViewMonth] = useState(currentMonth)

  // Formula explainer toggle
  const [showFormula, setShowFormula] = useState(false)

  // Bonus calculator
  const [bonusConfig, setBonusConfig] = useState({
    poolBaseRevenue: 20000, poolBaseRatePct: 20, poolStepEnabled: true, poolStepKr: 10000, poolStepRatePct: 5,
    fallbackHourlyRate: BONUS_HOURLY_RATE,
  })
  const [showCalc, setShowCalc] = useState(false)
  const [calcRevenue, setCalcRevenue] = useState('')
  const [calcMyHours, setCalcMyHours] = useState('')
  const [calcTotalHours, setCalcTotalHours] = useState('')

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
    if (session) loadHistory()
  }, [session])

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

  function shiftViewMonth(dir) {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + dir, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

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


        {/* Bonus calculator */}
        {session && (() => {
          const hrRate = bonusConfig.fallbackHourlyRate
          const myH = Number(calcMyHours) || 0
          const totH = Math.max(myH, Number(calcTotalHours) || 0)
          const thresh = totH * hrRate
          const rev = Number(calcRevenue) || 0
          const pct = tieredPoolRate(rev, bonusConfig.poolBaseRevenue, bonusConfig.poolBaseRatePct, bonusConfig.poolStepKr, bonusConfig.poolStepEnabled ? bonusConfig.poolStepRatePct : 0)
          const pool = Math.max(0, (rev - thresh) * pct / 100)
          const myBonus = totH > 0 ? pool * (myH / totH) : 0
          const myBase = myH * hrRate
          const myTotal = myBase + myBonus
          const hasInput = myH > 0 && rev > 0 && totH > 0
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
                      <label className="bonus-calc-label">Totale arbeidstimer (Jafar, Akram, Abedin)</label>
                      <div className="bonus-calc-input-wrap">
                        <input
                          type="number" min="0" max="200" step="0.5" placeholder="f.eks. 18"
                          className="bonus-calc-input bonus-calc-input--sm"
                          value={calcTotalHours} onChange={e => setCalcTotalHours(e.target.value)}
                        />
                        <span className="bonus-calc-unit">t</span>
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
                    <p className="bonus-calc-empty">Fyll inn omsetning, dine timer og totale timer for å se estimert bonus.</p>
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
        {session && (() => {
          const monthShifts = history.filter(s => s.date && s.date.startsWith(viewMonth))
          const approvedThisMonth = monthShifts.filter(s => (s.dayStatus || s.status) === 'approved')
          const pendingThisMonth = monthShifts.filter(s => ['open', 'pending_approval'].includes(s.dayStatus || s.status))

          const totalBase = approvedThisMonth.reduce((s, sh) => s + (sh.basePayKr || 0), 0)
          const totalBonus = approvedThisMonth.reduce((s, sh) => s + (sh.bonusKr || 0), 0)
          const totalFeriepenger = Math.round((totalBase + totalBonus) * 0.102)
          const totalHoursApproved = approvedThisMonth.reduce((s, sh) => s + (sh.hoursWorked || 0), 0)
          const totalHoursPending = pendingThisMonth.reduce((s, sh) => s + (sh.hoursWorked || 0), 0)
          const [vmY, vmM] = viewMonth.split('-').map(Number)
          const monthName = new Date(vmY, vmM - 1, 1).toLocaleString('nb-NO', { month: 'long' })
          const isStartMonth = viewMonth === BONUS_START_DATE.slice(0, 7)
          const canGoPrev = viewMonth > BONUS_START_DATE.slice(0, 7)
          const canGoNext = viewMonth < currentMonth

          return (
            <div className="bonus-month-overview">
              <div className="bonus-month-nav">
                <button type="button" className="bonus-month-nav-btn" onClick={() => shiftViewMonth(-1)} disabled={!canGoPrev}>‹</button>
                <h2 className="bonus-month-title">Lønn {monthName}{isStartMonth && <span className="bonus-month-note"> (fra {Number(BONUS_START_DATE.slice(8))}. {monthName})</span>}</h2>
                <button type="button" className="bonus-month-nav-btn" onClick={() => shiftViewMonth(1)} disabled={!canGoNext}>›</button>
              </div>
              {approvedThisMonth.length > 0 && (
                <div className="bonus-month-rows">
                  <div className="bonus-month-row">
                    <span>Timelønn</span>
                    <span>{fmtKr(Math.round(totalBase))} kr</span>
                  </div>
                  <div className="bonus-month-row">
                    <span>Bonus</span>
                    <span className={totalBonus > 0 ? 'bonus-month-bonus bonus-month-bonus--highlight' : 'bonus-month-zero'}>
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
                <p className="bonus-month-empty">Ingen registrerte vakter denne måneden.</p>
              )}
            </div>
          )
        })()}

        {/* History — filtered by viewMonth */}
        {(history.length > 0 || historyLoading) && (() => {
          const viewShifts = history.filter(s => s.date && s.date.startsWith(viewMonth))
          return (
            <div className="bonus-history">
              <div className="bonus-history-header">
                <h2 className="bonus-history-title">Dine dager</h2>
              </div>

              {historyLoading && <p className="bonus-hint" style={{ margin: '0 0 8px' }}>Laster…</p>}

              {viewShifts.length === 0 && !historyLoading && (
                <p className="bonus-month-empty" style={{ margin: '0 0 8px' }}>Ingen vakter denne måneden.</p>
              )}

              {viewShifts.map((shift) => {
                const status = shift.dayStatus || shift.status
                return (
                  <div key={shift.id} className={`bonus-history-item bonus-history-item--${status}`}>
                    <div className="bonus-history-top">
                      <span className="bonus-history-date">{fmtDate(shift.date)}</span>
                      <span className={`bonus-status-badge bonus-status-badge--${status}`}>
                        {status === 'open' ? 'Åpen' : status === 'pending_approval' ? 'Venter godkjenning' : status === 'rejected' ? 'Avslått' : 'Godkjent'}
                      </span>
                    </div>
                    {(() => {
                      const revenue = status === 'approved'
                        ? (shift.dayApprovedRevenue || shift.dayRevenueKr)
                        : shift.dayRevenueKr
                      const bonusRatePct = status === 'approved'
                        ? shift.dayApprovedBonusRatePct
                        : (revenue ? tieredPoolRate(revenue, bonusConfig.poolBaseRevenue, bonusConfig.poolBaseRatePct, bonusConfig.poolStepKr, bonusConfig.poolStepEnabled ? bonusConfig.poolStepRatePct : 0) : null)
                      return revenue ? (
                        <div className="bonus-history-meta">
                          <span>Omsetning: {fmtKr(revenue)} kr</span>
                          {bonusRatePct != null && <span>· Bonuspott: {bonusRatePct}%</span>}
                        </div>
                      ) : null
                    })()}
                    {status === 'approved' && shift.bonusKr != null && (() => {
                      const base = shift.basePayKr || 0
                      const bonus = shift.bonusKr || 0
                      const ferie = Math.round((base + bonus) * 0.102)
                      const feriePre = ferie
                      const effRate = shift.hoursWorked ? Math.round((base + bonus + feriePre) / shift.hoursWorked) : null
                      const total = base + bonus + ferie
                      const totalPoolHours = shift.totalPoolHours || 0
                      const myShare = (totalPoolHours > 0 && shift.hoursWorked)
                        ? Math.round((shift.hoursWorked / totalPoolHours) * 100)
                        : null
                      return (
                        <>
                          <div className="bonus-history-detail">
                            Din vakt: {shift.startTime}–{shift.endTime} · {fmtHours(shift.hoursWorked)}{effRate != null && <span style={{ color: '#6b7280' }}> ({fmtKr(effRate)} kr/t)</span>}
                          </div>
                          {myShare != null && (
                            <div className="bonus-history-share">{fmtHours(shift.hoursWorked)} / {fmtHours(totalPoolHours)} = {myShare}% av bonuspott</div>
                          )}
                          <div className="bonus-history-payout" style={{ marginTop: 8 }}>
                            <div>Timelønn: {fmtKr(base)} kr + <span style={{ color: '#7c3aed', fontWeight: 700 }}>Bonus: {fmtKr(bonus)} kr</span> + Feriepenger: {fmtKr(ferie)} kr = <strong>{fmtKr(total)} kr</strong></div>
                          </div>
                        </>
                      )
                    })()}
                    {status !== 'approved' && (
                      <div className="bonus-history-detail">
                        Din vakt: {shift.startTime}–{shift.endTime} · {fmtHours(shift.hoursWorked)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </div>
    </>
  )
}
