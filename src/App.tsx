import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Asset, QuarterTurns, Settings, SheetKind, Slot } from './core/model'
import { SHEET_CAPACITY, isVector, pictureKey, picturesOf } from './core/model'
import { partFilename, pdfFilename, zipFilename } from './core/filename'
import { compressionFor, estimateBytes } from './core/compression'
import type { Skew } from './core/deskew'
import { skewOf } from './lib/skew'
import { looksBlank } from './lib/blank'
import { useBlankPages } from './hooks/useBlankPages'
import { paperOf } from './lib/paper'
import { pageOrientation } from './lib/orientation'
import { describeAutoRotate, uprightTurns, type Osd } from './core/orientation'
import type { Quad } from './core/perspective'
import { forgetPageWords, pageWords } from './lib/pageText'
import { forgetPageThumbs } from './hooks/usePageThumb'
import { useTouchDevice } from './hooks/useTouchDevice'
import { forgetLayered, layeredImage } from './export/layered'
import type { OcrWord } from './core/textLayer'
import type { SplitPart } from './core/splitBuild'
import { buildOutline, sectionBefore, type OutlineItem } from './core/outline'
import { layoutSheet } from './core/geometry'
import { formatBytes } from './core/units'
import { describeChange } from './core/describeChange'
import { duplexGroups } from './core/order'
import { DocumentBar, type ExportState } from './components/DocumentBar'
import type { Arrange } from './components/MoreMenu'
import { DropOverlay, EmptyState, Footer, Header, Notices, type Notice } from './components/Chrome'
import { Inspector, type InspectorActions } from './components/Inspector'
import { PageGrid } from './components/PageGrid'
import { GroupInspector, type GroupActions } from './components/GroupInspector'
import { SelectionBar } from './components/SelectionBar'
import { BlankPagesBar } from './components/BlankPagesBar'
import { ShareConfirm } from './components/ShareConfirm'
import { SheetInspector, type SheetActions } from './components/SheetInspector'
import {
  EMPTY_SELECTION,
  blockDropIndex,
  keepExisting,
  pick,
  selectAll,
  type PickMode,
  type Selection,
} from './core/selection'
import { DEFAULT_TRANSFORM } from './core/model'
import { DEFAULT_SPLIT, pagesUsed, planExport, type SplitOptions } from './core/split'
import { download as saveFile, exportPdf, prepareExport, type Exported } from './export/exportPdf'
import { STALE_BUILD_MESSAGE, isStaleBuild } from './lib/staleBuild'
import { listenForIncoming, type Incoming } from './lib/incoming'
import { assetStore } from './import/assetStore'
import { ImportError, importFile, type Imported } from './import/importFile'
import { loadKeepWork, loadSettings, saveKeepWork, saveSettings } from './state/settingsStorage'
import { deviceWorkStore, type SavedSummary, type WorkStore } from './state/workStore'
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
      /** Several files, as one ZIP (#66); see exportPdf.ts. */
      parts?: SplitPart[]
      /** Bookmarks for a single file (#75); each part carries its own. */
      outline?: OutlineItem[]
    },
  ) => Promise<Exported>
  download: (blob: Blob, filename: string) => void
  newId: () => string
  estimateSkew: (asset: Asset) => Promise<Skew | null>
  /** Whether a page looks blank (#68); null if it can't tell. */
  detectBlank: (asset: Asset, picture: Slot) => Promise<boolean | null>
  /** The paper's corners in a photo, to suggest as its crop (null: no clear sheet). */
  findPaper: (asset: Asset) => Promise<Quad | null>
  /** Which way up a picture's text is, as displayed (null: too little text to tell). */
  detectOrientation: (asset: Asset, picture: Slot) => Promise<Osd | null>
  /**
   * Recognises a page's words (fractions of its content image); from
   * `drawn` instead for a PDF page exported as a drawing.
   */
  recognizeText: (asset: Asset, page: Slot, drawn?: Uint8Array) => Promise<OcrWord[]>
  /** A PDF page drawn as the preview shows it, if it hides a layer (else null). */
  drawnPage: (asset: Asset) => Promise<Uint8Array | null>
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  locale: string
  /** Loads the export code ahead of time (see exportPdf.ts). */
  prepareExport: () => void
  /** The document kept on this device across a reload (#74). */
  work: WorkStore
  /** Files shared to Collated or opened with it (#73); returns the unsubscribe. */
  incoming: (fn: (incoming: Incoming) => void) => () => void
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
  detectBlank: looksBlank,
  findPaper: paperOf,
  detectOrientation: pageOrientation,
  recognizeText: pageWords,
  drawnPage: (asset) => layeredImage(asset),
  storage: safeStorage(),
  locale: navigator.language,
  prepareExport,
  work: deviceWorkStore(),
  incoming: listenForIncoming,
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Image files from a drop or paste; directories and non-files are skipped. */
const filesFrom = (list: FileList | null | undefined): File[] =>
  list ? Array.from(list).filter((file) => file.size > 0 || file.type !== '') : []

