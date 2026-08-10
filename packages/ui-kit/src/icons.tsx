interface IconProps {
  size?: number;
}

function svg(path: React.ReactNode, size = 16) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const IconPlus = ({ size }: IconProps) => svg(<path d="M12 5v14M5 12h14" />, size);

export const IconChevron = ({ size }: IconProps) => svg(<path d="m6 9 6 6 6-6" />, size);

export const IconPanelLeft = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>,
    size,
  );

export const IconPanelRight = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>,
    size,
  );

export const IconX = ({ size }: IconProps) => svg(<path d="M18 6 6 18M6 6l12 12" />, size);

export const IconSearch = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    size,
  );

export const IconChat = ({ size }: IconProps) =>
  svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />, size);

export const IconCompass = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>,
    size,
  );

export const IconBox = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" />
    </>,
    size,
  );

export const IconChart = ({ size }: IconProps) =>
  svg(<path d="M3 3v18h18M8 17V9m5 8V5m5 12v-6" />, size);

export const IconWrench = ({ size }: IconProps) =>
  svg(
    <path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.8L3 17.8V21h3.2l5.7-5.7a4.5 4.5 0 0 0 5.8-6L14.9 12l-2.9-2.9z" />,
    size,
  );

export const IconFlow = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M6 9v3a3 3 0 0 0 3 3h6" />
    </>,
    size,
  );

export const IconPlug = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0z" />
      <path d="M12 16v5" />
    </>,
    size,
  );

export const IconGear = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.09a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </>,
    size,
  );

export const IconDots = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>,
    size,
  );

export const IconCloud = ({ size }: IconProps) =>
  svg(<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A4 4 0 0 0 6.5 19z" />, size);

export const IconBolt = ({ size }: IconProps) =>
  svg(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />, size);

export const IconColumns = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="3" y="4" width="7" height="16" rx="1.5" />
      <rect x="14" y="4" width="7" height="16" rx="1.5" />
    </>,
    size,
  );

export const IconBook = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M4 4v15a1 1 0 0 0 1 1h14" />
      <path d="M6 3h11a1 1 0 0 1 1 1v13H7a1 1 0 0 1-1-1z" />
    </>,
    size,
  );

export const IconBell = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>,
    size,
  );

export const IconSpeaker = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </>,
    size,
  );

export const IconGrid = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
    size,
  );

export const IconClock = ({ size }: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
    size,
  );

export const IconAgent = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4M9 3h6" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    </>,
    size,
  );

export const IconHeart = ({ size, filled }: IconProps & { filled?: boolean }) =>
  svg(
    <path
      d="M12 20.5 4.2 12.7a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5z"
      fill={filled ? "currentColor" : "none"}
    />,
    size,
  );

export const IconDownload = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </>,
    size,
  );

export const IconUpload = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M12 21V9" />
      <path d="m7 12 5-5 5 5" />
      <path d="M5 3h14" />
    </>,
    size,
  );

export const IconPencil = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>,
    size,
  );

/** App logo mark: rounded square with an H node-graph. */
export const LogoMark = ({ size = 26 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="hsLogo" x1="0" y1="0" x2="1" y2="1">
        {/* Solid: both stops the accent, so the mark is flat, not a gradient. */}
        <stop offset="0" stopColor="var(--accent)" />
        <stop offset="1" stopColor="var(--accent)" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#hsLogo)" />
    {/* H posts + connecting bar */}
    <path
      d="M10.5 8.5v15M21.5 8.5v15M10.5 16h11"
      stroke="#fff"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* central hub node — the "station" that harnesses the models */}
    <circle cx="16" cy="16" r="3.4" fill="url(#hsLogo)" stroke="#fff" strokeWidth="2" />
  </svg>
);
