import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import './PhotoAdmin.css'

function formatTs(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : ts instanceof Date ? ts : new Date(ts)
  return d.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' })
}

function fileNameFromPath(path, index) {
  const parts = path.split('/')
  return parts[parts.length - 1] || `bilde-${index + 1}.jpg`
}

async function downloadImages(images) {
  for (let i = 0; i < images.length; i++) {
    const { url, path } = images[i]
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = fileNameFromPath(path, i)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
      if (i < images.length - 1) await new Promise((r) => setTimeout(r, 300))
    } catch (err) {
      console.error('Download failed for', path, err)
    }
  }
}

export default function PhotoAdmin() {
  const [uploads, setUploads] = useState(null)
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState(new Set())
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'photoUploads'), orderBy('uploadedAt', 'desc')))
      .then((snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setUploads(rows)
      })
      .catch(() => setUploads([]))
  }, [])

  function toggleSelectMode() {
    setSelectMode((v) => !v)
    setSelectedPaths(new Set())
  }

  function togglePath(path) {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function selectAll(images) {
    setSelectedPaths(new Set(images.filter((img) => img.url).map((img) => img.path)))
  }

  async function handleDownload(allImages) {
    const toDownload = allImages.filter((img) => img.url && selectedPaths.has(img.path))
    if (toDownload.length === 0) return
    setDownloading(true)
    await downloadImages(toDownload)
    setDownloading(false)
  }

  const byPhone = uploads
    ? uploads.reduce((acc, row) => {
        if (!acc[row.phone]) acc[row.phone] = []
        acc[row.phone].push(row)
        return acc
      }, {})
    : null

  const phoneList = byPhone
    ? Object.entries(byPhone).sort((a, b) => {
        const aTs = a[1][0]?.uploadedAt?.seconds || 0
        const bTs = b[1][0]?.uploadedAt?.seconds || 0
        return bTs - aTs
      })
    : []

  const selectedUploads = selectedPhone ? byPhone[selectedPhone] || [] : null
  const allImages = selectedUploads
    ? selectedUploads.flatMap((u) =>
        (u.imagePaths || []).map((path) => ({
          path,
          url: u.imageUrls?.[path] || '',
          uploadedAt: u.uploadedAt,
        }))
      )
    : []

  const allSelectableCount = allImages.filter((img) => img.url).length
  const allSelected = allSelectableCount > 0 && selectedPaths.size === allSelectableCount

  return (
    <div className="photo-admin-page">
      <div className="photo-admin-header">
        <a className="photo-admin-back" href="/admin">← Tilbake til admin</a>
        <h1>Bildeopplastinger</h1>
      </div>

      {uploads === null ? (
        <p className="photo-admin-loading">Laster...</p>
      ) : selectedPhone ? (
        <div className="photo-admin-detail">
          <div className="photo-admin-detail-header">
            <button
              type="button"
              className="photo-admin-back-btn"
              onClick={() => { setSelectedPhone(null); setLightbox(null); setSelectMode(false); setSelectedPaths(new Set()) }}
            >
              ← Alle numre
            </button>
            <div style={{ flex: 1 }}>
              <h2>+47 {selectedPhone}</h2>
              <p className="photo-admin-detail-meta">
                {selectedUploads.length} innsending{selectedUploads.length !== 1 ? 'er' : ''} · {allImages.length} bilde{allImages.length !== 1 ? 'r' : ''}
              </p>
            </div>
            <div className="photo-admin-action-bar">
              {selectMode ? (
                <>
                  <button
                    type="button"
                    className="photo-admin-select-all-btn"
                    onClick={() => allSelected ? setSelectedPaths(new Set()) : selectAll(allImages)}
                  >
                    {allSelected ? 'Fjern alle' : 'Velg alle'}
                  </button>
                  <button
                    type="button"
                    className="photo-admin-download-btn"
                    disabled={selectedPaths.size === 0 || downloading}
                    onClick={() => handleDownload(allImages)}
                  >
                    {downloading ? 'Laster ned...' : `Last ned${selectedPaths.size > 0 ? ` (${selectedPaths.size})` : ''}`}
                  </button>
                  <button
                    type="button"
                    className="photo-admin-cancel-btn"
                    onClick={toggleSelectMode}
                  >
                    Avbryt
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="photo-admin-select-btn"
                  onClick={toggleSelectMode}
                >
                  Velg bilder
                </button>
              )}
            </div>
          </div>

          {selectedUploads.map((upload) => (
            <div key={upload.id} className="photo-admin-upload-group">
              <p className="photo-admin-upload-time">{formatTs(upload.uploadedAt)}</p>
              <div className="photo-admin-image-grid">
                {(upload.imagePaths || []).map((path, i) => {
                  const url = upload.imageUrls?.[path] || ''
                  const isSelected = selectedPaths.has(path)
                  return url ? (
                    <button
                      key={path}
                      type="button"
                      className={`photo-admin-thumb-btn${selectMode && isSelected ? ' is-selected' : ''}`}
                      onClick={() => {
                        if (selectMode) togglePath(path)
                        else setLightbox({ url, path })
                      }}
                    >
                      <img src={url} alt={`Bilde ${i + 1}`} loading="lazy" />
                      {selectMode ? (
                        <span className={`photo-admin-check${isSelected ? ' is-checked' : ''}`}>
                          {isSelected ? '✓' : ''}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    <div key={path} className="photo-admin-thumb-btn photo-admin-thumb-missing">
                      Mangler URL
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="photo-admin-list">
          {phoneList.length === 0 ? (
            <p className="photo-admin-empty">Ingen bildeopplastinger ennå.</p>
          ) : (
            phoneList.map(([phone, rows]) => {
              const totalImages = rows.reduce((n, r) => n + (r.imagePaths?.length || 0), 0)
              const latest = rows[0]?.uploadedAt
              return (
                <button
                  key={phone}
                  type="button"
                  className="photo-admin-phone-card"
                  onClick={() => setSelectedPhone(phone)}
                >
                  <span className="photo-admin-phone-number">+47 {phone}</span>
                  <span className="photo-admin-phone-meta">
                    {rows.length} innsending{rows.length !== 1 ? 'er' : ''} · {totalImages} bilde{totalImages !== 1 ? 'r' : ''}
                  </span>
                  <span className="photo-admin-phone-date">Siste: {formatTs(latest)}</span>
                </button>
              )
            })
          )}
        </div>
      )}

      {lightbox ? (
        <div
          className="photo-admin-lightbox"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.url} alt="Bilde" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="photo-admin-lightbox-close"
            onClick={() => setLightbox(null)}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  )
}