/**
 * Camera shots arrive as "image.jpg" every time on iOS (a number on Android),
 * so name each by when it was taken: "Photo 14.03.22.jpg". Same bytes, type
 * and date; the type is read from the bytes anyway.
 */
const namePhoto = (file: File): File => {
  const at = new Date(file.lastModified)
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('.')
  const ext = /\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? ''
  return new File([file], `Photo ${time}${ext}`, {
    type: file.type,
    lastModified: file.lastModified,
  })
}

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
  const {
    doc,
    history,
    previous,
    next,
    act,
    undo,
    redo,
    canUndo,
    canRedo,
    endGesture,
    reset,
    restore,
  } = useDocument(() => loadSettings(deps.storage, deps.locale))
  // Not part of the document: selecting isn't an edit, and undo leaves it be.
  const [rawSelection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  /** Select mode (#65): taps toggle pages, for touch. */
  const [selecting, setSelecting] = useState(false)
  const selectOnly = useCallback((id: string | null) => {
    setSelection(id ? { ids: [id], anchor: id } : EMPTY_SELECTION)
  }, [])
  const [importing, setImporting] = useState<{
    file: number
    files: number
    /** Pages read so far of a multi-page PDF. */
    pages?: { done: number; total: number }
  } | null>(null)
  const [exporting, setExporting] = useState<ExportState>({ busy: false, done: 0, total: 0 })
  // In memory only: never in settings, storage or undo history.
  const [password, setPassword] = useState('')
  /** Which pages to export, and into how many files (#66). Per document, so not saved. */
  const [split, setSplit] = useState<SplitOptions>(DEFAULT_SPLIT)
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
  const [keepWork, setKeepWork] = useState(() => loadKeepWork(deps.storage))
  /**
   * Last visit's document, offered until it's restored or discarded; `pending`
   * until we've looked. Nothing is saved meanwhile, so the empty document
   * this page starts with can't overwrite it.
   */
  const [offer, setOffer] = useState<SavedSummary | null | 'pending'>(() =>
    keepWork ? 'pending' : null,
  )
  const [restoring, setRestoring] = useState(false)
  /** The browser refused to store this document (quota): stop trying until Start over. */
  const tooBig = useRef(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const touch = useTouchDevice()
  // The inspector scrolls on its own; a newly selected page starts at its top.
  const rail = useRef<HTMLElement>(null)
  const { pages, assets, settings } = doc
  // Undo can remove selected pages; those simply drop out of the selection.
  const selection = useMemo(() => keepExisting(pages, rawSelection), [pages, rawSelection])
  const group = selection.ids.length > 1
  const plan = useMemo(
    () => planExport(pages, selection.ids, split, settings.pageNumbers.start),
    [pages, selection.ids, split, settings.pageNumbers.start],
  )
  /** The pages the export takes, each once, in document order. */
  const exportPages = useMemo(() => {
    if ('error' in plan) return []
    const used = new Set(pagesUsed(plan))
    return pages.filter((p) => used.has(p.id))
  }, [pages, plan])
  const selectedId = group ? null : (selection.ids[0] ?? null)
  const railKey = group ? 'group' : selectedId
  useLayoutEffect(() => {
    // Not while focus is in the inspector (Duplicate selects the copy, and its
    // button must stay in view; WCAG 2.4.11).
    const el = rail.current
    if (el && !el.contains(document.activeElement)) el.scrollTop = 0
  }, [railKey])
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

  const selectedIndex = pages.findIndex((p) => p.id === selectedId)
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

  // Is there a document from last time to offer?
  useEffect(() => {
    if (!keepWork) return
    let live = true
    void deps.work.peek().then((saved) => {
      if (live) setOffer((current) => (current === 'pending' ? saved : current))
    })
    return () => {
      live = false
    }
    // Turning the setting on later finds `offer` already settled: it saves instead.
  }, [deps.work, keepWork])

  // Keep the document on this device as it changes: shortly after each
  // change, and straight away when the tab is hidden (a phone switching apps
  // may never bring it back).
  const saving = offer === null && keepWork
  /** The page selected when saved, selected again on restore (one page is enough). */
  const keptSelection = selection.anchor ?? selection.ids[0] ?? null
  useEffect(() => {
    if (!saving || tooBig.current) return
    let pending = true
    const save = () => {
      if (!pending) return
      pending = false
      void deps.work.save(history, keptSelection).then((result) => {
        if (result !== 'too-big' || tooBig.current) return
        tooBig.current = true
        notify(
          'This document is too large for this browser to keep on this device, so it won’t come back after a reload. Export it before you close the tab.',
        )
      })
    }
    const timer = setTimeout(save, 400)
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
    }
  }, [deps.work, history, keptSelection, notify, saving])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      // Adding files instead of restoring starts a new document; it replaces
      // the saved one once it's saved. Also before we've looked: a late answer
      // then finds the offer settled and is dropped.
      setOffer(null)
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
        // Images added together are one pile for Interleave (a PDF is its
        // own); the first one's id names the batch.
        const batch = added.find((a) => a.format !== 'pdf')?.id
        const tagged = added.map((a) =>
          a.format === 'pdf' || !batch ? a : { ...a, source: batch },
        )
        act({ type: 'addPages', assets: tagged, pageIds })
        setSelection((current) => {
          const first = pageIds[0]
          return current.ids.length > 0 || !first ? current : { ids: [first], anchor: first }
        })
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
      const index = pages.findIndex((p) => p.id === (from ?? selection.anchor))
      const target = to.pages[Math.min(Math.max(index, 0), to.pages.length - 1)]
      requestFocus(target?.id ?? null, false)
      // If every selected page is going away, select the one taking its place.
      if (selection.ids.length > 0 && keepExisting(to.pages, selection).ids.length === 0) {
        selectOnly(target?.id ?? null)
      }
    },
    [pages, requestFocus, selectOnly, selection],
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

  const announceSelection = useCallback(
    (next: Selection) => {
      const n = next.ids.length
      announce(
        n === 0
          ? 'No pages selected.'
          : n === pages.length && n > 1
            ? `All ${n} pages selected.`
            : `${plural(n, 'page')} selected.`,
      )
    },
    [announce, pages.length],
  )
  const onSelect = useCallback(
    (id: string, mode: PickMode) => {
      const next = pick(pages, selection, id, mode)
      setSelection(next)
      // A plain click shows the page in the inspector, which says enough.
      if (mode !== 'only') announceSelection(next)
    },
    [announceSelection, pages, selection],
  )
  const clearGroup = useCallback(() => {
    // Back to the page last picked, so the inspector (and focus in it) stays.
    const keep = selection.anchor ?? selection.ids[0] ?? null
    selectOnly(keep)
    setSelecting(false)
    announce('Selection cleared.')
  }, [announce, selectOnly, selection])
  /** A page is being dragged; Escape is the drag's (it cancels it). */
  const draggingPage = useRef(false)

  // Keyboard undo/redo, Alt+T to the toolbar, select all, and Escape for the
  // selection or the latest notice.
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
        if (
          event.defaultPrevented ||
          popoverOpen() ||
          isEditable(event.target) ||
          draggingPage.current
        ) {
          return
        }
        if (group || selecting) clearGroup()
        else dismissLatest()
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || isEditable(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'a' && !event.shiftKey) {
        // Everywhere but text: the page has nothing else worth selecting.
        if (pages.length === 0) return
        const next = selectAll(pages, selection)
        setSelection(next)
        announceSelection(next)
      } else if (key === 'z' && !event.shiftKey) onUndo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') onRedo()
      else return
      event.preventDefault()
    }
    // Capture, so a popover's own Escape hasn't closed it yet when we look.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [
    announceSelection,
    clearGroup,
    dismissLatest,
    group,
    onUndo,
    onRedo,
    pages,
    selecting,
    selection,
  ])

  const chooseFiles = useCallback(() => {
    fileInput.current?.click()
  }, [])
  const takePhoto = useCallback(() => {
    cameraInput.current?.click()
  }, [])

  // Normalised so the same password typed on another keyboard or system
  // (composed vs decomposed accents, full-width forms) opens the file.
  const lockPassword = password.normalize('NFKC')
  const passwordError =
    new TextEncoder().encode(lockPassword).length > PASSWORD_MAX_BYTES
      ? `Too long: a PDF password can use at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} plain letters, fewer with accents or other scripts), and anything after that would be silently ignored.`
      : null

  const onExport = useCallback(async () => {
    if (passwordError || 'error' in plan) return
    const total = plan.parts.reduce((n, part) => n + part.pageIds.length, 0)
    const byId = new Map(pages.map((p) => [p.id, p]))
    /** A file's bookmarks: it opens under the section its first page is in. */
    const outlineOf = (pageIds: readonly string[]) => {
      const [first] = pageIds
      return buildOutline(
        pageIds.flatMap((id) => byId.get(id) ?? []),
        assets,
        {
          files: settings.bookmarkFiles,
          carried: first === undefined ? null : sectionBefore(pages, first),
        },
      )
    }
    // One file is built as before, from just its pages; several go to the
    // worker as parts and come back as one ZIP.
    const [single] = plan.parts.length === 1 ? plan.parts : []
    const outline = single ? outlineOf(single.pageIds) : []
    const parts = single
      ? undefined
      : plan.parts.map((part, i) => {
          const own = outlineOf(part.pageIds)
          return {
            name: partFilename(settings.title, i, plan.parts.length),
            pageIds: part.pageIds,
            start: part.start,
            ...(own.length ? { outline: own } : {}),
          }
        })
    const exportDoc = single
      ? {
          ...doc,
          pages: single.pageIds.flatMap((id) => byId.get(id) ?? []),
          settings: {
            ...settings,
            pageNumbers: { ...settings.pageNumbers, start: single.start },
          },
        }
      : { ...doc, pages: exportPages }
    setExporting({ busy: true, done: 0, total })
    setStatus('Building PDF…')
    try {
      // OCR first, page by page, so progress is visible. Vector PDF pages
      // are skipped (their text is real); one that hides a layer is
      // exported as a drawing, so it's read from that drawing (#52).
      let text: Record<string, OcrWord[]> | undefined
      if (settings.ocr) {
        text = {}
        // Each picture of a combined page is read on its own (#76).
        const readable: { key: string; slot: Slot; asset: Asset; drawn?: Uint8Array }[] = []
        for (const page of exportPages) {
          for (const [i, slot] of picturesOf(page).entries()) {
            const asset = assets[slot.assetId]
            if (!asset) continue
            const key = pictureKey(page, i)
            if (asset.format !== 'pdf') readable.push({ key, slot, asset })
            else {
              const drawn = await deps.drawnPage(asset)
              if (drawn) readable.push({ key, slot, asset, drawn })
            }
          }
        }
        for (const [i, { key, slot, asset, drawn }] of readable.entries()) {
          setStatus(`Reading text on picture ${i + 1} of ${readable.length}…`)
          setExporting({ busy: true, done: i, total: readable.length, phase: 'ocr' })
          text[key] = await deps.recognizeText(asset, slot, drawn)
        }
      }
      // Pages the export finds it must draw after all are read then.
      const readDrawn = settings.ocr
        ? async (assetId: string, jpeg: Uint8Array) => {
            const words: Record<string, OcrWord[]> = {}
            const asset = assets[assetId]
            if (!asset) return words
            const reading = exportPages.flatMap((page) =>
              picturesOf(page).flatMap((slot, i) =>
                slot.assetId === assetId ? [{ key: pictureKey(page, i), slot }] : [],
              ),
            )
            for (const [i, { key, slot }] of reading.entries()) {
              setStatus(`Reading text on drawn page ${i + 1} of ${reading.length}…`)
              setExporting({ busy: true, done: i, total: reading.length, phase: 'ocr' })
              words[key] = await deps.recognizeText(asset, slot, jpeg)
            }
            // The build runs again next.
            setStatus('Building PDF…')
            setExporting({ busy: true, done: 0, total })
            return words
          }
        : undefined
      setStatus('Building PDF…')
      const result = await deps.exportPdf(
        exportDoc,
        (done, total, attempt) => {
          setExporting({ busy: true, done, total, attempt })
        },
        {
          ...(lockPassword ? { password: lockPassword } : {}),
          ...(text ? { text } : {}),
          ...(readDrawn ? { readDrawn } : {}),
          ...(parts ? { parts } : {}),
          ...(outline.length ? { outline } : {}),
        },
      )
      const filename = parts ? zipFilename(settings.title) : pdfFilename(settings.title)
      deps.download(result.blob, filename)
      const size = formatBytes(result.blob.size)
      const used = result.compression ? `${result.compression.dpi} dpi` : 'original images'
      setLastExport({ size, used, fits: result.fits })
      setStatus(
        `Saved ${filename} (${parts ? `${String(parts.length)} PDFs, ` : ''}${size}, ${used}${text ? ', searchable' : ''}${lockPassword ? ', password-protected' : ''}).`,
      )
      if (!result.fits && settings.maxBytes !== null) {
        notify(
          parts
            ? `Couldn’t get every file under ${formatBytes(settings.maxBytes)}, even at ${used}. They were saved anyway.`
            : `Couldn’t get under ${formatBytes(settings.maxBytes)}: the smallest version is ${size} at ${used}. It was saved anyway.`,
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
  }, [deps, doc, notify, pages, assets, settings, plan, exportPages, lockPassword, passwordError])

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
      if (selection.ids.length === 1 && selection.ids[0] === id) selectOnly(neighbour?.id ?? null)
      requestFocus(neighbour?.id ?? null, true)
      announce(`Removed page ${index + 1}. Undo to bring it back.`)
    },
    [act, announce, pages, requestFocus, selectOnly, selection],
  )
  const onMove = useCallback(
    (from: number, to: number) => {
      act({ type: 'movePage', from, to })
    },
    [act],
  )
  const onMoveSelected = useCallback(
    (from: number, to: number) => {
      const at = blockDropIndex(pages, selection.ids, from, to)
      act({ type: 'movePages', ids: selection.ids, at })
    },
    [act, pages, selection.ids],
  )
  const onSettings = useCallback(
    (patch: Partial<Settings>) => {
      // Typing a title shouldn't create an undo step per keystroke.
      act({ type: 'setSettings', patch }, 'title' in patch ? 'title' : undefined)
    },
    [act],
  )

  const { blankIds, checking: checkingBlank } = useBlankPages(pages, assets, deps.detectBlank)
  // Said once a check settles, when it finds pages not flagged before (so
  // undoing their removal doesn't say it again over the undo).
  const saidBlank = useRef(new Set<string>())
  useEffect(() => {
    if (checkingBlank) return
    if (blankIds.every((id) => saidBlank.current.has(id))) return
    for (const id of blankIds) saidBlank.current.add(id)
    const n = blankIds.length
    announce(
      `${n === 1 ? '1 page looks' : `${n} pages look`} blank. You can remove ${n === 1 ? 'it' : 'them'} from above the pages.`,
    )
  }, [announce, blankIds, checkingBlank])
  const onRemoveBlank = useCallback(() => {
    const ids = blankIds
    const gone = new Set(ids)
    const first = pages.findIndex((p) => gone.has(p.id))
    const rest = pages.filter((p) => !gone.has(p.id))
    const neighbour = rest[Math.min(first, rest.length - 1)]
    act({ type: 'removePages', ids })
    // Selected blank pages drop out of the selection; if that empties it,
    // the page that took the first one's place is selected instead.
    if (selection.ids.every((id) => gone.has(id))) selectOnly(neighbour?.id ?? null)
    requestFocus(neighbour?.id ?? null, true)
    announce(
      `Removed ${ids.length === 1 ? '1 blank page' : `${ids.length} blank pages`}. Undo to bring ${ids.length === 1 ? 'it' : 'them'} back.`,
    )
  }, [act, announce, blankIds, pages, requestFocus, selectOnly, selection.ids])
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
          // A combined page's pictures are straightened before combining.
          const asset = page && !page.sheet ? assets[page.assetId] : undefined
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
      // Combined pages are skipped: their pictures are cropped before combining.
      const photos = pages.filter((p) => {
        const asset = p.sheet ? undefined : assets[p.assetId]
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

  const [rotating, setRotating] = useState(false)
  /** The pages as they are now, for work that outlasts a render (auto-rotate). */
  const pagesRef = useRef(pages)
  useLayoutEffect(() => {
    pagesRef.current = pages
  }, [pages])
  /**
   * Reads which way up each page's text is and adds the quarter turns that
   * bring it upright, as one undo step. Pages with too little text are left
   * alone; the status names the pages it turned. Opt-in: the first run
   * downloads the orientation engine.
   */
  const autoRotate = useCallback(
    async (ids: string[]) => {
      setRotating(true)
      setStatus('Finding which way up each page is…')
      const started = generation.current
      try {
        // A combined page's pictures are read one by one: an ID card's back
        // can be upside down when its front isn't.
        const found: { id: string; from: readonly QuarterTurns[]; by: (QuarterTurns | null)[] }[] =
          []
        let upright = 0
        let unclear = 0
        for (const id of ids) {
          const page = pages.find((p) => p.id === id)
          if (!page) continue
          const pictures = picturesOf(page)
          const by: (QuarterTurns | null)[] = []
          for (const picture of pictures) {
            const asset = assets[picture.assetId]
            by.push(asset ? uprightTurns(await deps.detectOrientation(asset, picture)) : null)
            if (generation.current !== started) return
          }
          if (by.some((t) => t !== null && t !== 0))
            found.push({ id, from: pictures.map((p) => p.turns), by })
          else if (by.every((t) => t === null)) unclear += 1
          else upright += 1
        }
        // Reading takes seconds a page: a page turned, moved or removed by
        // hand meanwhile keeps what was done to it.
        const now = pagesRef.current
        const patches: { id: string; slot?: number; patch: { turns: QuarterTurns } }[] = []
        const turned: number[] = []
        let kept = 0
        for (const { id, from, by } of found) {
          const index = now.findIndex((p) => p.id === id)
          const page = now[index]
          if (!page) continue
          const pictures = picturesOf(page)
          if (pictures.length !== from.length || pictures.some((p, i) => p.turns !== from[i])) {
            kept += 1
            continue
          }
          from.forEach((turns, slot) => {
            const add = by[slot]
            if (!add) return
            const patch = { turns: ((turns + add) % 4) as QuarterTurns }
            patches.push(page.sheet ? { id, slot, patch } : { id, patch })
          })
          turned.push(index + 1)
        }
        turned.sort((a, b) => a - b)
        act({ type: 'transformPages', patches })
        setStatus(describeAutoRotate({ turned, upright, unclear, kept }))
      } catch (error) {
        if (generation.current !== started) return
        notify(
          isStaleBuild(error)
            ? STALE_BUILD_MESSAGE
            : error instanceof Error
              ? error.message
              : String(error),
        )
        setStatus('')
      } finally {
        setRotating(false)
      }
    },
    [act, assets, deps, notify, pages],
  )

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
        selectOnly(newId)
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
      onSection: (title) => {
        act({ type: 'setSection', id, title }, `section:${id}`)
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
    selectOnly,
    selected,
    selectedAsset,
    selectedIndex,
  ])

  const groupActions = useMemo<GroupActions | null>(() => {
    if (!group) return null
    const ids = selection.ids
    // Only PDF content: a combined page with a photo on it takes the filter
    // (the reducer keeps it off its PDF pictures).
    const vector = (id: string) => {
      const page = pages.find((p) => p.id === id)
      return page ? picturesOf(page).every((slot) => assets[slot.assetId]?.format === 'pdf') : false
    }
    const n = ids.length
    return {
      onTransform: (patch, gesture) => {
        // Filters are for images; PDF pages keep their vector content.
        const targets = 'filter' in patch ? ids.filter((id) => !vector(id)) : ids
        act({ type: 'transformPages', patches: targets.map((id) => ({ id, patch })) }, gesture)
      },
      onGestureEnd: endGesture,
      onRotate: (by) => {
        act({ type: 'rotatePages', ids, by })
      },
      onShift: (by) => {
        act({ type: 'shiftPages', ids, by })
        announce(`Moved ${plural(n, 'page')} ${by < 0 ? 'earlier' : 'later'}.`)
      },
      onAutoStraighten: () => {
        void autoStraighten(ids)
      },
      onDuplicate: () => {
        const newIds = ids.map(() => deps.newId())
        act({ type: 'duplicatePages', ids, newIds })
        // The copies are selected, as with one page.
        setSelection({ ids: newIds, anchor: newIds[0] ?? null })
        announce(`Duplicated ${plural(n, 'page')}.`)
      },
      onReset: () => {
        act({
          type: 'transformPages',
          patches: ids.map((id) => ({ id, patch: DEFAULT_TRANSFORM })),
        })
      },
      onRemove: () => {
        const gone = new Set(ids)
        const first = pages.findIndex((p) => gone.has(p.id))
        const rest = pages.filter((p) => !gone.has(p.id))
        const neighbour = rest[Math.min(first, rest.length - 1)]
        act({ type: 'removePages', ids })
        selectOnly(neighbour?.id ?? null)
        setSelecting(false)
        requestFocus(neighbour?.id ?? null, true)
        announce(`Removed ${plural(n, 'page')}. Undo to bring them back.`)
      },
      onClear: () => {
        clearGroup()
        requestFocus(selection.anchor, true)
      },
      onCombine: (kind) => {
        const chosen = pages.filter((p) => ids.includes(p.id))
        const pictures = chosen.reduce((sum, p) => sum + picturesOf(p).length, 0)
        const made = Math.ceil(pictures / SHEET_CAPACITY[kind])
        const newIds = Array.from({ length: made }, () => deps.newId())
        act({ type: 'combinePages', ids, kind, newIds })
        // The new pages are selected: one shows in the inspector.
        setSelection({ ids: newIds, anchor: newIds[0] ?? null })
        setSelecting(false)
        requestFocus(newIds[0] ?? null, true)
        announce(
          `Combined ${plural(pictures, 'picture')} onto ${made === 1 ? 'one page' : `${String(made)} pages`}.`,
        )
      },
    }
  }, [
    act,
    announce,
    assets,
    autoStraighten,
    clearGroup,
    deps,
    endGesture,
    group,
    pages,
    requestFocus,
    selectOnly,
    selection,
  ])

  const sheetActions = useMemo<SheetActions | null>(() => {
    if (!selected?.sheet) return null
    const id = selected.id
    const { slots } = selected.sheet
    return {
      onKind: (kind: SheetKind) => {
        act({ type: 'setSheetKind', id, kind })
      },
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
        selectOnly(newId)
      },
      onSplit: () => {
        const newIds = slots.map(() => deps.newId())
        act({ type: 'splitPage', id, newIds })
        // The pictures, back as pages, stay selected together.
        setSelection({ ids: newIds, anchor: newIds[0] ?? null })
        requestFocus(newIds[0] ?? null, true)
        announce(`Split page ${selectedIndex + 1} into ${plural(newIds.length, 'page')}.`)
      },
      onRemove: () => {
        onRemove(id)
      },
      onSection: (title) => {
        act({ type: 'setSection', id, title }, `section:${id}`)
      },
      onGestureEnd: endGesture,
    }
  }, [
    act,
    announce,
    deps,
    endGesture,
    onRemove,
    pages.length,
    requestFocus,
    selectOnly,
    selected,
    selectedIndex,
  ])

  const estimate = useMemo(
    () =>
      estimateBytes(
        exportPages.flatMap((page) => {
          const pictures = picturesOf(page)
          if (pictures.some((slot) => !assets[slot.assetId])) return []
          const sheet = layoutSheet(settings, assets, page)
          return pictures.flatMap((slot, i) => {
            const asset = assets[slot.assetId]
            const layout = sheet.pictures[i]
            return asset && layout ? [{ asset, drawnWidthPt: layout.image.width }] : []
          })
        }),
        compressionFor(settings.quality),
      ),
    [assets, exportPages, settings],
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
    tooBig.current = false
    void deps.work.clear()
    assetStore.clear()
    forgetPageThumbs()
    forgetPageWords()
    forgetLayered()
    selectOnly(null)
    setSelecting(false)
    setPassword('')
    setSplit(DEFAULT_SPLIT)
    setLastExport(null)
    setNotices([])
    requestFocus(null, true)
    announce(
      `Started over: removed ${plural(count, 'page')} and the undo history. Add files to begin again.`,
    )
  }, [
    announce,
    deps.locale,
    deps.storage,
    deps.work,
    pages.length,
    requestFocus,
    reset,
    selectOnly,
  ])

  const onRestore = useCallback(async () => {
    if (restoring) return
    setRestoring(true)
    const saved = await deps.work.restore()
    setRestoring(false)
    setOffer(null)
    if (!saved) {
      void deps.work.clear()
      notify('The document saved on this device couldn’t be read back, so it was discarded.')
      return
    }
    const restored = saved.history.present.pages
    const select = restored.some((p) => p.id === saved.selectedId)
      ? saved.selectedId
      : (restored[0]?.id ?? null)
    restore(saved.history)
    selectOnly(select)
    requestFocus(select, true)
    announce(`Restored ${plural(restored.length, 'page')}.`)
  }, [announce, deps.work, notify, requestFocus, restore, restoring, selectOnly])

  // Files shared to Collated or opened with it (#73) join the work in
  // progress: a document kept from last time is restored first, never
  // replaced by files the person may not have known would replace it. Until
  // we know whether there is one, they wait in lib/incoming. Shared files
  // wait again, for the person to say they shared them (ShareConfirm).
  const settled = offer !== 'pending' && !restoring
  const [shared, setShared] = useState<File[]>([])
  const addIncoming = useCallback(
    async (files: File[]) => {
      if (offer) await onRestore()
      await addFiles(files)
    },
    [addFiles, offer, onRestore],
  )
  useEffect(() => {
    if (!settled) return
    return deps.incoming((incoming) => {
      if (!('files' in incoming)) {
        notify('Nothing was shared that Collated could add.')
        return
      }
      if (incoming.from === 'share') setShared((list) => [...list, ...incoming.files])
      else void addIncoming(incoming.files)
    })
  }, [addIncoming, deps, notify, settled])

  const onDiscard = useCallback(() => {
    setOffer(null)
    void deps.work.clear()
    announce('Discarded the saved document.')
  }, [announce, deps.work])

  const onKeepWork = useCallback(
    (keep: boolean) => {
      setKeepWork(keep)
      saveKeepWork(deps.storage, keep)
      tooBig.current = false
      if (!keep) void deps.work.clear()
      announce(
        keep
          ? 'Work is kept on this device, so a reload won’t lose it.'
          : 'Work is no longer kept on this device; the saved copy was deleted.',
      )
    },
    [announce, deps.storage, deps.work],
  )

  // With several pages selected, page order works on those alone.
  const orderScope = useMemo(() => (group ? selection.ids : undefined), [group, selection.ids])
  const duplex = useMemo(() => duplexGroups(doc, orderScope), [doc, orderScope])
  const onArrange = useCallback(
    (arrange: Arrange) => {
      if (arrange.type === 'interleave') {
        if (!duplex) return
        const { fronts, backs } = duplex
        act({ type: 'interleavePages', fronts, backs, backsReversed: arrange.backsReversed })
        const extra = Math.abs(fronts.length - backs.length)
        if (extra > 0) {
          const side = fronts.length > backs.length ? 'front' : 'back'
          notify(
            `There were ${plural(fronts.length, 'front')} and ${plural(backs.length, 'back')}: the extra ${extra === 1 ? `${side} is` : `${plural(extra, side)} are`} at the end.`,
          )
        }
        announce(
          `Interleaved ${plural(fronts.length + backs.length, 'page')}. Undo to put them back.`,
        )
      } else if (arrange.type === 'reverse') {
        act({ type: 'reversePages', ...(orderScope ? { ids: orderScope } : {}) })
        announce(orderScope ? 'Reversed the selected pages.' : 'Reversed the page order.')
      } else {
        act({ type: 'sortPages', by: arrange.by, ...(orderScope ? { ids: orderScope } : {}) })
        const what = orderScope ? 'Sorted the selected pages' : 'Sorted'
        announce(`${what} by ${arrange.by === 'name' ? 'file name' : 'date taken'}.`)
      }
    },
    [act, announce, duplex, notify, orderScope],
  )

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
            onAutoRotate={() => {
              void autoRotate(orderScope ?? pages.map((p) => p.id))
            }}
            rotating={rotating}
            duplex={duplex}
            orderScope={orderScope?.length ?? null}
            onArrange={onArrange}
            onStartOver={onStartOver}
            keepWork={keepWork}
            onKeepWork={onKeepWork}
            busy={importing !== null || straightening || autoCropping || rotating}
            onAdd={chooseFiles}
            {...(touch && { onTakePhoto: takePhoto })}
            onExport={() => void onExport()}
            estimate={estimate}
            lastExport={lastExport}
            password={password}
            onPassword={setPassword}
            passwordError={passwordError}
            split={split}
            onSplit={(patch) => {
              setSplit((current) => ({ ...current, ...patch }))
            }}
            selectedCount={selection.ids.length}
            plan={plan}
          />
        ) : undefined}
      </Header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {!workspace ? (
          <div className="scroll-pane lg:overflow-y-auto">
            <EmptyState
              onChoose={chooseFiles}
              {...(touch && { onTakePhoto: takePhoto })}
              restore={
                offer && offer !== 'pending'
                  ? {
                      ...offer,
                      busy: restoring,
                      onRestore: () => void onRestore(),
                      onDiscard,
                    }
                  : null
              }
            />
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
                {pages.length > 0 && (
                  <SelectionBar
                    count={pages.length}
                    selected={selection.ids.length}
                    selecting={selecting}
                    onSelecting={(on) => {
                      setSelecting(on)
                      announce(
                        on ? 'Select mode: tap pages to add or remove them.' : 'Select mode off.',
                      )
                    }}
                    onSelectAll={() => {
                      const next = selectAll(pages, selection)
                      setSelection(next)
                      announceSelection(next)
                    }}
                    onClear={() => {
                      setSelection(EMPTY_SELECTION)
                      announceSelection(EMPTY_SELECTION)
                    }}
                  />
                )}
                {blankIds.length > 0 && (
                  <BlankPagesBar
                    count={blankIds.length}
                    busy={importing !== null}
                    onSelect={() => {
                      const next = { ids: blankIds, anchor: blankIds[0] ?? null }
                      setSelection(next)
                      if (blankIds.length > 1) announceSelection(next)
                    }}
                    onRemove={onRemoveBlank}
                  />
                )}
                <PageGrid
                  pages={pages}
                  assets={assets}
                  settings={settings}
                  selectedIds={selection.ids}
                  blankIds={blankIds}
                  selecting={selecting}
                  onSelect={onSelect}
                  onRotate={onRotate}
                  onRemove={onRemove}
                  onMove={onMove}
                  onMoveSelected={onMoveSelected}
                  onDragging={(on) => {
                    draggingPage.current = on
                  }}
                />
              </section>
              <aside
                ref={rail}
                aria-label="Selected page"
                className="scroll-pane border-t border-rule px-4 py-6 sm:px-6 lg:mr-4 lg:mb-4 lg:w-[23rem] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:rounded-[1.125rem] lg:border-t-0 lg:bg-paper lg:px-6 lg:shadow-panel"
              >
                {groupActions ? (
                  <GroupInspector
                    pages={pages.filter((p) => selection.ids.includes(p.id))}
                    assets={assets}
                    indices={pages.flatMap((p, i) => (selection.ids.includes(p.id) ? [i] : []))}
                    count={pages.length}
                    actions={groupActions}
                    straightening={straightening}
                  />
                ) : selected?.sheet && sheetActions ? (
                  <SheetInspector
                    page={{ ...selected, sheet: selected.sheet }}
                    assets={assets}
                    index={selectedIndex}
                    count={pages.length}
                    settings={settings}
                    actions={sheetActions}
                  />
                ) : selected && selectedAsset && inspectorActions ? (
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
                    Select a page to rotate, straighten or scale it. Shift-click or ⌘/Ctrl-click to
                    select several.
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
      {/* Take photo (#72): `capture` hands off to the system camera, so it
          needs no camera permission (Permissions-Policy keeps camera=()).
          One shot per press; the button stays for the next page. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="camera-input"
        onChange={(event) => {
          const files = filesFrom(event.target.files).map(namePhoto)
          event.target.value = ''
          void addFiles(files)
        }}
      />
      <p id="status" className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {shared.length > 0 && (
        <ShareConfirm
          files={shared}
          onAdd={() => {
            setShared([])
            void addIncoming(shared)
          }}
          onDismiss={() => {
            setShared([])
            announce('The shared files were not added.')
          }}
        />
      )}
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
