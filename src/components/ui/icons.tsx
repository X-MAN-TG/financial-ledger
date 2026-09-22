/**
 * Small stroked icon set.
 *
 * Inline SVG rather than an icon package so the sandboxed file preview (no
 * network) still renders them, and so stroke colour always inherits the
 * surrounding token colour.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IcLedger = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5A1.5 1.5 0 015.5 4H18a2 2 0 012 2v12a2 2 0 01-2 2H5.5A1.5 1.5 0 014 18.5v-13z" />
    <path d="M8 8.5h8M8 12h8M8 15.5h5" />
  </Svg>
);

export const IcTimeline = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v3M16 3v3M3.5 9h17" />
    <path d="M5 6h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 015 6z" />
  </Svg>
);

export const IcAnalytics = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const IcCustomers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 19v-1.5a4 4 0 00-4-4H7a4 4 0 00-4 4V19" />
    <path d="M9.5 9.5a3.25 3.25 0 100-6.5 3.25 3.25 0 000 6.5M17 11.5a3 3 0 100-6M21 19v-1.5a3.8 3.8 0 00-2.8-3.6" />
  </Svg>
);

export const IcAccount = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 20v-1.6a5 5 0 00-5-5H9a5 5 0 00-5 5V20" />
    <path d="M12 10.5a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5" />
  </Svg>
);

export const IcHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5L12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
  </Svg>
);

export const IcArrowDownLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 7L7 17M7 9v8h8" />
  </Svg>
);

export const IcArrowUpRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 17L17 7M9 7h8v8" />
  </Svg>
);

export const IcWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7.5A1.5 1.5 0 014.5 6H18a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7.5z" />
    <path d="M16 12.5h2.5" />
  </Svg>
);

export const IcCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

export const IcCheckCircle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 11-4.5-7.8" />
    <path d="M9 12l2.5 2.5L21 5" />
  </Svg>
);

export const IcClock = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const IcTrend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 16.5l5.5-5.5 3.5 3.5L21 5" />
    <path d="M15 5h6v6" />
  </Svg>
);

export const IcCoins = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z" />
    <path d="M20 6v6c0 1.7-3.6 3-8 3s-8-1.3-8-3V6" />
    <path d="M20 12v6c0 1.7-3.6 3-8 3s-8-1.3-8-3v-6" />
  </Svg>
);

export const IcShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
    <path d="M9.2 12l2 2 3.6-3.8" />
  </Svg>
);

export const IcCloud = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18h10.5a3.5 3.5 0 000-7 5 5 0 00-9.7-1.3A3.85 3.85 0 007 18z" />
  </Svg>
);

export const IcDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v11M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 18.5h16" />
  </Svg>
);

export const IcPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IcTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" />
  </Svg>
);

export const IcNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.5h14a.5.5 0 01.5.5v10L14 20H5a.5.5 0 01-.5-.5V5a.5.5 0 01.5-.5z" />
    <path d="M19.5 15H14v5" />
  </Svg>
);

export const IcNoteFilled = ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M5 3.5h14a1.5 1.5 0 011.5 1.5v9.2a1.5 1.5 0 01-.44 1.06l-4.8 4.8a1.5 1.5 0 01-1.06.44H5A1.5 1.5 0 013.5 19V5A1.5 1.5 0 015 3.5zm8.8 16.06L19.56 14H15.3a1.5 1.5 0 00-1.5 1.5v4.06z" />
  </svg>
);

export const IcCalendar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v3M16 3v3M3.5 9.5h17" />
    <path d="M5 6h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 015 6z" />
  </Svg>
);

export const IcChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);

export const IcChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
);

export const IcPause = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 5v14M14.5 5v14" />
  </Svg>
);

export const IcPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5l12 7.5-12 7.5v-15z" />
  </Svg>
);

export const IcUsers = (p: IconProps) => IcCustomers(p);

export const IcColumns = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v14H4z" />
    <path d="M10 5v14M16 5v14" />
  </Svg>
);

export const IcAudit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h9l5 5v11a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" />
    <path d="M14 4v5h5M8 13h8M8 16.5h5" />
  </Svg>
);

export const IcSystem = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
    <path d="M19.4 15a1.6 1.6 0 00.32 1.77l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.6 1.6 0 0015 19.4a1.6 1.6 0 00-1 1.47V21a2 2 0 11-4 0v-.1A1.6 1.6 0 009 19.4a1.6 1.6 0 00-1.77.32l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.6 1.6 0 004.6 15a1.6 1.6 0 00-1.47-1H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.32-1.77l-.06-.06a2 2 0 112.83-2.83l.06.06A1.6 1.6 0 009 4.6h.08A1.6 1.6 0 0010 3.13V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.47 1.6 1.6 0 001.77-.32l.06-.06a2 2 0 112.83 2.83l-.06.06A1.6 1.6 0 0019.4 9v.08a1.6 1.6 0 001.47 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
  </Svg>
);

export const IcSearch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" />
  </Svg>
);

export const IcRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 10-.7 4.5" />
    <path d="M20 4.5V11h-6.5" />
  </Svg>
);
