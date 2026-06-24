import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import './Bonus.css'

const BONUS_HOURLY_RATE = 166.34
const BONUS_THRESHOLD_RATE = 400
const BONUS_RATE = 0.15

function bonusPool(revenue, totalHours) {
  const surplus = Number(revenue) - BONUS_THRESHOLD_RATE * totalHours
  if (surplus <= 0) return 0
  return surplus * BONUS_RATE
}

function calcPreview(shiftsWithHours, revenue) {
  const totalHours = shiftsWithHours.reduce((s, sh) => s + (Number(sh.hoursWorked) || 0), 0)
  const pool = bonusPool(revenue, totalHours)
  if (totalHours <= 0) return shiftsWithHours.map(() => ({ basePay: 0, bonus: 0, total: 0 }))
  return shiftsWithHours.map((sh) => {
    const h = Number(sh.hoursWorked) || 0
    const basePay = Math.round(h * BONUS_HOURLY_RATE * 100) / 100
    const bonus = pool > 0 ? Math.round((pool * h / totalHours) * 100) / 100 : 0
    return { basePay, bonus, total: Math.round((basePay + bonus) * 100) / 100 }
  })
}

function fmtKr(n) {
  return Number(n).toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtHours(h) {
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return `${hrs}t ${min}m`
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
  const months = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember']
  const d = new Date(dateStr + 'T12:00:00')
  return `${days[d.getDay()]} ${d.getDate()}. ${months[d.getMonth()]}`
}

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.length === 8 && /^\d+$/.test(p)) p = '47' + p
  return p
}

