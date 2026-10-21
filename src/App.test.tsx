import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { asset } from '../tests/helpers'
import { App, type AppDeps } from './App'
import { ImportError } from './import/importImage'

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
    importImage: vi.fn((f: File, id: string) => {
      if (f.name.endsWith('.txt')) return Promise.reject(new ImportError('Not an image.'))
      return Promise.resolve({
        asset: asset(id, { name: f.name, width: f.name.includes('tall') ? 100 : 300, height: 200 }),
        bytes: new Uint8Array([1]),
      })
    }),
    exportPdf: vi.fn(() => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' }))),
    download: vi.fn(),
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
    expect(screen.getByRole('button', { name: 'Choose images' })).toBeEnabled()
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
      Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })),
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
    expect(status()).toHaveTextContent('Saved Lease-2026.pdf.')
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
