import { useId } from 'react'
import type { Settings } from '../core/model'
import type { DuplexGroups } from '../core/order'
import type { Plan, SplitOptions } from '../core/split'
import { Button, IconButton } from './controls'
import { ExportOptions } from './ExportOptions'
import { CameraIcon, PlusIcon, RedoIcon, ScanIcon, UndoIcon } from './Icons'
import { MoreMenu, type Arrange } from './MoreMenu'
import { PageSetup } from './PageSetup'
import { Toolbar } from './Toolbar'
import { TOOLBAR_ITEM } from './toolbarItem'

export interface ExportState {
  busy: boolean
  done: number
  total: number
  /** Above 1 when a size limit forced a retry at lower quality. */
  attempt?: number
  /**
   * Reading text before the build, or drawing pages: the built ones as images
   * (#117), or PDF pages before a PDF/A build (#116).
   */
  phase?: 'ocr' | 'images'
}

/**
 * The workspace toolbar. Wider than a phone (`part="bar"`), a pill floating
 * in the header's one row: page setup (a popover), undo and redo, add,
 * export (a popover of options with the Export button pinned at its foot),
 * and a More menu for the rest. On a phone it comes in two parts: the
 * header keeps the things you set or fix (`part="top"`: setup, undo, redo,
 * More) beside the name, and the dock along the bottom, under the thumb,
 * holds the ways in and out (`part="dock"`: add, take photo, scan, export).
 * Each is one Tab stop; arrow keys move along it.
 */
export type BarPart = 'bar' | 'top' | 'dock'

