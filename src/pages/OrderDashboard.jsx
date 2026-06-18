import { useState, useEffect, useRef } from 'react'
import {
  collection, query, where, onSnapshot, doc,
  updateDoc, serverTimestamp, orderBy, getDoc, addDoc,
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

let sharedAudioCtx = null

function getAudioContext() {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return sharedAudioCtx
}

function unlockAudio() {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
  } catch {}
}

function playNotification() {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => playNotification())
      return
    }
    const t = ctx.currentTime

    function addNote(freq, at, dur, vol = 0.45) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.001, at)
      gain.gain.linearRampToValueAtTime(vol, at + 0.015)
      gain.gain.setValueAtTime(vol, at + dur - 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, at + dur + 0.08)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + dur + 0.1)
    }

    addNote(1319, t + 0.00, 0.12, 0.55)
    addNote(1047, t + 0.18, 0.28, 0.50)
    addNote(880,  t + 0.41, 0.28, 0.45)
    addNote(784,  t + 0.64, 0.28, 0.45)
    addNote(659,  t + 0.87, 0.28, 0.40)
    addNote(784,  t + 1.10, 0.28, 0.42)
    addNote(880,  t + 1.33, 0.28, 0.44)
    addNote(1047, t + 1.56, 0.20, 0.50)
    addNote(1319, t + 1.76, 0.10, 0.52)
    addNote(1047, t + 1.90, 0.28, 0.48)
    addNote(880,  t + 2.13, 0.28, 0.44)
    addNote(784,  t + 2.36, 0.28, 0.42)
    addNote(659,  t + 2.59, 0.70, 0.38)
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
  const [audioCheck, setAudioCheck] = useState('idle') // 'idle' | 'played' | 'confirmed' | 'failed'
  const [activeTab, setActiveTab] = useState('active')
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productToggling, setProductToggling] = useState({})
  const [walkinOpen, setWalkinOpen] = useState(false)
  const [walkinName, setWalkinName] = useState('')
  const [walkinPhone, setWalkinPhone] = useState('')
  const [walkinCart, setWalkinCart] = useState({})
  const [walkinState, setWalkinState] = useState({ saving: false, error: '' })
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
      const data = snap.data() || {}
      const locSettings = data.locationSettings || {}
      setPaused(Boolean(locSettings[locationId]?.paused))
    })
  }, [locationId])

  useEffect(() => {
    if ((!walkinOpen && activeTab !== 'products') || !pin) return
    setProductsLoading(true)
    getDoc(doc(db, 'orderConfig', 'default'))
      .then((snap) => { setProducts(snap.exists() ? snap.data()?.products || [] : []) })
      .catch(() => {})
      .finally(() => setProductsLoading(false))
  }, [activeTab, walkinOpen, pin])

  async function onToggleProduct(productId) {
    setProductToggling((prev) => ({ ...prev, [productId]: true }))
    try {
      const snap = await getDoc(doc(db, 'orderConfig', 'default'))
      const current = snap.data()?.products || []
      const updated = current.map((p) =>
        p.id === productId ? { ...p, available: p.available === false ? true : false } : p
      )
      await updateDoc(doc(db, 'orderConfig', 'default'), { products: updated })
      setProducts(updated)
    } catch (err) {
      console.error('Could not toggle product', err)
    } finally {
      setProductToggling((prev) => ({ ...prev, [productId]: false }))
    }
  }

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

  async function onSubmitWalkin(e) {
    e.preventDefault()
    const name = walkinName.trim()
    if (!name) { setWalkinState({ saving: false, error: 'Fyll inn navn.' }); return }
    const items = products
      .filter((p) => walkinCart[p.id] > 0)
      .map((p) => ({ id: p.id, name: p.name, price: p.price || 0, quantity: walkinCart[p.id] }))
    if (items.length === 0) { setWalkinState({ saving: false, error: 'Legg til minst ett produkt.' }); return }
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
    setWalkinState({ saving: true, error: '' })
    try {
      await addDoc(collection(db, 'orders'), {
        locationId,
        locationName,
        items,
        total,
        customerName: name,
        customerPhone: walkinPhone.trim() || '',
        status: 'confirmed',
        walkin: true,
        alertSent: true,
        createdAt: serverTimestamp(),
      })
      setWalkinOpen(false)
      setWalkinName('')
      setWalkinPhone('')
      setWalkinCart({})
      setWalkinState({ saving: false, error: '' })
    } catch (err) {
      setWalkinState({ saving: false, error: 'Kunne ikke legge inn bestilling.' })
    }
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
    const audioConfirmed = audioCheck === 'confirmed'
    return (
      <div className="worker-page">
        <div className="worker-pin-box">
          <div className="worker-pin-box-header">
            <h1 className="worker-pin-title">📍 {locationName}</h1>
            <button
              type="button"
              className="worker-logout"
              onClick={() => { clearSession(); setPin(''); setLocationId(null); setLocationName('') }}
            >
              Logg ut
            </button>
          </div>
          <p className="worker-pin-sub">God dag! · {dateLabel}</p>

          <div className="worker-audio-check">
            <p className="worker-audio-check-title">🔊 Test lyden før du starter</p>
            <p className="worker-audio-check-sub">Du må høre varsler når nye bestillinger kommer inn.</p>

            {audioCheck === 'idle' || audioCheck === 'failed' ? (
              <>
                {audioCheck === 'failed' ? (
                  <p className="worker-audio-check-warning">
                    Skru av stillemodus og sett volumet til maks, prøv igjen.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="order-btn worker-audio-test-btn"
                  onClick={() => {
                    unlockAudio()
                    playNotification()
                    setAudioCheck('played')
                  }}
                >
                  Spill av testlyd
                </button>
              </>
            ) : audioCheck === 'played' ? (
              <>
                <label className="worker-audio-confirm-label">
                  <input
                    type="checkbox"
                    onChange={(e) => { unlockAudio(); setAudioCheck(e.target.checked ? 'confirmed' : 'played') }}
                  />
                  <span>Jeg hørte lyden og den er høy nok til at jeg hører det når det kommer inn en bestilling</span>
                </label>
                <button
                  type="button"
                  className="worker-audio-retry-btn"
                  onClick={() => playNotification()}
                >
                  Test på nytt
                </button>
              </>
            ) : (
              <p className="worker-audio-check-ok">✓ Lyden er bekreftet</p>
            )}
          </div>

          <button
            type="button"
            className="order-btn worker-start-day-btn"
            disabled={!audioConfirmed}
            onClick={() => { unlockAudio(); saveDayStarted(); setDayStarted(true) }}
          >
            Start ny dag
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
    <>
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
          {!paused ? (
            <span className="worker-open-status">✓ Du er åpent for bestillinger</span>
          ) : null}
          <button
            type="button"
            className="worker-pause-btn worker-walkin-btn"
            onClick={() => { setWalkinOpen(true); setWalkinState({ saving: false, error: '' }) }}
          >
            + Kassabestilling
          </button>
          <button
            type="button"
            className={`worker-pause-btn${paused ? ' is-paused' : ''}`}
            onClick={onTogglePause}
            disabled={pauseLoading}
          >
            {paused ? '▶ Gjenoppta' : '⏸ Sett på pause'}
          </button>
          <button
            type="button"
            className="worker-logout"
            onClick={() => playNotification()}
          >
            🔊 Test lyd
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
        <button
          type="button"
          className={`worker-tab${activeTab === 'products' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Rediger produkter
          {products.some((p) => p.available === false) ? (
            <span className="worker-tab-badge worker-tab-badge--warn">!</span>
          ) : null}
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
                  const remainingMs = Math.max(0, ALERT_MINUTES * 60 * 1000 - ageMs)
                  const remainingSec = Math.ceil(remainingMs / 1000)
                  const remainingMin = Math.floor(remainingSec / 60)
                  const remainingSecPart = remainingSec % 60
                  const countdownLabel = remainingSec > 0
                    ? `${remainingMin}:${String(remainingSecPart).padStart(2, '0')}`
                    : null
                  const state = actionState[order.id] || {}
                  return (
                    <div key={order.id} className={`worker-order-row${isUrgent ? ' is-urgent' : ''}`}>
                      <span className="worker-row-age">
                        {ageLabel(order.createdAt, now)}
                        {isUrgent ? <span className="worker-row-age-alert"> – daglig leder varslet</span> : null}
                      </span>
                      <span className="worker-row-name">{order.customerName}</span>
                      <span className="worker-row-items">
                        {(order.items || []).map((item, i) => (
                          <span key={i}>{item.quantity}× {item.name}</span>
                        ))}
                      </span>
                      {order.customerNote ? (
                        <span className="worker-row-note">📝 {order.customerNote}</span>
                      ) : null}
                      <span className="worker-row-actions">
                        {state.error ? <span className="worker-row-error">{state.error}</span> : null}
                        <div className="worker-confirm-group">
                          {countdownLabel ? (
                            <span className="worker-confirm-countdown">
                              Må bekreftes innen {countdownLabel} før daglig leder varsles
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="worker-confirm-btn"
                            onClick={() => onConfirm(order)}
                            disabled={state.confirming}
                          >
                            {state.confirming ? '...' : '✓ Bekreft'}
                          </button>
                        </div>
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
                      {order.customerNote ? (
                        <span className="worker-row-note">📝 {order.customerNote}</span>
                      ) : null}
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
                            {state.readying ? '...' : '🍕 Marker som klar'}
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
      ) : activeTab === 'products' ? (
        <div className="worker-products">
          {productsLoading ? (
            <p className="worker-tab-empty">Laster produkter...</p>
          ) : products.length === 0 ? (
            <p className="worker-tab-empty">Ingen produkter funnet.</p>
          ) : (
          <>
          {products.some((p) => p.available === false) ? (
            <div className="worker-products-warning">
              ⚠ Noen produkter er deaktivert — husk å skru de på igjen når de er tilbake på lager!
            </div>
          ) : null}
          <div className="worker-products-list">
            {products.map((product) => {
              const isAvailable = product.available !== false
              return (
                <div
                  key={product.id}
                  className={`worker-product-row${!isAvailable ? ' is-unavailable' : ''}`}
                >
                  <div className="worker-product-info">
                    <span className="worker-product-name">{product.name}</span>
                    {!isAvailable ? (
                      <span className="worker-product-badge">Deaktivert</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={`worker-product-toggle${isAvailable ? ' is-on' : ' is-off'}`}
                    onClick={() => onToggleProduct(product.id)}
                    disabled={productToggling[product.id]}
                  >
                    {isAvailable ? 'Deaktiver' : 'Aktiver'}
                  </button>
                </div>
              )
            })}
          </div>
          </>
          )}
        </div>
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

    {walkinOpen ? (

      <div className="worker-modal-overlay" onClick={() => setWalkinOpen(false)}>
        <div className="worker-modal" onClick={(e) => e.stopPropagation()}>
          <div className="worker-modal-header">
            <h2 className="worker-modal-title">Kassabestilling</h2>
            <button type="button" className="worker-logout" onClick={() => setWalkinOpen(false)}>Lukk</button>
          </div>
          <form onSubmit={onSubmitWalkin} className="worker-modal-form">
            <label className="order-field">
              <span>Navn *</span>
              <input
                type="text"
                value={walkinName}
                onChange={(e) => setWalkinName(e.target.value)}
                placeholder="Kundens navn"
                autoFocus
              />
            </label>
            <label className="order-field">
              <span>Telefon (valgfritt)</span>
              <input
                type="tel"
                value={walkinPhone}
                onChange={(e) => setWalkinPhone(e.target.value)}
                placeholder="8 siffer"
                inputMode="numeric"
              />
            </label>
            <div className="worker-walkin-products">
              <p className="worker-walkin-products-label">Produkter *</p>
              {products.filter((p) => p.available !== false).map((p) => {
                const qty = walkinCart[p.id] || 0
                return (
                  <div key={p.id} className="worker-walkin-product-row">
                    <span className="worker-walkin-product-name">{p.name}</span>
                    <div className="worker-product-qty">
                      <button type="button" className="worker-qty-btn" onClick={() => setWalkinCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] || 0) - 1) }))}>−</button>
                      <span className="worker-qty-val">{qty}</span>
                      <button type="button" className="worker-qty-btn" onClick={() => setWalkinCart((c) => ({ ...c, [p.id]: (c[p.id] || 0) + 1 }))}>+</button>
                    </div>
                  </div>
                )
              })}
            </div>
            {walkinState.error ? <p className="worker-walkin-error">{walkinState.error}</p> : null}
            <button type="submit" className="order-btn" disabled={walkinState.saving} style={{ width: '100%', marginTop: 8 }}>
              {walkinState.saving ? 'Legger inn...' : 'Legg inn i kø'}
            </button>
          </form>
        </div>
      </div>
    ) : null}
    </>
  )
}
