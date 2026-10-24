import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isVector, type Asset, type Page, type Settings } from './core/model'
import { pdfFilename } from './core/filename'
import { compressionFor, estimateBytes } from './core/compression'
import type { Skew } from './core/deskew'
import { skewOf } from './lib/skew'
import { paperOf } from './lib/paper'
import type { Quad } from './core/perspective'
import { forgetPageWords, pageWords } from './lib/pageText'
import { forgetPageThumbs } from './hooks/usePageThumb'
import { forgetLayered, layeredImage } from './export/layered'
import type { OcrWord } from './core/textLayer'
import { layoutPage } from './core/geometry'
import { formatBytes } from './core/units'
import { describeChange } from './core/describeChange'
import { DocumentBar, type ExportState } from './components/DocumentBar'
import { DropOverlay, EmptyState, Footer, Header, Notices, type Notice } from './components/Chrome'
import { Inspector, type InspectorActions } from './components/Inspector'
import { PageGrid } from './components/PageGrid'
import { download as saveFile, exportPdf, prepareExport, type Exported } from './export/exportPdf'
import { STALE_BUILD_MESSAGE, isStaleBuild } from './lib/staleBuild'
import { assetStore } from './import/assetStore'
import { ImportError, importFile, type Imported } from './import/importFile'
import { loadSettings, saveSettings } from './state/settingsStorage'
import { useDocument } from './state/useDocument'
import type { DocState } from './core/model'

export interface AppDeps {
  importFile: (
    file: File,
    newId: () => string,
    onPage?: (done: number, total: number) => void,
  ) => Promise<Imported>
  exportPdf: (
    doc: DocState,
    onProgress: (done: number, total: number, attempt: number) => void,
    options?: {
      password?: string
      text?: Record<string, OcrWord[]>
      readDrawn?: (assetId: string, jpeg: Uint8Array) => Promise<Record<string, OcrWord[]>>
    },
  ) => Promise<Exported>
  download: (blob: Blob, filename: string) => void
  newId: () => string
  estimateSkew: (asset: Asset) => Promise<Skew | null>
  /** The paper's corners in a photo, to suggest as its crop (null: no clear sheet). */
  findPaper: (asset: Asset) => Promise<Quad | null>
  /**
   * Recognises a page's words (fractions of its content image); from
   * `drawn` instead for a PDF page exported as a drawing.
   */
  recognizeText: (asset: Asset, page: Page, drawn?: Uint8Array) => Promise<OcrWord[]>
  /** A PDF page drawn as the preview shows it, if it hides a layer (else null). */
  drawnPage: (asset: Asset) => Promise<Uint8Array | null>
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  locale: string
  /** Loads the export code ahead of time (see exportPdf.ts). */
  prepareExport: () => void
}

