import { KeyManager } from 'summermail-exports';

export type MailAssistantProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'grok'
  | 'custom';

export const PROVIDER_CONFIG_KEY = 'core.mailAssistant.provider';
export const PROVIDERS_CONFIG_KEY = 'core.mailAssistant.providers';
export const LEGACY_MODEL_CONFIG_KEY = 'core.mailAssistant.model';

export interface MailAssistantProviderConfig {
  provider: MailAssistantProvider;
  model: string;
  apiKey: string;
  endpoint?: string;
  supportsTools: boolean;
  supportsImages: boolean;
}

export function providerConfigurationIsReady(config: MailAssistantProviderConfig) {
  if (!config.model) return false;
  if (config.apiKey) return true;
  if (config.provider !== 'custom' || !config.endpoint) return false;
  try {
    const url = new URL(config.endpoint);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

const providerDetails: Record<
  MailAssistantProvider,
  {
    keyName: string;
    env: string[];
    defaultModel: string;
    supportsTools: boolean;
    supportsImages: boolean;
  }
> = {
  openai: {
    keyName: 'openai-mail-assistant-api-key',
    env: ['MSSE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: 'gpt-5.6-terra',
    supportsTools: true,
    supportsImages: true,
  },
  anthropic: {
    keyName: 'anthropic-mail-assistant-api-key',
    env: ['MSSE_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
    defaultModel: 'claude-sonnet-4-5',
    supportsTools: true,
    supportsImages: true,
  },
  google: {
    keyName: 'google-mail-assistant-api-key',
    env: ['MSSE_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    defaultModel: 'gemini-2.5-flash',
    supportsTools: true,
    supportsImages: true,
  },
  deepseek: {
    keyName: 'deepseek-mail-assistant-api-key',
    env: ['MSSE_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-chat',
    supportsTools: true,
    supportsImages: false,
  },
  grok: {
    keyName: 'grok-mail-assistant-api-key',
    env: ['MSSE_XAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY'],
    defaultModel: 'grok-4.6',
    supportsTools: true,
    supportsImages: true,
  },
  custom: {
    keyName: 'custom-mail-assistant-api-key',
    env: ['MSSE_CUSTOM_AI_API_KEY'],
    defaultModel: '',
    supportsTools: false,
    supportsImages: false,
  },
};

export function isMailAssistantProvider(value: unknown): value is MailAssistantProvider {
  return typeof value === 'string' && value in providerDetails;
}

export function providerLabel(provider: MailAssistantProvider) {
  return {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Gemini',
    deepseek: 'DeepSeek',
    grok: 'Grok (xAI)',
    custom: 'Custom compatible API',
  }[provider];
}

export function getManagedMailAssistantAPIKey(provider: MailAssistantProvider = activeProvider()) {
  for (const name of providerDetails[provider].env) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function activeProvider(): MailAssistantProvider {
  const value = AppEnv.config.get(PROVIDER_CONFIG_KEY);
  return isMailAssistantProvider(value) ? value : 'openai';
}

function savedProviderSettings(provider: MailAssistantProvider): Record<string, any> {
  const providers = AppEnv.config.get(PROVIDERS_CONFIG_KEY) || {};
  return providers[provider] || {};
}

export function providerModel(provider: MailAssistantProvider = activeProvider()) {
  const saved = String(savedProviderSettings(provider).model || '').trim();
  if (saved) return saved;
  if (provider === 'openai') {
    return String(
      AppEnv.config.get(LEGACY_MODEL_CONFIG_KEY) || providerDetails.openai.defaultModel
    );
  }
  return providerDetails[provider].defaultModel;
}

export function providerEndpoint(provider: MailAssistantProvider = activeProvider()) {
  return String(savedProviderSettings(provider).endpoint || '').trim();
}

export async function getMailAssistantAPIKey(provider: MailAssistantProvider = activeProvider()) {
  return (
    getManagedMailAssistantAPIKey(provider) ||
    KeyManager.getPassword(providerDetails[provider].keyName)
  );
}

export async function resolveMailAssistantProviderConfig(): Promise<MailAssistantProviderConfig> {
  const provider = activeProvider();
  const saved = savedProviderSettings(provider);
  return {
    provider,
    model: providerModel(provider),
    apiKey: (await getMailAssistantAPIKey(provider)) || '',
    endpoint: providerEndpoint(provider),
    supportsTools:
      provider === 'custom'
        ? saved.supportsTools === true
        : providerDetails[provider].supportsTools,
    supportsImages:
      provider === 'custom'
        ? saved.supportsImages === true
        : providerDetails[provider].supportsImages,
  };
}

export async function saveMailAssistantProviderKey(
  provider: MailAssistantProvider,
  apiKey: string
) {
  if (apiKey.trim())
    await KeyManager.replacePassword(providerDetails[provider].keyName, apiKey.trim());
}

export async function removeMailAssistantProviderKey(provider: MailAssistantProvider) {
  await KeyManager.deletePassword(providerDetails[provider].keyName);
}

export function saveMailAssistantProviderSettings(
  provider: MailAssistantProvider,
  settings: { model: string; endpoint?: string; supportsTools?: boolean; supportsImages?: boolean }
) {
  const providers = { ...(AppEnv.config.get(PROVIDERS_CONFIG_KEY) || {}) };
  providers[provider] = { ...providers[provider], ...settings };
  AppEnv.config.set(PROVIDER_CONFIG_KEY, provider);
  AppEnv.config.set(PROVIDERS_CONFIG_KEY, providers);
  if (provider === 'openai') AppEnv.config.set(LEGACY_MODEL_CONFIG_KEY, settings.model);
}

export function providerKeyName(provider: MailAssistantProvider) {
  return providerDetails[provider].keyName;
}
