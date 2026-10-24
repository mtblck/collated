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

/** A turn arrow round a letter: turn the text upright. */
export const UprightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15.5 8.5A6 6 0 1 0 14 14.6" />
    <path d="M16 4.5v4h-4" />
    <path d="M7.75 7.5h4.5M10 7.5v5.5" />
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

export const CameraIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 7a1 1 0 0 1 1-1h2.5l1.5-2h4l1.5 2H16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <circle cx="10" cy="11" r="3" />
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
export const LockIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4.5" y="9" width="11" height="8" rx="1" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </Icon>
)

export const MoreIcon = (p: P) => (
  <Icon {...p} strokeWidth="0" fill="currentColor">
    {[5, 10, 15].map((x) => (
      <circle key={x} cx={x} cy="10" r="1.5" />
    ))}
  </Icon>
)

export const HeartIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 16.5s-6-3.6-6-8A3.5 3.5 0 0 1 10 6.3 3.5 3.5 0 0 1 16 8.5c0 4.4-6 8-6 8Z" />
  </Icon>
)

export const MinusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 10h12" />
  </Icon>
)

export const ExpandIcon = (p: P) => (
  <Icon {...p}>
    <path d="M11.5 3.5h5v5M8.5 16.5h-5v-5M16.5 3.5 11 9M3.5 16.5 9 11" />
  </Icon>
)

export const PageIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 2.5h7l3.5 3.5v11.5H5z" />
    <path d="M12 2.5V6h3.5" />
  </Icon>
)

export const InterleaveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 4.5h5M3.5 10h5M3.5 15.5h5" />
    <path d="M11.5 7.25h5M11.5 12.75h5" />
  </Icon>
)

export const ReverseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6.5 16V4M3.5 7l3-3 3 3" />
    <path d="M13.5 4v12M10.5 13l3 3 3-3" />
  </Icon>
)

export const SortIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 5h13M3.5 10h9M3.5 15h5" />
  </Icon>
)

export const CheckIcon = (p: P) => (
  <Icon {...p} strokeWidth="2">
    <path d="M5 10.5l3.2 3L15 6.5" />
  </Icon>
)

/** Two pictures on one sheet (#76). */
export const CombineIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 2.5h11v15h-11z" />
    <path d="M7 5h6v4H7zM7 11h6v4H7z" />
  </Icon>
)

/** A sheet coming apart into its pictures (#76). */
export const SplitIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 3.5h8v5H3zM9 11.5h8v5H9z" />
    <path d="M13.5 4.5l2 2-2 2M6.5 15.5l-2-2 2-2" />
  </Icon>
)
