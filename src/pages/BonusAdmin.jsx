import { useRef, useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import './Bonus.css'

const DEFAULT_POOL_RATE = 15      // %
const DEFAULT_HOURLY_RATE = 166.34 // kr/h

/* ─── Chart ──────────────────────────────────────────────────────────────── */

function BonusChart({ thresholdKr, poolConfig, numEmployees = 1, basePay = 0, maxRevenue = 100000 }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const W = 560, H = 240
  const PAD = { t: 24, r: 16, b: 56, l: 68 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b

  const n = Math.max(1, numEmployees)
  const poolAt = (rev) => {
    const rate = tieredPoolRate(rev, poolConfig.baseRevenue, poolConfig.baseRatePct, poolConfig.stepKr, poolConfig.stepRatePct)
    return Math.max(0, (rev - thresholdKr) * rate / 100)
  }
  const perEmpAt = (rev) => basePay + poolAt(rev) / n

  const yMax = Math.max(poolAt(maxRevenue), perEmpAt(maxRevenue)) * 1.15 || 500
  const x = (rev) => (rev / maxRevenue) * iW
  const y = (val) => iH - (val / yMax) * iH

  const nPts = 120
  const pts = Array.from({ length: nPts + 1 }, (_, i) => {
    const rev = (i / nPts) * maxRevenue
    return { rev, pool: poolAt(rev), perEmp: perEmpAt(rev) }
  })

  const poolPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.rev).toFixed(1)} ${y(p.pool).toFixed(1)}`).join(' ')
  const perEmpPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.rev).toFixed(1)} ${y(p.perEmp).toFixed(1)}`).join(' ')

  const threshIdx = pts.findIndex(p => p.rev >= thresholdKr)
  const areaPts = pts.slice(Math.max(0, threshIdx - 1))
  const poolAreaPath = areaPts.length > 1
    ? `M ${x(areaPts[0].rev).toFixed(1)} ${iH} ` + areaPts.map(p => `L ${x(p.rev).toFixed(1)} ${y(p.pool).toFixed(1)}`).join(' ') + ` L ${iW} ${iH} Z`
    : ''

  const xTicks = [0, 20000, 40000, 60000, 80000, 100000].filter(v => v <= maxRevenue)
  const yTicks = Array.from({ length: 6 }, (_, i) => (yMax * i) / 5)

  function handleMouseMove(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const rawX = ((e.clientX - rect.left) / rect.width) * W - PAD.l
    if (rawX < 0 || rawX > iW) { setHover(null); return }
    const rev = Math.round((rawX / iW) * maxRevenue / 500) * 500
    setHover({ rev, pool: poolAt(rev), perEmp: perEmpAt(rev), px: x(rev) })
  }

  const fmt = (n) => Number(n).toLocaleString('nb-NO', { maximumFractionDigits: 0 })
  const fmtAxis = (n) => n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n))
  const threshPx = x(Math.min(thresholdKr, maxRevenue))

  // Legend items
  const legendY = iH + 40

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: W, display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <g transform={`translate(${PAD.l},${PAD.t})`}>
        {/* Grid */}
        {yTicks.map((v, i) => <line key={i} x1={0} y1={y(v)} x2={iW} y2={y(v)} stroke="#f3f4f6" />)}
        {xTicks.map(v => <line key={v} x1={x(v)} y1={0} x2={x(v)} y2={iH} stroke="#f3f4f6" />)}

        {/* Pool area fill */}
        {poolAreaPath && <path d={poolAreaPath} fill="url(#bonusGrad)" opacity={0.6} />}

        {/* Per-employee base pay: dashed horizontal reference */}
        {basePay > 0 && basePay < yMax && (
          <line x1={0} y1={y(basePay)} x2={iW} y2={y(basePay)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" />
        )}

        {/* Threshold vertical line */}
        {thresholdKr > 0 && thresholdKr < maxRevenue && (
          <>
            <line x1={threshPx} y1={0} x2={threshPx} y2={iH} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" />
            <text x={threshPx + 4} y={10} fontSize={9} fill="#d97706" fontWeight="600">Threshold</text>
            <text x={threshPx + 4} y={20} fontSize={8} fill="#d97706">{fmt(thresholdKr)} kr</text>
          </>
        )}

        {/* Pool line */}
        <path d={poolPath} fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Per-employee total line */}
        <path d={perEmpPath} fill="none" stroke="#7c3aed" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover crosshair */}
        {hover && (
          <>
            <line x1={hover.px} y1={0} x2={hover.px} y2={iH} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 2" />
            <circle cx={hover.px} cy={y(hover.pool)} r={4} fill="#16a34a" stroke="#fff" strokeWidth={1.5} />
            <circle cx={hover.px} cy={y(hover.perEmp)} r={4} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} />
            {(() => {
              const tx = hover.px > iW * 0.65 ? hover.px - 128 : hover.px + 8
              const ty = 4
              return (
                <g>
                  <rect x={tx} y={ty} width={120} height={52} rx={5} fill="#1a3a2a" opacity={0.93} />
                  <text x={tx + 8} y={ty + 13} fontSize={8.5} fill="#a8d5b5">{fmt(hover.rev)} kr revenue</text>
                  <text x={tx + 8} y={ty + 26} fontSize={9} fill="#fff">
                    <tspan fill="#6ee7b7">●</tspan>
                    <tspan> Pool: {fmt(hover.pool)} kr</tspan>
                  </text>
                  <text x={tx + 8} y={ty + 40} fontSize={9} fill="#fff">
                    <tspan fill="#c4b5fd">●</tspan>
                    <tspan> Per employee: {fmt(hover.perEmp)} kr</tspan>
                  </text>
                </g>
              )
            })()}
          </>
        )}

        {/* Axes */}
        <line x1={0} y1={iH} x2={iW} y2={iH} stroke="#d1d5db" />
        <line x1={0} y1={0} x2={0} y2={iH} stroke="#d1d5db" />

        {xTicks.map(v => (
          <g key={v}>
            <line x1={x(v)} y1={iH} x2={x(v)} y2={iH + 4} stroke="#9ca3af" />
            <text x={x(v)} y={iH + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{v === 0 ? '0' : `${v / 1000}k`}</text>
          </g>
        ))}
        {yTicks.filter((_, i) => i > 0).map(v => (
          <g key={v}>
            <line x1={-4} y1={y(v)} x2={0} y2={y(v)} stroke="#9ca3af" />
            <text x={-8} y={y(v) + 3.5} textAnchor="end" fontSize={9} fill="#9ca3af">{fmtAxis(v)}</text>
          </g>
        ))}
        <text x={iW / 2} y={iH + 28} textAnchor="middle" fontSize={10} fill="#6b7280">Revenue (kr)</text>

        {/* Legend */}
        <g transform={`translate(0, ${legendY})`}>
          <rect x={0} y={-5} width={10} height={3} rx={1} fill="#16a34a" />
          <text x={14} y={0} fontSize={9} fill="#555">Total bonus pool</text>
          <rect x={110} y={-5} width={10} height={3} rx={1} fill="#7c3aed" />
          <text x={124} y={0} fontSize={9} fill="#555">Per employee (base + bonus)</text>
          <line x1={270} y1={-3} x2={280} y2={-3} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 2" />
          <text x={284} y={0} fontSize={9} fill="#555">Base wage only</text>
        </g>
      </g>

      <defs>
        <linearGradient id="bonusGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#16a34a" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#16a34a" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function calcPreview(shiftsWithHours, revenue, thresholdKr, bonusRatePct, rateMap, nonBonusHours = 0) {
  const bonusOnlyHours = shiftsWithHours.reduce((s, sh) => s + (Number(sh.hoursWorked) || 0), 0)
  const totalHours = bonusOnlyHours + nonBonusHours
  const surplus = Number(revenue) - Number(thresholdKr)
  const pool = surplus > 0 ? surplus * bonusRatePct / 100 : 0
  if (totalHours <= 0) return shiftsWithHours.map(() => ({ basePay: 0, bonus: 0, total: 0 }))
  return shiftsWithHours.map((sh) => {
    const h = Number(sh.hoursWorked) || 0
    const rate = (rateMap && rateMap[sh.phone]) || DEFAULT_HOURLY_RATE
    const basePay = Math.round(h * rate * 100) / 100
    const bonus = pool > 0 ? Math.round((pool * h / totalHours) * 100) / 100 : 0
    return { basePay, bonus, total: Math.round((basePay + bonus) * 100) / 100 }
  })
}

