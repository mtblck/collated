/**
 * The task pages (#120): one static page per thing people search for
 * ("jpg to pdf", "sign pdf"), each with a short how-to, built by
 * docs-site.ts. They all open the same app, at `?task=<slug>`, which tailors
 * the landing view's drop target and, once files are in, readies what the
 * task needs (`ready`). Plain data, so the build, the app and the tests
 * share one copy. Every claim here must stay true to the app.
 */
const BASE = '/'

export type TaskReady =
  /** Scan pages is the first button, where the phone allows it. */
  | 'scan'
  /** The first page's Fill and sign button is brought into view and focused. */
  | 'sign'
  /** Image quality goes to Small, which shrinks pictures in PDF pages too. */
  | 'small'

export interface Task {
  slug: string
  /** The page's h1. */
  heading: string
  /** `<title>`, before " · Collated". */
  title: string
  /** Meta description: what a search result shows. */
  description: string
  /** The paragraph under the heading. */
  lead: string
  /** The button that opens the app. */
  action: string
  /** How to, in order. */
  steps: readonly string[]
  /** Good to know, as a short list. */
  notes: readonly string[]
  /** The guide page that says more, under docs/guide/. */
  guide: { slug: string; label: string }
  /** The app's drop target while this task is open. */
  drop: string
  ready?: TaskReady
}

