import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, getDocs, setDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, functions } from '../firebase'
import { httpsCallable } from 'firebase/functions'
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
  const [productTypes, setProductTypes] = useState([])
  const [combos, setCombos] = useState([])
  const [locationSettings, setLocationSettings] = useState({})
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState({ saving: false, error: '', message: '' })

  const [newProduct, setNewProduct] = useState({ name: '', description: '', price: '', typeId: '' })
  const [addingProduct, setAddingProduct] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [imageUploading, setImageUploading] = useState({})
  const [addingCombo, setAddingCombo] = useState(false)
  const [newCombo, setNewCombo] = useState({ name: '', typeIds: [], totalPrice: '' })
  const [smsTest, setSmsTest] = useState({ phone: '', sending: false, message: '', error: '' })
  const [smsTexts, setSmsTexts] = useState({ confirmation: '', ready: '', feedback: '', feedbackLink: '' })
  const [pizzaBakeTime, setPizzaBakeTime] = useState('3.5')

  useEffect(() => {
    if (!isAdmin) return
    Promise.all([
      getDoc(doc(db, 'orderConfig', 'default')),
      getDocs(collection(db, 'locations')),
    ])
      .then(([configSnap, locsSnap]) => {
        const cfg = configSnap.exists() ? configSnap.data() : {}
        setProducts(cfg.products || [])
        setProductTypes(cfg.productTypes || [])
        setCombos(cfg.combos || [])
        setLocationSettings(cfg.locationSettings || {})
        setSmsTexts({ confirmation: '', ready: '', feedback: '', feedbackLink: '', ...(cfg.smsTexts || {}) })
        setPizzaBakeTime(String(cfg.pizzaBakeTimeMinutes ?? 3.5))
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

  async function save(updatedProducts, updatedLocationSettings, updatedTypes, updatedCombos, updatedSmsTexts) {
    const types = updatedTypes !== undefined ? updatedTypes : productTypes
    const cms = updatedCombos !== undefined ? updatedCombos : combos
    const texts = updatedSmsTexts !== undefined ? updatedSmsTexts : smsTexts
    setSaveState({ saving: true, error: '', message: '' })
    try {
      await setDoc(doc(db, 'orderConfig', 'default'), {
        products: updatedProducts,
        productTypes: types,
        combos: cms,
        locationSettings: updatedLocationSettings,
        smsTexts: texts,
        pizzaBakeTimeMinutes: parseFloat(pizzaBakeTime) || 3.5,
        updatedAt: serverTimestamp(),
      })
      setProducts(updatedProducts)
      setProductTypes(types)
      setCombos(cms)
      setLocationSettings(updatedLocationSettings)
      setSmsTexts(texts)
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
    const product = {
      id: generateId(),
      name,
      description: newProduct.description.trim(),
      price,
      available: true,
      ...(newProduct.typeId ? { typeId: newProduct.typeId } : {}),
    }
    save([...products, product], locationSettings)
    setNewProduct({ name: '', description: '', price: '', typeId: '' })
    setAddingProduct(false)
  }

  function onChangeProductType(id, typeId) {
    const updated = products.map((p) =>
      p.id === id ? { ...p, typeId: typeId || undefined } : p,
    )
    save(updated, locationSettings)
  }

  function onAddType() {
    const name = newTypeName.trim()
    if (!name) return
    const updated = [...productTypes, { id: generateId(), name }]
    save(products, locationSettings, updated)
    setNewTypeName('')
  }

  function onDeleteType(typeId) {
    const updated = productTypes.filter((t) => t.id !== typeId)
    const updatedProducts = products.map((p) =>
      p.typeId === typeId ? { ...p, typeId: undefined } : p,
    )
    save(updatedProducts, locationSettings, updated)
  }

  function onRenameType(typeId, name) {
    if (!name.trim()) return
    save(
      products,
      locationSettings,
      productTypes.map((t) => (t.id === typeId ? { ...t, name } : t)),
    )
  }

  function onMoveProduct(id, dir) {
    const idx = products.findIndex((p) => p.id === id)
    if (idx === -1) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= products.length) return
    const next = [...products]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    save(next, locationSettings)
  }

  function onToggleProduct(id) {
    save(
      products.map((p) => (p.id === id ? { ...p, available: !p.available } : p)),
      locationSettings,
    )
  }

  function onDeleteProduct(id) {
    save(products.filter((p) => p.id !== id), locationSettings)
  }

  async function onUploadProductImage(productId, file) {
    setImageUploading((prev) => ({ ...prev, [productId]: true }))
    try {
      const fileRef = storageRef(storage, `productImages/${productId}`)
      await uploadBytes(fileRef, file)
      const url = await getDownloadURL(fileRef)
      const updated = products.map((p) => (p.id === productId ? { ...p, imageUrl: url } : p))
      await save(updated, locationSettings)
    } catch (err) {
      setSaveState({ saving: false, error: err.message || 'Bildeopplasting feilet', message: '' })
    } finally {
      setImageUploading((prev) => ({ ...prev, [productId]: false }))
    }
  }

  function onEditProductPrice(id, rawValue) {
    const price = parseFloat(String(rawValue).replace(',', '.'))
    if (isNaN(price) || price < 0) return
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, price } : p)))
  }

  function onSaveProductPrice() {
    save(products, locationSettings)
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
    save(products, locationSettings)
  }

  function onClearCell(locId, dayIndex) {
    const current = locationSettings[locId] || {}
    const schedule = { ...(current.schedule || {}) }
    delete schedule[String(dayIndex)]
    const updated = { ...locationSettings, [locId]: { ...current, schedule } }
    save(products, updated)
  }

  function onLocationSettingChange(locId, field, value) {
    setLocationSettings((prev) => ({
      ...prev,
      [locId]: { ...(prev[locId] || {}), [field]: value },
    }))
  }

  // ── Combos ───────────────────────────────────────────────────────────────

  function onAddCombo() {
    const price = parseFloat(String(newCombo.totalPrice).replace(',', '.'))
    if (newCombo.typeIds.length < 2 || isNaN(price) || price <= 0) return
    const combo = { id: generateId(), name: newCombo.name.trim(), typeIds: newCombo.typeIds, totalPrice: price }
    save(products, locationSettings, productTypes, [...combos, combo])
    setNewCombo({ name: '', typeIds: [], totalPrice: '' })
    setAddingCombo(false)
  }

  function onDeleteCombo(id) {
    save(products, locationSettings, productTypes, combos.filter((c) => c.id !== id))
  }

  function onEditComboPrice(id, rawValue) {
    const price = parseFloat(String(rawValue).replace(',', '.'))
    if (isNaN(price) || price <= 0) return
    setCombos((prev) => prev.map((c) => (c.id === id ? { ...c, totalPrice: price } : c)))
  }

  function onSaveComboPrice() {
    save(products, locationSettings, productTypes, combos)
  }

  function saveSmsTexts(texts) {
    save(products, locationSettings, productTypes, combos, texts)
  }

  async function onSendSmsTest() {
    const phone = smsTest.phone.trim()
    if (!phone) return
    setSmsTest((s) => ({ ...s, sending: true, message: '', error: '' }))
    try {
      await httpsCallable(functions, 'sendTestSms')({ phone })
      setSmsTest((s) => ({ ...s, sending: false, message: 'SMS sendt!' }))
    } catch (err) {
      setSmsTest((s) => ({ ...s, sending: false, error: err.message || 'Sending feilet' }))
    }
  }

  function onOverrideChange(locId, value) {
    const updated = {
      ...locationSettings,
      [locId]: { ...(locationSettings[locId] || {}), openOverride: value },
    }
    setLocationSettings(updated)
    save(products, updated)
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

        {/* Types */}
        <div className="order-admin-types-block">
          <p className="order-admin-types-label">Typer</p>
          <div className="order-admin-types-list">
            {productTypes.map((t) => (
              <div key={t.id} className="order-admin-type-chip">
                <input
                  type="text"
                  className="order-admin-type-input"
                  defaultValue={t.name}
                  onBlur={(e) => onRenameType(t.id, e.target.value)}
                />
                <button
                  type="button"
                  className="order-admin-type-delete"
                  onClick={() => onDeleteType(t.id)}
                  aria-label="Slett type"
                >✕</button>
              </div>
            ))}
            <div className="order-admin-type-add">
              <input
                type="text"
                className="order-admin-type-input"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddType() } }}
                placeholder="Ny type..."
              />
              <button type="button" className="order-btn-sm" onClick={onAddType} disabled={!newTypeName.trim()}>
                Legg til
              </button>
            </div>
          </div>
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
              {productTypes.length > 0 ? (
                <label className="order-field">
                  <span>Type</span>
                  <select
                    value={newProduct.typeId}
                    onChange={(e) => setNewProduct((p) => ({ ...p, typeId: e.target.value }))}
                  >
                    <option value="">— ingen —</option>
                    {productTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
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
            {products.map((product, idx) => (
              <div key={product.id} className={`order-admin-product-row${product.available ? '' : ' is-unavailable'}`}>
                <div className="order-admin-product-sort">
                  <button type="button" className="order-admin-sort-btn" onClick={() => onMoveProduct(product.id, -1)} disabled={idx === 0} aria-label="Flytt opp">↑</button>
                  <button type="button" className="order-admin-sort-btn" onClick={() => onMoveProduct(product.id, 1)} disabled={idx === products.length - 1} aria-label="Flytt ned">↓</button>
                </div>
                <label className="order-admin-product-img-area" title="Last opp bilde">
                  {imageUploading[product.id] ? (
                    <div className="order-admin-product-thumb order-admin-product-thumb--loading">…</div>
                  ) : product.imageUrl ? (
                    <img src={product.imageUrl} className="order-admin-product-thumb" alt={product.name} />
                  ) : (
                    <div className="order-admin-product-thumb order-admin-product-thumb--empty">📷</div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files[0] && onUploadProductImage(product.id, e.target.files[0])}
                  />
                </label>
                <div className="order-admin-product-info">
                  <p className="order-admin-product-name">{product.name}</p>
                  {product.description ? (
                    <p className="order-admin-product-desc">{product.description}</p>
                  ) : null}
                  {productTypes.length > 0 ? (
                    <select
                      className="order-admin-type-select"
                      value={product.typeId || ''}
                      onChange={(e) => onChangeProductType(product.id, e.target.value)}
                    >
                      <option value="">— ingen type —</option>
                      {productTypes.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
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

      {/* ── Combos ── */}
      <section className="order-admin-section">
        <div className="order-admin-section-header">
          <h2>Kombotilbud</h2>
          <button type="button" className="order-btn-sm" onClick={() => setAddingCombo((v) => !v)}>
            {addingCombo ? 'Avbryt' : '+ Nytt kombotilbud'}
          </button>
        </div>
        <p className="order-admin-section-desc">
          Kombiner to eller flere produkttyper til en rabattert totalpris. Rabatten vises automatisk på bestillingssiden.
        </p>

        {addingCombo ? (
          <div className="order-admin-add-form">
            <div className="order-admin-add-fields">
              <label className="order-field">
                <span>Navn (valgfritt)</span>
                <input
                  type="text"
                  value={newCombo.name}
                  onChange={(e) => setNewCombo((c) => ({ ...c, name: e.target.value }))}
                  placeholder="f.eks. Pizza + Drikke"
                />
              </label>
              <div className="order-field">
                <span>Typer som inngår</span>
                <div className="order-combo-type-counters">
                  {productTypes.map((t) => {
                    const count = newCombo.typeIds.filter((id) => id === t.id).length
                    return (
                      <div key={t.id} className="order-combo-type-counter">
                        <span className="order-combo-type-counter-name">{t.name}</span>
                        <button
                          type="button"
                          className="order-combo-counter-btn"
                          onClick={() => setNewCombo((c) => {
                            const idx = [...c.typeIds].lastIndexOf(t.id)
                            if (idx === -1) return c
                            const next = [...c.typeIds]
                            next.splice(idx, 1)
                            return { ...c, typeIds: next }
                          })}
                          disabled={count === 0}
                        >−</button>
                        <span className="order-combo-counter-val">{count}</span>
                        <button
                          type="button"
                          className="order-combo-counter-btn"
                          onClick={() => setNewCombo((c) => ({ ...c, typeIds: [...c.typeIds, t.id] }))}
                        >+</button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <label className="order-field">
                <span>Kombopris (kr)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={newCombo.totalPrice}
                  onChange={(e) => setNewCombo((c) => ({ ...c, totalPrice: e.target.value }))}
                  placeholder="170"
                />
              </label>
            </div>
            {newCombo.typeIds.length < 2 && (
              <p className="order-admin-combo-hint">Velg minst 2 typer.</p>
            )}
            <button
              type="button"
              className="order-btn"
              onClick={onAddCombo}
              disabled={newCombo.typeIds.length < 2 || !newCombo.totalPrice}
            >
              Opprett kombotilbud
            </button>
          </div>
        ) : null}

        {combos.length === 0 ? (
          <p className="order-admin-empty">Ingen kombotilbud ennå.</p>
        ) : (
          <div className="order-admin-combo-list">
            {combos.map((combo) => {
              const countMap = {}
              for (const id of combo.typeIds) countMap[id] = (countMap[id] || 0) + 1
              const typeLabels = Object.entries(countMap).map(([id, cnt]) => ({
                id, cnt, name: productTypes.find((t) => t.id === id)?.name || id,
              }))
              const autoName = typeLabels.map(({ name, cnt }) => cnt > 1 ? `${name} ×${cnt}` : name).join(' + ')
              return (
                <div key={combo.id} className="order-admin-combo-row">
                  <div className="order-admin-combo-info">
                    <p className="order-admin-combo-name">
                      {combo.name || autoName}
                    </p>
                    <div className="order-admin-combo-types">
                      {typeLabels.map(({ id, name, cnt }) => (
                        <span key={id} className="order-admin-combo-tag">
                          {name}{cnt > 1 ? ` ×${cnt}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="order-admin-combo-controls">
                    <label className="order-admin-price-label">
                      <span>kr</span>
                      <input
                        type="number"
                        min="0"
                        className="order-admin-price-input"
                        value={combo.totalPrice}
                        onChange={(e) => onEditComboPrice(combo.id, e.target.value)}
                        onBlur={onSaveComboPrice}
                      />
                    </label>
                    <button
                      type="button"
                      className="order-admin-delete"
                      onClick={() => onDeleteCombo(combo.id)}
                      aria-label="Slett kombotilbud"
                    >✕</button>
                  </div>
                </div>
              )
            })}
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
          <div className="order-cal-wrap">
            <table className="order-cal-table order-cal-table--demo">
              <thead>
                <tr>
                  <th className="order-cal-day-head" />
                  <th className="order-cal-loc-head">
                    <span className="order-cal-loc-name">Eksempel-lokasjon</span>
                    <span className="order-cal-loc-city">Aktiver under /plasseringer</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="order-cal-meta-row">
                  <td className="order-cal-day-cell"><span className="order-cal-day-full">Status</span></td>
                  <td className="order-cal-cell order-cal-meta-cell">
                    <div className="order-cal-override-group">
                      {[['Auto', null], ['Åpen', 'open'], ['Stengt', 'closed']].map(([label, val]) => (
                        <button key={label} type="button" className={`order-cal-override-btn${val === null ? ' is-active' : ''}`} disabled>{label}</button>
                      ))}
                    </div>
                  </td>
                </tr>
                <tr className="order-cal-meta-row">
                  <td className="order-cal-day-cell"><span className="order-cal-day-full">PIN</span></td>
                  <td className="order-cal-cell order-cal-meta-cell">
                    <input type="text" className="order-cal-pin-input" placeholder="PIN" disabled />
                  </td>
                </tr>
                {DAYS.map((day, i) => (
                  <tr key={i} className={i === 0 || i === 6 ? 'order-cal-weekend' : ''}>
                    <td className="order-cal-day-cell">
                      <span className="order-cal-day-full">{day}</span>
                      <span className="order-cal-day-short">{DAYS_SHORT[i]}</span>
                    </td>
                    <td className="order-cal-cell">
                      <div className="order-cal-inputs">
                        <input type="time" className="order-cal-time" disabled placeholder="11:00" />
                        <span className="order-cal-sep">–</span>
                        <input type="time" className="order-cal-time" disabled placeholder="20:00" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="order-admin-demo-hint">
              Ingen lokasjoner har bestilling aktivert. <a href="/plasseringer">Gå til /plasseringer</a> for å slå det på.
            </p>
          </div>
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
                <tr className="order-cal-meta-row">
                  <td className="order-cal-day-cell">
                    <span className="order-cal-day-full">Status</span>
                    <span className="order-cal-day-short">Status</span>
                  </td>
                  {locations.map((loc) => {
                    const override = locationSettings[loc.id]?.openOverride ?? null
                    return (
                      <td key={loc.id} className="order-cal-cell order-cal-meta-cell">
                        <div className="order-cal-override-group">
                          {[['auto', 'Auto', null], ['open', 'Åpen', 'open'], ['closed', 'Stengt', 'closed']].map(([key, label, val]) => (
                            <button
                              key={key}
                              type="button"
                              data-val={val ?? 'auto'}
                              className={`order-cal-override-btn${override === val ? ' is-active' : ''}`}
                              onClick={() => onOverrideChange(loc.id, val)}
                            >{label}</button>
                          ))}
                        </div>
                      </td>
                    )
                  })}
                </tr>
                <tr className="order-cal-meta-row">
                  <td className="order-cal-day-cell">
                    <span className="order-cal-day-full">PIN</span>
                    <span className="order-cal-day-short">PIN</span>
                  </td>
                  {locations.map((loc) => (
                    <td key={loc.id} className="order-cal-cell order-cal-meta-cell">
                      <input
                        type="text"
                        className="order-cal-pin-input"
                        value={locationSettings[loc.id]?.workerPin || ''}
                        onChange={(e) => onLocationSettingChange(loc.id, 'workerPin', e.target.value)}
                        onBlur={onSaveSchedule}
                        placeholder="PIN"
                        inputMode="numeric"
                      />
                    </td>
                  ))}
                </tr>
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

      {/* ── Bake time ── */}
      <section className="order-admin-section">
        <h2>Steketid</h2>
        <p className="order-admin-section-desc">
          Brukes til å beregne forventet ventetid for kunden på bestillingssiden.
        </p>
        <label className="order-field" style={{ maxWidth: 240 }}>
          <span>Minutter per pizza</span>
          <input
            type="number"
            min="0.5"
            max="30"
            step="0.5"
            value={pizzaBakeTime}
            onChange={(e) => setPizzaBakeTime(e.target.value)}
            onBlur={() => save(products, locationSettings)}
          />
        </label>
      </section>

      {/* ── SMS texts ── */}
      <section className="order-admin-section">
        <h2>SMS-tekster</h2>
        <p className="order-admin-section-desc">
          Tilpass tekstene som sendes til kunder. Bruk <code>{'{name}'}</code>, <code>{'{items}'}</code>, <code>{'{location}'}</code>, <code>{'{link}'}</code> som variabler.
        </p>
        <div className="order-admin-sms-texts">
          <label className="order-field">
            <span>Bekreftelse (etter betaling)</span>
            <textarea
              className="order-admin-sms-textarea"
              value={smsTexts.confirmation}
              onChange={(e) => setSmsTexts((s) => ({ ...s, confirmation: e.target.value }))}
              onBlur={() => saveSmsTexts(smsTexts)}
              placeholder={`Hei {name}! Vi har mottatt bestillingen din ({items}) fra Crust n' Trust. Du får ny SMS når den er klar for henting. 🍕`}
              rows={3}
            />
          </label>
          <label className="order-field">
            <span>Klar for henting</span>
            <textarea
              className="order-admin-sms-textarea"
              value={smsTexts.ready}
              onChange={(e) => setSmsTexts((s) => ({ ...s, ready: e.target.value }))}
              onBlur={() => saveSmsTexts(smsTexts)}
              placeholder={`Hei {name}! 🍕 Bestillingen din er klar for henting hos Crust n' Trust — {location}. God appetitt!`}
              rows={3}
            />
          </label>
          <label className="order-field">
            <span>Tilbakemelding (15 min etter henting)</span>
            <textarea
              className="order-admin-sms-textarea"
              value={smsTexts.feedback}
              onChange={(e) => setSmsTexts((s) => ({ ...s, feedback: e.target.value }))}
              onBlur={() => saveSmsTexts(smsTexts)}
              placeholder={`Hei {name}! Håper maten smakte godt. Del gjerne din tilbakemelding: {link} 🍕`}
              rows={3}
            />
          </label>
          <label className="order-field" style={{ maxWidth: 400 }}>
            <span>Tilbakemeldingslenke</span>
            <input
              type="url"
              value={smsTexts.feedbackLink}
              onChange={(e) => setSmsTexts((s) => ({ ...s, feedbackLink: e.target.value }))}
              onBlur={() => saveSmsTexts(smsTexts)}
              placeholder="https://crust.no/tilbakemelding"
            />
          </label>
        </div>
      </section>

      {/* ── SMS test ── */}
      <section className="order-admin-section">
        <h2>Test SMS</h2>
        <p className="order-admin-section-desc">
          Send en test-SMS via 46elks for å verifisere at oppsett er korrekt.
        </p>
        <div className="order-admin-sms-test">
          <label className="order-field" style={{ maxWidth: 220 }}>
            <span>Mobilnummer</span>
            <input
              type="tel"
              value={smsTest.phone}
              onChange={(e) => setSmsTest((s) => ({ ...s, phone: e.target.value }))}
              placeholder="+4712345678"
              inputMode="tel"
            />
          </label>
          <button
            type="button"
            className="order-btn"
            onClick={onSendSmsTest}
            disabled={smsTest.sending || !smsTest.phone.trim()}
          >
            {smsTest.sending ? 'Sender...' : 'Send test-SMS'}
          </button>
          {smsTest.message ? <span className="order-save-msg">{smsTest.message}</span> : null}
          {smsTest.error ? <span className="order-error" style={{ margin: 0 }}>{smsTest.error}</span> : null}
        </div>
      </section>

    </div>
  )
}
