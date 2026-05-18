import { useState, useEffect, useRef } from 'react'
import {
  collection, query, where, onSnapshot, doc,
  updateDoc, serverTimestamp, orderBy, getDoc,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import './Order.css'

const ALERT_MINUTES = 2

export default function OrderDashboard() {
  const [pin, setPin] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [now, setNow] = useState(Date.now())
  const [actionState, setActionState] = useState({})
  const alertedRef = useRef(new Set())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  async function onPinSubmit(e) {
    e.preventDefault()
    setPinError('')
    setPinLoading(true)
    try {
      const snap = await getDoc(doc(db, 'orderConfig', 'default'))
      const storedPin = String(snap.data()?.workerPin || '')
      if (storedPin && storedPin === String(pinInput).trim()) {
        setPin(pinInput.trim())
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
    if (!pin) return
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', ['paid', 'confirmed']),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
  }, [pin])

  // Fire alert for unconfirmed orders older than ALERT_MINUTES
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
    } catch (err) {
      setOrderAction(order.id, { confirming: false, error: 'Kunne ikke bekrefte.' })
    }
  }

  async function onReady(order) {
    setOrderAction(order.id, { readying: true, error: '' })
    try {
      await httpsCallable(functions, 'sendOrderReadySms')({ orderId: order.id, workerPin: pin })
      setOrderAction(order.id, { readying: false, readySent: true })
    } catch (err) {
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

  const pendingOrders = orders.filter((o) => o.status === 'paid')
  const confirmedOrders = orders.filter((o) => o.status === 'confirmed')

  return (
    <div className="worker-page">
      <div className="worker-header">
        <div>
          <h1 className="worker-title">Bestillinger</h1>
          <p className="worker-subtitle">
            {pendingOrders.length > 0
              ? `${pendingOrders.length} venter bekreftelse`
              : 'Ingen venter bekreftelse'}
          </p>
        </div>
        <button type="button" className="worker-logout" onClick={() => { setPin(''); setPinInput('') }}>
          Logg ut
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="worker-empty">
          <p>🍕 Ingen aktive bestillinger akkurat nå.</p>
        </div>
      ) : null}

      {pendingOrders.length > 0 ? (
        <div className="worker-section">
          <h2 className="worker-section-title worker-section--pending">
            Venter bekreftelse
            <span className="worker-section-badge">{pendingOrders.length}</span>
          </h2>
          <div className="worker-order-grid">
            {pendingOrders.map((order) => {
              const ageMs = now - (order.createdAt?.toMillis?.() || now)
              const ageSec = Math.floor(ageMs / 1000)
              const ageMin = Math.floor(ageSec / 60)
              const ageSecs = ageSec % 60
              const isUrgent = ageMs >= ALERT_MINUTES * 60 * 1000
              const state = actionState[order.id] || {}

              return (
                <article key={order.id} className={`worker-order-card${isUrgent ? ' is-urgent' : ''}`}>
                  <div className="worker-order-header">
                    <div>
                      <p className="worker-order-name">{order.customerName}</p>
                      <p className="worker-order-location">📍 {order.locationName}</p>
                    </div>
                    <div className="worker-order-timer-wrap">
                      <span className={`worker-order-timer${isUrgent ? ' is-urgent' : ''}`}>
                        {ageMin}:{String(ageSecs).padStart(2, '0')}
                      </span>
                    </div>
                  </div>

                  <ul className="worker-order-items">
                    {(order.items || []).map((item, i) => (
                      <li key={i}>{item.quantity}× {item.name}</li>
                    ))}
                  </ul>

                  <div className="worker-order-footer">
                    <p className="worker-order-total">{order.total} kr</p>
                    <p className="worker-order-phone">{order.customerPhone}</p>
                  </div>

                  {isUrgent ? (
                    <p className="worker-urgent-note">⚠️ Varsling sendt til butikk</p>
                  ) : null}

                  {state.error ? <p className="order-error">{state.error}</p> : null}

                  <button
                    type="button"
                    className="worker-confirm-btn"
                    onClick={() => onConfirm(order)}
                    disabled={state.confirming}
                  >
                    {state.confirming ? 'Bekrefter...' : '✓ Bekreft bestilling'}
                  </button>
                </article>
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
          <div className="worker-order-grid">
            {confirmedOrders.map((order) => {
              const state = actionState[order.id] || {}
              return (
                <article key={order.id} className="worker-order-card is-confirmed">
                  <div className="worker-order-header">
                    <div>
                      <p className="worker-order-name">{order.customerName}</p>
                      <p className="worker-order-location">📍 {order.locationName}</p>
                    </div>
                    <span className="worker-confirmed-badge">Bekreftet</span>
                  </div>

                  <ul className="worker-order-items">
                    {(order.items || []).map((item, i) => (
                      <li key={i}>{item.quantity}× {item.name}</li>
                    ))}
                  </ul>

                  <div className="worker-order-footer">
                    <p className="worker-order-total">{order.total} kr</p>
                    <p className="worker-order-phone">{order.customerPhone}</p>
                  </div>

                  {state.error ? <p className="order-error">{state.error}</p> : null}
                  {state.readySent ? <p className="worker-ready-sent">✓ Kunde varslet!</p> : null}

                  {!state.readySent ? (
                    <button
                      type="button"
                      className="worker-ready-btn"
                      onClick={() => onReady(order)}
                      disabled={state.readying}
                    >
                      {state.readying ? 'Sender varsel...' : '🍕 Klar — varsle kunde'}
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
