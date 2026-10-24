import { useEffect, useId, useRef } from 'react'
import { Button } from './controls'

/** How many shared files are named in the dialog before "and N more". */
const NAMED = 4

const filesWord = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`

/**
 * Asks before files shared to Collated go in (#73). Any website can post to
 * the share address, and the service worker can't tell that from the share
 * sheet, so nothing shared is added until the person says so.
 */
export const ShareConfirm = ({
  files,
  onAdd,
  onDismiss,
}: {
  files: readonly File[]
  onAdd: () => void
  onDismiss: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const added = useRef(false)
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])
  const named = files.slice(0, NAMED)
  const more = files.length - named.length

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
      onClose={() => {
        // Escape counts as Don't add.
        if (added.current) onAdd()
        else onDismiss()
      }}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          Add {filesWord(files.length)} shared with Collated?
        </h2>
        <div id={`${id}-help`} className="flex flex-col gap-2 text-sm text-ink-muted">
          <ul className="flex flex-col gap-0.5 text-ink">
            {named.map((file, i) => (
              <li key={i} className="truncate">
                {file.name}
              </li>
            ))}
            {more > 0 && <li className="text-ink-muted">and {filesWord(more)} more</li>}
          </ul>
          <p>Add them only if you shared them yourself. They go after any pages you have.</p>
        </div>
        <div className="flex justify-end gap-2">
          {/* First, so the dialog opens on it: Enter or a stray tap adds nothing. */}
          <Button
            onClick={() => {
              dialog.current?.close()
            }}
          >
            Don’t add
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              added.current = true
              dialog.current?.close()
            }}
          >
            Add {filesWord(files.length)}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
