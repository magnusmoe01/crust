import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import vippsLogo from '../assets/vipps-logo.svg'
import './Order.css'

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

function getLocationOpen(locSettings) {
  const override = locSettings?.openOverride
  if (override === 'open') return { forced: true }
  if (override === 'closed') return null
  return getOpenWindow(locSettings?.schedule)
}

export default function Order() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [productTypes, setProductTypes] = useState([])
  const [combos, setCombos] = useState([])
  const [locations, setLocations] = useState([])
  const [locationSettings, setLocationSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [cart, setCart] = useState({})
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [step, setStep] = useState('order')
  const [formStep, setFormStep] = useState(1)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmedOrder, setConfirmedOrder] = useState(null)
  const [comboPick, setComboPick] = useState(null)

  useEffect(() => {
    document.body.classList.add('order-bg')
    document.documentElement.style.overflowX = 'hidden'
    return () => {
      document.body.classList.remove('order-bg')
      document.documentElement.style.overflowX = ''
    }
  }, [])

  useEffect(() => {
    Promise.allSettled([
      getDoc(doc(db, 'orderConfig', 'default')),
      getDocs(collection(db, 'locations')),
    ])
      .then(([configResult, locsResult]) => {
        if (configResult.status === 'fulfilled' && configResult.value.exists()) {
          const cfg = configResult.value.data()
          setProducts(cfg.products || [])
          setProductTypes(cfg.productTypes || [])
          setCombos(cfg.combos || [])
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
          setError(`Status fra Vipps: ${data.status || 'ukjent'}`)
          setStep('failed')
        }
      })
      .catch((err) => {
        setError(err?.message || 'Ukjent feil ved verifisering av betaling.')
        setStep('failed')
      })
  }, [searchParams])

  const enabledLocations = locations.filter((loc) => loc.orderEnabled)
  const availableLocations = enabledLocations.filter(
    (loc) => getLocationOpen(locationSettings[loc.id]) && !locationSettings[loc.id]?.paused,
  )

  const cartItems = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const product = products.find((p) => p.id === id)
      return product ? { ...product, quantity: qty } : null
    })
    .filter(Boolean)

  const cartSubtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)

  function comboTypeCounts(combo) {
    const m = {}
    for (const id of combo.typeIds) m[id] = (m[id] || 0) + 1
    return m
  }

  function comboNormalCost(combo, items) {
    const counts = comboTypeCounts(combo)
    return Object.entries(counts).reduce((sum, [tid, needed]) => {
      const prices = items.filter((i) => i.typeId === tid).map((i) => i.price).sort((a, b) => a - b)
      return sum + prices.slice(0, needed).reduce((s, p) => s + p, 0)
    }, 0)
  }

  function comboSatisfied(combo, items) {
    const counts = comboTypeCounts(combo)
    return Object.entries(counts).every(([tid, needed]) =>
      items.filter((i) => i.typeId === tid).length >= needed,
    )
  }

  const { comboSavings, activeCombo } = (() => {
    if (!combos.length || !cartItems.length) return { comboSavings: 0, activeCombo: null }
    for (const combo of combos) {
      if (!comboSatisfied(combo, cartItems)) continue
      const normalCost = comboNormalCost(combo, cartItems)
      if (combo.totalPrice < normalCost) {
        return {
          comboSavings: normalCost - combo.totalPrice,
          activeCombo: { ...combo, normalCost, discountPct: Math.round(((normalCost - combo.totalPrice) / normalCost) * 100) },
        }
      }
    }
    return { comboSavings: 0, activeCombo: null }
  })()

  const cartTotal = cartSubtotal - comboSavings

  const comboSuggestion = (() => {
    if (activeCombo || !combos.length || !cartItems.length) return null
    for (const combo of combos) {
      const counts = comboTypeCounts(combo)
      const missingTypeNames = []
      let hasAny = false
      for (const [tid, needed] of Object.entries(counts)) {
        const have = cartItems.filter((i) => i.typeId === tid).length
        if (have > 0) hasAny = true
        if (have < needed) {
          const typeName = productTypes.find((t) => t.id === tid)?.name
          const short = needed - have
          missingTypeNames.push(short > 1 ? `${short}× ${typeName}` : typeName)
        }
      }
      if (!hasAny || missingTypeNames.length === 0) continue
      const comboName = combo.name || Object.entries(counts)
        .map(([id, cnt]) => {
          const n = productTypes.find((t) => t.id === id)?.name
          return cnt > 1 ? `${n} ×${cnt}` : n
        }).filter(Boolean).join(' + ')
      const missingSlots = []
      for (const [tid, needed] of Object.entries(counts)) {
        const have = cartItems.filter((i) => i.typeId === tid).length
        const short = needed - have
        if (short > 0) {
          const cheapest = products
            .filter((p) => p.available && p.typeId === tid)
            .sort((a, b) => a.price - b.price)[0]
          for (let i = 0; i < short; i++) missingSlots.push({ typeId: tid, product: cheapest })
        }
      }
      return { combo, missingTypeNames, comboName, comboPrice: combo.totalPrice, missingSlots }
    }
    return null
  })()

  function setQty(productId, delta) {
    setCart((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] || 0) + delta),
    }))
  }

  function onComboYes() {
    if (!comboSuggestion) return
    const byType = {}
    for (const { typeId } of comboSuggestion.missingSlots) {
      byType[typeId] = (byType[typeId] || 0) + 1
    }
    const slots = Object.entries(byType).map(([typeId, count]) => {
      const typeName = productTypes.find((t) => t.id === typeId)?.name || typeId
      const availableProducts = products.filter((p) => p.available && p.typeId === typeId)
      return { typeId, typeName, count, availableProducts, selectedProductId: availableProducts[0]?.id || null }
    })
    setComboPick(slots)
  }

  function onComboPickConfirm() {
    for (const slot of comboPick) {
      if (slot.selectedProductId) setQty(slot.selectedProductId, slot.count)
    }
    setComboPick(null)
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
      <div className="order-page order-page--centered">
        <div className="order-status-box">
          <div className="order-verifying-spinner" />
          <p className="order-verifying-text">Verifiserer betaling…</p>
        </div>
      </div>
    )
  }

  if (step === 'success') {
    const order = confirmedOrder || {}
    const name = order.customerName || customerName
    const phone = order.customerPhone || customerPhone
    const locName = order.locationName || selectedLocation?.name || ''
    const total = order.total ?? cartTotal
    const items = order.items || cartItems
    return (
      <div className="order-page order-page--centered">
        <div className="order-confirm-card">
          <div className="order-confirm-icon order-confirm-icon--ok">✓</div>
          <h1 className="order-confirm-title">Bestilling mottatt!</h1>
          <p className="order-confirm-name">Takk, <strong>{name}</strong>!</p>

          {items.length > 0 ? (
            <div className="order-confirm-items">
              {items.map((item, i) => (
                <div key={i} className="order-confirm-item">
                  <span>{item.quantity}× {item.name}</span>
                  <span>{item.price * item.quantity} kr</span>
                </div>
              ))}
              <div className="order-confirm-total">
                <span>Totalt</span>
                <span>{total} kr</span>
              </div>
            </div>
          ) : null}

          <div className="order-confirm-meta">
            {locName ? <div className="order-confirm-meta-row"><span className="order-confirm-meta-icon">📍</span>{locName}</div> : null}
            <div className="order-confirm-meta-row"><span className="order-confirm-meta-icon">📱</span>SMS-varsel sendes til {phone}</div>
          </div>

          <p className="order-confirm-sub">Du får beskjed når bestillingen er klar for henting.</p>
        </div>
      </div>
    )
  }

  if (step === 'failed') {
    return (
      <div className="order-page order-page--centered">
        <div className="order-confirm-card order-confirm-card--failed">
          <div className="order-confirm-icon order-confirm-icon--fail">✕</div>
          <h1 className="order-confirm-title">Betalingen gikk ikke gjennom</h1>
          <p className="order-confirm-sub">
            Ingen beløp er trukket. Du kan prøve igjen eller kontakte oss hvis problemet vedvarer.
          </p>
          {error ? <p className="order-confirm-error">{error}</p> : null}
          <button
            type="button"
            className="order-btn order-confirm-retry"
            onClick={() => { setStep('order'); setError('') }}
          >
            Prøv igjen
          </button>
        </div>
      </div>
    )
  }

  const CartSummary = () => (
    <div className="order-cart">
      <h3 className="order-cart-title">Handlekurv</h3>
      {cartItems.map((item) => (
        <div key={item.id} className="order-cart-row">
          <span>{item.quantity}× {item.name}</span>
          <span>{item.price * item.quantity} kr</span>
        </div>
      ))}
      {activeCombo ? (
        <>
          <div className="order-cart-row order-cart-subtotal">
            <span>Delsum</span>
            <span>{cartSubtotal} kr</span>
          </div>
          <div className="order-cart-row order-cart-discount">
            <span>
              Kombotilbud{activeCombo.name ? ` – ${activeCombo.name}` : ''}
              <span className="order-cart-discount-pct">−{activeCombo.discountPct}%</span>
            </span>
            <span>−{comboSavings} kr</span>
          </div>
        </>
      ) : null}
      <div className="order-cart-total">
        <span>Totalt</span>
        <span>{cartTotal} kr</span>
      </div>
    </div>
  )

  return (
    <div className="order-page">
      <div className="order-hero">
        <h1>Bestill pizza 🍕</h1>
      </div>

      {availableLocations.length === 0 ? (
        <div className="order-closed-box">
          <h2>Ingen lokasjoner åpne nå</h2>
          <p className="order-closed-sub">Bestilling er ikke tilgjengelig akkurat nå.</p>
        </div>
      ) : (
        <>
          <div className="order-progress">
            {[['Produkter', 1], ['Sted', 2], ['Info', 3]].map(([label, s]) => (
              <div key={s} className={`order-progress-step${formStep === s ? ' is-active' : formStep > s ? ' is-done' : ''}`}>
                <div className="order-progress-circle">{formStep > s ? '✓' : s}</div>
                <span className="order-progress-label">{label}</span>
              </div>
            ))}
          </div>

          <form className="order-form" onSubmit={onSubmit} noValidate>

            {formStep === 1 ? (
              <>
                <section className="order-section">
                  {products.filter((p) => p.available).length === 0 ? (
                    <p className="order-empty">Ingen produkter tilgjengelig.</p>
                  ) : (
                    <ProductList
                      products={products}
                      productTypes={productTypes}
                      cart={cart}
                      setQty={setQty}
                    />
                  )}
                </section>

                {comboSuggestion ? (
                  <div className="order-combo-banner">
                    <div className="order-combo-banner-body">
                      <span className="order-combo-banner-tag">Kombotilbud</span>
                      <p className="order-combo-banner-text">
                        Legg til <strong>{comboSuggestion.missingTypeNames.join(' og ')}</strong> og få{' '}
                        <strong>{comboSuggestion.comboName}</strong> for kun{' '}
                        <strong>{comboSuggestion.comboPrice} kr</strong>!
                      </p>
                    </div>
                    <button type="button" className="order-combo-yes-btn" onClick={onComboYes}>Yes please!</button>
                  </div>
                ) : null}

                {cartItems.length > 0 ? <CartSummary /> : null}

                <div className="order-step-nav">
                  <button
                    type="button"
                    className="order-btn order-step-next"
                    disabled={cartItems.length === 0}
                    onClick={() => setFormStep(2)}
                  >Neste →</button>
                </div>
              </>
            ) : null}

            {formStep === 2 ? (
              <>
                {cartItems.length > 0 ? <CartSummary /> : null}

                <section className="order-section">
                  <h2 className="order-section-title">Velg sted</h2>
                  <div className="order-location-grid">
                    {availableLocations.map((loc) => {
                      const win = getLocationOpen(locationSettings[loc.id])
                      return (
                        <button
                          key={loc.id}
                          type="button"
                          className={`order-location-card${selectedLocation?.id === loc.id ? ' is-selected' : ''}`}
                          onClick={() => setSelectedLocation(loc)}
                        >
                          <span className="order-location-name">{loc.name}</span>
                          {win && !win.forced ? (
                            <span className="order-location-time">Åpent til {win.close}</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </section>

                <div className="order-step-nav">
                  <button type="button" className="order-step-back ghost" onClick={() => setFormStep(1)}>← Tilbake</button>
                  <button
                    type="button"
                    className="order-btn order-step-next"
                    disabled={!selectedLocation}
                    onClick={() => setFormStep(3)}
                  >Neste →</button>
                </div>
              </>
            ) : null}

            {formStep === 3 ? (
              <>
                <CartSummary />

                <section className="order-section">
                  <h2 className="order-section-title">Kontaktinfo</h2>
                  <p className="order-section-sub">Du får SMS-varsel når bestillingen er klar.</p>
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

                <div className="order-step-nav">
                  <button type="button" className="order-step-back ghost" onClick={() => setFormStep(2)}>← Tilbake</button>
                  <button
                    type="submit"
                    className="order-vipps-btn"
                    disabled={submitting}
                  >
                    {submitting ? 'Starter Vipps...' : (
                      <><img src={vippsLogo} alt="Vipps" className="order-vipps-logo" />Betal {cartTotal > 0 ? `${cartTotal} kr` : ''} med Vipps</>
                    )}
                  </button>
                </div>
              </>
            ) : null}

          </form>
        </>
      )}

      {comboPick ? (
        <div className="order-combo-modal-overlay" onClick={() => setComboPick(null)}>
          <div className="order-combo-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="order-combo-modal-title">Velg produkter</h3>
            {comboPick.map((slot) => (
              <div key={slot.typeId} className="order-combo-modal-group">
                <p className="order-combo-modal-type-label">
                  {slot.typeName}{slot.count > 1 ? ` ×${slot.count}` : ''}
                </p>
                <div className="order-combo-modal-options">
                  {slot.availableProducts.map((p) => (
                    <label
                      key={p.id}
                      className={`order-combo-modal-option${slot.selectedProductId === p.id ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`combo-pick-${slot.typeId}`}
                        value={p.id}
                        checked={slot.selectedProductId === p.id}
                        onChange={() => setComboPick((prev) =>
                          prev.map((s) => s.typeId === slot.typeId ? { ...s, selectedProductId: p.id } : s)
                        )}
                      />
                      {p.imageUrl ? <img src={p.imageUrl} className="order-combo-modal-img" alt={p.name} /> : null}
                      <span className="order-combo-modal-option-name">{p.name}</span>
                      <span className="order-combo-modal-option-price">{p.price} kr</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="order-combo-modal-actions">
              <button type="button" className="order-btn" onClick={onComboPickConfirm}>
                Legg til i kurv
              </button>
              <button type="button" className="order-combo-modal-cancel" onClick={() => setComboPick(null)}>
                Avbryt
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProductRow({ product, cart, setQty }) {
  return (
    <div className="order-product-row">
      {product.imageUrl ? (
        <img src={product.imageUrl} className="order-product-img" alt={product.name} />
      ) : null}
      <div className="order-product-info">
        <p className="order-product-name">{product.name}</p>
        {product.description ? <p className="order-product-desc">{product.description}</p> : null}
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
  )
}

function ProductList({ products, productTypes, cart, setQty }) {
  const available = products.filter((p) => p.available)

  if (productTypes.length === 0) {
    return (
      <div className="order-product-list">
        {available.map((p) => (
          <ProductRow key={p.id} product={p} cart={cart} setQty={setQty} />
        ))}
      </div>
    )
  }

  const typeOrder = productTypes.map((t) => t.id)
  const grouped = {}
  const untyped = []
  for (const p of available) {
    if (p.typeId && typeOrder.includes(p.typeId)) {
      if (!grouped[p.typeId]) grouped[p.typeId] = []
      grouped[p.typeId].push(p)
    } else {
      untyped.push(p)
    }
  }

  return (
    <div className="order-product-groups">
      {productTypes.map((type) =>
        grouped[type.id]?.length ? (
          <div key={type.id} className="order-product-group">
            <h3 className="order-product-group-title">{type.name}</h3>
            <div className="order-product-list">
              {grouped[type.id].map((p) => (
                <ProductRow key={p.id} product={p} cart={cart} setQty={setQty} />
              ))}
            </div>
          </div>
        ) : null,
      )}
      {untyped.length > 0 ? (
        <div className="order-product-group">
          {productTypes.length > 0 ? <h3 className="order-product-group-title">Annet</h3> : null}
          <div className="order-product-list">
            {untyped.map((p) => (
              <ProductRow key={p.id} product={p} cart={cart} setQty={setQty} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
