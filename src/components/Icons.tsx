import type { SVGProps } from 'react'

/** 20px line icons on a 20-unit grid, 1.5 stroke, decorative by default. */
const Icon = ({ children, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
)

type P = SVGProps<SVGSVGElement>

export const RotateLeftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 8.5A6 6 0 1 1 6 14.6" />
    <path d="M4 4.5v4h4" />
  </Icon>
)

export const RotateRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15.5 8.5A6 6 0 1 0 14 14.6" />
    <path d="M16 4.5v4h-4" />
  </Icon>
)

export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h12M8 6V4h4v2M5.5 6l.7 10h7.6l.7-10M8.5 9v4.5M11.5 9v4.5" />
  </Icon>
)

export const CopyIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6.5" y="6.5" width="9" height="10" rx="1" />
    <path d="M4.5 13V4.5a1 1 0 0 1 1-1H12" />
  </Icon>
)

export const GripIcon = (p: P) => (
  <Icon {...p} strokeWidth="0" fill="currentColor">
    {[6, 10, 14].flatMap((y) =>
      [7.5, 12.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.25" />),
    )}
  </Icon>
)

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 5 3.5 8.5 7 12" />
    <path d="M3.5 8.5H12a4.5 4.5 0 0 1 0 9H9" />
  </Icon>
)

export const RedoIcon = (p: P) => (
  <Icon {...p}>
    <path d="m13 5 3.5 3.5L13 12" />
    <path d="M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3" />
  </Icon>
)

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
)

export const DownloadIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" />
  </Icon>
)

export const ArrowLeftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5 7 10l5 5" />
  </Icon>
)

export const ArrowRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="m8 5 5 5-5 5" />
  </Icon>
)

export const ResetIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 10a6 6 0 1 0 1.8-4.3" />
    <path d="M4 3.5V7h3.5" />
  </Icon>
)

export const SunIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25" />
  </Icon>
)

export const MoonIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z" />
  </Icon>
)

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
)

export const CropIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5.5 2.5v11a1 1 0 0 0 1 1h11M2.5 5.5h11a1 1 0 0 1 1 1v11" />
  </Icon>
)
