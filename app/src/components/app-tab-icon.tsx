import React from 'react';

export type AppTabIconId =
  | 'Threads'
  | 'Kanban'
  | 'Calendar'
  | 'Contacts'
  | 'Activity'
  | 'Matrix'
  | 'GroupMe'
  | 'Conversation';

export function AppTabIcon({ id }: { id: AppTabIconId }) {
  let artwork: React.ReactNode;

  switch (id) {
    case 'Threads':
    case 'Conversation':
      artwork = (
        <>
          <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
          <path d="m3.5 5 6.5 5 6.5-5" />
        </>
      );
      break;
    case 'Kanban':
      artwork = (
        <>
          <rect x="2.5" y="3" width="4" height="14" rx="1.25" />
          <rect x="8" y="3" width="4" height="9" rx="1.25" />
          <rect x="13.5" y="3" width="4" height="12" rx="1.25" />
        </>
      );
      break;
    case 'Calendar':
      artwork = (
        <>
          <rect x="2.5" y="4" width="15" height="13.5" rx="2" />
          <path d="M6 2.5v3M14 2.5v3M2.5 8h15" />
          <path d="M6 11h2M11.5 11h2M6 14h2M11.5 14h2" />
        </>
      );
      break;
    case 'Contacts':
      artwork = (
        <>
          <rect x="2.5" y="3" width="15" height="14" rx="2" />
          <circle cx="7" cy="8" r="2" />
          <path d="M4.5 14c.4-2.3 4.6-2.3 5 0M12 7h3M12 10h3M12 13h2" />
        </>
      );
      break;
    case 'Activity':
      artwork = (
        <>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 5.5V10l3 2" />
        </>
      );
      break;
    case 'Matrix':
      artwork = (
        <>
          <path d="M3 3.5h14v10H8l-4.5 3v-13Z" />
          <path d="M6.5 7.5h7M6.5 10.5h4.5" />
        </>
      );
      break;
    case 'GroupMe':
      artwork = (
        <>
          <path d="M5 3h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-4.5 3v-4A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2Z" />
          <path d="M8.25 6 7.5 12M12.5 6l-.75 6M6 8h8M5.5 10.5h8" />
        </>
      );
      break;
    default:
      artwork = null;
  }

  return (
    <svg
      className={id === 'GroupMe' ? 'app-tab-icon app-tab-icon-groupme' : 'app-tab-icon'}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      {artwork}
    </svg>
  );
}
