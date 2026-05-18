import { useState, useEffect } from 'react'
import { doc, getDoc, getDocs, setDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import { Navigate } from 'react-router-dom'
import './Order.css'

const DAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
const DAYS_SHORT = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør']

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function OrderAdmin() {
  const { isAdmin, loading: authLoading } = useAdminSession()
  const [products, setProducts] = useState([])
  const [locationSettings, setLocationSettings] = useState({})
  const [workerPin, setWorkerPin] = useState('')
  const [locations, setLocations] = useState([]) // orderEnabled locations from /plasseringer
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState({ saving: false, error: '', message: '' })

  const [newProduct, setNewProduct] = useState({ name: '', description: '', price: '' })
  const [addingProduct, setAddingProduct] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    Promise.all([
      getDoc(doc(db, 'orderConfig', 'default')),
      getDocs(collection(db, 'locations')),
    ])
      .then(([configSnap, locsSnap]) => {
        const cfg = configSnap.exists() ? configSnap.data() : {}
        setProducts(cfg.products || [])
        setLocationSettings(cfg.locationSettings || {})
        setWorkerPin(cfg.workerPin || '')
        const locs = locsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((l) => l.orderEnabled)
          .sort((a, b) => {
            const oa = typeof a.order === 'number' ? a.order : Infinity
            const ob = typeof b.order === 'number' ? b.order : Infinity
            return oa - ob || String(a.name || '').localeCompare(String(b.name || ''), 'nb')
          })
        setLocations(locs)
      })
      .catch((err) => setSaveState({ saving: false, error: err.message || 'Kunne ikke laste data', message: '' }))
      .finally(() => setLoading(false))
  }, [isAdmin])

  async function save(updatedProducts, updatedLocationSettings, updatedPin) {
    setSaveState({ saving: true, error: '', message: '' })
    try {
      await setDoc(doc(db, 'orderConfig', 'default'), {
        products: updatedProducts,
        locationSettings: updatedLocationSettings,
        workerPin: updatedPin,
        updatedAt: serverTimestamp(),
      })
      setProducts(updatedProducts)
      setLocationSettings(updatedLocationSettings)
      setWorkerPin(updatedPin)
      setSaveState({ saving: false, error: '', message: 'Lagret!' })
      setTimeout(() => setSaveState((s) => ({ ...s, message: '' })), 2500)
    } catch (err) {
      setSaveState({ saving: false, error: err.message || 'Lagring feilet', message: '' })
    }
  }

  // ── Products ──────────────────────────────────────────────────────────────

  function onAddProduct() {
    const name = newProduct.name.trim()
    const price = parseFloat(String(newProduct.price).replace(',', '.'))
    if (!name || isNaN(price) || price <= 0) return
    const product = { id: generateId(), name, description: newProduct.description.trim(), price, available: true }
    save([...products, product], locationSettings, workerPin)
    setNewProduct({ name: '', description: '', price: '' })
    setAddingProduct(false)
  }

  function onToggleProduct(id) {
    save(
      products.map((p) => (p.id === id ? { ...p, available: !p.available } : p)),
      locationSettings,
      workerPin,
    )
  }

  function onDeleteProduct(id) {
    save(products.filter((p) => p.id !== id), locationSettings, workerPin)
  }

  function onEditProductPrice(id, rawValue) {
    const price = parseFloat(String(rawValue).replace(',', '.'))
    if (isNaN(price) || price < 0) return
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, price } : p)))
  }

  function onSaveProductPrice() {
    save(products, locationSettings, workerPin)
  }

  // ── Schedule (calendar) ───────────────────────────────────────────────────

  function onScheduleChange(locId, dayIndex, field, value) {
    const current = locationSettings[locId] || {}
    const schedule = { ...(current.schedule || {}) }
    schedule[String(dayIndex)] = { ...(schedule[String(dayIndex)] || {}), [field]: value }
    setLocationSettings((prev) => ({
      ...prev,
      [locId]: { ...current, schedule },
    }))
  }

  function onSaveSchedule() {
    save(products, locationSettings, workerPin)
  }

  function onClearCell(locId, dayIndex) {
    const current = locationSettings[locId] || {}
    const schedule = { ...(current.schedule || {}) }
    delete schedule[String(dayIndex)]
    const updated = { ...locationSettings, [locId]: { ...current, schedule } }
    save(products, updated, workerPin)
  }

  // ── PIN ───────────────────────────────────────────────────────────────────

  function onSavePin(newPin) {
    save(products, locationSettings, newPin)
  }

  if (authLoading) return <div className="loading-box">Laster...</div>
  if (!isAdmin) return <Navigate to="/admin" replace />
  if (loading) return <div className="loading-box">Laster innstillinger...</div>

  return (
    <div className="order-admin-page">
      <div className="order-admin-header">
        <h1>Ordreinnstillinger</h1>
        <a className="ghost" href="/admin">← Tilbake til admin</a>
      </div>

      {saveState.error ? <p className="order-error">{saveState.error}</p> : null}
      {saveState.message ? <p className="order-save-msg">{saveState.message}</p> : null}

      {/* ── Products ── */}
      <section className="order-admin-section">
        <div className="order-admin-section-header">
          <h2>Produkter</h2>
          <button type="button" className="order-btn-sm" onClick={() => setAddingProduct((v) => !v)}>
            {addingProduct ? 'Avbryt' : '+ Nytt produkt'}
          </button>
        </div>

        {addingProduct ? (
          <div className="order-admin-add-form">
            <div className="order-admin-add-fields">
              <label className="order-field">
                <span>Navn</span>
                <input
                  type="text"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  placeholder="f.eks. Margherita"
                />
              </label>
              <label className="order-field">
                <span>Beskrivelse</span>
                <input
                  type="text"
                  value={newProduct.description}
                  onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Valgfri beskrivelse"
                />
              </label>
              <label className="order-field">
                <span>Pris (kr)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={newProduct.price}
                  onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))}
                  placeholder="150"
                />
              </label>
            </div>
            <button type="button" className="order-btn" onClick={onAddProduct}>
              Legg til produkt
            </button>
          </div>
        ) : null}

        {products.length === 0 ? (
          <p className="order-admin-empty">Ingen produkter ennå. Legg til det første.</p>
        ) : (
          <div className="order-admin-product-list">
            {products.map((product) => (
              <div key={product.id} className={`order-admin-product-row${product.available ? '' : ' is-unavailable'}`}>
                <div className="order-admin-product-info">
                  <p className="order-admin-product-name">{product.name}</p>
                  {product.description ? (
                    <p className="order-admin-product-desc">{product.description}</p>
                  ) : null}
                </div>
                <div className="order-admin-product-controls">
                  <label className="order-admin-price-label">
                    <span>kr</span>
                    <input
                      type="number"
                      min="0"
                      className="order-admin-price-input"
                      value={product.price}
                      onChange={(e) => onEditProductPrice(product.id, e.target.value)}
                      onBlur={onSaveProductPrice}
                    />
                  </label>
                  <button
                    type="button"
                    className={`order-admin-toggle${product.available ? ' is-on' : ' is-off'}`}
                    onClick={() => onToggleProduct(product.id)}
                  >
                    {product.available ? 'Tilgjengelig' : 'Utilgjengelig'}
                  </button>
                  <button
                    type="button"
                    className="order-admin-delete"
                    onClick={() => onDeleteProduct(product.id)}
                    aria-label="Slett produkt"
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Schedule calendar ── */}
      <section className="order-admin-section">
        <div className="order-admin-section-header">
          <h2>Åpningstider per lokasjon</h2>
          <a className="order-btn-sm ghost" href="/plasseringer">
            Slå på/av lokasjoner →
          </a>
        </div>
        <p className="order-admin-section-desc">
          Lokasjoner med bestilling aktivert vises her. Sett åpningstider per dag — lagres automatisk når du forlater feltet.
        </p>

        {locations.length === 0 ? (
          <p className="order-admin-empty">
            Ingen lokasjoner har bestilling aktivert.{' '}
            <a href="/plasseringer">Gå til /plasseringer</a> for å slå det på.
          </p>
        ) : (
          <div className="order-cal-wrap">
            <table className="order-cal-table">
              <thead>
                <tr>
                  <th className="order-cal-day-head" />
                  {locations.map((loc) => (
                    <th key={loc.id} className="order-cal-loc-head">
                      <span className="order-cal-loc-name">{loc.name}</span>
                      {loc.city ? <span className="order-cal-loc-city">{loc.city}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, i) => (
                  <tr key={i} className={i === 0 || i === 6 ? 'order-cal-weekend' : ''}>
                    <td className="order-cal-day-cell">
                      <span className="order-cal-day-full">{day}</span>
                      <span className="order-cal-day-short">{DAYS_SHORT[i]}</span>
                    </td>
                    {locations.map((loc) => {
                      const slot = locationSettings[loc.id]?.schedule?.[String(i)] || {}
                      const hasSlot = slot.open || slot.close
                      return (
                        <td key={loc.id} className={`order-cal-cell${hasSlot ? ' has-hours' : ''}`}>
                          <div className="order-cal-inputs">
                            <input
                              type="time"
                              className="order-cal-time"
                              value={slot.open || ''}
                              onChange={(e) => onScheduleChange(loc.id, i, 'open', e.target.value)}
                              onBlur={onSaveSchedule}
                            />
                            <span className="order-cal-sep">–</span>
                            <input
                              type="time"
                              className="order-cal-time"
                              value={slot.close || ''}
                              onChange={(e) => onScheduleChange(loc.id, i, 'close', e.target.value)}
                              onBlur={onSaveSchedule}
                            />
                            {hasSlot ? (
                              <button
                                type="button"
                                className="order-cal-clear"
                                onClick={() => onClearCell(loc.id, i)}
                                title="Fjern"
                              >✕</button>
                            ) : null}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Worker PIN ── */}
      <section className="order-admin-section">
        <h2>Worker PIN</h2>
        <p className="order-admin-section-desc">
          PIN-koden som ansatte bruker for å logge inn på arbeidsdashbordet.
        </p>
        <WorkerPinEditor currentPin={workerPin} onSave={onSavePin} saving={saveState.saving} />
      </section>
    </div>
  )
}

function WorkerPinEditor({ currentPin, onSave, saving }) {
  const [pin, setPin] = useState(currentPin || '')
  const [show, setShow] = useState(false)

  useEffect(() => { setPin(currentPin || '') }, [currentPin])

  return (
    <div className="order-admin-pin-row">
      <label className="order-field" style={{ maxWidth: 220 }}>
        <span>PIN-kode</span>
        <input
          type={show ? 'text' : 'password'}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="F.eks. 1234"
          inputMode="numeric"
        />
      </label>
      <div className="order-admin-pin-actions">
        <button type="button" className="ghost" onClick={() => setShow((v) => !v)}>
          {show ? 'Skjul' : 'Vis'}
        </button>
        <button
          type="button"
          className="order-btn"
          onClick={() => onSave(pin)}
          disabled={saving || !pin.trim() || pin === currentPin}
        >
          {saving ? 'Lagrer...' : 'Lagre PIN'}
        </button>
      </div>
    </div>
  )
}