export const DocumentBar = ({
  part = 'bar',
  settings,
  pageCount,
  canUndo,
  canRedo,
  exporting,
  onSettings,
  onUndo,
  onRedo,
  onRotateAll,
  onAutoRotate,
  rotating = false,
  duplex,
  orderScope = null,
  onArrange,
  blankAfter,
  onInsertBlank,
  onStartOver,
  keepWork,
  onKeepWork,
  busy = false,
  onAdd,
  onTakePhoto,
  onScan,
  onExport,
  estimate,
  lastExport,
  password,
  onPassword,
  passwordError = null,
  split,
  onSplit,
  selectedCount,
  selectedIds,
  plan,
}: {
  part?: BarPart
  settings: Settings
  pageCount: number
  canUndo: boolean
  canRedo: boolean
  exporting: ExportState
  onSettings: (patch: Partial<Settings>, coalesce?: string) => void
  onUndo: () => void
  onRedo: () => void
  onRotateAll: (by: -1 | 1) => void
  onAutoRotate: () => void
  rotating?: boolean
  duplex: DuplexGroups | null
  /** How many selected pages page order works on; null for every page. */
  orderScope?: number | null
  onArrange: (arrange: Arrange) => void
  /** The page an inserted blank page goes after (1-based); null for the end. */
  blankAfter: number | null
  onInsertBlank: () => void
  /** Clears the document, its undo history and everything kept for it. */
  onStartOver: () => void
  /** Whether the document is kept on this device across a reload. */
  keepWork: boolean
  onKeepWork: (keep: boolean) => void
  /** Importing, straightening or auto-rotating: Start over waits (export is `exporting`). */
  busy?: boolean
  onAdd: () => void
  /** Opens the camera; only on touch devices (#72). */
  onTakePhoto?: () => void
  /** Opens the scan camera; touch devices that allow the camera (#118). */
  onScan?: () => void
  onExport: () => void
  estimate: number
  lastExport: { size: string; used: string; fits: boolean } | null
  password: string
  onPassword: (password: string) => void
  /** Why the password can't be used, if it can't. */
  passwordError?: string | null
  split: SplitOptions
  onSplit: (patch: Partial<SplitOptions>) => void
  selectedCount: number
  selectedIds: readonly string[]
  plan: Plan
}) => {
  const id = useId()
  const optionsId = `${id}-export-options`
  const mod =
    typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  const undo = (
    <IconButton
      label={`Undo (${mod}Z)`}
      inactive={!canUndo}
      onClick={onUndo}
      large={part === 'top'}
      {...TOOLBAR_ITEM}
    >
      <UndoIcon />
    </IconButton>
  )
  // Inactive rather than disabled: undoing the last step mustn't drop focus
  // from the button.
  const redo = (
    <IconButton
      label={`Redo (${mod}Shift+Z)`}
      inactive={!canRedo}
      onClick={onRedo}
      large={part === 'top'}
      {...TOOLBAR_ITEM}
    >
      <RedoIcon />
    </IconButton>
  )
  const exportOptions = (
    <ExportOptions
      settings={settings}
      pageCount={pageCount}
      exporting={exporting}
      estimate={estimate}
      lastExport={lastExport}
      onSettings={onSettings}
      onExport={onExport}
      canExport={pageCount > 0 && !exporting.busy}
      password={password}
      onPassword={onPassword}
      passwordError={passwordError}
      split={split}
      onSplit={onSplit}
      selectedCount={selectedCount}
      selectedIds={selectedIds}
      plan={plan}
      panelId={optionsId}
      dock={part === 'dock'}
    />
  )
  const more = (
    <MoreMenu
      pageCount={pageCount}
      onRotateAll={onRotateAll}
      onAutoRotate={onAutoRotate}
      rotating={rotating}
      duplex={duplex}
      orderScope={orderScope}
      onArrange={onArrange}
      blankAfter={blankAfter}
      onInsertBlank={onInsertBlank}
      busy={exporting.busy || busy}
      onStartOver={onStartOver}
      keepWork={keepWork}
      onKeepWork={onKeepWork}
      large={part === 'top'}
    />
  )

  if (part === 'top')
    return (
      <Toolbar label="Document" className="ml-auto flex-none gap-x-0.5">
        <PageSetup settings={settings} onSettings={onSettings} compact />
        {undo}
        {redo}
        {more}
      </Toolbar>
    )

  if (part === 'dock')
    return (
      // Fixed over the pages, clear of the home indicator; the page leaves
      // room for it at the end (App), and notices sit above it (index.css).
      <Toolbar
        label="Add and export"
        className="dock fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 items-center gap-1 rounded-full bg-paper p-1.5 shadow-panel"
      >
        {/* Each name starts with or holds its visible word (WCAG 2.5.3). */}
        <Button
          size="dock"
          variant="quiet"
          onClick={onAdd}
          data-focus-fallback
          {...TOOLBAR_ITEM}
          aria-label="Add pages"
        >
          <PlusIcon />
          Add
        </Button>
        {onTakePhoto && (
          <Button
            size="dock"
            variant="quiet"
            onClick={onTakePhoto}
            {...TOOLBAR_ITEM}
            aria-label="Take photo"
          >
            <CameraIcon />
            Photo
          </Button>
        )}
        {onScan && (
          <Button
            size="dock"
            variant="quiet"
            onClick={onScan}
            {...TOOLBAR_ITEM}
            aria-label="Scan pages"
          >
            <ScanIcon />
            Scan
          </Button>
        )}
        {/* The rest of the row; Export's words truncate before it overflows. */}
        <span className="flex min-w-0 flex-1 justify-end">{exportOptions}</span>
      </Toolbar>
    )

  return (
    // One pill beside the name: below md, Add pages is its icon and the
    // setup summary gives way (truncates) before the name does.
    <Toolbar
      label="Document"
      className="flex-none flex-nowrap gap-x-1 rounded-full bg-paper p-1 shadow-panel"
    >
      <div className="flex min-w-11 flex-initial">
        <PageSetup settings={settings} onSettings={onSettings} />
      </div>
      {undo}
      {redo}
      <span className="mx-1 h-5 border-l border-rule" aria-hidden="true" />
      <Button
        variant="quiet"
        onClick={onAdd}
        data-focus-fallback
        {...TOOLBAR_ITEM}
        aria-label="Add pages"
      >
        <PlusIcon width={16} height={16} />
        <span className="hidden md:inline" aria-hidden="true">
          Add pages
        </span>
      </Button>
      {onTakePhoto && (
        <IconButton label="Take photo" onClick={onTakePhoto} {...TOOLBAR_ITEM}>
          <CameraIcon />
        </IconButton>
      )}
      {onScan && (
        <IconButton label="Scan pages" onClick={onScan} {...TOOLBAR_ITEM}>
          <ScanIcon />
        </IconButton>
      )}
      {exportOptions}
      {more}
    </Toolbar>
  )
}
