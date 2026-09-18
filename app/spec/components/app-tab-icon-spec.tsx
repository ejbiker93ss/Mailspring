import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { AppTabIcon, AppTabIconId } from '../../src/components/app-tab-icon';

describe('AppTabIcon', () => {
  it('renders every workspace on the same icon grid with distinct artwork', () => {
    const ids: AppTabIconId[] = [
      'Threads',
      'Kanban',
      'Calendar',
      'Contacts',
      'Activity',
      'Matrix',
      'GroupMe',
    ];
    const icons = ids.map((id) => ReactDOMServer.renderToStaticMarkup(<AppTabIcon id={id} />));

    expect(icons.every((icon) => icon.includes('viewBox="0 0 20 20"'))).toBe(true);
    expect(icons.every((icon) => icon.includes('aria-hidden="true"'))).toBe(true);
    expect(new Set(icons).size).toBe(ids.length);
  });

  it('uses the mail artwork for conversation tabs', () => {
    const mail = ReactDOMServer.renderToStaticMarkup(<AppTabIcon id="Threads" />);
    const conversation = ReactDOMServer.renderToStaticMarkup(<AppTabIcon id="Conversation" />);
    expect(conversation).toBe(mail);
  });
});
