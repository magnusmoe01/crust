import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, getMetadata, ref, uploadBytes } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { db, functions, storage } from '../firebase'
import { STENGESKJEMA_ID, defaultStengeskjema } from '../forms/defaultForms'
import { useAdminSession } from '../hooks/useAdminSession'
import './Forms.css'

const LOCATION_OTHER_VALUE = '__other_location__'
const FORM_DRAFT_STORAGE_PREFIX = 'crust-form-draft:'
const FORM_LANGUAGE_STORAGE_KEY = 'crust-public-form-language'
const ENGLISH_TRANSLATION_CACHE_KEY = 'crust-public-form-english-cache'
const SUBMISSION_DATE_KEY = 'Innsendt dato'
const SUBMISSION_TIME_KEY = 'Innsendt tid'
const SELECT_DETAIL_SUFFIX = '__details'
const IMAGE_CAPTURED_AT_SUFFIX = '__capturedAt'
const SELF_DECLARATION_ACCEPTED_KEY = 'Egenerklæring bekreftet'
const SELECT_OPTION_HISTORY_CATEGORIES = ['normal', 'orange', 'red']
const RECEIPT_EDIT_WINDOW_MS = 30 * 60 * 1000
const MAX_UPLOADED_IMAGE_BYTES = 500 * 1024
const MAX_UPLOADED_IMAGE_DIMENSION = 1600
const IMAGE_COMPRESSION_QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5]
const IMAGE_COMPRESSION_SCALES = [1, 0.9, 0.8, 0.7]
const PUBLIC_FORM_COPY = {
  no: {
    languageLabel: 'Språk',
    norwegian: 'Norsk',
    english: 'English',
    translating: 'Oversetter skjemaet til engelsk...',
    translatingHint: 'Dette kan ta noen sekunder.',
    translationError: 'Kunne ikke oversette alt akkurat nå. Noe vises fortsatt på norsk.',
    formEyebrow: 'Skjema',
    receiptEyebrow: 'Kvittering',
    receiptLead: 'Her er en kopi av akkurat denne innsendingen.',
    receiptTitlePrefix: 'Takk,',
    receiptTitleSuffix: 'er sendt inn',
    submissionLabel: 'Innsending',
    submittedLabel: 'Sendt inn',
    loadingImage: 'Laster bilde...',
    loadingForm: 'Laster skjema...',
    loadingReceipt: 'Laster kvittering...',
    preparingReceipt: 'Sender skjemaet og klargjør kvittering...',
    preparingReceiptHint: 'Ikke lukk eller oppdater siden. Kvitteringen åpnes automatisk.',
    editSubmission: 'Rediger',
    editWindowExpired: 'Redigeringsfristen på 30 minutter er utløpt.',
    editingSubmission: 'Du redigerer en tidligere innsending.',
    resetAnswers: 'Nullstill alle svar',
    resetAnswersConfirm: 'Nullstill alle svar i skjemaet?',
    sendForm: 'Send skjema',
    sendingForm: 'Sender skjema...',
    formSent: 'Skjema sendt inn',
    select: 'Velg',
    loadingLocations: 'Laster lokasjoner...',
    chooseLocation: 'Velg lokasjon',
    other: 'Annet',
    noLocationsHelp: 'Ingen lagrede lokasjoner funnet. Velg "Annet" for å skrive inn manuelt.',
    writeHere: 'Skriv her',
    enterLocation: 'Skriv inn lokasjon',
    takePhoto: 'Ta bilde',
    uploadNewPhoto: 'Last opp nytt bilde',
    uploadingPhoto: 'Laster opp bilde...',
    uploadAdditionalPhoto: 'Last opp flere bilder',
    waitForPhotoUpload: 'Vent til bildeopplastingen er ferdig før du sender inn.',
    describeMore: 'Beskriv nærmere',
    fullName: 'Fullt navn',
    phoneNumber: 'Telefonnummer',
    phoneNumberPlaceholder: '8 siffer',
    phoneNumberHelp: 'Oppgi 8 sifre uten +47.',
    phoneMustBeEightDigits: 'Telefonnummer må være 8 sifre uten +47.',
    emailAddress: 'E-postadresse',
    selfDeclarationFallback: 'Jeg bekrefter opplysningene i skjemaet.',
    confirmSelfDeclaration: 'Jeg bekrefter egenerklæringen',
    goToQuestion: 'Gå til spørsmålet',
    optionalNote: ' (ikke obligatorisk)',
  },
  en: {
    languageLabel: 'Language',
    norwegian: 'Norwegian',
    english: 'English',
    translating: 'Translating the form to English...',
    translatingHint: 'This can take a few seconds.',
    translationError: 'Could not translate everything right now. Some text is still shown in Norwegian.',
    formEyebrow: 'Form',
    receiptEyebrow: 'Receipt',
    receiptLead: 'Here is a copy of this exact submission.',
    receiptTitlePrefix: 'Thanks,',
    receiptTitleSuffix: 'has been submitted',
    submissionLabel: 'Submission',
    submittedLabel: 'Submitted',
    loadingImage: 'Laster bilde...',
    loadingForm: 'Loading form...',
    loadingReceipt: 'Loading receipt...',
    preparingReceipt: 'Submitting the form and preparing your receipt...',
    preparingReceiptHint: 'Do not close or refresh this page. The receipt will open automatically.',
    editSubmission: 'Edit',
    editWindowExpired: 'The 30-minute edit window has expired.',
    editingSubmission: 'You are editing a previous submission.',
    resetAnswers: 'Reset all answers',
    resetAnswersConfirm: 'Reset all answers in the form?',
    sendForm: 'Submit form',
    sendingForm: 'Submitting form...',
    formSent: 'Form submitted',
    select: 'Choose',
    loadingLocations: 'Loading locations...',
    chooseLocation: 'Choose location',
    other: 'Other',
    noLocationsHelp: 'No saved locations were found. Choose "Other" to enter one manually.',
    writeHere: 'Write here',
    enterLocation: 'Enter location',
    takePhoto: 'Take photo',
    uploadNewPhoto: 'Upload a new photo',
    uploadingPhoto: 'Uploading image...',
    uploadAdditionalPhoto: 'Upload additional image',
    waitForPhotoUpload: 'Wait for the image upload to finish before submitting.',
    describeMore: 'Describe in more detail',
    fullName: 'Full name',
    phoneNumber: 'Phone number',
    phoneNumberPlaceholder: '8 digits',
    phoneNumberHelp: 'Enter 8 digits without +47.',
    phoneMustBeEightDigits: 'Phone number must be 8 digits without +47.',
    emailAddress: 'Email address',
    selfDeclarationFallback: 'I confirm the information in the form.',
    confirmSelfDeclaration: 'I confirm the self-declaration',
    goToQuestion: 'Go to question',
    optionalNote: ' (optional)',
  },
}

function toQuestionId(raw) {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) {
    return `question-${Math.random().toString(36).slice(2, 8)}`
  }
  return base
}

function escapePendingWindowHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderPendingReceiptWindow(receiptWindow, { lang = 'no', title, headline, hint }) {
  if (!receiptWindow || receiptWindow.closed) {
    return
  }

  try {
    const safeTitle = escapePendingWindowHtml(title)
    const safeHeadline = escapePendingWindowHtml(headline)
    const safeHint = escapePendingWindowHtml(hint)
    const documentLanguage = lang === 'en' ? 'en' : 'no'

    receiptWindow.document.open()
    receiptWindow.document.write(`<!doctype html>
<html lang="${documentLanguage}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #182c3c;
        --surface: #fff4e8;
        --background: linear-gradient(180deg, #fffaf4 0%, #f6ead9 100%);
        --border: rgba(24, 44, 60, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
        background: var(--background);
        color: var(--ink);
      }

      .card {
        width: min(420px, 100%);
        padding: 28px 24px;
        border-radius: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        box-shadow: 0 22px 46px rgba(24, 44, 60, 0.16);
        text-align: center;
      }

      .spinner {
        width: 56px;
        height: 56px;
        margin: 0 auto 18px;
        border-radius: 999px;
        border: 4px solid rgba(24, 44, 60, 0.14);
        border-top-color: var(--ink);
        animation: spin 0.9s linear infinite;
      }

      h1 {
        margin: 0 0 10px;
        font-size: clamp(1.3rem, 4vw, 1.8rem);
        line-height: 1.15;
      }

      p {
        margin: 0;
        font-size: 1rem;
        line-height: 1.5;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <main class="card" role="status" aria-live="polite" aria-busy="true">
      <div class="spinner" aria-hidden="true"></div>
      <h1>${safeHeadline}</h1>
      <p>${safeHint}</p>
    </main>
  </body>
</html>`)
    receiptWindow.document.close()
  } catch (error) {
    console.error('Failed to render pending receipt window', error)
  }
}

function sanitizeFileName(name) {
  return String(name || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
}

function formatDateForFilename(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}_${hh}${min}`
}

async function readImageCapturedAtDate(file) {
  if (!file) return null
  try {
    const exifDate = extractExifCapturedAt(await file.arrayBuffer())
    if (exifDate) return exifDate
  } catch {}
  if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
    return new Date(file.lastModified)
  }
  return null
}

function createTemporaryImageUploadPath(formSlug, questionId, fileName, options = {}) {
  const detailSuffix = options.detail ? '-detail' : ''
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const capturedAtPart = options.capturedAt ? `${formatDateForFilename(options.capturedAt)}-` : ''
  return `forms/images/${formSlug}/${questionId}${detailSuffix}-${capturedAtPart}${uniqueId}-${sanitizeFileName(fileName)}`
}

function normalizeNorwegianPhoneNumber(value) {
  const digits = String(value || '').replace(/\D+/g, '')
  const withoutCountryCode = digits.length > 8 && digits.startsWith('47') ? digits.slice(2) : digits
  return withoutCountryCode.slice(0, 8)
}

function isValidNorwegianPhoneNumber(value) {
  return /^[0-9]{8}$/.test(normalizeNorwegianPhoneNumber(value))
}

function normalizeWarningCategories(rawCategories) {
  const values = Array.isArray(rawCategories)
    ? rawCategories
    : typeof rawCategories === 'string'
      ? rawCategories.split(',')
      : []

  const seen = new Set()

  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const normalized = value.toLowerCase()
      if (seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })
    .sort((a, b) => a.localeCompare(b, 'nb'))
}

function createWarningDraft(category = '') {
  return {
    id: `warning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: String(category || '').trim(),
    comment: '',
  }
}

function normalizeSubmissionWarningEntry(entry) {
  const category = String(entry?.category || '').trim()
  if (!category) {
    return null
  }

  return {
    category,
    comment: String(entry?.comment || '').trim(),
    recordedAt: entry?.recordedAt || null,
    recordedBy: String(entry?.recordedBy || '').trim(),
  }
}

function getSubmissionWarnings(submission) {
  const normalizedWarnings = Array.isArray(submission?.warnings)
    ? submission.warnings.map((entry) => normalizeSubmissionWarningEntry(entry)).filter(Boolean)
    : []

  if (normalizedWarnings.length > 0) {
    return normalizedWarnings
  }

  if (submission?.warningRegistered || String(submission?.warningCategory || '').trim()) {
    return [
      {
        category: String(submission?.warningCategory || '').trim() || 'Uten kategori',
        comment: '',
        recordedAt: submission?.warningRecordedAt || null,
        recordedBy: String(submission?.warningRecordedBy || '').trim(),
      },
    ]
  }

  return []
}

function normalizeManualRemarkEntry(entry) {
  const phone = normalizeNorwegianPhoneNumber(entry?.phone)
  const category = String(entry?.category || '').trim()
  if (!phone || !category) {
    return null
  }

  const images = Array.from(
    new Set(
      [
        ...(Array.isArray(entry?.images) ? entry.images : []),
        ...(Array.isArray(entry?.imagePaths) ? entry.imagePaths : []),
        entry?.imagePath,
        entry?.imageUrl,
      ]
        .map((value) => {
          if (typeof value === 'string') {
            return value.trim()
          }

          if (value && typeof value === 'object') {
            if (typeof value.path === 'string') {
              return value.path.trim()
            }
            if (typeof value.url === 'string') {
              return value.url.trim()
            }
          }

          return ''
        })
        .filter((value) => isPersistedImageValue(value)),
    ),
  )

  return {
    phone,
    name: String(entry?.name || '').trim(),
    category,
    comment: String(entry?.comment || '').trim(),
    images,
    recordedAt: entry?.recordedAt || null,
    recordedBy: String(entry?.recordedBy || '').trim(),
  }
}

function parseQuestionOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .map((option) => String(option || '').trim())
      .filter((option) => option.length > 0)
  }

  if (typeof rawOptions === 'string') {
    return rawOptions
      .split(',')
      .map((option) => option.trim())
      .filter((option) => option.length > 0)
  }

  return []
}

function normalizeVisibleForLocations(rawLocations) {
  const values = Array.isArray(rawLocations)
    ? rawLocations
    : typeof rawLocations === 'string'
      ? rawLocations.split(',')
      : []

  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  )
}

function readPreferredPublicFormLanguage() {
  if (typeof window === 'undefined') {
    return 'no'
  }

  try {
    return window.localStorage.getItem(FORM_LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'no'
  } catch {
    return 'no'
  }
}

function writePreferredPublicFormLanguage(language) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(FORM_LANGUAGE_STORAGE_KEY, language === 'en' ? 'en' : 'no')
  } catch {}
}

function readEnglishTranslationCache() {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const stored = window.localStorage.getItem(ENGLISH_TRANSLATION_CACHE_KEY)
    if (!stored) {
      return {}
    }

    const parsed = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeEnglishTranslationCache(cache) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(ENGLISH_TRANSLATION_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

function collectFormTranslationTexts(form) {
  const textSet = new Set()

  function addText(value) {
    const text = String(value || '').trim()
    if (text) {
      textSet.add(text)
    }
  }

  addText(form?.title)
  addText(form?.description)
  addText(form?.selfDeclarationText)

  ;(form?.questions || []).forEach((question) => {
    addText(question?.label)
    addText(question?.placeholder)
    ;(question?.options || []).forEach((option) => addText(option))

    if (question?.selectOptionDetails && typeof question.selectOptionDetails === 'object') {
      Object.values(question.selectOptionDetails).forEach((detail) => {
        addText(detail?.text)
      })
    }
  })

  return Array.from(textSet)
}

async function translateNorwegianTextToEnglish(text, signal) {
  const value = String(text || '').trim()
  if (!value) {
    return ''
  }

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'no',
    tl: 'en',
    dt: 't',
    q: value,
  })

  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    signal,
  })

  if (!response.ok) {
    throw new Error(`Translate request failed (${response.status})`)
  }

  const payload = await response.json()
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => String(part?.[0] || '')).join('').trim()
    : ''

  return translated || value
}

async function translateTextToNorwegian(text, signal) {
  const value = String(text || '').trim()
  if (!value) {
    return ''
  }

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'no',
    dt: 't',
    q: value,
  })

  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    signal,
  })

  if (!response.ok) {
    throw new Error(`Translate request failed (${response.status})`)
  }

  const payload = await response.json()
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => String(part?.[0] || '')).join('').trim()
    : ''

  return translated || value
}

const NORWEGIAN_TRANSLATION_CACHE_KEY = 'crust-public-form-norwegian-cache'

function readNorwegianTranslationCache() {
  try {
    const raw = window.localStorage.getItem(NORWEGIAN_TRANSLATION_CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeNorwegianTranslationCache(translations) {
  try {
    window.localStorage.setItem(NORWEGIAN_TRANSLATION_CACHE_KEY, JSON.stringify(translations))
  } catch {}
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

function replaceFileExtension(fileName, nextExtension) {
  const normalizedFileName = String(fileName || 'image').trim() || 'image'
  const baseName = normalizedFileName.replace(/\.[^.]+$/, '')
  return `${baseName}${nextExtension}`
}

function getImageOutputExtension(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    default:
      return '.jpg'
  }
}

function fitImageWithinBounds(width, height, maxDimension) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }

  if (Math.max(width, height) <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const scale = maxDimension / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function loadImageFromObjectUrl(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load image'))
    image.src = objectUrl
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('Could not encode image'))
    }, type, quality)
  })
}

async function compressUploadedImage(file) {
  if (!(file instanceof File)) {
    return file
  }

  const inputType = String(file.type || '').trim().toLowerCase()
  if (!inputType.startsWith('image/') || inputType === 'image/gif' || inputType === 'image/svg+xml') {
    return file
  }

  const outputType = inputType === 'image/png' ? 'image/png' : 'image/jpeg'
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await loadImageFromObjectUrl(objectUrl)
    const naturalWidth = image.naturalWidth || image.width || 0
    const naturalHeight = image.naturalHeight || image.height || 0
    const boundedSize = fitImageWithinBounds(
      naturalWidth,
      naturalHeight,
      MAX_UPLOADED_IMAGE_DIMENSION,
    )

    if (!boundedSize.width || !boundedSize.height) {
      return file
    }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      return file
    }

    let bestBlob = null

    // Try a few quality and scale combinations and keep the smallest result.
    for (const scale of IMAGE_COMPRESSION_SCALES) {
      const width = Math.max(1, Math.round(boundedSize.width * scale))
      const height = Math.max(1, Math.round(boundedSize.height * scale))

      canvas.width = width
      canvas.height = height
      context.clearRect(0, 0, width, height)

      if (outputType === 'image/jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
      }

      context.drawImage(image, 0, 0, width, height)

      for (const quality of IMAGE_COMPRESSION_QUALITIES) {
        const blob = await canvasToBlob(
          canvas,
          outputType,
          outputType === 'image/png' ? undefined : quality,
        )

        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob
        }

        if (blob.size <= MAX_UPLOADED_IMAGE_BYTES) {
          return new File([blob], replaceFileExtension(file.name, getImageOutputExtension(outputType)), {
            type: outputType,
            lastModified: file.lastModified,
          })
        }
      }
    }

    if (bestBlob && bestBlob.size < file.size) {
      return new File([bestBlob], replaceFileExtension(file.name, getImageOutputExtension(outputType)), {
        type: outputType,
        lastModified: file.lastModified,
      })
    }

    return file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function getImageCapturedAtAnswerKey(answerKey) {
  return `${answerKey}${IMAGE_CAPTURED_AT_SUFFIX}`
}

function formatImageCapturedAtValue(date) {
  return date.toLocaleString('nb-NO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Oslo',
  })
}

function readAsciiValue(view, offset, length) {
  if (!Number.isFinite(offset) || offset < 0 || offset >= view.byteLength) {
    return ''
  }

  const safeLength = Math.max(0, Math.min(length, view.byteLength - offset))
  let value = ''
  for (let index = 0; index < safeLength; index += 1) {
    const code = view.getUint8(offset + index)
    if (code === 0) {
      break
    }
    value += String.fromCharCode(code)
  }
  return value
}

function parseExifDateTimeString(rawValue) {
  const match = String(rawValue || '').trim().match(
    /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  )
  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute, second] = match
  const parsedDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function readExifAsciiTag(view, tiffStart, ifdOffset, littleEndian, targetTag) {
  if (!Number.isFinite(ifdOffset) || ifdOffset < 0 || ifdOffset + 2 > view.byteLength) {
    return ''
  }

  const entryCount = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (entryOffset + 12 > view.byteLength) {
      break
    }

    const tag = view.getUint16(entryOffset, littleEndian)
    if (tag !== targetTag) {
      continue
    }

    const type = view.getUint16(entryOffset + 2, littleEndian)
    const count = view.getUint32(entryOffset + 4, littleEndian)
    if (type !== 2 || count === 0) {
      return ''
    }

    const valueOffset = count <= 4
      ? entryOffset + 8
      : tiffStart + view.getUint32(entryOffset + 8, littleEndian)

    return readAsciiValue(view, valueOffset, count)
  }

  return ''
}

function readExifLongTag(view, ifdOffset, littleEndian, targetTag) {
  if (!Number.isFinite(ifdOffset) || ifdOffset < 0 || ifdOffset + 2 > view.byteLength) {
    return null
  }

  const entryCount = view.getUint16(ifdOffset, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (entryOffset + 12 > view.byteLength) {
      break
    }

    const tag = view.getUint16(entryOffset, littleEndian)
    if (tag !== targetTag) {
      continue
    }

    const type = view.getUint16(entryOffset + 2, littleEndian)
    const count = view.getUint32(entryOffset + 4, littleEndian)
    if (type !== 4 || count !== 1) {
      return null
    }

    return view.getUint32(entryOffset + 8, littleEndian)
  }

  return null
}

function extractExifCapturedAt(fileBuffer) {
  const view = new DataView(fileBuffer)
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return null
  }

  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      break
    }

    const marker = view.getUint8(offset + 1)
    if (marker === 0xda || marker === 0xd9) {
      break
    }

    const segmentLength = view.getUint16(offset + 2, false)
    if (segmentLength < 2 || offset + 2 + segmentLength > view.byteLength) {
      break
    }

    if (marker === 0xe1) {
      const exifHeaderOffset = offset + 4
      if (readAsciiValue(view, exifHeaderOffset, 6) === 'Exif') {
        const tiffStart = exifHeaderOffset + 6
        const endianMarker = readAsciiValue(view, tiffStart, 2)
        const littleEndian =
          endianMarker === 'II' ? true : endianMarker === 'MM' ? false : null

        if (littleEndian == null || view.getUint16(tiffStart + 2, littleEndian) !== 42) {
          return null
        }

        const firstIfdOffset = tiffStart + view.getUint32(tiffStart + 4, littleEndian)
        const exifIfdPointer = readExifLongTag(view, firstIfdOffset, littleEndian, 0x8769)

        const exifDateValue =
          (Number.isFinite(exifIfdPointer)
            ? readExifAsciiTag(
                view,
                tiffStart,
                tiffStart + exifIfdPointer,
                littleEndian,
                0x9003,
              )
            : '') ||
          readExifAsciiTag(view, tiffStart, firstIfdOffset, littleEndian, 0x0132)

        return parseExifDateTimeString(exifDateValue)
      }
    }

    offset += 2 + segmentLength
  }

  return null
}

async function readImageCapturedAtValue(file) {
  if (!file) {
    return ''
  }

  try {
    const exifDate = extractExifCapturedAt(await file.arrayBuffer())
    if (exifDate) {
      return formatImageCapturedAtValue(exifDate)
    }
  } catch {
    // Fall back to file metadata if EXIF cannot be read.
  }

  if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
    return formatImageCapturedAtValue(new Date(file.lastModified))
  }

  return ''
}

function toEditorQuestion(question, index) {
  const normalized = normalizeQuestion(question, index)
  return {
    ...normalized,
    imagePreviewUrl: normalized.imageUrl || '',
    imageFile: null,
    removeImage: false,
    moveTarget: '',
    optionsText:
      normalized.type === 'select'
        ? typeof question?.optionsText === 'string'
          ? question.optionsText
          : normalized.options.join(', ')
        : '',
  }
}

function isSectionQuestion(question) {
  return question?.type === 'section'
}

function normalizeImageZoom(rawZoom) {
  const parsed = Number(rawZoom)
  if (!Number.isFinite(parsed)) {
    return 1
  }

  return Math.min(2.5, Math.max(0.5, Math.round(parsed * 100) / 100))
}

function normalizeQuestion(question, index) {
  const label = String(question?.label || '').trim()
  const fallbackLabel = `Spørsmål ${index + 1}`
  const type = ['text', 'textarea', 'select', 'location', 'number', 'date', 'time-start', 'time-end', 'camera', 'multi-camera', 'name', 'phone', 'email', 'section'].includes(question?.type)
    ? question.type
    : 'text'
  const options = type === 'select' ? parseQuestionOptions(question?.options) : []
  const legacySelectDetailEnabled = Boolean(question?.selectDetailEnabled)
  const selectOptionDetails =
    type === 'select'
      ? options.reduce((accumulator, option) => {
          const rawDetail =
            question?.selectOptionDetails && typeof question.selectOptionDetails === 'object'
              ? question.selectOptionDetails[option]
              : null
          const rawKind = rawDetail?.kind || rawDetail?.type || ''
          const kind = ['input', 'message', 'camera'].includes(rawKind)
            ? rawKind
            : legacySelectDetailEnabled
              ? 'input'
              : 'none'

          accumulator[option] = {
            kind,
            text:
              typeof rawDetail?.text === 'string'
                ? rawDetail.text
                : legacySelectDetailEnabled && kind === 'input'
                  ? 'Beskriv nærmere'
                  : '',
            messageColor: typeof rawDetail?.messageColor === 'string' ? rawDetail.messageColor : '',
            messageBold: Boolean(rawDetail?.messageBold),
            historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(rawDetail?.historyCategory)
              ? rawDetail.historyCategory
              : 'normal',
          }

          return accumulator
        }, {})
      : {}

  return {
    id: question?.id ? toQuestionId(question.id) : toQuestionId(label || `q-${index + 1}`),
    label: label || fallbackLabel,
    type,
    required: type === 'section' ? false : Boolean(question?.required),
    placeholder: String(question?.placeholder || ''),
    imageUrl: String(question?.imageUrl || '').trim(),
    imageZoom: normalizeImageZoom(question?.imageZoom),
    includeInAnalysis: type === 'section' ? false : Boolean(question?.includeInAnalysis),
    excludeFromLocationStatus: type === 'section' ? false : Boolean(question?.excludeFromLocationStatus),
    includeInReview: type === 'section' ? false : Boolean(question?.includeInReview),
    reviewType: type === 'section' ? '' : (String(question?.reviewType || '').trim() || (question?.includeInReview ? 'rating' : '')),
    includeRating: type === 'section' ? false : Boolean(question?.includeRating),
    shouldRestock: type === 'section' ? false : Boolean(question?.shouldRestock),
    isIceProductionCount: type === 'section' ? false : Boolean(question?.isIceProductionCount),
    reviewHelpText: type === 'section' ? '' : String(question?.reviewHelpText || '').trim(),
    analysisLabel: type === 'section' ? '' : String(question?.analysisLabel || '').trim(),
    deliveryUnlimited: type === 'select' ? Boolean(question?.deliveryUnlimited) || !question?.deliveryMaxUnits : true,
    deliveryMaxUnits:
      type === 'select' && Number.isFinite(Number(question?.deliveryMaxUnits)) && Number(question?.deliveryMaxUnits) > 0
        ? String(question.deliveryMaxUnits)
        : '',
    helpTextColor: String(question?.helpTextColor || '').trim(),
    helpTextBold: Boolean(question?.helpTextBold),
    visibleForLocations: type === 'location' ? [] : normalizeVisibleForLocations(question?.visibleForLocations),
    selectOptionDetails,
    options,
  }
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '-'
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })
  }
  if (timestamp instanceof Date) {
    return timestamp.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })
  }
  return '-'
}

function getReceiptEditState(submittedAtIso) {
  const submittedAtMs = submittedAtIso ? Date.parse(submittedAtIso) : Number.NaN
  if (!Number.isFinite(submittedAtMs)) {
    return {
      allowed: false,
      remainingMs: 0,
    }
  }

  const remainingMs = submittedAtMs + RECEIPT_EDIT_WINDOW_MS - Date.now()
  return {
    allowed: remainingMs > 0,
    remainingMs: Math.max(0, remainingMs),
  }
}

function toDateValue(timestamp) {
  if (!timestamp) {
    return null
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  return date instanceof Date ? date : null
}

function getDatePart(timestamp) {
  const date = toDateValue(timestamp)
  if (!date) {
    return '-'
  }
  return date.toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })
}

function getClockPart(timestamp) {
  const date = toDateValue(timestamp)
  if (!date) {
    return '-'
  }
  return date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
}

function getSubmissionDayKey(timestamp) {
  if (!timestamp) {
    return ''
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  if (!(date instanceof Date)) {
    return ''
  }
  // Use Oslo timezone so the day key is always correct regardless of viewer's locale
  return date.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' }) // gives "YYYY-MM-DD"
}

function getSubmissionMonthKey(timestamp) {
  if (!timestamp) {
    return ''
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  if (!(date instanceof Date)) {
    return ''
  }

  const yyyyMM = date.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' }).slice(0, 7) // "YYYY-MM"
  return yyyyMM
}

function getTimestampSeconds(timestamp) {
  if (!timestamp) {
    return 0
  }

  if (typeof timestamp?.seconds === 'number') {
    return timestamp.seconds
  }

  if (typeof timestamp?.toDate === 'function') {
    const date = timestamp.toDate()
    return date instanceof Date ? Math.floor(date.getTime() / 1000) : 0
  }

  if (timestamp instanceof Date) {
    return Math.floor(timestamp.getTime() / 1000)
  }

  return 0
}

function formatSubmissionDayLabel(dayKey) {
  if (!dayKey) {
    return 'Alle dager'
  }

  const [year, month, day] = dayKey.split('-').map((value) => Number(value))
  if (!year || !month || !day) {
    return dayKey
  }

  return new Date(year, month - 1, day).toLocaleDateString('nb-NO')
}

function formatSubmissionMonthLabel(monthKey) {
  if (!monthKey) {
    return 'Unknown month'
  }

  const [year, month] = monthKey.split('-').map((value) => Number(value))
  if (!year || !month) {
    return monthKey
  }

  const label = new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function getSubmissionName(answers, questions = []) {
  const nameQuestion = questions.find((question) => question.type === 'name')
  if (nameQuestion?.id && answers?.[nameQuestion.id] && String(answers[nameQuestion.id]).trim()) {
    return String(answers[nameQuestion.id]).trim()
  }

  const phoneQuestion = questions.find((question) => question.type === 'phone')
  if (phoneQuestion?.id && answers?.[phoneQuestion.id] && String(answers[phoneQuestion.id]).trim()) {
    return String(answers[phoneQuestion.id]).trim()
  }

  const candidates = ['navn', 'name', 'fullName', 'fullname']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return '-'
}

function getSubmissionEmail(answers, questions = []) {
  const emailQuestion = questions.find((question) => question.type === 'email')
  if (emailQuestion?.id && answers?.[emailQuestion.id] && String(answers[emailQuestion.id]).trim()) {
    return String(answers[emailQuestion.id]).trim()
  }

  const candidates = ['epost', 'e-post', 'email', 'mail']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return ''
}

function getIceProductionRate(answers, questions = []) {
  const startQuestion = questions.find((q) => q.type === 'time-start')
  const endQuestion = questions.find((q) => q.type === 'time-end')
  const countQuestion = questions.find((q) => q.isIceProductionCount)
  if (!startQuestion || !endQuestion || !countQuestion) return null

  const startValue = String(answers?.[startQuestion.id] || '').trim()
  const endValue = String(answers?.[endQuestion.id] || '').trim()
  const countValue = Number(answers?.[countQuestion.id])
  if (!startValue || !endValue || !Number.isFinite(countValue) || countValue <= 0) return null

  const [startH, startM] = startValue.split(':').map(Number)
  const [endH, endM] = endValue.split(':').map(Number)
  if (!Number.isFinite(startH) || !Number.isFinite(startM)) return null
  if (!Number.isFinite(endH) || !Number.isFinite(endM)) return null

  let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM)
  if (totalMinutes <= 0) totalMinutes += 24 * 60
  const hours = totalMinutes / 60
  const rate = countValue / hours

  return {
    count: countValue,
    hours: Math.round(hours * 100) / 100,
    rate: Math.round(rate * 10) / 10,
    startTime: startValue,
    endTime: endValue,
  }
}

function getSubmissionPhone(answers, questions = []) {
  const phoneQuestion = questions.find((question) => question.type === 'phone')
  if (phoneQuestion?.id && answers?.[phoneQuestion.id] && String(answers[phoneQuestion.id]).trim()) {
    return normalizeNorwegianPhoneNumber(answers[phoneQuestion.id])
  }

  const candidates = ['telefon', 'telefonnummer', 'phone', 'phoneNumber', 'tlf', 'mobil']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return normalizeNorwegianPhoneNumber(answers[key])
    }
  }

  return ''
}

function getSubmissionPlace(answers) {
  const candidates = ['sted', 'location', 'lokasjon', 'place']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return '-'
}

function getSubmissionLocation(answers, questions = []) {
  const locationQuestion = questions.find((question) => question.type === 'location')
  if (locationQuestion?.id && answers?.[locationQuestion.id] && String(answers[locationQuestion.id]).trim()) {
    return String(answers[locationQuestion.id]).trim()
  }

  return getSubmissionPlace(answers)
}

function getSelectedFormLocation(questions = [], answers = {}, locationOtherAnswers = {}) {
  const locationQuestion = questions.find((question) => question.type === 'location')
  if (!locationQuestion?.id) {
    return ''
  }

  const answerValue = answers?.[locationQuestion.id]
  if (answerValue === LOCATION_OTHER_VALUE) {
    return String(locationOtherAnswers?.[locationQuestion.id] || '').trim()
  }

  return String(answerValue || '').trim()
}

function isQuestionVisibleForLocation(question, selectedLocationName) {
  if (!question || question.type === 'location') {
    return true
  }

  const visibleForLocations = normalizeVisibleForLocations(question.visibleForLocations)
  if (visibleForLocations.length === 0) {
    return true
  }

  const normalizedSelectedLocation = String(selectedLocationName || '').trim().toLowerCase()
  if (!normalizedSelectedLocation) {
    return false
  }

  return visibleForLocations.some(
    (locationName) => String(locationName || '').trim().toLowerCase() === normalizedSelectedLocation,
  )
}

function getVisibleFormQuestions(questions = [], selectedLocationName = '') {
  return questions.filter((question, index) => {
    if (isSectionQuestion(question)) {
      let nextIndex = index + 1

      // Allow multiple consecutive section headers to stack above the same question group.
      while (nextIndex < questions.length && isSectionQuestion(questions[nextIndex])) {
        nextIndex += 1
      }

      for (; nextIndex < questions.length; nextIndex += 1) {
        const nextQuestion = questions[nextIndex]
        if (isSectionQuestion(nextQuestion)) {
          break
        }
        if (isQuestionVisibleForLocation(nextQuestion, selectedLocationName)) {
          return true
        }
      }
      return false
    }

    return isQuestionVisibleForLocation(question, selectedLocationName)
  })
}

function isStorageImagePath(value) {
  return typeof value === 'string' && (value.startsWith('forms/images/') || value.startsWith('forms/remarks/'))
}

function isDirectImageUrl(value) {
  const normalizedValue = String(value || '').trim()
  return (
    normalizedValue.startsWith('data:image/') ||
    normalizedValue.startsWith('blob:') ||
    /^https?:\/\//i.test(normalizedValue)
  )
}

function isPersistedImageValue(value) {
  return isStorageImagePath(value) || isDirectImageUrl(value)
}

function parseMultiCameraAnswer(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()) : []
  } catch {
    return []
  }
}

function getPathFileName(value) {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return ''
  }

  const pathWithoutQuery = normalizedValue.split('#')[0].split('?')[0]
  const segments = pathWithoutQuery.split('/').filter(Boolean)
  const fileName = segments[segments.length - 1] || ''

  try {
    return decodeURIComponent(fileName)
  } catch {
    return fileName
  }
}

function looksLikeImageFileName(value) {
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(getPathFileName(value))
}

function getSubmissionImageOwnerId(submission) {
  return String(submission?.submissionId || submission?.id || '').trim()
}

function findSubmissionImagePath(answerKey, value, submission, questions = []) {
  if (isStorageImagePath(value)) {
    return String(value)
  }

  const fileName = getPathFileName(value)
  if (!fileName) {
    return ''
  }

  const imagePaths = Array.isArray(submission?.imagePaths) ? submission.imagePaths : []
  if (imagePaths.length === 0) {
    return ''
  }

  const question = getQuestionForAnswerKey(answerKey, questions)
  const isDetailAnswer = String(answerKey || '').trim().endsWith(SELECT_DETAIL_SUFFIX)
  const submissionOwnerId = getSubmissionImageOwnerId(submission)
  const preferredPrefix =
    submissionOwnerId && question?.id
      ? `${submissionOwnerId}-${question.id}-${isDetailAnswer ? 'detail-' : ''}`
      : ''

  const matchingPaths = imagePaths.filter((path) => getPathFileName(path) === fileName)
  if (matchingPaths.length === 1) {
    return matchingPaths[0]
  }

  if (preferredPrefix) {
    const preferredMatch = imagePaths.find((path) => {
      const pathFileName = getPathFileName(path)
      return (
        pathFileName.startsWith(preferredPrefix) &&
        (pathFileName === fileName || pathFileName.endsWith(`-${fileName}`))
      )
    })
    if (preferredMatch) {
      return preferredMatch
    }
  }

  const suffixMatches = imagePaths.filter((path) => getPathFileName(path).endsWith(`-${fileName}`))
  if (suffixMatches.length === 1) {
    return suffixMatches[0]
  }

  return ''
}

function getAnswerImageDetails(answerKey, value, submission, imageUrls, questions = []) {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return { isImageAnswer: false, imageUrl: '', fileLabel: '' }
  }

  if (isDirectImageUrl(normalizedValue)) {
    return {
      isImageAnswer: true,
      imageUrl: normalizedValue,
      fileLabel: getPathFileName(normalizedValue) || 'Open image',
    }
  }

  const imagePath = findSubmissionImagePath(answerKey, normalizedValue, submission, questions)
  if (imagePath) {
    const fileName = getPathFileName(imagePath)
    const question = getQuestionForAnswerKey(answerKey, questions)
    const submissionOwnerId = getSubmissionImageOwnerId(submission)
    const detailPrefix =
      submissionOwnerId && question?.id ? `${submissionOwnerId}-${question.id}-detail-` : ''
    const standardPrefix =
      submissionOwnerId && question?.id ? `${submissionOwnerId}-${question.id}-` : ''
    let fileLabel = fileName

    if (detailPrefix && fileName.startsWith(detailPrefix)) {
      fileLabel = fileName.slice(detailPrefix.length)
    } else if (standardPrefix && fileName.startsWith(standardPrefix)) {
      fileLabel = fileName.slice(standardPrefix.length)
    } else if (!isStorageImagePath(normalizedValue)) {
      fileLabel = getPathFileName(normalizedValue) || fileName
    }

    return {
      isImageAnswer: true,
      imageUrl: String(imageUrls?.[imagePath] || ''),
      fileLabel: fileLabel || getPathFileName(normalizedValue) || 'Open image',
    }
  }

  if (looksLikeImageFileName(normalizedValue)) {
    return {
      isImageAnswer: true,
      imageUrl: '',
      fileLabel: getPathFileName(normalizedValue),
    }
  }

  return { isImageAnswer: false, imageUrl: '', fileLabel: '' }
}

function getHelpTextStyle(question) {
  if (!isSectionQuestion(question)) {
    return undefined
  }

  const style = {}

  if (question?.helpTextColor) {
    style.color = question.helpTextColor
  }

  if (question?.helpTextBold) {
    style.fontWeight = 700
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function getInputPlaceholder(question, fallback = '') {
  return question?.placeholder ? '' : fallback
}

function lightenHexColor(color, amount = 0.45) {
  const normalized = String(color || '').trim()
  const hexMatch = normalized.match(/^#?([0-9a-f]{6})$/i)
  if (!hexMatch) {
    return ''
  }

  const hex = hexMatch[1]
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const lightened = channels.map((channel) =>
    Math.round(channel + (255 - channel) * Math.min(Math.max(amount, 0), 1)),
  )

  return `#${lightened.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function getSelectMessageStyle(behavior) {
  if (behavior?.kind !== 'message') {
    return undefined
  }

  const style = {}

  if (behavior.messageColor) {
    style.color = behavior.messageColor
    style.backgroundColor = lightenHexColor(behavior.messageColor, 0.9)
    style.border = `1px solid ${behavior.messageColor}`
    style.borderRadius = '10px'
    style.padding = '10px 12px'
  }

  if (behavior.messageBold) {
    style.fontWeight = 700
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function getSelectDetailAnswerKey(questionId) {
  return `${questionId}${SELECT_DETAIL_SUFFIX}`
}

function getSelectOptionBehavior(question, selectedOption) {
  if (!selectedOption || question?.type !== 'select') {
    return { kind: 'none', text: '' }
  }

  const detail =
    question?.selectOptionDetails && typeof question.selectOptionDetails === 'object'
      ? question.selectOptionDetails[selectedOption]
      : null

  const kind = ['input', 'message', 'camera'].includes(detail?.kind) ? detail.kind : 'none'
  return {
    kind,
    text: typeof detail?.text === 'string' ? detail.text : '',
    messageColor: typeof detail?.messageColor === 'string' ? detail.messageColor : '',
    messageBold: Boolean(detail?.messageBold),
    historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(detail?.historyCategory)
      ? detail.historyCategory
      : 'normal',
  }
}

function getAnalysisAction(submission, questionId) {
  if (!submission || !questionId) {
    return null
  }

  const actions =
    submission.analysisActions && typeof submission.analysisActions === 'object'
      ? submission.analysisActions
      : null
  const action =
    actions && actions[questionId] && typeof actions[questionId] === 'object'
      ? actions[questionId]
      : null

  if (!action) {
    return null
  }

  const actionType = String(action.type || '').trim().toLowerCase()
  return actionType === 'refill' || actionType === 'ordered' ? action : null
}

function hasAnalysisRefillAction(submission, questionId) {
  return Boolean(getAnalysisAction(submission, questionId))
}

function getHistoryCellCategory(question, submission) {
  if (question?.type !== 'select') {
    return ''
  }

  if (hasAnalysisRefillAction(submission, question?.id)) {
    return ''
  }

  const selectedValue = String(submission?.answers?.[question.id] || '').trim()
  if (!selectedValue) {
    return ''
  }

  const historyCategory = getSelectOptionBehavior(question, selectedValue).historyCategory
  return historyCategory === 'orange' || historyCategory === 'red' ? historyCategory : ''
}

function getSubmissionStatusLabel(status) {
  switch (String(status || '').trim()) {
    case 'reviewed':
      return 'Reviewed'
    case 'awaiting review':
      return 'Awaiting review'
    default:
      return status ? String(status) : 'Awaiting review'
  }
}

function getFlaggedStatusLabel(status) {
  return String(status || '').trim().toLowerCase() === 'complete' ? 'Complete' : 'Open'
}

function getEffectiveInventoryValue(questionId, locationUpdate, latestSubmittedAt) {
  if (!locationUpdate) return ''
  const manualValue = locationUpdate.answers?.[questionId]
  if (!manualValue) return ''
  const logs = locationUpdate.answerLogs?.[questionId]
  const manualTs = logs?.[0]?.updatedAt
    ? new Date(logs[0].updatedAt)
    : locationUpdate.updatedAt instanceof Date
      ? locationUpdate.updatedAt
      : null
  if (!manualTs) return manualValue
  const submittedTs = latestSubmittedAt?.seconds
    ? new Date(latestSubmittedAt.seconds * 1000)
    : latestSubmittedAt instanceof Date
      ? latestSubmittedAt
      : latestSubmittedAt?.toDate?.()
        ? latestSubmittedAt.toDate()
        : null
  if (submittedTs && submittedTs > manualTs) return ''
  return manualValue
}

function getHistoryAnswerValues(submission, question) {
  const mainValue = submission.answers?.[question.id]
  const detailValue = submission.answers?.[getSelectDetailAnswerKey(question.id)]

  return [mainValue, detailValue]
    .filter((value) => String(value || '').trim())
    .map((value) => (isStorageImagePath(value) ? 'Bilde vedlagt' : String(value || '-')))
}

function getAnswerDisplayLabel(answerKey, answers, questions = []) {
  const capturedAtBaseKey = answerKey.endsWith(IMAGE_CAPTURED_AT_SUFFIX)
    ? answerKey.slice(0, -IMAGE_CAPTURED_AT_SUFFIX.length)
    : ''
  const normalizedKey = capturedAtBaseKey || answerKey
  const detailQuestionId = normalizedKey.endsWith(SELECT_DETAIL_SUFFIX)
    ? normalizedKey.slice(0, -SELECT_DETAIL_SUFFIX.length)
    : ''

  if (detailQuestionId) {
    const question = questions.find((item) => item.id === detailQuestionId)
    const selectedOption = answers?.[detailQuestionId]
    if (!question) {
      return answerKey
    }

    const detailLabel = `${question.label} - utdyping${selectedOption ? ` (${selectedOption})` : ''}`
    return capturedAtBaseKey ? `${detailLabel} - bildetidspunkt` : detailLabel
  }

  const question = questions.find((item) => item.id === normalizedKey)
  if (!question) {
    return answerKey
  }

  return capturedAtBaseKey ? `${question.label} - bildetidspunkt` : question.label
}

function getQuestionForAnswerKey(answerKey, questions = []) {
  const normalizedKey = answerKey.endsWith(IMAGE_CAPTURED_AT_SUFFIX)
    ? answerKey.slice(0, -IMAGE_CAPTURED_AT_SUFFIX.length)
    : answerKey
  const detailQuestionId = normalizedKey.endsWith(SELECT_DETAIL_SUFFIX)
    ? normalizedKey.slice(0, -SELECT_DETAIL_SUFFIX.length)
    : normalizedKey

  return questions.find((item) => item.id === detailQuestionId) || null
}

function getOrderedAnswerEntries(answers, questions = [], options = {}) {
  const includeRemainingAnswers = options.includeRemainingAnswers !== false
  const usedKeys = new Set()
  const entries = []

  questions.forEach((question) => {
    if (isSectionQuestion(question)) {
      return
    }

    const answerValue = answers?.[question.id]
    if (typeof answerValue !== 'undefined' && String(answerValue || '').trim()) {
      entries.push([question.id, answerValue])
      usedKeys.add(question.id)
    }

    const capturedAtKey = getImageCapturedAtAnswerKey(question.id)
    const capturedAtValue = answers?.[capturedAtKey]
    if (typeof capturedAtValue !== 'undefined' && String(capturedAtValue || '').trim()) {
      entries.push([capturedAtKey, capturedAtValue])
      usedKeys.add(capturedAtKey)
    }

    const detailKey = getSelectDetailAnswerKey(question.id)
    const detailValue = answers?.[detailKey]
    if (typeof detailValue !== 'undefined' && String(detailValue || '').trim()) {
      entries.push([detailKey, detailValue])
      usedKeys.add(detailKey)
    }

    const detailCapturedAtKey = getImageCapturedAtAnswerKey(detailKey)
    const detailCapturedAtValue = answers?.[detailCapturedAtKey]
    if (
      typeof detailCapturedAtValue !== 'undefined' &&
      String(detailCapturedAtValue || '').trim()
    ) {
      entries.push([detailCapturedAtKey, detailCapturedAtValue])
      usedKeys.add(detailCapturedAtKey)
    }
  })

  if (includeRemainingAnswers) {
    Object.entries(answers || {}).forEach(([key, value]) => {
      if (usedKeys.has(key)) {
        return
      }
      if (!String(value || '').trim()) {
        return
      }
      entries.push([key, value])
    })
  }

  return entries
}

function getReviewDisplayValue(answerKey, value, question, translate) {
  if (isStorageImagePath(value)) {
    return ''
  }

  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return '-'
  }

  if (!question || answerKey.endsWith(SELECT_DETAIL_SUFFIX)) {
    return normalizedValue
  }

  if (question.type === 'select') {
    return translate(normalizedValue)
  }

  return normalizedValue
}

function createEditorQuestion(seed) {
  return {
    id: toQuestionId(seed),
    label: 'Nytt spørsmål',
    type: 'text',
    required: false,
    placeholder: '',
    imageUrl: '',
    imageZoom: 1,
    includeInAnalysis: false,
    includeInReview: false,
    reviewType: '',
    includeRating: false,
    shouldRestock: false,
    reviewHelpText: '',
    analysisLabel: '',
    deliveryUnlimited: true,
    deliveryMaxUnits: '',
    helpTextColor: '',
    helpTextBold: false,
    visibleForLocations: [],
    selectOptionDetails: {},
    imagePreviewUrl: '',
    imageFile: null,
    removeImage: false,
    moveTarget: '',
    options: [],
    optionsText: '',
  }
}

function getFormDraftStorageKey(formSlug) {
  return `${FORM_DRAFT_STORAGE_PREFIX}${formSlug}`
}

function readFormDraft(formSlug) {
  if (typeof window === 'undefined') {
    return {
      answers: {},
      locationOtherAnswers: {},
      selectDetailAnswers: {},
      selfDeclarationAccepted: false,
    }
  }

  try {
    const stored = window.localStorage.getItem(getFormDraftStorageKey(formSlug))
    if (!stored) {
      return {
        answers: {},
        locationOtherAnswers: {},
        selectDetailAnswers: {},
        cameraCapturedAt: {},
        selectDetailCapturedAt: {},
        selfDeclarationAccepted: false,
      }
    }

    const parsed = JSON.parse(stored)
    return {
      answers: parsed?.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      locationOtherAnswers:
        parsed?.locationOtherAnswers && typeof parsed.locationOtherAnswers === 'object'
          ? parsed.locationOtherAnswers
          : {},
      selectDetailAnswers:
        parsed?.selectDetailAnswers && typeof parsed.selectDetailAnswers === 'object'
          ? parsed.selectDetailAnswers
          : {},
      cameraCapturedAt:
        parsed?.cameraCapturedAt && typeof parsed.cameraCapturedAt === 'object'
          ? parsed.cameraCapturedAt
          : {},
      selectDetailCapturedAt:
        parsed?.selectDetailCapturedAt && typeof parsed.selectDetailCapturedAt === 'object'
          ? parsed.selectDetailCapturedAt
          : {},
      selfDeclarationAccepted: Boolean(parsed?.selfDeclarationAccepted),
    }
  } catch {
    return {
      answers: {},
      locationOtherAnswers: {},
      selectDetailAnswers: {},
      cameraCapturedAt: {},
      selectDetailCapturedAt: {},
      selfDeclarationAccepted: false,
    }
  }
}

function writeFormDraft(formSlug, draft) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(getFormDraftStorageKey(formSlug), JSON.stringify(draft))
  } catch {}
}

function clearFormDraft(formSlug) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(getFormDraftStorageKey(formSlug))
  } catch {}
}

function toSortOrder(item) {
  if (typeof item?.order === 'number' && Number.isFinite(item.order)) {
    return item.order
  }
  if (typeof item?.order === 'string' && item.order.trim()) {
    const parsed = Number(item.order)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return Number.POSITIVE_INFINITY
}

function getFormSaveErrorMessage(error) {
  const code = error?.code || ''
  if (code === 'storage/unauthorized') {
    return 'Kunne ikke laste opp spørsmålsbildet. Mangler tilgang i Firebase Storage-regler.'
  }
  if (code === 'storage/canceled') {
    return 'Bildeopplastingen ble avbrutt.'
  }
  if (code === 'storage/unknown') {
    return 'Ukjent Storage-feil ved opplasting av spørsmålsbildet.'
  }
  if (code === 'permission-denied') {
    return 'Kunne ikke lagre skjema. Mangler tilgang i Firestore-regler.'
  }
  return code ? `Kunne ikke lagre skjema (${code}).` : 'Kunne ikke lagre skjema. Prøv igjen.'
}

function getSubmitErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied') {
    return 'Kunne ikke sende inn skjemaet. Mangler tilgang i Firestore-regler.'
  }

  if (code === 'storage/unauthorized') {
    return 'Kunne ikke laste opp bilde. Mangler tilgang i Firebase Storage-regler.'
  }

  return code ? `Noe gikk galt ved innsending (${code}). Prøv igjen.` : 'Noe gikk galt ved innsending. Prøv igjen.'
}

function getImmediateImageUploadErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'storage/unauthorized') {
    return 'Kunne ikke laste opp bilde. Mangler tilgang i Firebase Storage-regler.'
  }

  if (code === 'storage/canceled') {
    return 'Bildeopplastingen ble avbrutt.'
  }

  if (code === 'storage/unknown') {
    return 'Ukjent Storage-feil ved opplasting av bilde.'
  }

  return code ? `Kunne ikke laste opp bilde (${code}). Prøv igjen.` : 'Kunne ikke laste opp bilde. Prøv igjen.'
}

function getRemarkSaveErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied') {
    return 'Could not save remark. Missing permission in Firestore rules.'
  }

  if (code === 'storage/unauthorized') {
    return 'Could not upload remark image. Missing permission in Firebase Storage rules.'
  }

  if (code === 'storage/canceled') {
    return 'Image upload was cancelled.'
  }

  if (code === 'storage/unknown') {
    return 'Unknown Storage error while uploading remark image.'
  }

  return code ? `Could not save remark (${code}).` : 'Could not save remark.'
}

function getRemarkDeleteErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied') {
    return 'Could not delete remark. Missing permission in Firestore rules.'
  }

  return code ? `Could not delete remark (${code}).` : 'Could not delete remark.'
}

function getLocationsLoadErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied') {
    return 'Kunne ikke hente lokasjoner. Sjekk Firestore-regler eller admin-tilgang.'
  }

  if (code === 'unauthenticated') {
    return 'Du må være logget inn som admin for å hente lokasjoner her.'
  }

  return code ? `Kunne ikke hente lokasjoner (${code}).` : 'Kunne ikke hente lokasjoner akkurat nå.'
}

function FaceHappy({ size = 22 }) {
  return (
    <svg className="face-icon face-happy" width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <circle cx="7.5" cy="9" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="9" r="1.2" fill="currentColor" />
      <path d="M7 13.5 Q11 17 15 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function FaceNeutral({ size = 22 }) {
  return (
    <svg className="face-icon face-neutral" width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <circle cx="7.5" cy="9" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="9" r="1.2" fill="currentColor" />
      <line x1="7.5" y1="14.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function FaceSad({ size = 22 }) {
  return (
    <svg className="face-icon face-sad" width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <circle cx="7.5" cy="9" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="9" r="1.2" fill="currentColor" />
      <path d="M7 16 Q11 12.5 15 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function FormPage() {
  const { formSlug = STENGESKJEMA_ID, receiptToken = '', submissionId = '' } = useParams()
  const location = useLocation()
  const editReceiptToken = useMemo(
    () => new URLSearchParams(location.search).get('editReceipt')?.trim() || '',
    [location.search],
  )
  const activeFormSlug = String(formSlug || STENGESKJEMA_ID).trim().toLowerCase()
  const isDefaultForm = activeFormSlug === STENGESKJEMA_ID
  const isSubmissionsView = location.pathname.endsWith('/submissions')
  const isReviewView = location.pathname.includes('/review/')
  const isFlaggedView = location.pathname.endsWith('/flagget')
  const isRemarksView = location.pathname.endsWith('/remarks')
  const isRatingView = location.pathname.endsWith('/rating')
  const isHistoryView =
    location.pathname.endsWith('/analyse') || location.pathname.endsWith('/historikk') ||
    location.pathname === '/varebeholdning'
  const isProductionView = location.pathname.endsWith('/produksjon')
  const isEditPage = location.pathname.endsWith('/edit')
  const isReceiptPage = location.pathname.includes('/kvittering/')
  const isAdminShellView =
    isSubmissionsView ||
    isEditPage ||
    isHistoryView ||
    isFlaggedView ||
    isRemarksView ||
    isRatingView ||
    isReviewView ||
    isProductionView
  const isStandalonePublicForm =
    !isSubmissionsView &&
    !isEditPage &&
    !isHistoryView &&
    !isFlaggedView &&
    !isRemarksView &&
    !isRatingView &&
    !isReviewView &&
    !isProductionView
  const isSubmissionEditMode = !isReceiptPage && Boolean(editReceiptToken) && isStandalonePublicForm
  const activeReceiptLookupToken = isReceiptPage ? receiptToken : editReceiptToken

  const [formData, setFormData] = useState(defaultStengeskjema)
  const [formDocId, setFormDocId] = useState(STENGESKJEMA_ID)
  const [answers, setAnswers] = useState({})
  const [locationOtherAnswers, setLocationOtherAnswers] = useState({})
  const [selectDetailAnswers, setSelectDetailAnswers] = useState({})
  const [selectDetailFiles, setSelectDetailFiles] = useState({})
  const [selectDetailPreviews, setSelectDetailPreviews] = useState({})
  const [selectDetailCapturedAt, setSelectDetailCapturedAt] = useState({})
  const [selfDeclarationAccepted, setSelfDeclarationAccepted] = useState(false)
  const [cameraFiles, setCameraFiles] = useState({})
  const [cameraPreviews, setCameraPreviews] = useState({})
  const [cameraCapturedAt, setCameraCapturedAt] = useState({})
  const [cameraUploadState, setCameraUploadState] = useState({})
  const [multiCameraFiles, setMultiCameraFiles] = useState({})
  const [multiCameraPreviews, setMultiCameraPreviews] = useState({})
  const [multiCameraUploadState, setMultiCameraUploadState] = useState({})
  const [selectDetailUploadState, setSelectDetailUploadState] = useState({})
  const [formInstanceKey, setFormInstanceKey] = useState(0)
  const [loadingForm, setLoadingForm] = useState(true)
  const [availableLocations, setAvailableLocations] = useState([])
  const [loadingLocations, setLoadingLocations] = useState(true)
  const [availableLocationsError, setAvailableLocationsError] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [submitState, setSubmitState] = useState({ submitting: false, message: '', error: '' })
  const [submitErrorQuestionId, setSubmitErrorQuestionId] = useState('')
  const [submitErrorTargetId, setSubmitErrorTargetId] = useState('')
  const [submitOverlay, setSubmitOverlay] = useState({ open: false, status: 'idle' })
  const [displayLanguage, setDisplayLanguage] = useState(readPreferredPublicFormLanguage)
  const [englishTranslations, setEnglishTranslations] = useState(readEnglishTranslationCache)
  const [norwegianTranslations, setNorwegianTranslations] = useState(readNorwegianTranslationCache)
  const [translationState, setTranslationState] = useState({ loading: false, error: '' })

  const [editorTitle, setEditorTitle] = useState(defaultStengeskjema.title)
  const [editorDescription, setEditorDescription] = useState(defaultStengeskjema.description)
  const [editorIncludeSubmissionDateTime, setEditorIncludeSubmissionDateTime] = useState(
    Boolean(defaultStengeskjema.includeSubmissionDateTime),
  )
  const [editorEnableSelfDeclaration, setEditorEnableSelfDeclaration] = useState(
    Boolean(defaultStengeskjema.enableSelfDeclaration),
  )
  const [editorSelfDeclarationText, setEditorSelfDeclarationText] = useState(
    defaultStengeskjema.selfDeclarationText || '',
  )
  const [editorEditMode, setEditorEditMode] = useState(true)
  const [editorQuestions, setEditorQuestions] = useState(
    defaultStengeskjema.questions.map((item, index) => toEditorQuestion(item, index)),
  )
  const [saveState, setSaveState] = useState({ saving: false, message: '', error: '' })

  const [submissions, setSubmissions] = useState([])
  const [submissionErrors, setSubmissionErrors] = useState([])
  const [loadingErrors, setLoadingErrors] = useState(false)
  const [manualRemarks, setManualRemarks] = useState([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [loadingManualRemarks, setLoadingManualRemarks] = useState(false)
  const [statusUpdateState, setStatusUpdateState] = useState({})
  const [deleteSubmissionState, setDeleteSubmissionState] = useState({})
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('')
  const [selectedSubmissionImageUrls, setSelectedSubmissionImageUrls] = useState({})
  const [selectedSubmissionImagesLoading, setSelectedSubmissionImagesLoading] = useState(false)
  const [selectedSubmissionImageMeta, setSelectedSubmissionImageMeta] = useState({})
  const [submissionLastPhotoMeta, setSubmissionLastPhotoMeta] = useState({})
  const [showTimingIssues, setShowTimingIssues] = useState(false)
  const [timingIssuesFetching, setTimingIssuesFetching] = useState(false)
  const [selectedSubmissionDay, setSelectedSubmissionDay] = useState('')
  const [reviewDraftStatuses, setReviewDraftStatuses] = useState({})
  const [reviewDraftComments, setReviewDraftComments] = useState({})
  const [reviewDraftRatings, setReviewDraftRatings] = useState({})
  const [reviewSubmissionState, setReviewSubmissionState] = useState({ saving: false, error: '' })
  const [plandayTimeConfirmed, setPlandayTimeConfirmed] = useState(null)
  const [reviewGeneralFeedback, setReviewGeneralFeedback] = useState('')
  const [reviewRejected, setReviewRejected] = useState(false)
  const [reviewRejectionComment, setReviewRejectionComment] = useState('')
  const [reviewSendEmail, setReviewSendEmail] = useState(true)
  const [reviewEmailPreviewData, setReviewEmailPreviewData] = useState(null)
  const [reviewEmailOverride, setReviewEmailOverride] = useState('')
  const [reviewEmailSuggestion, setReviewEmailSuggestion] = useState('')
  const [reviewEmailSaving, setReviewEmailSaving] = useState(false)
  const [reviewEmailSaved, setReviewEmailSaved] = useState(false)
  const [testEmailState, setTestEmailState] = useState({ sending: false, error: '', message: '' })
  const [testEmailRecipient, setTestEmailRecipient] = useState('')
  const [inventoryAlertState, setInventoryAlertState] = useState({ sending: false, error: '', message: '' })
  const [inventoryTestState, setInventoryTestState] = useState({ sending: false, error: '', message: '' })
  const [analyseEmailOpen, setAnalyseEmailOpen] = useState(false)
  const [analyseEmailRecipient, setAnalyseEmailRecipient] = useState('')
  const [analyseEmailState, setAnalyseEmailState] = useState({ sending: false, error: '', message: '' })
  const [historySubmissionLimit, setHistorySubmissionLimit] = useState('3')
  const [historyDefaultState, setHistoryDefaultState] = useState({
    saving: false,
    error: '',
    message: '',
  })
  const [historyQuestionFilterOpen, setHistoryQuestionFilterOpen] = useState(false)
  const [historyShowAllQuestions, setHistoryShowAllQuestions] = useState(true)
  const [selectedHistoryQuestionIds, setSelectedHistoryQuestionIds] = useState([])
  const [analysisRowOrder, setAnalysisRowOrder] = useState([])
  const [analysisRowOrderSaving, setAnalysisRowOrderSaving] = useState(false)
  const [historyLocationFilterOpen, setHistoryLocationFilterOpen] = useState(false)
  const [historyShowAllLocations, setHistoryShowAllLocations] = useState(true)
  const [selectedHistoryLocations, setSelectedHistoryLocations] = useState([])
  const [editPhoneSubmissionId, setEditPhoneSubmissionId] = useState('')
  const [editPhoneDraft, setEditPhoneDraft] = useState('')
  const [editPhoneState, setEditPhoneState] = useState({ saving: false, error: '' })
  const [inventoryUpdates, setInventoryUpdates] = useState({})
  const [hideUpdatedValues, setHideUpdatedValues] = useState(false)
  const [showInventoryModal, setShowInventoryModal] = useState(false)
  const [inventoryModalLocation, setInventoryModalLocation] = useState('')
  const [inventoryModalQuestionId, setInventoryModalQuestionId] = useState('')
  const [inventoryModalAnswers, setInventoryModalAnswers] = useState({})
  const [inventoryModalSaving, setInventoryModalSaving] = useState(false)
  const [inventoryModalError, setInventoryModalError] = useState('')
  const [receiptSubmission, setReceiptSubmission] = useState(null)
  const [loadingReceipt, setLoadingReceipt] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptImageUrls, setReceiptImageUrls] = useState({})
  const [receiptReviewData, setReceiptReviewData] = useState(null)
  const [feedbackConfirmSaving, setFeedbackConfirmSaving] = useState(false)
  const [feedbackConfirmDone, setFeedbackConfirmDone] = useState(false)
  const [followUpSavingId, setFollowUpSavingId] = useState('')
  const [followUpDrafts, setFollowUpDrafts] = useState({})
  const [confirmedFeedbackDays, setConfirmedFeedbackDays] = useState(3)
  const [flaggedImageUrls, setFlaggedImageUrls] = useState({})
  const [flaggedReviewOpenId, setFlaggedReviewOpenId] = useState('')
  const [showPastMonths, setShowPastMonths] = useState(false)
  const [flaggedActionDrafts, setFlaggedActionDrafts] = useState({})
  const [flaggedWarningDrafts, setFlaggedWarningDrafts] = useState({})
  const [newWarningCategoryDrafts, setNewWarningCategoryDrafts] = useState({})
  const [flaggedCategoryPopupOpenId, setFlaggedCategoryPopupOpenId] = useState('')
  const [flaggedActionState, setFlaggedActionState] = useState({})
  const [flaggedCollapsedIds, setFlaggedCollapsedIds] = useState({})
  const [flaggedHistoryDateFrom, setFlaggedHistoryDateFrom] = useState('')
  const [flaggedHistoryDateTo, setFlaggedHistoryDateTo] = useState('')
  const [remarkDraftPhone, setRemarkDraftPhone] = useState('')
  const [remarkDraftName, setRemarkDraftName] = useState('')
  const [remarkDraftCategory, setRemarkDraftCategory] = useState('')
  const [remarkDraftComment, setRemarkDraftComment] = useState('')
  const [remarkDraftImages, setRemarkDraftImages] = useState([])
  const [remarkImageUrls, setRemarkImageUrls] = useState({})
  const [remarkState, setRemarkState] = useState({
    saving: false,
    error: '',
    message: '',
    categorySaving: false,
    categoryError: '',
  })
  const [remarkCategoryPopupOpen, setRemarkCategoryPopupOpen] = useState(false)
  const [newRemarkCategoryDraft, setNewRemarkCategoryDraft] = useState('')
  const [remarkCategoryManagerOpen, setRemarkCategoryManagerOpen] = useState(false)
  const [remarkCategoryPendingName, setRemarkCategoryPendingName] = useState('')
  const [remarkCategoryPendingAction, setRemarkCategoryPendingAction] = useState('')
  const [remarkCategoryModalCategory, setRemarkCategoryModalCategory] = useState('')
  const [remarkCategoryRenameDraft, setRemarkCategoryRenameDraft] = useState('')
  const [remarkDeleteState, setRemarkDeleteState] = useState({})
  const [expandedRemarkPhones, setExpandedRemarkPhones] = useState({})
  const [analysisActionState, setAnalysisActionState] = useState({})
  const [hydratedEditReceiptToken, setHydratedEditReceiptToken] = useState('')
  const cameraUploadRequestIdsRef = useRef({})
  const selectDetailUploadRequestIdsRef = useRef({})

  const { user, isAdmin, loading, error } = useAdminSession()
  const shouldTranslateToEnglish = displayLanguage === 'en' || isReviewView
  const publicCopy = shouldTranslateToEnglish ? PUBLIC_FORM_COPY.en : PUBLIC_FORM_COPY.no
  const shouldUploadStengeskjemaImagesImmediately =
    activeFormSlug === STENGESKJEMA_ID && isStandalonePublicForm
  const hasPendingImageUploads = useMemo(
    () =>
      [...Object.values(cameraUploadState), ...Object.values(multiCameraUploadState), ...Object.values(selectDetailUploadState)].some(
        (state) => Boolean(state?.uploading),
      ),
    [cameraUploadState, multiCameraUploadState, selectDetailUploadState],
  )

  function translateText(value) {
    const text = String(value || '')
    if (!text) {
      return ''
    }

    if (shouldTranslateToEnglish) {
      return englishTranslations[text] || englishTranslations[text.trim()] || text
    }

    const norwegianValue = norwegianTranslations[text] || norwegianTranslations[text.trim()]
    if (norwegianValue && norwegianValue !== text) {
      return norwegianValue
    }

    return text
  }

  function getLocalizedInputPlaceholder(question, fallback = '') {
    if (question?.placeholder) {
      return translateText(question.placeholder)
    }

    return fallback
  }

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (!viewportMeta) {
      return
    }

    const originalContent = viewportMeta.getAttribute('content') || ''

    if (isStandalonePublicForm) {
      viewportMeta.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
      )
    } else {
      viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0')
    }

    return () => {
      viewportMeta.setAttribute('content', originalContent || 'width=device-width, initial-scale=1.0')
    }
  }, [isStandalonePublicForm])

  useEffect(() => {
    if (!isStandalonePublicForm) return
    document.body.classList.add('order-bg')
    document.documentElement.style.overflowX = 'hidden'
    return () => {
      document.body.classList.remove('order-bg')
      document.documentElement.style.overflowX = ''
    }
  }, [isStandalonePublicForm])

  useEffect(() => {
    if (!isStandalonePublicForm) {
      return
    }

    writePreferredPublicFormLanguage(displayLanguage)
  }, [displayLanguage, isStandalonePublicForm])

  useEffect(() => {
    let cancelled = false

    async function loadForm() {
      setLoadingForm(true)
      try {
        const formsQuery = query(collection(db, 'forms'), where('slug', '==', activeFormSlug))
        const querySnapshot = await getDocs(formsQuery)

        const matching = querySnapshot.docs[0]
        const merged = matching
          ? {
              ...(isDefaultForm ? defaultStengeskjema : {}),
              ...matching.data(),
              id: matching.id,
              slug: activeFormSlug,
            }
          : isDefaultForm
            ? defaultStengeskjema
            : {
                id: activeFormSlug,
                slug: activeFormSlug,
                title: activeFormSlug,
                description: 'Skjemaet ble ikke funnet.',
                questions: [],
              }

        const normalizedQuestions = (merged.questions || []).map((item, index) =>
          normalizeQuestion(item, index),
        )

        if (!cancelled) {
          const normalized = {
            ...merged,
            includeSubmissionDateTime: Boolean(merged.includeSubmissionDateTime),
            enableSelfDeclaration: Boolean(merged.enableSelfDeclaration),
            selfDeclarationText: String(merged.selfDeclarationText || ''),
            warningCategories: normalizeWarningCategories(merged.warningCategories),
            questions: normalizedQuestions,
          }

          setFormData(normalized)
          setFormDocId(matching?.id || activeFormSlug)
          setEditorTitle(normalized.title || defaultStengeskjema.title)
          setEditorDescription(normalized.description || defaultStengeskjema.description)
          setEditorIncludeSubmissionDateTime(Boolean(normalized.includeSubmissionDateTime))
          setEditorEnableSelfDeclaration(Boolean(normalized.enableSelfDeclaration))
          setEditorSelfDeclarationText(String(normalized.selfDeclarationText || ''))
          setEditorQuestions((merged.questions || []).map((item, index) => toEditorQuestion(item, index)))
        }
      } finally {
        if (!cancelled) {
          setLoadingForm(false)
        }
      }
    }

    loadForm()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, isDefaultForm])

  useEffect(() => {
    if (submitState.submitting) {
      setSubmitOverlay({ open: true, status: 'submitting' })
      return
    }

    if (submitState.message) {
      setSubmitOverlay({ open: true, status: 'success' })
      const timeoutId = window.setTimeout(() => {
        setSubmitOverlay({ open: false, status: 'idle' })
      }, 1800)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    if (submitState.error) {
      setSubmitOverlay({ open: false, status: 'idle' })
      window.alert(submitState.error)
    }
  }, [submitState.error, submitState.message, submitState.submitting])

  useEffect(() => {
    if ((!isStandalonePublicForm && !isReviewView) || loadingForm || !shouldTranslateToEnglish) {
      setTranslationState({ loading: false, error: '' })
      return
    }

    const missingTexts = collectFormTranslationTexts(formData).filter(
      (text) => !String(englishTranslations[text] || '').trim(),
    )

    if (missingTexts.length === 0) {
      setTranslationState({ loading: false, error: '' })
      return
    }

    let cancelled = false
    const controller = typeof AbortController === 'function' ? new AbortController() : null

    setTranslationState({ loading: true, error: '' })

    async function loadTranslations() {
      const nextTranslations = { ...englishTranslations }
      let hadError = false

      for (const text of missingTexts) {
        try {
          nextTranslations[text] = await translateNorwegianTextToEnglish(text, controller?.signal)
        } catch (error) {
          if (error?.name === 'AbortError') {
            return
          }
          hadError = true
          nextTranslations[text] = text
        }
      }

      if (cancelled) {
        return
      }

      setEnglishTranslations(nextTranslations)
      writeEnglishTranslationCache(nextTranslations)
      setTranslationState({
        loading: false,
        error: hadError ? publicCopy.translationError : '',
      })
    }

    loadTranslations()

    return () => {
      cancelled = true
      controller?.abort()
    }
  }, [
    englishTranslations,
    formData,
    isReviewView,
    isStandalonePublicForm,
    loadingForm,
    publicCopy.translationError,
    shouldTranslateToEnglish,
  ])

  useEffect(() => {
    if (shouldTranslateToEnglish || loadingForm) {
      return
    }

    const allTexts = collectFormTranslationTexts(formData)
    const cached = readNorwegianTranslationCache()
    const untranslatedTexts = allTexts.filter(
      (text) => !String(cached[text] || '').trim(),
    )

    if (untranslatedTexts.length === 0) {
      return
    }

    let cancelled = false
    const controller = typeof AbortController === 'function' ? new AbortController() : null

    async function loadNorwegianTranslations() {
      const nextTranslations = { ...cached }

      for (const text of untranslatedTexts) {
        try {
          nextTranslations[text] = await translateTextToNorwegian(text, controller?.signal)
        } catch (error) {
          if (error?.name === 'AbortError') return
          nextTranslations[text] = text
        }
      }

      if (cancelled) return

      setNorwegianTranslations(nextTranslations)
      writeNorwegianTranslationCache(nextTranslations)
    }

    loadNorwegianTranslations()

    return () => {
      cancelled = true
      controller?.abort()
    }
  }, [formData, loadingForm, shouldTranslateToEnglish])

  useEffect(() => {
    if (!isSubmissionEditMode) {
      setHydratedEditReceiptToken('')
    }
  }, [isSubmissionEditMode, editReceiptToken])

  useEffect(() => {
    if (loadingForm) {
      setDraftReady(false)
      return
    }

    if (isReceiptPage) {
      setDraftReady(true)
      return
    }

    if (isSubmissionEditMode) {
      if (!receiptSubmission || hydratedEditReceiptToken === editReceiptToken) {
        setDraftReady(Boolean(receiptSubmission))
        return
      }

      const receiptAnswers = receiptSubmission.answers || {}
      const nextAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question)) {
          return accumulator
        }

        const storedValue = receiptAnswers[question.id]
        const normalizedValue = typeof storedValue !== 'undefined' ? String(storedValue || '') : ''

        if (question.type === 'location') {
          const matchesSavedLocation = availableLocations.some(
            (location) => String(location.name || '').trim() === normalizedValue,
          )
          accumulator[question.id] = matchesSavedLocation ? normalizedValue : normalizedValue ? LOCATION_OTHER_VALUE : ''
          return accumulator
        }

        accumulator[question.id] = normalizedValue
        return accumulator
      }, {})

      const nextLocationOtherAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'location') {
          return accumulator
        }

        const storedValue = String(receiptAnswers[question.id] || '').trim()
        if (!storedValue) {
          return accumulator
        }

        const matchesSavedLocation = availableLocations.some(
          (location) => String(location.name || '').trim() === storedValue,
        )
        if (!matchesSavedLocation) {
          accumulator[question.id] = storedValue
        }

        return accumulator
      }, {})

      const nextSelectDetailAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'select') {
          return accumulator
        }

        const detailKey = getSelectDetailAnswerKey(question.id)
        const storedValue = receiptAnswers[detailKey]
        if (typeof storedValue !== 'undefined') {
          accumulator[question.id] = String(storedValue || '')
        }
        return accumulator
      }, {})

      const nextSelectDetailPreviews = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'select') {
          return accumulator
        }

        const detailValue = String(receiptAnswers[getSelectDetailAnswerKey(question.id)] || '').trim()
        if (isStorageImagePath(detailValue)) {
          const previewUrl = receiptSubmission.imageUrls?.[detailValue] || receiptImageUrls[detailValue] || ''
          if (previewUrl) {
            accumulator[question.id] = previewUrl
          }
        }
        return accumulator
      }, {})

      const nextSelectDetailCapturedAt = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'select') {
          return accumulator
        }

        const storedValue = String(
          receiptAnswers[getImageCapturedAtAnswerKey(getSelectDetailAnswerKey(question.id))] || '',
        ).trim()
        if (storedValue) {
          accumulator[question.id] = storedValue
        }
        return accumulator
      }, {})

      const nextCameraPreviews = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'camera') {
          return accumulator
        }

        const storedValue = String(receiptAnswers[question.id] || '').trim()
        if (isStorageImagePath(storedValue)) {
          const previewUrl = receiptSubmission.imageUrls?.[storedValue] || receiptImageUrls[storedValue] || ''
          if (previewUrl) {
            accumulator[question.id] = previewUrl
          }
        }
        return accumulator
      }, {})

      const nextCameraCapturedAt = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'camera') {
          return accumulator
        }

        const storedValue = String(receiptAnswers[getImageCapturedAtAnswerKey(question.id)] || '').trim()
        if (storedValue) {
          accumulator[question.id] = storedValue
        }
        return accumulator
      }, {})

      setAnswers(nextAnswers)
      setLocationOtherAnswers(nextLocationOtherAnswers)
      setSelectDetailAnswers(nextSelectDetailAnswers)
      setSelectDetailFiles({})
      setSelectDetailPreviews(nextSelectDetailPreviews)
      setSelectDetailCapturedAt(nextSelectDetailCapturedAt)
      setSelectDetailUploadState({})
      setCameraFiles({})
      setCameraPreviews(nextCameraPreviews)
      setCameraCapturedAt(nextCameraCapturedAt)
      setCameraUploadState({})
      setMultiCameraFiles({})
      setMultiCameraPreviews({})
      setMultiCameraUploadState({})
      setSelfDeclarationAccepted(Boolean(receiptAnswers[SELF_DECLARATION_ACCEPTED_KEY]))
      setHydratedEditReceiptToken(editReceiptToken)
      setDraftReady(true)
      return
    }

    const draft = readFormDraft(activeFormSlug)
    const nextAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question)) {
        return accumulator
      }
      const storedValue = draft.answers?.[question.id]
      const normalizedValue =
        typeof storedValue !== 'undefined'
          ? String(storedValue)
          : ''
      accumulator[question.id] =
        question.type === 'camera' && !isStorageImagePath(normalizedValue) ? '' : normalizedValue
      return accumulator
    }, {})

    const nextLocationOtherAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question) || question.type !== 'location') {
        return accumulator
      }
      const storedValue = draft.locationOtherAnswers?.[question.id]
      if (typeof storedValue !== 'undefined') {
        accumulator[question.id] = String(storedValue)
      }
      return accumulator
    }, {})

    const nextSelectDetailAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question) || question.type !== 'select') {
        return accumulator
      }
      const storedValue = draft.selectDetailAnswers?.[question.id]
      if (typeof storedValue !== 'undefined') {
        const normalizedValue = String(storedValue)
        const selectedValue = String(draft.answers?.[question.id] || '').trim()
        const selectedBehavior = getSelectOptionBehavior(question, selectedValue)
        accumulator[question.id] =
          selectedBehavior.kind === 'camera' && !isStorageImagePath(normalizedValue)
            ? ''
            : normalizedValue
      }
      return accumulator
    }, {})

    const nextSelectDetailCapturedAt = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question) || question.type !== 'select') {
        return accumulator
      }
      const storedValue = draft.selectDetailCapturedAt?.[question.id]
      if (typeof storedValue !== 'undefined') {
        accumulator[question.id] = String(storedValue)
      }
      return accumulator
    }, {})

    const nextCameraCapturedAt = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question) || question.type !== 'camera') {
        return accumulator
      }
      const storedValue = draft.cameraCapturedAt?.[question.id]
      if (typeof storedValue !== 'undefined') {
        accumulator[question.id] = String(storedValue)
      }
      return accumulator
    }, {})

    setAnswers(nextAnswers)
    setLocationOtherAnswers(nextLocationOtherAnswers)
    setSelectDetailAnswers(nextSelectDetailAnswers)
    setSelectDetailFiles({})
    setSelectDetailPreviews({})
    setSelectDetailCapturedAt(nextSelectDetailCapturedAt)
    setSelectDetailUploadState({})
    setCameraFiles({})
    setCameraPreviews({})
    setCameraCapturedAt(nextCameraCapturedAt)
    setCameraUploadState({})
    setMultiCameraFiles({})
    setMultiCameraPreviews({})
    setMultiCameraUploadState({})
    setSelfDeclarationAccepted(
      Boolean(formData.enableSelfDeclaration) && Boolean(draft.selfDeclarationAccepted),
    )
    setDraftReady(true)
  }, [
    activeFormSlug,
    availableLocations,
    editReceiptToken,
    formData.enableSelfDeclaration,
    formData.questions,
    hydratedEditReceiptToken,
    isReceiptPage,
    isSubmissionEditMode,
    loadingForm,
    receiptImageUrls,
    receiptSubmission,
  ])

  useEffect(() => {
    if (
      loadingForm ||
      !draftReady ||
      isSubmissionEditMode ||
      isAdminShellView ||
      isReceiptPage ||
      !shouldUploadStengeskjemaImagesImmediately
    ) {
      return
    }

    const cameraEntries = formData.questions
      .filter((question) => !isSectionQuestion(question) && question.type === 'camera')
      .map((question) => ({
        questionId: question.id,
        path: String(answers[question.id] || '').trim(),
      }))
      .filter((entry) => isStorageImagePath(entry.path))

    const selectDetailEntries = formData.questions
      .filter((question) => !isSectionQuestion(question) && question.type === 'select')
      .map((question) => ({
        questionId: question.id,
        path: String(selectDetailAnswers[question.id] || '').trim(),
      }))
      .filter((entry) => isStorageImagePath(entry.path))

    const uniquePaths = Array.from(
      new Set([...cameraEntries, ...selectDetailEntries].map((entry) => entry.path)),
    )

    if (uniquePaths.length === 0) {
      return
    }

    let cancelled = false

    Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    ).then((pairs) => {
      if (cancelled) {
        return
      }

      const imageUrlMap = Object.fromEntries(pairs.filter(([, url]) => Boolean(url)))

      setCameraPreviews(
        Object.fromEntries(
          cameraEntries
            .map((entry) => [entry.questionId, imageUrlMap[entry.path] || ''])
            .filter(([, url]) => Boolean(url)),
        ),
      )
      setSelectDetailPreviews(
        Object.fromEntries(
          selectDetailEntries
            .map((entry) => [entry.questionId, imageUrlMap[entry.path] || ''])
            .filter(([, url]) => Boolean(url)),
        ),
      )
    })

    return () => {
      cancelled = true
    }
  }, [
    answers,
    draftReady,
    formData.questions,
    isAdminShellView,
    isReceiptPage,
    isSubmissionEditMode,
    loadingForm,
    selectDetailAnswers,
    shouldUploadStengeskjemaImagesImmediately,
  ])

  useEffect(() => {
    if (
      loadingForm ||
      !draftReady ||
      isSubmissionEditMode ||
      isAdminShellView ||
      isReceiptPage
    ) {
      return
    }

    const normalizedAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question)) {
        return accumulator
      }
      const answerValue =
        typeof answers[question.id] !== 'undefined'
          ? String(answers[question.id] || '')
          : ''
      accumulator[question.id] =
        (question.type === 'camera' || question.type === 'multi-camera') && !isStorageImagePath(answerValue) ? '' : answerValue
      return accumulator
    }, {})

    const normalizedLocationOtherAnswers = formData.questions.reduce((accumulator, question) => {
      if (!isSectionQuestion(question) && question.type === 'location' && typeof locationOtherAnswers[question.id] !== 'undefined') {
        accumulator[question.id] = String(locationOtherAnswers[question.id] || '')
      }
      return accumulator
    }, {})

    const normalizedSelectDetailAnswers = formData.questions.reduce((accumulator, question) => {
      if (
        !isSectionQuestion(question) &&
        question.type === 'select' &&
        typeof selectDetailAnswers[question.id] !== 'undefined'
      ) {
        const detailValue = String(selectDetailAnswers[question.id] || '')
        const selectedBehavior = getSelectOptionBehavior(question, answers[question.id])
        accumulator[question.id] =
          selectedBehavior.kind === 'camera' && !isStorageImagePath(detailValue) ? '' : detailValue
      }
      return accumulator
    }, {})

    const normalizedSelectDetailCapturedAt = formData.questions.reduce((accumulator, question) => {
      if (
        !isSectionQuestion(question) &&
        question.type === 'select' &&
        typeof selectDetailCapturedAt[question.id] !== 'undefined'
      ) {
        accumulator[question.id] = String(selectDetailCapturedAt[question.id] || '')
      }
      return accumulator
    }, {})

    const normalizedCameraCapturedAt = formData.questions.reduce((accumulator, question) => {
      if (
        !isSectionQuestion(question) &&
        question.type === 'camera' &&
        typeof cameraCapturedAt[question.id] !== 'undefined'
      ) {
        accumulator[question.id] = String(cameraCapturedAt[question.id] || '')
      }
      return accumulator
    }, {})

    writeFormDraft(activeFormSlug, {
      answers: normalizedAnswers,
      locationOtherAnswers: normalizedLocationOtherAnswers,
      selectDetailAnswers: normalizedSelectDetailAnswers,
      selectDetailCapturedAt: normalizedSelectDetailCapturedAt,
      cameraCapturedAt: normalizedCameraCapturedAt,
      selfDeclarationAccepted,
    })
  }, [
    activeFormSlug,
    answers,
    cameraCapturedAt,
    draftReady,
    formData.questions,
    isAdminShellView,
    isSubmissionEditMode,
    isReceiptPage,
    loadingForm,
    locationOtherAnswers,
    selectDetailCapturedAt,
    selectDetailAnswers,
    selfDeclarationAccepted,
  ])

  useEffect(() => {
    setLoadingLocations(true)
    setAvailableLocationsError('')

    const unsubscribe = onSnapshot(
      query(collection(db, 'locations')),
      (snapshot) => {
        const rows = snapshot.docs
          .map((locationDoc) => ({
            id: locationDoc.id,
            ...locationDoc.data(),
          }))
          .sort((a, b) => {
            const orderDiff = toSortOrder(a) - toSortOrder(b)
            if (orderDiff !== 0) {
              return orderDiff
            }
            return String(a.name || '').localeCompare(String(b.name || ''), 'nb')
          })

        setAvailableLocations(rows)
        setAvailableLocationsError('')
        setLoadingLocations(false)
      },
      (error) => {
        setAvailableLocations([])
        setAvailableLocationsError(getLocationsLoadErrorMessage(error))
        setLoadingLocations(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setSubmissions([])
      return
    }

    let cancelled = false

    async function loadSubmissions() {
      setLoadingSubmissions(true)

      try {
        const submissionsQuery = query(
          collection(db, 'formSubmissions'),
          where('formSlug', '==', activeFormSlug),
        )
        const snapshot = await getDocs(submissionsQuery)

        const rows = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => {
            const aSeconds = a.submittedAt?.seconds || 0
            const bSeconds = b.submittedAt?.seconds || 0
            return bSeconds - aSeconds
          })

        if (cancelled) {
          return
        }

        setSubmissions(rows)
      } finally {
        if (!cancelled) {
          setLoadingSubmissions(false)
        }
      }
    }

    async function loadErrors() {
      setLoadingErrors(true)
      try {
        const snap = await getDocs(query(
          collection(db, 'submissionErrors'),
          where('formSlug', '==', activeFormSlug),
        ))
        if (cancelled) return
        setSubmissionErrors(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.occurredAt?.seconds || 0) - (a.occurredAt?.seconds || 0))
        )
      } catch {
      } finally {
        if (!cancelled) setLoadingErrors(false)
      }
    }

    loadSubmissions()
    loadErrors()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, isAdmin])

  useEffect(() => {
    if (!isAdmin) {
      setManualRemarks([])
      return
    }

    let cancelled = false

    async function loadManualRemarks() {
      setLoadingManualRemarks(true)

      try {
        const remarksQuery = query(collection(db, 'formRemarks'), where('formSlug', '==', activeFormSlug))
        const snapshot = await getDocs(remarksQuery)

        const rows = snapshot.docs
          .map((item) => {
            const normalized = normalizeManualRemarkEntry(item.data())
            if (!normalized) {
              return null
            }

            return {
              id: item.id,
              formSlug: activeFormSlug,
              ...normalized,
            }
          })
          .filter(Boolean)
          .sort((a, b) => {
            return getTimestampSeconds(b.recordedAt) - getTimestampSeconds(a.recordedAt)
          })

        if (cancelled) {
          return
        }

        setManualRemarks(rows)
      } catch {
        if (!cancelled) {
          setManualRemarks([])
        }
      } finally {
        if (!cancelled) {
          setLoadingManualRemarks(false)
        }
      }
    }

    loadManualRemarks()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, isAdmin])

  useEffect(() => {
    if (!activeReceiptLookupToken) {
      setReceiptSubmission(null)
      setReceiptReviewData(null)
      setReceiptError('')
      setLoadingReceipt(false)
      return
    }

    let cancelled = false

    async function loadReceipt() {
      setLoadingReceipt(true)
      setReceiptError('')

      try {
        const snapshot = await getDoc(doc(db, 'formSubmissionReceipts', activeReceiptLookupToken))

        if (!snapshot.exists()) {
          if (!cancelled) {
            setReceiptSubmission(null)
            setReceiptError('Fant ikke kvitteringen.')
          }
          return
        }

        const data = snapshot.data()
        if (String(data?.formSlug || '').trim().toLowerCase() !== activeFormSlug) {
          if (!cancelled) {
            setReceiptSubmission(null)
            setReceiptError('Kvitteringen tilhører et annet skjema.')
          }
          return
        }

        const receiptBase = { id: snapshot.id, ...data }
        if (!cancelled) {
          setReceiptSubmission(receiptBase)
        }
        // Fetch review data from formSubmissions (not readable publicly) via CF
        if (snapshot.id) {
          httpsCallable(functions, 'getReceiptReviewData')({ receiptToken: snapshot.id })
            .then(({ data: reviewData }) => {
              if (!cancelled && reviewData) {
                setReceiptReviewData(reviewData)
                if (reviewData.feedbackReadConfirmed) setFeedbackConfirmDone(true)
              }
            })
            .catch(() => {})
        }
      } catch {
        if (!cancelled) {
          setReceiptSubmission(null)
          setReceiptError('Kunne ikke laste kvitteringen akkurat nå.')
        }
      } finally {
        if (!cancelled) {
          setLoadingReceipt(false)
        }
      }
    }

    loadReceipt()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, activeReceiptLookupToken])

  const receiptImageLoadedForRef = useRef(null)
  useEffect(() => {
    if (!receiptSubmission) {
      setReceiptImageUrls({})
      receiptImageLoadedForRef.current = null
      return
    }

    // Deduplicate: in React StrictMode effects fire twice per mount.
    // Skip if we already started loading for this exact submission object.
    if (receiptImageLoadedForRef.current === receiptSubmission) return
    receiptImageLoadedForRef.current = receiptSubmission

    const imagePaths = Array.from(
      new Set([
        ...(Array.isArray(receiptSubmission.imagePaths) ? receiptSubmission.imagePaths : []),
        ...Object.values(receiptSubmission.answers || {}).filter((value) => isStorageImagePath(value)),
      ]),
    )

    if (imagePaths.length === 0) {
      setReceiptImageUrls({})
      return
    }

    Promise.all(
      imagePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    ).then((pairs) => {
      if (receiptImageLoadedForRef.current !== receiptSubmission) return
      setReceiptImageUrls(
        Object.fromEntries(pairs.filter(([, url]) => Boolean(url))),
      )
    })
  }, [receiptSubmission])

  useEffect(() => {
    if (isReviewView && submissionId) {
      setSelectedSubmissionId(submissionId)
      return
    }

    setSelectedSubmissionId('')
  }, [activeFormSlug, isSubmissionsView, isFlaggedView, isReviewView, submissionId])

  useEffect(() => {
    if (!isSubmissionsView) {
      setSelectedSubmissionDay('')
      return
    }

    const availableDayKeys = Array.from(
      new Set(submissions.map((submission) => getSubmissionDayKey(submission.submittedAt)).filter(Boolean)),
    )

    if (availableDayKeys.length === 0) {
      setSelectedSubmissionDay('')
      return
    }

    setSelectedSubmissionDay((previous) =>
      previous && availableDayKeys.includes(previous) ? previous : availableDayKeys[0],
    )
  }, [isSubmissionsView, submissions])

  useEffect(() => {
    if (!selectedSubmissionId) {
      setSelectedSubmissionImageUrls({})
      setSelectedSubmissionImagesLoading(false)
      setSelectedSubmissionImageMeta({})
      setReviewDraftStatuses({})
      setReviewDraftComments({})
      setReviewSubmissionState({ saving: false, error: '' })
      setPlandayTimeConfirmed(null)
      setReviewGeneralFeedback('')
      setReviewRejected(false)
      setReviewRejectionComment('')
      return
    }

    const selectedSubmission = submissions.find((item) => item.id === selectedSubmissionId)
    if (!selectedSubmission) {
      setSelectedSubmissionImageUrls({})
      setSelectedSubmissionImagesLoading(false)
      setSelectedSubmissionImageMeta({})
      setReviewDraftStatuses({})
      setReviewDraftComments({})
      setReviewSubmissionState({ saving: false, error: '' })
      setPlandayTimeConfirmed(null)
      setReviewGeneralFeedback('')
      setReviewRejected(false)
      setReviewRejectionComment('')
      return
    }

    let cancelled = false
    setSelectedSubmissionImagesLoading(true)
    const reviewQuestionsForSubmission = formData.questions.filter(
      (question) => !isSectionQuestion(question) && Boolean(question.includeInReview),
    )
    const reviewEntries = getOrderedAnswerEntries(
      selectedSubmission.answers || {},
      reviewQuestionsForSubmission,
      {
        includeRemainingAnswers: false,
      },
    )
    const flaggedKeys = Array.isArray(selectedSubmission.flaggedAnswers)
      ? selectedSubmission.flaggedAnswers
          .map((item) => String(item?.answerKey || '').trim())
          .filter(Boolean)
      : []
    const defaultStatus = selectedSubmission.status === 'reviewed' ? 'approved' : ''

    setReviewDraftStatuses(
      Object.fromEntries(
        reviewEntries.map(([answerKey]) => [
          answerKey,
          flaggedKeys.includes(answerKey) ? 'flagged' : defaultStatus,
        ]),
      ),
    )
    setReviewDraftComments(
      Array.isArray(selectedSubmission.flaggedAnswers)
        ? Object.fromEntries(
            selectedSubmission.flaggedAnswers
              .map((item) => [String(item?.answerKey || '').trim(), String(item?.comment || '')])
              .filter(([answerKey]) => Boolean(answerKey)),
          )
        : {},
    )
    setReviewSubmissionState({ saving: false, error: '' })

    const allPaths = [
      ...(Array.isArray(selectedSubmission.imagePaths) ? selectedSubmission.imagePaths : []),
      ...Object.values(selectedSubmission.answers || {}).filter((value) => isStorageImagePath(value)),
    ]
    const uniquePaths = Array.from(new Set(allPaths))

    Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    )
      .then((pairs) => {
        if (cancelled) {
          return
        }
        setSelectedSubmissionImageUrls(
          Object.fromEntries(pairs.filter(([, url]) => url.length > 0)),
        )
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedSubmissionImagesLoading(false)
        }
      })

    setSelectedSubmissionImageMeta({})
    Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const meta = await getMetadata(ref(storage, path))
          const t = meta.timeCreated
          if (!t) return null
          const d = new Date(t)
          const formatted = d.toLocaleString('en-GB', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: 'Europe/Oslo',
          })
          return [path, formatted]
        } catch {
          return null
        }
      }),
    ).then((pairs) => {
      if (cancelled) return
      setSelectedSubmissionImageMeta(
        Object.fromEntries(pairs.filter(Boolean)),
      )
    })

    return () => {
      cancelled = true
    }
  }, [formData.questions, selectedSubmissionId, submissions])

  useEffect(() => {
    const validQuestionIds = new Set(
      formData.questions
        .filter((question) => !isSectionQuestion(question) && Boolean(question.includeInAnalysis))
        .map((question) => question.id),
    )

    setSelectedHistoryQuestionIds((previous) => {
      const next = previous.filter((questionId) => validQuestionIds.has(questionId))
      if (next.length === previous.length && next.every((questionId, index) => questionId === previous[index])) {
        return previous
      }
      return next
    })
  }, [formData.questions])

  useEffect(() => {
    if (!isHistoryView) {
      setHistoryQuestionFilterOpen(false)
      setHistoryLocationFilterOpen(false)
    }
  }, [isHistoryView])

  useEffect(() => {
    if (!selectedSubmissionId || !isReviewView) {
      setReviewEmailOverride('')
      setReviewEmailSuggestion('')
      return
    }
    const sub = submissions.find((s) => s.id === selectedSubmissionId)
    if (!sub) {
      setReviewEmailOverride('')
      setReviewEmailSuggestion('')
      return
    }
    const directEmail =
      sub.submitterEmail ||
      getSubmissionEmail(sub.answers, formData.questions)
    const phone = getSubmissionPhone(sub.answers, formData.questions)
    if (directEmail) {
      setReviewEmailOverride(directEmail)
    }
    if (!phone) {
      if (!directEmail) setReviewEmailOverride('')
      setReviewEmailSuggestion('')
      return
    }
    getDoc(doc(db, 'phoneEmails', phone))
      .then((snap) => {
        const saved = snap.exists() ? (snap.data().email || '') : ''
        setReviewEmailSuggestion(saved)
        if (!directEmail) setReviewEmailOverride(saved)
      })
      .catch(() => {
        setReviewEmailSuggestion('')
        if (!directEmail) setReviewEmailOverride('')
      })
  }, [selectedSubmissionId, isReviewView, submissions])

  function onAnswerChange(questionId, value) {
    const question = formData.questions.find((item) => item.id === questionId)
    const nextValue = question?.type === 'phone' ? normalizeNorwegianPhoneNumber(value) : value

    setAnswers((previous) => ({
      ...previous,
      [questionId]: nextValue,
    }))
  }

  async function onCameraFileChange(questionId, file) {
    if (!file) {
      cameraUploadRequestIdsRef.current[questionId] = `${Date.now()}-cleared`
      onAnswerChange(questionId, '')
      setCameraFiles((previous) => ({
        ...previous,
        [questionId]: null,
      }))
      setCameraCapturedAt((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setCameraPreviews((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setCameraUploadState((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      return
    }

    if (!shouldUploadStengeskjemaImagesImmediately) {
      onAnswerChange(questionId, file.name)
      setCameraUploadState((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })

      const capturedAtValue =
        activeFormSlug === STENGESKJEMA_ID ? await readImageCapturedAtValue(file) : ''
      const nextFile = await compressUploadedImage(file)

      setCameraFiles((previous) => ({
        ...previous,
        [questionId]: nextFile,
      }))
      setCameraCapturedAt((previous) => {
        const next = { ...previous }
        if (capturedAtValue) {
          next[questionId] = capturedAtValue
        } else {
          delete next[questionId]
        }
        return next
      })

      try {
        const previewUrl = await readFileAsDataUrl(nextFile)
        onAnswerChange(questionId, nextFile.name)
        setCameraPreviews((previous) => ({
          ...previous,
          [questionId]: previewUrl,
        }))
        setCameraCapturedAt((previous) =>
          capturedAtValue
            ? {
                ...previous,
                [questionId]: capturedAtValue,
              }
            : previous,
        )
      } catch {
        setCameraPreviews((previous) => {
          if (typeof previous[questionId] === 'undefined') {
            return previous
          }
          const next = { ...previous }
          delete next[questionId]
          return next
        })
      }
      return
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    cameraUploadRequestIdsRef.current[questionId] = requestId
    setCameraUploadState((previous) => ({
      ...previous,
      [questionId]: { uploading: true, error: '' },
    }))

    const isStengeskjema = activeFormSlug === STENGESKJEMA_ID
    const [capturedAtValue, capturedAtDate] = isStengeskjema
      ? await Promise.all([readImageCapturedAtValue(file), readImageCapturedAtDate(file)])
      : ['', null]

    try {
      const nextFile = await compressUploadedImage(file)
      setCameraFiles((previous) => ({
        ...previous,
        [questionId]: nextFile,
      }))
      const path = createTemporaryImageUploadPath(activeFormSlug, questionId, nextFile.name, {
        capturedAt: capturedAtDate,
      })
      await uploadBytes(ref(storage, path), nextFile, {
        contentType: nextFile.type || 'image/jpeg',
      })
      const previewUrl = await getDownloadURL(ref(storage, path))

      if (cameraUploadRequestIdsRef.current[questionId] !== requestId) {
        return
      }

      onAnswerChange(questionId, path)
      setCameraPreviews((previous) => ({
        ...previous,
        [questionId]: previewUrl,
      }))
      setCameraCapturedAt((previous) => {
        const next = { ...previous }
        if (capturedAtValue) {
          next[questionId] = capturedAtValue
        } else {
          delete next[questionId]
        }
        return next
      })
      setCameraFiles((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setCameraUploadState((previous) => ({
        ...previous,
        [questionId]: { uploading: false, error: '' },
      }))
    } catch (uploadError) {
      if (cameraUploadRequestIdsRef.current[questionId] !== requestId) {
        return
      }

      setCameraFiles((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setCameraUploadState((previous) => ({
        ...previous,
        [questionId]: {
          uploading: false,
          error: getImmediateImageUploadErrorMessage(uploadError),
        },
      }))
    }
  }

  async function onMultiCameraFileAdd(questionId, file) {
    if (!file) {
      return
    }

    setMultiCameraUploadState((previous) => ({
      ...previous,
      [questionId]: { uploading: true, error: '' },
    }))

    try {
      const nextFile = await compressUploadedImage(file)
      const previewUrl = await readFileAsDataUrl(nextFile)

      setMultiCameraFiles((previous) => ({
        ...previous,
        [questionId]: [...(previous[questionId] || []), nextFile],
      }))
      setMultiCameraPreviews((previous) => ({
        ...previous,
        [questionId]: [...(previous[questionId] || []), previewUrl],
      }))

      const existingPaths = parseMultiCameraAnswer(answers[questionId])
      const placeholderEntry = `pending:${nextFile.name}`
      onAnswerChange(questionId, JSON.stringify([...existingPaths, placeholderEntry]))

      setMultiCameraUploadState((previous) => ({
        ...previous,
        [questionId]: { uploading: false, error: '' },
      }))
    } catch {
      setMultiCameraUploadState((previous) => ({
        ...previous,
        [questionId]: { uploading: false, error: 'Kunne ikke lese bildet. Prøv en annen fil.' },
      }))
    }
  }

  function onMultiCameraFileRemove(questionId, indexToRemove) {
    setMultiCameraFiles((previous) => {
      const list = [...(previous[questionId] || [])]
      list.splice(indexToRemove, 1)
      return { ...previous, [questionId]: list }
    })
    setMultiCameraPreviews((previous) => {
      const list = [...(previous[questionId] || [])]
      list.splice(indexToRemove, 1)
      return { ...previous, [questionId]: list }
    })

    const existingPaths = parseMultiCameraAnswer(answers[questionId])
    const updated = existingPaths.filter((_, i) => i !== indexToRemove)
    onAnswerChange(questionId, updated.length > 0 ? JSON.stringify(updated) : '')
  }

  async function onSelectDetailCameraFileChange(questionId, file) {
    if (!file) {
      selectDetailUploadRequestIdsRef.current[questionId] = `${Date.now()}-cleared`
      setSelectDetailFiles((previous) => ({
        ...previous,
        [questionId]: null,
      }))
      setSelectDetailCapturedAt((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setSelectDetailPreviews((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setSelectDetailUploadState((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      return
    }

    if (!shouldUploadStengeskjemaImagesImmediately) {
      setSelectDetailUploadState((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })

      const capturedAtValue =
        activeFormSlug === STENGESKJEMA_ID ? await readImageCapturedAtValue(file) : ''
      const nextFile = await compressUploadedImage(file)

      setSelectDetailFiles((previous) => ({
        ...previous,
        [questionId]: nextFile,
      }))
      setSelectDetailCapturedAt((previous) => {
        const next = { ...previous }
        if (capturedAtValue) {
          next[questionId] = capturedAtValue
        } else {
          delete next[questionId]
        }
        return next
      })

      try {
        const previewUrl = await readFileAsDataUrl(nextFile)
        setSelectDetailPreviews((previous) => ({
          ...previous,
          [questionId]: previewUrl,
        }))
        setSelectDetailCapturedAt((previous) =>
          capturedAtValue
            ? {
                ...previous,
                [questionId]: capturedAtValue,
              }
            : previous,
        )
      } catch {
        setSelectDetailPreviews((previous) => {
          if (typeof previous[questionId] === 'undefined') {
            return previous
          }
          const next = { ...previous }
          delete next[questionId]
          return next
        })
      }
      return
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    selectDetailUploadRequestIdsRef.current[questionId] = requestId
    setSelectDetailUploadState((previous) => ({
      ...previous,
      [questionId]: { uploading: true, error: '' },
    }))

    const isStengeskjema = activeFormSlug === STENGESKJEMA_ID
    const [capturedAtValue, capturedAtDate] = isStengeskjema
      ? await Promise.all([readImageCapturedAtValue(file), readImageCapturedAtDate(file)])
      : ['', null]

    try {
      const nextFile = await compressUploadedImage(file)
      setSelectDetailFiles((previous) => ({
        ...previous,
        [questionId]: nextFile,
      }))
      const path = createTemporaryImageUploadPath(activeFormSlug, questionId, nextFile.name, {
        detail: true,
        capturedAt: capturedAtDate,
      })
      await uploadBytes(ref(storage, path), nextFile, {
        contentType: nextFile.type || 'image/jpeg',
      })
      const previewUrl = await getDownloadURL(ref(storage, path))

      if (selectDetailUploadRequestIdsRef.current[questionId] !== requestId) {
        return
      }

      setSelectDetailAnswers((previous) => ({
        ...previous,
        [questionId]: path,
      }))
      setSelectDetailPreviews((previous) => ({
        ...previous,
        [questionId]: previewUrl,
      }))
      setSelectDetailCapturedAt((previous) => {
        const next = { ...previous }
        if (capturedAtValue) {
          next[questionId] = capturedAtValue
        } else {
          delete next[questionId]
        }
        return next
      })
      setSelectDetailFiles((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setSelectDetailUploadState((previous) => ({
        ...previous,
        [questionId]: { uploading: false, error: '' },
      }))
    } catch (uploadError) {
      if (selectDetailUploadRequestIdsRef.current[questionId] !== requestId) {
        return
      }

      setSelectDetailFiles((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      setSelectDetailUploadState((previous) => ({
        ...previous,
        [questionId]: {
          uploading: false,
          error: getImmediateImageUploadErrorMessage(uploadError),
        },
      }))
    }
  }

  function resetAllAnswers() {
    const confirmed = window.confirm(publicCopy.resetAnswersConfirm)
    if (!confirmed) {
      return
    }

    cameraUploadRequestIdsRef.current = {}
    selectDetailUploadRequestIdsRef.current = {}

    const clearedAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question)) {
        return accumulator
      }
      accumulator[question.id] = ''
      return accumulator
    }, {})

    setAnswers(clearedAnswers)
    setLocationOtherAnswers({})
    setSelectDetailAnswers({})
    setSelectDetailFiles({})
    setSelectDetailPreviews({})
    setSelectDetailCapturedAt({})
    setSelectDetailUploadState({})
    setSelfDeclarationAccepted(false)
    setCameraFiles({})
    setCameraPreviews({})
    setCameraCapturedAt({})
    setCameraUploadState({})
    setMultiCameraFiles({})
    setMultiCameraPreviews({})
    setMultiCameraUploadState({})
    setFormInstanceKey((previous) => previous + 1)
    clearFormDraft(activeFormSlug)
    setSubmitErrorQuestionId('')
    setSubmitErrorTargetId('')
    setSubmitState({
      submitting: false,
      message: '',
      error: '',
    })
  }

  function getQuestionValidationTargetId(question) {
    const answerValue = String(answers[question.id] || '').trim()
    const selectedBehavior = getSelectOptionBehavior(question, answerValue)

    if (question.type === 'select' && selectedBehavior.kind === 'input' && answerValue) {
      return getSelectDetailAnswerKey(question.id)
    }

    if (question.type === 'select' && selectedBehavior.kind === 'camera' && answerValue) {
      return `${question.id}-detail-camera-button`
    }

    if (question.type === 'camera') {
      return `${question.id}-camera-button`
    }

    if (question.type === 'multi-camera') {
      return `${question.id}-multi-camera-button`
    }

    if (question.type === 'location' && answers[question.id] === LOCATION_OTHER_VALUE) {
      return `${question.id}-other`
    }

    return question.id
  }

  function focusValidationTarget(targetId) {
    if (typeof document === 'undefined') {
      return
    }

    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId)
      if (!target) {
        return
      }

      const scrollTarget =
        target.closest('.form-question-block') || target.closest('.self-declaration-box') || target

      scrollTarget.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })

      window.setTimeout(() => {
        if (typeof target.focus === 'function') {
          target.focus({ preventScroll: true })
        }
      }, 200)
    })
  }

  function isQuestionMissingRequiredAnswer(question) {
    const answerValue = String(answers[question.id] || '').trim()
    const selectedBehavior = getSelectOptionBehavior(question, answerValue)

    if (question.type === 'select' && selectedBehavior.kind === 'input' && answerValue) {
      return !String(selectDetailAnswers[question.id] || '').trim()
    }

    if (question.type === 'select' && selectedBehavior.kind === 'camera' && answerValue) {
      if (selectDetailUploadState[question.id]?.uploading) {
        return true
      }
      return !selectDetailFiles[question.id] && !isPersistedImageValue(selectDetailAnswers[question.id])
    }

    if (!question.required) {
      return false
    }

    if (question.type === 'camera') {
      if (cameraUploadState[question.id]?.uploading) {
        return true
      }
      return !cameraFiles[question.id] && !isPersistedImageValue(answerValue)
    }

    if (question.type === 'multi-camera') {
      if (multiCameraUploadState[question.id]?.uploading) {
        return true
      }
      const files = multiCameraFiles[question.id] || []
      const paths = parseMultiCameraAnswer(answerValue)
      return files.length === 0 && paths.filter((p) => isStorageImagePath(p)).length === 0
    }

    if (question.type === 'location') {
      return answers[question.id] === LOCATION_OTHER_VALUE
        ? !String(locationOtherAnswers[question.id] || '').trim()
        : !answerValue
    }

    return !answerValue
  }

  async function onSubmit(event) {
    event.preventDefault()
    setSubmitErrorQuestionId('')
    setSubmitErrorTargetId('')
    setSubmitState({ submitting: false, message: '', error: '' })

    if (hasPendingImageUploads) {
      const msg = publicCopy.waitForPhotoUpload
      window.alert(msg)
      setSubmitState({
        submitting: false,
        message: '',
        error: msg,
      })
      return
    }

    if (formData.enableSelfDeclaration && !selfDeclarationAccepted) {
      const msg = displayLanguage === 'en'
        ? 'You must confirm the self-declaration.'
        : 'Du må bekrefte egenerklæringen.'
      window.alert(msg)
      setSubmitErrorQuestionId('')
      setSubmitErrorTargetId('self-declaration-checkbox')
      setSubmitState({
        submitting: false,
        message: '',
        error: msg,
      })
      focusValidationTarget('self-declaration-checkbox')
      return
    }

    const missingRequired = visibleInputQuestions.find(isQuestionMissingRequiredAnswer)

    if (missingRequired) {
      const msg = displayLanguage === 'en'
        ? `Missing answer: ${translateText(missingRequired.label)}`
        : `Manglende svar: ${missingRequired.label}`
      window.alert(msg)
      const targetId = getQuestionValidationTargetId(missingRequired)
      setSubmitErrorQuestionId(missingRequired.id)
      setSubmitErrorTargetId(targetId)
      setSubmitState({
        submitting: false,
        message: '',
        error: msg,
      })
      focusValidationTarget(targetId)
      return
    }

    const invalidPhoneQuestion = visibleInputQuestions.find((question) => {
      if (question.type !== 'phone') {
        return false
      }

      const answerValue = String(answers[question.id] || '').trim()
      if (!answerValue) {
        return false
      }

      return !isValidNorwegianPhoneNumber(answerValue)
    })

    if (invalidPhoneQuestion) {
      const msg = displayLanguage === 'en'
        ? `${translateText(invalidPhoneQuestion.label)}: ${publicCopy.phoneMustBeEightDigits}`
        : `${invalidPhoneQuestion.label}: ${publicCopy.phoneMustBeEightDigits}`
      window.alert(msg)
      setSubmitErrorQuestionId(invalidPhoneQuestion.id)
      setSubmitErrorTargetId(invalidPhoneQuestion.id)
      setSubmitState({
        submitting: false,
        message: '',
        error: msg,
      })
      focusValidationTarget(invalidPhoneQuestion.id)
      return
    }

    if (isSubmissionEditMode) {
      const editState = getReceiptEditState(receiptSubmission?.submittedAtIso)
      if (!receiptSubmission?.submissionId) {
        setSubmitState({
          submitting: false,
          message: '',
          error: publicCopy.loadingReceipt,
        })
        return
      }
      if (!editState.allowed) {
        setSubmitState({
          submitting: false,
          message: '',
          error: publicCopy.editWindowExpired,
        })
        return
      }
    }

    const receiptWindow = window.open('', '_blank')
    renderPendingReceiptWindow(receiptWindow, {
      lang: displayLanguage,
      title: publicCopy.loadingReceipt,
      headline: publicCopy.preparingReceipt,
      hint: publicCopy.preparingReceiptHint,
    })
    setSubmitErrorQuestionId('')
    setSubmitErrorTargetId('')
    setSubmitState({ submitting: true, message: '', error: '' })

    try {
      const submissionRef =
        isSubmissionEditMode && receiptSubmission?.submissionId
          ? doc(db, 'formSubmissions', receiptSubmission.submissionId)
          : doc(collection(db, 'formSubmissions'))
      const receiptRef =
        isSubmissionEditMode && editReceiptToken
          ? doc(db, 'formSubmissionReceipts', editReceiptToken)
          : doc(collection(db, 'formSubmissionReceipts'))
      const imagePaths = []
      const receiptImageMap = {}
      const submissionAnswers = {}

      visibleInputQuestions.forEach((question) => {
        const answerValue = answers[question.id]
        submissionAnswers[question.id] =
          typeof answerValue === 'string' ? answerValue.trim() : answerValue || ''

        if (question.type === 'camera' && !isPersistedImageValue(submissionAnswers[question.id])) {
          submissionAnswers[question.id] = ''
        }

        if (question.type === 'multi-camera') {
          submissionAnswers[question.id] = ''
        }

        if (question.type === 'location') {
          submissionAnswers[question.id] =
            answers[question.id] === LOCATION_OTHER_VALUE
              ? String(locationOtherAnswers[question.id] || '').trim()
              : String(answers[question.id] || '').trim()
        }

        if (question.type === 'select') {
          const selectedValue = String(answers[question.id] || '').trim()
          const selectedBehavior = getSelectOptionBehavior(question, selectedValue)
          const detailValue = String(selectDetailAnswers[question.id] || '').trim()
          if (selectedBehavior.kind === 'input' && detailValue) {
            submissionAnswers[getSelectDetailAnswerKey(question.id)] = detailValue
          }
          if (selectedBehavior.kind === 'camera') {
            const detailCapturedAtValue = String(selectDetailCapturedAt[question.id] || '').trim()
            if (detailCapturedAtValue) {
              submissionAnswers[getImageCapturedAtAnswerKey(getSelectDetailAnswerKey(question.id))] =
                detailCapturedAtValue
            }
            const file = selectDetailFiles[question.id]
            if (file) {
              const fileName = sanitizeFileName(file.name)
              const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-detail-${fileName}`
              imagePaths.push(path)
              submissionAnswers[getSelectDetailAnswerKey(question.id)] = path
            } else if (isPersistedImageValue(detailValue)) {
              submissionAnswers[getSelectDetailAnswerKey(question.id)] = detailValue
            }
          }
        }
      })

      if (formData.includeSubmissionDateTime) {
        const submittedNow = new Date()
        submissionAnswers[SUBMISSION_DATE_KEY] = submittedNow.toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })
        submissionAnswers[SUBMISSION_TIME_KEY] = submittedNow.toLocaleTimeString('nb-NO', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Oslo',
        })
      }

      if (formData.enableSelfDeclaration && selfDeclarationAccepted) {
        submissionAnswers[SELF_DECLARATION_ACCEPTED_KEY] = 'Ja'
      }

      await Promise.all(
        visibleInputQuestions.map(async (question) => {
          if (question.type !== 'camera') {
            return
          }
          const capturedAtValue = String(cameraCapturedAt[question.id] || '').trim()
          if (capturedAtValue) {
            submissionAnswers[getImageCapturedAtAnswerKey(question.id)] = capturedAtValue
          }
          const file = cameraFiles[question.id]
          if (!file) {
            return
          }
          const fileName = sanitizeFileName(file.name)
          const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-${fileName}`
          await uploadBytes(ref(storage, path), file, {
            contentType: file.type || 'image/jpeg',
          })
          const downloadUrl = await getDownloadURL(ref(storage, path))
          imagePaths.push(path)
          submissionAnswers[question.id] = path
          receiptImageMap[path] = downloadUrl
        }),
      )

      await Promise.all(
        visibleInputQuestions.map(async (question) => {
          if (question.type !== 'multi-camera') {
            return
          }
          const files = multiCameraFiles[question.id] || []
          if (files.length === 0) {
            return
          }
          const uploadedPaths = await Promise.all(
            files.map(async (file, fileIndex) => {
              const fileName = sanitizeFileName(file.name)
              const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-${fileIndex}-${fileName}`
              await uploadBytes(ref(storage, path), file, {
                contentType: file.type || 'image/jpeg',
              })
              const downloadUrl = await getDownloadURL(ref(storage, path))
              imagePaths.push(path)
              receiptImageMap[path] = downloadUrl
              return path
            }),
          )
          submissionAnswers[question.id] = JSON.stringify(uploadedPaths)
        }),
      )

      await Promise.all(
        formData.questions.map(async (question) => {
          if (question.type !== 'select') {
            return
          }

          const selectedValue = String(answers[question.id] || '').trim()
          const selectedBehavior = getSelectOptionBehavior(question, selectedValue)
          if (selectedBehavior.kind !== 'camera') {
            return
          }

          const file = selectDetailFiles[question.id]
          if (!file) {
            return
          }

          const fileName = sanitizeFileName(file.name)
          const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-detail-${fileName}`
          await uploadBytes(ref(storage, path), file, {
            contentType: file.type || 'image/jpeg',
          })
          submissionAnswers[getSelectDetailAnswerKey(question.id)] = path
          receiptImageMap[path] = await getDownloadURL(ref(storage, path))
        }),
      )

      const allImagePaths = Array.from(
        new Set(Object.values(submissionAnswers).filter((value) => isStorageImagePath(value))),
      )
      const mergedReceiptImageMap = allImagePaths.reduce((accumulator, path) => {
        accumulator[path] =
          receiptImageMap[path] ||
          receiptSubmission?.imageUrls?.[path] ||
          receiptImageUrls[path] ||
          ''
        return accumulator
      }, {})

      const submitterEmail = getSubmissionEmail(submissionAnswers, formData.questions)
      const submittedAtIso = new Date().toISOString()

      let receiptTokenValue = ''

      try {
        await setDoc(
          receiptRef,
          {
            formSlug: activeFormSlug,
            formTitle: formData.title || activeFormSlug,
            submissionId: submissionRef.id,
            submitterEmail,
            submittedAtIso: isSubmissionEditMode
              ? receiptSubmission?.submittedAtIso || submittedAtIso
              : submittedAtIso,
            answers: submissionAnswers,
            imagePaths: allImagePaths,
            imageUrls: mergedReceiptImageMap,
            ...(isSubmissionEditMode
              ? {
                  updatedAt: serverTimestamp(),
                }
              : {
                  createdAt: serverTimestamp(),
                }),
          },
          { merge: isSubmissionEditMode },
        )
        receiptTokenValue = receiptRef.id
      } catch (receiptError) {
        console.error('Failed to create submission receipt', {
          formSlug: activeFormSlug,
          submissionId: submissionRef.id,
          error: receiptError,
        })
      }

      await setDoc(
        submissionRef,
        {
          formId: formDocId,
          formSlug: activeFormSlug,
          formTitle: formData.title || activeFormSlug,
          answers: submissionAnswers,
          imagePaths: allImagePaths,
          ...(receiptTokenValue ? { receiptToken: receiptTokenValue } : {}),
          submitterEmail,
          status: 'awaiting review',
          statusUpdatedBy: 'system',
          statusUpdatedAt: serverTimestamp(),
          ...(isSubmissionEditMode
            ? {
                updatedAt: serverTimestamp(),
              }
            : {
                submittedAt: serverTimestamp(),
              }),
        },
        { merge: isSubmissionEditMode },
      )

      const submitterPhone = getSubmissionPhone(submissionAnswers, formData.questions)
      if (submitterPhone && submitterEmail) {
        setDoc(doc(db, 'phoneEmails', submitterPhone), { email: submitterEmail }, { merge: true }).catch(
          (err) => console.error('Failed to save phoneEmails', err),
        )
      }

      const submittedLocation = getSubmissionLocation(submissionAnswers, formData.questions)
      if (submittedLocation) {
        const inventoryDocId = `${activeFormSlug}:${submittedLocation}`
        deleteDoc(doc(db, 'inventoryUpdates', inventoryDocId)).catch(() => {})
        setInventoryUpdates((prev) => {
          const next = { ...prev }
          delete next[submittedLocation]
          return next
        })
      }

      if (receiptTokenValue) {
        const receiptUrl = `${window.location.origin}/skjema/${activeFormSlug}/kvittering/${receiptTokenValue}`
        receiptWindow?.location.replace(
          receiptUrl,
        )
      } else {
        receiptWindow?.close()
      }

      const clearedAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question)) {
          return accumulator
        }
        accumulator[question.id] = ''
        return accumulator
      }, {})

      clearFormDraft(activeFormSlug)
      cameraUploadRequestIdsRef.current = {}
      selectDetailUploadRequestIdsRef.current = {}
      setAnswers(clearedAnswers)
      setLocationOtherAnswers({})
      setSelectDetailAnswers({})
      setSelectDetailFiles({})
      setSelectDetailPreviews({})
      setSelectDetailCapturedAt({})
      setSelectDetailUploadState({})
      setSelfDeclarationAccepted(false)
      setCameraFiles({})
      setCameraPreviews({})
      setCameraCapturedAt({})
      setCameraUploadState({})
      setMultiCameraFiles({})
      setMultiCameraPreviews({})
      setMultiCameraUploadState({})
      setFormInstanceKey((previous) => previous + 1)
      setSubmitState({
        submitting: false,
        message:
          displayLanguage === 'en'
            ? isSubmissionEditMode
              ? 'Thanks! Your changes have been saved.'
              : 'Thanks! The form has been submitted.'
            : isSubmissionEditMode
              ? 'Takk! Endringene er lagret.'
              : 'Takk! Skjemaet er sendt inn.',
        error: '',
      })
    } catch (error) {
      receiptWindow?.close()
      const errorCode = error?.code || 'unknown'
      const errorMessage = error?.message || 'No message'
      console.error('Failed to submit form', { formSlug: activeFormSlug, error })
      addDoc(collection(db, 'submissionErrors'), {
        formSlug: activeFormSlug,
        errorCode,
        errorMessage,
        occurredAt: serverTimestamp(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }).catch(() => {})
      setSubmitState({
        submitting: false,
        message: '',
        error: `${getSubmitErrorMessage(error)} (kode: ${errorCode})`,
      })
    }
  }

  function onEditorQuestionChange(index, key, value) {
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question
        }

        if (key === 'options') {
          const nextOptions = parseQuestionOptions(value)
          const nextSelectOptionDetails = nextOptions.reduce((accumulator, option) => {
            const existingDetail =
              question.selectOptionDetails && typeof question.selectOptionDetails === 'object'
                ? question.selectOptionDetails[option]
                : null

            accumulator[option] = {
              kind: ['input', 'message', 'camera'].includes(existingDetail?.kind)
                ? existingDetail.kind
                : 'none',
              text: typeof existingDetail?.text === 'string' ? existingDetail.text : '',
              messageColor:
                typeof existingDetail?.messageColor === 'string' ? existingDetail.messageColor : '',
              messageBold: Boolean(existingDetail?.messageBold),
              historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(existingDetail?.historyCategory)
                ? existingDetail.historyCategory
                : 'normal',
            }

            return accumulator
          }, {})

          return {
            ...question,
            optionsText: String(value),
            options: nextOptions,
            selectOptionDetails: nextSelectOptionDetails,
          }
        }

        if (key === 'type') {
          const currentOptions = parseQuestionOptions(question.optionsText || question.options)
          const nextOptions = currentOptions.length > 0 ? currentOptions : ['Ja', 'Nei']
          const nextSelectOptionDetails =
            value === 'select'
              ? nextOptions.reduce((accumulator, option) => {
                  const existingDetail =
                    question.selectOptionDetails && typeof question.selectOptionDetails === 'object'
                      ? question.selectOptionDetails[option]
                      : null

                  accumulator[option] = {
                    kind: ['input', 'message', 'camera'].includes(existingDetail?.kind)
                      ? existingDetail.kind
                      : 'none',
                    text: typeof existingDetail?.text === 'string' ? existingDetail.text : '',
                    messageColor:
                      typeof existingDetail?.messageColor === 'string'
                        ? existingDetail.messageColor
                        : '',
                    messageBold: Boolean(existingDetail?.messageBold),
                    historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(
                      existingDetail?.historyCategory,
                    )
                      ? existingDetail.historyCategory
                      : 'normal',
                  }

                  return accumulator
                }, {})
              : {}

          return {
            ...question,
            type: value,
            required: value === 'section' ? false : question.required,
            includeInReview: value === 'section' ? false : question.includeInReview,
            reviewType: value === 'section' ? '' : question.reviewType,
            includeRating: value === 'section' ? false : question.includeRating,
            shouldRestock: value === 'section' ? false : question.shouldRestock,
            isIceProductionCount: value === 'section' ? false : question.isIceProductionCount,
            deliveryUnlimited: value === 'select' ? question.deliveryUnlimited : true,
            deliveryMaxUnits: value === 'select' ? question.deliveryMaxUnits : '',
            imageUrl: question.imageUrl,
            imagePreviewUrl: question.imagePreviewUrl,
            imageFile: question.imageFile,
            removeImage: question.removeImage,
            visibleForLocations: value === 'location' ? [] : normalizeVisibleForLocations(question.visibleForLocations),
            selectOptionDetails: nextSelectOptionDetails,
            options: value === 'select' ? nextOptions : [],
            optionsText:
              value === 'select'
                ? nextOptions.join(', ')
                : '',
          }
        }

        if (key === 'label') {
          return {
            ...question,
            label: value,
          }
        }

        return {
          ...question,
          [key]: value,
        }
      }),
    )
  }

  async function onEditorQuestionImageChange(index, file) {
    if (!file) {
      return
    }

    const previewUrl = await readFileAsDataUrl(file)
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              imageFile: file,
              imagePreviewUrl: previewUrl,
              removeImage: false,
            }
          : question,
      ),
    )
  }

  function removeEditorQuestionImage(index) {
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              imageUrl: '',
              imagePreviewUrl: '',
              imageZoom: 1,
              imageFile: null,
              removeImage: true,
            }
          : question,
      ),
    )
  }

  function onEditorSelectOptionDetailChange(index, option, key, value) {
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question
        }

        const currentDetail =
          question.selectOptionDetails && typeof question.selectOptionDetails === 'object'
            ? question.selectOptionDetails[option]
            : null

        const nextDetail = {
          kind: ['input', 'message', 'camera'].includes(currentDetail?.kind)
            ? currentDetail.kind
            : 'none',
          text: typeof currentDetail?.text === 'string' ? currentDetail.text : '',
          messageColor:
            typeof currentDetail?.messageColor === 'string' ? currentDetail.messageColor : '',
          messageBold: Boolean(currentDetail?.messageBold),
          historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(currentDetail?.historyCategory)
            ? currentDetail.historyCategory
            : 'normal',
          [key]: value,
        }

        if (key === 'kind' && value === 'none') {
          nextDetail.text = ''
        }

        return {
          ...question,
          selectOptionDetails: {
            ...(question.selectOptionDetails || {}),
            [option]: nextDetail,
          },
        }
      }),
    )
  }

  function onEditorQuestionVisibleLocationChange(index, locationName, checked) {
    const normalizedLocationName = String(locationName || '').trim()
    if (!normalizedLocationName) {
      return
    }

    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question
        }

        const nextVisibleForLocations = checked
          ? [...normalizeVisibleForLocations(question.visibleForLocations), normalizedLocationName]
          : normalizeVisibleForLocations(question.visibleForLocations).filter(
              (item) => item !== normalizedLocationName,
            )

        return {
          ...question,
          visibleForLocations: nextVisibleForLocations,
        }
      }),
    )
  }

  function addQuestion() {
    setEditorQuestions((previous) => [
      ...previous,
      createEditorQuestion(`new-question-${previous.length + 1}-${Date.now()}`),
    ])
  }

  function insertQuestionAfter(index) {
    setEditorQuestions((previous) => {
      const next = [...previous]
      next.splice(index + 1, 0, createEditorQuestion(`insert-question-${index + 1}-${Date.now()}`))
      return next
    })
  }

  function addSection() {
    setEditorQuestions((previous) => [
      ...previous,
      {
        id: toQuestionId(`section-${previous.length + 1}`),
        label: `Kategori ${previous.length + 1}`,
        type: 'section',
        required: false,
        placeholder: '',
        imageUrl: '',
        imageZoom: 1,
        includeInAnalysis: false,
        shouldRestock: false,
        deliveryUnlimited: true,
        deliveryMaxUnits: '',
        helpTextColor: '',
        helpTextBold: false,
        visibleForLocations: [],
        selectOptionDetails: {},
        imagePreviewUrl: '',
        imageFile: null,
        removeImage: false,
        options: [],
        optionsText: '',
        moveTarget: '',
      },
    ])
  }

  function removeQuestion(index) {
    const confirmed = window.confirm('Fjerne dette spørsmålet?')
    if (!confirmed) {
      return
    }

    setEditorQuestions((previous) => previous.filter((_, questionIndex) => questionIndex !== index))
  }

  function duplicateQuestion(index) {
    setEditorQuestions((previous) => {
      const sourceQuestion = previous[index]
      if (!sourceQuestion) {
        return previous
      }

      const duplicateId = toQuestionId(
        `${sourceQuestion.id || sourceQuestion.label || 'question'}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
      )

      const duplicatedQuestion = {
        ...sourceQuestion,
        id: duplicateId,
        label: sourceQuestion.label ? `${sourceQuestion.label} kopi` : `Kopi ${index + 1}`,
        imagePreviewUrl: sourceQuestion.imagePreviewUrl || sourceQuestion.imageUrl || '',
        imageZoom: normalizeImageZoom(sourceQuestion.imageZoom),
        moveTarget: '',
        options: [...(sourceQuestion.options || [])],
        selectOptionDetails: Object.fromEntries(
          Object.entries(sourceQuestion.selectOptionDetails || {}).map(([option, detail]) => [
            option,
            {
              kind: detail?.kind || 'none',
              text: typeof detail?.text === 'string' ? detail.text : '',
              messageColor:
                typeof detail?.messageColor === 'string' ? detail.messageColor : '',
              messageBold: Boolean(detail?.messageBold),
              historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(detail?.historyCategory)
                ? detail.historyCategory
                : 'normal',
            },
          ]),
        ),
      }

      const next = [...previous]
      next.splice(index + 1, 0, duplicatedQuestion)
      return next
    })
  }

  function moveQuestion(index, direction) {
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= editorQuestions.length) {
      return
    }

    setEditorQuestions((previous) => {
      const reordered = [...previous]
      const [item] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, item)
      return reordered
    })
  }

  function moveQuestionToNumber(index, rawValue) {
    const requestedNumber = Number(rawValue)
    if (!Number.isFinite(requestedNumber)) {
      return
    }

    const nextIndex = Math.min(
      editorQuestions.length - 1,
      Math.max(0, Math.round(requestedNumber) - 1),
    )

    if (nextIndex === index) {
      setEditorQuestions((previous) =>
        previous.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                moveTarget: '',
              }
            : question,
        ),
      )
      return
    }

    setEditorQuestions((previous) => {
      const reordered = [...previous]
      const [item] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, {
        ...item,
        moveTarget: '',
      })

      return reordered.map((question) => ({
        ...question,
        moveTarget: '',
      }))
    })
  }

  function getQuestionImageStyle(question) {
    return {
      '--question-image-scale': String(normalizeImageZoom(question?.imageZoom)),
    }
  }

  function renderQuestionImage(src, alt, zoom, preview = false) {
    if (!src) {
      return null
    }

    return (
      <div className={preview ? 'question-image-preview-frame' : 'question-image-frame'}>
        <img
          className={preview ? 'question-image-preview-image' : 'question-image'}
          src={src}
          alt={alt}
          loading="lazy"
          style={getQuestionImageStyle({ imageZoom: zoom })}
        />
      </div>
    )
  }

  async function onSaveForm(targetIndex = null) {
    setSaveState({ saving: true, message: '', error: '' })

    try {
      const preparedQuestions = await Promise.all(
        editorQuestions.map(
          async ({ imageFile, optionsText, removeImage, ...question }, index) => {
            let imageUrl = removeImage ? '' : String(question.imageUrl || '').trim()

            if (imageFile) {
              const fileName = sanitizeFileName(imageFile.name)
              const questionId = question.id || toQuestionId(question.label || `q-${index + 1}`)
              const path = `forms/questions/${activeFormSlug}/${questionId}-${Date.now()}-${fileName}`
              await uploadBytes(ref(storage, path), imageFile, {
                contentType: imageFile.type,
              })
              imageUrl = await getDownloadURL(ref(storage, path))
            }

            return normalizeQuestion(
              {
                ...question,
                id: question.id || toQuestionId(question.label || `q-${index + 1}`),
                imageUrl,
                options: question.type === 'select' ? parseQuestionOptions(optionsText) : [],
              },
              index,
            )
          },
        ),
      )

      const payload = {
        slug: activeFormSlug,
        title: editorTitle.trim() || (isDefaultForm ? defaultStengeskjema.title : activeFormSlug),
        description: editorDescription.trim() || '',
        includeSubmissionDateTime: editorIncludeSubmissionDateTime,
        enableSelfDeclaration: editorEnableSelfDeclaration,
        selfDeclarationText: editorEnableSelfDeclaration
          ? editorSelfDeclarationText.trim()
          : '',
        questions: preparedQuestions,
        updatedAt: serverTimestamp(),
      }

      const formRef = doc(db, 'forms', formDocId || activeFormSlug)
      const snapshot = await getDoc(formRef)
      if (snapshot.exists()) {
        await updateDoc(formRef, payload)
      } else {
        await setDoc(formRef, payload)
      }

      setFormData({
        ...formData,
        ...payload,
      })
      setEditorQuestions(preparedQuestions.map((question, index) => toEditorQuestion(question, index)))
      setSaveState({
        saving: false,
        message:
          typeof targetIndex === 'number'
            ? `Spørsmål ${targetIndex + 1} lagret.`
            : 'Skjema oppdatert.',
        error: '',
      })
    } catch (error) {
      setSaveState({
        saving: false,
        message: '',
        error: getFormSaveErrorMessage(error),
      })
    }
  }

  function renderQuestionLead(question) {
    const localizedLabel = translateText(question.label)
    const localizedHelp = translateText(question.placeholder)

    return (
      <>
        <div className="question-copy">
          <span className="question-label">
            {localizedLabel}
            {!question.required ? (
              <span className="question-optional-note">{publicCopy.optionalNote}</span>
            ) : null}
          </span>
        </div>
        {question.imageUrl ? (
          renderQuestionImage(question.imageUrl, localizedLabel, question.imageZoom)
        ) : null}
        {question.placeholder ? (
          <small className="question-help" style={getHelpTextStyle(question)}>
            {localizedHelp}
          </small>
        ) : null}
      </>
    )
  }

  function renderSectionHeading(question) {
    const localizedLabel = translateText(question.label)
    const localizedHelp = translateText(question.placeholder)

    return (
      <div className="form-section-heading">
        <h3>{localizedLabel}</h3>
        {question.imageUrl ? (
          renderQuestionImage(question.imageUrl, localizedLabel, question.imageZoom)
        ) : null}
        {question.placeholder ? (
          <small className="question-help" style={getHelpTextStyle(question)}>
            {localizedHelp}
          </small>
        ) : null}
      </div>
    )
  }

  async function onUpdateSubmissionStatus(submissionId, nextStatus) {
    setStatusUpdateState((previous) => ({
      ...previous,
      [submissionId]: { saving: true, error: '' },
    }))

    try {
      await updateDoc(doc(db, 'formSubmissions', submissionId), {
        status: nextStatus,
        statusUpdatedBy: user?.email || 'admin',
        statusUpdatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
      })

      setSubmissions((previous) =>
        previous.map((submission) =>
          submission.id === submissionId
            ? {
                ...submission,
                status: nextStatus,
                statusUpdatedBy: user?.email || 'admin',
                statusUpdatedAt: new Date(),
              }
            : submission,
        ),
      )

      setStatusUpdateState((previous) => ({
        ...previous,
        [submissionId]: { saving: false, error: '' },
      }))
    } catch (err) {
      console.error('Failed to update submission status', {
        submissionId,
        nextStatus,
        error: err,
      })
      const code = err?.code ? ` (${err.code})` : ''
      const message =
        err?.code === 'permission-denied'
          ? `Kunne ikke oppdatere status${code}. Mangler tilgang i Firestore-regler.`
          : `Kunne ikke oppdatere status${code}.`
      setStatusUpdateState((previous) => ({
        ...previous,
        [submissionId]: { saving: false, error: message },
      }))
    }
  }

  async function onDeleteSubmission(submissionId) {
    const confirmed = window.confirm('Delete this submission permanently?')
    if (!confirmed) {
      return
    }

    setDeleteSubmissionState((previous) => ({
      ...previous,
      [submissionId]: { deleting: true, error: '' },
    }))

    try {
      await deleteDoc(doc(db, 'formSubmissions', submissionId))
      setSubmissions((previous) => previous.filter((submission) => submission.id !== submissionId))
      if (selectedSubmissionId === submissionId) {
        setSelectedSubmissionId('')
      }
      setDeleteSubmissionState((previous) => ({
        ...previous,
        [submissionId]: { deleting: false, error: '' },
      }))
    } catch {
      setDeleteSubmissionState((previous) => ({
        ...previous,
        [submissionId]: { deleting: false, error: 'Could not delete the submission.' },
      }))
    }
  }

  async function onSavePhoneEdit(submissionId) {
    const phoneQuestion = formData.questions.find((q) => q.type === 'phone')
    if (!phoneQuestion?.id) return
    const newPhone = editPhoneDraft.trim()
    setEditPhoneState({ saving: true, error: '' })
    try {
      await updateDoc(doc(db, 'formSubmissions', submissionId), {
        [`answers.${phoneQuestion.id}`]: newPhone,
      })
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? { ...s, answers: { ...s.answers, [phoneQuestion.id]: newPhone } }
            : s,
        ),
      )
      setEditPhoneSubmissionId('')
      setEditPhoneState({ saving: false, error: '' })
    } catch (err) {
      setEditPhoneState({ saving: false, error: `Could not save: ${err.message}` })
    }
  }

  function onViewSubmission(submissionId) {
    setSelectedSubmissionId(submissionId)
  }

  function closeSubmissionModal() {
    setSelectedSubmissionId('')
  }

  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId)
  const reviewQuestions = formData.questions.filter(
    (question) => !isSectionQuestion(question) && Boolean(question.includeInReview),
  )
  const selectedSubmissionAnswerEntries = selectedSubmission
    ? getOrderedAnswerEntries(selectedSubmission.answers || {}, reviewQuestions, {
        includeRemainingAnswers: false,
      }).filter(([answerKey]) => !answerKey.endsWith(IMAGE_CAPTURED_AT_SUFFIX))
    : []
  const hasPendingReviewDecisions = selectedSubmissionAnswerEntries.some(
    ([answerKey]) => !String(reviewDraftStatuses[answerKey] || '').trim(),
  )

  const lastReviewCameraQuestion = useMemo(() => {
    if (activeFormSlug !== STENGESKJEMA_ID) return null
    const cameraQuestions = formData.questions.filter(
      (q) => !isSectionQuestion(q) && q.type === 'camera' && Boolean(q.includeInReview),
    )
    return cameraQuestions.length > 0 ? cameraQuestions[cameraQuestions.length - 1] : null
  }, [activeFormSlug, formData.questions])

  function onPlandayTimeCheck(confirmed) {
    setPlandayTimeConfirmed(confirmed)
    if (!lastReviewCameraQuestion) return
    setReviewDraftStatuses((prev) => ({
      ...prev,
      [lastReviewCameraQuestion.id]: confirmed ? 'approved' : 'flagged',
    }))
  }

  function onSetReviewStatus(answerKey, nextStatus) {
    setReviewDraftStatuses((previous) => ({
      ...previous,
      [answerKey]: nextStatus,
    }))

    if (nextStatus !== 'flagged' && nextStatus !== 'flagged_sad') {
      setReviewDraftComments((previous) => {
        if (typeof previous[answerKey] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[answerKey]
        return next
      })
      setReviewDraftRatings((previous) => {
        if (typeof previous[answerKey] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[answerKey]
        return next
      })
    }
  }

  function onReviewCommentChange(answerKey, value) {
    setReviewDraftComments((previous) => ({
      ...previous,
      [answerKey]: value,
    }))
  }

  function onReviewRatingChange(answerKey, value) {
    setReviewDraftRatings((previous) => ({
      ...previous,
      [answerKey]: value,
    }))
  }

  function onOpenReviewPreview() {
    if (!selectedSubmission) return

    const hasPendingDecisions = !reviewRejected && selectedSubmissionAnswerEntries.some(
      ([answerKey]) => !String(reviewDraftStatuses[answerKey] || '').trim(),
    )

    if (hasPendingDecisions) {
      alert('Select a rating for each question before marking the submission as reviewed.')
      return
    }

    if (reviewRejected && !reviewRejectionComment.trim()) {
      alert('A comment is required when rejecting the closing form.')
      return
    }

    const flaggedAnswers = selectedSubmissionAnswerEntries
      .filter(([answerKey]) => {
        const s = reviewDraftStatuses[answerKey]
        const q = getQuestionForAnswerKey(answerKey, formData.questions)
        return (q?.reviewType || 'rating') === 'rating' && (s === 'flagged' || s === 'flagged_sad')
      })
      .map(([answerKey]) => {
        const value = selectedSubmission.answers?.[answerKey]
        if (!String(value || '').trim()) return null
        return {
          answerKey,
          label: getAnswerDisplayLabel(answerKey, selectedSubmission.answers, formData.questions),
          value: isStorageImagePath(value) ? String(value) : String(value || ''),
          imageUrl: isStorageImagePath(value) ? String(selectedSubmissionImageUrls[value] || '') : '',
          comment: String(reviewDraftComments[answerKey] || '').trim(),
          reviewStatus: reviewDraftStatuses[answerKey],
        }
      })
      .filter(Boolean)

    const approvedAnswers = selectedSubmissionAnswerEntries
      .filter(([answerKey]) => {
        const q = getQuestionForAnswerKey(answerKey, formData.questions)
        return (q?.reviewType || 'rating') === 'rating' && reviewDraftStatuses[answerKey] === 'approved'
      })
      .map(([answerKey]) => {
        const value = selectedSubmission.answers?.[answerKey]
        if (!String(value || '').trim()) return null
        return {
          answerKey,
          label: getAnswerDisplayLabel(answerKey, selectedSubmission.answers, formData.questions),
          value: isStorageImagePath(value) ? String(value) : String(value || ''),
          imageUrl: isStorageImagePath(value) ? String(selectedSubmissionImageUrls[value] || '') : '',
        }
      })
      .filter(Boolean)

    const neutralCount = flaggedAnswers.filter((a) => !a.reviewStatus || a.reviewStatus === 'flagged').length
    const sadCount = flaggedAnswers.filter((a) => a.reviewStatus === 'flagged_sad').length

    setReviewEmailPreviewData({
      flaggedAnswers,
      approvedAnswers,
      reviewScoreSummary: { happy: approvedAnswers.length, neutral: neutralCount, sad: sadCount },
      reviewedBy: user?.email || null,
      submitterEmail:
        selectedSubmission.submitterEmail ||
        getSubmissionEmail(selectedSubmission.answers, formData.questions),
      generalFeedback: reviewGeneralFeedback.trim(),
      rejected: reviewRejected,
      rejectionComment: reviewRejectionComment.trim(),
    })
  }

  async function onSaveEmailForPhone() {
    if (!selectedSubmission || !reviewEmailOverride.trim()) return
    const phone = getSubmissionPhone(selectedSubmission.answers, formData.questions)
    if (!phone) return
    setReviewEmailSaving(true)
    try {
      await setDoc(doc(db, 'phoneEmails', phone), { email: reviewEmailOverride.trim(), updatedAt: serverTimestamp() })
      setReviewEmailSaved(true)
      setTimeout(() => setReviewEmailSaved(false), 3000)
    } catch {
      // silent
    } finally {
      setReviewEmailSaving(false)
    }
  }

  async function onSaveSubmissionReview() {
    if (!selectedSubmission) {
      return
    }

    const hasPendingDecisions = !reviewRejected && selectedSubmissionAnswerEntries.some(
      ([answerKey]) => !String(reviewDraftStatuses[answerKey] || '').trim(),
    )

    if (hasPendingDecisions) {
      return
    }

    setReviewSubmissionState({ saving: true, error: '' })

    const reviewAnswers = Object.fromEntries(
      selectedSubmissionAnswerEntries.map(([answerKey]) => [answerKey, reviewDraftStatuses[answerKey] || 'approved']),
    )

    const flaggedAnswers = selectedSubmissionAnswerEntries
      .filter(([answerKey]) => {
        const s = reviewDraftStatuses[answerKey]
        return s === 'flagged' || s === 'flagged_sad'
      })
      .map(([answerKey]) => {
        const value = selectedSubmission.answers?.[answerKey]
        if (!String(value || '').trim()) {
          return null
        }
        const reviewStatus = reviewDraftStatuses[answerKey]
        const q = getQuestionForAnswerKey(answerKey, formData.questions)
        const ratingValue = reviewDraftRatings[answerKey]
        return {
          answerKey,
          label: getAnswerDisplayLabel(answerKey, selectedSubmission.answers, formData.questions),
          value: isStorageImagePath(value) ? String(value) : String(value || ''),
          imageUrl: isStorageImagePath(value) ? String(selectedSubmissionImageUrls[value] || '') : '',
          comment: String(reviewDraftComments[answerKey] || '').trim(),
          reviewStatus,
          rating: q?.includeRating && ratingValue ? Number(ratingValue) : null,
        }
      })
      .filter(Boolean)

    const ratingEntries = selectedSubmissionAnswerEntries.filter(([answerKey]) => {
      const q = getQuestionForAnswerKey(answerKey, formData.questions)
      return (q?.reviewType || 'rating') === 'rating'
    })
    const happyCount = ratingEntries.filter(([answerKey]) => reviewDraftStatuses[answerKey] === 'approved').length
    const neutralCount = ratingEntries.filter(([answerKey]) => reviewDraftStatuses[answerKey] === 'flagged').length
    const sadCount = ratingEntries.filter(([answerKey]) => reviewDraftStatuses[answerKey] === 'flagged_sad').length
    const reviewScoreSummary = { happy: happyCount, neutral: neutralCount, sad: sadCount }

    try {
      await updateDoc(doc(db, 'formSubmissions', selectedSubmission.id), {
        flaggedAnswers,
        reviewAnswers,
        reviewScoreSummary,
        status: reviewRejected ? 'rejected' : 'reviewed',
        statusUpdatedBy: user?.email || 'admin',
        statusUpdatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
        ...(reviewGeneralFeedback.trim() ? { generalFeedback: reviewGeneralFeedback.trim() } : {}),
        ...(reviewRejected ? { rejected: true, rejectionComment: reviewRejectionComment.trim() } : { rejected: false }),
      })

      if (selectedSubmission.receiptToken) {
        updateDoc(doc(db, 'formSubmissionReceipts', selectedSubmission.receiptToken), {
          reviewScoreSummary,
          generalFeedback: reviewGeneralFeedback.trim() || null,
          status: reviewRejected ? 'rejected' : 'reviewed',
          rejected: reviewRejected || false,
          reviewedAt: serverTimestamp(),
          feedbackReadConfirmed: false,
        }).catch(() => {})
      }

      setSubmissions((previous) =>
        previous.map((submission) =>
          submission.id === selectedSubmission.id
            ? {
                ...submission,
                flaggedAnswers,
                reviewAnswers,
                reviewScoreSummary,
                status: 'reviewed',
                statusUpdatedBy: user?.email || 'admin',
                statusUpdatedAt: new Date(),
                reviewedAt: new Date(),
              }
            : submission,
        ),
      )

      const submitterEmail = reviewEmailOverride ||
        selectedSubmission.submitterEmail ||
        getSubmissionEmail(selectedSubmission.answers, formData.questions)

      // Persist phone→email mapping if reviewer entered one
      const phone = getSubmissionPhone(selectedSubmission.answers, formData.questions)
      if (phone && reviewEmailOverride) {
        setDoc(doc(db, 'phoneEmails', phone), { email: reviewEmailOverride, updatedAt: serverTimestamp() })
          .catch(() => {})
      }

      if (reviewSendEmail && submitterEmail) {
        const emailFlaggedAnswers = flaggedAnswers.filter(({ answerKey }) => {
          const q = getQuestionForAnswerKey(answerKey, formData.questions)
          return (q?.reviewType || 'rating') === 'rating'
        })
        const emailApprovedAnswers = selectedSubmissionAnswerEntries
          .filter(([answerKey]) => {
            const q = getQuestionForAnswerKey(answerKey, formData.questions)
            return (q?.reviewType || 'rating') === 'rating' && reviewDraftStatuses[answerKey] === 'approved'
          })
          .map(([answerKey]) => {
            const value = selectedSubmission.answers?.[answerKey]
            if (!String(value || '').trim()) return null
            return {
              answerKey,
              label: getAnswerDisplayLabel(answerKey, selectedSubmission.answers, formData.questions),
              value: isStorageImagePath(value) ? String(value) : String(value || ''),
              imageUrl: isStorageImagePath(value) ? String(selectedSubmissionImageUrls[value] || '') : '',
            }
          })
          .filter(Boolean)

        httpsCallable(functions, 'sendReviewEmail')({
          submitterEmail,
          formTitle: formData.title || activeFormSlug,
          flaggedAnswers: emailFlaggedAnswers,
          approvedAnswers: emailApprovedAnswers,
          reviewScoreSummary,
          submittedAtSeconds: selectedSubmission.submittedAt?.seconds || null,
          reviewUrl: selectedSubmission.receiptToken
            ? `https://crust.no/skjema/${activeFormSlug}/kvittering/${selectedSubmission.receiptToken}`
            : null,
          reviewedBy: user?.email || null,
          generalFeedback: reviewGeneralFeedback.trim() || null,
          rejected: reviewRejected,
          rejectionComment: reviewRejectionComment.trim() || null,
        }).catch((emailError) => {
          console.error('Review email failed to send', emailError)
        })
      }

      setReviewSubmissionState({ saving: false, error: '' })
      setReviewEmailPreviewData(null)
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setReviewSubmissionState({
        saving: false,
        error:
          error?.code === 'permission-denied'
            ? `Could not save the review${code}. Firestore rules do not allow this action.`
            : `Could not save the review${code}.`,
      })
    }
  }

  async function onSendInventoryAlert() {
    setInventoryAlertState({ sending: true, error: '', message: '' })
    try {
      await httpsCallable(functions, 'sendInventoryAlertEmail')({})
      setInventoryAlertState({ sending: false, error: '', message: 'E-post sendt!' })
      setTimeout(() => setInventoryAlertState((s) => ({ ...s, message: '' })), 3000)
    } catch (error) {
      setInventoryAlertState({ sending: false, error: `Feil: ${error.message}`, message: '' })
    }
  }

  async function onSendTestInventoryAlert() {
    const recipient = testEmailRecipient.trim() || 'magnus@crust.no'
    setInventoryTestState({ sending: true, error: '', message: '' })
    try {
      await httpsCallable(functions, 'sendInventoryAlertEmail')({ testRecipient: recipient })
      setInventoryTestState({ sending: false, error: '', message: `Test sendt til ${recipient}!` })
      setTimeout(() => setInventoryTestState((s) => ({ ...s, message: '' })), 4000)
    } catch (error) {
      setInventoryTestState({ sending: false, error: `Feil: ${error.message}`, message: '' })
    }
  }

  async function onSendAnalyseEmail(event) {
    event.preventDefault()
    const recipient = analyseEmailRecipient.trim()
    if (!recipient) return
    setAnalyseEmailState({ sending: true, error: '', message: '' })
    try {
      await httpsCallable(functions, 'sendInventoryAlertEmail')({ testRecipient: recipient })
      setAnalyseEmailState({ sending: false, error: '', message: `Sendt til ${recipient}!` })
      setAnalyseEmailRecipient('')
      setTimeout(() => setAnalyseEmailState((s) => ({ ...s, message: '' })), 4000)
    } catch (error) {
      setAnalyseEmailState({ sending: false, error: `Feil: ${error.message}`, message: '' })
    }
  }

  async function onSaveInventoryUpdate() {
    if (!inventoryModalLocation) return
    const nonEmpty = Object.fromEntries(
      Object.entries(inventoryModalAnswers).filter(([, v]) => String(v || '').trim()),
    )
    if (Object.keys(nonEmpty).length === 0) return
    setInventoryModalSaving(true)
    setInventoryModalError('')
    try {
      const existingAnswers = inventoryUpdates[inventoryModalLocation]?.answers || {}
      const mergedAnswers = { ...existingAnswers, ...nonEmpty }
      const existingLogs = inventoryUpdates[inventoryModalLocation]?.answerLogs || {}
      const now = new Date()
      const newLogs = { ...existingLogs }
      const updatedBy = user?.email || 'admin'
      for (const [qId, val] of Object.entries(nonEmpty)) {
        const prev = existingAnswers[qId]
        if (prev === val) continue
        newLogs[qId] = [
          { value: val, updatedAt: now.toISOString(), updatedBy },
          ...(existingLogs[qId] || []),
        ].slice(0, 20)
      }
      const docId = `${STENGESKJEMA_ID}:${inventoryModalLocation}`
      await setDoc(doc(db, 'inventoryUpdates', docId), {
        formSlug: STENGESKJEMA_ID,
        location: inventoryModalLocation,
        answers: mergedAnswers,
        answerLogs: newLogs,
        updatedAt: serverTimestamp(),
        updatedBy,
      })
      setInventoryUpdates((prev) => ({
        ...prev,
        [inventoryModalLocation]: {
          answers: mergedAnswers,
          answerLogs: newLogs,
          updatedAt: now,
          updatedBy,
        },
      }))
      setShowInventoryModal(false)
      setInventoryModalLocation('')
      setInventoryModalAnswers({})
    } catch (err) {
      setInventoryModalError(`Kunne ikke lagre: ${err.message}`)
    } finally {
      setInventoryModalSaving(false)
    }
  }

  async function onSendTestReviewEmail() {
    const reviewQuestions = formData.questions.filter(
      (q) => !isSectionQuestion(q) && Boolean(q.includeInReview),
    )

    const latestFlagged = [...submissions]
      .filter((s) => Array.isArray(s.flaggedAnswers) && s.flaggedAnswers.length > 0)
      .sort((a, b) => {
        const aT = a.reviewedAt?.seconds ?? (a.reviewedAt instanceof Date ? a.reviewedAt.getTime() / 1000 : 0)
        const bT = b.reviewedAt?.seconds ?? (b.reviewedAt instanceof Date ? b.reviewedAt.getTime() / 1000 : 0)
        return bT - aT
      })[0]

    if (!latestFlagged) {
      setTestEmailState({ sending: false, error: 'No reviewed submission with flagged answers found.', message: '' })
      return
    }

    setTestEmailState({ sending: true, error: '', message: '' })

    try {
      const flaggedKeys = new Set((latestFlagged.flaggedAnswers || []).map((a) => a.answerKey))

      const flaggedAnswers = await Promise.all(
        (latestFlagged.flaggedAnswers || [])
          .filter((item) => {
            const q = getQuestionForAnswerKey(item.answerKey, formData.questions)
            return (q?.reviewType || 'rating') === 'rating'
          })
          .map(async (item) => {
            if (item.imageUrl) return item
            if (isStorageImagePath(item.value)) {
              try {
                const imageUrl = await getDownloadURL(ref(storage, item.value))
                return { ...item, imageUrl }
              } catch {
                return item
              }
            }
            return item
          }),
      )

      const approvedEntries = getOrderedAnswerEntries(
        latestFlagged.answers || {},
        reviewQuestions,
        { includeRemainingAnswers: false },
      ).filter(([answerKey]) => {
        if (answerKey.endsWith(IMAGE_CAPTURED_AT_SUFFIX)) return false
        if (flaggedKeys.has(answerKey)) return false
        const q = getQuestionForAnswerKey(answerKey, formData.questions)
        return (q?.reviewType || 'rating') === 'rating'
      })

      const approvedAnswers = await Promise.all(
        approvedEntries.map(async ([answerKey, value]) => {
          if (!String(value || '').trim()) return null
          let imageUrl = ''
          if (isStorageImagePath(value)) {
            try {
              imageUrl = await getDownloadURL(ref(storage, value))
            } catch {
              imageUrl = ''
            }
          }
          return {
            answerKey,
            label: getAnswerDisplayLabel(answerKey, latestFlagged.answers, formData.questions),
            value: isStorageImagePath(value) ? String(value) : String(value || ''),
            imageUrl,
          }
        }),
      ).then((results) => results.filter(Boolean))

      const recipient = testEmailRecipient.trim() || 'magnus@crust.no'
      await httpsCallable(functions, 'sendReviewEmail')({
        submitterEmail: latestFlagged.submitterEmail || 'test@crust.no',
        formTitle: formData.title || activeFormSlug,
        flaggedAnswers,
        approvedAnswers,
        reviewScoreSummary: latestFlagged.reviewScoreSummary || { happy: 0, neutral: 0, sad: 0 },
        submittedAtSeconds: latestFlagged.submittedAt?.seconds || null,
        reviewUrl: latestFlagged.receiptToken
          ? `https://crust.no/skjema/${activeFormSlug}/kvittering/${latestFlagged.receiptToken}`
          : null,
        generalFeedback: latestFlagged.generalFeedback || null,
        testRecipient: recipient,
      })

      setTestEmailState({ sending: false, error: '', message: `Test email sent to ${recipient}` })
    } catch (error) {
      setTestEmailState({ sending: false, error: `Failed to send: ${error.message}`, message: '' })
    }
  }

  async function onSendTestRejectionEmail() {
    setTestEmailState({ sending: true, error: '', message: '' })
    try {
      const latestSubmission = [...submissions]
        .filter((s) => s.submittedAt)
        .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))[0]

      const recipient = testEmailRecipient.trim() || 'magnus@crust.no'
      await httpsCallable(functions, 'sendReviewEmail')({
        submitterEmail: latestSubmission?.submitterEmail || 'test@crust.no',
        formTitle: formData.title || activeFormSlug,
        flaggedAnswers: [],
        approvedAnswers: [],
        reviewScoreSummary: { happy: 0, neutral: 0, sad: 0 },
        submittedAtSeconds: latestSubmission?.submittedAt?.seconds || null,
        reviewUrl: null,
        reviewedBy: user?.email || null,
        rejected: true,
        rejectionComment: 'Dette er en test av avvisnings-e-post. Stengeskjemaet ble ikke godkjent.',
        testRecipient: recipient,
      })
      setTestEmailState({ sending: false, error: '', message: `Test rejection email sent to ${recipient}` })
    } catch (error) {
      setTestEmailState({ sending: false, error: `Failed to send: ${error.message}`, message: '' })
    }
  }

  function onOpenFlaggedReview(submission) {
    if (!submission?.id) {
      return
    }

    const nextOpenId = flaggedReviewOpenId === submission.id ? '' : submission.id
    setFlaggedReviewOpenId(nextOpenId)
    setFlaggedCategoryPopupOpenId('')
    setFlaggedActionDrafts((previous) => ({
      ...previous,
      [submission.id]:
        typeof previous[submission.id] === 'string'
          ? previous[submission.id]
          : String(submission.flaggedActionTaken || ''),
    }))
    setFlaggedActionState((previous) => ({
      ...previous,
      [submission.id]: {
        saving: false,
        error: '',
        message: previous[submission.id]?.message || '',
        categorySaving: false,
        categoryError: '',
      },
    }))
    setFlaggedWarningDrafts((previous) => ({
      ...previous,
      [submission.id]: Array.isArray(previous[submission.id]) ? previous[submission.id] : [],
    }))
    setNewWarningCategoryDrafts((previous) => ({
      ...previous,
      [submission.id]:
        typeof previous[submission.id] === 'string'
          ? previous[submission.id]
          : '',
    }))
  }

  function onAddWarningDraft(submissionId) {
    if (!submissionId) {
      return
    }

    setFlaggedWarningDrafts((previous) => ({
      ...previous,
      [submissionId]: [...(Array.isArray(previous[submissionId]) ? previous[submissionId] : []), createWarningDraft()],
    }))
  }

  function onRemoveWarningDraft(submissionId, draftId) {
    if (!submissionId || !draftId) {
      return
    }

    setFlaggedWarningDrafts((previous) => ({
      ...previous,
      [submissionId]: (Array.isArray(previous[submissionId]) ? previous[submissionId] : []).filter(
        (draft) => draft?.id !== draftId,
      ),
    }))
  }

  function onChangeWarningDraftCategory(submissionId, draftId, value) {
    if (!submissionId || !draftId) {
      return
    }

    setFlaggedWarningDrafts((previous) => ({
      ...previous,
      [submissionId]: (Array.isArray(previous[submissionId]) ? previous[submissionId] : []).map((draft) =>
        draft?.id === draftId
          ? {
              ...draft,
              category: String(value || '').trim(),
            }
          : draft,
      ),
    }))
  }

  function onChangeWarningDraftComment(submissionId, draftId, value) {
    if (!submissionId || !draftId) {
      return
    }

    setFlaggedWarningDrafts((previous) => ({
      ...previous,
      [submissionId]: (Array.isArray(previous[submissionId]) ? previous[submissionId] : []).map((draft) =>
        draft?.id === draftId
          ? {
              ...draft,
              comment: String(value || ''),
            }
          : draft,
      ),
    }))
  }

  function onToggleFlaggedCollapsed(submissionId) {
    if (!submissionId) {
      return
    }

    setFlaggedCollapsedIds((previous) => ({
      ...previous,
      [submissionId]: !previous[submissionId],
    }))
  }

  async function onCompleteFlaggedSubmission(submission) {
    if (!submission?.id) {
      return
    }

    const actionTaken = String(flaggedActionDrafts[submission.id] || '').trim()
    const pendingWarningDrafts = Array.isArray(flaggedWarningDrafts[submission.id])
      ? flaggedWarningDrafts[submission.id]
      : []
    const invalidWarningDraft = pendingWarningDrafts.find(
      (draft) => !String(draft?.category || '').trim(),
    )
    const existingWarnings = getSubmissionWarnings(submission)
    if (!actionTaken) {
      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error: 'Beskriv hva som ble gjort før flagget settes til complete.',
          message: '',
          categorySaving: previous[submission.id]?.categorySaving || false,
          categoryError: previous[submission.id]?.categoryError || '',
        },
      }))
      return
    }

    if (invalidWarningDraft) {
      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error: 'Velg kategori for alle nye advarsler før saken fullføres.',
          message: '',
          categorySaving: previous[submission.id]?.categorySaving || false,
          categoryError: previous[submission.id]?.categoryError || '',
        },
      }))
      return
    }

    const recordedAt = new Date()
    const recordedBy = user?.email || 'admin'
    const appendedWarnings = [
      ...existingWarnings,
      ...pendingWarningDrafts.map((draft) => ({
        category: String(draft?.category || '').trim(),
        comment: String(draft?.comment || '').trim(),
        recordedAt,
        recordedBy,
      })),
    ]
    const latestWarning = appendedWarnings[appendedWarnings.length - 1] || null
    const hasWarnings = appendedWarnings.length > 0

    setFlaggedActionState((previous) => ({
      ...previous,
      [submission.id]: {
        saving: true,
        error: '',
        message: '',
        categorySaving: false,
        categoryError: '',
      },
    }))

    try {
      await updateDoc(doc(db, 'formSubmissions', submission.id), {
        flaggedStatus: 'complete',
        flaggedActionTaken: actionTaken,
        flaggedCompletedAt: serverTimestamp(),
        flaggedCompletedBy: user?.email || 'admin',
        warnings: appendedWarnings,
        warningRegistered: hasWarnings,
        warningCategory: latestWarning ? latestWarning.category : '',
        warningRecordedAt: latestWarning ? latestWarning.recordedAt : null,
        warningRecordedBy: latestWarning ? latestWarning.recordedBy : '',
      })

      setSubmissions((previous) =>
        previous.map((item) =>
          item.id === submission.id
            ? {
                ...item,
                flaggedStatus: 'complete',
                flaggedActionTaken: actionTaken,
                flaggedCompletedAt: new Date(),
                flaggedCompletedBy: user?.email || 'admin',
                warnings: appendedWarnings,
                warningRegistered: hasWarnings,
                warningCategory: latestWarning ? latestWarning.category : '',
                warningRecordedAt: latestWarning ? latestWarning.recordedAt : null,
                warningRecordedBy: latestWarning ? latestWarning.recordedBy : '',
              }
            : item,
        ),
      )

      setFlaggedWarningDrafts((previous) => ({
        ...previous,
        [submission.id]: [],
      }))

      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error: '',
          message: 'Flagget er satt til complete.',
          categorySaving: false,
          categoryError: '',
        },
      }))
      setFlaggedReviewOpenId('')
      setFlaggedCategoryPopupOpenId('')
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error:
            error?.code === 'permission-denied'
              ? `Kunne ikke oppdatere flagget${code}. Mangler tilgang i Firestore-regler.`
              : `Kunne ikke oppdatere flagget${code}.`,
          message: '',
          categorySaving: false,
          categoryError: '',
        },
      }))
    }
  }

  async function onAddWarningCategory(submission) {
    const nextCategory = String(newWarningCategoryDrafts[submission?.id] || '').trim()
    await onSaveWarningCategory(nextCategory, {
      onSaving: () =>
        setFlaggedActionState((previous) => ({
          ...previous,
          [submission.id]: {
            ...(previous[submission.id] || {}),
            saving: false,
            error: '',
            categorySaving: true,
            categoryError: '',
          },
        })),
      onSaved: (mergedCategories, selectedCategory) => {
        setFlaggedWarningDrafts((previous) => {
          const existingDrafts = Array.isArray(previous[submission.id]) ? previous[submission.id] : []
          if (existingDrafts.length === 0) {
            return {
              ...previous,
              [submission.id]: [createWarningDraft(selectedCategory)],
            }
          }

          const nextDrafts = existingDrafts.map((draft, index) =>
            index === existingDrafts.length - 1 && !String(draft?.category || '').trim()
              ? { ...draft, category: selectedCategory }
              : draft,
          )

          return {
            ...previous,
            [submission.id]: nextDrafts,
          }
        })
        setNewWarningCategoryDrafts((previous) => ({
          ...previous,
          [submission.id]: '',
        }))
        setFlaggedCategoryPopupOpenId('')
        setFlaggedActionState((previous) => ({
          ...previous,
          [submission.id]: {
            ...(previous[submission.id] || {}),
            saving: false,
            error: '',
            categorySaving: false,
            categoryError: '',
          },
        }))
      },
      onValidationError: (message) =>
        setFlaggedActionState((previous) => ({
          ...previous,
          [submission.id]: {
            ...(previous[submission.id] || {}),
            saving: false,
            categorySaving: false,
            categoryError: message,
          },
        })),
      onSaveError: (message) =>
        setFlaggedActionState((previous) => ({
          ...previous,
          [submission.id]: {
            ...(previous[submission.id] || {}),
            saving: false,
            categorySaving: false,
            categoryError: message,
          },
        })),
    })
  }

  async function onSaveWarningCategory(nextCategoryInput, callbacks = {}) {
    const nextCategory = String(nextCategoryInput || '').trim()
    if (!nextCategory) {
      callbacks.onValidationError?.('Skriv inn et kategorinavn før du legger det til.')
      return
    }

    const mergedCategories = normalizeWarningCategories([...availableWarningCategories, nextCategory])
    const selectedCategory =
      mergedCategories.find((category) => category.toLowerCase() === nextCategory.toLowerCase()) ||
      nextCategory

    callbacks.onSaving?.()

    try {
      await setDoc(
        doc(db, 'forms', formDocId || activeFormSlug),
        {
          slug: activeFormSlug,
          warningCategories: mergedCategories,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setFormData((previous) => ({
        ...previous,
        warningCategories: mergedCategories,
      }))
      callbacks.onSaved?.(mergedCategories, selectedCategory)
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      callbacks.onSaveError?.(
        error?.code === 'permission-denied'
          ? `Kunne ikke lagre kategorien${code}. Mangler tilgang i Firestore-regler.`
          : `Kunne ikke lagre kategorien${code}.`,
      )
    }
  }

  async function onAddRemarkCategory() {
    await onSaveWarningCategory(newRemarkCategoryDraft, {
      onSaving: () => {
        setRemarkCategoryPendingName(String(newRemarkCategoryDraft || '').trim())
        setRemarkCategoryPendingAction('create')
        setRemarkState((previous) => ({
          ...previous,
          saving: false,
          error: '',
          message: '',
          categorySaving: true,
          categoryError: '',
        }))
      },
      onSaved: (_mergedCategories, selectedCategory) => {
        setNewRemarkCategoryDraft('')
        setRemarkDraftCategory(selectedCategory)
        setRemarkCategoryPopupOpen(false)
        setRemarkCategoryPendingName('')
        setRemarkCategoryPendingAction('')
        setRemarkState((previous) => ({
          ...previous,
          saving: false,
          error: '',
          message: 'Kategori lagret.',
          categorySaving: false,
          categoryError: '',
        }))
      },
      onValidationError: (message) => {
        setRemarkCategoryPendingName('')
        setRemarkCategoryPendingAction('')
        setRemarkState((previous) => ({
          ...previous,
          saving: false,
          message: '',
          categorySaving: false,
          categoryError: message,
        }))
      },
      onSaveError: (message) => {
        setRemarkCategoryPendingName('')
        setRemarkCategoryPendingAction('')
        setRemarkState((previous) => ({
          ...previous,
          saving: false,
          message: '',
          categorySaving: false,
          categoryError: message,
        }))
      },
    })
  }

  function openRemarkCategoryModal(category) {
    const nextCategory = String(category || '').trim()
    if (!nextCategory) {
      return
    }

    setRemarkCategoryManagerOpen(true)
    setRemarkCategoryModalCategory(nextCategory)
    setRemarkCategoryRenameDraft(nextCategory)
    setRemarkState((previous) => ({
      ...previous,
      categoryError: '',
    }))
  }

  function openRemarkCategoryManager() {
    setRemarkCategoryManagerOpen(true)
    setRemarkCategoryModalCategory('')
    setRemarkCategoryRenameDraft('')
    setRemarkState((previous) => ({
      ...previous,
      categoryError: '',
    }))
  }

  function closeRemarkCategoryModal() {
    if (remarkState.categorySaving) {
      return
    }

    setRemarkCategoryManagerOpen(false)
    setRemarkCategoryModalCategory('')
    setRemarkCategoryRenameDraft('')
    setRemarkCategoryPendingName('')
    setRemarkCategoryPendingAction('')
    setRemarkState((previous) => ({
      ...previous,
      categoryError: '',
    }))
  }

  async function onRenameWarningCategory() {
    const previousCategory = String(remarkCategoryModalCategory || '').trim()
    const nextCategory = String(remarkCategoryRenameDraft || '').trim()

    if (!previousCategory) {
      return
    }

    if (!nextCategory) {
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: '',
        categorySaving: false,
        categoryError: 'Skriv inn et kategorinavn før du lagrer.',
      }))
      return
    }

    const duplicateCategory = availableWarningCategories.find(
      (value) =>
        value.toLowerCase() === nextCategory.toLowerCase() &&
        value.toLowerCase() !== previousCategory.toLowerCase(),
    )
    if (duplicateCategory) {
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: '',
        categorySaving: false,
        categoryError: `Kategorien "${duplicateCategory}" finnes allerede.`,
      }))
      return
    }

    const previousCategoryKey = previousCategory.toLowerCase()
    const nextCategories = normalizeWarningCategories([
      ...configuredWarningCategories.filter((value) => value.toLowerCase() !== previousCategoryKey),
      nextCategory,
    ])
    const remarksToUpdate = manualRemarks.filter(
      (remark) => String(remark.category || '').trim().toLowerCase() === previousCategoryKey,
    )
    const submissionsToUpdate = submissions.filter((submission) =>
      getSubmissionWarnings(submission).some(
        (warning) => String(warning.category || '').trim().toLowerCase() === previousCategoryKey,
      ),
    )

    setRemarkCategoryPendingName(previousCategory)
    setRemarkCategoryPendingAction('rename')
    setRemarkState((previous) => ({
      ...previous,
      saving: false,
      error: '',
      message: '',
      categorySaving: true,
      categoryError: '',
    }))

    try {
      await Promise.all([
        setDoc(
          doc(db, 'forms', formDocId || activeFormSlug),
          {
            slug: activeFormSlug,
            warningCategories: nextCategories,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ),
        ...remarksToUpdate.map((remark) =>
          updateDoc(doc(db, 'formRemarks', remark.id), {
            category: nextCategory,
          }),
        ),
        ...submissionsToUpdate.map((submission) => {
          const nextWarnings = getSubmissionWarnings(submission).map((warning) => ({
            ...warning,
            category:
              String(warning.category || '').trim().toLowerCase() === previousCategoryKey
                ? nextCategory
                : warning.category,
          }))
          const latestWarning = nextWarnings[nextWarnings.length - 1] || null

          return updateDoc(doc(db, 'formSubmissions', submission.id), {
            warnings: nextWarnings,
            warningRegistered: nextWarnings.length > 0,
            warningCategory: latestWarning ? latestWarning.category : '',
            warningRecordedAt: latestWarning ? latestWarning.recordedAt : null,
            warningRecordedBy: latestWarning ? latestWarning.recordedBy : '',
          })
        }),
      ])

      setFormData((previous) => ({
        ...previous,
        warningCategories: nextCategories,
      }))
      setManualRemarks((previous) =>
        previous.map((remark) =>
          String(remark.category || '').trim().toLowerCase() === previousCategoryKey
            ? { ...remark, category: nextCategory }
            : remark,
        ),
      )
      setSubmissions((previous) =>
        previous.map((submission) => {
          const nextWarnings = getSubmissionWarnings(submission).map((warning) => ({
            ...warning,
            category:
              String(warning.category || '').trim().toLowerCase() === previousCategoryKey
                ? nextCategory
                : warning.category,
          }))

          if (
            nextWarnings.length === 0 ||
            !nextWarnings.some(
              (warning) => String(warning.category || '').trim().toLowerCase() === nextCategory.toLowerCase(),
            )
          ) {
            return submission
          }

          const latestWarning = nextWarnings[nextWarnings.length - 1] || null
          return {
            ...submission,
            warnings: nextWarnings,
            warningRegistered: nextWarnings.length > 0,
            warningCategory: latestWarning ? latestWarning.category : '',
            warningRecordedAt: latestWarning ? latestWarning.recordedAt : null,
            warningRecordedBy: latestWarning ? latestWarning.recordedBy : '',
          }
        }),
      )
      setFlaggedWarningDrafts((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([submissionId, drafts]) => [
            submissionId,
            (Array.isArray(drafts) ? drafts : []).map((draft) =>
              String(draft?.category || '').trim().toLowerCase() === previousCategoryKey
                ? { ...draft, category: nextCategory }
                : draft,
            ),
          ]),
        ),
      )
      setRemarkDraftCategory((previous) =>
        String(previous || '').trim().toLowerCase() === previousCategoryKey ? nextCategory : previous,
      )
      setRemarkCategoryModalCategory('')
      setRemarkCategoryRenameDraft('')
      setRemarkCategoryPendingName('')
      setRemarkCategoryPendingAction('')
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: 'Kategori oppdatert.',
        categorySaving: false,
        categoryError: '',
      }))
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setRemarkCategoryPendingName('')
      setRemarkCategoryPendingAction('')
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: '',
        categorySaving: false,
        categoryError:
          error?.code === 'permission-denied'
            ? `Kunne ikke oppdatere kategorien${code}. Mangler tilgang i Firestore-regler.`
            : `Kunne ikke oppdatere kategorien${code}.`,
      }))
    }
  }

  async function onDeleteWarningCategory(categoryToDelete) {
    const category = String(categoryToDelete || '').trim()
    if (!category) {
      return
    }

    const usageCount = warningCategoryUsageCounts[category.toLowerCase()] || 0
    if (usageCount > 0) {
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: '',
        categorySaving: false,
        categoryError: `Kan ikke slette kategorien "${category}" fordi den brukes i ${usageCount} ${usageCount === 1 ? 'remark eller advarsel' : 'remarks eller advarsler'}. Endre eller slett disse først.`,
      }))
      return
    }

    const existingCategory = configuredWarningCategories.find(
      (value) => value.toLowerCase() === category.toLowerCase(),
    )
    if (!existingCategory) {
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: '',
        categorySaving: false,
        categoryError: `Fant ikke kategorien "${category}".`,
      }))
      return
    }

    const nextCategories = configuredWarningCategories.filter(
      (value) => value.toLowerCase() !== existingCategory.toLowerCase(),
    )

    setRemarkCategoryPendingName(existingCategory)
    setRemarkCategoryPendingAction('delete')
    setRemarkState((previous) => ({
      ...previous,
      saving: false,
      error: '',
      message: '',
      categorySaving: true,
      categoryError: '',
    }))

    try {
      await setDoc(
        doc(db, 'forms', formDocId || activeFormSlug),
        {
          slug: activeFormSlug,
          warningCategories: nextCategories,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setFormData((previous) => ({
        ...previous,
        warningCategories: nextCategories,
      }))
      setRemarkDraftCategory((previous) =>
        String(previous || '').toLowerCase() === existingCategory.toLowerCase() ? '' : previous,
      )
      setRemarkCategoryModalCategory('')
      setRemarkCategoryRenameDraft('')
      setRemarkCategoryPendingName('')
      setRemarkCategoryPendingAction('')
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: 'Kategori slettet.',
        categorySaving: false,
        categoryError: '',
      }))
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setRemarkCategoryPendingName('')
      setRemarkCategoryPendingAction('')
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: '',
        categorySaving: false,
        categoryError:
          error?.code === 'permission-denied'
            ? `Kunne ikke slette kategorien${code}. Mangler tilgang i Firestore-regler.`
            : `Kunne ikke slette kategorien${code}.`,
      }))
    }
  }

  function onToggleRemarkPhone(phone) {
    if (!phone) {
      return
    }

    setExpandedRemarkPhones((previous) => ({
      ...previous,
      [phone]: !previous[phone],
    }))
  }

  async function onRemarkImageFileChange(fileList) {
    const nextFiles = Array.from(fileList || []).filter((file) => file instanceof File)

    if (nextFiles.length === 0) {
      return
    }

    const preparedImages = await Promise.all(
      nextFiles.map(async (file, index) => {
        const nextFile = await compressUploadedImage(file)
        let previewUrl = ''

        try {
          previewUrl = await readFileAsDataUrl(nextFile)
        } catch {}

        return {
          id: `${Date.now()}-${index}-${sanitizeFileName(nextFile.name)}`,
          file: nextFile,
          previewUrl,
        }
      }),
    )

    setRemarkDraftImages((previous) => [...previous, ...preparedImages])
  }

  function onRemoveRemarkDraftImage(imageId) {
    setRemarkDraftImages((previous) => previous.filter((image) => image.id !== imageId))
  }

  async function onDeleteManualRemark(remark) {
    const remarkId = String(remark?.id || '').trim()
    if (!remarkId) {
      return
    }

    const confirmed = window.confirm('Delete this remark permanently?')
    if (!confirmed) {
      return
    }

    setRemarkDeleteState((previous) => ({
      ...previous,
      [remarkId]: { deleting: true, error: '' },
    }))

    try {
      await deleteDoc(doc(db, 'formRemarks', remarkId))

      const imagePaths = (Array.isArray(remark?.images) ? remark.images : []).filter((value) =>
        isStorageImagePath(value),
      )
      const cleanupResults = await Promise.allSettled(
        imagePaths.map((path) => deleteObject(ref(storage, path))),
      )
      const cleanupFailed = cleanupResults.some(
        (result) =>
          result.status === 'rejected' && result.reason?.code !== 'storage/object-not-found',
      )

      setManualRemarks((previous) => previous.filter((entry) => entry.id !== remarkId))
      setRemarkImageUrls((previous) => {
        if (imagePaths.length === 0) {
          return previous
        }

        const next = { ...previous }
        imagePaths.forEach((path) => {
          delete next[path]
        })
        return next
      })
      setRemarkDeleteState((previous) => ({
        ...previous,
        [remarkId]: { deleting: false, error: '' },
      }))
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: '',
        message: cleanupFailed
          ? 'Remark deleted, but one or more images could not be removed from Storage.'
          : 'Remark deleted.',
        categorySaving: false,
        categoryError: '',
      }))
    } catch (error) {
      setRemarkDeleteState((previous) => ({
        ...previous,
        [remarkId]: { deleting: false, error: getRemarkDeleteErrorMessage(error) },
      }))
    }
  }

  async function onSaveManualRemark(event) {
    event.preventDefault()

    const normalizedPhone = normalizeNorwegianPhoneNumber(remarkDraftPhone)
    const category = String(remarkDraftCategory || '').trim()
    const name = String(remarkDraftName || '').trim()
    const comment = String(remarkDraftComment || '').trim()

    if (!isValidNorwegianPhoneNumber(normalizedPhone)) {
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: 'Please enter a valid phone number with 8 digits.',
        message: '',
      }))
      return
    }

    if (!category) {
      setRemarkState((previous) => ({
        ...previous,
        saving: false,
        error: 'Select a category before saving the remark.',
        message: '',
      }))
      return
    }

    setRemarkState({
      saving: true,
      error: '',
      message: '',
      categorySaving: false,
      categoryError: '',
    })

    const remarkRef = doc(collection(db, 'formRemarks'))
    const recordedAt = new Date()
    const uploadStartedAt = Date.now()
    const nextRemark = {
      formSlug: activeFormSlug,
      phone: normalizedPhone,
      name,
      category,
      comment,
      images: [],
      recordedAt,
      recordedBy: user?.email || 'admin',
    }

    try {
      const uploadedRemarkImages = await Promise.all(
        remarkDraftImages.map(async ({ file }, index) => {
          const fileName = sanitizeFileName(file.name)
          const path = `forms/remarks/${activeFormSlug}/${remarkRef.id}-${uploadStartedAt}-${index}-${fileName}`
          await uploadBytes(ref(storage, path), file, {
            contentType: file.type || 'image/jpeg',
          })
          const downloadUrl = await getDownloadURL(ref(storage, path))

          return {
            path,
            downloadUrl,
          }
        }),
      )
      nextRemark.images = uploadedRemarkImages.map((image) => image.path)

      await setDoc(remarkRef, {
        ...nextRemark,
        recordedAt: serverTimestamp(),
      })

      setRemarkImageUrls((previous) => ({
        ...previous,
        ...Object.fromEntries(uploadedRemarkImages.map((image) => [image.path, image.downloadUrl])),
      }))
      setManualRemarks((previous) =>
        [{ id: remarkRef.id, ...nextRemark }, ...previous].sort(
          (a, b) => getTimestampSeconds(b.recordedAt) - getTimestampSeconds(a.recordedAt),
        ),
      )
      setExpandedRemarkPhones((previous) => ({
        ...previous,
        [normalizedPhone]: true,
      }))
      setRemarkDraftPhone(normalizedPhone)
      setRemarkDraftCategory('')
      setRemarkDraftComment('')
      setRemarkDraftImages([])
      setRemarkState({
        saving: false,
        error: '',
        message: 'Remark saved.',
        categorySaving: false,
        categoryError: '',
      })
    } catch (error) {
      setRemarkState({
        saving: false,
        error: getRemarkSaveErrorMessage(error),
        message: '',
        categorySaving: false,
        categoryError: '',
      })
    }
  }

  async function onSetAnalysisActionEntries(entries, nextType, labels) {
    const normalizedEntries = Array.from(
      new Map(
        (Array.isArray(entries) ? entries : [])
          .filter((entry) => entry?.submissionId && entry?.questionId)
          .map((entry) => [`${entry.submissionId}:${entry.questionId}`, entry]),
      ).values(),
    )

    if (normalizedEntries.length === 0) {
      return
    }

    setAnalysisActionState((previous) => ({
      ...previous,
      ...Object.fromEntries(
        normalizedEntries.map((entry) => [`${entry.submissionId}:${entry.questionId}`, { saving: true, error: '' }]),
      ),
    }))

    try {
      await Promise.all(
        normalizedEntries.map(async (entry) => {
          const submission = submissions.find((item) => item.id === entry.submissionId)
          if (!submission) {
            return
          }

          const nextAnalysisActions = {
            ...(submission.analysisActions && typeof submission.analysisActions === 'object'
              ? submission.analysisActions
              : {}),
          }

          if (nextType) {
            nextAnalysisActions[entry.questionId] = {
              type: nextType,
              markedAt: serverTimestamp(),
              markedBy: user?.email || 'admin',
            }
          } else {
            delete nextAnalysisActions[entry.questionId]
          }

          await updateDoc(doc(db, 'formSubmissions', entry.submissionId), {
            analysisActions: nextAnalysisActions,
          })
        }),
      )

      setSubmissions((previous) =>
        previous.map((item) => {
          const matchingEntries = normalizedEntries.filter((entry) => entry.submissionId === item.id)
          if (matchingEntries.length === 0) {
            return item
          }

          const nextAnalysisActions = {
            ...(item.analysisActions && typeof item.analysisActions === 'object'
              ? item.analysisActions
              : {}),
          }

          matchingEntries.forEach((entry) => {
            if (nextType) {
              nextAnalysisActions[entry.questionId] = {
                type: nextType,
                markedAt: new Date(),
                markedBy: user?.email || 'admin',
              }
            } else {
              delete nextAnalysisActions[entry.questionId]
            }
          })

          return {
            ...item,
            analysisActions: nextAnalysisActions,
          }
        }),
      )

      setAnalysisActionState((previous) => ({
        ...previous,
        ...Object.fromEntries(
          normalizedEntries.map((entry) => [`${entry.submissionId}:${entry.questionId}`, { saving: false, error: '' }]),
        ),
      }))
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      const errorMessage =
        error?.code === 'permission-denied'
          ? `${labels.permission}${code}.`
          : `${labels.generic}${code}.`

      setAnalysisActionState((previous) => ({
        ...previous,
        ...Object.fromEntries(
          normalizedEntries.map((entry) => [
            `${entry.submissionId}:${entry.questionId}`,
            { saving: false, error: errorMessage },
          ]),
        ),
      }))
    }
  }

  async function onMarkAnalysisRefill(submission, question) {
    return onSetAnalysisActionEntries(
      [{ submissionId: submission?.id, questionId: question?.id }],
      'refill',
      {
        permission: 'Kunne ikke lagre påfylling. Mangler tilgang i Firestore-regler',
        generic: 'Kunne ikke lagre påfylling',
      },
    )
  }

  async function onResetAnalysisRefill(submission, question) {
    return onSetAnalysisActionEntries(
      [{ submissionId: submission?.id, questionId: question?.id }],
      '',
      {
        permission: 'Kunne ikke nullstille påfylling. Mangler tilgang i Firestore-regler',
        generic: 'Kunne ikke nullstille påfylling',
      },
    )
  }

  async function onSaveHistoryDefault() {
    const nextDefault = Math.max(1, Number.parseInt(historySubmissionLimit, 10) || 3)

    setHistoryDefaultState({
      saving: true,
      error: '',
      message: '',
    })

    try {
      await setDoc(
        doc(db, 'forms', formDocId || activeFormSlug),
        {
          slug: activeFormSlug,
          analysisDefaultSubmissionLimit: nextDefault,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setFormData((previous) => ({
        ...previous,
        analysisDefaultSubmissionLimit: nextDefault,
      }))
      setHistorySubmissionLimit(String(nextDefault))
      setHistoryDefaultState({
        saving: false,
        error: '',
        message: 'Default lagret.',
      })
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setHistoryDefaultState({
        saving: false,
        error:
          error?.code === 'permission-denied'
            ? `Kunne ikke lagre default${code}. Mangler tilgang i Firestore-regler.`
            : `Kunne ikke lagre default${code}.`,
        message: '',
      })
    }
  }

  async function onSaveAnalysisRowOrder(order) {
    setAnalysisRowOrderSaving(true)
    try {
      await setDoc(
        doc(db, 'forms', formDocId || activeFormSlug),
        { slug: activeFormSlug, analysisQuestionOrder: order, updatedAt: serverTimestamp() },
        { merge: true },
      )
      setFormData((prev) => ({ ...prev, analysisQuestionOrder: order }))
    } catch {
      // silent — order stays in local state even if save fails
    } finally {
      setAnalysisRowOrderSaving(false)
    }
  }

  function renderQuestionInput(question) {
    const value = answers[question.id] || ''

    if (question.type === 'textarea') {
      return (
        <textarea
          id={question.id}
          value={value}
          placeholder={getLocalizedInputPlaceholder(question)}
          rows={4}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'select') {
      const detailValue = selectDetailAnswers[question.id] || ''
      const selectedBehavior = getSelectOptionBehavior(question, value)
      const detailPrompt = selectedBehavior.text.trim()
        ? translateText(selectedBehavior.text)
        : publicCopy.describeMore
      const detailFile = selectDetailFiles[question.id] || null
      const detailPreview = selectDetailPreviews[question.id] || ''
      const detailUpload = selectDetailUploadState[question.id] || { uploading: false, error: '' }
      const detailFileInputId = `${question.id}-detail-camera-input`

      return (
        <>
          <select
            id={question.id}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value
              onAnswerChange(question.id, nextValue)
              if (nextValue !== value) {
                setSelectDetailAnswers((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
                setSelectDetailFiles((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
                setSelectDetailPreviews((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
                setSelectDetailCapturedAt((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
                setSelectDetailUploadState((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
              }
            }}
          >
            <option value="">{publicCopy.select}</option>
            {(question.options || []).map((option) => (
              <option key={option} value={option}>
                {translateText(option)}
              </option>
            ))}
          </select>
          {selectedBehavior.kind === 'message' && selectedBehavior.text.trim() ? (
            <p
              className="field-help select-detail-message"
              style={getSelectMessageStyle(selectedBehavior)}
            >
              {translateText(selectedBehavior.text)}
            </p>
          ) : null}
          {selectedBehavior.kind === 'input' && value ? (
            <>
              <small className="question-help">{detailPrompt}</small>
              <input
                id={getSelectDetailAnswerKey(question.id)}
                type="text"
                value={detailValue}
                placeholder={publicCopy.writeHere}
                onChange={(event) =>
                  setSelectDetailAnswers((previous) => ({
                    ...previous,
                    [question.id]: event.target.value,
                  }))
                }
              />
            </>
          ) : null}
          {selectedBehavior.kind === 'camera' && value ? (
            <div className="camera-upload-control">
              {selectedBehavior.text.trim() ? (
                <small className="question-help">{selectedBehavior.text}</small>
              ) : null}
              <button
                type="button"
                id={`${question.id}-detail-camera-button`}
                className="ghost camera-upload-button"
                onClick={() => document.getElementById(detailFileInputId)?.click()}
              >
                {detailFile || detailPreview ? publicCopy.uploadNewPhoto : publicCopy.takePhoto}
              </button>
              <input
                id={detailFileInputId}
                type="file"
                accept="image/*"
                capture="environment"
                className="camera-upload-input"
                onChange={async (event) => {
                  const file = event.target.files?.[0] || null
                  await onSelectDetailCameraFileChange(question.id, file)
                  event.target.value = ''
                }}
              />
              {detailPreview ? (
                <div className="camera-upload-preview">
                  <img
                    src={detailPreview}
                    alt={`${translateText(question.label)} ${displayLanguage === 'en' ? 'image' : 'bilde'}`}
                  />
                </div>
              ) : null}
              {detailFile ? <small>Valgt: {detailFile.name}</small> : null}
              {detailUpload.uploading ? <small className="question-help">{publicCopy.uploadingPhoto}</small> : null}
              {detailUpload.error ? <small className="question-help forms-error">{detailUpload.error}</small> : null}
            </div>
          ) : null}
        </>
      )
    }

    if (question.type === 'location') {
      const otherValue = locationOtherAnswers[question.id] || ''
      const hasAvailableLocations = availableLocations.length > 0

      return (
        <>
          <select
            id={question.id}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value
              onAnswerChange(question.id, nextValue)
              if (nextValue !== LOCATION_OTHER_VALUE) {
                setLocationOtherAnswers((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
              }
            }}
          >
            <option value="">
              {loadingLocations ? publicCopy.loadingLocations : publicCopy.chooseLocation}
            </option>
            {availableLocations.map((location) => {
              const locationName = String(location.name || '').trim()
              if (!locationName) {
                return null
              }
              return (
                <option key={location.id} value={locationName}>
                  {locationName}
                </option>
              )
            })}
            <option value={LOCATION_OTHER_VALUE}>{publicCopy.other}</option>
          </select>
          {!loadingLocations && availableLocationsError ? (
            <small className="question-help forms-error">{availableLocationsError}</small>
          ) : null}
          {!loadingLocations && !availableLocationsError && !hasAvailableLocations ? (
            <small className="question-help">{publicCopy.noLocationsHelp}</small>
          ) : null}
          {value === LOCATION_OTHER_VALUE ? (
            <input
              id={`${question.id}-other`}
              type="text"
              value={otherValue}
              placeholder={getLocalizedInputPlaceholder(question, publicCopy.enterLocation)}
              onChange={(event) =>
                setLocationOtherAnswers((previous) => ({
                  ...previous,
                  [question.id]: event.target.value,
                }))
              }
            />
          ) : null}
        </>
      )
    }

    if (question.type === 'camera') {
      const fileInputId = `${question.id}-camera-input`
      const cameraPreview = cameraPreviews[question.id] || ''
      const cameraUpload = cameraUploadState[question.id] || { uploading: false, error: '' }

      return (
        <div className="camera-upload-control">
          <button
            type="button"
            id={`${question.id}-camera-button`}
            className="ghost camera-upload-button"
            onClick={() => document.getElementById(fileInputId)?.click()}
          >
            {cameraFiles[question.id] || cameraPreview ? publicCopy.uploadNewPhoto : publicCopy.takePhoto}
          </button>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="camera-upload-input"
            onChange={async (event) => {
              const file = event.target.files?.[0] || null
              await onCameraFileChange(question.id, file)
              event.target.value = ''
            }}
          />
          {cameraPreview ? (
            <div className="camera-upload-preview">
              <img
                src={cameraPreview}
                alt={`${translateText(question.label)} ${displayLanguage === 'en' ? 'image' : 'bilde'}`}
              />
            </div>
          ) : null}
          {cameraFiles[question.id] ? (
            <small>Valgt: {cameraFiles[question.id].name}</small>
          ) : null}
          {cameraUpload.uploading ? <small className="question-help">{publicCopy.uploadingPhoto}</small> : null}
          {cameraUpload.error ? <small className="question-help forms-error">{cameraUpload.error}</small> : null}
        </div>
      )
    }

    if (question.type === 'multi-camera') {
      const fileInputId = `${question.id}-multi-camera-input`
      const previews = multiCameraPreviews[question.id] || []
      const files = multiCameraFiles[question.id] || []
      const uploadState = multiCameraUploadState[question.id] || { uploading: false, error: '' }

      return (
        <div className="camera-upload-control">
          <button
            type="button"
            id={`${question.id}-multi-camera-button`}
            className="ghost camera-upload-button"
            onClick={() => document.getElementById(fileInputId)?.click()}
          >
            {previews.length > 0 || files.length > 0 ? publicCopy.uploadAdditionalPhoto : publicCopy.takePhoto}
          </button>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="camera-upload-input"
            onChange={async (event) => {
              const file = event.target.files?.[0] || null
              if (file) {
                await onMultiCameraFileAdd(question.id, file)
              }
              event.target.value = ''
            }}
          />
          {previews.length > 0 ? (
            <div className="multi-camera-preview-list">
              {previews.map((previewUrl, previewIndex) => (
                <div key={`${question.id}-preview-${previewIndex}`} className="multi-camera-preview-item">
                  <div className="camera-upload-preview">
                    <img
                      src={previewUrl}
                      alt={`${translateText(question.label)} ${displayLanguage === 'en' ? 'image' : 'bilde'} ${previewIndex + 1}`}
                    />
                  </div>
                  <button
                    type="button"
                    className="ghost multi-camera-remove-button"
                    onClick={() => onMultiCameraFileRemove(question.id, previewIndex)}
                  >
                    {displayLanguage === 'en' ? 'Remove' : 'Fjern'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {uploadState.uploading ? <small className="question-help">{publicCopy.uploadingPhoto}</small> : null}
          {uploadState.error ? <small className="question-help forms-error">{uploadState.error}</small> : null}
        </div>
      )
    }

    if (question.type === 'name') {
      return (
        <input
          id={question.id}
          type="text"
          value={value}
          placeholder={getLocalizedInputPlaceholder(question, publicCopy.fullName)}
          autoComplete="name"
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'phone') {
      return (
        <>
          <input
            id={question.id}
            type="tel"
            value={normalizeNorwegianPhoneNumber(value)}
            placeholder={getLocalizedInputPlaceholder(question, publicCopy.phoneNumberPlaceholder)}
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={8}
            onChange={(event) => onAnswerChange(question.id, event.target.value)}
          />
          <small className="question-help">{publicCopy.phoneNumberHelp}</small>
        </>
      )
    }

    if (question.type === 'email') {
      return (
        <input
          id={question.id}
          type="email"
          value={value}
          placeholder={getLocalizedInputPlaceholder(question, publicCopy.emailAddress)}
          autoComplete="email"
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'time-start' || question.type === 'time-end') {
      return (
        <input
          id={question.id}
          type="time"
          value={value}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    return (
      <input
        id={question.id}
        type={question.type || 'text'}
        value={value}
        placeholder={getLocalizedInputPlaceholder(question)}
        onChange={(event) => onAnswerChange(question.id, event.target.value)}
      />
    )
  }

  function isQuestionAnswered(question) {
    if (isSectionQuestion(question)) {
      return false
    }

    if (question.type === 'camera') {
      return Boolean(cameraFiles[question.id]) || String(answers[question.id] || '').trim().length > 0
    }

    if (question.type === 'select') {
      const hasValue = String(answers[question.id] || '').trim().length > 0
      const selectedBehavior = getSelectOptionBehavior(question, String(answers[question.id] || '').trim())
      if (selectedBehavior.kind === 'camera' && hasValue) {
        return (
          Boolean(selectDetailFiles[question.id]) ||
          String(selectDetailAnswers[question.id] || '').trim().length > 0 ||
          String(selectDetailPreviews[question.id] || '').trim().length > 0
        )
      }
      if (selectedBehavior.kind !== 'input' || !hasValue) {
        return hasValue
      }
      return String(selectDetailAnswers[question.id] || '').trim().length > 0
    }

    if (question.type === 'location') {
      if (answers[question.id] === LOCATION_OTHER_VALUE) {
        return String(locationOtherAnswers[question.id] || '').trim().length > 0
      }
      return String(answers[question.id] || '').trim().length > 0
    }

    if (question.type === 'phone') {
      const answerValue = String(answers[question.id] || '').trim()
      return isValidNorwegianPhoneNumber(answerValue)
    }

    return String(answers[question.id] || '').trim().length > 0
  }

  const hasLocationQuestions = formData.questions.some(
    (question) => !isSectionQuestion(question) && question.type === 'location',
  )
  const selectedFormLocation = useMemo(
    () => getSelectedFormLocation(formData.questions, answers, locationOtherAnswers),
    [formData.questions, answers, locationOtherAnswers],
  )
  const visibleFormQuestions = useMemo(
    () => getVisibleFormQuestions(formData.questions, selectedFormLocation),
    [formData.questions, selectedFormLocation],
  )
  const visibleInputQuestions = useMemo(
    () => visibleFormQuestions.filter((question) => !isSectionQuestion(question)),
    [visibleFormQuestions],
  )
  const isPublicFormReady =
    !loadingForm &&
    draftReady &&
    (!hasLocationQuestions || !loadingLocations) &&
    (!isSubmissionEditMode || !loadingReceipt)
  const isReceiptReady = !loadingForm && !loadingReceipt
  const availableSubmissionDays = Array.from(
    new Set(submissions.map((submission) => getSubmissionDayKey(submission.submittedAt)).filter(Boolean)),
  )
  const effectiveSubmissionDay = selectedSubmissionDay || availableSubmissionDays[0] || ''
  const visibleSubmissions = effectiveSubmissionDay
    ? submissions.filter((submission) => getSubmissionDayKey(submission.submittedAt) === effectiveSubmissionDay)
    : submissions

  function fetchLastPhotoMeta(submissionList, onDone) {
    const toFetch = submissionList.filter((s) =>
      submissionLastPhotoMeta[s.id] === undefined &&
      Object.values(s.answers || {}).some((v) => isStorageImagePath(v))
    )
    if (toFetch.length === 0) { onDone?.(); return () => {} }
    let cancelled = false
    let pending = toFetch.length
    toFetch.forEach((submission) => {
      const paths = Object.values(submission.answers || {}).filter((v) => isStorageImagePath(v))
      if (!paths.length) { if (--pending === 0) onDone?.(); return }
      Promise.all(
        paths.map((path) =>
          getMetadata(ref(storage, path))
            .then((meta) => (meta.timeCreated ? new Date(meta.timeCreated).getTime() : 0))
            .catch(() => 0)
        )
      ).then((times) => {
        if (cancelled) return
        const latestMs = Math.max(...times)
        const entry = latestMs
          ? {
              ms: latestMs,
              display: new Date(latestMs).toLocaleString('en-GB', {
                day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
                timeZone: 'Europe/Oslo',
              }),
            }
          : null
        setSubmissionLastPhotoMeta((prev) => ({ ...prev, [submission.id]: entry }))
        if (--pending === 0) onDone?.()
      })
    })
    return () => { cancelled = true }
  }

  useEffect(() => {
    if (!isSubmissionsView) return
    return fetchLastPhotoMeta(visibleSubmissions, undefined)
  }, [isSubmissionsView, visibleSubmissions])
  const reviewedSubmissionMonthlyStats = useMemo(() => {
    const statsByMonth = new Map()

    submissions.forEach((submission) => {
      if (String(submission.status || '').trim().toLowerCase() !== 'reviewed') {
        return
      }

      const monthKey = getSubmissionMonthKey(submission.reviewedAt || submission.statusUpdatedAt || submission.submittedAt)
      if (!monthKey) {
        return
      }

      const current = statsByMonth.get(monthKey) || { monthKey, reviewedCount: 0, flaggedCount: 0 }
      current.reviewedCount += 1

      if (Array.isArray(submission.flaggedAnswers) && submission.flaggedAnswers.length > 0) {
        current.flaggedCount += 1
      }

      statsByMonth.set(monthKey, current)
    })

    return Array.from(statsByMonth.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey))
  }, [submissions])

  const missingReviewsByDay = useMemo(() => {
    const currentMonthKey = getSubmissionMonthKey(new Date())
    const byDay = {}
    submissions.forEach((s) => {
      if (getSubmissionMonthKey(s.submittedAt) !== currentMonthKey) return
      const status = String(s.status || '').trim().toLowerCase()
      if (status === 'reviewed' || status === 'rejected') return
      const dayKey = getSubmissionDayKey(s.submittedAt)
      if (!dayKey) return
      byDay[dayKey] = (byDay[dayKey] || 0) + 1
    })
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
  }, [submissions])

  const userScoreboard = useMemo(() => {
    const reviewQuestionCount = formData.questions.filter(
      (q) => !isSectionQuestion(q) && Boolean(q.includeInReview) && (q.reviewType || 'rating') === 'rating',
    ).length
    const byUser = new Map()
    submissions.forEach((submission) => {
      const userName =
        getSubmissionName(submission.answers, formData.questions) ||
        getSubmissionPhone(submission.answers, formData.questions) ||
        ''
      if (!userName) {
        return
      }
      const entry = byUser.get(userName) || {
        name: userName,
        totalSubmissions: 0,
        totalReviewed: 0,
        happy: 0,
        neutral: 0,
        sad: 0,
      }
      entry.totalSubmissions += 1
      if (String(submission.status || '').trim().toLowerCase() === 'reviewed') {
        entry.totalReviewed += 1
        if (submission.reviewScoreSummary) {
          entry.happy += submission.reviewScoreSummary.happy || 0
          entry.neutral += submission.reviewScoreSummary.neutral || 0
          entry.sad += submission.reviewScoreSummary.sad || 0
        }
      }
      byUser.set(userName, entry)
    })
    return Array.from(byUser.values())
      .map((row) => {
        const facesTotal = row.happy + row.neutral + row.sad
        const score = facesTotal > 0 ? Math.round((row.happy / facesTotal) * 100) : null
        return { ...row, score }
      })
      .sort((a, b) => {
        const aScore = a.score ?? 101
        const bScore = b.score ?? 101
        if (aScore !== bScore) return aScore - bScore
        if (a.sad !== b.sad) return b.sad - a.sad
        return b.totalSubmissions - a.totalSubmissions
      })
  }, [submissions, formData.questions])

  const flaggedSubmissions = useMemo(
    () =>
      submissions.filter((submission) => {
        const hasFlagged = Array.isArray(submission.flaggedAnswers) && submission.flaggedAnswers.length > 0
        const hasRatingIssues =
          (submission.reviewScoreSummary?.neutral || 0) + (submission.reviewScoreSummary?.sad || 0) > 0
        return hasFlagged || hasRatingIssues
      }),
    [submissions],
  )
  const flaggedImagePaths = useMemo(
    () =>
      Array.from(
        new Set(
          flaggedSubmissions.flatMap((submission) =>
            (submission.flaggedAnswers || [])
              .map((item) => item?.value)
              .filter((value) => isStorageImagePath(value)),
          ),
        ),
      ),
    [flaggedSubmissions],
  )
  const missingFlaggedImagePaths = useMemo(
    () => flaggedImagePaths.filter((path) => !(path in flaggedImageUrls)),
    [flaggedImagePaths, flaggedImageUrls],
  )
  const remarkImagePaths = useMemo(
    () =>
      Array.from(
        new Set(
          manualRemarks.flatMap((remark) =>
            (Array.isArray(remark.images) ? remark.images : []).filter((value) => isStorageImagePath(value)),
          ),
        ),
      ),
    [manualRemarks],
  )
  const missingRemarkImagePaths = useMemo(
    () => remarkImagePaths.filter((path) => !(path in remarkImageUrls)),
    [remarkImagePaths, remarkImageUrls],
  )
  const openFlaggedSubmissions = useMemo(
    () =>
      flaggedSubmissions.filter(
        (submission) => String(submission.flaggedStatus || '').trim().toLowerCase() !== 'complete',
      ),
    [flaggedSubmissions],
  )
  const hasFlaggedHistoryDateSearch = Boolean(flaggedHistoryDateFrom && flaggedHistoryDateTo)
  const flaggedHistorySubmissions = useMemo(
    () => {
      if (!hasFlaggedHistoryDateSearch) {
        return []
      }

      return flaggedSubmissions.filter((submission) => {
        const dayKey = getSubmissionDayKey(submission.submittedAt)
        if (!dayKey) {
          return false
        }

        if (flaggedHistoryDateFrom && dayKey < flaggedHistoryDateFrom) {
          return false
        }

        if (flaggedHistoryDateTo && dayKey > flaggedHistoryDateTo) {
          return false
        }

        return true
      })
    },
    [flaggedHistoryDateFrom, flaggedHistoryDateTo, flaggedSubmissions, hasFlaggedHistoryDateSearch],
  )
  const configuredWarningCategories = useMemo(
    () => normalizeWarningCategories(formData.warningCategories),
    [formData.warningCategories],
  )
  const warningCategoryUsageCounts = useMemo(() => {
    const counts = {}
    const increment = (value) => {
      const category = String(value || '').trim()
      if (!category) {
        return
      }

      const key = category.toLowerCase()
      counts[key] = (counts[key] || 0) + 1
    }

    submissions.forEach((submission) => {
      getSubmissionWarnings(submission).forEach((warning) => increment(warning.category))
    })
    manualRemarks.forEach((remark) => increment(remark.category))

    return counts
  }, [manualRemarks, submissions])
  const availableWarningCategories = useMemo(
    () =>
      normalizeWarningCategories([
        ...configuredWarningCategories,
        ...submissions.flatMap((submission) =>
          getSubmissionWarnings(submission).map((warning) => warning.category),
        ),
        ...manualRemarks.map((remark) => remark.category),
      ]),
    [configuredWarningCategories, manualRemarks, submissions],
  )
  const warningSubmissions = useMemo(
    () => submissions.filter((submission) => getSubmissionWarnings(submission).length > 0),
    [submissions],
  )
  const remarksOverview = useMemo(() => {
    const warningEntries = []
    const byPhone = new Map()
    let withoutPhoneCount = 0
    let totalWarnings = 0

    warningSubmissions.forEach((submission) => {
      const submissionWarnings = getSubmissionWarnings(submission)
      if (submissionWarnings.length === 0) {
        return
      }
      totalWarnings += submissionWarnings.length

      const phone = getSubmissionPhone(submission.answers, formData.questions)
      if (!phone) {
        withoutPhoneCount += submissionWarnings.length
        return
      }

      const locationName = getSubmissionLocation(submission.answers, formData.questions) || '-'
      const nameValue = getSubmissionName(submission.answers, formData.questions)
      const nextName = nameValue && nameValue !== phone ? nameValue : ''

      submissionWarnings.forEach((warning, index) => {
        const warningDateValue = warning.recordedAt || submission.submittedAt || null
        const warningDate =
          warningDateValue instanceof Date
            ? warningDateValue
            : typeof warningDateValue?.toDate === 'function'
              ? warningDateValue.toDate()
              : null
        const warningSeconds =
          warningDate ? Math.floor(warningDate.getTime() / 1000) : getTimestampSeconds(submission.submittedAt)

        warningEntries.push({
          id: `${submission.id}-warning-${index}`,
          phone,
          name: nextName,
          location: locationName,
          category: String(warning.category || '').trim() || 'Uten kategori',
          comment: String(warning.comment || '').trim(),
          recordedAt: warningDateValue || submission.submittedAt || null,
          recordedAtSeconds: warningSeconds,
          recordedBy: warning.recordedBy || '',
          sourceType: Array.isArray(submission.flaggedAnswers) && submission.flaggedAnswers.length > 0 ? 'flagged' : 'submission',
          sourceLabel:
            Array.isArray(submission.flaggedAnswers) && submission.flaggedAnswers.length > 0
              ? 'Flagget innsending'
              : 'Innsending',
          images: [],
          submissionId: submission.id,
          receiptToken: submission.receiptToken || '',
          flaggedAnswers: Array.isArray(submission.flaggedAnswers) ? submission.flaggedAnswers : [],
        })
      })
    })

    manualRemarks.forEach((remark) => {
      totalWarnings += 1
      warningEntries.push({
        id: remark.id,
        phone: remark.phone,
        name: remark.name,
        location: '-',
        category: remark.category,
        comment: remark.comment,
        images: Array.isArray(remark.images) ? remark.images : [],
        recordedAt: remark.recordedAt || null,
        recordedAtSeconds: getTimestampSeconds(remark.recordedAt),
        recordedBy: remark.recordedBy || '',
        sourceType: 'manual',
        sourceLabel: 'Registrert i remarks',
        submissionId: '',
        receiptToken: '',
        flaggedAnswers: [],
      })
    })

    warningEntries.forEach((warningEntry) => {
      const existing = byPhone.get(warningEntry.phone) || {
        phone: warningEntry.phone,
        warningCount: 0,
        latestSubmittedAt: warningEntry.recordedAt || null,
        latestSubmittedAtSeconds: warningEntry.recordedAtSeconds || 0,
        latestLocation: warningEntry.location || '-',
        latestName: warningEntry.name || '',
        categoryCounts: {},
        entries: [],
      }

      existing.warningCount += 1
      existing.categoryCounts[warningEntry.category] = (existing.categoryCounts[warningEntry.category] || 0) + 1
      existing.entries.push(warningEntry)

      if ((warningEntry.recordedAtSeconds || 0) >= existing.latestSubmittedAtSeconds) {
        existing.latestSubmittedAt = warningEntry.recordedAt || null
        existing.latestSubmittedAtSeconds = warningEntry.recordedAtSeconds || 0
        existing.latestLocation = warningEntry.location || '-'
        existing.latestName = warningEntry.name || ''
      }

      byPhone.set(warningEntry.phone, existing)
    })

    const rows = Array.from(byPhone.values())
      .map((entry) => ({
        ...entry,
        entries: entry.entries.sort((a, b) => {
          if ((b.recordedAtSeconds || 0) !== (a.recordedAtSeconds || 0)) {
            return (b.recordedAtSeconds || 0) - (a.recordedAtSeconds || 0)
          }
          return a.category.localeCompare(b.category, 'nb')
        }),
        categoryEntries: Object.entries(entry.categoryCounts)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => {
            if (b.count !== a.count) {
              return b.count - a.count
            }
            return a.label.localeCompare(b.label, 'nb')
          }),
      }))
      .sort((a, b) => {
        if (b.warningCount !== a.warningCount) {
          return b.warningCount - a.warningCount
        }
        if (b.latestSubmittedAtSeconds !== a.latestSubmittedAtSeconds) {
          return b.latestSubmittedAtSeconds - a.latestSubmittedAtSeconds
        }
        return a.phone.localeCompare(b.phone, 'nb')
      })

    return {
      rows,
      withoutPhoneCount,
      totalWarnings,
    }
  }, [formData.questions, manualRemarks, warningSubmissions])
  const submissionsByLocation = visibleSubmissions
    .reduce((accumulator, submission) => {
      const location = getSubmissionLocation(submission.answers, formData.questions) || 'Ukjent lokasjon'
      const existingGroup = accumulator.find((group) => group.location === location)
      if (existingGroup) {
        existingGroup.items.push(submission)
      } else {
        accumulator.push({ location, items: [submission] })
      }
      return accumulator
    }, [])
    .sort((a, b) => a.location.localeCompare(b.location, 'nb'))
  const analysisQuestions = useMemo(() => {
    const base = formData.questions.filter(
      (question) => !isSectionQuestion(question) && Boolean(question.includeInAnalysis),
    )
    if (analysisRowOrder.length === 0) return base
    return [...base].sort((a, b) => {
      const ai = analysisRowOrder.indexOf(a.id)
      const bi = analysisRowOrder.indexOf(b.id)
      const aPos = ai === -1 ? base.indexOf(a) + analysisRowOrder.length : ai
      const bPos = bi === -1 ? base.indexOf(b) + analysisRowOrder.length : bi
      return aPos - bPos
    })
  }, [formData.questions, analysisRowOrder])
  const visibleHistoryQuestions =
    historyShowAllQuestions
      ? analysisQuestions
      : analysisQuestions.filter((question) => selectedHistoryQuestionIds.includes(question.id))
  const locationOrder = availableLocations.map((location) => String(location.name || '').trim()).filter(Boolean)
  const parsedHistorySubmissionLimit = Math.max(1, Number.parseInt(historySubmissionLimit, 10) || 3)
  const historyByLocation = submissions
    .reduce((accumulator, submission) => {
      const location = getSubmissionLocation(submission.answers, formData.questions) || 'Ukjent lokasjon'
      const entry = accumulator.get(location) || []
      entry.push(submission)
      accumulator.set(location, entry)
      return accumulator
    }, new Map())
  const historyRows = Array.from(historyByLocation.entries())
    .map(([location, items]) => {
      const sortedItems = [...items].sort((a, b) => {
        const aSeconds = a.submittedAt?.seconds || 0
        const bSeconds = b.submittedAt?.seconds || 0
        return bSeconds - aSeconds
      })
      return {
        location,
        latestSubmittedAtSeconds: sortedItems[0]?.submittedAt?.seconds || 0,
        items: sortedItems.slice(0, parsedHistorySubmissionLimit),
      }
    })
    .filter((row) => locationOrder.includes(row.location))
    .sort((a, b) => b.latestSubmittedAtSeconds - a.latestSubmittedAtSeconds)
  useEffect(() => {
    const nextDefault = Math.max(1, Number.parseInt(formData.analysisDefaultSubmissionLimit, 10) || 3)
    setHistorySubmissionLimit((previous) => {
      const nextValue = String(nextDefault)
      return previous === nextValue ? previous : nextValue
    })
  }, [formData.analysisDefaultSubmissionLimit])

  useEffect(() => {
    const saved = Array.isArray(formData.analysisQuestionOrder) ? formData.analysisQuestionOrder : []
    setAnalysisRowOrder(saved)
  }, [formData.analysisQuestionOrder])

  useEffect(() => {
    if (!isHistoryView) return
    let cancelled = false
    getDocs(query(collection(db, 'inventoryUpdates'), where('formSlug', '==', STENGESKJEMA_ID)))
      .then((snap) => {
        if (cancelled) return
        const updates = {}
        snap.forEach((d) => {
          const data = d.data()
          if (data.location) {
            updates[data.location] = {
              answers: data.answers || {},
              answerLogs: data.answerLogs || {},
              updatedAt: data.updatedAt?.toDate?.() || null,
              updatedBy: data.updatedBy || '',
            }
          }
        })
        setInventoryUpdates(updates)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isHistoryView])

  useEffect(() => {
    if (flaggedSubmissions.length === 0) {
      setFlaggedImageUrls((previous) => {
        if (Object.keys(previous).length === 0) {
          return previous
        }
        return {}
      })
      return
    }

    if (missingFlaggedImagePaths.length === 0) {
      return
    }

    let cancelled = false
    Promise.all(
      missingFlaggedImagePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    ).then((pairs) => {
      if (cancelled) {
        return
      }

      const nextEntries = Object.fromEntries(pairs)
      setFlaggedImageUrls((previous) => {
        let hasChange = false
        const next = { ...previous }

        Object.entries(nextEntries).forEach(([path, url]) => {
          if (next[path] !== url) {
            next[path] = url
            hasChange = true
          }
        })

        return hasChange ? next : previous
      })
    })

    return () => {
      cancelled = true
    }
  }, [flaggedSubmissions, missingFlaggedImagePaths])

  useEffect(() => {
    if (remarkImagePaths.length === 0) {
      setRemarkImageUrls((previous) => {
        if (Object.keys(previous).length === 0) {
          return previous
        }
        return {}
      })
      return
    }

    if (missingRemarkImagePaths.length === 0) {
      return
    }

    let cancelled = false
    Promise.all(
      missingRemarkImagePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    ).then((pairs) => {
      if (cancelled) {
        return
      }

      const nextEntries = Object.fromEntries(pairs)
      setRemarkImageUrls((previous) => {
        let hasChange = false
        const next = { ...previous }

        Object.entries(nextEntries).forEach(([path, url]) => {
          if (next[path] !== url) {
            next[path] = url
            hasChange = true
          }
        })

        return hasChange ? next : previous
      })
    })

    return () => {
      cancelled = true
    }
  }, [missingRemarkImagePaths, remarkImagePaths])

  const visibleHistoryRows =
    historyShowAllLocations
      ? historyRows
      : historyRows.filter((row) => selectedHistoryLocations.includes(row.location))
  const historySubmissionSlots = Array.from(
    { length: parsedHistorySubmissionLimit },
    (_, index) => index,
  )
  const receiptAnswerEntries = getOrderedAnswerEntries(receiptSubmission?.answers || {}, formData.questions)
    .filter(([key]) => !key.endsWith(IMAGE_CAPTURED_AT_SUFFIX))
  const receiptEditState = getReceiptEditState(receiptSubmission?.submittedAtIso)
  const heroEyebrow = isReceiptPage ? publicCopy.receiptEyebrow : publicCopy.formEyebrow
  const localizedFormTitle = translateText(formData.title)
  const localizedFormDescription = translateText(formData.description)
  const heroTitle = isReceiptPage
    ? `${publicCopy.receiptTitlePrefix} ${localizedFormTitle} ${publicCopy.receiptTitleSuffix}`
    : localizedFormTitle
  const heroLead = isReceiptPage
    ? publicCopy.receiptLead
    : localizedFormDescription
  const showPublicFacingHeader = !isAdminShellView && !isReceiptPage

  useEffect(() => {
    const validLocations = new Set(historyRows.map((row) => row.location))
    setSelectedHistoryLocations((previous) => {
      const next = previous.filter((location) => validLocations.has(location))
      if (next.length === previous.length && next.every((location, index) => location === previous[index])) {
        return previous
      }
      return next
    })
  }, [historyRows])

  let publicQuestionOrder = 0

  function renderFlaggedSubmissionCard(submission, options = {}) {
    const flaggedState = flaggedActionState[submission.id] || {
      saving: false,
      error: '',
      message: '',
      categorySaving: false,
      categoryError: '',
    }
    const isComplete = String(submission.flaggedStatus || '').trim().toLowerCase() === 'complete'
    const isReviewOpen = flaggedReviewOpenId === submission.id
    const isCollapsed = Boolean(flaggedCollapsedIds[submission.id])
    const isCollapsible = Boolean(options.collapsible)
    const existingWarnings = getSubmissionWarnings(submission)
    const pendingWarningDrafts = Array.isArray(flaggedWarningDrafts[submission.id])
      ? flaggedWarningDrafts[submission.id]
      : []

    return (
      <article key={submission.id} className="response-card flagged-submission-card">
        {isCollapsible ? (
          <button
            type="button"
            className="ghost flagged-collapse-toggle"
            onClick={() => onToggleFlaggedCollapsed(submission.id)}
            aria-expanded={!isCollapsed}
          >
            <span>
              {getSubmissionLocation(submission.answers, formData.questions)} |{' '}
              {getSubmissionName(submission.answers, formData.questions)}
            </span>
            <span>{isCollapsed ? 'Vis ferdig vurdering' : 'Skjul ferdig vurdering'}</span>
          </button>
        ) : null}
        {!isCollapsed ? (
          <div className="flagged-panel-grid">
            <section className="flagged-panel flagged-info-panel">
              <h4>Info</h4>
              <div className="flagged-submission-meta">
                <p>
                  <strong>Vogn:</strong> {getSubmissionLocation(submission.answers, formData.questions)}
                </p>
                <p>
                  <strong>Navn / telefon:</strong> {getSubmissionName(submission.answers, formData.questions)}
                </p>
                <p>
                  <strong>Lokasjon:</strong> {getSubmissionPlace(submission.answers)}
                </p>
                <p>
                  <strong>Submitted:</strong> {formatTime(submission.submittedAt)}
                </p>
                <p>
                  <strong>Status:</strong>{' '}
                  <span className={`flagged-status-badge ${isComplete ? 'is-complete' : 'is-open'}`}>
                    {getFlaggedStatusLabel(submission.flaggedStatus)}
                  </span>
                </p>
              </div>
              <div className="flagged-action-topbar">
                {submission.receiptToken ? (
                  <a
                    className="ghost"
                    href={`/skjema/${activeFormSlug}/kvittering/${submission.receiptToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View receipt
                  </a>
                ) : null}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onOpenFlaggedReview(submission)}
                >
                  Review
                </button>
              </div>
              <h4>Action gjort</h4>
              {submission.flaggedActionTaken ? (
                <div className="flagged-action-summary">
                  <p>
                    <strong>Action gjort:</strong> {submission.flaggedActionTaken}
                  </p>
                  <p>
                    <strong>Fullført av:</strong> {submission.flaggedCompletedBy || '-'}
                  </p>
                  <p>
                    <strong>Fullført:</strong> {formatTime(submission.flaggedCompletedAt)}
                  </p>
                  <p>
                    <strong>Registrerte advarsler:</strong> {existingWarnings.length}
                  </p>
                  {existingWarnings.length > 0 ? (
                    <div className="flagged-warning-summary-list">
                      {existingWarnings.map((warning, index) => (
                        <p key={`${submission.id}-warning-summary-${index}`}>
                          <strong>{index + 1}.</strong> {warning.category}
                          {warning.comment ? ` | ${warning.comment}` : ''}
                          {warning.recordedBy ? ` | ${warning.recordedBy}` : ''}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="review-answer-value">Ingen action registrert ennå.</p>
              )}
              {isReviewOpen ? (
                <div className="flagged-action-box">
                  <label
                    className="field-block review-comment-field"
                    htmlFor={`flagged-action-${submission.id}`}
                  >
                    <span>Beskriv action gjort</span>
                    <textarea
                      id={`flagged-action-${submission.id}`}
                      rows={4}
                      value={flaggedActionDrafts[submission.id] || ''}
                      onChange={(event) =>
                        setFlaggedActionDrafts((previous) => ({
                          ...previous,
                          [submission.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="flagged-warning-box">
                    <div className="flagged-warning-box-header">
                      <div>
                        <p className="review-answer-label">Advarsler</p>
                        <p className="review-answer-value">
                          {existingWarnings.length > 0
                            ? `${existingWarnings.length} registrert tidligere`
                            : 'No recorded warnings yet.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => onAddWarningDraft(submission.id)}
                      >
                        Legg til advarsel
                      </button>
                    </div>
                    {existingWarnings.length > 0 ? (
                      <div className="flagged-warning-list">
                        {existingWarnings.map((warning, index) => (
                          <div key={`${submission.id}-warning-existing-${index}`} className="flagged-warning-existing-item">
                            <p>
                              <strong>{index + 1}.</strong> {warning.category}
                              {warning.recordedBy ? ` | ${warning.recordedBy}` : ''}
                            </p>
                            {warning.comment ? <p className="review-answer-value">{warning.comment}</p> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {pendingWarningDrafts.length > 0 ? (
                      <div className="flagged-warning-list">
                        {pendingWarningDrafts.map((draft, index) => (
                          <div key={draft.id} className="flagged-warning-draft-row">
                            <label
                              className="field-block"
                              htmlFor={`flagged-warning-category-${submission.id}-${draft.id}`}
                            >
                              <span>Ny advarsel {index + 1}</span>
                              <select
                                id={`flagged-warning-category-${submission.id}-${draft.id}`}
                                value={String(draft.category || '')}
                                onChange={(event) =>
                                  onChangeWarningDraftCategory(
                                    submission.id,
                                    draft.id,
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="">Velg kategori</option>
                                {availableWarningCategories.map((category) => (
                                  <option key={`${draft.id}-${category}`} value={category}>
                                    {category}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label
                              className="field-block"
                              htmlFor={`flagged-warning-comment-${submission.id}-${draft.id}`}
                            >
                              <span>Kommentar</span>
                              <textarea
                                id={`flagged-warning-comment-${submission.id}-${draft.id}`}
                                rows={3}
                                value={String(draft.comment || '')}
                                placeholder="Legg til kommentar"
                                onChange={(event) =>
                                  onChangeWarningDraftComment(
                                    submission.id,
                                    draft.id,
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="ghost danger-button"
                              onClick={() => onRemoveWarningDraft(submission.id, draft.id)}
                            >
                              Fjern
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="submission-table-actions flagged-action-buttons">
                    <div className="flagged-category-popup-wrap">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          setFlaggedCategoryPopupOpenId((previous) =>
                            previous === submission.id ? '' : submission.id,
                          )
                        }
                      >
                        Ny kategori
                      </button>
                      {flaggedCategoryPopupOpenId === submission.id ? (
                        <div className="flagged-category-popup">
                          <label
                            className="field-block"
                            htmlFor={`flagged-warning-new-category-${submission.id}`}
                          >
                            <span>Ny kategori</span>
                            <input
                              id={`flagged-warning-new-category-${submission.id}`}
                              type="text"
                              value={newWarningCategoryDrafts[submission.id] || ''}
                              placeholder="f.eks. For sen levering"
                              onChange={(event) =>
                                setNewWarningCategoryDrafts((previous) => ({
                                  ...previous,
                                  [submission.id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          {availableWarningCategories.length === 0 ? (
                            <p className="review-answer-value">
                              Ingen kategorier finnes ennå. Legg til den første her.
                            </p>
                          ) : null}
                          <div className="flagged-category-popup-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setFlaggedCategoryPopupOpenId('')}
                            >
                              Close
                            </button>
                            <button
                              type="button"
                              className="cta"
                              onClick={() => onAddWarningCategory(submission)}
                              disabled={flaggedState.categorySaving}
                            >
                              {flaggedState.categorySaving ? 'Saving...' : 'Save category'}
                            </button>
                          </div>
                          {flaggedState.categoryError ? (
                            <p className="forms-error">{flaggedState.categoryError}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="cta"
                      onClick={() => onCompleteFlaggedSubmission(submission)}
                      disabled={flaggedState.saving}
                    >
                      {flaggedState.saving ? 'Saving...' : 'Set complete'}
                    </button>
                  </div>
                  {flaggedState.error ? <p className="forms-error">{flaggedState.error}</p> : null}
                  {flaggedState.message ? <p className="forms-success">{flaggedState.message}</p> : null}
                </div>
              ) : null}
            </section>

            <section className="flagged-panel flagged-content-panel">
              {(() => {
                const allItems = submission.flaggedAnswers || []
                const flaggingItems = allItems.filter((item) => {
                  const q = formData.questions?.find((question) => question.id === item.answerKey)
                  return (q?.reviewType || 'rating') === 'flagging'
                })
                const ratingItems = allItems.filter((item) => {
                  const q = formData.questions?.find((question) => question.id === item.answerKey)
                  return (q?.reviewType || 'rating') === 'rating'
                })

                function renderFlaggedAnswerItem(item) {
                  const hasImagePath = isStorageImagePath(item.value)
                  const imageUrl = hasImagePath
                    ? String(item.imageUrl || flaggedImageUrls[item.value] || '')
                    : undefined
                  return (
                    <article key={`${submission.id}-${item.answerKey}`} className="flagged-answer-row">
                      <p className="review-answer-label">{item.label}</p>
                      {item.comment ? (
                        <p className="flagged-answer-comment">
                          <strong>Kommentar:</strong> {item.comment}
                        </p>
                      ) : null}
                      {hasImagePath ? (
                        imageUrl ? (
                          <img className="flagged-answer-image" src={imageUrl} alt={item.label} loading="lazy" />
                        ) : typeof item.imageUrl === 'string' || typeof flaggedImageUrls[item.value] !== 'undefined' ? (
                          <p className="review-answer-value">Kunne ikke laste bilde.</p>
                        ) : (
                          <p className="review-answer-value">Laster bilde...</p>
                        )
                      ) : (
                        <p className="review-answer-value">{String(item.value || '-')}</p>
                      )}
                    </article>
                  )
                }

                return (
                  <>
                    {flaggingItems.length > 0 ? (
                      <div className="flagged-content-section">
                        <h4>Flagget spørsmål</h4>
                        <div className="flagged-answer-list">
                          {flaggingItems.map(renderFlaggedAnswerItem)}
                        </div>
                      </div>
                    ) : null}
                    {flaggingItems.length === 0 ? (
                      <p className="review-answer-value flagged-no-items-note">Ingen flaggede spørsmål.</p>
                    ) : null}
                  </>
                )
              })()}
            </section>
          </div>
        ) : null}
      </article>
    )
  }

  function renderRemarksPage() {
    const loadingRemarks = loadingSubmissions || loadingManualRemarks

    return (
      <div className="remarks-page" id="remarks-section">
        <div className="history-header">
          <div className="history-title-block">
            <h3>Remarks</h3>
            <p className="history-legend">
              Register new remarks and expand each phone number to see all remarks, images, and comments.
            </p>
          </div>
        </div>

        <form className="response-card remarks-create-card" onSubmit={onSaveManualRemark}>
          <div className="remarks-create-fields">
            <label className="field-block" htmlFor="remarks-phone">
              <span>Phone number</span>
              <input
                id="remarks-phone"
                type="tel"
                inputMode="numeric"
                placeholder="8 digits"
                value={remarkDraftPhone}
                onChange={(event) => setRemarkDraftPhone(event.target.value)}
              />
            </label>
            <label className="field-block" htmlFor="remarks-category">
              <span>Category</span>
              <select
                id="remarks-category"
                value={remarkDraftCategory}
                onChange={(event) => setRemarkDraftCategory(event.target.value)}
              >
                <option value="">Select category</option>
                {availableWarningCategories.map((category) => (
                  <option key={`remark-category-${category}`} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field-block" htmlFor="remarks-comment">
            <span>Comment</span>
            <textarea
              id="remarks-comment"
              rows={4}
              placeholder="Add a comment for this remark"
              value={remarkDraftComment}
              onChange={(event) => setRemarkDraftComment(event.target.value)}
            />
          </label>
          <label className="field-block" htmlFor="remarks-images">
            <span>Images</span>
            <input
              id="remarks-images"
              type="file"
              accept="image/*"
              multiple
              onChange={async (event) => {
                await onRemarkImageFileChange(event.target.files)
                event.target.value = ''
              }}
            />
            <small className="question-help">You can attach one or more images.</small>
          </label>
          {remarkDraftImages.length > 0 ? (
            <div className="remarks-image-list remarks-image-list--draft">
              {remarkDraftImages.map((image, index) => (
                <article key={image.id} className="remarks-image-item">
                  {image.previewUrl ? (
                    <img
                      className="remarks-image"
                      src={image.previewUrl}
                      alt={`Selected remark image ${index + 1}`}
                    />
                  ) : (
                    <p className="review-answer-value">{image.file.name}</p>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => onRemoveRemarkDraftImage(image.id)}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          <div className="submission-table-actions flagged-action-buttons">
            <div className="flagged-category-popup-wrap">
              <button
                type="button"
                className="ghost"
                onClick={() => setRemarkCategoryPopupOpen((previous) => !previous)}
              >
                New category
              </button>
              {remarkCategoryPopupOpen ? (
                <div className="flagged-category-popup">
                  <label className="field-block" htmlFor="remarks-new-category">
                    <span>New category</span>
                    <input
                      id="remarks-new-category"
                      type="text"
                      value={newRemarkCategoryDraft}
                      placeholder="e.g. Did not show up"
                      onChange={(event) => setNewRemarkCategoryDraft(event.target.value)}
                    />
                  </label>
                  <div className="flagged-category-popup-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setRemarkCategoryPopupOpen(false)}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="cta"
                      onClick={onAddRemarkCategory}
                      disabled={remarkState.categorySaving}
                    >
                      {remarkState.categorySaving &&
                      remarkCategoryPendingAction === 'create' &&
                      remarkCategoryPendingName === String(newRemarkCategoryDraft || '').trim()
                        ? 'Saving...'
                        : 'Save category'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="ghost"
              onClick={openRemarkCategoryManager}
              disabled={remarkState.categorySaving}
            >
              Manage categories
            </button>
            <button type="submit" className="cta" disabled={remarkState.saving}>
              {remarkState.saving ? 'Saving...' : 'Save remark'}
            </button>
          </div>
          {remarkState.categoryError && !remarkCategoryManagerOpen ? (
            <p className="forms-error">{remarkState.categoryError}</p>
          ) : null}
          {remarkState.error ? <p className="forms-error">{remarkState.error}</p> : null}
          {remarkState.message ? <p className="forms-success">{remarkState.message}</p> : null}
        </form>

        {remarkCategoryManagerOpen ? (
          <div
            className="submission-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remark-category-modal-title"
            onClick={closeRemarkCategoryModal}
          >
            <div
              className="submission-modal forms-admin-modal remarks-category-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="submission-modal-header">
                <h4 id="remark-category-modal-title">Manage category</h4>
                <button
                  type="button"
                  className="ghost"
                  onClick={closeRemarkCategoryModal}
                  disabled={remarkState.categorySaving}
                >
                  Close
                </button>
              </div>
              <div className="submission-modal-content">
                <div className="remarks-category-modal-content">
                  {availableWarningCategories.length > 0 ? (
                    <>
                      <div className="remarks-category-admin-list">
                        {availableWarningCategories.map((category) => {
                          const usageCount = warningCategoryUsageCounts[category.toLowerCase()] || 0
                          const isConfigured = configuredWarningCategories.some(
                            (value) => value.toLowerCase() === category.toLowerCase(),
                          )

                          return (
                            <div key={`remark-category-${category}`} className="remarks-category-admin-row">
                              <span className="remarks-category-chip">{category}</span>
                              <span className="review-answer-value">
                                {usageCount > 0 ? `In use: ${usageCount}` : 'Not in use'}
                              </span>
                              <span className="review-answer-value">
                                {isConfigured ? 'Selectable category' : 'In existing data only'}
                              </span>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => openRemarkCategoryModal(category)}
                                disabled={remarkState.categorySaving}
                              >
                                Manage
                              </button>
                            </div>
                          )
                        })}
                      </div>
                      <small className="question-help">
                        You can rename categories here. Deletion is only available for categories not in use.
                      </small>
                    </>
                  ) : (
                    <p className="review-answer-value">No categories yet.</p>
                  )}
                  {remarkCategoryModalCategory ? (
                    <>
                      <p className="review-answer-value">
                        <strong>Current name:</strong> {remarkCategoryModalCategory}
                      </p>
                      <p className="review-answer-value">
                        <strong>Usage:</strong>{' '}
                        {warningCategoryUsageCounts[remarkCategoryModalCategory.toLowerCase()] || 0}
                      </p>
                      <label className="field-block" htmlFor="remark-category-rename">
                        <span>New name</span>
                        <input
                          id="remark-category-rename"
                          type="text"
                          value={remarkCategoryRenameDraft}
                          disabled={remarkState.categorySaving}
                          onChange={(event) => setRemarkCategoryRenameDraft(event.target.value)}
                        />
                      </label>
                      <div className="forms-admin-modal-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setRemarkCategoryModalCategory('')
                            setRemarkCategoryRenameDraft('')
                            setRemarkState((previous) => ({
                              ...previous,
                              categoryError: '',
                            }))
                          }}
                          disabled={remarkState.categorySaving}
                        >
                          Close management
                        </button>
                        <button
                          type="button"
                          className="cta"
                          onClick={onRenameWarningCategory}
                          disabled={remarkState.categorySaving}
                        >
                          {remarkState.categorySaving &&
                          remarkCategoryPendingAction === 'rename' &&
                          remarkCategoryPendingName.toLowerCase() ===
                            remarkCategoryModalCategory.toLowerCase()
                            ? 'Saving...'
                            : 'Save new name'}
                        </button>
                        <button
                          type="button"
                          className="ghost danger-button"
                          onClick={() => onDeleteWarningCategory(remarkCategoryModalCategory)}
                          disabled={
                            remarkState.categorySaving ||
                            (warningCategoryUsageCounts[remarkCategoryModalCategory.toLowerCase()] || 0) > 0
                          }
                        >
                          {remarkState.categorySaving &&
                          remarkCategoryPendingAction === 'delete' &&
                          remarkCategoryPendingName.toLowerCase() ===
                            remarkCategoryModalCategory.toLowerCase()
                            ? 'Deleting...'
                            : 'Delete category'}
                        </button>
                      </div>
                      {(warningCategoryUsageCounts[remarkCategoryModalCategory.toLowerCase()] || 0) > 0 ? (
                        <p className="review-pending-note">
                          The category is in use and cannot be deleted until the associated remarks or warnings have been changed.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {remarkState.categoryError ? <p className="forms-error">{remarkState.categoryError}</p> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {loadingRemarks ? <p>Loading remarks...</p> : null}
        {!loadingRemarks && remarksOverview.totalWarnings === 0 ? (
          <p>No recorded warnings yet.</p>
        ) : null}
        {!loadingRemarks && remarksOverview.totalWarnings > 0 ? (
          <>
            <div className="remarks-summary-row">
              <span className="submission-status-badge is-flagged">
                {remarksOverview.totalWarnings} warnings
              </span>
              <span className="submission-status-badge is-reviewed">
                {remarksOverview.rows.length} phone numbers
              </span>
            </div>
            {remarksOverview.withoutPhoneCount > 0 ? (
              <p className="review-pending-note">
                {remarksOverview.withoutPhoneCount} warnings are missing a phone number and are not shown in the list below.
              </p>
            ) : null}
            <div className="remarks-list">
              {remarksOverview.rows.map((entry) => (
                <article key={entry.phone} className="response-card remarks-card">
                  <button
                    type="button"
                    className="ghost remarks-expand-toggle"
                    onClick={() => onToggleRemarkPhone(entry.phone)}
                    aria-expanded={Boolean(expandedRemarkPhones[entry.phone])}
                  >
                    <div className="remarks-card-header">
                      <div>
                        <h4>{entry.phone}</h4>
                        {entry.latestName ? <p>{entry.latestName}</p> : null}
                      </div>
                      <div className="remarks-card-header-right">
                        <span className="remarks-count-badge">
                          {entry.warningCount} {entry.warningCount === 1 ? 'warning' : 'warnings'}
                        </span>
                        <span className="review-answer-value">
                          {expandedRemarkPhones[entry.phone] ? 'Hide' : 'Show all'}
                        </span>
                      </div>
                    </div>
                  </button>
                  <div className="remarks-meta-grid">
                    <p>
                      <strong>Last location:</strong> {entry.latestLocation || '-'}
                    </p>
                    <p>
                      <strong>Last recorded:</strong> {formatTime(entry.latestSubmittedAt)}
                    </p>
                  </div>
                  <div className="remarks-category-list">
                    {entry.categoryEntries.map((category) => (
                      <span
                        key={`${entry.phone}-${category.label}`}
                        className="remarks-category-chip"
                      >
                        {category.label}: {category.count}
                      </span>
                    ))}
                  </div>
                  {expandedRemarkPhones[entry.phone] ? (
                    <div className="remarks-detail-list">
                      {entry.entries.map((remarkEntry, index) => {
                        const deleteState = remarkDeleteState[remarkEntry.id] || {}

                        return (
                        <article key={remarkEntry.id} className="remarks-detail-card">
                          <div className="remarks-detail-header">
                            <div className="remarks-detail-badges">
                              <span className="remarks-category-chip">{remarkEntry.category}</span>
                              <span className="submission-status-badge is-reviewed">
                                {remarkEntry.sourceLabel}
                              </span>
                            </div>
                            <p className="review-answer-value">
                              <strong>{index + 1}.</strong> {formatTime(remarkEntry.recordedAt)}
                            </p>
                          </div>
                          <div className="remarks-meta-grid">
                            <p>
                              <strong>Recorded by:</strong> {remarkEntry.recordedBy || '-'}
                            </p>
                            <p>
                              <strong>Location:</strong> {remarkEntry.location || '-'}
                            </p>
                            {remarkEntry.name ? (
                              <p>
                                <strong>Name:</strong> {remarkEntry.name}
                              </p>
                            ) : null}
                          </div>
                          {remarkEntry.comment ? (
                            <p className="flagged-answer-comment">
                              <strong>Comment:</strong> {remarkEntry.comment}
                            </p>
                          ) : null}
                          {remarkEntry.sourceType === 'manual' ? (
                            <div className="submission-table-actions remarks-detail-actions">
                              <button
                                type="button"
                                className="ghost danger-button"
                                onClick={() => onDeleteManualRemark(remarkEntry)}
                                disabled={deleteState.deleting}
                              >
                                {deleteState.deleting ? 'Deleting...' : 'Delete remark'}
                              </button>
                              {deleteState.error ? (
                                <small className="forms-error">{deleteState.error}</small>
                              ) : null}
                            </div>
                          ) : null}
                          {Array.isArray(remarkEntry.images) && remarkEntry.images.length > 0 ? (
                            <div className="remarks-image-list">
                              {remarkEntry.images.map((imageValue, imageIndex) => {
                                const hasStoragePath = isStorageImagePath(imageValue)
                                const imageUrl = hasStoragePath
                                  ? String(remarkImageUrls[imageValue] || '')
                                  : String(imageValue || '')

                                return (
                                  <article
                                    key={`${remarkEntry.id}-image-${imageValue}-${imageIndex}`}
                                    className="remarks-image-item"
                                  >
                                    {imageUrl ? (
                                      <a href={imageUrl} target="_blank" rel="noreferrer">
                                        <img
                                          className="remarks-image"
                                          src={imageUrl}
                                          alt={`${remarkEntry.category} bilde ${imageIndex + 1}`}
                                          loading="lazy"
                                        />
                                      </a>
                                    ) : hasStoragePath && typeof remarkImageUrls[imageValue] !== 'undefined' ? (
                                      <p className="review-answer-value">Could not load image.</p>
                                    ) : (
                                      <p className="review-answer-value">Loading image...</p>
                                    )}
                                  </article>
                                )
                              })}
                            </div>
                          ) : null}
                          {remarkEntry.receiptToken ? (
                            <a
                              className="ghost remarks-receipt-link"
                              href={`/skjema/${activeFormSlug}/kvittering/${remarkEntry.receiptToken}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View receipt
                            </a>
                          ) : null}
                          {remarkEntry.flaggedAnswers.length > 0 ? (
                            <div className="remarks-flagged-answer-list">
                              {remarkEntry.flaggedAnswers.map((item, itemIndex) => {
                                const hasImagePath = isStorageImagePath(item.value)
                                const imageUrl = hasImagePath
                                  ? String(item.imageUrl || flaggedImageUrls[item.value] || '')
                                  : ''

                                return (
                                  <article
                                    key={`${remarkEntry.id}-${item.answerKey || itemIndex}`}
                                    className="flagged-answer-row remarks-flagged-answer-row"
                                  >
                                    <p className="review-answer-label">{item.label}</p>
                                    {item.comment ? (
                                      <p className="flagged-answer-comment">
                                        <strong>Comment:</strong> {item.comment}
                                      </p>
                                    ) : null}
                                    {hasImagePath ? (
                                      imageUrl ? (
                                        <img
                                          className="flagged-answer-image"
                                          src={imageUrl}
                                          alt={item.label}
                                          loading="lazy"
                                        />
                                      ) : typeof item.imageUrl === 'string' ||
                                        typeof flaggedImageUrls[item.value] !== 'undefined' ? (
                                        <p className="review-answer-value">Could not load image.</p>
                                      ) : (
                                        <p className="review-answer-value">Loading image...</p>
                                      )
                                    ) : (
                                      <p className="review-answer-value">{String(item.value || '-')}</p>
                                    )}
                                  </article>
                                )
                              })}
                            </div>
                          ) : null}
                        </article>
                        )
                      })}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>
    )
  }

  function renderEditorQuestionSummaryList() {
    return (
      <div className="editor-question-summary-list">
        {editorQuestions.map((question, index) => (
          <div
            key={`${question.id}-${index}-summary`}
            className={`editor-question-summary-row${isSectionQuestion(question) ? ' is-section' : ''}`}
          >
            <strong className="editor-question-summary-number">Spørsmål {index + 1}</strong>
            <span className="editor-question-summary-label">{question.label || `Spørsmål ${index + 1}`}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className={`forms-page stengeskjema-page ${isStandalonePublicForm ? 'public-form-page' : ''} ${
        isHistoryView || isRemarksView || isRatingView ? 'history-page' : ''
      }`}
    >
      {isAdminShellView ? (
        <form action="/skjema" method="get">
          <button type="submit" className="admin-login-link">
            Back to main menu
          </button>
        </form>
      ) : !isStandalonePublicForm ? (
        <form action="/skjema" method="get">
          <button type="submit" className="admin-login-link">
            Tilbake til alle skjema
          </button>
        </form>
      ) : null}
      {isHistoryView ? (
        <div className="inventory-update-top-bar">
          <button
            type="button"
            className="ghost inventory-update-btn"
            onClick={() => {
              setInventoryModalLocation('')
              setInventoryModalQuestionId('')
              setInventoryModalAnswers({})
              setInventoryModalError('')
              setShowInventoryModal(true)
            }}
          >
            ✏ Rediger varebeholdning
          </button>
        </div>
      ) : null}
      {isReceiptPage && !isReceiptReady ? (
        <section className="form-entry">
          <p>{publicCopy.loadingReceipt}</p>
        </section>
      ) : isSubmissionEditMode && loadingReceipt ? (
        <section className="form-entry">
          <p>{publicCopy.loadingReceipt}</p>
        </section>
      ) : isSubmissionEditMode && receiptError ? (
        <section className="form-entry">
          <p className="forms-error">{receiptError}</p>
        </section>
      ) : !isAdminShellView && !isReceiptPage && !isPublicFormReady ? (
        <section className="form-entry">
          <p>{publicCopy.loadingForm}</p>
        </section>
      ) : (
        <>
          {showPublicFacingHeader ? (
            <header className="forms-hero">
              <p className="eyebrow">{heroEyebrow}</p>
              <h1>{heroTitle}</h1>
              <p className="lead">{heroLead}</p>
              <div className="public-form-language-bar">
                <span className="public-form-language-label">{publicCopy.languageLabel}</span>
                <div className="public-form-language-toggle" role="group" aria-label={publicCopy.languageLabel}>
                  <button
                    type="button"
                    className={displayLanguage === 'no' ? 'is-active' : ''}
                    onClick={() => setDisplayLanguage('no')}
                  >
                    {publicCopy.norwegian}
                  </button>
                  <button
                    type="button"
                    className={displayLanguage === 'en' ? 'is-active' : ''}
                    onClick={() => setDisplayLanguage('en')}
                  >
                    {publicCopy.english}
                  </button>
                </div>
              </div>
              {translationState.loading ? (
                <div className="public-form-translation-loader" role="status" aria-live="polite">
                  <div className="public-form-translation-spinner" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="public-form-translation-copy">
                    <strong>{publicCopy.translating}</strong>
                    <span>{publicCopy.translatingHint}</span>
                  </div>
                </div>
              ) : null}
              {translationState.error ? (
                <p className="public-form-language-status is-error">{translationState.error}</p>
              ) : null}
            </header>
          ) : null}

          {isReceiptPage ? (
            <section className="form-entry receipt-entry">
              {feedbackConfirmDone ? (
                <div className="receipt-confirm-thanks">
                  <span className="receipt-confirm-thanks-icon">✓</span>
                  Takk for bekreftelsen!
                </div>
              ) : null}
              {receiptError ? <p className="forms-error">{receiptError}</p> : null}
              {!receiptError && receiptSubmission ? (
                <>
                  <div className="receipt-meta">
                    <p>
                      <strong>{publicCopy.submissionLabel}:</strong> {receiptSubmission.submissionId || receiptSubmission.id}
                    </p>
                    <p>
                      <strong>{publicCopy.submittedLabel}:</strong>{' '}
                      {receiptSubmission.submittedAtIso
                        ? new Date(receiptSubmission.submittedAtIso).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })
                        : '-'}
                    </p>
                    {receiptToken ? (
                      receiptEditState.allowed ? (
                        <p>
                          <a
                            className="ghost"
                            href={`/skjema/${activeFormSlug}?editReceipt=${receiptToken}`}
                          >
                            {publicCopy.editSubmission}
                          </a>
                        </p>
                      ) : (
                        <p>{publicCopy.editWindowExpired}</p>
                      )
                    ) : null}
                  </div>

                  {(() => {
                    const prodRate = getIceProductionRate(receiptSubmission.answers, formData.questions)
                    if (!prodRate) return null
                    return (
                      <div className="receipt-meta ice-production-rate-box">
                        <p><strong>Iskrem produksjon</strong></p>
                        <p>{prodRate.startTime} – {prodRate.endTime} ({prodRate.hours} timer)</p>
                        <p>{prodRate.count} kuler totalt</p>
                        <p className="ice-production-rate-highlight">
                          <strong>{prodRate.rate} kuler / time</strong> (gjennomsnitt)
                        </p>
                      </div>
                    )
                  })()}

                  <div className="receipt-answer-list">
                    {receiptAnswerEntries.map(([key, value]) => {
                      const answerImage = getAnswerImageDetails(
                        key,
                        value,
                        receiptSubmission,
                        {
                          ...(receiptSubmission.imageUrls || {}),
                          ...receiptImageUrls,
                        },
                        formData.questions,
                      )

                      return (
                        <article key={key} className="receipt-answer-row">
                          <p className="receipt-answer-label">
                            {translateText(
                              getAnswerDisplayLabel(key, receiptSubmission.answers, formData.questions),
                            )}
                          </p>
                          {answerImage.isImageAnswer ? (
                            <>
                              {answerImage.imageUrl ? (
                                <img
                                  className="receipt-answer-image"
                                  src={answerImage.imageUrl}
                                  alt={translateText(
                                    getAnswerDisplayLabel(
                                      key,
                                      receiptSubmission.answers,
                                      formData.questions,
                                    ),
                                  )}
                                  loading="lazy"
                                />
                              ) : null}
                              {answerImage.imageUrl ? (
                                <p className="receipt-answer-value receipt-answer-file-link">
                                  <a href={answerImage.imageUrl} target="_blank" rel="noreferrer">
                                    {answerImage.fileLabel || 'Open image'}
                                  </a>
                                </p>
                              ) : (
                                <p className="receipt-answer-value">
                                  {answerImage.fileLabel || publicCopy.loadingImage}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="receipt-answer-value">
                              {String(value || '-')}
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </div>

                  {(() => {
                    const rd = receiptReviewData
                    if (!rd || rd.status !== 'reviewed' || rd.rejected) return null
                    const neutral = rd.reviewScoreSummary?.neutral || 0
                    const sad = rd.reviewScoreSummary?.sad || 0
                    const hasFeedback = neutral > 0 || sad > 0 || Boolean(rd.generalFeedback)
                    if (!hasFeedback) return null
                    const alreadyConfirmed = rd.feedbackReadConfirmed || feedbackConfirmDone
                    return (
                      <div className="receipt-feedback-section">
                        <h4 className="receipt-feedback-title">Tilbakemelding fra gjennomgang</h4>
                        <div className="receipt-feedback-scores">
                          {(rd.reviewScoreSummary?.happy || 0) > 0 ? (
                            <span className="receipt-feedback-score is-happy">
                              <FaceHappy size={18} /> {rd.reviewScoreSummary.happy}
                            </span>
                          ) : null}
                          {neutral > 0 ? (
                            <span className="receipt-feedback-score is-neutral">
                              <FaceNeutral size={18} /> {neutral}
                            </span>
                          ) : null}
                          {sad > 0 ? (
                            <span className="receipt-feedback-score is-sad">
                              <FaceSad size={18} /> {sad}
                            </span>
                          ) : null}
                        </div>
                        {rd.generalFeedback ? (
                          <p className="receipt-feedback-general">{rd.generalFeedback}</p>
                        ) : null}
                        {alreadyConfirmed ? (
                          <p className="receipt-feedback-confirmed">✓ Du har bekreftet at du har lest tilbakemeldingen</p>
                        ) : (
                          <button
                            type="button"
                            className="cta receipt-feedback-confirm-btn"
                            disabled={feedbackConfirmSaving}
                            onClick={async () => {
                              setFeedbackConfirmSaving(true)
                              try {
                                await httpsCallable(functions, 'confirmFeedbackRead')({ receiptToken })
                                setFeedbackConfirmDone(true)
                                setReceiptReviewData((prev) => prev ? { ...prev, feedbackReadConfirmed: true } : prev)
                              } catch {}
                              setFeedbackConfirmSaving(false)
                            }}
                          >
                            {feedbackConfirmSaving ? 'Bekrefter...' : 'Bekreft at du har lest tilbakemeldingen'}
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </>
              ) : null}
            </section>
          ) : !isAdminShellView ? (
            <section className="form-entry">
              {isSubmissionEditMode ? <p className="field-help">{publicCopy.editingSubmission}</p> : null}
              <div className="form-entry-header">
                <button type="button" className="ghost reset-form-button" onClick={resetAllAnswers}>
                  {publicCopy.resetAnswers}
                </button>
              </div>
              <form key={formInstanceKey} onSubmit={onSubmit} className="dynamic-form">
                {visibleFormQuestions.map((question) =>
                  isSectionQuestion(question) ? (
                    <div key={question.id} className="form-section-block">
                      {renderSectionHeading(question)}
                    </div>
                  ) : (() => {
                      const stripeClass =
                        publicQuestionOrder % 2 === 0 ? 'is-striped-light' : 'is-striped-dark'
                      publicQuestionOrder += 1

                      return (
                        <label
                          key={question.id}
                          htmlFor={question.id}
                          className={`field-block form-question-block ${stripeClass} ${
                            isQuestionAnswered(question) ? 'is-answered' : ''
                          } ${question.required && !isQuestionAnswered(question) ? 'is-required-unanswered' : ''} ${
                            submitErrorQuestionId === question.id ? 'has-error' : ''
                          }`}
                        >
                          {renderQuestionLead(question)}
                          {renderQuestionInput(question)}
                        </label>
                      )
                    })(),
                )}

                {formData.enableSelfDeclaration ? (
                  <div
                    className={`self-declaration-box ${
                      selfDeclarationAccepted ? 'is-answered' : ''
                    } ${!selfDeclarationAccepted ? 'is-required-unanswered' : ''} ${
                      submitErrorTargetId === 'self-declaration-checkbox' ? 'has-error' : ''
                    }`}
                  >
                    <p className="self-declaration-text">
                      {translateText(formData.selfDeclarationText) || publicCopy.selfDeclarationFallback}
                    </p>
                    <label
                      className="checkbox-inline self-declaration-check"
                      htmlFor="self-declaration-checkbox"
                    >
                      <input
                        id="self-declaration-checkbox"
                        type="checkbox"
                        checked={selfDeclarationAccepted}
                        onChange={(event) => setSelfDeclarationAccepted(event.target.checked)}
                      />
                      {publicCopy.confirmSelfDeclaration}
                    </label>
                  </div>
                ) : null}

                {submitState.error ? (
                  <div className="forms-error-banner">
                    <p className="forms-error">{submitState.error}</p>
                    {submitErrorTargetId ? (
                      <button
                        type="button"
                        className="ghost forms-error-jump"
                        onClick={() => focusValidationTarget(submitErrorTargetId)}
                      >
                        {publicCopy.goToQuestion}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="submit"
                  className="cta"
                  disabled={submitState.submitting || hasPendingImageUploads || !isPublicFormReady}
                >
                  {submitState.submitting ? publicCopy.sendingForm : publicCopy.sendForm}
                </button>
              </form>
            </section>
          ) : null}

          {submitOverlay.open &&
          !isReceiptPage &&
          !isAdminShellView ? (
            <div className="submit-overlay" role="status" aria-live="polite" aria-busy={submitOverlay.status === 'submitting'}>
              <div className={`submit-overlay-card is-${submitOverlay.status}`}>
                {submitOverlay.status === 'submitting' ? (
                  <>
                    <div className="submit-overlay-spinner" aria-hidden="true" />
                    <p>{publicCopy.sendingForm}</p>
                  </>
                ) : (
                  <>
                    <div className="submit-overlay-check" aria-hidden="true">
                      ✓
                    </div>
                    <p>{publicCopy.formSent}</p>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      {isAdminShellView && !isAdmin && !loading ? (
        <section className="admin-login-line">
          <p className="forms-error">Kun admin har tilgang til denne siden.</p>
        </section>
      ) : null}

      {isAdmin && isAdminShellView ? (
        <section className="admin-edit-shell">
          {loading ? <p>Kontrollerer innlogging...</p> : null}
          {error ? <p className="forms-error">{error}</p> : null}

            {isRemarksView ? (
              renderRemarksPage()
            ) : isEditPage ? (
              <div className="admin-editor">
                <div className="editor-mode-header">
                  <h3>Rediger skjema</h3>
                  <div className="editor-mode-switch" role="group" aria-label="View modesmodus">
                    <button
                      type="button"
                      className={!editorEditMode ? 'is-active' : ''}
                      onClick={() => setEditorEditMode(false)}
                    >
                      View mode
                    </button>
                    <button
                      type="button"
                      className={editorEditMode ? 'is-active' : ''}
                      onClick={() => setEditorEditMode(true)}
                    >
                      Edit mode
                    </button>
                  </div>
                </div>
                {editorEditMode ? (
                <>
                <label className="field-block" htmlFor="editor-title">
                  <span>Tittel</span>
                  <input
                    id="editor-title"
                    type="text"
                    value={editorTitle}
                    onChange={(event) => setEditorTitle(event.target.value)}
                  />
                </label>

                <label className="field-block" htmlFor="editor-description">
                  <span>Beskrivelse</span>
                  <textarea
                    id="editor-description"
                    rows={3}
                    value={editorDescription}
                    onChange={(event) => setEditorDescription(event.target.value)}
                  />
                </label>

                <label className="checkbox-inline" htmlFor="editor-include-submission-datetime">
                  <input
                    id="editor-include-submission-datetime"
                    type="checkbox"
                    checked={editorIncludeSubmissionDateTime}
                    onChange={(event) => setEditorIncludeSubmissionDateTime(event.target.checked)}
                  />
                  Send med innsendingstidspunkt (dag og tid)
                </label>

                <label className="checkbox-inline" htmlFor="editor-enable-self-declaration">
                  <input
                    id="editor-enable-self-declaration"
                    type="checkbox"
                    checked={editorEnableSelfDeclaration}
                    onChange={(event) => setEditorEnableSelfDeclaration(event.target.checked)}
                  />
                  Legg til egenerklæring nederst i skjemaet
                </label>

                {editorEnableSelfDeclaration ? (
                  <label className="field-block" htmlFor="editor-self-declaration-text">
                    <span>Egenerklæringstekst</span>
                    <textarea
                      id="editor-self-declaration-text"
                      rows={3}
                      value={editorSelfDeclarationText}
                      onChange={(event) => setEditorSelfDeclarationText(event.target.value)}
                    />
                  </label>
                ) : null}

                <div className="admin-actions">
                  <button
                    type="button"
                    className="cta"
                    onClick={onSaveForm}
                    disabled={saveState.saving}
                  >
                    {saveState.saving ? 'Saving...' : 'Lagre skjema'}
                  </button>
                </div>

                <div className="editor-questions">
                  {editorQuestions.map((question, index) => (
                    <article key={`${question.id}-${index}`} className="editor-question-card">
                      <p>Spørsmål {index + 1}</p>
                      <div className="editor-question-layout">
                        <div className="editor-question-content">
                          <div
                            className={`editor-question-row editor-question-main-row${
                              isSectionQuestion(question) ? ' is-section-question' : ''
                            }`}
                          >
                            <label className="field-block" htmlFor={`q-label-${index}`}>
                              <span>Tekst</span>
                              <input
                                id={`q-label-${index}`}
                                type="text"
                                value={question.label}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'label', event.target.value)
                                }
                              />
                            </label>

                            <label className="field-block" htmlFor={`q-type-${index}`}>
                              <span>Type</span>
                              <select
                                id={`q-type-${index}`}
                                value={question.type}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'type', event.target.value)
                                }
                              >
                                <option value="text">Tekst</option>
                                <option value="textarea">Lang tekst</option>
                                <option value="select">Valg</option>
                                <option value="location">Lokasjon</option>
                                <option value="number">Tall</option>
                                <option value="date">Dato</option>
                                <option value="time-start">Tid (starttid)</option>
                                <option value="time-end">Tid (sluttid)</option>
                                <option value="camera">Ta bilde fra kamera</option>
                                <option value="multi-camera">Flere bilder</option>
                                <option value="name">User's name</option>
                                <option value="phone">Telefonnummer</option>
                                <option value="email">E-post</option>
                                <option value="section">Kategori</option>
                              </select>
                            </label>
                            <label className="field-block" htmlFor={`q-image-${index}`}>
                              <span>Bilde (valgfritt)</span>
                              <input
                                id={`q-image-${index}`}
                                type="file"
                                accept="image/*"
                                onChange={async (event) => {
                                  const file = event.target.files?.[0] || null
                                  try {
                                    await onEditorQuestionImageChange(index, file)
                                  } catch {
                                    setSaveState({
                                      saving: false,
                                      message: '',
                                      error: 'Kunne ikke lese bildet. Prøv en annen fil.',
                                    })
                                  } finally {
                                    event.target.value = ''
                                  }
                                }}
                              />
                            </label>

                            <label className="field-block" htmlFor={`q-placeholder-${index}`}>
                              <span>
                                {isSectionQuestion(question) ? 'Hjelpetekst under kategori' : 'Hjelpetekst'}
                              </span>
                              <input
                                id={`q-placeholder-${index}`}
                                type="text"
                                value={question.placeholder || ''}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'placeholder', event.target.value)
                                }
                              />
                            </label>

                            {isSectionQuestion(question) ? (
                              <>
                                <label className="field-block" htmlFor={`q-helptext-color-${index}`}>
                                  <span>Hjelpetekst-farge</span>
                                  <input
                                    id={`q-helptext-color-${index}`}
                                    type="color"
                                    value={question.helpTextColor || '#5f4c3f'}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'helpTextColor', event.target.value)
                                    }
                                  />
                                </label>

                                <label
                                  className="checkbox-inline editor-main-row-checkbox"
                                  htmlFor={`q-helptext-bold-${index}`}
                                >
                                  <input
                                    id={`q-helptext-bold-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.helpTextBold)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'helpTextBold', event.target.checked)
                                    }
                                  />
                                  Hjelpetekst i bold
                                </label>
                              </>
                            ) : null}
                          </div>

                          {question.type === 'select' ? (
                            <>
                              <label className="field-block" htmlFor={`q-options-${index}`}>
                                <span>Valg (kommaseparert)</span>
                                <input
                                  id={`q-options-${index}`}
                                  type="text"
                                  value={question.optionsText || ''}
                                  onChange={(event) =>
                                    onEditorQuestionChange(index, 'options', event.target.value)
                                  }
                                />
                              </label>
                              <div className="select-option-detail-list">
                                {(question.options || []).map((option) => {
                                  const optionDetail = getSelectOptionBehavior(question, option)
                                  const hasDetail = optionDetail.kind !== 'none'

                                  return (
                                    <div key={`${question.id}-${option}`} className="select-option-detail-row">
                                      <div className="select-option-detail-head">
                                        <p className="select-option-detail-label">{option}</p>
                                        <label
                                          className="select-option-category-inline"
                                          htmlFor={`q-select-category-${index}-${option}`}
                                        >
                                          <span>Kategori:</span>
                                          <select
                                            id={`q-select-category-${index}-${option}`}
                                            value={optionDetail.historyCategory || 'normal'}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'historyCategory',
                                                event.target.value,
                                              )
                                            }
                                          >
                                            <option value="normal">Vanlig</option>
                                            <option value="orange">Oransje</option>
                                            <option value="red">Rød</option>
                                          </select>
                                        </label>
                                        <label
                                          className="checkbox-inline select-option-detail-toggle"
                                          htmlFor={`q-select-detail-toggle-${index}-${option}`}
                                        >
                                          <input
                                            id={`q-select-detail-toggle-${index}-${option}`}
                                            type="checkbox"
                                            checked={hasDetail}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'kind',
                                                event.target.checked ? 'input' : 'none',
                                              )
                                            }
                                          />
                                          Utdypning
                                        </label>
                                      </div>
                                      {hasDetail ? (
                                        <label
                                          className="field-block"
                                          htmlFor={`q-select-detail-kind-${index}-${option}`}
                                        >
                                          <span>Type</span>
                                          <select
                                            id={`q-select-detail-kind-${index}-${option}`}
                                            value={optionDetail.kind}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'kind',
                                                event.target.value,
                                              )
                                            }
                                          >
                                            <option value="input">Inputfelt</option>
                                            <option value="message">Beskjed</option>
                                            <option value="camera">Bilde</option>
                                          </select>
                                        </label>
                                      ) : null}
                                      {hasDetail ? (
                                        <label
                                          className="field-block"
                                          htmlFor={`q-select-detail-text-${index}-${option}`}
                                        >
                                          <span>
                                            {optionDetail.kind === 'input'
                                              ? 'Prompt'
                                              : optionDetail.kind === 'camera'
                                                ? 'Beskrivelse'
                                                : 'Beskjed'}
                                          </span>
                                          <input
                                            id={`q-select-detail-text-${index}-${option}`}
                                            type="text"
                                            value={optionDetail.text}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'text',
                                                event.target.value,
                                              )
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      {hasDetail && optionDetail.kind === 'message' ? (
                                        <div className="editor-question-row helptext-style-row">
                                          <label
                                            className="field-block"
                                            htmlFor={`q-select-detail-color-${index}-${option}`}
                                          >
                                            <span>Farge</span>
                                            <input
                                              id={`q-select-detail-color-${index}-${option}`}
                                              type="color"
                                              value={optionDetail.messageColor || '#5f4c3f'}
                                              onChange={(event) =>
                                                onEditorSelectOptionDetailChange(
                                                  index,
                                                  option,
                                                  'messageColor',
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </label>

                                          <label
                                            className="checkbox-inline"
                                            htmlFor={`q-select-detail-bold-${index}-${option}`}
                                          >
                                            <input
                                              id={`q-select-detail-bold-${index}-${option}`}
                                              type="checkbox"
                                              checked={Boolean(optionDetail.messageBold)}
                                              onChange={(event) =>
                                                onEditorSelectOptionDetailChange(
                                                  index,
                                                  option,
                                                  'messageBold',
                                                  event.target.checked,
                                                )
                                              }
                                            />
                                            Beskjed i bold
                                          </label>
                                        </div>
                                      ) : null}
                                    </div>
                                  )
                                })}
                              </div>
                            </>
                          ) : null}

                          {!isSectionQuestion(question) ? (
                            <div className="editor-settings-table">
                              <div className="editor-settings-toggle-row">
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-required-${index}`}
                                >
                                  <input
                                    id={`q-required-${index}`}
                                    type="checkbox"
                                    checked={question.required}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'required', event.target.checked)
                                    }
                                  />
                                  Obligatorisk
                                </label>
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-analysis-${index}`}
                                >
                                  <input
                                    id={`q-analysis-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.includeInAnalysis)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'includeInAnalysis', event.target.checked)
                                    }
                                  />
                                  Inkluder i analyse
                                </label>
                                {question.includeInAnalysis ? (
                                  <label
                                    className="checkbox-inline editor-settings-toggle-cell editor-settings-toggle-cell--sub"
                                    htmlFor={`q-exclude-location-status-${index}`}
                                  >
                                    <input
                                      id={`q-exclude-location-status-${index}`}
                                      type="checkbox"
                                      checked={Boolean(question.excludeFromLocationStatus)}
                                      onChange={(event) =>
                                        onEditorQuestionChange(index, 'excludeFromLocationStatus', event.target.checked)
                                      }
                                    />
                                    Ekskluder fra status per lokasjon
                                  </label>
                                ) : null}
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-review-${index}`}
                                >
                                  <input
                                    id={`q-review-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.includeInReview)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'includeInReview', event.target.checked)
                                    }
                                  />
                                  Skal vurderes
                                </label>
                                {question.includeInReview ? (
                                  <div className="review-type-toggle editor-settings-toggle-cell">
                                    <label className="radio-inline">
                                      <input
                                        type="radio"
                                        name={`q-review-type-${index}`}
                                        value="rating"
                                        checked={(question.reviewType || 'rating') === 'rating'}
                                        onChange={() => onEditorQuestionChange(index, 'reviewType', 'rating')}
                                      />
                                      Rating
                                    </label>
                                    <label className="radio-inline">
                                      <input
                                        type="radio"
                                        name={`q-review-type-${index}`}
                                        value="flagging"
                                        checked={question.reviewType === 'flagging'}
                                        onChange={() => onEditorQuestionChange(index, 'reviewType', 'flagging')}
                                      />
                                      Flaging
                                    </label>
                                  </div>
                                ) : null}
                                {question.includeInReview && (question.reviewType || 'rating') === 'rating' ? (
                                  <label
                                    className="checkbox-inline editor-settings-toggle-cell"
                                    htmlFor={`q-rating-${index}`}
                                  >
                                    <input
                                      id={`q-rating-${index}`}
                                      type="checkbox"
                                      checked={Boolean(question.includeRating)}
                                      onChange={(event) =>
                                        onEditorQuestionChange(index, 'includeRating', event.target.checked)
                                      }
                                    />
                                    Skal rates
                                  </label>
                                ) : null}
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-restock-${index}`}
                                >
                                  <input
                                    id={`q-restock-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.shouldRestock)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'shouldRestock', event.target.checked)
                                    }
                                  />
                                  Skal fylles på
                                </label>
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-ice-production-${index}`}
                                >
                                  <input
                                    id={`q-ice-production-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.isIceProductionCount)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'isIceProductionCount', event.target.checked)
                                    }
                                  />
                                  Antall iskrem (produksjon/time)
                                </label>
                              </div>
                              <div className="editor-settings-detail-row">
                                <div
                                  className={`editor-settings-detail-cell${
                                    question.type === 'location' ? ' editor-settings-detail-empty' : ''
                                  }`}
                                >
                                  {question.type !== 'location' ? (
                                    <div className="question-location-visibility-settings">
                                      <p className="question-location-visibility-title">
                                        Vis kun for lokasjoner
                                      </p>
                                      {loadingLocations ? (
                                        <p className="field-help">Laster lokasjoner...</p>
                                      ) : availableLocationsError ? (
                                        <p className="field-help forms-error">{availableLocationsError}</p>
                                      ) : availableLocations.length > 0 ? (
                                        <div className="question-location-visibility-list">
                                          {availableLocations.map((location) => {
                                            const locationName = String(location.name || '').trim()
                                            if (!locationName) {
                                              return null
                                            }

                                            return (
                                              <label
                                                key={`${question.id}-visible-location-${location.id}`}
                                                className="checkbox-inline question-location-visibility-option"
                                                htmlFor={`q-visible-location-${index}-${location.id}`}
                                              >
                                                <input
                                                  id={`q-visible-location-${index}-${location.id}`}
                                                  type="checkbox"
                                                  checked={normalizeVisibleForLocations(
                                                    question.visibleForLocations,
                                                  ).includes(locationName)}
                                                  onChange={(event) =>
                                                    onEditorQuestionVisibleLocationChange(
                                                      index,
                                                      locationName,
                                                      event.target.checked,
                                                    )
                                                  }
                                                />
                                                {locationName}
                                              </label>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <p className="field-help">
                                          Ingen lokasjoner funnet ennå. Sjekk /lokasjoner.
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="field-help">Lokasjonsspørsmålet vises alltid.</p>
                                  )}
                                </div>
                                <div className="editor-settings-detail-cell">
                                  {question.includeInAnalysis ? (
                                    <div className="editor-settings-detail-stack">
                                      <label
                                        className="field-block analysis-label-field"
                                        htmlFor={`q-analysis-label-${index}`}
                                      >
                                        <span>Kort tekst i analyse</span>
                                        <input
                                          id={`q-analysis-label-${index}`}
                                          type="text"
                                          value={question.analysisLabel || ''}
                                          placeholder={question.label}
                                          onChange={(event) =>
                                            onEditorQuestionChange(index, 'analysisLabel', event.target.value)
                                          }
                                        />
                                      </label>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="editor-settings-detail-cell">
                                  {question.includeInReview ? (
                                    <label
                                      className="field-block"
                                      htmlFor={`q-review-help-${index}`}
                                    >
                                      <span>Info til vurdering</span>
                                      <input
                                        id={`q-review-help-${index}`}
                                        type="text"
                                        value={question.reviewHelpText || ''}
                                        onChange={(event) =>
                                          onEditorQuestionChange(index, 'reviewHelpText', event.target.value)
                                        }
                                      />
                                    </label>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="field-help">
                              Kategorien vises som en overskrift mellom spørsmålsboksene i skjemaet.
                            </p>
                          )}

                          <div className="question-action-row">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => removeQuestion(index)}
                              disabled={editorQuestions.length <= 1}
                            >
                              Fjern spørsmål
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => duplicateQuestion(index)}
                            >
                              Dupliser spørsmål
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => insertQuestionAfter(index)}
                            >
                              Legg til spørsmål under
                            </button>
                            <button
                              type="button"
                              className="cta save-question-button"
                              onClick={() => onSaveForm(index)}
                              disabled={saveState.saving}
                            >
                              {saveState.saving ? 'Saving...' : 'Lagre spørsmål'}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => moveQuestion(index, 'up')}
                              disabled={index === 0}
                            >
                              Opp
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => moveQuestion(index, 'down')}
                              disabled={index === editorQuestions.length - 1}
                            >
                              Ned
                            </button>
                            <label className="field-block" htmlFor={`q-move-target-${index}`}>
                              <input
                                id={`q-move-target-${index}`}
                                type="number"
                                min="1"
                                max={editorQuestions.length}
                                inputMode="numeric"
                                placeholder={`Flytt til spørsmål (1-${editorQuestions.length})`}
                                value={question.moveTarget || ''}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'moveTarget', event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') {
                                    return
                                  }
                                  event.preventDefault()
                                  moveQuestionToNumber(index, question.moveTarget)
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => moveQuestionToNumber(index, question.moveTarget)}
                              disabled={!String(question.moveTarget || '').trim()}
                            >
                              Flytt
                            </button>
                          </div>
                        </div>

                        <aside className="editor-question-sidebar">
                          {question.imagePreviewUrl ? (
                            <div className="question-image-preview editor-question-preview-panel">
                              {renderQuestionImage(
                                question.imagePreviewUrl,
                                question.label,
                                question.imageZoom,
                                true,
                              )}
                              <label
                                className="field-block image-zoom-field"
                                htmlFor={`q-image-zoom-${index}`}
                              >
                                <span>Bildezoom ({normalizeImageZoom(question.imageZoom).toFixed(2)}x)</span>
                                <input
                                  id={`q-image-zoom-${index}`}
                                  type="range"
                                  min="0.5"
                                  max="2.5"
                                  step="0.05"
                                  value={normalizeImageZoom(question.imageZoom)}
                                  onChange={(event) =>
                                    onEditorQuestionChange(index, 'imageZoom', event.target.value)
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => removeEditorQuestionImage(index)}
                              >
                                Fjern bilde
                              </button>
                            </div>
                          ) : (
                            <div className="editor-question-preview-panel editor-question-preview-empty">
                              <p className="field-help">
                                {isSectionQuestion(question)
                                  ? 'Ingen bilde valgt for denne kategorien.'
                                  : 'Ingen bilde valgt for dette spørsmålet.'}
                              </p>
                            </div>
                          )}
                        </aside>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="admin-actions">
                  <button type="button" className="ghost" onClick={addQuestion}>
                    Legg til spørsmål
                  </button>
                  <button type="button" className="ghost" onClick={addSection}>
                    Legg til kategori
                  </button>
                </div>
                </>
                ) : (
                  renderEditorQuestionSummaryList()
                )}

                {saveState.error ? <p className="forms-error">{saveState.error}</p> : null}
                {saveState.message ? <p className="forms-success">{saveState.message}</p> : null}
              </div>
            ) : null}

            {isSubmissionsView ? (
              <div className="responses-box submissions-overview" id="submissions-section">
                <div className="submissions-section-header">
                  <h3>Submissions</h3>
                  <div className="submissions-section-actions">
                    <input
                      type="email"
                      className="submissions-test-email-input"
                      value={testEmailRecipient}
                      onChange={(e) => setTestEmailRecipient(e.target.value)}
                      placeholder="test@epost.no"
                    />
                    <button
                      type="button"
                      className="submissions-action-button"
                      onClick={onSendTestReviewEmail}
                      disabled={testEmailState.sending}
                    >
                      {testEmailState.sending ? 'Sending…' : 'Send test email'}
                    </button>
                    <button
                      type="button"
                      className="submissions-action-button"
                      onClick={onSendTestRejectionEmail}
                      disabled={testEmailState.sending}
                    >
                      {testEmailState.sending ? 'Sending…' : 'Send test rejection email'}
                    </button>
                    {testEmailState.message ? (
                      <span className="test-email-feedback test-email-feedback--ok">{testEmailState.message}</span>
                    ) : null}
                    {testEmailState.error ? (
                      <span className="test-email-feedback test-email-feedback--error">{testEmailState.error}</span>
                    ) : null}
                  </div>
                </div>
                {loadingSubmissions ? <p>Loading submissions...</p> : null}
                {!loadingSubmissions && reviewedSubmissionMonthlyStats.length > 0 ? (() => {
                  const currentMonthKey = getSubmissionMonthKey(new Date())
                  const thisMonth = reviewedSubmissionMonthlyStats.find((m) => m.monthKey === currentMonthKey)
                  const pastMonths = reviewedSubmissionMonthlyStats.filter((m) => m.monthKey !== currentMonthKey)
                  return (
                    <div className="reviewed-monthly-summary">
                      <div className="reviewed-monthly-this-month">
                        <span>
                          Reviewed this month: <strong>{thisMonth?.reviewedCount ?? 0}</strong>
                          {thisMonth?.flaggedCount > 0 ? <span className="reviewed-monthly-flagged-note"> ({thisMonth.flaggedCount} flagged)</span> : null}
                        </span>
                        {missingReviewsByDay.map(([dayKey, count]) => {
                          const todayKey = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' })
                          const isToday = dayKey === todayKey
                          return isToday ? (
                            <span key={dayKey} className="reviewed-monthly-ready">
                              {count} submission{count !== 1 ? 's' : ''} ready to review
                            </span>
                          ) : (
                            <span key={dayKey} className="reviewed-monthly-missing">
                              ⚠ {count} missing review{count !== 1 ? 's' : ''} for {formatSubmissionDayLabel(dayKey)}
                            </span>
                          )
                        })}
                        {pastMonths.length > 0 ? (
                          <button
                            type="button"
                            className="submissions-action-button submissions-action-button--small"
                            onClick={() => setShowPastMonths((v) => !v)}
                          >
                            {showPastMonths ? 'Hide past months' : 'Past months'}
                          </button>
                        ) : null}
                      </div>
                      {showPastMonths && pastMonths.length > 0 ? (
                        <div className="reviewed-monthly-past-popup">
                          {pastMonths.map((month) => (
                            <div key={month.monthKey} className="reviewed-monthly-past-row">
                              <span>{formatSubmissionMonthLabel(month.monthKey)}</span>
                              <span><strong>{month.reviewedCount}</strong> reviewed{month.flaggedCount > 0 ? `, ${month.flaggedCount} flagged` : ''}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })() : null}
                {!loadingSubmissions && availableSubmissionDays.length > 0 ? (
                  <div className="submissions-filter-bar">
                    <label className="field-block" htmlFor="submission-day-filter">
                      <span>Day</span>
                      <select
                        id="submission-day-filter"
                        value={effectiveSubmissionDay}
                        onChange={(event) => setSelectedSubmissionDay(event.target.value)}
                      >
                        {availableSubmissionDays.map((dayKey) => (
                          <option key={dayKey} value={dayKey}>
                            {formatSubmissionDayLabel(dayKey)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="submissions-action-button"
                      onClick={() => {
                        setShowTimingIssues(true)
                        setTimingIssuesFetching(true)
                        fetchLastPhotoMeta(submissions, () => setTimingIssuesFetching(false))
                      }}
                    >
                      Check timing
                    </button>
                  </div>
                ) : null}

                {showTimingIssues ? (
                  <div
                    className="submission-modal-backdrop"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setShowTimingIssues(false)}
                  >
                    <div
                      className="submission-modal timing-issues-modal"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="submission-modal-header">
                        <h4>Timing issues (&gt;5 min difference)</h4>
                        <button type="button" className="ghost" onClick={() => setShowTimingIssues(false)}>Close</button>
                      </div>
                      <div className="submission-modal-content">
                        {timingIssuesFetching ? (
                          <p style={{color:'var(--muted)'}}>Fetching photo times…</p>
                        ) : (() => {
                          const FIVE_MIN = 5 * 60 * 1000
                          const issues = submissions.filter((s) => {
                            const submittedMs = s.submittedAt?.seconds
                              ? s.submittedAt.seconds * 1000
                              : s.submittedAt instanceof Date ? s.submittedAt.getTime() : null
                            const photoMs = submissionLastPhotoMeta[s.id]?.ms
                            if (!submittedMs || !photoMs) return false
                            return Math.abs(submittedMs - photoMs) > FIVE_MIN
                          })
                          if (issues.length === 0) return <p>No timing issues found.</p>
                          return (
                            <table className="submissions-table timing-issues-table">
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Submitted</th>
                                  <th>Last photo</th>
                                  <th>Diff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {issues.map((s) => {
                                  const submittedMs = s.submittedAt?.seconds
                                    ? s.submittedAt.seconds * 1000
                                    : s.submittedAt instanceof Date ? s.submittedAt.getTime() : 0
                                  const photoMs = submissionLastPhotoMeta[s.id]?.ms || 0
                                  const diffMin = Math.round(Math.abs(submittedMs - photoMs) / 60000)
                                  const fmtOpts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }
                                  return (
                                    <tr key={s.id}>
                                      <td>
                                        <div>{getSubmissionName(s.answers, formData.questions) || '—'}</div>
                                        <small style={{color:'var(--muted)'}}>{getSubmissionLocation(s.answers, formData.questions)}</small>
                                      </td>
                                      <td>{new Date(submittedMs).toLocaleString('en-GB', fmtOpts)}</td>
                                      <td>{submissionLastPhotoMeta[s.id]?.display || '—'}</td>
                                      <td><strong>{diffMin} min</strong></td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                ) : null}
                {!loadingSubmissions && submissions.length === 0 ? (
                  <p>No submissions yet.</p>
                ) : null}
                {!loadingSubmissions && submissions.length > 0 && visibleSubmissions.length === 0 ? (
                  <p>No submissions for the selected day.</p>
                ) : null}
                {!loadingSubmissions && visibleSubmissions.length > 0 ? (
                  <div className="submissions-table-wrap">
                    <table className="submissions-table">
                      <thead>
                        <tr>
                          <th>Submitted</th>
                          <th>Last photo taken</th>
                          <th>Location</th>
                          <th>Phone</th>
                          <th>Receipt</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSubmissions.map((submission) => {
                          const deleteState = deleteSubmissionState[submission.id] || {}
                          const flaggedCount = Array.isArray(submission.flaggedAnswers)
                            ? submission.flaggedAnswers.length
                            : 0

                          return (
                            <tr key={submission.id}>
                              <td>
                                <strong>{getClockPart(submission.submittedAt)}</strong>
                                <br />
                                <small>
                                  {formatSubmissionDayLabel(
                                    getSubmissionDayKey(submission.submittedAt),
                                  )}
                                </small>
                              </td>
                              <td>
                                {(() => {
                                  const meta = submissionLastPhotoMeta[submission.id]
                                  if (meta?.ms) {
                                    const submittedMs = submission.submittedAt?.seconds
                                      ? submission.submittedAt.seconds * 1000
                                      : submission.submittedAt instanceof Date ? submission.submittedAt.getTime() : null
                                    const isLate = submittedMs && Math.abs(submittedMs - meta.ms) > 5 * 60 * 1000
                                    const d = new Date(meta.ms)
                                    const time = d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
                                    const date = d.toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })
                                    return (
                                      <span style={isLate ? { color: 'var(--accent)', fontWeight: 700 } : undefined}>
                                        {time}<br /><small>{date}</small>
                                      </span>
                                    )
                                  }
                                  if (meta === null) return <span style={{color:'var(--muted)'}}>—</span>
                                  const hasPaths = Object.values(submission.answers || {}).some((v) => isStorageImagePath(v))
                                  return hasPaths
                                    ? <span style={{color:'var(--muted)'}}>…</span>
                                    : <span style={{color:'var(--muted)'}}>—</span>
                                })()}
                              </td>
                              <td>{getSubmissionLocation(submission.answers, formData.questions)}</td>
                              <td>
                                {editPhoneSubmissionId === submission.id ? (
                                  <div className="phone-edit-row">
                                    <input
                                      type="tel"
                                      className="phone-edit-input"
                                      value={editPhoneDraft}
                                      autoFocus
                                      onChange={(e) => setEditPhoneDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') onSavePhoneEdit(submission.id)
                                        if (e.key === 'Escape') setEditPhoneSubmissionId('')
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="ghost"
                                      disabled={editPhoneState.saving}
                                      onClick={() => onSavePhoneEdit(submission.id)}
                                    >
                                      {editPhoneState.saving ? '…' : '✓'}
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => setEditPhoneSubmissionId('')}
                                    >
                                      ✕
                                    </button>
                                    {editPhoneState.error ? (
                                      <small className="forms-error">{editPhoneState.error}</small>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="phone-edit-row">
                                    <span>{getSubmissionPhone(submission.answers, formData.questions) || '—'}</span>
                                    <button
                                      type="button"
                                      className="ghost phone-edit-trigger"
                                      title="Edit phone number"
                                      onClick={() => {
                                        setEditPhoneSubmissionId(submission.id)
                                        setEditPhoneDraft(getSubmissionPhone(submission.answers, formData.questions) || '')
                                        setEditPhoneState({ saving: false, error: '' })
                                      }}
                                    >
                                      ✏
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td>
                                {submission.receiptToken ? (
                                  <a
                                    className="ghost"
                                    href={`/skjema/${activeFormSlug}/kvittering/${submission.receiptToken}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View receipt
                                  </a>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td>
                                <div className="submission-status-row">
                                  <span
                                    className={`submission-status-badge is-${String(
                                      submission.status || 'awaiting-review',
                                    )
                                      .replace(/\s+/g, '-')
                                      .toLowerCase()}`}
                                  >
                                    {getSubmissionStatusLabel(submission.status)}
                                  </span>
                                  {flaggedCount > 0 ? (
                                    <span className="submission-status-badge is-flagged">
                                      Flaged
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div className="submission-table-actions">
                                  <a
                                    className="ghost"
                                    href={`/skjema/${activeFormSlug}/review/${submission.id}`}
                                  >
                                    Review
                                  </a>
                                  <button
                                    type="button"
                                    className="ghost danger-button"
                                    onClick={() => onDeleteSubmission(submission.id)}
                                    disabled={deleteState.deleting}
                                  >
                                    {deleteState.deleting ? 'Deleting...' : 'Delete'}
                                  </button>
                                  {deleteState.error ? (
                                    <small className="forms-error">{deleteState.error}</small>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

              </div>
            ) : null}

            {isSubmissionsView && isAdmin && (submissionErrors.length > 0 || loadingErrors) ? (
              <div className="responses-box submissions-overview">
                <h3>Innsendingsfeil</h3>
                {loadingErrors ? <p>Loading...</p> : null}
                {!loadingErrors && submissionErrors.length > 0 ? (
                  <table className="submissions-table" style={{ fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        <th>Tidspunkt</th>
                        <th>Feilkode</th>
                        <th>Melding</th>
                        <th>Enhet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissionErrors.map((e) => {
                        const d = e.occurredAt?.toDate?.()
                        const time = d ? d.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' }) : '—'
                        const ua = String(e.userAgent || '').slice(0, 60)
                        return (
                          <tr key={e.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{time}</td>
                            <td><code>{e.errorCode}</code></td>
                            <td style={{ maxWidth: 260, wordBreak: 'break-word' }}>{e.errorMessage}</td>
                            <td style={{ color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.userAgent}>{ua}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ) : null}

            {isSubmissionsView && isAdmin && !loadingSubmissions ? (() => {
              const cutoff = Date.now() - 24 * 60 * 60 * 1000
              const june17Ts = new Date('2026-06-17T00:00:00+02:00').getTime()
              const pending = submissions.filter((sub) => {
                if (sub.status !== 'reviewed' || sub.rejected || sub.feedbackReadConfirmed || sub.followUpDone) return false
                const neutral = sub.reviewScoreSummary?.neutral || 0
                const sad = sub.reviewScoreSummary?.sad || 0
                if (neutral === 0 && sad === 0 && !sub.generalFeedback) return false
                const reviewedTs = sub.reviewedAt?.seconds
                  ? sub.reviewedAt.seconds * 1000
                  : sub.reviewedAt instanceof Date
                    ? sub.reviewedAt.getTime()
                    : null
                return reviewedTs && reviewedTs < cutoff && reviewedTs >= june17Ts
              })
              if (pending.length === 0) return null
              return (
                <div className="responses-box submissions-overview">
                  <h3>Feedback not confirmed read ({pending.length})</h3>
                  <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'rgba(24,44,60,0.55)' }}>
                    These forms were reviewed more than 24 hours ago without the employee confirming they have read the feedback.
                  </p>
                  <table className="submissions-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Reviewed</th>
                        <th>Score</th>
                        <th>General feedback</th>
                        <th>Receipt</th>
                        <th>Register follow-up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((sub) => {
                        const reviewedAt = sub.reviewedAt?.seconds
                          ? new Date(sub.reviewedAt.seconds * 1000)
                          : sub.reviewedAt instanceof Date ? sub.reviewedAt : null
                        const timeStr = reviewedAt
                          ? reviewedAt.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' })
                          : '—'
                        return (
                          <tr key={sub.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{timeStr}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {(sub.reviewScoreSummary?.happy || 0) > 0 ? <><FaceHappy size={14} /> {sub.reviewScoreSummary.happy} </> : null}
                              {(sub.reviewScoreSummary?.neutral || 0) > 0 ? <><FaceNeutral size={14} /> {sub.reviewScoreSummary.neutral} </> : null}
                              {(sub.reviewScoreSummary?.sad || 0) > 0 ? <><FaceSad size={14} /> {sub.reviewScoreSummary.sad}</> : null}
                            </td>
                            <td style={{ maxWidth: 220, color: 'rgba(24,44,60,0.7)' }}>{sub.generalFeedback || '—'}</td>
                            <td>
                              {sub.receiptToken ? (
                                <a
                                  href={`/skjema/${activeFormSlug}/kvittering/${sub.receiptToken}`}
                                  className="ghost"
                                  style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Åpne
                                </a>
                              ) : '—'}
                            </td>
                            <td style={{ minWidth: 200 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <textarea
                                  rows={2}
                                  style={{ fontSize: '0.8rem', width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(24,44,60,0.18)', resize: 'vertical', fontFamily: 'inherit' }}
                                  placeholder="What was done?"
                                  value={followUpDrafts[sub.id] || ''}
                                  onChange={(e) => setFollowUpDrafts((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                                />
                                <button
                                  type="button"
                                  className="ghost"
                                  style={{ fontSize: '0.8rem', alignSelf: 'flex-start' }}
                                  disabled={followUpSavingId === sub.id}
                                  onClick={async () => {
                                    setFollowUpSavingId(sub.id)
                                    const note = followUpDrafts[sub.id]?.trim() || ''
                                    try {
                                      await updateDoc(doc(db, 'formSubmissions', sub.id), {
                                        followUpDone: true,
                                        followUpDoneAt: serverTimestamp(),
                                        followUpDoneBy: user?.email || 'admin',
                                        followUpNote: note,
                                      })
                                      setSubmissions((prev) => prev.map((s) => s.id === sub.id ? {
                                        ...s,
                                        followUpDone: true,
                                        followUpDoneBy: user?.email || 'admin',
                                        followUpNote: note,
                                      } : s))
                                    } catch {}
                                    setFollowUpSavingId('')
                                  }}
                                >
                                  {followUpSavingId === sub.id ? 'Saving...' : 'Mark follow-up done'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })() : null}

            {isSubmissionsView && isAdmin && !loadingSubmissions ? (() => {
              const june17Ts2 = new Date('2026-06-17T00:00:00+02:00').getTime()
              const followedUp = submissions.filter((sub) => {
                if (!sub.followUpDone) return false
                const neutral = sub.reviewScoreSummary?.neutral || 0
                const sad = sub.reviewScoreSummary?.sad || 0
                if (neutral === 0 && sad === 0 && !sub.generalFeedback) return false
                const doneTs = sub.followUpDoneAt?.seconds
                  ? sub.followUpDoneAt.seconds * 1000
                  : null
                return doneTs && doneTs >= june17Ts2
              }).sort((a, b) => (b.followUpDoneAt?.seconds || 0) - (a.followUpDoneAt?.seconds || 0))
              if (followedUp.length === 0) return null
              return (
                <div className="responses-box submissions-overview">
                  <h3>Follow-up registered ({followedUp.length})</h3>
                  <table className="submissions-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Reviewed</th>
                        <th>Score</th>
                        <th>Follow-up note</th>
                        <th>Followed up by</th>
                        <th>Staff confirmed</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {followedUp.map((sub) => {
                        const reviewedAt = sub.reviewedAt?.seconds ? new Date(sub.reviewedAt.seconds * 1000) : null
                        const doneAt = sub.followUpDoneAt?.seconds ? new Date(sub.followUpDoneAt.seconds * 1000) : null
                        const readAt = sub.feedbackReadAt?.seconds ? new Date(sub.feedbackReadAt.seconds * 1000) : null
                        const fmt = (d) => d ? d.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' }) : '—'
                        const flaggedItems = (sub.flaggedAnswers || [])
                        return (
                          <tr key={sub.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmt(reviewedAt)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {(sub.reviewScoreSummary?.happy || 0) > 0 ? <><FaceHappy size={14} /> {sub.reviewScoreSummary.happy} </> : null}
                              {(sub.reviewScoreSummary?.neutral || 0) > 0 ? <><FaceNeutral size={14} /> {sub.reviewScoreSummary.neutral} </> : null}
                              {(sub.reviewScoreSummary?.sad || 0) > 0 ? <><FaceSad size={14} /> {sub.reviewScoreSummary.sad}</> : null}
                            </td>
                            <td style={{ maxWidth: 280 }}>
                              {sub.followUpNote ? (
                                <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap', color: 'rgba(24,44,60,0.85)' }}>{sub.followUpNote}</p>
                              ) : <span style={{ color: 'rgba(24,44,60,0.35)' }}>—</span>}
                              {sub.generalFeedback ? (
                                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#1e3a5f', background: '#f0f4ff', borderLeft: '3px solid #3b82f6', padding: '4px 8px', borderRadius: '0 4px 4px 0' }}>
                                  <strong>General:</strong> {sub.generalFeedback}
                                </p>
                              ) : null}
                              {flaggedItems.map((a, i) => {
                                const isSad = a.reviewStatus === 'flagged_sad'
                                return (
                                  <p key={i} style={{ margin: '4px 0 0', fontSize: '0.78rem', color: isSad ? '#7f1d1d' : '#78350f', background: isSad ? '#fef2f2' : '#fffbeb', borderLeft: `3px solid ${isSad ? '#dc2626' : '#d97706'}`, padding: '4px 8px', borderRadius: '0 4px 4px 0' }}>
                                    {isSad ? <FaceSad size={12} /> : <FaceNeutral size={12} />}{' '}
                                    <strong>{a.label || a.answerKey}</strong>
                                    {a.comment ? <> — {a.comment}</> : null}
                                  </p>
                                )
                              })}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ fontSize: '0.8rem' }}>{sub.followUpDoneBy || '—'}</div>
                              <div style={{ fontSize: '0.75rem', color: 'rgba(24,44,60,0.45)' }}>{fmt(doneAt)}</div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', color: readAt ? '#16a34a' : 'rgba(24,44,60,0.4)' }}>
                              {readAt ? fmt(readAt) : 'Not confirmed'}
                            </td>
                            <td>
                              {sub.receiptToken ? (
                                <a href={`/skjema/${activeFormSlug}/kvittering/${sub.receiptToken}`} className="ghost" style={{ fontSize: '0.8rem', padding: '2px 8px' }} target="_blank" rel="noreferrer">Open</a>
                              ) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })() : null}

            {isSubmissionsView && isAdmin && !loadingSubmissions ? (() => {
              const windowMs = confirmedFeedbackDays * 24 * 60 * 60 * 1000
              const cutoffTs = Date.now() - windowMs
              const confirmed = submissions.filter((sub) => {
                if (!sub.feedbackReadConfirmed) return false
                const neutral = sub.reviewScoreSummary?.neutral || 0
                const sad = sub.reviewScoreSummary?.sad || 0
                if (neutral === 0 && sad === 0 && !sub.generalFeedback) return false
                const readTs = sub.feedbackReadAt?.seconds
                  ? sub.feedbackReadAt.seconds * 1000
                  : sub.reviewedAt?.seconds
                    ? sub.reviewedAt.seconds * 1000
                    : null
                return readTs && readTs >= cutoffTs
              }).sort((a, b) => {
                const aTs = (a.feedbackReadAt?.seconds || a.reviewedAt?.seconds || 0)
                const bTs = (b.feedbackReadAt?.seconds || b.reviewedAt?.seconds || 0)
                return bTs - aTs
              })
              if (confirmed.length === 0) return null
              return (
                <div className="responses-box submissions-overview">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    <h3 style={{ margin: 0 }}>Tilbakemelding bekreftet lest ({confirmed.length})</h3>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[3, 7, 30].map((d) => (
                        <button
                          key={d}
                          type="button"
                          className="ghost"
                          style={{ fontSize: '0.78rem', padding: '2px 10px', fontWeight: confirmedFeedbackDays === d ? 700 : 400, opacity: confirmedFeedbackDays === d ? 1 : 0.55 }}
                          onClick={() => setConfirmedFeedbackDays(d)}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <table className="submissions-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Bekreftet lest</th>
                        <th>Score</th>
                        <th>General feedback</th>
                        <th>Kvittering</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmed.map((sub) => {
                        const readAt = sub.feedbackReadAt?.seconds
                          ? new Date(sub.feedbackReadAt.seconds * 1000)
                          : sub.reviewedAt?.seconds
                            ? new Date(sub.reviewedAt.seconds * 1000)
                            : null
                        const timeStr = readAt
                          ? readAt.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' })
                          : '—'
                        return (
                          <tr key={sub.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{timeStr}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {(sub.reviewScoreSummary?.happy || 0) > 0 ? <><FaceHappy size={14} /> {sub.reviewScoreSummary.happy} </> : null}
                              {(sub.reviewScoreSummary?.neutral || 0) > 0 ? <><FaceNeutral size={14} /> {sub.reviewScoreSummary.neutral} </> : null}
                              {(sub.reviewScoreSummary?.sad || 0) > 0 ? <><FaceSad size={14} /> {sub.reviewScoreSummary.sad}</> : null}
                            </td>
                            <td style={{ maxWidth: 220, color: 'rgba(24,44,60,0.7)' }}>{sub.generalFeedback || '—'}</td>
                            <td>
                              {sub.receiptToken ? (
                                <a
                                  href={`/skjema/${activeFormSlug}/kvittering/${sub.receiptToken}`}
                                  className="ghost"
                                  style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open
                                </a>
                              ) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })() : null}

            {isFlaggedView ? (
              <div className="responses-box submissions-overview" id="flagged-section">
                <h3>Flagget &amp; vurdert</h3>
                {loadingSubmissions ? <p>Loading...</p> : null}
                {!loadingSubmissions && flaggedSubmissions.length === 0 ? (
                  <p>Ingen flaggede eller vurderte svar ennå.</p>
                ) : null}
                {!loadingSubmissions && flaggedSubmissions.length > 0 && openFlaggedSubmissions.length === 0 ? (
                  <p className="flagged-empty-note">Ingen venter oppfølging. Alle saker er ferdig vurdert.</p>
                ) : null}
                {!loadingSubmissions && flaggedSubmissions.length > 0 ? (
                  <div className="flagged-submission-list">
                    {openFlaggedSubmissions.map((submission) => renderFlaggedSubmissionCard(submission))}
                  </div>
                ) : null}
                {!loadingSubmissions && flaggedSubmissions.length > 0 ? (
                  <div className="flagged-history-search">
                    <div className="flagged-history-search-header">
                      <h4>Søk i flagg-historikk</h4>
                      <p>Velg fra- og til-dato for å vise både open og complete flaggede saker.</p>
                    </div>
                    <div className="flagged-history-date-row">
                      <label className="field-block" htmlFor="flagged-history-from">
                        <span>Fra dato</span>
                        <input
                          id="flagged-history-from"
                          type="date"
                          value={flaggedHistoryDateFrom}
                          onChange={(event) => setFlaggedHistoryDateFrom(event.target.value)}
                        />
                      </label>
                      <label className="field-block" htmlFor="flagged-history-to">
                        <span>Til dato</span>
                        <input
                          id="flagged-history-to"
                          type="date"
                          value={flaggedHistoryDateTo}
                          onChange={(event) => setFlaggedHistoryDateTo(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setFlaggedHistoryDateFrom('')
                          setFlaggedHistoryDateTo('')
                        }}
                        disabled={!hasFlaggedHistoryDateSearch}
                      >
                        Nullstill
                      </button>
                    </div>
                    {hasFlaggedHistoryDateSearch && flaggedHistorySubmissions.length === 0 ? (
                      <p className="flagged-empty-note">Ingen flaggede saker funnet for valgt dato.</p>
                    ) : null}
                    {hasFlaggedHistoryDateSearch && flaggedHistorySubmissions.length > 0 ? (
                      <div className="flagged-submission-list">
                        {flaggedHistorySubmissions.map((submission) => renderFlaggedSubmissionCard(submission))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isRatingView ? (
              <div className="responses-box rating-overview" id="rating-section">
                <h3>Rating</h3>
                {loadingSubmissions ? <p>Loading...</p> : null}
                {!loadingSubmissions && userScoreboard.length === 0 ? (
                  <p>Ingen vurderte innsendinger ennå.</p>
                ) : null}
                {!loadingSubmissions && userScoreboard.length > 0 ? (
                  <div className="user-scoreboard-table-wrap">
                    <table className="user-scoreboard-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Navn</th>
                          <th>Innsendinger</th>
                          <th>Vurdert</th>
                          <th title="Godkjent"><FaceHappy size={18} /></th>
                          <th title="Kan bli bedre"><FaceNeutral size={18} /></th>
                          <th title="Ikke bra"><FaceSad size={18} /></th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userScoreboard.map((row, index) => (
                          <tr key={row.name} className={index === 0 && row.score !== null ? 'user-scoreboard-top' : ''}>
                            <td className="user-scoreboard-rank">{index + 1}</td>
                            <td className="user-scoreboard-name">{row.name}</td>
                            <td className="user-scoreboard-total">{row.totalSubmissions}</td>
                            <td className="user-scoreboard-reviewed">{row.totalReviewed}</td>
                            <td className="user-scoreboard-happy">{row.happy}</td>
                            <td className="user-scoreboard-neutral">{row.neutral}</td>
                            <td className="user-scoreboard-sad">{row.sad}</td>
                            <td className="user-scoreboard-score">
                              {row.score !== null ? (
                                <span className={`score-badge ${
                                  row.score >= 80 ? 'score-high' :
                                  row.score >= 50 ? 'score-mid' : 'score-low'
                                }`}>
                                  {row.score}%
                                </span>
                              ) : (
                                <span className="score-badge score-none">–</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isHistoryView ? (
              <div className="history-overview" id="history-section">
                <div className="history-header">
                  <div className="history-title-block">
                    <h3>Varebeholdning</h3>
                    <p className="history-legend">
                      <strong>Oransje:</strong> Bestill opp mer.{' '}
                      <strong>Rød:</strong> Nesten helt tomt.
                    </p>
                  </div>
                  <div className="history-controls">
                    <label className="field-block history-days-field history-days-inline" htmlFor="history-submission-limit">
                      <span>Vis siste innsendinger</span>
                      <input
                        id="history-submission-limit"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={historySubmissionLimit}
                        onChange={(event) => setHistorySubmissionLimit(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost"
                      onClick={onSaveHistoryDefault}
                      disabled={historyDefaultState.saving}
                    >
                      {historyDefaultState.saving ? 'Saving...' : 'Lagre default'}
                    </button>
                    {historyRows.length > 0 ? (
                      <div className="history-filter-bar">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setHistoryLocationFilterOpen((previous) => !previous)}
                          aria-expanded={historyLocationFilterOpen}
                          aria-controls="history-location-filter"
                        >
                          Filtrer lokasjoner
                          {!historyShowAllLocations && selectedHistoryLocations.length > 0
                            ? ` (${selectedHistoryLocations.length})`
                            : ''}
                        </button>
                        {historyLocationFilterOpen ? (
                          <div className="history-filter-panel" id="history-location-filter">
                            <div className="history-filter-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllLocations(true)
                                  setSelectedHistoryLocations([])
                                }}
                              >
                                Vis alle
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllLocations(false)
                                  setSelectedHistoryLocations([])
                                }}
                              >
                                Fjern alle
                              </button>
                            </div>
                            {historyRows.map((row) => (
                              <label
                                key={`history-location-filter-${row.location}`}
                                className="checkbox-inline history-filter-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    historyShowAllLocations ||
                                    selectedHistoryLocations.includes(row.location)
                                  }
                                  onChange={(event) => {
                                    setSelectedHistoryLocations((previous) => {
                                      const allLocations = historyRows.map((item) => item.location)
                                      const base = historyShowAllLocations ? allLocations : previous

                                      if (event.target.checked) {
                                        const next = base.includes(row.location)
                                          ? base
                                          : [...base, row.location]
                                        setHistoryShowAllLocations(next.length === allLocations.length)
                                        return next
                                      }

                                      const next = base.filter((location) => location !== row.location)
                                      setHistoryShowAllLocations(false)
                                      return next
                                    })
                                  }}
                                />
                                {row.location}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {analysisQuestions.length > 0 ? (
                      <div className="history-filter-bar">
                        <div className="history-filter-top-row">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setHistoryQuestionFilterOpen((previous) => !previous)}
                            aria-expanded={historyQuestionFilterOpen}
                            aria-controls="history-question-filter"
                          >
                            Filtrer spørsmål
                            {!historyShowAllQuestions && selectedHistoryQuestionIds.length > 0
                              ? ` (${selectedHistoryQuestionIds.length})`
                              : ''}
                          </button>
                          <label className="checkbox-inline analyse-hide-updated-label">
                            <input
                              type="checkbox"
                              checked={hideUpdatedValues}
                              onChange={(e) => setHideUpdatedValues(e.target.checked)}
                            />
                            Skjul oppdaterte verdier
                          </label>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setAnalyseEmailOpen((prev) => !prev)
                              setAnalyseEmailState({ sending: false, error: '', message: '' })
                            }}
                          >
                            ✉ Send oversikt på epost
                          </button>
                        </div>
                        {analyseEmailOpen ? (
                          <form className="analyse-email-form" onSubmit={onSendAnalyseEmail}>
                            <input
                              type="email"
                              className="analyse-email-input"
                              value={analyseEmailRecipient}
                              onChange={(e) => setAnalyseEmailRecipient(e.target.value)}
                              placeholder="epost@eksempel.no"
                              autoFocus
                            />
                            <button
                              type="submit"
                              className="ghost"
                              disabled={analyseEmailState.sending || !analyseEmailRecipient.trim()}
                            >
                              {analyseEmailState.sending ? 'Sender...' : 'Send'}
                            </button>
                            {analyseEmailState.message ? (
                              <span className="history-alert-msg">{analyseEmailState.message}</span>
                            ) : null}
                            {analyseEmailState.error ? (
                              <span className="forms-error">{analyseEmailState.error}</span>
                            ) : null}
                          </form>
                        ) : null}
                        {historyQuestionFilterOpen ? (
                          <div className="history-filter-panel" id="history-question-filter">
                            <div className="history-filter-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllQuestions(true)
                                  setSelectedHistoryQuestionIds([])
                                }}
                              >
                                Vis alle
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllQuestions(false)
                                  setSelectedHistoryQuestionIds([])
                                }}
                              >
                                Fjern alle
                              </button>
                            </div>
                            {analysisQuestions.map((question) => (
                              <label
                                key={`history-filter-${question.id}`}
                                className="checkbox-inline history-filter-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    historyShowAllQuestions ||
                                    selectedHistoryQuestionIds.includes(question.id)
                                  }
                                  onChange={(event) => {
                                    setSelectedHistoryQuestionIds((previous) => {
                                      const allIds = analysisQuestions.map((item) => item.id)
                                      const base = historyShowAllQuestions ? allIds : previous

                                      if (event.target.checked) {
                                        const next = base.includes(question.id)
                                          ? base
                                          : [...base, question.id]
                                        setHistoryShowAllQuestions(next.length === allIds.length)
                                        return next
                                      }

                                      const next = base.filter((questionId) => questionId !== question.id)
                                      setHistoryShowAllQuestions(false)
                                      return next
                                    })
                                  }}
                                />
                                {question.analysisLabel || question.label}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                {historyDefaultState.error ? <p className="forms-error">{historyDefaultState.error}</p> : null}
                {historyDefaultState.message ? <p className="forms-success">{historyDefaultState.message}</p> : null}

                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length > 0 ? (() => {
                  const alertRows = historyRows.map((row) => {
                    const latest = row.items[0]
                    if (!latest) return null
                    const locationUpdate = inventoryUpdates[row.location]
                    const items = analysisQuestions.flatMap((q) => {
                      if (q.excludeFromLocationStatus) return []
                      const updatedValue = getEffectiveInventoryValue(q.id, locationUpdate, latest.submittedAt)
                      if (!updatedValue && hasAnalysisRefillAction(latest, q.id)) return []
                      const value = updatedValue || String(latest.answers?.[q.id] || '').trim()
                      if (!value) return []
                      const category = getSelectOptionBehavior(q, value).historyCategory
                      if (category !== 'orange' && category !== 'red') return []
                      return [{ label: (q.analysisLabel || q.label || q.id).trim(), value, category, isUpdated: Boolean(updatedValue) }]
                    })
                    const incidentNotes = analysisQuestions.flatMap((q) => {
                      if (q.type !== 'text' && q.type !== 'textarea') return []
                      if (q.excludeFromLocationStatus) return []
                      const value = String(latest.answers?.[q.id] || '').trim()
                      if (!value) return []
                      return [{ label: (q.analysisLabel || q.label || q.id).trim(), value }]
                    })
                    if (items.length === 0 && incidentNotes.length === 0) return null
                    const sortedItems = [...items].sort((a, b) =>
                      (a.category === 'red' ? 0 : 1) - (b.category === 'red' ? 0 : 1)
                    )
                    return { location: row.location, items: sortedItems, incidentNotes }
                  }).filter(Boolean).sort((a, b) => {
                    const aRed = a.items.some((i) => i.category === 'red') ? 0 : 1
                    const bRed = b.items.some((i) => i.category === 'red') ? 0 : 1
                    return aRed - bRed
                  })

                  if (alertRows.length === 0) {
                    return (
                      <div className="inventory-alert-summary inventory-alert-summary--ok">
                        <span>✅ Ingen oransje eller røde varer akkurat nå.</span>
                      </div>
                    )
                  }
                  return (
                    <div className="inventory-alert-summary">
                      <p className="inventory-alert-summary-title">
                        Status per lokasjon
                        <span className="inventory-alert-summary-note">Sendes daglig kl. 08:00</span>
                      </p>
                      <div className="inventory-alert-location-grid">
                        {alertRows.map(({ location, items, incidentNotes }) => (
                          <div key={location} className="inventory-alert-location-card">
                            <p className="inventory-alert-location-name">📍 {location}</p>
                            {incidentNotes.map((note, i) => (
                              <div key={i} className="inventory-alert-incident-note">
                                <span className="inventory-alert-incident-label">{note.label}</span>
                                <span className="inventory-alert-incident-text">{note.value}</span>
                              </div>
                            ))}
                            {items.map((item, i) => (
                              <div key={i} className={`inventory-alert-item is-${item.category} ${item.isUpdated ? 'is-updated' : ''}`}>
                                <span className="inventory-alert-item-label">{item.label}</span>
                                <span className="inventory-alert-item-value">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })() : null}

                {loadingSubmissions ? <p>Laster analyse...</p> : null}
                {!loadingSubmissions && analysisQuestions.length === 0 ? (
                  <p>No questions are marked with "Include in analysis" yet.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length === 0 ? (
                  <p>No submissions yet.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && visibleHistoryRows.length > 0 ? (
                  <div className="history-table-wrap">
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th rowSpan={2}>Spørsmål</th>
                          {visibleHistoryRows.map((row) => (
                            <th
                              key={`history-location-${row.location}`}
                              colSpan={historySubmissionSlots.length}
                              className="history-location-heading"
                            >
                              {row.location}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {visibleHistoryRows.flatMap((row) =>
                            historySubmissionSlots.map((slotIndex) => {
                              const submission = row.items[slotIndex]
                              return (
                                <th
                                  key={`${row.location}-slot-${slotIndex}`}
                                  className={slotIndex === 0 ? 'history-current-column' : ''}
                                >
                                  <div className="history-cell-meta">
                                    <strong>{slotIndex === 0 ? 'Nyeste' : `${slotIndex + 1}`}</strong>
                                    <small>
                                      {submission ? getDatePart(submission.submittedAt) : '-'}
                                    </small>
                                    <small>
                                      {submission ? getClockPart(submission.submittedAt) : '-'}
                                    </small>
                                  </div>
                                </th>
                              )
                            }),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleHistoryQuestions.map((question, qIndex) => (
                          <tr key={`history-question-${question.id}`}>
                            <th scope="row" className="history-row-header">
                              <span>{question.analysisLabel || question.label}</span>
                              <span className="history-row-order-btns">
                                <button
                                  type="button"
                                  className="ghost history-row-order-btn"
                                  title="Flytt opp"
                                  disabled={qIndex === 0 || analysisRowOrderSaving}
                                  onClick={() => {
                                    const ids = analysisQuestions.map((q) => q.id)
                                    const next = [...ids]
                                    ;[next[qIndex - 1], next[qIndex]] = [next[qIndex], next[qIndex - 1]]
                                    setAnalysisRowOrder(next)
                                    onSaveAnalysisRowOrder(next)
                                  }}
                                >▲</button>
                                <button
                                  type="button"
                                  className="ghost history-row-order-btn"
                                  title="Flytt ned"
                                  disabled={qIndex === visibleHistoryQuestions.length - 1 || analysisRowOrderSaving}
                                  onClick={() => {
                                    const ids = analysisQuestions.map((q) => q.id)
                                    const next = [...ids]
                                    ;[next[qIndex], next[qIndex + 1]] = [next[qIndex + 1], next[qIndex]]
                                    setAnalysisRowOrder(next)
                                    onSaveAnalysisRowOrder(next)
                                  }}
                                >▼</button>
                              </span>
                            </th>
                            {visibleHistoryRows.flatMap((row) =>
                              historySubmissionSlots.map((slotIndex) => {
                                const submission = row.items[slotIndex]
                                const values = submission
                                  ? getHistoryAnswerValues(submission, question)
                                  : []
                                const inventoryUpdate = slotIndex === 0 && !hideUpdatedValues
                                  ? getEffectiveInventoryValue(question.id, inventoryUpdates[row.location], submission?.submittedAt)
                                  : ''
                                const historyCellCategory = submission
                                  ? getHistoryCellCategory(question, submission)
                                  : ''
                                const effectiveCellCategory = inventoryUpdate
                                  ? getSelectOptionBehavior(question, inventoryUpdate).historyCategory
                                  : historyCellCategory

                                return (
                                  <td
                                    key={`${row.location}-${question.id}-${slotIndex}`}
                                    className={`history-cell ${
                                      slotIndex === 0 ? 'history-current-column' : ''
                                    } ${
                                      slotIndex === 0 && effectiveCellCategory === 'red'
                                        ? 'history-current-column-red'
                                        : ''
                                    }`}
                                  >
                                    <div className="history-cell-content">
                                      {inventoryUpdate ? (
                                        <span className="history-cell-inventory-update" title="Manuelt oppdatert varebeholdning">
                                          {inventoryUpdate}
                                        </span>
                                      ) : values.length > 0 ? (
                                        <span
                                          className={`history-cell-value ${
                                            historyCellCategory
                                              ? `history-cell-value-${historyCellCategory}`
                                              : ''
                                          }`}
                                        >
                                          {values.join(' | ')}
                                        </span>
                                      ) : (
                                        <span className="history-empty-cell">-</span>
                                      )}
                                      {slotIndex === 0 ? (
                                        <button
                                          type="button"
                                          className="ghost history-cell-edit-btn"
                                          title="Rediger varebeholdning"
                                          onClick={() => {
                                            setInventoryModalLocation(row.location)
                                            setInventoryModalQuestionId(question.id)
                                            setInventoryModalAnswers({})
                                            setInventoryModalError('')
                                            setShowInventoryModal(true)
                                          }}
                                        >
                                          ✏
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                )
                              }),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {!loadingSubmissions &&
                analysisQuestions.length > 0 &&
                historyRows.length > 0 &&
                visibleHistoryRows.length === 0 ? (
                  <p>Ingen lokasjoner er valgt i filteret.</p>
                ) : null}
                {!loadingSubmissions &&
                analysisQuestions.length > 0 &&
                visibleHistoryRows.length > 0 &&
                visibleHistoryQuestions.length === 0 ? (
                  <p>No questions selected in the filter.</p>
                ) : null}

                {!loadingSubmissions && (() => {
                  const logEntries = []
                  for (const [location, upd] of Object.entries(inventoryUpdates)) {
                    for (const [qId, entries] of Object.entries(upd.answerLogs || {})) {
                      const question = analysisQuestions.find((q) => q.id === qId)
                      const label = question?.analysisLabel || question?.label || qId
                      for (const entry of entries) {
                        logEntries.push({
                          location,
                          label,
                          value: entry.value,
                          updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : null,
                          updatedBy: entry.updatedBy || '',
                        })
                      }
                    }
                  }
                  logEntries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                  if (logEntries.length === 0) return null
                  return (
                    <div className="inventory-update-log">
                      <h4 className="inventory-update-log-title">Logg – manuelle oppdateringer</h4>
                      <table className="inventory-update-log-table">
                        <thead>
                          <tr>
                            <th>Tidspunkt</th>
                            <th>Lokasjon</th>
                            <th>Produkt</th>
                            <th>Verdi</th>
                            <th>Av</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logEntries.map((entry, i) => (
                            <tr key={i}>
                              <td className="inventory-log-time">
                                {entry.updatedAt
                                  ? entry.updatedAt.toLocaleString('no-NO', {
                                      day: '2-digit',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '–'}
                              </td>
                              <td>{entry.location}</td>
                              <td>{entry.label}</td>
                              <td className="inventory-log-value">{entry.value}</td>
                              <td className="inventory-log-by">{entry.updatedBy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            ) : null}

            {showInventoryModal ? (
              <div
                className="submission-modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="inventory-update-modal-title"
                onClick={() => setShowInventoryModal(false)}
              >
                <div
                  className="submission-modal forms-admin-modal inventory-update-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="submission-modal-header">
                    <h4 id="inventory-update-modal-title">Rediger varebeholdning</h4>
                    <button type="button" className="ghost" onClick={() => setShowInventoryModal(false)}>
                      Close
                    </button>
                  </div>
                  <div className="submission-modal-content">
                    {(() => {
                      const selectedQuestion = analysisQuestions.find((q) => q.id === inventoryModalQuestionId)
                      const latestSubmission = inventoryModalLocation
                        ? historyRows.find((r) => r.location === inventoryModalLocation)?.items[0]
                        : null
                      return (
                        <div className="inventory-update-steps">
                          <label className="field-block">
                            <span>1. Velg sted</span>
                            <select
                              value={inventoryModalLocation}
                              onChange={(e) => {
                                setInventoryModalLocation(e.target.value)
                                setInventoryModalQuestionId('')
                                setInventoryModalAnswers({})
                              }}
                            >
                              <option value="">Velg sted...</option>
                              {historyRows.map((row) => (
                                <option key={row.location} value={row.location}>{row.location}</option>
                              ))}
                            </select>
                          </label>

                          {inventoryModalLocation ? (
                            <label className="field-block">
                              <span>2. Velg spørsmål</span>
                              <select
                                value={inventoryModalQuestionId}
                                onChange={(e) => {
                                  setInventoryModalQuestionId(e.target.value)
                                  setInventoryModalAnswers({})
                                }}
                              >
                                <option value="">Velg spørsmål...</option>
                                {analysisQuestions.map((q) => (
                                  <option key={q.id} value={q.id}>{q.analysisLabel || q.label}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}

                          {inventoryModalLocation && selectedQuestion ? (() => {
                            const currentValue = String(latestSubmission?.answers?.[selectedQuestion.id] || '').trim()
                            const existingUpdate = inventoryUpdates[inventoryModalLocation]?.answers?.[selectedQuestion.id]
                            return (
                              <label className="field-block">
                                <span>3. Ny verdi</span>
                                {(currentValue || existingUpdate) ? (
                                  <small className="field-help inventory-update-current">
                                    {existingUpdate
                                      ? <>Forrige oppdatering: <span className="inventory-updated-value">{existingUpdate}</span></>
                                      : <>Siste skjema: {currentValue}</>
                                    }
                                  </small>
                                ) : null}
                                {selectedQuestion.type === 'select' && Array.isArray(selectedQuestion.options) ? (
                                  <select
                                    value={inventoryModalAnswers[selectedQuestion.id] || ''}
                                    onChange={(e) => setInventoryModalAnswers({ [selectedQuestion.id]: e.target.value })}
                                  >
                                    <option value="">Velg ny verdi...</option>
                                    {selectedQuestion.options.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={selectedQuestion.type === 'date' ? 'date' : selectedQuestion.type === 'time-start' || selectedQuestion.type === 'time-end' ? 'time' : 'text'}
                                    placeholder="Ny verdi..."
                                    value={inventoryModalAnswers[selectedQuestion.id] || ''}
                                    onChange={(e) => setInventoryModalAnswers({ [selectedQuestion.id]: e.target.value })}
                                  />
                                )}
                              </label>
                            )
                          })() : null}
                        </div>
                      )
                    })()}
                    {inventoryModalError ? <p className="forms-error">{inventoryModalError}</p> : null}
                  </div>
                  <div className="submission-modal-actions" style={{ padding: '10px 14px', borderTop: '1px solid rgba(24,44,60,0.12)', justifyContent: 'flex-end' }}>
                    <button type="button" className="ghost" onClick={() => setShowInventoryModal(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="cta"
                      disabled={
                        !inventoryModalLocation ||
                        !inventoryModalQuestionId ||
                        inventoryModalSaving ||
                        Object.values(inventoryModalAnswers).every((v) => !String(v || '').trim())
                      }
                      onClick={onSaveInventoryUpdate}
                    >
                      {inventoryModalSaving ? 'Saving...' : 'Lagre'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {isProductionView ? (
              <div className="responses-box production-stats-page" id="production-section">
                <div className="review-page-header">
                  <div>
                    <h3>Ice cream production per hour</h3>
                  </div>
                  <div className="submission-modal-actions">
                    <form action={`/skjema/${activeFormSlug}/submissions`} method="get">
                      <button type="submit" className="ghost">
                        Back to submissions
                      </button>
                    </form>
                  </div>
                </div>
                {loadingSubmissions ? <p>Loading...</p> : null}
                {!loadingSubmissions ? (() => {
                  const hasIceQuestion = formData.questions.some((q) => q.isIceProductionCount)
                  const hasTimeStart = formData.questions.some((q) => q.type === 'time-start')
                  const hasTimeEnd = formData.questions.some((q) => q.type === 'time-end')
                  if (!hasIceQuestion || !hasTimeStart || !hasTimeEnd) {
                    return (
                      <p className="forms-error">
                        Form is missing required fields: {!hasTimeStart ? 'start time, ' : ''}{!hasTimeEnd ? 'end time, ' : ''}{!hasIceQuestion ? 'ice cream count (mark a question with "Antall iskrem" in the editor)' : ''}
                      </p>
                    )
                  }
                  const userMap = {}
                  for (const sub of submissions) {
                    const rate = getIceProductionRate(sub.answers, formData.questions)
                    if (!rate) continue
                    const userName = getSubmissionName(sub.answers, formData.questions) || 'Unknown'
                    if (!userMap[userName]) {
                      userMap[userName] = { totalCones: 0, totalHours: 0, sessions: [] }
                    }
                    userMap[userName].totalCones += rate.count
                    userMap[userName].totalHours += rate.hours
                    userMap[userName].sessions.push({
                      id: sub.id,
                      date: sub.submittedAt
                        ? new Date((sub.submittedAt.seconds || 0) * 1000).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })
                        : '-',
                      startTime: rate.startTime,
                      endTime: rate.endTime,
                      hours: rate.hours,
                      count: rate.count,
                      rate: rate.rate,
                    })
                  }
                  const userList = Object.entries(userMap)
                    .map(([name, data]) => ({
                      name,
                      totalCones: data.totalCones,
                      totalHours: Math.round(data.totalHours * 100) / 100,
                      avgRate: data.totalHours > 0
                        ? Math.round((data.totalCones / data.totalHours) * 10) / 10
                        : 0,
                      sessions: data.sessions,
                    }))
                    .sort((a, b) => b.avgRate - a.avgRate)
                  if (userList.length === 0) {
                    return <p>No submissions with ice cream data found.</p>
                  }
                  return (
                    <div className="production-stats-list">
                      {userList.map((user) => (
                        <article key={user.name} className="production-user-card">
                          <div className="production-user-header">
                            <h4>{user.name}</h4>
                            <span className="production-user-avg">
                              {user.avgRate} cones / hour (average)
                            </span>
                          </div>
                          <div className="production-user-totals">
                            <span>{user.totalCones} cones total</span>
                            <span>{user.totalHours} hours total</span>
                            <span>{user.sessions.length} {user.sessions.length === 1 ? 'session' : 'sessions'}</span>
                          </div>
                          <details className="production-sessions-details">
                            <summary>Show sessions</summary>
                            <table className="submissions-table production-sessions-table">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th>Start</th>
                                  <th>End</th>
                                  <th>Hours</th>
                                  <th>Cones</th>
                                  <th>Cones/hour</th>
                                </tr>
                              </thead>
                              <tbody>
                                {user.sessions.map((session) => (
                                  <tr key={session.id}>
                                    <td>{session.date}</td>
                                    <td>{session.startTime}</td>
                                    <td>{session.endTime}</td>
                                    <td>{session.hours}</td>
                                    <td>{session.count}</td>
                                    <td><strong>{session.rate}</strong></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        </article>
                      ))}
                    </div>
                  )
                })() : null}
              </div>
            ) : null}

            {isReviewView ? (
              <div className="responses-box review-page" id="review-section">
                <div className="review-page-header">
                  <div>
                    <h3>Review submission</h3>
                    {selectedSubmission ? (
                      <p>
                        {getSubmissionLocation(selectedSubmission.answers, formData.questions)} |{' '}
                        {getSubmissionName(selectedSubmission.answers, formData.questions)}
                      </p>
                    ) : null}
                  </div>
                  <div className="submission-modal-actions">
                    <form action={`/skjema/${activeFormSlug}/submissions`} method="get">
                      <button type="submit" className="ghost">
                        Back to submissions
                      </button>
                    </form>
                  </div>
                </div>

                {loadingSubmissions ? <p>Loading submission...</p> : null}
                {!loadingSubmissions && !selectedSubmission ? (
                  <p>Could not find the submission.</p>
                ) : null}
                {selectedSubmission ? (
                  <>
                    <div className="receipt-meta review-meta-grid">
                      <p>
                        <strong>Submission:</strong> {selectedSubmission.id}
                      </p>
                      <p>
                        <strong>Submitted:</strong> {formatTime(selectedSubmission.submittedAt)}
                      </p>
                      <p>
                        <strong>Status:</strong> {getSubmissionStatusLabel(selectedSubmission.status)}
                      </p>
                    </div>

                    {(() => {
                      const prodRate = getIceProductionRate(selectedSubmission.answers, formData.questions)
                      if (!prodRate) return null
                      return (
                        <div className="receipt-meta ice-production-rate-box">
                          <p><strong>Ice cream production</strong></p>
                          <p>{prodRate.startTime} – {prodRate.endTime} ({prodRate.hours} hours)</p>
                          <p>{prodRate.count} cones total</p>
                          <p className="ice-production-rate-highlight">
                            <strong>{prodRate.rate} cones / hour</strong> (average)
                          </p>
                        </div>
                      )
                    })()}

                    {reviewQuestions.length === 0 ? (
                      <p>No questions are marked with "Should be reviewed" in this form.</p>
                    ) : null}

                    {reviewQuestions.length > 0 && selectedSubmissionAnswerEntries.length === 0 ? (
                      <p>No review questions have answers in this submission.</p>
                    ) : null}

                    {selectedSubmissionAnswerEntries.length > 0 && hasPendingReviewDecisions ? (
                      <p className="review-pending-note">
                        Select <FaceHappy size={16} />, <FaceNeutral size={16} /> or <FaceSad size={16} /> for each question before marking the submission as reviewed.
                      </p>
                    ) : null}

                    <div className="review-comparison-list">
                      {(() => {
                        const currentUserName =
                          getSubmissionName(selectedSubmission.answers, formData.questions) ||
                          getSubmissionPhone(selectedSubmission.answers, formData.questions) ||
                          null
                        const userPastReviews = currentUserName
                          ? submissions
                              .filter((s) => {
                                if (s.id === selectedSubmission.id) return false
                                if (String(s.status || '').trim().toLowerCase() !== 'reviewed') return false
                                const n =
                                  getSubmissionName(s.answers, formData.questions) ||
                                  getSubmissionPhone(s.answers, formData.questions) ||
                                  null
                                return n === currentUserName
                              })
                              .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
                              .slice(0, 10)
                          : []
                        return selectedSubmissionAnswerEntries.map(([answerKey, value]) => {
                        const question = getQuestionForAnswerKey(answerKey, formData.questions)
                        const isFlaggingQuestion = question?.reviewType === 'flagging'
                        const questionHistory = isFlaggingQuestion
                          ? userPastReviews.map((s) => {
                              if (s.reviewAnswers && answerKey in s.reviewAnswers) {
                                return s.reviewAnswers[answerKey]
                              }
                              const wasFlagged =
                                Array.isArray(s.flaggedAnswers) &&
                                s.flaggedAnswers.some((a) => a.answerKey === answerKey)
                              return wasFlagged ? 'flagged' : 'approved'
                            })
                          : []
                        const reviewImage = getAnswerImageDetails(
                          answerKey,
                          value,
                          selectedSubmission,
                          selectedSubmissionImageUrls,
                          formData.questions,
                        )
                        const reviewStatus = reviewDraftStatuses[answerKey] || ''
                        const isApproved = reviewStatus === 'approved'
                        const isNeutral = reviewStatus === 'flagged'
                        const isSad = reviewStatus === 'flagged_sad'
                        const isFlagged = isNeutral || isSad

                        return (
                          <article key={`${selectedSubmission.id}-${answerKey}`} className="review-comparison-row">
                            <div className="review-comparison-panel">
                              <p className="review-answer-label">
                                {translateText(
                                  getAnswerDisplayLabel(
                                    answerKey,
                                    selectedSubmission.answers,
                                    formData.questions,
                                  ),
                                )}
                              </p>
                              <p className="review-panel-title">User answer</p>
                              {reviewImage.isImageAnswer ? (
                                <>
                                  {reviewImage.imageUrl ? (
                                    <img
                                      className="review-answer-image"
                                      src={reviewImage.imageUrl}
                                      alt={translateText(
                                        getAnswerDisplayLabel(
                                          answerKey,
                                          selectedSubmission.answers,
                                          formData.questions,
                                        ),
                                      )}
                                      loading="lazy"
                                    />
                                  ) : null}
                                  {(() => {
                                    const capturedAt = String(selectedSubmission.answers?.[getImageCapturedAtAnswerKey(answerKey)] || '').trim()
                                    return capturedAt ? (
                                      <p className="review-answer-captured-at">Tatt: {capturedAt}</p>
                                    ) : null
                                  })()}
                                  {reviewImage.imageUrl ? (
                                    <p className="review-answer-value review-answer-file-link">
                                      <a
                                        href={reviewImage.imageUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {reviewImage.fileLabel || 'Open image'}
                                      </a>
                                    </p>
                                  ) : (
                                    <p className="review-answer-value">
                                      {selectedSubmissionImagesLoading
                                        ? 'Loading image...'
                                        : reviewImage.fileLabel || 'Could not load image.'}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <p className="review-answer-value">
                                  {getReviewDisplayValue(
                                    answerKey,
                                    value,
                                    question,
                                    translateText,
                                  )}
                                </p>
                              )}
                            </div>

                            <div className="review-comparison-panel">
                              <p className="review-panel-title">Reference image</p>
                              {question?.imageUrl ? (
                                renderQuestionImage(
                                  question.imageUrl,
                                  `${translateText(question.label)} reference`,
                                  question.imageZoom,
                                )
                              ) : (
                                <p className="review-answer-value">No reference image</p>
                              )}
                            </div>

                            <div className="review-flag-panel">
                              {question?.reviewHelpText ? (
                                <p className="review-help-text">{translateText(question.reviewHelpText)}</p>
                              ) : null}
                              <p className="review-panel-title">Review</p>
                              {isFlaggingQuestion ? (
                                <>
                                  <div className="review-action-row">
                                    <button
                                      type="button"
                                      className={`review-status-button is-approve is-text ${isApproved ? 'is-active' : ''}`}
                                      onClick={() => onSetReviewStatus(answerKey, 'approved')}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      className={`review-status-button is-flag is-text ${isNeutral ? 'is-active' : ''}`}
                                      onClick={() => onSetReviewStatus(answerKey, 'flagged')}
                                    >
                                      Flag
                                    </button>
                                  </div>
                                  {isFlagged ? (
                                    <label
                                      className="field-block review-comment-field"
                                      htmlFor={`review-comment-${answerKey}`}
                                    >
                                      <span>Comment</span>
                                      <textarea
                                        id={`review-comment-${answerKey}`}
                                        rows={4}
                                        value={reviewDraftComments[answerKey] || ''}
                                        onChange={(event) =>
                                          onReviewCommentChange(answerKey, event.target.value)
                                        }
                                      />
                                    </label>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <div className="review-action-row">
                                    <button
                                      type="button"
                                      className={`review-status-button is-approve ${isApproved ? 'is-active' : ''}`}
                                      onClick={() => onSetReviewStatus(answerKey, 'approved')}
                                      title="Godkjent"
                                    >
                                      <FaceHappy />
                                    </button>
                                    <button
                                      type="button"
                                      className={`review-status-button is-flag ${isNeutral ? 'is-active' : ''}`}
                                      onClick={() => onSetReviewStatus(answerKey, 'flagged')}
                                      title="Kan bli bedre"
                                    >
                                      <FaceNeutral />
                                    </button>
                                    <button
                                      type="button"
                                      className={`review-status-button is-sad ${isSad ? 'is-active' : ''}`}
                                      onClick={() => onSetReviewStatus(answerKey, 'flagged_sad')}
                                      title="Ikke bra"
                                    >
                                      <FaceSad />
                                    </button>
                                  </div>
                                  {isFlagged ? (
                                    <>
                                      {question?.includeRating ? (
                                        <div className="review-rating-row">
                                          <p className="review-rating-label">Rating</p>
                                          <div className="review-rating-stars">
                                            {[1, 2, 3, 4, 5].map((star) => (
                                              <button
                                                key={star}
                                                type="button"
                                                className={`review-star-button ${
                                                  Number(reviewDraftRatings[answerKey] || 0) >= star
                                                    ? 'is-active'
                                                    : ''
                                                }`}
                                                onClick={() => onReviewRatingChange(answerKey, star)}
                                                title={`${star} stjerne${star !== 1 ? 'r' : ''}`}
                                              >
                                                ★
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                      <label
                                        className="field-block review-comment-field"
                                        htmlFor={`review-comment-${answerKey}`}
                                      >
                                        <span>Comment</span>
                                        <textarea
                                          id={`review-comment-${answerKey}`}
                                          rows={4}
                                          value={reviewDraftComments[answerKey] || ''}
                                          onChange={(event) =>
                                            onReviewCommentChange(answerKey, event.target.value)
                                          }
                                        />
                                      </label>
                                    </>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </article>
                        )
                      })
                      })()}
                    </div>
                  </>
                ) : null}


                {selectedSubmission ? (
                  <div className="review-general-feedback">
                    {!reviewRejected ? (
                      <label className="review-general-feedback-label">
                        <span>General feedback to employee <span className="review-general-feedback-optional">(optional)</span></span>
                        <textarea
                          className="review-general-feedback-textarea"
                          rows={3}
                          value={reviewGeneralFeedback}
                          onChange={(e) => setReviewGeneralFeedback(e.target.value)}
                          placeholder="Write overall feedback shown at the top of the email…"
                        />
                      </label>
                    ) : null}

                    <label className="review-reject-label">
                      <input
                        type="checkbox"
                        checked={reviewRejected}
                        onChange={(e) => setReviewRejected(e.target.checked)}
                      />
                      <span>Reject this closing form</span>
                    </label>
                    {reviewRejected ? (
                      <label className="review-general-feedback-label">
                        <span>Rejection reason <span className="review-general-feedback-required">*</span></span>
                        <textarea
                          className="review-general-feedback-textarea"
                          rows={3}
                          value={reviewRejectionComment}
                          onChange={(e) => setReviewRejectionComment(e.target.value)}
                          placeholder="Explain why the form is being rejected…"
                        />
                      </label>
                    ) : null}

                    <label className="review-send-email-label">
                      <input
                        type="checkbox"
                        checked={reviewSendEmail}
                        onChange={(e) => setReviewSendEmail(e.target.checked)}
                      />
                      <span>Send review to user on email</span>
                    </label>

                    <div className="review-general-feedback-actions">
                      <button
                        type="button"
                        className="cta"
                        onClick={onOpenReviewPreview}
                        disabled={
                          reviewSubmissionState.saving ||
                          selectedSubmissionAnswerEntries.length === 0 ||
                          (!reviewRejected && hasPendingReviewDecisions)
                        }
                      >
                        Set as reviewed
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
        </section>
      ) : null}

      {reviewEmailPreviewData ? (
        <div
          className="submission-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Email preview"
          onClick={() => setReviewEmailPreviewData(null)}
        >
          <div
            className="submission-modal email-preview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="submission-modal-header">
              <h4>Email preview</h4>
              <div className="submission-modal-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setReviewEmailPreviewData(null)}
                  disabled={reviewSubmissionState.saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cta"
                  onClick={onSaveSubmissionReview}
                  disabled={reviewSubmissionState.saving}
                >
                  {reviewSubmissionState.saving ? 'Saving…' : 'Send email & mark as reviewed'}
                </button>
              </div>
            </div>

            <div className="submission-modal-content">
              <div className="email-preview-envelope">
                <div className="email-preview-recipients">
                  <label className="review-email-override-label">
                    <strong>To:</strong>
                    <input
                      className="review-email-override-input"
                      type="email"
                      placeholder="Ingen e-post — legg til her"
                      value={reviewEmailOverride}
                      onChange={(e) => { setReviewEmailOverride(e.target.value); setReviewEmailSaved(false) }}
                    />
                  </label>
                  {reviewEmailOverride.trim() && getSubmissionPhone(selectedSubmission?.answers, formData.questions) ? (
                    <div className="review-save-email-row">
                      <button
                        type="button"
                        className="ghost review-save-email-btn"
                        onClick={onSaveEmailForPhone}
                        disabled={reviewEmailSaving || reviewEmailSaved}
                      >
                        {reviewEmailSaved ? '✓ Email saved' : reviewEmailSaving ? 'Saving…' : 'Save email for this phone number'}
                      </button>
                    </div>
                  ) : null}
                  {reviewEmailSuggestion && reviewEmailSuggestion !== reviewEmailOverride ? (
                    <p className="review-email-suggestion">
                      Sist sendt til: <strong>{reviewEmailSuggestion}</strong>
                      <button
                        type="button"
                        className="ghost review-email-suggestion-btn"
                        onClick={() => setReviewEmailOverride(reviewEmailSuggestion)}
                      >
                        Bruk
                      </button>
                    </p>
                  ) : null}
                  <span><strong>CC:</strong> brandon@crust.no, magnus@crust.no</span>
                  {!reviewEmailOverride ? (
                    <p className="email-preview-no-email">Ingen e-post — e-post sendes ikke til innsender.</p>
                  ) : null}
                </div>
              </div>

              <div className="email-preview-body">
                <h2 className="email-preview-title">
                  {reviewEmailPreviewData.rejected ? 'Stengeskjemaet ditt ble avvist' : 'Stengeskjemaet ditt har blitt gjennomgått'}
                </h2>

                {reviewEmailPreviewData.rejected ? (
                  <div className="email-preview-rejection">
                    <strong>Avvist:</strong> {reviewEmailPreviewData.rejectionComment}
                  </div>
                ) : null}

                {!reviewEmailPreviewData.rejected && reviewEmailPreviewData.generalFeedback ? (
                  <div className="email-preview-general-feedback">
                    {reviewEmailPreviewData.generalFeedback}
                  </div>
                ) : null}

                {!reviewEmailPreviewData.rejected ? (
                  <div className="email-preview-count-bar">
                    <span className="email-preview-count is-happy">
                      <FaceHappy size={24} /> {reviewEmailPreviewData.reviewScoreSummary.happy}
                    </span>
                    <span className="email-preview-count is-neutral">
                      <FaceNeutral size={24} /> {reviewEmailPreviewData.reviewScoreSummary.neutral}
                    </span>
                    <span className="email-preview-count is-sad">
                      <FaceSad size={24} /> {reviewEmailPreviewData.reviewScoreSummary.sad}
                    </span>
                  </div>
                ) : null}
                {reviewEmailPreviewData.reviewedBy ? (
                  <p className="email-preview-reviewer">
                    {`Vurdert av: ${reviewEmailPreviewData.reviewedBy}`}
                  </p>
                ) : null}

                {reviewEmailPreviewData.flaggedAnswers.length > 0 ? (
                  <div className="email-preview-section">
                    <h3 className="email-preview-section-title email-preview-section-title--flagged">Se på dette:</h3>
                    {reviewEmailPreviewData.flaggedAnswers.map((item) => (
                      <div
                        key={item.answerKey}
                        className={`email-preview-answer ${item.reviewStatus === 'flagged_sad' ? 'is-sad' : 'is-neutral'}`}
                      >
                        <p className="email-preview-answer-label">
                          {item.reviewStatus === 'flagged_sad' ? <FaceSad size={18} /> : <FaceNeutral size={18} />} {item.label}
                        </p>
                        {item.comment ? (
                          <div className="email-preview-comment">
                            <strong>Tilbakemelding:</strong> {item.comment}
                          </div>
                        ) : null}
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.label} className="email-preview-image" />
                        ) : (
                          <p className="email-preview-answer-value"><em>{item.value}</em></p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {reviewEmailPreviewData.approvedAnswers.length > 0 ? (
                  <div className="email-preview-section">
                    <h3 className="email-preview-section-title email-preview-section-title--approved">Dette så bra ut:</h3>
                    {reviewEmailPreviewData.approvedAnswers.map((item) => (
                      <div key={item.answerKey} className="email-preview-answer is-approved">
                        <p className="email-preview-answer-label"><FaceHappy size={18} /> {item.label}</p>
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.label} className="email-preview-image" />
                        ) : (
                          <p className="email-preview-answer-value"><em>{item.value}</em></p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {reviewSubmissionState.error ? (
                <p className="forms-error">{reviewSubmissionState.error}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default FormPage
