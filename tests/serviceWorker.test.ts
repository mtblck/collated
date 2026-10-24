// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildWorker, planCaches, type BuiltFile } from '../service-worker'
import { SHARE_PATH } from '../src/sw/routes'

const root = join(import.meta.dirname, '..')
const f = (name: string, bytes = name): BuiltFile => ({ name, bytes })
const build = [
  f('index.html'),
  f('assets/index-a1.js'),
  f('assets/index-a1.js.map'),
  f('assets/pdf.worker.min-b2.mjs'),
  f('assets/heic.worker-c3.js'),
  f('assets/libheif-d4.js'),
  f('assets/libheif-e5.wasm'),
  f('ocr/worker.min.js'),
  f('ocr/lang/eng.traineddata.gz'),
  f('docs/index.html'),
  f('docs/keyboard/index.html'),
  f('licenses/Apache-2.0.txt'),
  f('robots.txt'),
  f('theme.js'),
]

describe('service worker build (#73)', () => {
  it('precaches the app, its lazy chunks and docs; leaves HEIC and OCR for first use', () => {
    const plan = planCaches(build)
    expect(plan.shell).toEqual([
      '/',
      '/assets/index-a1.js',
      '/assets/pdf.worker.min-b2.mjs',
      '/docs/',
      '/docs/keyboard/',
      '/theme.js',
    ])
    expect(plan.onDemand).toEqual([
      '/assets/heic.worker-c3.js',
      '/assets/libheif-d4.js',
      '/assets/libheif-e5.wasm',
      '/ocr/lang/eng.traineddata.gz',
      '/ocr/worker.min.js',
    ])
  })

  it('versions each cache by its contents', () => {
    const plan = planCaches(build)
    const appChanged = planCaches(
      build.map((x) => (x.name === 'index.html' ? f(x.name, 'new') : x)),
    )
    expect(appChanged.version).not.toBe(plan.version)
    // The OCR and HEIC downloads survive a deploy that didn't change them...
    expect(appChanged.onDemandVersion).toBe(plan.onDemandVersion)
    // ...and only such a deploy.
    const ocrChanged = planCaches(
      build.map((x) => (x.name === 'ocr/worker.min.js' ? f(x.name, 'v2') : x)),
    )
    expect(ocrChanged.onDemandVersion).not.toBe(plan.onDemandVersion)
    expect(ocrChanged.version).toBe(plan.version)
  })

  it('fails the build if the HEIC or OCR files are renamed out of its lists', () => {
    expect(() => planCaches(build.filter((x) => !x.name.startsWith('assets/heic')))).toThrow(/heic/)
    expect(() => planCaches(build.filter((x) => x.name !== 'index.html'))).toThrow(/index.html/)
  })

  it('builds one classic script with the lists written in', async () => {
    const plan = planCaches(build)
    const code = await buildWorker(plan)
    expect(code).not.toMatch(/^\s*(import|export)\b/m)
    expect(code).not.toContain('__SW_MANIFEST__')
    expect(code).toContain(JSON.stringify(plan))
  })
})

describe('web app manifest (#73)', () => {
  interface Manifest {
    start_url: string
    display: string
    icons: { src: string; sizes: string; purpose: string }[]
    share_target: {
      action: string
      method: string
      enctype: string
      params: { files: { name: string; accept: string[] }[] }
    }
    file_handlers: { action: string; accept: Record<string, string[]> }[]
  }
  const manifest = JSON.parse(
    readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'),
  ) as Manifest

  it('is installable: standalone, with 192 and 512 px icons that exist', () => {
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    const sizes = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)
    expect(sizes).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    )
    for (const icon of manifest.icons) {
      const png = readFileSync(join(root, 'public', icon.src))
      // The PNG header's width and height match what the manifest says.
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]
      expect(`${w}x${h}`).toBe(icon.sizes)
    }
  })

  it('shares files to the path the service worker takes, under the field it reads', () => {
    const { share_target: target } = manifest
    expect(target).toMatchObject({
      action: SHARE_PATH,
      method: 'POST',
      enctype: 'multipart/form-data',
    })
    expect(target.params.files.map((p) => p.name)).toEqual(['files'])
    const sw = readFileSync(join(root, 'src', 'sw', 'sw.ts'), 'utf8')
    expect(sw).toContain("form.getAll('files')")
  })

  it('accepts what the file picker accepts', () => {
    const picker = /accept="([^"]+)"/.exec(readFileSync(join(root, 'src', 'App.tsx'), 'utf8'))?.[1]
    expect(manifest.share_target.params.files[0]?.accept.join(',')).toBe(picker)
    const opened = Object.entries(manifest.file_handlers[0]?.accept ?? {})
    expect(opened.map(([type]) => type)).toContain('application/pdf')
    expect(opened.flatMap(([, ext]) => ext)).toEqual(expect.arrayContaining(['.heic', '.jpg']))
  })

  it('has its app icon for iOS too', () => {
    expect(existsSync(join(root, 'public', 'icons', 'apple-touch-icon.png'))).toBe(true)
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain(
      '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    )
  })
})
