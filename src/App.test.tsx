import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { asset } from '../tests/helpers'
import { App, type AppDeps } from './App'
import { ImportError } from './import/importFile'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

const setup = (overrides: Partial<AppDeps> = {}) => {
  let n = 0
  const store = new Map<string, string>()
  const deps: Partial<AppDeps> = {
    newId: () => `id${++n}`,
    locale: 'en-US',
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v)
      },
    },
    importFile: vi.fn((f: File, newId: () => string) => {
      if (f.name.endsWith('.txt')) return Promise.reject(new ImportError('Not an image.'))
      // A ".pdf" stands in for a three-page PDF sharing one set of bytes.
      const pages = f.name.endsWith('.pdf') ? 3 : 1
      const bytesId = newId()
      const assets = Array.from({ length: pages }, (_, i) =>
        asset(newId(), {
          bytesId,
          name: pages > 1 ? `${f.name} · p${i + 1}` : f.name,
          width: f.name.includes('tall') ? 100 : 300,
          height: 200,
          ...(pages > 1 ? { format: 'pdf' as const, pdfPage: i } : {}),
        }),
      )
      return Promise.resolve({ assets, files: [{ id: bytesId, bytes: new Uint8Array([1]) }] })
    }),
    exportPdf: vi.fn(() =>
      Promise.resolve({
        blob: new Blob(['%PDF'], { type: 'application/pdf' }),
        compression: null,
        fits: true,
      }),
    ),
    download: vi.fn(),
    // "blank" pages have no lines to go by; every other page is 2.5° out.
    estimateSkew: vi.fn((a: { name: string }) =>
      Promise.resolve(a.name.includes('blank') ? null : { angle: -2.5, confidence: 2 }),
    ),
    ...overrides,
  }
  const user = userEvent.setup()
  render(<App deps={deps} />)
  const upload = async (...names: string[]) => {
    await user.upload(screen.getByTestId('file-input'), names.map(file))
  }
  return { user, deps, store, upload }
}

/** The app's own live region (dnd-kit adds another for drag announcements). */
const status = () => screen.getAllByRole('status').find((el) => el.id === 'status')

const pageLabels = () =>
  within(screen.getByRole('list', { name: /pages?$/ }))
    .getAllByRole('button', { name: /^Page \d+:/ })
    .map((b) => b.getAttribute('aria-label'))