const safeStorage = (): AppDeps['storage'] => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const defaultDeps = (): AppDeps => ({
  importFile,
  exportPdf,
  download: saveFile,
  newId: () => crypto.randomUUID(),
  estimateSkew: skewOf,
  findPaper: paperOf,
  recognizeText: pageWords,
  drawnPage: (asset) => layeredImage(asset),
  storage: safeStorage(),
  locale: navigator.language,
  prepareExport,
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Image files from a drop or paste; directories and non-files are skipped. */
const filesFrom = (list: FileList | null | undefined): File[] =>
  list ? Array.from(list).filter((file) => file.size > 0 || file.type !== '') : []

/** A modal dialog (the crop editor) is open: page-level shortcuts stand down. */
const modalOpen = () => [...document.querySelectorAll('dialog')].some((d) => d.open)

/** A popover (export options) is open; it handles its own Escape. */
const popoverOpen = () =>
  [...document.querySelectorAll('[popover]')].some((el) => {
    try {
      return el.matches(':popover-open')
    } catch {
      return false // no popover support (jsdom)
    }
  })

/** PDF AES-256 uses at most 127 bytes of the password and drops the rest silently. */
export const PASSWORD_MAX_BYTES = 127

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) &&
  !(
    target instanceof HTMLInputElement &&
    ['range', 'radio', 'checkbox', 'button'].includes(target.type)
  )

export const App = ({ deps: injected }: { deps?: Partial<AppDeps> } = {}) => {
  const deps = useMemo(() => ({ ...defaultDeps(), ...injected }), [injected])
  const { doc, previous, next, act, undo, redo, canUndo, canRedo, endGesture, reset } = useDocument(
    () => loadSettings(deps.storage, deps.locale),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importing, setImporting] = useState<{
    file: number
    files: number
    /** Pages read so far of a multi-page PDF. */
    pages?: { done: number; total: number }
  } | null>(null)
  const [exporting, setExporting] = useState<ExportState>({ busy: false, done: 0, total: 0 })
  // In memory only: never in settings, storage or undo history.
  const [password, setPassword] = useState('')
  const [lastExport, setLastExport] = useState<{
    size: string
    used: string
    fits: boolean
  } | null>(null)
  const [status, setStatus] = useState('')
  // Repeating a message (undo, undo) must still be heard: a live region only
  // speaks when its text changes, so alternate a trailing no-break space.
  const announce = useCallback((text: string) => {
    setStatus((current) => (current === text ? `${text}\u00a0` : text))
  }, [])
  const [notices, setNotices] = useState<Notice[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // The inspector scrolls on its own; a newly selected page starts at its top.
  const rail = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    // Not while focus is in the inspector (Duplicate selects the copy, and its
    // button must stay in view; WCAG 2.4.11).
    const el = rail.current
    if (el && !el.contains(document.activeElement)) el.scrollTop = 0
  }, [selectedId])
  const noticeId = useRef(0)
  /** Bumped by Start over, so work started before it doesn't land after it. */
  const generation = useRef(0)
  /**
   * Where focus goes after a change that may remove the focused control:
   * a page's select button (else the add/choose button). `always` moves it
   * regardless; otherwise only if focus was lost to the page. Set in the
   * same batch as the change, so the effect below sees both.
   */
  const [focusRequest, setFocusRequest] = useState<{
    pageId: string | null
    always: boolean
    n: number
  } | null>(null)
  const handledFocus = useRef(0)
  const requestFocus = useCallback((pageId: string | null, always: boolean) => {
    setFocusRequest((last) => ({ pageId, always, n: (last?.n ?? 0) + 1 }))
  }, [])

  const { pages, assets, settings } = doc
  const selectedIndex = pages.findIndex((p) => p.id === selectedId)
  // Undo can remove the selected page; a stale id simply selects nothing.
  const selected = pages[selectedIndex]

  useEffect(() => {
    saveSettings(deps.storage, settings)
  }, [deps.storage, settings])

  // Once there's something to export, load the export code, so a deploy while
  // working can't leave Export without it (#42).
  const hasPages = pages.length > 0
  useEffect(() => {
    if (hasPages) deps.prepareExport()
  }, [deps, hasPages])

  useLayoutEffect(() => {
    const pending = focusRequest
    if (!pending || pending.n === handledFocus.current) return
    handledFocus.current = pending.n
    const active = document.activeElement
    if (!pending.always && active && active !== document.body && active.isConnected) return
    const card = pending.pageId
      ? document.querySelector<HTMLElement>(
          `[data-page-id="${CSS.escape(pending.pageId)}"] [data-page-select]`,
        )
      : null
    ;(card ?? document.querySelector<HTMLElement>('[data-focus-fallback]'))?.focus()
  }, [focusRequest])

  const notify = useCallback((text: string) => {
    noticeId.current += 1
    const id = noticeId.current
    setNotices((list) => [...list.slice(-3), { id, text }])
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setImporting({ file: 1, files: files.length })
      setStatus(`Reading ${plural(files.length, 'file')}…`)
      const added: Asset[] = []
      const failed: string[] = []
      const started = generation.current
      // One at a time: decoding several 12-megapixel photos at once can
      // exhaust memory on a phone.
      for (const [i, file] of files.entries()) {
        try {
          setImporting({ file: i + 1, files: files.length })
          const imported = await deps.importFile(file, deps.newId, (done, total) => {
            setImporting({ file: i + 1, files: files.length, pages: { done, total } })
          })
          if (generation.current !== started) break
          for (const { id, bytes } of imported.files) assetStore.putBytes(id, bytes)
          added.push(...imported.assets)
        } catch (error) {
          // Expected failures (unsupported file, password) are ImportErrors
          // with a message for the person; anything else is a bug, so keep
          // its details in the console for reports.
          if (!(error instanceof ImportError)) console.error(error)
          const reason =
            error instanceof ImportError
              ? error.message
              : isStaleBuild(error)
                ? STALE_BUILD_MESSAGE
                : 'It could not be read as an image or PDF.'
          failed.push(`${file.name || 'A file'}: ${reason}`)
        }
      }
      setImporting(null)
      if (generation.current !== started) return
      if (added.length > 0) {
        const pageIds = added.map(() => deps.newId())
        act({ type: 'addPages', assets: added, pageIds })
        setSelectedId((current) => current ?? pageIds[0] ?? null)
      }
      for (const message of failed) notify(message)
      setStatus(
        [
          added.length > 0 && `Added ${plural(added.length, 'page')}.`,
          failed.length > 0 && `${plural(failed.length, 'file')} could not be added.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
    },
    [act, deps, notify],
  )

  // Drop anywhere, paste anywhere, and keyboard undo/redo.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      // Not into a dialog (Start over's confirmation, the crop editor).
      if (modalOpen()) return
      void addFiles(filesFrom(event.dataTransfer?.files))
    }
    const onPaste = (event: ClipboardEvent) => {
      const files = filesFrom(event.clipboardData?.files)
      if (files.length === 0 || modalOpen()) return
      event.preventDefault()
      void addFiles(files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [addFiles])

  /** The page index focus should return to after `to` replaces the document. */
  const keepFocusThrough = useCallback(
    (to: DocState | undefined) => {
      if (!to) return
      const from = document.activeElement?.closest('[data-page-id]')?.getAttribute('data-page-id')
      const index = pages.findIndex((p) => p.id === (from ?? selectedId))
      const target = to.pages[Math.min(Math.max(index, 0), to.pages.length - 1)]
      requestFocus(target?.id ?? null, false)
      // If the selected page is going away, select the one taking its place.
      if (selectedId !== null && !to.pages.some((p) => p.id === selectedId)) {
        setSelectedId(target?.id ?? null)
      }
    },
    [pages, requestFocus, selectedId],
  )

  const onUndo = useCallback(() => {
    if (!previous) return
    const what = describeChange(previous, doc)
    keepFocusThrough(previous)
    undo()
    announce(what ? `Undone: ${what}.` : 'Undone.')
  }, [announce, doc, keepFocusThrough, previous, undo])
  const onRedo = useCallback(() => {
    if (!next) return
    const what = describeChange(doc, next)
    keepFocusThrough(next)
    redo()
    announce(what ? `Redone: ${what}.` : 'Redone.')
  }, [announce, doc, keepFocusThrough, next, redo])

  const dismissLatest = useCallback(() => {
    setNotices((list) => list.slice(0, -1))
  }, [])

  // Keyboard undo/redo, Alt+T to the toolbar, and Escape for the latest notice.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The crop editor is modal: nothing behind it may change.
      if (modalOpen()) return
      // By key position, not character: Option+T on a Mac types "†".
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyT') {
        const stop = document.querySelector<HTMLElement>('[role="toolbar"] [data-toolbar-stop]')
        if (stop) {
          event.preventDefault()
          stop.focus()
        }
        return
      }
      if (event.key === 'Escape') {
        if (!event.defaultPrevented && !popoverOpen() && !isEditable(event.target)) {
          dismissLatest()
        }
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || isEditable(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) onUndo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') onRedo()
      else return
      event.preventDefault()
    }
    // Capture, so a popover's own Escape hasn't closed it yet when we look.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [dismissLatest, onUndo, onRedo])

  const chooseFiles = useCallback(() => {
    fileInput.current?.click()
  }, [])

  // Normalised so the same password typed on another keyboard or system
  // (composed vs decomposed accents, full-width forms) opens the file.
  const lockPassword = password.normalize('NFKC')
  const passwordError =
    new TextEncoder().encode(lockPassword).length > PASSWORD_MAX_BYTES
      ? `Too long: a PDF password can use at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} plain letters, fewer with accents or other scripts), and anything after that would be silently ignored.`
      : null

  const onExport = useCallback(async () => {
    if (passwordError) return
    setExporting({ busy: true, done: 0, total: pages.length })
    setStatus('Building PDF…')
    try {
      // OCR first, page by page, so progress is visible. Vector PDF pages
      // are skipped (their text is real); one that hides a layer is
      // exported as a drawing, so it's read from that drawing (#52).
      let text: Record<string, OcrWord[]> | undefined
      if (settings.ocr) {
        text = {}
        const readable: { page: Page; asset: Asset; drawn?: Uint8Array }[] = []
        for (const page of pages) {
          const asset = assets[page.assetId]
          if (!asset) continue
          if (asset.format !== 'pdf') readable.push({ page, asset })
          else {
            const drawn = await deps.drawnPage(asset)
            if (drawn) readable.push({ page, asset, drawn })
          }
        }
        for (const [i, { page, asset, drawn }] of readable.entries()) {
          setStatus(`Reading text on page ${i + 1} of ${readable.length}…`)
          setExporting({ busy: true, done: i, total: readable.length, phase: 'ocr' })
          text[page.id] = await deps.recognizeText(asset, page, drawn)
        }
      }
      // Pages the export finds it must draw after all are read then.
      const readDrawn = settings.ocr
        ? async (assetId: string, jpeg: Uint8Array) => {
            const words: Record<string, OcrWord[]> = {}
            const asset = assets[assetId]
            if (!asset) return words
            const reading = pages.filter((p) => p.assetId === assetId)
            for (const [i, page] of reading.entries()) {
              setStatus(`Reading text on drawn page ${i + 1} of ${reading.length}…`)
              setExporting({ busy: true, done: i, total: reading.length, phase: 'ocr' })
              words[page.id] = await deps.recognizeText(asset, page, jpeg)
            }
            // The build runs again next.
            setStatus('Building PDF…')
            setExporting({ busy: true, done: 0, total: pages.length })
            return words
          }
        : undefined
      setStatus('Building PDF…')
      const result = await deps.exportPdf(
        doc,
        (done, total, attempt) => {
          setExporting({ busy: true, done, total, attempt })
        },
        {
          ...(lockPassword ? { password: lockPassword } : {}),
          ...(text ? { text } : {}),
          ...(readDrawn ? { readDrawn } : {}),
        },
      )
      const filename = pdfFilename(settings.title)
      deps.download(result.blob, filename)
      const size = formatBytes(result.blob.size)
      const used = result.compression ? `${result.compression.dpi} dpi` : 'original images'
      setLastExport({ size, used, fits: result.fits })
      setStatus(
        `Saved ${filename} (${size}, ${used}${text ? ', searchable' : ''}${lockPassword ? ', password-protected' : ''}).`,
      )
      if (!result.fits && settings.maxBytes !== null) {
        notify(
          `Couldn’t get under ${formatBytes(settings.maxBytes)}: the smallest version is ${size} at ${used}. It was saved anyway.`,
        )
      }
    } catch (error) {
      notify(
        isStaleBuild(error)
          ? STALE_BUILD_MESSAGE
          : `The PDF couldn’t be built: ${error instanceof Error ? error.message : String(error)}`,
      )
      setStatus('Export failed.')
    } finally {
      setExporting({ busy: false, done: 0, total: 0 })
    }
  }, [
    deps,
    doc,
    notify,
    pages,
    assets,
    settings.title,
    settings.maxBytes,
    settings.ocr,
    lockPassword,
    passwordError,
  ])

  const onRotate = useCallback(
    (id: string, by: -1 | 1) => {
      act({ type: 'rotatePage', id, by })
    },
    [act],
  )
  const onRemove = useCallback(
    (id: string) => {
      const index = pages.findIndex((p) => p.id === id)
      const rest = pages.filter((p) => p.id !== id)
      // The next page takes its place (else the previous); focus goes to it,
      // and so does the selection if the removed page had it.
      const neighbour = rest[Math.min(index, rest.length - 1)]
      act({ type: 'removePage', id })
      if (selectedId === id) setSelectedId(neighbour?.id ?? null)
      requestFocus(neighbour?.id ?? null, true)
      announce(`Removed page ${index + 1}. Undo to bring it back.`)
    },
    [act, announce, pages, requestFocus, selectedId],
  )
  const onMove = useCallback(
    (from: number, to: number) => {
      act({ type: 'movePage', from, to })
    },
    [act],
  )
  const onSettings = useCallback(
    (patch: Partial<Settings>) => {
      // Typing a title shouldn't create an undo step per keystroke.
      act({ type: 'setSettings', patch }, 'title' in patch ? 'title' : undefined)
    },
    [act],
  )

  const selectedAsset = selected ? assets[selected.assetId] : undefined

  const [straightening, setStraightening] = useState(false)
  /**
   * Estimates each page's skew from its thumbnail and sets Straighten to
   * level it, as one undo step. Pages with no clear lines are left alone and
   * counted in the status.
   */
  const autoStraighten = useCallback(
    async (ids: string[]) => {
      setStraightening(true)
      setStatus('Looking for lines…')
      const started = generation.current
      try {
        const patches: { id: string; patch: { angle: number } }[] = []
        let unclear = 0
        for (const id of ids) {
          const page = pages.find((p) => p.id === id)
          const asset = page ? assets[page.assetId] : undefined
          if (!asset) continue
          const skew = await deps.estimateSkew(asset)
          if (skew) patches.push({ id, patch: { angle: skew.angle } })
          else unclear += 1
          // Let the page paint between pages of a long document.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        if (generation.current !== started) return
        act({ type: 'transformPages', patches })
        const one = ids.length === 1
        // One page with no lines gets a visible notice, which is announced
        // itself; the status is cleared so it isn't said twice.
        setStatus(
          one
            ? patches[0]
              ? `Straightened by ${patches[0].patch.angle > 0 ? '+' : ''}${patches[0].patch.angle.toFixed(1)}°.`
              : ''
            : `Straightened ${patches.length} of ${ids.length} pages.${
                unclear === 1
                  ? ' 1 page had no clear lines and was left as it is.'
                  : unclear > 1
                    ? ` ${unclear} pages had no clear lines and were left as they are.`
                    : ''
              }`,
        )
        if (one && !patches[0])
          notify('No clear lines found on this page, so it was left as it is.')
      } finally {
        setStraightening(false)
      }
    },
    [act, assets, deps, notify, pages],
  )

  const [autoCropping, setAutoCropping] = useState(false)
  /**
   * Finds the paper in every photo not yet cropped and crops to it, as one
   * undo step. Pages already cropped keep their corners; pages with no clear
   * sheet are left alone and counted in the status. PDF pages can't be
   * cropped and aren't counted.
   */
  const autoCropAll = useCallback(async () => {
    setAutoCropping(true)
    setStatus('Looking for the paper…')
    const started = generation.current
    try {
      const photos = pages.filter((p) => {
        const asset = assets[p.assetId]
        return asset && !isVector(asset)
      })
      const todo = photos.filter((p) => p.corners === null)
      if (todo.length === 0) {
        setStatus('Every page is already cropped.')
        return
      }
      const patches: { id: string; patch: { corners: Quad } }[] = []
      for (const page of todo) {
        const asset = assets[page.assetId]
        if (!asset) continue
        const corners = await deps.findPaper(asset)
        if (corners) patches.push({ id: page.id, patch: { corners } })
      }
      if (generation.current !== started) return
      act({ type: 'transformPages', patches })
      const unclear = todo.length - patches.length
      const kept = photos.length - todo.length
      setStatus(
        [
          `Cropped ${patches.length} of ${plural(todo.length, 'page')} to the paper.`,
          unclear === 1
            ? '1 page had no clear edges and was left as it is.'
            : unclear > 1
              ? `${unclear} pages had no clear edges and were left as they are.`
              : '',
          kept === 1
            ? '1 page you had already cropped was kept.'
            : kept > 1
              ? `${kept} pages you had already cropped were kept.`
              : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
    } finally {
      setAutoCropping(false)
    }
  }, [act, assets, deps, pages])

  const inspectorActions = useMemo<InspectorActions | null>(() => {
    if (!selected) return null
    const id = selected.id
    return {
      onTransform: (patch, gesture) => {
        act({ type: 'transformPage', id, patch }, gesture)
      },
      onGestureEnd: endGesture,
      onRotate: (by) => {
        act({ type: 'rotatePage', id, by })
      },
      onMove: (by) => {
        act({ type: 'movePage', from: selectedIndex, to: selectedIndex + by })
        announce(`Moved to position ${selectedIndex + by + 1} of ${pages.length}.`)
      },
      onDuplicate: () => {
        const newId = deps.newId()
        act({ type: 'duplicatePage', id, newId })
        setSelectedId(newId)
      },
      onReset: () => {
        act({ type: 'resetPage', id })
      },
      onApplyToAll: () => {
        act({ type: 'applyToAll', id })
        setStatus(`Applied this page’s rotation, scale and filter to all ${pages.length} pages.`)
      },
      onRemove: () => {
        onRemove(id)
      },
      onAutoStraighten: (scope) => {
        void autoStraighten(scope === 'all' ? pages.map((p) => p.id) : [id])
      },
      onFindPaper: () => (selectedAsset ? deps.findPaper(selectedAsset) : Promise.resolve(null)),
      onAutoCropAll: () => {
        void autoCropAll()
      },
    }
  }, [
    act,
    announce,
    autoCropAll,
    autoStraighten,
    deps,
    endGesture,
    onRemove,
    pages,
    selected,
    selectedAsset,
    selectedIndex,
  ])

  const estimate = useMemo(
    () =>
      estimateBytes(
        pages.flatMap((page) => {
          const asset = assets[page.assetId]
          return asset
            ? [{ asset, drawnWidthPt: layoutPage(settings, asset, page).image.width }]
            : []
        }),
        compressionFor(settings.quality),
      ),
    [assets, pages, settings],
  )

  /**
   * Start over (#29): an empty document with no undo history, and nothing
   * kept for the old one: bytes, thumbnails, previews, recognised text, the
   * password. Page setup is a preference and stays; the title is per
   * document, so it goes back to the default with everything else unsaved.
   */
  const onStartOver = useCallback(() => {
    const count = pages.length
    generation.current += 1
    reset(loadSettings(deps.storage, deps.locale))
    assetStore.clear()
    forgetPageThumbs()
    forgetPageWords()
    forgetLayered()
    setSelectedId(null)
    setPassword('')
    setLastExport(null)
    setNotices([])
    requestFocus(null, true)
    announce(
      `Started over: removed ${plural(count, 'page')} and the undo history. Add files to begin again.`,
    )
  }, [announce, deps.locale, deps.storage, pages.length, requestFocus, reset])

  const workspace = pages.length > 0 || importing !== null

  return (
    // On a wide screen the window never scrolls: the header stays put and the
    // page grid and the inspector scroll on their own. On narrower screens the
    // page scrolls as usual and the header scrolls with it.
    <div className="relative flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header>
        {workspace ? (
          <DocumentBar
            settings={settings}
            pageCount={pages.length}
            canUndo={canUndo}
            canRedo={canRedo}
            exporting={exporting}
            onSettings={onSettings}
            onUndo={onUndo}
            onRedo={onRedo}
            onRotateAll={(by) => {
              act({ type: 'rotateAll', by })
            }}
            onStartOver={onStartOver}
            busy={importing !== null || straightening || autoCropping}
            onAdd={chooseFiles}
            onExport={() => void onExport()}
            estimate={estimate}
            lastExport={lastExport}
            password={password}
            onPassword={setPassword}
            passwordError={passwordError}
          />
        ) : undefined}
      </Header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {!workspace ? (
          <div className="scroll-pane lg:overflow-y-auto">
            <EmptyState onChoose={chooseFiles} />
            <Footer />
          </div>
        ) : (
          <>
            <h1 className="sr-only">Collated: arrange pages and export a PDF</h1>
            <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col lg:flex-row">
              <section
                aria-label="Pages"
                className="scroll-pane min-w-0 flex-1 px-4 py-6 sm:px-6 lg:overflow-y-auto lg:overscroll-contain lg:px-8"
              >
                {importing && (
                  <p className="label mb-4 text-ink-faint" aria-hidden="true">
                    Reading file {importing.file} of {importing.files}
                    {importing.pages &&
                      ` · page ${importing.pages.done} of ${importing.pages.total}`}
                    …
                  </p>
                )}
                <PageGrid
                  pages={pages}
                  assets={assets}
                  settings={settings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onRotate={onRotate}
                  onRemove={onRemove}
                  onMove={onMove}
                />
              </section>
              <aside
                ref={rail}
                aria-label="Selected page"
                className="scroll-pane border-t border-rule px-4 py-6 sm:px-6 lg:mr-4 lg:mb-4 lg:w-[23rem] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:rounded-[1.125rem] lg:border-t-0 lg:bg-paper lg:px-6 lg:shadow-panel"
              >
                {selected && selectedAsset && inspectorActions ? (
                  <Inspector
                    page={selected}
                    asset={selectedAsset}
                    index={selectedIndex}
                    count={pages.length}
                    settings={settings}
                    actions={inspectorActions}
                    straightening={straightening}
                    autoCropping={autoCropping}
                  />
                ) : (
                  <p className="text-sm text-ink-muted">
                    Select a page to rotate, straighten or scale it.
                  </p>
                )}
              </aside>
            </div>
          </>
        )}
      </main>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,.heic,.heif,application/pdf,.pdf"
        multiple
        hidden
        data-testid="file-input"
        onChange={(event) => {
          const files = filesFrom(event.target.files)
          event.target.value = ''
          void addFiles(files)
        }}
      />
      <p id="status" className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <DropOverlay active={dragging} />
      <Notices
        items={notices}
        onDismiss={(id) => {
          setNotices((list) => list.filter((n) => n.id !== id))
        }}
        onDismissAll={() => {
          setNotices([])
        }}
      />
    </div>
  )
}
