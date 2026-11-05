import { useId, useRef, useState } from 'react'
import type { SheetLayout } from '../core/geometry'
import type { Asset, Mark, Page } from '../core/model'
import type { NumberMark } from '../core/pageNumbers'
import type { Quad } from '../core/perspective'
import type { WatermarkMark } from '../core/watermark'
import { deviceSignatures } from '../state/signatureStore'
import { Button } from './controls'
import { SignIcon } from './Icons'
import { MarkEditor } from './MarkEditor'

/**
 * The Sign part of a page's panel (#111): opens the editor that puts
 * signatures on the page, and takes them all off again. Shared by single,
 * combined and blank pages, since signatures belong to the page.
 */
export const SignSection = ({
  pageLabel,
  page,
  sheet,
  thumbUrls,
  covers,
  watermark,
  numbers,
  assets,
  onMarks,
}: {
  /** "page 3", for the editor's title. */
  pageLabel: string
  page: Page
  sheet: SheetLayout
  thumbUrls: readonly string[]
  covers?: readonly (readonly Quad[])[]
  watermark: WatermarkMark | null
  numbers: NumberMark | null
  assets: Readonly<Record<string, Asset>>
  onMarks: (marks: Mark[], added: Asset[]) => void
}) => {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const count = page.marks?.length ?? 0
  return (
    <div>
      <p className="label mb-2 text-ink-faint" id={`${id}-sign`}>
        Sign
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-sign`}>
        <Button
          ref={button}
          className="flex-1"
          onClick={() => {
            setEditing(true)
          }}
        >
          <SignIcon width={16} height={16} />
          {count
            ? `Edit ${String(count)} ${count === 1 ? 'signature' : 'signatures'}…`
            : 'Sign this page…'}
        </Button>
        {count > 0 && (
          <Button
            onClick={() => {
              button.current?.focus()
              onMarks([], [])
            }}
          >
            Remove all
          </Button>
        )}
      </div>
      {editing && (
        <MarkEditor
          title={`Sign ${pageLabel}`}
          sheet={sheet}
          thumbUrls={thumbUrls}
          {...(covers ? { covers } : {})}
          watermark={watermark}
          numbers={numbers}
          initial={page.marks ?? []}
          assets={assets}
          store={deviceSignatures()}
          onApply={onMarks}
          onClose={() => {
            setEditing(false)
            button.current?.focus()
          }}
        />
      )}
    </div>
  )
}