export default function BonusAdmin() {
  const { isAdmin, loading: adminLoading, signIn, error: authError } = useAdminSession()

  const [days, setDays] = useState([])
  const [shifts, setShifts] = useState([])
  const [dataLoading, setDataLoading] = useState(true)

  const [edits, setEdits] = useState({})
  const [revenues, setRevenues] = useState({})
  const [approveState, setApproveState] = useState({})
  const [resendState, setResendState] = useState({})

  const [employees, setEmployees] = useState([])
  const [showEmployees, setShowEmployees] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [addState, setAddState] = useState({ loading: false, error: '' })

  const today = new Date().toISOString().slice(0, 10)
  const [showRegister, setShowRegister] = useState(false)
  const [regEmployee, setRegEmployee] = useState('')
  const [regDate, setRegDate] = useState(today)
  const [regStart, setRegStart] = useState('')
  const [regEnd, setRegEnd] = useState('')
  const [regRevenue, setRegRevenue] = useState('')
  const [regState, setRegState] = useState({ loading: false, error: '', done: '' })

  useEffect(() => {
    if (!isAdmin) return
    const unsubDays = onSnapshot(
      query(collection(db, 'bonusDays'), orderBy('date', 'desc')),
      (snap) => {
        setDays(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setDataLoading(false)
      },
      () => setDataLoading(false),
    )
    const unsubShifts = onSnapshot(
      collection(db, 'bonusShifts'),
      (snap) => setShifts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return () => { unsubDays(); unsubShifts() }
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const unsubscribe = onSnapshot(
      collection(db, 'bonusAccess'),
      (snap) => {
        setEmployees(snap.docs.map((d) => ({ phone: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      },
      () => {},
    )
    return unsubscribe
  }, [isAdmin])

  async function onAddEmployee(e) {
    e.preventDefault()
    const phone = normalizePhone(newPhone)
    if (!phone || !/^\d{10,15}$/.test(phone)) { setAddState({ loading: false, error: 'Ugyldig telefonnummer' }); return }
    if (!newName.trim()) { setAddState({ loading: false, error: 'Navn er påkrevd' }); return }
    setAddState({ loading: true, error: '' })
    try {
      await setDoc(doc(db, 'bonusAccess', phone), { name: newName.trim(), email: newEmail.trim() })
      setNewPhone(''); setNewName(''); setNewEmail('')
      setAddState({ loading: false, error: '' })
    } catch (err) {
      setAddState({ loading: false, error: err?.message || 'Noe gikk galt' })
    }
  }

  async function onRemoveEmployee(phone) {
    if (!window.confirm(`Fjerne ${phone} fra bonussystemet?`)) return
    try { await deleteDoc(doc(db, 'bonusAccess', phone)) } catch (err) { alert('Feil: ' + (err?.message || 'Noe gikk galt')) }
  }

  async function onRegisterShift(e) {
    e.preventDefault()
    setRegState({ loading: true, error: '', done: '' })
    try {
      const res = await httpsCallable(functions, 'adminRegisterBonusShift')({
        phone: regEmployee, date: regDate, startTime: regStart, endTime: regEnd, revenueKr: Number(regRevenue),
      })
      const { name, hoursWorked } = res.data
      setRegState({ loading: false, error: '', done: `Vakt registrert for ${name} (${fmtHours(hoursWorked)})` })
      setRegStart(''); setRegEnd(''); setRegRevenue('')
    } catch (err) {
      setRegState({ loading: false, error: err?.message || 'Noe gikk galt', done: '' })
    }
  }

  // Merge days with their shifts; only show non-open days to admin
  const byDay = useMemo(() => {
    return days
      .filter((d) => d.status !== 'open')
      .map((day) => ({
        ...day,
        dayShifts: shifts.filter((s) => s.dayId === day.id),
      }))
  }, [days, shifts])

  function getEdit(id, field) { return edits[id]?.[field] }
  function setEdit(id, field, value) { setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } })) }
  function getEffectiveHours(shift) {
    const override = edits[shift.id]?.hoursWorked
    if (override != null && override !== '') return Number(override)
    return shift.hoursWorked
  }
  function getEffectiveStart(shift) { return edits[shift.id]?.startTime ?? shift.startTime }
  function getEffectiveEnd(shift) { return edits[shift.id]?.endTime ?? shift.endTime }

  async function onApproveDay(dayId, dayData, dayShifts) {
    const pending = dayShifts.filter((s) => s.status !== 'approved')
    if (!pending.length) return

    const rev = revenues[dayId] != null ? Number(revenues[dayId]) : Number(dayData.revenueKr || 0)
    if (!rev) {
      setApproveState((p) => ({ ...p, [dayId]: { loading: false, error: 'Skriv inn godkjent omsetning' } }))
      return
    }

    setApproveState((p) => ({ ...p, [dayId]: { loading: true, error: '' } }))
    const shiftUpdates = pending.map((s) => ({
      id: s.id,
      startTime: edits[s.id]?.startTime || null,
      endTime: edits[s.id]?.endTime || null,
      hoursWorked: (edits[s.id]?.hoursWorked != null && edits[s.id].hoursWorked !== '') ? Number(edits[s.id].hoursWorked) : null,
      adminNote: edits[s.id]?.adminNote || '',
    }))

    try {
      await httpsCallable(functions, 'approveBonusDay')({ dayId, shiftUpdates, approvedRevenue: rev })
      setApproveState((p) => ({ ...p, [dayId]: { loading: false, error: '', done: true } }))
    } catch (err) {
      setApproveState((p) => ({ ...p, [dayId]: { loading: false, error: err?.message || 'Noe gikk galt' } }))
    }
  }

  async function onResend(shiftId) {
    setResendState((p) => ({ ...p, [shiftId]: { loading: true, error: '' } }))
    try {
      await httpsCallable(functions, 'resendBonusEmail')({ shiftId })
      setResendState((p) => ({ ...p, [shiftId]: { loading: false, done: true } }))
    } catch (err) {
      setResendState((p) => ({ ...p, [shiftId]: { loading: false, error: err?.message || 'Feil' } }))
    }
  }

  if (!adminLoading && !isAdmin) {
    return (
      <div className="bonus-admin-bg">
        <div className="bonus-admin-page">
          <div className="bonus-admin-header"><h1>Bonusadmin</h1></div>
          <button type="button" className="bonus-approve-btn" onClick={signIn}>Admin login</button>
          {authError && <p className="bonus-error" style={{ marginTop: 10 }}>{authError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="bonus-admin-bg">
    <div className="bonus-admin-page">
      <div className="bonus-admin-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h1 style={{ margin: 0 }}>Bonusadmin</h1>
          <Link to="/admin" className="bonus-back-btn">← Admin</Link>
        </div>
        <p>Gjennomgå og godkjenn vakter. Ansatte får e-post med bonusinformasjon ved godkjenning.</p>
      </div>

      {/* Employee management */}
      <div className="bonus-employees-section">
        <button type="button" className="bonus-employees-toggle" onClick={() => setShowEmployees((v) => !v)}>
          Ansatte med tilgang ({employees.length})
          <span className="bonus-employees-chevron">{showEmployees ? '▲' : '▼'}</span>
        </button>
        {showEmployees && (
          <div className="bonus-employees-body">
            {employees.length > 0 && (
              <table className="bonus-employees-table">
                <thead><tr><th>Navn</th><th>Telefon</th><th>E-post</th><th></th></tr></thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.phone}>
                      <td>{emp.name}</td>
                      <td className="bonus-emp-phone">+{emp.phone}</td>
                      <td>{emp.email || '—'}</td>
                      <td><button type="button" className="bonus-emp-remove" onClick={() => onRemoveEmployee(emp.phone)}>Fjern</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={onAddEmployee} className="bonus-add-employee-form">
              <p className="bonus-add-employee-title">Legg til ansatt</p>
              <div className="bonus-add-employee-row">
                <input className="bonus-admin-input bonus-admin-input--emp" type="tel" placeholder="Telefon (12345678)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} required />
                <input className="bonus-admin-input bonus-admin-input--emp" type="text" placeholder="Fullt navn" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                <input className="bonus-admin-input bonus-admin-input--emp" type="email" placeholder="E-post (valgfri)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                <button type="submit" className="bonus-approve-btn" disabled={addState.loading}>{addState.loading ? 'Legger til…' : 'Legg til'}</button>
              </div>
              {addState.error && <p className="bonus-error" style={{ margin: '6px 0 0' }}>{addState.error}</p>}
            </form>
          </div>
        )}
      </div>

      {/* Admin shift registration */}
      <div className="bonus-employees-section">
        <button type="button" className="bonus-employees-toggle" onClick={() => setShowRegister((v) => !v)}>
          Registrer vakt for ansatt
          <span className="bonus-employees-chevron">{showRegister ? '▲' : '▼'}</span>
        </button>
        {showRegister && (
          <div className="bonus-employees-body">
            <form onSubmit={onRegisterShift} className="bonus-register-form">
              <div className="bonus-register-row">
                <div className="bonus-field-group">
                  <label className="bonus-admin-label">Ansatt</label>
                  <select className="bonus-admin-input bonus-admin-input--select" value={regEmployee} onChange={(e) => setRegEmployee(e.target.value)} required>
                    <option value="">Velg ansatt…</option>
                    {employees.map((emp) => <option key={emp.phone} value={emp.phone}>{emp.name} (+{emp.phone})</option>)}
                  </select>
                </div>
                <div className="bonus-field-group">
                  <label className="bonus-admin-label">Dato</label>
                  <input className="bonus-admin-input" type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} required />
                </div>
                <div className="bonus-field-group">
                  <label className="bonus-admin-label">Starttid</label>
                  <input className="bonus-admin-input" type="time" value={regStart} onChange={(e) => setRegStart(e.target.value)} required />
                </div>
                <div className="bonus-field-group">
                  <label className="bonus-admin-label">Sluttid</label>
                  <input className="bonus-admin-input" type="time" value={regEnd} onChange={(e) => setRegEnd(e.target.value)} required />
                </div>
                <div className="bonus-field-group">
                  <label className="bonus-admin-label">Omsetning (kr)</label>
                  <input className="bonus-admin-input bonus-admin-input--revenue" type="number" min="0" step="1" placeholder="32 500" value={regRevenue} onChange={(e) => setRegRevenue(e.target.value)} required />
                </div>
                <div className="bonus-field-group bonus-field-group--submit">
                  <label className="bonus-admin-label">&nbsp;</label>
                  <button type="submit" className="bonus-approve-btn" disabled={regState.loading}>{regState.loading ? 'Registrerer…' : 'Registrer'}</button>
                </div>
              </div>
              {regState.error && <p className="bonus-error" style={{ margin: '6px 0 0' }}>{regState.error}</p>}
              {regState.done && <p className="bonus-success-text" style={{ margin: '6px 0 0' }}>✓ {regState.done}</p>}
            </form>
          </div>
        )}
      </div>

      {(adminLoading || dataLoading) && <p style={{ color: '#888' }}>Laster…</p>}
      {!dataLoading && byDay.length === 0 && <p className="bonus-admin-empty">Ingen innsendte registreringer ennå.</p>}

      {byDay.map((day) => {
        const { id: dayId, date, status, revenueKr, dayShifts } = day
        const pending = dayShifts.filter((s) => s.status !== 'approved')
        const currentRevenue = revenues[dayId] != null ? Number(revenues[dayId]) : Number(revenueKr || 0)
        const totalHours = dayShifts.reduce((s, sh) => s + getEffectiveHours(sh), 0)
        const pool = bonusPool(currentRevenue, totalHours)
        const threshold = BONUS_THRESHOLD_RATE * totalHours
        const surplus = currentRevenue - threshold
        const opa = totalHours > 0 ? Math.round(currentRevenue / totalHours) : 0
        const previews = calcPreview(dayShifts.map((sh) => ({ ...sh, hoursWorked: getEffectiveHours(sh) })), currentRevenue)
        const state = approveState[dayId] || {}

        return (
          <div key={dayId} className={`bonus-day-card ${status === 'approved' ? 'bonus-day-card--approved' : ''}`}>
            <div className="bonus-day-header">
              <div>
                <h2 className="bonus-day-date">{fmtDate(date)}</h2>
                <span className="bonus-day-meta">
                  {dayShifts.length} ansatt{dayShifts.length !== 1 ? 'e' : ''} · {fmtHours(totalHours)} totalt
                </span>
              </div>
              <span className={`bonus-day-status bonus-day-status--${status === 'approved' ? 'approved' : 'pending'}`}>
                {status === 'approved' ? 'Godkjent' : 'Venter godkjenning'}
              </span>
            </div>

            <div className="bonus-revenue-row">
              <label className="bonus-admin-label">Godkjent omsetning (kr)</label>
              <input
                className="bonus-admin-input bonus-admin-input--revenue"
                type="number"
                min="0"
                step="100"
                value={revenues[dayId] ?? revenueKr ?? ''}
                onChange={(e) => setRevenues((p) => ({ ...p, [dayId]: e.target.value }))}
                disabled={status === 'approved'}
              />
            </div>

            {/* Formula breakdown */}
            {totalHours > 0 && currentRevenue > 0 && (
              <div className="bonus-formula-breakdown">
                <span className="bonus-breakdown-item">OPA: {fmtKr(opa)} kr/t</span>
                <span className="bonus-breakdown-sep">·</span>
                <span className="bonus-breakdown-item">Terskel: {fmtKr(Math.round(threshold))} kr</span>
                <span className="bonus-breakdown-sep">·</span>
                <span className={`bonus-breakdown-item ${surplus > 0 ? 'bonus-breakdown-item--surplus' : 'bonus-breakdown-item--deficit'}`}>
                  Overskudd: {surplus > 0 ? '+' : ''}{fmtKr(Math.round(surplus))} kr
                </span>
                <span className="bonus-breakdown-sep">·</span>
                <span className="bonus-breakdown-item bonus-breakdown-item--pool">Pott: {fmtKr(Math.round(pool))} kr</span>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="bonus-shifts-table">
                <thead>
                  <tr>
                    <th>Navn</th>
                    <th>Start</th>
                    <th>Slutt</th>
                    <th>Timer</th>
                    <th style={{ textAlign: 'right' }}>Timelønn</th>
                    <th style={{ textAlign: 'right' }}>Bonus</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Notat</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dayShifts.map((shift, i) => {
                    const p = previews[i]
                    const isApproved = shift.status === 'approved'
                    const rs = resendState[shift.id] || {}
                    return (
                      <tr key={shift.id} className={isApproved ? 'bonus-row--approved' : ''}>
                        <td className="bonus-shifts-name">
                          <strong>{shift.name}</strong>
                          <span className="bonus-shifts-phone">{shift.phone}</span>
                          {shift.registeredByAdmin && <span className="bonus-shifts-admin-badge">admin</span>}
                        </td>
                        <td>
                          <input type="time" className="bonus-admin-input" value={getEffectiveStart(shift)} onChange={(e) => setEdit(shift.id, 'startTime', e.target.value)} disabled={isApproved} />
                        </td>
                        <td>
                          <input type="time" className="bonus-admin-input" value={getEffectiveEnd(shift)} onChange={(e) => setEdit(shift.id, 'endTime', e.target.value)} disabled={isApproved} />
                        </td>
                        <td>
                          <input type="number" className="bonus-admin-input bonus-admin-input--hours" step="0.01" value={getEdit(shift.id, 'hoursWorked') ?? shift.hoursWorked} onChange={(e) => setEdit(shift.id, 'hoursWorked', e.target.value)} disabled={isApproved} />
                        </td>
                        <td className="bonus-col-num">{fmtKr(p.basePay)}</td>
                        <td className="bonus-col-num bonus-col-bonus">+{fmtKr(p.bonus)}</td>
                        <td className="bonus-col-num bonus-col-total">{fmtKr(p.total)}</td>
                        <td>
                          <input type="text" className="bonus-admin-input" style={{ width: 120 }} placeholder="Notat" value={getEdit(shift.id, 'adminNote') ?? (shift.adminNote || '')} onChange={(e) => setEdit(shift.id, 'adminNote', e.target.value)} disabled={isApproved} />
                        </td>
                        <td>
                          {isApproved && (
                            <button type="button" className="bonus-resend-btn" onClick={() => onResend(shift.id)} disabled={rs.loading} title="Send e-post på nytt">
                              {rs.loading ? '…' : rs.done ? '✓ Sendt' : rs.error ? '⚠ Feil' : (shift.emailSent ? '✓ Sendt' : 'Send e-post')}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {pending.length > 0 && (
              <div className="bonus-approve-row">
                {state.error && <p className="bonus-error" style={{ margin: 0 }}>{state.error}</p>}
                {state.done
                  ? <p className="bonus-success-text">✓ Godkjent og e-post sendt!</p>
                  : (
                    <button type="button" className="bonus-approve-btn" onClick={() => onApproveDay(dayId, day, dayShifts)} disabled={state.loading}>
                      {state.loading ? 'Godkjenner…' : `Godkjenn ${pending.length} vakt${pending.length !== 1 ? 'er' : ''} og send e-post`}
                    </button>
                  )}
              </div>
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}
