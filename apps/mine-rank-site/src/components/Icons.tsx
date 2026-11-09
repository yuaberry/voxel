/** A tiny inline icon set — no extra dependency, no network, no bloat. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const PickaxeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 21l8.5-8.5" />
    <path d="M14.5 3.5c4 0 6 2.5 6 6-3.5 0-6-1-7.5-3.5" />
    <path d="M11 10.5C9 9 7 9.5 5 12c1.5 1.5 3 2 5 1.5" />
  </svg>
);

export const CoinsIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="9" cy="9" r="6" />
    <path d="M15.5 6.5a6 6 0 010 11" />
    <path d="M9 6.5v5M7.5 7.5h2.5a1.5 1.5 0 010 3H7.5" />
  </svg>
);

export const CubeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5V7z" />
    <path d="M12 12l8-4.5M12 12v9.5M12 12L4 7.5" />
  </svg>
);

export const MapIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 4.5L3.5 7v12.5L9 17l6 3 5.5-2.5V5L15 7.5z" />
    <path d="M9 4.5V17M15 7.5v12.5" />
  </svg>
);

export const ShieldIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3l7 3v5.5c0 4.5-3 8.2-7 9.5-4-1.3-7-5-7-9.5V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const SparkIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </svg>
);

export const HeartIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 20s-7-4.4-7-9.2A4 4 0 0112 8a4 4 0 017 2.8C19 15.6 12 20 12 20z" />
  </svg>
);

export const CheckIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const ArrowIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const TerminalIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 6.5l5 5-5 5" />
    <path d="M12 17.5h8" />
  </svg>
);

export const BugIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 6.5a3 3 0 016 0" />
    <rect x="8" y="7" width="8" height="11" rx="4" />
    <path d="M4 11h4M16 11h4M4 17h4M16 17h4M6.5 7L9 9M17.5 7L15 9" />
  </svg>
);
