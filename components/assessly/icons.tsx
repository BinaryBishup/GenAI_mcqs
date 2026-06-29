// The icon set used across Assessly, as thin SVG wrappers. Stroke-based, sized
// via `s`, colour via `currentColor` unless a stroke is passed. Paths are taken
// verbatim from the design so the visual language is identical.

import React from "react";

type P = { s?: number; stroke?: string; sw?: number; style?: React.CSSProperties; className?: string };

function S({ s = 18, stroke = "currentColor", sw = 1.7, style, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke={stroke} strokeWidth={sw} style={style} className={className}>
      {children}
    </svg>
  );
}

export const IconDashboard = (p: P) => (
  <S {...p}>
    <rect x="2" y="2" width="6" height="6" rx="1.5" />
    <rect x="10" y="2" width="6" height="6" rx="1.5" />
    <rect x="2" y="10" width="6" height="6" rx="1.5" />
    <rect x="10" y="10" width="6" height="6" rx="1.5" />
  </S>
);
export const IconLoop = (p: P) => (
  <S {...p}>
    <path d="M15.5 9a6.5 6.5 0 11-1.9-4.6M15.5 2.5V6H12" />
  </S>
);
export const IconSpark = (p: P) => (
  <S {...p}>
    <path d="M9 2.2l1.7 4.1 4.1 1.7-4.1 1.7L9 15.8 7.3 9.7 3.2 8l4.1-1.7z" />
  </S>
);
export const IconCheck = (p: P) => (
  <S sw={2.2} {...p}>
    <path d="M3.5 9.5l3.5 3.5 7.5-8" />
  </S>
);
export const IconBank = (p: P) => (
  <S {...p}>
    <rect x="2.5" y="3" width="13" height="4" rx="1.5" />
    <rect x="2.5" y="9" width="13" height="6" rx="1.5" />
  </S>
);
export const IconLock = (p: P) => (
  <S sw={1.6} {...p}>
    <rect x="4" y="8" width="10" height="7" rx="1.5" />
    <path d="M6 8V6a3 3 0 016 0v2" />
  </S>
);
export const IconChevLeft = (p: P) => (
  <S sw={2} {...p}>
    <path d="M11 4L6 9l5 5" />
  </S>
);
export const IconChevRight = (p: P) => (
  <S sw={2} {...p}>
    <path d="M7 4l5 5-5 5" />
  </S>
);
export const IconChevUp = (p: P) => (
  <S sw={1.8} {...p}>
    <path d="M5 11l4-4 4 4" />
  </S>
);
export const IconSearch = (p: P) => (
  <S sw={1.8} {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M12.5 12.5L16 16" />
  </S>
);
export const IconFolder = (p: P) => (
  <S sw={1.6} {...p}>
    <path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h2.6l1.4 1.6H14a1.5 1.5 0 011.5 1.5v5.4A1.5 1.5 0 0114 14H4a1.5 1.5 0 01-1.5-1.5z" />
  </S>
);
export const IconBook = (p: P) => (
  <S sw={1.6} {...p}>
    <path d="M3 4.5A1.5 1.5 0 014.5 3H9v12H4.5A1.5 1.5 0 013 13.5z" />
    <path d="M9 3h4.5A1.5 1.5 0 0115 4.5v9a1.5 1.5 0 01-1.5 1.5H9" />
  </S>
);
export const IconPlus = (p: P) => (
  <S sw={2} {...p}>
    <path d="M9 4v10M4 9h10" />
  </S>
);
export const IconTrash = (p: P) => (
  <S sw={1.7} {...p}>
    <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5h6.6L13 5M7.5 8v4M10.5 8v4" />
  </S>
);
export const IconPencil = (p: P) => (
  <S {...p}>
    <path d="M11.5 3.5l3 3M3 13l8.5-8.5 3 3L6 16l-3.5.5z" />
  </S>
);
export const IconX = (p: P) => (
  <S sw={2} {...p}>
    <path d="M5 5l8 8M13 5l-8 8" />
  </S>
);
export const IconInfo = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 8.2v3.3M9 6.2v.2" />
  </S>
);
export const IconWarn = (p: P) => (
  <S sw={1.8} {...p}>
    <path d="M9 2.5l6.5 11.5h-13z" />
    <path d="M9 7.5v3M9 12.3v.2" />
  </S>
);
export const IconXCircle = (p: P) => (
  <S sw={1.8} {...p}>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" />
  </S>
);
export const IconUpload = (p: P) => (
  <S sw={1.6} {...p}>
    <path d="M9 12V3M5.5 6.5L9 3l3.5 3.5M3 14.5h12" />
  </S>
);
export const IconShift = (p: P) => (
  <S sw={2} {...p}>
    <path d="M9 14V4M5 7l4-3 4 3" />
  </S>
);
export const IconClock = (p: P) => (
  <S sw={1.8} {...p}>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 5.5V9l2.5 1.5" />
  </S>
);
export const IconFile = (p: P) => (
  <S sw={1.5} {...p}>
    <path d="M4 2.5h6l4 4v9H4z" />
    <path d="M10 2.5v4h4" />
  </S>
);
export const IconLogout = (p: P) => (
  <S sw={1.6} {...p}>
    <path d="M7 3.5H4.5A1.5 1.5 0 003 5v8a1.5 1.5 0 001.5 1.5H7M11 12l3-3-3-3M14 9H6.5" />
  </S>
);
export const IconImage = (p: P) => (
  <S sw={1.6} {...p}>
    <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
    <circle cx="6.5" cy="7.5" r="1.4" />
    <path d="M3.5 13l4-4 3.5 3 2-1.5 2 2" />
  </S>
);
