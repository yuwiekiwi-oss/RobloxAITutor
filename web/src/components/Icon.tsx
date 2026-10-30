// Hand-drawn 24px stroke icon set (one visual language instead of emoji).
const PATHS = {
  code: <path d="M8.5 6.5 3 12l5.5 5.5M15.5 6.5 21 12l-5.5 5.5" />,
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m20.5 16-4.8-4.8L7 19.5" />
    </>
  ),
  send: <path d="M4.5 12h14M13 6l6 6-6 6" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2" />
    </>
  ),
  tree: (
    <>
      <rect x="3" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="4.5" rx="1.5" />
      <rect x="13" y="16.5" width="8" height="4.5" rx="1.5" />
      <path d="M6.5 8.5v10.25H13M6.5 12.25H13" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 9a5.5 5.5 0 1 1 11 0c0 5.5 2.5 7.5 2.5 7.5H4s2.5-2 2.5-7.5" />
      <path d="M10.2 20a2 2 0 0 0 3.6 0" />
    </>
  ),
  flag: <path d="M5 21V4M5 4.5h12.5l-2.5 4 2.5 4H5" />,
  bulb: (
    <>
      <path d="M9.5 18h5M10.5 21h3" />
      <path d="M12 3a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6V17h6v-.6c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 3Z" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.4a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 3.6" />
      <path d="M12 17.2h.01" />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  logout: (
    <>
      <path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" />
      <path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5A8 8 0 1 0 17.6 17" />
      <path d="M20 4.5v7h-7" />
    </>
  ),
  chat: <path d="M20.5 15a2 2 0 0 1-2 2H8l-4.5 3.5V5.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r=".6" fill="currentColor" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19Z" />
      <path d="M12 10v4.5M12 17.4h.01" />
    </>
  ),
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10 5.7A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.2M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2" />
      <path d="M3.5 3.5l17 17M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
