import { useState, useEffect, useRef } from 'react'
import {
  collection, query, where, onSnapshot, doc,
  updateDoc, serverTimestamp, orderBy, getDoc,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import './Order.css'

const ALERT_MINUTES = 2
const STORAGE_KEY = 'worker_session'
const DAY_KEY = 'worker_day'

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function saveSession(pin, locationId, locationName) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pin, locationId, locationName }))
}

function loadDayStarted() {
  try {
    return localStorage.getItem(DAY_KEY) === todayStr()
  } catch {
    return false
  }
}

function saveDayStarted() {
  try { localStorage.setItem(DAY_KEY, todayStr()) } catch {}
}

function msTillMidnight() {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return midnight - now
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

function ageLabel(createdAt, now) {
  const ms = now - (createdAt?.toMillis?.() || now)
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'akkurat nå'
  if (min === 1) return '1 min siden'
  return `${min} min siden`
}

function timeHM(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

function minutesBetween(from, to) {
  if (!from || !to) return null
  const a = from.toMillis ? from.toMillis() : Number(from)
  const b = to.toMillis ? to.toMillis() : Number(to)
  return Math.round((b - a) / 60000)
}

function isToday(createdAt) {
  if (!createdAt) return false
  const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const t = ctx.currentTime
    // Two-tone ding: high then lower
    const tones = [{ freq: 880, start: t, dur: 0.18 }, { freq: 660, start: t + 0.22, dur: 0.28 }]
    for (const { freq, start, dur } of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.55, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + dur)
    }
    setTimeout(() => ctx.close(), 1000)
  } catch {}
}

