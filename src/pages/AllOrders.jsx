import { useState, useEffect } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAdminSession } from '../hooks/useAdminSession'
import { Navigate } from 'react-router-dom'
import './Order.css'

const STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  paid:            'Paid',
  confirmed:       'Confirmed',
  ready:           'Ready',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
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
  alle:            'All',
  paid:            'Paid',
  confirmed:       'Confirmed',
  ready:           'Ready',
  pending_payment: 'Awaiting payment',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
}

function formatTime(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `today ${hm}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ` ${hm}`
}

export default function AllOrders() {
  const { isAdmin, loading: authLoading } = useAdminSession()
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('alle')
  const [locationFilter, setLocationFilter] = useState('all')
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

  if (authLoading) return <div className="loading-box">Loading...</div>
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
      setOrderRefund(order.id, { loading: false, confirming: false, error: err?.message || 'Refund failed' })
    }
  }

  const locations = [...new Set(orders.map((o) => o.locationName || o.locationId).filter(Boolean))].sort()

  const locationFiltered = locationFilter === 'all' ? orders : orders.filter((o) => (o.locationName || o.locationId) === locationFilter)
  const visible = filter === 'alle' ? locationFiltered : locationFiltered.filter((o) => o.status === filter)

  const counts = {}
  for (const o of locationFiltered) counts[o.status] = (counts[o.status] || 0) + 1

  return (
    <div className="order-admin-page">
      <div className="order-admin-header">
        <h1>All orders</h1>
        <a className="ghost" href="/admin">← Back to admin</a>
      </div>

      <div className="all-orders-toolbar">
        <select
          className="all-orders-location-select"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
        >
          <option value="all">All locations</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
      </div>

      <div className="all-orders-filters">
        {FILTERS.map((f) => {
          const cnt = f === 'alle' ? locationFiltered.length : (counts[f] || 0)
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
        <p className="order-loading">Loading orders...</p>
      ) : visible.length === 0 ? (
        <p className="order-admin-empty">No orders.</p>
      ) : (
        <div className="all-orders-list">
          {visible.map((order) => {
            const rs = refundState[order.id] || {}
            const canRefund = REFUNDABLE.has(order.status)
            return (
              <div key={order.id} className="all-orders-row">
                <div className="all-orders-row-main">
                  <span className="all-orders-customer">{order.customerName || '—'}</span>
                  <span className="all-orders-location">📍 {order.locationName || order.locationId || '—'}</span>
                  <span className="all-orders-total">{order.total} kr</span>
                  <span className="all-orders-phone">{order.customerPhone || ''}</span>
                  <span className={`all-orders-status ${STATUS_CLASS[order.status] || ''}`}>
                    {STATUS_LABELS[order.status] || order.status}
                  </span>
                </div>
                <div className="all-orders-row-sub">
                  <div className="all-orders-items">
                    {(order.items || []).map((item, i) => (
                      <span key={i} className="all-orders-item-chip">
                        {item.quantity}× {item.name}
                      </span>
                    ))}
                  </div>
                  <span className="all-orders-time">{formatTime(order.createdAt)}</span>
                  {canRefund && !rs.done ? (
                    <div className="all-orders-refund">
                      {rs.confirming ? (
                        <>
                          <span className="all-orders-refund-confirm-label">Refund {order.total} kr?</span>
                          <button
                            type="button"
                            className="all-orders-refund-yes"
                            onClick={() => onRefundConfirm(order)}
                            disabled={rs.loading}
                          >
                            {rs.loading ? 'Refunding...' : 'Yes, refund'}
                          </button>
                          <button
                            type="button"
                            className="all-orders-refund-cancel"
                            onClick={() => setOrderRefund(order.id, { confirming: false })}
                            disabled={rs.loading}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="all-orders-refund-btn"
                          onClick={() => setOrderRefund(order.id, { confirming: true, error: '' })}
                        >
                          Refund
                        </button>
                      )}
                      {rs.error ? <span className="all-orders-refund-error">{rs.error}</span> : null}
                    </div>
                  ) : rs.done ? (
                    <span className="all-orders-refund-done">✓ Refunded</span>
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
