/**
 * AI provider registry.
 *
 * All three supported providers expose an OpenAI-compatible Chat Completions
 * endpoint, so a single `openai` SDK client can talk to any of them by just
 * swapping `baseURL` + API key. This avoids pulling in @anthropic-ai/sdk,
 * @google/generative-ai etc. for what is effectively the same wire shape.
 *
 *   - OpenAI:   https://api.openai.com/v1
 *   - DeepSeek: https://api.deepseek.com/v1                 (OpenAI-compat)
 *   - Gemini:   https://generativelanguage.googleapis.com/v1beta/openai/
 *               (Google's official OpenAI-compat shim, GA in 2025)
 */

export type AiProviderId = 'openai' | 'deepseek' | 'gemini';

export interface AiProviderConfig {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** name of the env var that holds this provider's API key (preferred lookup) */
  keyEnv: string;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderConfig> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyEnv: 'OPENAI_API_KEY',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    keyEnv: 'GEMINI_API_KEY',
  },
};

export function isAiProviderId(value: string | undefined): value is AiProviderId {
  return value === 'openai' || value === 'deepseek' || value === 'gemini';
}
