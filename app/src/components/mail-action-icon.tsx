import React from 'react';

const glyphs = {
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8m-9 4h4" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />,
  spam: (
    <>
      <path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5Z" />
      <path d="M12 8v5m0 3v.1" />
    </>
  ),
  'not-spam': <path d="M12 22c5-2 8-6 8-11V5l-8-3-8 3v6c0 5 3 9 8 11Zm-3-10 2 2 4-4" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z" />,
  read: <path d="M4 10v9h16v-9l-8-6-8 6Zm0 0 8 5 8-5" />,
  unread: <path d="M20 11v8H4V5h10M4 7l8 6 3-2m4-5v.1" />,
  'move-folder': <path d="M21 9V6h-9L9 3H4a1 1 0 0 0-1 1v15h18v-6m-12 0h7m-3-3 3 3-3 3" />,
  print: <path d="M7 8V4h10v4M7 17H4V9h16v8h-3M7 14h10v7H7zm10-3h.1" />,
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  'pop-out': <path d="M12 5H5v14h14v-7m-5-7h5v5m0-5-8 8" />,
  'pop-in': <path d="M12 5h7v14H5v-7M5 5l8 8m-5 0h5V8" />,
  expand: <path d="m8 8 4-4 4 4M8 16l4 4 4-4" />,
  collapse: <path d="m8 5 4 4 4-4m-8 14 4-4 4 4" />,
  reply: <path d="M9 17 4 12l5-5m11 11v-2a4 4 0 0 0-4-4H4" />,
  'reply-all': <path d="m6 17-5-5 5-5m6 10-5-5 5-5m9 11v-2a4 4 0 0 0-4-4H7" />,
  forward: <path d="m15 17 5-5-5-5M4 18v-2a4 4 0 0 1 4-4h12" />,
  source: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-13-4 16" />,
  more: <path d="M5 12h.1m6.9 0h.1m6.9 0h.1" />,
  'rotate-left': <path d="M3 5v5h5m-5 0a9 9 0 1 1 2 8" />,
  'rotate-right': <path d="M21 5v5h-5m5 0a9 9 0 1 0-2 8" />,
};

export type MailActionIconName = keyof typeof glyphs;

export function MailActionIcon({
  name,
  filled = false,
}: {
  name: MailActionIconName;
  filled?: boolean;
}) {
  return (
    <svg
      className="mail-action-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  );
}
