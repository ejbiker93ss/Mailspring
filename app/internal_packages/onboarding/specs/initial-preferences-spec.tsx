import { ipcRenderer } from 'electron';
import InitialPreferencesPage from '../lib/page-initial-preferences';

describe('InitialPreferencesPage', () => {
  it('finishes account setup without routing through a subscription page', () => {
    spyOn(ipcRenderer, 'send');

    const page = new InitialPreferencesPage({});
    page._onFinished();

    expect(ipcRenderer.send).toHaveBeenCalledWith('account-setup-successful');
  });
});