export const TASKS: readonly Task[] = [
  {
    slug: 'jpg-to-pdf',
    heading: 'JPG to PDF',
    title: 'JPG to PDF: turn photos and images into one PDF',
    description:
      'Turn JPG, PNG and other images into one PDF in your browser. Put them in order, pick the paper size and save. Nothing is uploaded, no account, free.',
    lead: 'Turn photos, screenshots and scanned images into a single PDF, in the order you want, without uploading them anywhere.',
    action: 'Choose images',
    steps: [
      'Choose your images, or drop them on the page. Add as many as you like, all at once.',
      'Drag the pages into order. Rotate, crop or straighten any of them.',
      'Pick the paper size and margins in Page setup, or keep each page the size of its image.',
      'Choose Export. The PDF is saved where your browser saves downloads.',
    ],
    notes: [
      'JPEGs go into the PDF as they are, so they don’t lose quality.',
      'PNG, WebP, AVIF, GIF, BMP, TIFF and iPhone HEIC photos work too.',
      'Phone photos come in the right way up.',
    ],
    guide: { slug: 'adding-pages', label: 'Adding pages' },
    drop: 'Drop your images here',
  },
  {
    slug: 'merge-pdf',
    heading: 'Merge PDF files',
    title: 'Merge PDF files into one, in your browser',
    description:
      'Combine several PDFs, and images, into one PDF. Reorder, rotate or remove pages before you save. Runs in your browser: your files are never uploaded.',
    lead: 'Combine several PDFs into one file. Every page comes in on its own, so you can put them in any order and leave out the ones you don’t need.',
    action: 'Choose PDFs',
    steps: [
      'Choose the PDFs to merge, or drop them on the page.',
      'Drag pages into order, across files. Select several to move, turn or remove them together.',
      'Add photos or scans in between if you need to: they become pages too.',
      'Choose Export to save one PDF.',
    ],
    notes: [
      'Pages from a PDF stay as sharp as the original: their text stays text.',
      'Password-protected PDFs ask for their password once, and the merged file doesn’t need it.',
      'Bookmarks can mark where each file starts.',
    ],
    guide: { slug: 'arranging-pages', label: 'Arranging pages' },
    drop: 'Drop the PDFs to merge here',
  },
  {
    slug: 'scan-to-pdf',
    heading: 'Scan to PDF',
    title: 'Scan documents to PDF with your phone',
    description:
      'Scan a stack of paper to one PDF with your phone’s camera. Pages are found, cropped and taken by themselves. Free, in your browser, nothing uploaded.',
    lead: 'Use your phone’s camera to scan letters, forms and receipts into one PDF. Collated finds the paper, crops it and takes each page when you hold still.',
    action: 'Start scanning',
    steps: [
      'On your phone, choose Scan pages and allow the camera when your browser asks.',
      'Hold the phone over a page. Once its outline holds still, the page is taken by itself.',
      'Turn to the next page, and the next. Choose Done when you’re finished.',
      'Check the pages, fix any crop, and choose Export.',
    ],
    notes: [
      'The Enhance and B&W filters make photographed pages look scanned.',
      'Make text searchable reads the text on this device, so you can search and copy it.',
      'No camera to hand? Take photo, or choose pictures you already took.',
    ],
    guide: { slug: 'adding-pages', label: 'Adding pages' },
    drop: 'Scan pages, or drop photos of them here',
    ready: 'scan',
  },
  {
    slug: 'sign-pdf',
    heading: 'Sign a PDF',
    title: 'Sign a PDF and fill in forms, free and private',
    description:
      'Sign a PDF with your finger, mouse or a photo of your signature, and type text, dates and ticks onto forms. In your browser: nothing is uploaded.',
    lead: 'Put your signature on a lease, a letter or a form, and fill in the parts that have nowhere to type, then save it as a PDF again.',
    action: 'Choose a PDF to sign',
    steps: [
      'Choose the PDF, or a photo of the page.',
      'Select the page to sign, and choose Sign this page in the panel.',
      'Draw your signature, type your name, or take a photo of it on paper. Drag it into place.',
      'Add text, today’s date or ticks if the form needs them, then choose Export.',
    ],
    notes: [
      'Your signature can be kept on this device for next time, and never leaves it.',
      'Text you add is real text in the PDF, sharp at any size.',
      'This is a picture of your signature, like signing a printout, not a certificate-based digital signature.',
    ],
    guide: { slug: 'signing', label: 'Filling in and signing a page' },
    drop: 'Drop the PDF to sign here',
    ready: 'sign',
  },
  {
    slug: 'compress-pdf',
    heading: 'Compress a PDF',
    title: 'Compress a PDF: make scanned PDFs smaller',
    description:
      'Make a heavy PDF small enough to email or upload. Pictures inside its pages are compressed while text stays sharp. In your browser, nothing uploaded.',
    lead: 'Make a large PDF small enough for email or an upload form. The pictures inside its pages, such as scans, are compressed; its text stays sharp and searchable.',
    action: 'Choose a PDF to compress',
    steps: [
      'Choose the PDF, or drop it on the page. Image quality is set to Small.',
      'For a hard limit, open Export and give a size under Keep the file under.',
      'Choose Export. The message says how big the new file is.',
    ],
    notes: [
      'Small is 150 dpi: right for email and screens. Balanced and High keep more detail.',
      'A picture is only replaced when that makes it smaller.',
      'Black-and-white scans are usually small already, and stay as they are.',
    ],
    guide: { slug: 'exporting', label: 'Exporting' },
    drop: 'Drop the PDF to compress here',
    ready: 'small',
  },
  {
    slug: 'heic-to-pdf',
    heading: 'HEIC to PDF',
    title: 'HEIC to PDF: convert iPhone photos to PDF',
    description:
      'Convert iPhone HEIC photos to one PDF in any browser, on Windows, Android or Mac. Put them in order and save. Nothing is uploaded, no account, free.',
    lead: 'iPhones save photos as HEIC, which many forms and computers won’t take. Turn them into one PDF in any browser, not only Safari.',
    action: 'Choose photos',
    steps: [
      'Choose your HEIC photos, or drop them on the page. JPEGs and PDFs can go in alongside.',
      'Put them in order, and crop each one to the paper if it’s a photo of a document.',
      'Choose Export to save one PDF.',
    ],
    notes: [
      'Photos come in the right way up.',
      'Need pictures instead? Export can save each page as a JPG.',
      'The HEIC decoder runs in your browser, so the photos never leave this device.',
    ],
    guide: { slug: 'adding-pages', label: 'Adding pages' },
    drop: 'Drop your HEIC photos here',
  },
]

/** A task page's URL: `/sign-pdf/`. */
export const taskUrl = (task: Pick<Task, 'slug'>) => `${BASE}${task.slug}/`

/** Where a task page's button goes: the app, told which task. */
export const taskAppUrl = (task: Pick<Task, 'slug'>) => `${BASE}?task=${task.slug}`

/** The task a `location.search` names, if any. */
export const taskFrom = (search: string): Task | null => {
  const slug = new URLSearchParams(search).get('task')
  return TASKS.find((task) => task.slug === slug) ?? null
}
