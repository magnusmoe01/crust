import { useState, useEffect } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import { Navigate } from 'react-router-dom'
import './Order.css'

const STATUS_LABELS = {
  pending_payment: 'Venter betaling',
  paid:            'Betalt',
  confirmed:       'Bekreftet',
  ready:           'Klar',
  cancelled:       'Kansellert',
  refunded:        'Refundert',
}

const STATUS_CLASS = {
  pending_payment: 'all-orders-status--pending',
  paid:            'all-orders-status--paid',
  confirmed:       'all-orders-status--confirmed',
  ready:           'all-orders-status--ready',
  cancelled:       'all-orders-status--cancelled',
  refunded:        'all-orders-status--refunded',
}

const REFUNDABLE = new Set(['paid', 'confirmed', 'ready'])

const FILTERS = ['alle', 'paid', 'confirmed', 'ready', 'pending_payment', 'cancelled', 'refunded']
const FILTER_LABELS = {
  alle:            'Alle',
  paid:            'Betalt',
  confirmed:       'Bekreftet',
  ready:           'Klar',
  pending_payment: 'Venter betaling',
  cancelled:       'Kansellert',
  refunded:        'Refundert',
}

function formatTime(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Akkurat nå'
  if (diffMin < 60) return `${diffMin} min siden`
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  const hm = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `i dag ${hm}`
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' }) + ` ${hm}`
}

export default function AllOrders() {
  const { isAdmin, loading: authLoading } = useAdminSession()
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('alle')
  const [loading, setLoading] = useState(true)
  const [refundState, setRefundState] = useState({})

  useEffect(() => {
    if (!isAdmin) return
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200))
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [isAdmin])

  if (authLoading) return <div className="loading-box">Laster...</div>
  if (!isAdmin) return <Navigate to="/admin" replace />

  function setOrderRefund(orderId, state) {
    setRefundState((prev) => ({ ...prev, [orderId]: { ...prev[orderId], ...state } }))
  }

  async function onRefundConfirm(order) {
    setOrderRefund(order.id, { loading: true, error: '' })
    try {
      await httpsCallable(functions, 'refundVippsOrder')({ orderId: order.id })
      setOrderRefund(order.id, { loading: false, confirming: false, done: true })
    } catch (err) {
      setOrderRefund(order.id, { loading: false, confirming: false, error: err?.message || 'Refusjon feilet' })
    }
  }

  const visible = filter === 'alle' ? orders : orders.filter((o) => o.status === filter)

  const counts = {}
  for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1

  return (
    <div className="order-admin-page">
      <div className="order-admin-header">
        <h1>Alle bestillinger</h1>
        <a className="ghost" href="/admin">← Tilbake til admin</a>
      </div>

      <div className="all-orders-filters">
        {FILTERS.map((f) => {
          const cnt = f === 'alle' ? orders.length : (counts[f] || 0)
          return (
            <button
              key={f}
              type="button"
              className={`all-orders-filter-btn${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
              {cnt > 0 ? <span className="all-orders-filter-count">{cnt}</span> : null}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p className="order-loading">Laster bestillinger...</p>
      ) : visible.length === 0 ? (
        <p className="order-admin-empty">Ingen bestillinger.</p>
      ) : (
        <div className="all-orders-list">
          {visible.map((order) => {
            const rs = refundState[order.id] || {}
            const canRefund = REFUNDABLE.has(order.status)
            return (
              <div key={order.id} className="all-orders-row">
                <div className="all-orders-row-top">
                  <span className="all-orders-customer">{order.customerName || '—'}</span>
                  <span className={`all-orders-status ${STATUS_CLASS[order.status] || ''}`}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                </div>
                <div className="all-orders-row-meta">
                  <span className="all-orders-location">📍 {order.locationName || order.locationId || '—'}</span>
                  <span className="all-orders-time">{formatTime(order.createdAt)}</span>
                </div>
                <div className="all-orders-items">
                  {(order.items || []).map((item, i) => (
                    <span key={i} className="all-orders-item-chip">
                      {item.quantity}× {item.name}
                    </span>
                  ))}
                </div>
                <div className="all-orders-row-footer">
                  <span className="all-orders-total">{order.total} kr</span>
                  <span className="all-orders-phone">{order.customerPhone || ''}</span>
                  {canRefund && !rs.done ? (
                    <div className="all-orders-refund">
                      {rs.confirming ? (
                        <>
                          <span className="all-orders-refund-confirm-label">Refundere {order.total} kr?</span>
                          <button
                            type="button"
                            className="all-orders-refund-yes"
                            onClick={() => onRefundConfirm(order)}
                            disabled={rs.loading}
                          >
                            {rs.loading ? 'Refunderer...' : 'Ja, refunder'}
                          </button>
                          <button
                            type="button"
                            className="all-orders-refund-cancel"
                            onClick={() => setOrderRefund(order.id, { confirming: false })}
                            disabled={rs.loading}
                          >
                            Avbryt
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="all-orders-refund-btn"
                          onClick={() => setOrderRefund(order.id, { confirming: true, error: '' })}
                        >
                          Refunder
                        </button>
                      )}
                      {rs.error ? <span className="all-orders-refund-error">{rs.error}</span> : null}
                    </div>
                  ) : rs.done ? (
                    <span className="all-orders-refund-done">✓ Refundert</span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