export default function OrderDashboard() {
  const saved = loadSession()
  const [pin, setPin] = useState(saved?.pin || '')
  const [locationId, setLocationId] = useState(saved?.locationId || null)
  const [locationName, setLocationName] = useState(saved?.locationName || '')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [dayStarted, setDayStarted] = useState(loadDayStarted)
  const [paused, setPaused] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('active')
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [actionState, setActionState] = useState({})
  const alertedRef = useRef(new Set())
  const seenIdsRef = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      setDayStarted(false)
      seenIdsRef.current = null
      setOrders([])
      setOrdersLoading(true)
    }, msTillMidnight())
    return () => clearTimeout(t)
  }, [])

  async function onPinSubmit(e) {
    e.preventDefault()
    setPinError('')
    setPinLoading(true)
    try {
      const snap = await getDoc(doc(db, 'orderConfig', 'default'))
      const locSettings = snap.data()?.locationSettings || {}
      const enteredPin = String(pinInput).trim()
      const matchedLocId = Object.entries(locSettings).find(
        ([, s]) => s.workerPin && String(s.workerPin) === enteredPin,
      )?.[0]
      if (matchedLocId) {
        const locSnap = await getDoc(doc(db, 'locations', matchedLocId))
        const name = locSnap.exists() ? (locSnap.data().name || matchedLocId) : matchedLocId
        setPin(enteredPin)
        setLocationId(matchedLocId)
        setLocationName(name)
        saveSession(enteredPin, matchedLocId, name)
      } else {
        setPinError('Feil PIN. Prøv igjen.')
      }
    } catch {
      setPinError('Kunne ikke verifisere PIN. Sjekk tilkobling.')
    } finally {
      setPinLoading(false)
    }
  }

  useEffect(() => {
    if (!locationId) return
    return onSnapshot(doc(db, 'orderConfig', 'default'), (snap) => {
      const locSettings = snap.data()?.locationSettings || {}
      setPaused(Boolean(locSettings[locationId]?.paused))
    })
  }, [locationId])

  async function onTogglePause() {
    setPauseLoading(true)
    try {
      await httpsCallable(functions, 'toggleLocationPause')({ workerPin: pin, paused: !paused })
    } catch (err) {
      console.error('toggleLocationPause failed', err)
    } finally {
      setPauseLoading(false)
    }
  }

  useEffect(() => {
    if (!pin || !locationId || !dayStarted) return
    const q = query(
      collection(db, 'orders'),
      where('locationId', '==', locationId),
      where('status', 'in', ['paid', 'confirmed', 'ready']),
      orderBy('createdAt', 'asc'),
    )
    return onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

      if (seenIdsRef.current === null) {
        // First snapshot — mark all existing orders as seen, no sound
        seenIdsRef.current = new Set(docs.map((d) => d.id))
      } else {
        // Subsequent snapshots — play sound for new paid orders
        const hasNew = docs.some(
          (d) => d.status === 'paid' && !seenIdsRef.current.has(d.id)
        )
        if (hasNew) playNotification()
        for (const d of docs) seenIdsRef.current.add(d.id)
      }

      setOrders(docs)
      setOrdersLoading(false)
    }, (err) => {
      setOrdersLoading(false)
      console.error('Orders query failed:', err)
    })
  }, [pin, locationId, dayStarted])

  useEffect(() => {
    if (!pin) return
    for (const order of orders) {
      if (order.status !== 'paid') continue
      if (order.alertSent) continue
      if (alertedRef.current.has(order.id)) continue
      const ageMs = now - (order.createdAt?.toMillis?.() || now)
      if (ageMs >= ALERT_MINUTES * 60 * 1000) {
        alertedRef.current.add(order.id)
        httpsCallable(functions, 'sendUnconfirmedOrderAlert')({ orderId: order.id, workerPin: pin })
          .catch(console.error)
      }
    }
  }, [now, orders, pin])

  function setOrderAction(orderId, state) {
    setActionState((prev) => ({ ...prev, [orderId]: { ...prev[orderId], ...state } }))
  }

  async function onConfirm(order) {
    setOrderAction(order.id, { confirming: true, error: '' })
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        status: 'confirmed',
        confirmedAt: serverTimestamp(),
      })
      setOrderAction(order.id, { confirming: false })
    } catch {
      setOrderAction(order.id, { confirming: false, error: 'Kunne ikke bekrefte.' })
    }
  }

  async function onReady(order) {
    setOrderAction(order.id, { readying: true, error: '' })
    try {
      await httpsCallable(functions, 'sendOrderReadySms')({ orderId: order.id, workerPin: pin })
      setOrderAction(order.id, { readying: false, readySent: true })
    } catch {
      setOrderAction(order.id, { readying: false, error: 'Kunne ikke varsle kunde.' })
    }
  }

  if (!pin) {
    return (
      <div className="worker-page">
        <div className="worker-pin-box">
          <h1 className="worker-pin-title">Arbeidsdashboard</h1>
          <p className="worker-pin-sub">Logg inn med PIN-koden din.</p>

          <form onSubmit={onPinSubmit} className="worker-pin-form">
            <label className="order-field">
              <span>PIN-kode</span>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••"
                autoFocus
                inputMode="numeric"
              />
            </label>
            {pinError ? <p className="order-error">{pinError}</p> : null}
            <button type="submit" className="order-btn" disabled={pinLoading || !pinInput}>
              {pinLoading ? 'Sjekker...' : 'Logg inn'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (!dayStarted) {
    const now = new Date()
    const dateLabel = now.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
    return (
      <div className="worker-page">
        <div className="worker-pin-box">
          <h1 className="worker-pin-title">God dag!</h1>
          <p className="worker-pin-sub">📍 {locationName}</p>
          <p className="worker-day-date">{dateLabel}</p>
          <button
            type="button"
            className="order-btn worker-start-day-btn"
            onClick={() => { saveDayStarted(); setDayStarted(true) }}
          >
            Start ny dag
          </button>
          <button
            type="button"
            className="worker-logout"
            style={{ marginTop: 16 }}
            onClick={() => { clearSession(); setPin(''); setLocationId(null); setLocationName('') }}
          >
            Logg ut
          </button>
        </div>
      </div>
    )
  }

  const pendingOrders = orders.filter((o) => o.status === 'paid')
  const confirmedOrders = orders.filter((o) => o.status === 'confirmed')
  const readyOrders = orders.filter((o) => o.status === 'ready' && isToday(o.createdAt))
  const activeCount = pendingOrders.length + confirmedOrders.length

  return (
    <div className="worker-page">
      <div className="worker-header">
        <div>
          <h1 className="worker-title">
            Bestillinger
            <span className="worker-clock">{new Date(now).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>
          </h1>
          <p className="worker-subtitle">📍 {locationName}</p>
        </div>
        <div className="worker-header-actions">
          <button
            type="button"
            className={`worker-pause-btn${paused ? ' is-paused' : ''}`}
            onClick={onTogglePause}
            disabled={pauseLoading}
          >
            {paused ? '▶ Gjenoppta' : '⏸ Pause'}
          </button>
          <button
            type="button"
            className="worker-logout"
            onClick={() => { clearSession(); setPin(''); setPinInput(''); setLocationId(null); setLocationName('') }}
          >
            Logg ut
          </button>
        </div>
      </div>

      {paused ? (
        <div className="worker-pause-banner">
          ⏸ Bestillinger er satt på pause — kunder kan ikke bestille akkurat nå
        </div>
      ) : null}

      <div className="worker-tabs">
        <button
          type="button"
          className={`worker-tab${activeTab === 'active' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          Aktive bestillinger
          {activeCount > 0 ? <span className="worker-tab-badge">{activeCount}</span> : null}
        </button>
        <button
          type="button"
          className={`worker-tab${activeTab === 'done' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('done')}
        >
          Fullført i dag
          {readyOrders.length > 0 ? <span className="worker-tab-badge worker-tab-badge--done">{readyOrders.length}</span> : null}
        </button>
      </div>

      {activeTab === 'active' ? (
        <>
          {ordersLoading ? (
            <p className="worker-tab-empty">Laster...</p>
          ) : activeCount === 0 ? (
            <p className="worker-tab-empty">Ingen aktive bestillinger akkurat nå.</p>
          ) : null}

          {pendingOrders.length > 0 ? (
            <div className="worker-section">
              <h2 className="worker-section-title worker-section--pending">
                Venter bekreftelse
                <span className="worker-section-badge">{pendingOrders.length}</span>
              </h2>
              <div className="worker-order-list">
                {pendingOrders.map((order) => {
                  const ageMs = now - (order.createdAt?.toMillis?.() || now)
                  const isUrgent = ageMs >= ALERT_MINUTES * 60 * 1000
                  const state = actionState[order.id] || {}
                  return (
                    <div key={order.id} className={`worker-order-row${isUrgent ? ' is-urgent' : ''}`}>
                      <span className="worker-row-age">{ageLabel(order.createdAt, now)}</span>
                      <span className="worker-row-name">{order.customerName}</span>
                      <span className="worker-row-items">
                        {(order.items || []).map((item, i) => (
                          <span key={i}>{item.quantity}× {item.name}</span>
                        ))}
                      </span>
                      <span className="worker-row-actions">
                        {state.error ? <span className="worker-row-error">{state.error}</span> : null}
                        <button
                          type="button"
                          className="worker-confirm-btn"
                          onClick={() => onConfirm(order)}
                          disabled={state.confirming}
                        >
                          {state.confirming ? '...' : '✓ Bekreft'}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {confirmedOrders.length > 0 ? (
            <div className="worker-section">
              <h2 className="worker-section-title worker-section--confirmed">
                Under tilberedning
                <span className="worker-section-badge">{confirmedOrders.length}</span>
              </h2>
              <div className="worker-order-list">
                {confirmedOrders.map((order) => {
                  const state = actionState[order.id] || {}
                  return (
                    <div key={order.id} className="worker-order-row is-confirmed">
                      <span className="worker-row-age">{ageLabel(order.createdAt, now)}</span>
                      <span className="worker-row-name">{order.customerName}</span>
                      <span className="worker-row-items">
                        {(order.items || []).map((item, i) => (
                          <span key={i}>{item.quantity}× {item.name}</span>
                        ))}
                      </span>
                      <span className="worker-row-actions">
                        {state.error ? <span className="worker-row-error">{state.error}</span> : null}
                        {state.readySent ? (
                          <span className="worker-ready-sent">✓ Varslet</span>
                        ) : (
                          <button
                            type="button"
                            className="worker-ready-btn"
                            onClick={() => onReady(order)}
                            disabled={state.readying}
                          >
                            {state.readying ? '...' : '🍕 Klar'}
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {readyOrders.length === 0 ? (
            <p className="worker-tab-empty">Ingen fullførte bestillinger i dag ennå.</p>
          ) : (
            <div className="worker-order-list">
              {readyOrders.map((order) => {
                const mins = minutesBetween(order.createdAt, order.readyAt)
                return (
                  <div key={order.id} className="worker-order-row is-ready">
                    <span className="worker-row-name">{order.customerName}</span>
                    <span className="worker-row-items">
                      {(order.items || []).map((item, i) => (
                        <span key={i}>{item.quantity}× {item.name}</span>
                      ))}
                    </span>
                    <span className="worker-row-times">
                      <span className="worker-row-phone-sm">{order.customerPhone}</span>
                      <span title="Bestilt">{timeHM(order.createdAt)}</span>
                      <span className="worker-row-times-sep">→</span>
                      <span title="Levert">{timeHM(order.readyAt)}</span>
                      {mins !== null ? <span className="worker-row-duration">{mins} min</span> : null}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
