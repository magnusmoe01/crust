import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import './Order.css'

const DAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']

function getOpenWindow(schedule) {
  const now = new Date()
  const slot = schedule?.[String(now.getDay())]
  if (!slot?.open || !slot?.close) return null
  const [openH, openM] = slot.open.split(':').map(Number)
  const [closeH, closeM] = slot.close.split(':').map(Number)
  const nowMins = now.getHours() * 60 + now.getMinutes()
  if (nowMins >= openH * 60 + openM && nowMins < closeH * 60 + closeM) {
    return { open: slot.open, close: slot.close }
  }
  return null
}

export default function Order() {
  const [searchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [locations, setLocations] = useState([])
  const [locationSettings, setLocationSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [cart, setCart] = useState({})
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [step, setStep] = useState('order')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmedOrder, setConfirmedOrder] = useState(null)

  useEffect(() => {
    Promise.allSettled([
      getDoc(doc(db, 'orderConfig', 'default')),
      getDocs(collection(db, 'locations')),
    ])
      .then(([configResult, locsResult]) => {
        if (configResult.status === 'fulfilled' && configResult.value.exists()) {
          const cfg = configResult.value.data()
          setProducts(cfg.products || [])
          setLocationSettings(cfg.locationSettings || {})
        }
        if (locsResult.status === 'fulfilled') {
          const locs = locsResult.value.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
              const oa = typeof a.order === 'number' ? a.order : Infinity
              const ob = typeof b.order === 'number' ? b.order : Infinity
              return oa - ob || String(a.name || '').localeCompare(String(b.name || ''), 'nb')
            })
          setLocations(locs)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const orderId = searchParams.get('orderId')
    const vipps = searchParams.get('vipps')
    if (!orderId || vipps !== 'return') return
    setStep('verifying')
    httpsCallable(functions, 'checkVippsOrder')({ orderId })
      .then(({ data }) => {
        if (data.status === 'paid' || data.status === 'confirmed' || data.status === 'ready') {
          setConfirmedOrder(data)
          setStep('success')
        } else {
          setError('Betaling ikke fullført. Prøv igjen.')
          setStep('order')
        }
      })
      .catch(() => {
        setError('Kunne ikke verifisere betaling. Kontakt oss.')
        setStep('order')
      })
  }, [searchParams])

  const enabledLocations = locations.filter((loc) => loc.orderEnabled)
  const availableLocations = enabledLocations.filter(
    (loc) => getOpenWindow(locationSettings[loc.id]?.schedule),
  )

  const cartItems = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const product = products.find((p) => p.id === id)
      return product ? { ...product, quantity: qty } : null
    })
    .filter(Boolean)

  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)

  function setQty(productId, delta) {
    setCart((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!selectedLocation) { setError('Velg en lokasjon'); return }
    if (cartItems.length === 0) { setError('Legg til minst ett produkt'); return }
    if (!customerName.trim()) { setError('Fyll inn navn'); return }
    if (!customerPhone.trim()) { setError('Fyll inn telefonnummer'); return }
    setError('')
    setSubmitting(true)
    try {
      const { data } = await httpsCallable(functions, 'initiateVippsOrder')({
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        items: cartItems.map(({ id, name, price, quantity }) => ({ id, name, price, quantity })),
        total: cartTotal,
        customerPhone,
        customerName,
      })
      window.location.href = data.redirectUrl
    } catch (err) {
      setError(err.message || 'Kunne ikke starte betaling. Prøv igjen.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="order-page"><p className="order-loading">Laster...</p></div>
  }

  if (step === 'verifying') {
    return (
      <div className="order-page">
        <div className="order-status-box">
          <p className="order-loading">Verifiserer betaling med Vipps...</p>
        </div>
      </div>
    )
  }

  if (step === 'success') {
    return (
      <div className="order-page">
        <div className="order-status-box order-success-box">
          <div className="order-success-icon">✓</div>
          <h2>Bestilling mottatt!</h2>
          <p>Takk, <strong>{confirmedOrder?.customerName || customerName}</strong>!</p>
          <p className="order-success-sub">
            Du får en SMS på {confirmedOrder?.customerPhone || customerPhone} når bestillingen er klar for henting.
          </p>
          <div className="order-success-summary">
            <p>📍 {selectedLocation?.name || ''}</p>
            <p>💰 {confirmedOrder?.total || cartTotal} kr</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="order-page">
      <div className="order-hero">
        <h1>Bestill pizza 🍕</h1>
        <p>Velg lokasjon, velg produkter, betal med Vipps — og vi varsler deg når det er klart!</p>
      </div>

      {availableLocations.length === 0 ? (
        <div className="order-closed-box">
          <h2>Ingen lokasjoner åpne nå</h2>
          {enabledLocations.length > 0 ? (
            <div className="order-closed-schedule">
              <p>Sjekk åpningstidene:</p>
              {enabledLocations.map((loc) => {
                const schedule = locationSettings[loc.id]?.schedule || {}
                return (
                  <div key={loc.id} className="order-closed-location">
                    <strong>{loc.name}</strong>
                    <div className="order-closed-days">
                      {DAYS.map((day, i) => {
                        const s = schedule[String(i)]
                        if (!s?.open || !s?.close) return null
                        return (
                          <span key={i} className="order-closed-day">
                            {day}: {s.open}–{s.close}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="order-closed-sub">Bestilling er ikke tilgjengelig akkurat nå.</p>
          )}
        </div>
      ) : (
        <form className="order-form" onSubmit={onSubmit} noValidate>
          <section className="order-section">
            <h2 className="order-section-title">Velg lokasjon</h2>
            <div className="order-location-grid">
              {availableLocations.map((loc) => {
                const win = getOpenWindow(locationSettings[loc.id]?.schedule)
                return (
                  <button
                    key={loc.id}
                    type="button"
                    className={`order-location-card${selectedLocation?.id === loc.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedLocation(loc)}
                  >
                    <span className="order-location-name">{loc.name}</span>
                    {win ? (
                      <span className="order-location-time">Åpent til {win.close}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="order-section">
            <h2 className="order-section-title">Velg produkter</h2>
            {products.filter((p) => p.available).length === 0 ? (
              <p className="order-empty">Ingen produkter tilgjengelig.</p>
            ) : (
              <div className="order-product-list">
                {products.filter((p) => p.available).map((product) => (
                  <div key={product.id} className="order-product-row">
                    <div className="order-product-info">
                      <p className="order-product-name">{product.name}</p>
                      {product.description ? (
                        <p className="order-product-desc">{product.description}</p>
                      ) : null}
                      <p className="order-product-price">{product.price} kr</p>
                    </div>
                    <div className="order-product-qty">
                      <button
                        type="button"
                        className="order-qty-btn"
                        onClick={() => setQty(product.id, -1)}
                        disabled={!cart[product.id]}
                        aria-label="Fjern en"
                      >−</button>
                      <span className="order-qty-count">{cart[product.id] || 0}</span>
                      <button
                        type="button"
                        className="order-qty-btn"
                        onClick={() => setQty(product.id, 1)}
                        aria-label="Legg til en"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {cartItems.length > 0 ? (
            <div className="order-cart">
              <h3 className="order-cart-title">Handlekurv</h3>
              {cartItems.map((item) => (
                <div key={item.id} className="order-cart-row">
                  <span>{item.quantity}× {item.name}</span>
                  <span>{item.price * item.quantity} kr</span>
                </div>
              ))}
              <div className="order-cart-total">
                <span>Totalt</span>
                <span>{cartTotal} kr</span>
              </div>
            </div>
          ) : null}

          <section className="order-section">
            <h2 className="order-section-title">Kontaktinfo</h2>
            <p className="order-section-sub">Du får SMS-bekreftelse og varsel om henting.</p>
            <div className="order-fields">
              <label className="order-field">
                <span>Navn</span>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ditt navn"
                  autoComplete="name"
                />
              </label>
              <label className="order-field">
                <span>Mobilnummer</span>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="12345678"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </label>
            </div>
          </section>

          {error ? <p className="order-error">{error}</p> : null}

          <div className="order-submit-row">
            <button
              type="submit"
              className="order-vipps-btn"
              disabled={submitting || cartItems.length === 0 || !selectedLocation}
            >
              {submitting ? (
                'Starter Vipps...'
              ) : (
                <>
                  <span className="order-vipps-logo">V</span>
                  Betal {cartTotal > 0 ? `${cartTotal} kr` : ''} med Vipps
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
