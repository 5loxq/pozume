import * as SecureStore from 'expo-secure-store';

const AI_KEY = 'pozume.ai.cfg';

export interface AiConfig {
  baseUrl: string;   // z.B. https://api.melious.ai/v1
  apiKey: string;
  model: string;     // z.B. glm-5.3-flash
}

export async function saveAiConfig(cfg: AiConfig): Promise<void> {
  await SecureStore.setItemAsync(AI_KEY, JSON.stringify(cfg));
}

export async function loadAiConfig(): Promise<AiConfig | null> {
  const raw = await SecureStore.getItemAsync(AI_KEY);
  return raw ? JSON.parse(raw) as AiConfig : null;
}

export async function clearAiConfig(): Promise<void> {
  await SecureStore.deleteItemAsync(AI_KEY);
}

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** OpenAI-kompatibler Chat-Aufruf (non-streaming, reicht fuer die App) */
export async function aiChat(cfg: AiConfig, messages: ChatMessage[], maxTokens = 1200): Promise<string> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature: 0.4 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