describe('App', () => {
  it('starts empty and offers to choose images', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Many pages in.')
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeEnabled()
  })

  it('imports files as pages, reports failures by name, and selects the first page', async () => {
    const { upload } = setup()
    await upload('a.jpg', 'notes.txt', 'b.jpg')
    expect(await screen.findByRole('list', { name: '2 pages' })).toBeInTheDocument()
    expect(pageLabels()).toEqual(['Page 1: a.jpg', 'Page 2: b.jpg'])
    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt: Not an image.')
    expect(status()).toHaveTextContent('Added 2 pages. 1 file could not be added.')
    expect(screen.getByRole('heading', { level: 2, name: 'a.jpg' })).toBeInTheDocument()
  })

  it('turns a PDF into one page per PDF page, shown as vector in the inspector', async () => {
    const { user, upload } = setup()
    await upload('lease.pdf', 'a.jpg')
    expect(await screen.findByRole('list', { name: '4 pages' })).toBeInTheDocument()
    expect(pageLabels()).toEqual([
      'Page 1: lease.pdf · p1',
      'Page 2: lease.pdf · p2',
      'Page 3: lease.pdf · p3',
      'Page 4: a.jpg',
    ])
    await user.click(screen.getByRole('button', { name: 'Page 2: lease.pdf · p2' }))
    const panel = within(screen.getByRole('complementary', { name: 'Selected page' }))
    expect(panel.getByText('Vector, any size')).toBeInTheDocument()
    expect(panel.getByText(/PDF page 2/)).toBeInTheDocument()
  })

  it('removes a page and brings it back with undo', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg')
    await user.click(await screen.findByRole('button', { name: 'Remove page 1' }))
    expect(pageLabels()).toEqual(['Page 1: b.jpg'])
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(pageLabels()).toEqual(['Page 1: a.jpg', 'Page 2: b.jpg'])
    await user.click(screen.getByRole('button', { name: /^Redo/ }))
    expect(pageLabels()).toEqual(['Page 1: b.jpg'])
  })

  it('undoes with the keyboard shortcut, but not while typing in a field', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg')
    await user.click(await screen.findByRole('button', { name: 'Remove page 2' }))
    await user.click(screen.getByLabelText('Title & filename'))
    await user.keyboard('{Control>}z{/Control}')
    expect(pageLabels()).toHaveLength(1)
    await user.click(screen.getByRole('heading', { level: 2 }))
    await user.keyboard('{Control>}z{/Control}')
    expect(pageLabels()).toHaveLength(2)
  })

  it('moves the selected page with the inspector’s buttons', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg', 'c.jpg')
    await user.click(await screen.findByRole('button', { name: 'Page 1: a.jpg' }))
    expect(screen.getByRole('button', { name: 'Move page earlier' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move page later' }))
    expect(pageLabels()).toEqual(['Page 1: b.jpg', 'Page 2: a.jpg', 'Page 3: c.jpg'])
    expect(status()).toHaveTextContent('Moved to position 2 of 3.')
  })

  it('rotates, straightens and scales the selected page', async () => {
    const { user, upload } = setup()
    await upload('a.jpg')
    const panel = await screen.findByRole('complementary', { name: 'Selected page' })
    const page = within(panel)
    await user.click(page.getByRole('button', { name: 'Right' }))
    // jsdom has no range keyboard behaviour; the verify script covers that in Chromium.
    fireEvent.change(page.getByLabelText('Straighten'), { target: { value: '1' } })
    expect(page.getByText('+1.0°')).toBeInTheDocument()
    await user.click(page.getByRole('radio', { name: 'Fill' }))
    expect(page.getByRole('radio', { name: 'Fill' })).toBeChecked()
    expect(page.getByRole('button', { name: 'Reset' })).toBeEnabled()
    await user.click(page.getByRole('button', { name: 'Reset' }))
    expect(page.getByText('0.0°')).toBeInTheDocument()
    expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('sets a filter per page, explains the re-encode, and disables it for PDF pages', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'scan.pdf')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('radio', { name: 'B&W' }))
    expect(panel.getByRole('radio', { name: 'B&W' })).toBeChecked()
    expect(panel.getByText(/re-encoded for the filter/)).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Reset' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Page 2: scan.pdf · p1' }))
    expect(panel.getByRole('radio', { name: 'B&W' })).toBeDisabled()
    expect(panel.getByRole('radio', { name: 'Original' })).toBeChecked()
    expect(panel.getByText('PDF pages keep their original vector content.')).toBeInTheDocument()
  })

  it('auto-straightens a page, or all of them in one undo step', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg', 'blank.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Auto-straighten' }))
    expect(await panel.findByText('-2.5°')).toBeInTheDocument()
    expect(status()).toHaveTextContent('Straightened by -2.5°.')

    await user.click(panel.getByRole('button', { name: 'All pages' }))
    await waitFor(() => {
      expect(status()).toHaveTextContent(
        'Straightened 2 of 3 pages. 1 page had no clear lines and was left as it is.',
      )
    })
    // One undo returns every page to where the batch started.
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(panel.getByText('-2.5°')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(panel.getByText('0.0°')).toBeInTheDocument()
  })

  it('says so when a page has no lines to straighten by', async () => {
    const { user, upload } = setup()
    await upload('blank.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Auto-straighten' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No clear lines found')
    expect(panel.getByText('0.0°')).toBeInTheDocument()
  })

  it('crops to the paper with keyboard-movable corners, and removes the crop', async () => {
    const { user, upload } = setup()
    await upload('photo.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Crop to the page…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Crop to the page' }))
    const corner = dialog.getByRole('button', { name: /^Top-left corner/ })
    expect(corner).toHaveAccessibleName('Top-left corner, 0% across, 0% down')
    corner.focus()
    await user.keyboard('{Shift>}{ArrowRight}{ArrowDown}{/Shift}{ArrowRight}')
    expect(corner).toHaveAccessibleName('Top-left corner, 5.5% across, 5% down')
    await user.click(dialog.getByRole('button', { name: 'Apply crop' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(panel.getByRole('button', { name: 'Adjust corners…' })).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Reset' })).toBeEnabled()
    await user.click(panel.getByRole('button', { name: 'Remove crop' }))
    expect(panel.getByRole('button', { name: 'Crop to the page…' })).toBeInTheDocument()
  })

  it('refuses crossed corners', async () => {
    const { user, upload } = setup()
    await upload('photo.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    await user.click(panel.getByRole('button', { name: 'Crop to the page…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Crop to the page' }))
    // Drag the top-left corner past the top-right one.
    dialog.getByRole('button', { name: /^Top-left corner/ }).focus()
    for (let i = 0; i < 21; i++) await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(dialog.getByRole('alert')).toHaveTextContent('cross over')
    expect(dialog.getByRole('button', { name: 'Apply crop' })).toBeDisabled()
  })

  it('duplicates a page and selects the copy', async () => {
    const { user, upload } = setup()
    await upload('a.jpg')
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }))
    expect(pageLabels()).toEqual(['Page 1: a.jpg', 'Page 2: a.jpg'])
    expect(screen.getByRole('button', { name: 'Page 2: a.jpg' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('reports the printed resolution and the page size in the chosen unit', async () => {
    const { user, upload } = setup()
    await upload('tall.jpg')
    const panel = within(await screen.findByRole('complementary', { name: 'Selected page' }))
    expect(panel.getByText('8.5 in × 11 in')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'mm' }))
    expect(panel.getByText('215.9 mm × 279.4 mm')).toBeInTheDocument()
  })

  it('exports with the current document and names the file from the title', async () => {
    const exportPdf = vi.fn<AppDeps['exportPdf']>(() =>
      Promise.resolve({
        blob: new Blob(['%PDF'], { type: 'application/pdf' }),
        compression: null,
        fits: true,
      }),
    )
    const { user, deps, upload } = setup({ exportPdf })
    await upload('a.jpg')
    await user.type(await screen.findByLabelText('Title & filename'), 'Lease 2026')
    await user.click(screen.getByRole('button', { name: /Export PDF · 1 page/ }))
    await waitFor(() => {
      expect(deps.download).toHaveBeenCalledWith(expect.any(Blob), 'Lease-2026.pdf')
    })
    const [doc] = exportPdf.mock.calls[0] ?? []
    expect(doc?.pages).toHaveLength(1)
    expect(doc?.settings.title).toBe('Lease 2026')
    expect(status()).toHaveTextContent('Saved Lease-2026.pdf (4 B, original images).')
  })

  it('lowers the estimate when a smaller quality is chosen, and remembers it', async () => {
    const { user, store, upload } = setup({
      importFile: (f, newId) => {
        const id = newId()
        return Promise.resolve({
          assets: [asset(id, { name: f.name, width: 4000, height: 3000, byteLength: 4_000_000 })],
          files: [{ id, bytes: new Uint8Array([1]) }],
        })
      },
    })
    await upload('photo.jpg')
    const options = await screen.findByRole('button', { name: /Export options:\s*Original/ })
    expect(options).toHaveAccessibleName(/≈\s*3\.8 MB/)
    // jsdom hides popover content but doesn't implement popovertarget, so the
    // panel can't be opened here; its controls are queried directly. The
    // browser verify opens the real popover.
    await user.click(screen.getByRole('radio', { name: /Small/, hidden: true }))
    // 4000 px across 11 in is ~364 dpi; capping at 150 dpi leaves ~17% of
    // the pixels, so the estimate drops from megabytes to kilobytes.
    expect(screen.getByRole('button', { name: /Export options:\s*Small/ })).toHaveAccessibleName(
      /≈\s*\d+ KB/,
    )
    expect(JSON.parse(store.get('collated:settings') ?? '{}')).toMatchObject({ quality: 'small' })
  })

  it('warns when a size limit could not be met, and still saves', async () => {
    const { user, deps, upload } = setup({
      exportPdf: () =>
        Promise.resolve({
          blob: new Blob([new Uint8Array(3 * 1024 * 1024)]),
          compression: { dpi: 96, quality: 0.6 },
          fits: false,
        }),
    })
    await upload('a.jpg')
    const limit = await screen.findByLabelText('Keep the file under')
    await user.type(limit, '1{Enter}')
    await user.click(screen.getByRole('button', { name: /Export PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t get under 1.0 MB: the smallest version is 3.0 MB at 96 dpi. It was saved anyway.',
    )
    expect(deps.download).toHaveBeenCalled()
  })

  it('passes the password to the export but never stores it', async () => {
    const exportPdf = vi.fn<AppDeps['exportPdf']>(() =>
      Promise.resolve({ blob: new Blob(['%PDF']), compression: null, fits: true }),
    )
    const { user, store, upload } = setup({ exportPdf })
    await upload('a.jpg')
    await user.type(await screen.findByLabelText('Password to open'), 'hunter2')
    await user.click(screen.getByRole('button', { name: /Export PDF · 1 page/ }))
    await waitFor(() => {
      expect(exportPdf).toHaveBeenCalled()
    })
    expect(exportPdf.mock.calls[0]?.[2]).toEqual({ password: 'hunter2' })
    expect(status()).toHaveTextContent('password-protected')
    expect(JSON.stringify([...store.values()])).not.toContain('hunter2')
  })

  it('shows page numbers on the pages when switched on', async () => {
    const { user, upload } = setup()
    await upload('a.jpg', 'b.jpg')
    const pages = await screen.findByRole('list', { name: '2 pages' })
    expect(within(pages).queryByText('8')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Page numbers', hidden: true }))
    await user.clear(screen.getByLabelText('Start at'))
    await user.type(screen.getByLabelText('Start at'), '7{Enter}')
    expect(within(pages).getByText('7')).toBeInTheDocument()
    expect(within(pages).getByText('8')).toBeInTheDocument()
  })

  it('sizes pages to their image when "Match image" is chosen', async () => {
    const { user, upload } = setup()
    await upload('a.jpg')
    await user.selectOptions(await screen.findByLabelText('Page size'), 'image')
    // 300 x 200 px at the default 300 dpi is 1 x 0.67 in.
    const panel = within(screen.getByRole('complementary', { name: 'Selected page' }))
    expect(panel.getByText('1 in × 0.67 in')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Portrait' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Image dpi'))
    await user.type(screen.getByLabelText('Image dpi'), '100{Enter}')
    expect(panel.getByText('3 in × 2 in')).toBeInTheDocument()
  })

  it('shows an error if the export fails and stays usable', async () => {
    const { user, upload } = setup({ exportPdf: () => Promise.reject(new Error('disk full')) })
    await upload('a.jpg')
    await user.click(await screen.findByRole('button', { name: /Export PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeEnabled()
  })

  it('remembers page setup (not the title) between visits', async () => {
    const { user, store, upload } = setup()
    await upload('a.jpg')
    await user.selectOptions(await screen.findByLabelText('Page size'), 'a4')
    await user.type(screen.getByLabelText('Title & filename'), 'secret')
    const saved = JSON.parse(store.get('collated:settings') ?? '{}') as Record<string, unknown>
    expect(saved.size).toBe('a4')
    expect(saved).not.toHaveProperty('title')
  })

  it('adds pasted images', async () => {
    setup()
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { files: File[] }
    }
    Object.defineProperty(event, 'clipboardData', { value: { files: [file('pasted.png')] } })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(await screen.findByRole('list', { name: '1 page' })).toBeInTheDocument()
    expect(event.defaultPrevented).toBe(true)
  })
})