function fmtKr(n) {
  return Number(n).toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtHours(h) {
  const hrs = Math.floor(h); const min = Math.round((h - hrs) * 60)
  return `${hrs}h ${min}m`
}
function hoursFromTimes(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let h = ((eh * 60 + em) - (sh * 60 + sm)) / 60
  if (h <= 0) h += 24
  return Math.round(h * 100) / 100
}
function fmtDate(dateStr) {
  if (!dateStr) return ''
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const d = new Date(dateStr + 'T12:00:00')
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
}
// Tiered pool rate: 0% below baseRevenue, then baseRatePct + steps × stepRatePct per stepKr
function tieredPoolRate(revenue, baseRevenue, baseRatePct, stepKr, stepRatePct) {
  const rev = Number(revenue), base = Number(baseRevenue), rate = Number(baseRatePct)
  const step = Number(stepKr), inc = Number(stepRatePct)
  if (!base || rev < base) return 0
  const steps = Math.floor((rev - base) / Math.max(step, 1))
  return rate + steps * inc
}

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.length === 8 && /^\d+$/.test(p)) p = '47' + p
  return p
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export default function BonusAdmin() {
  const { isAdmin, loading: adminLoading, signIn, error: authError } = useAdminSession()

  const [days, setDays] = useState([])
  const [shifts, setShifts] = useState([])
  const [dataLoading, setDataLoading] = useState(true)

  // Per-day editable state
  const [edits, setEdits] = useState({})
  const [revenues, setRevenues] = useState({})
  const [thresholds, setThresholds] = useState({})
  const [bonusRates, setBonusRates] = useState({})
  const [approveState, setApproveState] = useState({})
  const [rejectState, setRejectState] = useState({})
  const [expandedDays, setExpandedDays] = useState({})
  const toggleDay = (dayId) => setExpandedDays(p => ({ ...p, [dayId]: !p[dayId] }))
  const [deleteShiftState, setDeleteShiftState] = useState({})
  const [unApproveState, setUnApproveState] = useState({})
  const [nbwInputs, setNbwInputs] = useState({}) // { [dayId]: { name, startTime, endTime } }
  const [nbwSaveState, setNbwSaveState] = useState({})
  const [resendState, setResendState] = useState({})

  // Employees
  const [employees, setEmployees] = useState([])
  const [showEmployees, setShowEmployees] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newHourlyRate, setNewHourlyRate] = useState('')
  const [addState, setAddState] = useState({ loading: false, error: '' })
  const [editingRate, setEditingRate] = useState({})

  // Global bonus settings
  const [showSettings, setShowSettings] = useState(false)
  const [poolBaseRevenue, setPoolBaseRevenue] = useState('20000')
  const [poolBaseRatePct, setPoolBaseRatePct] = useState('20')
  const [poolStepEnabled, setPoolStepEnabled] = useState(true)
  const [poolStepKr, setPoolStepKr] = useState('10000')
  const [poolStepRatePct, setPoolStepRatePct] = useState('5')
  const [globalFallbackRate, setGlobalFallbackRate] = useState(String(DEFAULT_HOURLY_RATE))
  const [chartHours, setChartHours] = useState('18')
  const [chartNumEmployees, setChartNumEmployees] = useState('3')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Admin shift registration
  const today = new Date().toISOString().slice(0, 10)
  const [showRegister, setShowRegister] = useState(false)
  const [simEmployee, setSimEmployee] = useState('')
  const [simState, setSimState] = useState({ loading: false, error: '' })
  const [regEmployee, setRegEmployee] = useState('')
  const [regDate, setRegDate] = useState(today)
  const [regStart, setRegStart] = useState('')
  const [regEnd, setRegEnd] = useState('')
  const [regRevenue, setRegRevenue] = useState('')
  const [regState, setRegState] = useState({ loading: false, error: '', done: '' })
  const [regNbwList, setRegNbwList] = useState([])
  const [regNbwInput, setRegNbwInput] = useState({ name: '', startTime: '', endTime: '' })

  useEffect(() => {
    if (!isAdmin) return
    const unsubDays = onSnapshot(
      query(collection(db, 'bonusDays'), orderBy('date', 'desc')),
      (snap) => { setDays(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setDataLoading(false) },
      () => setDataLoading(false),
    )
    const unsubShifts = onSnapshot(
      collection(db, 'bonusShifts'),
      (snap) => setShifts(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => { unsubDays(); unsubShifts() }
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const unsub = onSnapshot(
      collection(db, 'bonusAccess'),
      (snap) => setEmployees(snap.docs.map(d => ({ phone: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
      () => {},
    )
    return unsub
  }, [isAdmin])

  // Load global settings from Firestore
  useEffect(() => {
    if (!isAdmin) return
    getDoc(doc(db, 'siteSettings', 'bonusConfig')).then(d => {
      if (!d.exists()) return
      const cfg = d.data()
      if (cfg.poolBaseRevenue != null) setPoolBaseRevenue(String(cfg.poolBaseRevenue))
      if (cfg.poolBaseRatePct != null) setPoolBaseRatePct(String(cfg.poolBaseRatePct))
      if (cfg.poolStepEnabled != null) setPoolStepEnabled(cfg.poolStepEnabled)
      if (cfg.poolStepKr != null) setPoolStepKr(String(cfg.poolStepKr))
      if (cfg.poolStepRatePct != null) setPoolStepRatePct(String(cfg.poolStepRatePct))
      if (cfg.fallbackHourlyRate) setGlobalFallbackRate(String(cfg.fallbackHourlyRate))
      if (cfg.chartHours) setChartHours(String(cfg.chartHours))
      if (cfg.chartNumEmployees) setChartNumEmployees(String(cfg.chartNumEmployees))
    }).catch(() => {})
  }, [isAdmin])

  const rateMap = useMemo(
    () => Object.fromEntries(employees.map(e => [e.phone, Number(e.hourlyRate || globalFallbackRate || DEFAULT_HOURLY_RATE)])),
    [employees, globalFallbackRate],
  )

  // Chart derived values
  const chartTotalHours = Number(chartHours || 0)
  const chartN = Math.max(1, Number(chartNumEmployees || 1))
  const chartFallbackRate = Number(globalFallbackRate || DEFAULT_HOURLY_RATE)
  const chartThreshold = Math.round(chartTotalHours * chartFallbackRate)
  const chartBasePay = Math.round((chartTotalHours / chartN) * chartFallbackRate)

  const poolConfig = {
    baseRevenue: Number(poolBaseRevenue) || 20000,
    baseRatePct: Number(poolBaseRatePct) || 20,
    stepEnabled: poolStepEnabled,
    stepKr:      Number(poolStepKr) || 10000,
    stepRatePct: poolStepEnabled ? (Number(poolStepRatePct) || 5) : 0,
  }

  async function onSaveSettings() {
    setSettingsSaving(true)
    try {
      await setDoc(doc(db, 'siteSettings', 'bonusConfig'), {
        poolBaseRevenue:  poolConfig.baseRevenue,
        poolBaseRatePct:  poolConfig.baseRatePct,
        poolStepEnabled:  poolConfig.stepEnabled,
        poolStepKr:       poolConfig.stepKr,
        poolStepRatePct:  poolConfig.stepRatePct,
        fallbackHourlyRate: Number(globalFallbackRate),
        chartHours: Number(chartHours),
        chartNumEmployees: Number(chartNumEmployees),
      }, { merge: true })
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch (err) { alert('Save failed: ' + err?.message) }
    finally { setSettingsSaving(false) }
  }

  async function onAddEmployee(e) {
    e.preventDefault()
    const phone = normalizePhone(newPhone)
    if (!phone || !/^\d{10,15}$/.test(phone)) { setAddState({ loading: false, error: 'Invalid phone number' }); return }
    if (!newName.trim()) { setAddState({ loading: false, error: 'Name is required' }); return }
    setAddState({ loading: true, error: '' })
    try {
      await setDoc(doc(db, 'bonusAccess', phone), { name: newName.trim(), email: newEmail.trim(), hourlyRate: newHourlyRate ? Number(newHourlyRate) : Number(globalFallbackRate || DEFAULT_HOURLY_RATE) })
      setNewPhone(''); setNewName(''); setNewEmail(''); setNewHourlyRate('')
      setAddState({ loading: false, error: '' })
    } catch (err) { setAddState({ loading: false, error: err?.message || 'Something went wrong' }) }
  }

  async function onRemoveEmployee(phone) {
    if (!window.confirm(`Remove ${phone} from the bonus system?`)) return
    try { await deleteDoc(doc(db, 'bonusAccess', phone)) } catch (err) { alert('Error: ' + err?.message) }
  }

  async function onSaveHourlyRate(phone) {
    const rate = Number(editingRate[phone])
    if (!rate || rate < 50 || rate > 2000) { alert('Rate must be 50–2000 kr/h'); return }
    try {
      await updateDoc(doc(db, 'bonusAccess', phone), { hourlyRate: rate })
      setEditingRate(prev => { const c = { ...prev }; delete c[phone]; return c })
    } catch (err) { alert('Error: ' + err?.message) }
  }

  async function onRegisterShift(e) {
    e.preventDefault()
    setRegState({ loading: true, error: '', done: '' })
    try {
      const res = await httpsCallable(functions, 'adminRegisterBonusShift')({
        phone: regEmployee, date: regDate, startTime: regStart, endTime: regEnd,
        revenueKr: Number(regRevenue),
        nonBonusWorkers: regNbwList,
      })
      const { name, hoursWorked } = res.data
      const nbwNote = regNbwList.length > 0 ? ` + ${regNbwList.length} non-bonus worker${regNbwList.length > 1 ? 's' : ''}` : ''
      setRegState({ loading: false, error: '', done: `Shift registered for ${name} (${fmtHours(hoursWorked)})${nbwNote}` })
      setRegStart(''); setRegEnd(''); setRegRevenue('')
      setRegNbwList([]); setRegNbwInput({ name: '', startTime: '', endTime: '' })
    } catch (err) { setRegState({ loading: false, error: err?.message || 'Something went wrong', done: '' }) }
  }

  function onAddRegNbw() {
    const h = hoursFromTimes(regNbwInput.startTime, regNbwInput.endTime)
    if (!regNbwInput.name.trim() || !regNbwInput.startTime || !regNbwInput.endTime || h <= 0) return
    setRegNbwList(prev => [...prev, { name: regNbwInput.name.trim(), startTime: regNbwInput.startTime, endTime: regNbwInput.endTime, hours: h, hourlyRate: 0 }])
    setRegNbwInput({ name: '', startTime: '', endTime: '' })
  }

  function onRemoveRegNbw(i) {
    setRegNbwList(prev => prev.filter((_, idx) => idx !== i))
  }

  const byDay = useMemo(
    () => days.map(day => ({ ...day, dayShifts: shifts.filter(s => s.dayId === day.id) })),
    [days, shifts],
  )

  function getEdit(id, field) { return edits[id]?.[field] }
  function setEdit(id, field, value) { setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } })) }
  function getEffectiveHours(shift) { const o = edits[shift.id]?.hoursWorked; return (o != null && o !== '') ? Number(o) : shift.hoursWorked }
  function getEffectiveStart(shift) { return edits[shift.id]?.startTime ?? shift.startTime }
  function getEffectiveEnd(shift) { return edits[shift.id]?.endTime ?? shift.endTime }

  async function onSimulateUser() {
    if (!simEmployee) return
    setSimState({ loading: true, error: '' })
    try {
      const res = await httpsCallable(functions, 'adminCreateSimSession')({ phone: simEmployee })
      const { token, name, phone } = res.data
      sessionStorage.setItem('bonusSimSession', JSON.stringify({ token, name, phone, savedAt: Date.now(), isSimulation: true }))
      window.location.href = '/bonus'
    } catch (err) {
      setSimState({ loading: false, error: err?.message || 'Noe gikk galt' })
    }
  }

  async function onApproveDay(dayId, dayData, dayShifts) {
    const pending = dayShifts.filter(s => s.status !== 'approved' && s.status !== 'rejected')
    if (!pending.length) return
    const rev = revenues[dayId] != null ? Number(revenues[dayId]) : Number(dayData.revenueKr || 0)
    if (!rev) { setApproveState(p => ({ ...p, [dayId]: { loading: false, error: 'Enter approved revenue' } })); return }
    const autoThreshold = dayShifts.reduce((sum, sh) => sum + getEffectiveHours(sh) * (rateMap[sh.phone] || DEFAULT_HOURLY_RATE), 0)
    const effectiveThreshold = thresholds[dayId] != null ? Number(thresholds[dayId]) : Math.round(autoThreshold)
    const autoRate = tieredPoolRate(rev, poolConfig.baseRevenue, poolConfig.baseRatePct, poolConfig.stepKr, poolConfig.stepRatePct)
    const effectiveBonusRatePct = bonusRates[dayId] != null ? Number(bonusRates[dayId]) : autoRate
    setApproveState(p => ({ ...p, [dayId]: { loading: true, error: '' } }))
    const shiftUpdates = pending.map(s => ({
      id: s.id,
      startTime: edits[s.id]?.startTime || null,
      endTime: edits[s.id]?.endTime || null,
      hoursWorked: (edits[s.id]?.hoursWorked != null && edits[s.id].hoursWorked !== '') ? Number(edits[s.id].hoursWorked) : null,
      adminNote: edits[s.id]?.adminNote || '',
    }))
    try {
      await httpsCallable(functions, 'approveBonusDay')({ dayId, shiftUpdates, approvedRevenue: rev, thresholdKr: effectiveThreshold, bonusRatePct: effectiveBonusRatePct })
      setApproveState(p => ({ ...p, [dayId]: { loading: false, error: '', done: true } }))
    } catch (err) { setApproveState(p => ({ ...p, [dayId]: { loading: false, error: err?.message || 'Something went wrong' } })) }
  }

  async function onUnapproveDay(dayId, mode) {
    if (mode === 'reject') {
      if (!window.confirm("Reject this entire day's bonus? This cannot be undone.")) return
      setUnApproveState(p => ({ ...p, [dayId]: { loading: 'reject', error: '' } }))
      try {
        await httpsCallable(functions, 'rejectBonusDay')({ dayId, reason: 'Reversed by admin' })
        setUnApproveState(p => ({ ...p, [dayId]: { loading: false, done: 'Day rejected.' } }))
      } catch (err) {
        setUnApproveState(p => ({ ...p, [dayId]: { loading: false, error: err?.message || 'Something went wrong' } }))
      }
    } else {
      if (!window.confirm('Open this day for editing? Approval will be reversed.')) return
      setUnApproveState(p => ({ ...p, [dayId]: { loading: 'edit', error: '' } }))
      try {
        await httpsCallable(functions, 'unapproveDay')({ dayId })
        setUnApproveState(p => ({ ...p, [dayId]: { loading: false, done: 'Approval reversed — shifts returned to pending.' } }))
      } catch (err) {
        setUnApproveState(p => ({ ...p, [dayId]: { loading: false, error: err?.message || 'Something went wrong' } }))
      }
    }
  }

  function getNbwInput(dayId) { return nbwInputs[dayId] || { name: '', startTime: '', endTime: '' } }
  function setNbwInput(dayId, field, value) {
    setNbwInputs(p => ({ ...p, [dayId]: { ...getNbwInput(dayId), [field]: value } }))
  }

  async function onAddNonBonusWorker(dayId, currentWorkers) {
    const inp = getNbwInput(dayId)
    const name = inp.name.trim()
    const hours = hoursFromTimes(inp.startTime, inp.endTime)
    if (!name || !inp.startTime || !inp.endTime || hours <= 0) return
    const updated = [...(currentWorkers || []), { name, startTime: inp.startTime, endTime: inp.endTime, hours, hourlyRate: 0 }]
    setNbwSaveState(p => ({ ...p, [dayId]: { loading: true } }))
    try {
      await httpsCallable(functions, 'setNonBonusWorkers')({ dayId, workers: updated })
      setNbwInputs(p => ({ ...p, [dayId]: { name: '', startTime: '', endTime: '' } }))
      setNbwSaveState(p => ({ ...p, [dayId]: { loading: false } }))
    } catch (err) {
      setNbwSaveState(p => ({ ...p, [dayId]: { loading: false, error: err?.message } }))
    }
  }

  async function onRemoveNonBonusWorker(dayId, currentWorkers, idx) {
    const updated = currentWorkers.filter((_, i) => i !== idx)
    setNbwSaveState(p => ({ ...p, [dayId]: { loading: true } }))
    try {
      await httpsCallable(functions, 'setNonBonusWorkers')({ dayId, workers: updated })
      setNbwSaveState(p => ({ ...p, [dayId]: { loading: false } }))
    } catch (err) {
      setNbwSaveState(p => ({ ...p, [dayId]: { loading: false, error: err?.message } }))
    }
  }

  async function onDeleteShift(shiftId) {
    if (!window.confirm('Delete this shift? This cannot be undone.')) return
    setDeleteShiftState(p => ({ ...p, [shiftId]: { loading: true } }))
    try {
      await httpsCallable(functions, 'deleteBonusShift')({ shiftId })
      setDeleteShiftState(p => ({ ...p, [shiftId]: { done: true } }))
    } catch (err) {
      setDeleteShiftState(p => ({ ...p, [shiftId]: { error: err?.message || 'Failed' } }))
    }
  }

  async function onRejectDay(dayId) {
    if (!window.confirm("Reject this entire day's bonus request? This cannot be undone.")) return
    setRejectState(p => ({ ...p, [dayId]: { loading: true, error: '' } }))
    try {
      await httpsCallable(functions, 'rejectBonusDay')({ dayId })
      setRejectState(p => ({ ...p, [dayId]: { loading: false, done: true } }))
    } catch (err) { setRejectState(p => ({ ...p, [dayId]: { loading: false, error: err?.message || 'Something went wrong' } })) }
  }

  async function onResend(shiftId) {
    setResendState(p => ({ ...p, [shiftId]: { loading: true, error: '' } }))
    try {
      await httpsCallable(functions, 'resendBonusEmail')({ shiftId })
      setResendState(p => ({ ...p, [shiftId]: { loading: false, done: true } }))
    } catch (err) { setResendState(p => ({ ...p, [shiftId]: { loading: false, error: err?.message || 'Error' } })) }
  }

  if (!adminLoading && !isAdmin) {
    return (
      <div className="ba-page">
        <div className="ba-wrap">
          <div className="ba-header"><h1>Bonus Admin</h1></div>
          <button type="button" className="ba-btn ba-btn--primary" onClick={signIn}>Admin login</button>
          {authError && <p className="ba-error">{authError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="ba-page">
    <div className="ba-wrap">

      {/* ── Header ── */}
      <div className="ba-header">
        <div className="ba-header-row">
          <div>
            <h1 className="ba-title">Bonus Admin</h1>
            <p className="ba-subtitle">Review and approve shifts · employees receive an email on approval</p>
          </div>
          <Link to="/admin" className="ba-back-btn">← Admin</Link>
        </div>
      </div>

      {/* ── Bonus settings + chart ── */}
      <div className="ba-panel">
        <button type="button" className="ba-panel-toggle" onClick={() => setShowSettings(v => !v)}>
          <span className="ba-panel-toggle-left">
            <span className="ba-panel-toggle-icon">📊</span>
            <span className="ba-panel-toggle-label">Bonus settings &amp; chart</span>
          </span>
          <span className="ba-chevron">{showSettings ? '▲' : '▼'}</span>
        </button>

        {showSettings && (
          <div className="ba-settings-body">
            <div className="ba-settings-grid">
              {/* Left: controls */}
              <div className="ba-settings-controls">
                <p className="ba-settings-section-label">Tiered pool rate</p>
                <p className="ba-settings-hint">Rate increases every time revenue crosses a step boundary above the base revenue. Below base = 0%.</p>
                <div className="ba-settings-row">
                  <div className="ba-field">
                    <label className="ba-label">Base revenue</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input ba-input--sm" min="0" step="1000" value={poolBaseRevenue} onChange={e => setPoolBaseRevenue(e.target.value)} />
                      <span>kr</span>
                    </div>
                  </div>
                  <div className="ba-field">
                    <label className="ba-label">Base rate (x%)</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input ba-input--sm" min="0" max="100" step="0.5" value={poolBaseRatePct} onChange={e => setPoolBaseRatePct(e.target.value)} />
                      <span>%</span>
                    </div>
                  </div>
                  <div className="ba-field ba-field--toggle">
                    <label className="ba-label">Steps</label>
                    <label className="ba-toggle">
                      <input type="checkbox" checked={poolStepEnabled} onChange={e => setPoolStepEnabled(e.target.checked)} />
                      <span className="ba-toggle-track" />
                    </label>
                  </div>
                  <div className={`ba-field${!poolStepEnabled ? ' ba-field--disabled' : ''}`}>
                    <label className="ba-label">Step size</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input ba-input--sm" min="1000" step="1000" value={poolStepKr} onChange={e => setPoolStepKr(e.target.value)} disabled={!poolStepEnabled} />
                      <span>kr</span>
                    </div>
                  </div>
                  <div className={`ba-field${!poolStepEnabled ? ' ba-field--disabled' : ''}`}>
                    <label className="ba-label">+rate per step (y%)</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input ba-input--sm" min="0" max="50" step="0.5" value={poolStepRatePct} onChange={e => setPoolStepRatePct(e.target.value)} disabled={!poolStepEnabled} />
                      <span>%</span>
                    </div>
                  </div>
                </div>
                {/* Tier preview */}
                {poolStepEnabled ? (
                  <div className="ba-tier-preview">
                    {Array.from({ length: 6 }, (_, i) => {
                      const rev = poolConfig.baseRevenue + i * poolConfig.stepKr
                      const rate = tieredPoolRate(rev, poolConfig.baseRevenue, poolConfig.baseRatePct, poolConfig.stepKr, poolConfig.stepRatePct)
                      return (
                        <span key={i} className="ba-tier-chip">
                          {fmtKr(rev / 1000)}k kr → <strong>{rate}%</strong>
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <p className="ba-settings-hint" style={{ marginTop: 4 }}>Flat rate — {poolConfig.baseRatePct}% for all revenue above {fmtKr(poolConfig.baseRevenue)} kr.</p>
                )}

                <p className="ba-settings-section-label" style={{ marginTop: 16 }}>Fallback hourly rate</p>
                <div className="ba-settings-row">
                  <div className="ba-field">
                    <label className="ba-label">Hourly rate (when employee has none set)</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input" min="50" max="2000" step="0.01" value={globalFallbackRate} onChange={e => setGlobalFallbackRate(e.target.value)} />
                      <span>kr/h</span>
                    </div>
                  </div>
                </div>

                <p className="ba-settings-section-label" style={{ marginTop: 20 }}>Chart scenario</p>
                <p className="ba-settings-hint">
                  Set a typical shift to see per-employee earnings in the chart.
                  Total hours = all employees combined (e.g. 3 × 6h = 18h total).
                </p>
                <div className="ba-settings-row">
                  <div className="ba-field">
                    <label className="ba-label">Employees</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input ba-input--sm" min="1" max="20" step="1" value={chartNumEmployees} onChange={e => setChartNumEmployees(e.target.value)} />
                      <span>people</span>
                    </div>
                  </div>
                  <div className="ba-field">
                    <label className="ba-label">Total hours (all employees)</label>
                    <div className="ba-input-suffix">
                      <input type="number" className="ba-input ba-input--sm" min="1" max="100" step="0.5" value={chartHours} onChange={e => setChartHours(e.target.value)} />
                      <span>h</span>
                    </div>
                  </div>
                  <div className="ba-field ba-field--info">
                    <label className="ba-label">Per employee</label>
                    <div className="ba-field-value" style={{ fontSize: '0.88rem' }}>{fmtKr(chartTotalHours / chartN)}h · {fmtKr(chartBasePay)} kr base</div>
                    <p className="ba-field-hint">Threshold: {fmtKr(chartThreshold)} kr (total wage cost)</p>
                  </div>
                </div>

                <button type="button" className="ba-btn ba-btn--primary ba-btn--sm" style={{ marginTop: 16 }} onClick={onSaveSettings} disabled={settingsSaving}>
                  {settingsSaving ? 'Saving…' : settingsSaved ? '✓ Saved' : 'Save settings'}
                </button>
              </div>

              {/* Right: chart */}
              <div className="ba-chart-panel">
                <p className="ba-chart-title">Bonus pool vs revenue</p>
                <p className="ba-chart-subtitle">
                  {chartN} employee{chartN !== 1 ? 's' : ''} · {fmtKr(chartTotalHours / chartN)}h each · threshold: <strong>{fmtKr(chartThreshold)} kr</strong> · rate: <strong>{poolConfig.baseRatePct}%{poolConfig.stepEnabled ? ` +${poolConfig.stepRatePct}% per ${fmtKr(poolConfig.stepKr / 1000)}k` : ' (flat)'}</strong>
                </p>
                <BonusChart thresholdKr={chartThreshold} poolConfig={poolConfig} numEmployees={chartN} basePay={chartBasePay} />

                {/* Scenario table */}
                <div className="ba-scenario-table">
                  <div className="ba-scenario-header">
                    <span>Revenue</span>
                    <span>Rate · Pool</span>
                    <span>Per employee (base + bonus)</span>
                    <span>Avg kr/h</span>
                  </div>
                  {Array.from({ length: 10 }, (_, i) => (i + 1) * 10000).map(rev => {
                    const rate = tieredPoolRate(rev, poolConfig.baseRevenue, poolConfig.baseRatePct, poolConfig.stepKr, poolConfig.stepRatePct)
                    const pool = Math.max(0, (rev - chartThreshold) * rate / 100)
                    const perEmpBonus = pool / chartN
                    const perEmpTotal = chartBasePay + perEmpBonus
                    const hoursPerEmp = chartTotalHours / chartN
                    const avgKrPerHour = hoursPerEmp > 0 ? perEmpTotal / hoursPerEmp : 0
                    const hasBonus = pool > 0
                    return (
                      <div key={rev} className={`ba-scenario-row ${hasBonus ? 'ba-scenario-row--active' : ''}`}>
                        <span className="ba-scenario-rev">{fmtKr(rev)} kr</span>
                        <span className="ba-scenario-pool">
                          {hasBonus
                            ? <><span className="ba-scenario-rate">{rate}%</span> · {fmtKr(Math.round(pool))} kr</>
                            : <span style={{ color: '#ddd' }}>—</span>}
                        </span>
                        <span className="ba-scenario-emp">
                          {hasBonus
                            ? <>{fmtKr(Math.round(chartBasePay))} <span className="ba-scenario-bonus">+{fmtKr(Math.round(perEmpBonus))}</span> = <strong>{fmtKr(Math.round(perEmpTotal))} kr</strong></>
                            : <span style={{ color: '#bbb' }}>{fmtKr(Math.round(chartBasePay))} kr</span>
                          }
                        </span>
                        <span className="ba-scenario-kph" style={{ color: hasBonus ? '#7c3aed' : '#bbb' }}>
                          {fmtKr(Math.round(avgKrPerHour))} kr/h
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Staff ── */}
      <div className="ba-panel">
        <button type="button" className="ba-panel-toggle" onClick={() => setShowEmployees(v => !v)}>
          <span className="ba-panel-toggle-left">
            <span className="ba-panel-toggle-icon">👥</span>
            <span className="ba-panel-toggle-label">Staff with access ({employees.length})</span>
          </span>
          <span className="ba-chevron">{showEmployees ? '▲' : '▼'}</span>
        </button>
        {showEmployees && (
          <div className="ba-panel-body">
            {employees.length > 0 && (
              <table className="ba-employees-table">
                <thead>
                  <tr><th>Name</th><th>Phone</th><th>Email</th><th>Hourly rate</th><th></th></tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.phone}>
                      <td className="ba-emp-name">{emp.name}</td>
                      <td className="ba-emp-phone">+{emp.phone}</td>
                      <td className="ba-emp-email">{emp.email || '—'}</td>
                      <td>
                        {editingRate[emp.phone] != null ? (
                          <span className="ba-rate-edit">
                            <input type="number" min="50" max="2000" step="0.01" className="ba-input ba-input--sm" value={editingRate[emp.phone]} onChange={e => setEditingRate(prev => ({ ...prev, [emp.phone]: e.target.value }))} />
                            <button type="button" className="ba-btn ba-btn--save" onClick={() => onSaveHourlyRate(emp.phone)}>Save</button>
                          </span>
                        ) : (
                          <span className="ba-rate-display" onClick={() => setEditingRate(prev => ({ ...prev, [emp.phone]: String(emp.hourlyRate || globalFallbackRate || DEFAULT_HOURLY_RATE) }))} title="Click to edit">
                            {fmtKr(emp.hourlyRate || globalFallbackRate || DEFAULT_HOURLY_RATE)} kr/h
                          </span>
                        )}
                      </td>
                      <td><button type="button" className="ba-btn ba-btn--remove" onClick={() => onRemoveEmployee(emp.phone)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={onAddEmployee} className="ba-add-form">
              <p className="ba-add-form-title">Add employee</p>
              <div className="ba-add-form-row">
                <input className="ba-input" type="tel" placeholder="Phone" value={newPhone} onChange={e => setNewPhone(e.target.value)} required />
                <input className="ba-input" type="text" placeholder="Full name" value={newName} onChange={e => setNewName(e.target.value)} required />
                <input className="ba-input" type="email" placeholder="Email (optional)" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                <input className="ba-input" type="number" min="50" max="2000" step="0.01" placeholder={`Rate (${DEFAULT_HOURLY_RATE})`} value={newHourlyRate} onChange={e => setNewHourlyRate(e.target.value)} />
                <button type="submit" className="ba-btn ba-btn--primary" disabled={addState.loading}>{addState.loading ? 'Adding…' : 'Add'}</button>
              </div>
              {addState.error && <p className="ba-error">{addState.error}</p>}
            </form>
          </div>
        )}
      </div>

      {/* ── Register shift ── */}
      <div className="ba-panel">
        <button type="button" className="ba-panel-toggle" onClick={() => setShowRegister(v => !v)}>
          <span className="ba-panel-toggle-left">
            <span className="ba-panel-toggle-icon">➕</span>
            <span className="ba-panel-toggle-label">Register shift for employee</span>
          </span>
          <span className="ba-chevron">{showRegister ? '▲' : '▼'}</span>
        </button>
        {showRegister && (
          <div className="ba-panel-body">
            <form onSubmit={onRegisterShift} className="ba-register-form">
              <div className="ba-register-grid">
                <div className="ba-field"><label className="ba-label">Employee</label>
                  <select className="ba-input" value={regEmployee} onChange={e => setRegEmployee(e.target.value)} required>
                    <option value="">Select…</option>
                    {employees.map(emp => <option key={emp.phone} value={emp.phone}>{emp.name}</option>)}
                  </select>
                </div>
                <div className="ba-field"><label className="ba-label">Date</label><input className="ba-input" type="date" value={regDate} onChange={e => setRegDate(e.target.value)} required /></div>
                <div className="ba-field"><label className="ba-label">Start</label><input className="ba-input" type="time" value={regStart} onChange={e => setRegStart(e.target.value)} required /></div>
                <div className="ba-field"><label className="ba-label">End</label><input className="ba-input" type="time" value={regEnd} onChange={e => setRegEnd(e.target.value)} required /></div>
                <div className="ba-field"><label className="ba-label">Revenue (kr)</label><input className="ba-input" type="number" min="0" step="1" placeholder="32 500" value={regRevenue} onChange={e => setRegRevenue(e.target.value)} required /></div>
                <div className="ba-field ba-field--submit"><label className="ba-label">&nbsp;</label><button type="submit" className="ba-btn ba-btn--primary" disabled={regState.loading}>{regState.loading ? 'Registering…' : 'Register'}</button></div>
              </div>
                      {regState.error && <p className="ba-error">{regState.error}</p>}
            </form>
          </div>
        )}
      </div>

      {/* ── Simulate user ── */}
      <div className="ba-sim-bar">
        <span className="ba-sim-label">Simulate employee</span>
        <select className="ba-input ba-input--sm ba-sim-select" value={simEmployee} onChange={e => setSimEmployee(e.target.value)}>
          <option value="">Select employee…</option>
          {employees.map(emp => <option key={emp.phone} value={emp.phone}>{emp.name}</option>)}
        </select>
        <button type="button" className="ba-btn ba-btn--sm ba-btn--ghost" onClick={onSimulateUser} disabled={!simEmployee || simState.loading}>
          {simState.loading ? '…' : 'View as employee →'}
        </button>
        {simState.error && <span className="ba-error" style={{ fontSize: '0.8rem' }}>{simState.error}</span>}
      </div>

      {/* ── Day cards ── */}
      {(adminLoading || dataLoading) && <p className="ba-loading">Loading…</p>}
      {!dataLoading && byDay.length === 0 && <p className="ba-empty">No submitted registrations yet.</p>}

      {byDay.map((day) => {
        const { id: dayId, date, status, revenueKr, dayShifts } = day
        const pending = dayShifts.filter(s => s.status !== 'approved' && s.status !== 'rejected')
        const currentRevenue = revenues[dayId] != null ? Number(revenues[dayId]) : Number(revenueKr || 0)
        const totalHours = dayShifts.reduce((s, sh) => s + getEffectiveHours(sh), 0)

        const nonBonusWorkers = day.nonBonusWorkers || []
        const nonBonusThresholdContrib = nonBonusWorkers.reduce((sum, w) => sum + w.hours * w.hourlyRate, 0)
        const nonBonusTotalHours = nonBonusWorkers.reduce((sum, w) => sum + w.hours, 0)

        const autoThreshold = dayShifts.reduce((sum, sh) => sum + getEffectiveHours(sh) * (rateMap[sh.phone] || DEFAULT_HOURLY_RATE), 0) + nonBonusThresholdContrib
        const effectiveThreshold = thresholds[dayId] != null ? Number(thresholds[dayId]) : Math.round(autoThreshold)
        const autoRate = tieredPoolRate(currentRevenue, poolConfig.baseRevenue, poolConfig.baseRatePct, poolConfig.stepKr, poolConfig.stepRatePct)
        const effectiveBonusRatePct = bonusRates[dayId] != null ? Number(bonusRates[dayId]) : autoRate

        const surplus = currentRevenue - effectiveThreshold
        const pool = surplus > 0 ? surplus * effectiveBonusRatePct / 100 : 0
        const opa = totalHours > 0 ? Math.round(currentRevenue / totalHours) : 0

        const previews = calcPreview(
          dayShifts.map(sh => ({ ...sh, hoursWorked: getEffectiveHours(sh) })),
          currentRevenue, effectiveThreshold, effectiveBonusRatePct, rateMap, nonBonusTotalHours,
        )

        const appState = approveState[dayId] || {}
        const rjState = rejectState[dayId] || {}
        const uaState = unApproveState[dayId] || {}
        const nbwState = nbwSaveState[dayId] || {}
        const isRejected = status === 'rejected'
        const isApprovedDay = status === 'approved'

        const isClosedByDefault = isApprovedDay || isRejected
        const isExpanded = isClosedByDefault ? !!expandedDays[dayId] : (expandedDays[dayId] !== false)

        return (
          <div key={dayId} className={`ba-day-card ${isApprovedDay ? 'ba-day-card--approved' : ''} ${isRejected ? 'ba-day-card--rejected' : ''}`}>

            {/* Card header */}
            <div className="ba-day-head ba-day-head--toggle" onClick={() => toggleDay(dayId)} style={{ cursor: 'pointer' }}>
              <div className="ba-day-head-left">
                <h2 className="ba-day-date">{fmtDate(date)}</h2>
                <span className="ba-day-meta">{dayShifts.length} employee{dayShifts.length !== 1 ? 's' : ''} · {fmtHours(totalHours)} total</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`ba-day-badge ba-day-badge--${isApprovedDay ? 'approved' : isRejected ? 'rejected' : 'pending'}`}>
                  {isApprovedDay ? 'Approved' : isRejected ? 'Rejected' : 'Pending approval'}
                </span>
                <span className="ba-chevron" style={{ fontSize: '0.75rem', color: '#aaa' }}>{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {isExpanded && isRejected && (
              <p className="ba-rejected-note">This day's bonus request was rejected.</p>
            )}
            {isExpanded && !isRejected && (
              <>
                {/* Formula controls */}
                <div className="ba-formula-controls">
                  <div className="ba-formula-inputs">
                    <div className="ba-field">
                      <label className="ba-label">Revenue</label>
                      <div className="ba-input-suffix">
                        <input className="ba-input ba-input--rev" type="number" min="0" step="100" value={revenues[dayId] ?? revenueKr ?? ''} onChange={e => setRevenues(p => ({ ...p, [dayId]: e.target.value }))} disabled={isApprovedDay} />
                        <span>kr</span>
                      </div>
                    </div>
                    <div className="ba-field">
                      <label className="ba-label">
                        Threshold
                        <span className="ba-label-hint">auto: {fmtKr(Math.round(autoThreshold))} kr</span>
                      </label>
                      <div className="ba-input-suffix">
                        <input className="ba-input ba-input--rev" type="number" min="0" step="100" value={thresholds[dayId] ?? Math.round(autoThreshold)} onChange={e => setThresholds(p => ({ ...p, [dayId]: e.target.value }))} disabled={isApprovedDay} />
                        <span>kr</span>
                      </div>
                    </div>
                    <div className="ba-field">
                      <label className="ba-label">Pool rate <span className="ba-label-hint">auto: {autoRate}%</span></label>
                      <div className="ba-input-suffix">
                        <input className="ba-input ba-input--pct" type="number" min="0" max="100" step="0.5" value={bonusRates[dayId] ?? autoRate} onChange={e => setBonusRates(p => ({ ...p, [dayId]: e.target.value }))} disabled={isApprovedDay} />
                        <span>%</span>
                      </div>
                    </div>
                  </div>

                  {/* Formula breakdown */}
                  {totalHours > 0 && currentRevenue > 0 && (
                    <div className="ba-formula-bar">
                      <span className="ba-fb-item">OPA: <strong>{fmtKr(opa)} kr/h</strong></span>
                      <span className="ba-fb-sep" />
                      <span className="ba-fb-item">Threshold: <strong>{fmtKr(Math.round(effectiveThreshold))} kr</strong></span>
                      <span className="ba-fb-sep" />
                      <span className={`ba-fb-item ${surplus > 0 ? 'ba-fb-item--surplus' : 'ba-fb-item--deficit'}`}>
                        Surplus: <strong>{surplus > 0 ? '+' : ''}{fmtKr(Math.round(surplus))} kr</strong>
                      </span>
                      <span className="ba-fb-sep" />
                      <span className="ba-fb-item ba-fb-item--pool">Pool: <strong>{fmtKr(Math.round(pool))} kr</strong></span>
                    </div>
                  )}
                </div>

                {/* Shifts table */}
                <div className="ba-table-wrap">
                  <table className="ba-shifts-table">
                    <thead>
                      <tr>
                        <th>Name</th><th>Start</th><th>End</th><th>Hours</th>
                        <th className="ba-col-r">Rate</th>
                        <th className="ba-col-r">Base pay</th>
                        <th className="ba-col-r">Bonus</th>
                        <th className="ba-col-r">Total</th>
                        <th>Note</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayShifts.map((shift, i) => {
                        const p = previews[i]
                        const isShiftApproved = shift.status === 'approved'
                        const rs = resendState[shift.id] || {}
                        const empRate = rateMap[shift.phone] || DEFAULT_HOURLY_RATE
                        return (
                          <tr key={shift.id} className={isShiftApproved ? 'ba-row--approved' : ''}>
                            <td className="ba-shifts-name">
                              <strong>{shift.name}</strong>
                              <span className="ba-shifts-phone">{shift.phone.replace(/^47/, '')}</span>
                            </td>
                            <td><input type="time" className="ba-input ba-input--time" value={getEffectiveStart(shift)} onChange={e => setEdit(shift.id, 'startTime', e.target.value)} disabled={isShiftApproved} /></td>
                            <td><input type="time" className="ba-input ba-input--time" value={getEffectiveEnd(shift)} onChange={e => setEdit(shift.id, 'endTime', e.target.value)} disabled={isShiftApproved} /></td>
                            <td><input type="number" className="ba-input ba-input--hrs" step="0.01" value={getEdit(shift.id, 'hoursWorked') ?? shift.hoursWorked} onChange={e => setEdit(shift.id, 'hoursWorked', e.target.value)} disabled={isShiftApproved} /></td>
                            <td className="ba-col-r ba-col-rate">{fmtKr(empRate)}</td>
                            <td className="ba-col-r">{fmtKr(p.basePay)}</td>
                            <td className="ba-col-r ba-col-bonus">+{fmtKr(p.bonus)}</td>
                            <td className="ba-col-r ba-col-total">{fmtKr(p.total)}</td>
                            <td><input type="text" className="ba-input ba-input--note" placeholder="Note" value={getEdit(shift.id, 'adminNote') ?? (shift.adminNote || '')} onChange={e => setEdit(shift.id, 'adminNote', e.target.value)} disabled={isShiftApproved} /></td>
                            <td className="ba-shift-actions-cell">
                              {isShiftApproved && (
                                <button type="button" className="ba-resend-btn" onClick={() => onResend(shift.id)} disabled={rs.loading}>
                                  {rs.loading ? '…' : rs.done ? '✓ Sent' : rs.error ? '⚠' : (shift.emailSent ? '✓ Sent' : 'Email')}
                                </button>
                              )}
                              {!isShiftApproved && (() => {
                                const ds = deleteShiftState[shift.id] || {}
                                return (
                                  <button type="button" className="ba-delete-shift-btn" onClick={() => onDeleteShift(shift.id)} disabled={ds.loading || ds.done} title="Delete shift">
                                    {ds.loading ? '…' : ds.done ? '✓' : ds.error ? '⚠' : '✕'}
                                  </button>
                                )
                              })()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Non-bonus workers */}
                {!isRejected && (
                  <div className="ba-nbw-section">
                    <p className="ba-nbw-title">Non-bonus workers <span className="ba-nbw-hint">— hours count toward pool division</span></p>
                    {nonBonusWorkers.length > 0 && (
                      <div className="ba-nbw-list">
                        {nonBonusWorkers.map((w, i) => (
                          <div key={i} className="ba-nbw-row">
                            <span className="ba-nbw-name">{w.name}</span>
                            <span className="ba-nbw-detail">{w.startTime && w.endTime ? `${w.startTime}–${w.endTime}` : fmtHours(w.hours)}</span>
                            {!isApprovedDay && (
                              <button type="button" className="ba-nbw-remove" onClick={() => onRemoveNonBonusWorker(dayId, nonBonusWorkers, i)} disabled={nbwState.loading}>×</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!isApprovedDay && (
                      <div className="ba-nbw-form">
                        <input className="ba-input ba-input--nbw-name" placeholder="Name" value={getNbwInput(dayId).name} onChange={e => setNbwInput(dayId, 'name', e.target.value)} />
                        <input className="ba-input ba-input--sm" type="time" value={getNbwInput(dayId).startTime} onChange={e => setNbwInput(dayId, 'startTime', e.target.value)} />
                        <input className="ba-input ba-input--sm" type="time" value={getNbwInput(dayId).endTime} onChange={e => setNbwInput(dayId, 'endTime', e.target.value)} />
                        <button type="button" className="ba-btn ba-btn--sm ba-btn--ghost" onClick={() => onAddNonBonusWorker(dayId, nonBonusWorkers)} disabled={nbwState.loading || !getNbwInput(dayId).name || !getNbwInput(dayId).startTime || !getNbwInput(dayId).endTime}>
                          {nbwState.loading ? '…' : '+ Add'}
                        </button>
                      </div>
                    )}
                    {nbwState.error && <p className="ba-error" style={{ margin: '4px 0 0' }}>{nbwState.error}</p>}
                  </div>
                )}

                {/* Actions */}
                {isApprovedDay && (
                  <div className="ba-day-actions">
                    {uaState.error && <p className="ba-error">{uaState.error}</p>}
                    {uaState.done ? (
                      <p className="ba-success">✓ {uaState.done}</p>
                    ) : (
                      <div className="ba-unapprove-actions">
                        <button type="button" className="ba-btn ba-btn--sm ba-btn--unapprove" onClick={() => onUnapproveDay(dayId, 'edit')} disabled={uaState.loading}>
                          {uaState.loading === 'edit' ? 'Working…' : 'Open for editing'}
                        </button>
                        <button type="button" className="ba-btn ba-btn--sm ba-btn--unapprove" onClick={() => onUnapproveDay(dayId, 'reject')} disabled={uaState.loading}>
                          {uaState.loading === 'reject' ? 'Working…' : 'Reject day'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {pending.length > 0 && (
                  <div className="ba-day-actions">
                    {appState.error && <p className="ba-error">{appState.error}</p>}
                    {rjState.error && <p className="ba-error">{rjState.error}</p>}
                    {appState.done ? (
                      <p className="ba-success">✓ Approved!</p>
                    ) : (
                      <>
                        <button type="button" className="ba-btn ba-btn--approve" onClick={() => onApproveDay(dayId, day, dayShifts)} disabled={appState.loading || rjState.loading}>
                          {appState.loading ? 'Approving…' : `Approve ${pending.length} shift${pending.length !== 1 ? 's' : ''}`}
                        </button>
                        <button type="button" className="ba-btn ba-btn--reject" onClick={() => onRejectDay(dayId)} disabled={appState.loading || rjState.loading}>
                          {rjState.loading ? 'Rejecting…' : 'Reject'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}
