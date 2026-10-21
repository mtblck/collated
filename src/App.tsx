import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, Settings } from './core/model'
import { pdfFilename } from './core/filename'
import { DocumentBar, type ExportState } from './components/DocumentBar'
import { DropOverlay, EmptyState, Header, Notices, type Notice } from './components/Chrome'
import { Inspector, type InspectorActions } from './components/Inspector'
import { PageGrid } from './components/PageGrid'
import { download as saveFile, exportPdf } from './export/exportPdf'
import { assetStore } from './import/assetStore'
import { ImportError, importImage, type Imported } from './import/importImage'
import { loadSettings, saveSettings } from './state/settingsStorage'
import { useDocument } from './state/useDocument'
import type { DocState } from './core/model'

export interface AppDeps {
  importImage: (file: File, id: string) => Promise<Imported>
  exportPdf: (doc: DocState, onProgress: (done: number, total: number) => void) => Promise<Blob>
  download: (blob: Blob, filename: string) => void
  newId: () => string
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  locale: string
}

const safeStorage = (): AppDeps['storage'] => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const defaultDeps = (): AppDeps => ({
  importImage,
  exportPdf,
  download: saveFile,
  newId: () => crypto.randomUUID(),
  storage: safeStorage(),
  locale: navigator.language,
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Image files from a drop or paste; directories and non-files are skipped. */
const filesFrom = (list: FileList | null | undefined): File[] =>
  list ? Array.from(list).filter((file) => file.size > 0 || file.type !== '') : []

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) &&
  !(
    target instanceof HTMLInputElement &&
    ['range', 'radio', 'checkbox', 'button'].includes(target.type)
  )

export const App = ({ deps: injected }: { deps?: Partial<AppDeps> } = {}) => {
  const deps = useMemo(() => ({ ...defaultDeps(), ...injected }), [injected])
  const { doc, act, undo, redo, canUndo, canRedo, endGesture } = useDocument(() =>
    loadSettings(deps.storage, deps.locale),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)
  const [exporting, setExporting] = useState<ExportState>({ busy: false, done: 0, total: 0 })
  const [status, setStatus] = useState('')
  const [notices, setNotices] = useState<Notice[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const noticeId = useRef(0)

  const { pages, assets, settings } = doc
  const selectedIndex = pages.findIndex((p) => p.id === selectedId)
  // Undo can remove the selected page; a stale id simply selects nothing.
  const selected = pages[selectedIndex]

  useEffect(() => {
    saveSettings(deps.storage, settings)
  }, [deps.storage, settings])

  const notify = useCallback((text: string) => {
    noticeId.current += 1
    const id = noticeId.current
    setNotices((list) => [...list.slice(-3), { id, text }])
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setImporting({ done: 0, total: files.length })
      setStatus(`Reading ${plural(files.length, 'file')}…`)
      const added: Asset[] = []
      const failed: string[] = []
      // One at a time: decoding several 12-megapixel photos at once can
      // exhaust memory on a phone.
      for (const [i, file] of files.entries()) {
        try {
          const { asset, bytes } = await deps.importImage(file, deps.newId())
          assetStore.put(asset.id, bytes, asset.thumbUrl)
          added.push(asset)
        } catch (error) {
          const reason =
            error instanceof ImportError ? error.message : 'It could not be read as an image.'
          failed.push(`${file.name || 'A file'}: ${reason}`)
        }
        setImporting({ done: i + 1, total: files.length })
      }
      setImporting(null)
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
      void addFiles(filesFrom(event.dataTransfer?.files))
    }
    const onPaste = (event: ClipboardEvent) => {
      const files = filesFrom(event.clipboardData?.files)
      if (files.length === 0) return
      event.preventDefault()
      void addFiles(files)
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || isEditable(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) undo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') redo()
      else return
      event.preventDefault()
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [addFiles, undo, redo])

  const chooseFiles = useCallback(() => {
    fileInput.current?.click()
  }, [])

  const onExport = useCallback(async () => {
    setExporting({ busy: true, done: 0, total: pages.length })
    setStatus('Building PDF…')
    try {
      const blob = await deps.exportPdf(doc, (done, total) => {
        setExporting({ busy: true, done, total })
      })
      const filename = pdfFilename(settings.title)
      deps.download(blob, filename)
      setStatus(`Saved ${filename}.`)
    } catch (error) {
      notify(`The PDF couldn’t be built: ${error instanceof Error ? error.message : String(error)}`)
      setStatus('Export failed.')
    } finally {
      setExporting({ busy: false, done: 0, total: 0 })
    }
  }, [deps, doc, notify, pages.length, settings.title])

  const onRotate = useCallback(
    (id: string, by: -1 | 1) => {
      act({ type: 'rotatePage', id, by })
    },
    [act],
  )
  const onRemove = useCallback(
    (id: string) => {
      const index = pages.findIndex((p) => p.id === id)
      act({ type: 'removePage', id })
      setStatus(`Removed page ${index + 1}. Undo to bring it back.`)
    },
    [act, pages],
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
        setStatus(`Moved to position ${selectedIndex + by + 1} of ${pages.length}.`)
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
        setStatus(`Applied this page’s rotation and scale to all ${pages.length} pages.`)
      },
      onRemove: () => {
        onRemove(id)
      },
    }
  }, [act, deps, endGesture, onRemove, pages.length, selected, selectedIndex])

  const selectedAsset = selected ? assets[selected.assetId] : undefined

  return (
    <div className="relative min-h-dvh">
      <div className="grain pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        {pages.length === 0 && !importing ? (
          <EmptyState onChoose={chooseFiles} />
        ) : (
          <>
            <h1 className="sr-only">Collated: arrange pages and export a PDF</h1>
            <DocumentBar
              settings={settings}
              pageCount={pages.length}
              canUndo={canUndo}
              canRedo={canRedo}
              exporting={exporting}
              onSettings={onSettings}
              onUndo={undo}
              onRedo={redo}
              onRotateAll={(by) => {
                act({ type: 'rotateAll', by })
              }}
              onAdd={chooseFiles}
              onExport={() => void onExport()}
            />
            <div className="mx-auto flex max-w-[1600px] flex-col gap-10 px-4 py-6 sm:px-6 lg:flex-row lg:items-start">
              <section aria-label="Pages" className="min-w-0 flex-1">
                {importing && (
                  <p className="label mb-4 text-ink-faint" aria-hidden="true">
                    Reading{' '}
                    {importing.done + 1 > importing.total ? importing.total : importing.done + 1} of{' '}
                    {importing.total}…
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
                aria-label="Selected page"
                className="lg:sticky lg:top-28 lg:w-[22rem] lg:shrink-0 lg:border-l lg:border-rule lg:pl-8"
              >
                {selected && selectedAsset && inspectorActions ? (
                  <Inspector
                    page={selected}
                    asset={selectedAsset}
                    index={selectedIndex}
                    count={pages.length}
                    settings={settings}
                    actions={inspectorActions}
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
        accept="image/*,.heic,.heif"
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
      />
    </div>
  )
}
