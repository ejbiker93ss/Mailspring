import { KeyManager } from 'mailspring-exports';

import {
  getMailAssistantAPIKey,
  getManagedMailAssistantAPIKey,
} from '../lib/preferences-mail-assistant';

describe('Mail assistant credentials', () => {
  let originalCompanyKey: string | undefined;
  let originalStandardKey: string | undefined;

  beforeEach(() => {
    originalCompanyKey = process.env.MSSE_OPENAI_API_KEY;
    originalStandardKey = process.env.OPENAI_API_KEY;
    delete process.env.MSSE_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalCompanyKey === undefined) delete process.env.MSSE_OPENAI_API_KEY;
    else process.env.MSSE_OPENAI_API_KEY = originalCompanyKey;
    if (originalStandardKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalStandardKey;
  });

  it('prefers a company-managed environment credential without reading saved app data', async () => {
    process.env.MSSE_OPENAI_API_KEY = 'company-managed-key';
    spyOn(KeyManager, 'getPassword');

    expect(getManagedMailAssistantAPIKey()).toBe('company-managed-key');
    expect(await getMailAssistantAPIKey()).toBe('company-managed-key');
    expect(KeyManager.getPassword).not.toHaveBeenCalled();
  });

  it('supports the standard OpenAI environment variable', async () => {
    process.env.OPENAI_API_KEY = 'standard-managed-key';
    spyOn(KeyManager, 'getPassword');

    expect(await getMailAssistantAPIKey()).toBe('standard-managed-key');
    expect(KeyManager.getPassword).not.toHaveBeenCalled();
  });

  it('falls back to the operating-system credential store for personal setup', async () => {
    spyOn(KeyManager, 'getPassword').andReturn(Promise.resolve('saved-key'));

    expect(await getMailAssistantAPIKey()).toBe('saved-key');
  });
});
