import { KeyManager } from 'summermail-exports';

import {
  getMailAssistantAPIKey,
  getManagedMailAssistantAPIKey,
} from '../lib/preferences-mail-assistant';
import {
  getManagedMailAssistantAPIKey as getManagedProviderAPIKey,
  providerLabel,
} from '../lib/ai-provider-settings';

describe('Mail assistant credentials', () => {
  let originalCompanyKey: string | undefined;
  let originalStandardKey: string | undefined;
  let originalAnthropicKey: string | undefined;
  let originalGeminiKey: string | undefined;
  let originalXAIKey: string | undefined;

  beforeEach(() => {
    originalCompanyKey = process.env.MSSE_OPENAI_API_KEY;
    originalStandardKey = process.env.OPENAI_API_KEY;
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    originalGeminiKey = process.env.GEMINI_API_KEY;
    originalXAIKey = process.env.XAI_API_KEY;
    delete process.env.MSSE_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
  });

  afterEach(() => {
    if (originalCompanyKey === undefined) delete process.env.MSSE_OPENAI_API_KEY;
    else process.env.MSSE_OPENAI_API_KEY = originalCompanyKey;
    if (originalStandardKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalStandardKey;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalXAIKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = originalXAIKey;
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

  it('keeps managed credentials isolated by provider', () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.XAI_API_KEY = 'xai-key';

    expect(getManagedProviderAPIKey('anthropic')).toBe('anthropic-key');
    expect(getManagedProviderAPIKey('google')).toBe('gemini-key');
    expect(getManagedProviderAPIKey('deepseek')).toBe('');
    expect(getManagedProviderAPIKey('grok')).toBe('xai-key');
  });

  it('uses clear labels for every supported provider', () => {
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('anthropic')).toBe('Anthropic');
    expect(providerLabel('google')).toBe('Google Gemini');
    expect(providerLabel('deepseek')).toBe('DeepSeek');
    expect(providerLabel('grok')).toBe('Grok (xAI)');
    expect(providerLabel('custom')).toBe('Custom compatible API');
  });
});
