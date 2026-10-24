import { useId } from 'react'
import type { Settings } from '../core/model'
import type { DuplexGroups } from '../core/order'
import type { Plan, SplitOptions } from '../core/split'
import { Button, IconButton } from './controls'
import { ExportOptions } from './ExportOptions'
import { CameraIcon, PlusIcon, RedoIcon, UndoIcon } from './Icons'
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
  /** Reading text before the build. */
  phase?: 'ocr'
}

/**
 * The workspace toolbar, a pill floating in the header's one row: page setup (a popover),
 * undo and redo, add, export (a popover of options with the Export button
 * pinned at its foot), and a More menu for the rest. One Tab stop; arrow keys move along it.
 */
export const DocumentBar = ({
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
  onStartOver,
  keepWork,
  onKeepWork,
  busy = false,
  onAdd,
  onTakePhoto,
  onExport,
  estimate,
  lastExport,
  password,
  onPassword,
  passwordError = null,
  split,
  onSplit,
  selectedCount,
  plan,
}: {
  settings: Settings
  pageCount: number
  canUndo: boolean
  canRedo: boolean
  exporting: ExportState
  onSettings: (patch: Partial<Settings>) => void
  onUndo: () => void
  onRedo: () => void
  onRotateAll: (by: -1 | 1) => void
  onAutoRotate: () => void
  rotating?: boolean
  duplex: DuplexGroups | null
  /** How many selected pages page order works on; null for every page. */
  orderScope?: number | null
  onArrange: (arrange: Arrange) => void
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
  plan: Plan
}) => {
  const id = useId()
  const optionsId = `${id}-export-options`
  const mod =
    typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  return (
    // Phones: two rows (setup, undo, redo / add, export, more), in
    // the same order as the DOM so the arrow keys go where the eye does.
    <Toolbar
      label="Document"
      className="min-w-0 flex-1 basis-full flex-wrap gap-x-1 gap-y-2 sm:flex-none sm:basis-auto sm:flex-nowrap sm:rounded-full sm:bg-paper sm:p-1 sm:shadow-panel"
    >
      <div className="flex min-w-0 flex-1 sm:flex-none">
        <PageSetup settings={settings} onSettings={onSettings} />
      </div>
      {/* Inactive rather than disabled: undoing the last step mustn't
          drop focus from the button. */}
      <IconButton label={`Undo (${mod}Z)`} inactive={!canUndo} onClick={onUndo} {...TOOLBAR_ITEM}>
        <UndoIcon />
      </IconButton>
      <IconButton
        label={`Redo (${mod}Shift+Z)`}
        inactive={!canRedo}
        onClick={onRedo}
        {...TOOLBAR_ITEM}
      >
        <RedoIcon />
      </IconButton>
      <span className="basis-full sm:hidden" aria-hidden="true" />
      <span className="mx-1 hidden h-5 border-l border-rule sm:block" aria-hidden="true" />
      <Button
        variant="quiet"
        onClick={onAdd}
        data-focus-fallback
        {...TOOLBAR_ITEM}
        aria-label="Add pages"
        className="ml-auto sm:ml-0"
      >
        <PlusIcon width={16} height={16} />
        <span className="hidden sm:inline" aria-hidden="true">
          Add pages
        </span>
      </Button>
      {onTakePhoto && (
        <IconButton label="Take photo" onClick={onTakePhoto} {...TOOLBAR_ITEM}>
          <CameraIcon />
        </IconButton>
      )}
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
        plan={plan}
        panelId={optionsId}
      />
      <MoreMenu
        pageCount={pageCount}
        onRotateAll={onRotateAll}
        onAutoRotate={onAutoRotate}
        rotating={rotating}
        duplex={duplex}
        orderScope={orderScope}
        onArrange={onArrange}
        busy={exporting.busy || busy}
        onStartOver={onStartOver}
        keepWork={keepWork}
        onKeepWork={onKeepWork}
      />
    </Toolbar>
  )
}
