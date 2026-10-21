import { useId } from 'react'
import type { Settings } from '../core/model'
import { Button, IconButton } from './controls'
import { ExportOptions } from './ExportOptions'
import { DownloadIcon, LockIcon, PlusIcon, RedoIcon, UndoIcon } from './Icons'
import { MoreMenu } from './MoreMenu'
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
 * The workspace toolbar, in the header's one row: page setup (a popover),
 * undo and redo, add, export options (a popover, with the title) and export,
 * and a More menu for the rest. One Tab stop; arrow keys move along it.
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
  onAdd,
  onExport,
  estimate,
  lastExport,
  password,
  onPassword,
  passwordError = null,
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
  onAdd: () => void
  onExport: () => void
  estimate: number
  lastExport: { size: string; used: string; fits: boolean } | null
  password: string
  onPassword: (password: string) => void
  /** Why the password can't be used, if it can't. */
  passwordError?: string | null
}) => {
  const id = useId()
  const optionsId = `${id}-export-options`
  const locked = password !== ''
  const mod =
    typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  return (
    // Phones: two rows (setup, undo, redo / add, options, export, more), in
    // the same order as the DOM so the arrow keys go where the eye does.
    <Toolbar
      label="Document"
      className="min-w-0 flex-1 basis-full flex-wrap gap-x-1.5 gap-y-2 sm:basis-auto sm:flex-nowrap"
    >
      <div className="flex min-w-0 flex-1 sm:mr-auto sm:flex-none xl:mr-0">
        <PageSetup settings={settings} onSettings={onSettings} />
      </div>
      <p className="label mx-auto hidden px-4 text-ink-faint xl:block" aria-hidden="true">
        <span className="mr-2 inline-block size-1.5 rounded-full bg-accent align-middle" />
        Files stay on this device
      </p>
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
      <span className="mx-1 hidden h-6 border-l border-rule sm:block" aria-hidden="true" />
      <Button
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
      <ExportOptions
        settings={settings}
        estimate={estimate}
        lastExport={lastExport}
        onSettings={onSettings}
        onExport={onExport}
        canExport={pageCount > 0 && !exporting.busy}
        password={password}
        onPassword={onPassword}
        passwordError={passwordError}
        panelId={optionsId}
      />
      <Button
        variant="primary"
        disabled={pageCount === 0}
        // Stays focusable while busy, so focus isn't dropped mid-export.
        inactive={exporting.busy}
        {...TOOLBAR_ITEM}
        {...(passwordError ? { 'aria-describedby': `${optionsId}-password-error` } : {})}
        onClick={() => {
          if (passwordError) {
            // Show the problem where it can be fixed.
            try {
              document.getElementById(optionsId)?.showPopover()
            } catch {
              /* already open, or no popover support */
            }
            document.getElementById(`${optionsId}-password`)?.focus()
            return
          }
          onExport()
        }}
      >
        {locked ? <LockIcon width={16} height={16} /> : <DownloadIcon width={16} height={16} />}
        {exporting.busy ? (
          exporting.phase === 'ocr' ? (
            `Reading text ${exporting.done + 1}/${exporting.total}…`
          ) : (exporting.attempt ?? 1) > 1 ? (
            `Shrinking, try ${exporting.attempt} · ${exporting.done}/${exporting.total}…`
          ) : (
            `Building ${exporting.done}/${exporting.total}…`
          )
        ) : (
          <span>
            Export {locked ? 'locked ' : ''}
            {/* Phones show just the verb; the name always has it all. */}
            <span className="hidden sm:inline">
              PDF · {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
            <span className="sr-only sm:hidden">
              PDF, {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
          </span>
        )}
      </Button>
      <MoreMenu pageCount={pageCount} onRotateAll={onRotateAll} />
    </Toolbar>
  )
}
