import { useRef, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase'
import './PhotoUpload.css'

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

export default function PhotoUpload() {
  const [phone, setPhone] = useState('')
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const fileInputRef = useRef(null)

  function addFiles(newFiles) {
    const images = Array.from(newFiles).filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setFiles((prev) => [...prev, ...images])
    images.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (e) => setPreviews((prev) => [...prev, e.target.result])
      reader.readAsDataURL(file)
    })
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  function handlePhoneInput(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 8)
    setPhone(val)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (phone.length !== 8) {
      setError('Telefonnummeret må være 8 siffer.')
      return
    }
    if (files.length === 0) {
      setError('Velg minst ett bilde.')
      return
    }

    setUploading(true)
    setProgress(0)

    try {
      const imagePaths = []
      const imageUrls = {}
      const uniqueId = Date.now().toString(36)

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const path = `photos/${phone}/${uniqueId}-${i}-${sanitizeFileName(file.name)}`
        await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/jpeg' })
        const url = await getDownloadURL(ref(storage, path))
        imagePaths.push(path)
        imageUrls[path] = url
        setProgress(Math.round(((i + 1) / files.length) * 100))
      }

      await addDoc(collection(db, 'photoUploads'), {
        phone,
        imagePaths,
        imageUrls,
        uploadedAt: serverTimestamp(),
      })

      setDone(true)
    } catch (err) {
      console.error(err)
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setUploading(false)
    }
  }

  function reset() {
    setPhone('')
    setFiles([])
    setPreviews([])
    setProgress(0)
    setError('')
    setDone(false)
  }

  return (
    <div className="photo-upload-page">
      <div className="photo-upload-card">
        <p className="photo-upload-logo">Crust</p>

        {done ? (
          <div className="photo-upload-success">
            <div className="photo-upload-success-icon">✅</div>
            <h2>{files.length === 1 ? 'Bildet er lastet opp!' : 'Bildene er lastet opp!'}</h2>
            <p>Takk! Vi har mottatt {files.length === 1 ? 'bildet ditt' : `${files.length} bilder`}.</p>
            <button type="button" className="photo-upload-again" onClick={reset}>
              Last opp flere bilder
            </button>
          </div>
        ) : (
          <>
            <h1>Last opp bilder</h1>
            <p className="photo-upload-lead">
              Del bilder med oss. Skriv inn telefonnummeret ditt og velg bildene du vil sende.
            </p>

            <form onSubmit={handleSubmit}>
              <div className="photo-upload-field">
                <label htmlFor="photo-phone">Telefonnummer</label>
                <input
                  id="photo-phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="12345678"
                  value={phone}
                  onChange={handlePhoneInput}
                  disabled={uploading}
                  autoComplete="tel-national"
                />
                <span className="photo-upload-hint">8 siffer, uten +47</span>
              </div>

              <div
                className={`photo-upload-drop-zone${isDragOver ? ' is-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragOver(false)
                  addFiles(e.dataTransfer.files)
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={(e) => addFiles(e.target.files)}
                />
                <div className="photo-upload-drop-icon">📷</div>
                <p className="photo-upload-drop-text">
                  {files.length === 0 ? 'Trykk eller dra bilder hit' : `${files.length} bilde${files.length !== 1 ? 'r' : ''} valgt`}
                </p>
                <p className="photo-upload-drop-sub">JPG, PNG, HEIC · maks 20 MB per bilde</p>
              </div>

              {previews.length > 0 ? (
                <div className="photo-upload-previews">
                  {previews.map((src, i) => (
                    <div key={i} className="photo-upload-preview-item">
                      <img src={src} alt={`Bilde ${i + 1}`} />
                      {!uploading ? (
                        <button
                          type="button"
                          className="photo-upload-preview-remove"
                          onClick={() => removeFile(i)}
                          aria-label="Fjern bilde"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="submit"
                className="photo-upload-submit"
                disabled={uploading || phone.length !== 8 || files.length === 0}
              >
                {uploading ? `Laster opp... (${progress}%)` : 'Send bilder'}
              </button>

              {uploading ? (
                <div className="photo-upload-progress">
                  <div className="photo-upload-progress-bar">
                    <div className="photo-upload-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : null}

              {error ? <p className="photo-upload-error">{error}</p> : null}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
