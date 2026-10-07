import { GoogleGenAI } from '@google/genai';
import { logger } from 'firebase-functions';

type Attempt = { model: string; search: boolean };

export type Ask = <T>(prompt: string, parse: (text: string) => T) => Promise<T>;

/**
 * Asks the first model that answers. Models get refused for quota (429) or
 * load (503) independently, and web search has its own, often smaller, quota;
 * without it the model answers from its own knowledge, much faster. An attempt
 * the service refused or that timed out is skipped for a while, so later
 * questions don't pay for it again; a merely unusable answer is not held
 * against the model.
 */
export function createAsker(
  apiKey: string,
  models: string[],
  mode: 'search-first' | 'fast-first' | 'no-search',
  timeoutMs = 60_000,
): Ask {
  // Fail fast on a refused model and move on, rather than retrying it.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  const attempts: Attempt[] = models.flatMap((model) =>
    mode === 'no-search'
      ? [{ model, search: false }]
      : [
          { model, search: mode === 'search-first' },
          { model, search: mode !== 'search-first' },
        ],
  );
  // When each attempt may be tried again, by index.
  const skipUntil = new Map<number, number>();

  return async function ask<T>(prompt: string, parse: (text: string) => T): Promise<T> {
    let lastError: unknown = new Error('No text model configured');
    // If everything is currently being skipped, try them all rather than fail outright.
    const usable = attempts.map((_, i) => i).filter((i) => (skipUntil.get(i) ?? 0) <= Date.now());
    for (const i of usable.length ? usable : attempts.map((_, index) => index)) {
      const { model, search } = attempts[i];
      let text: string;
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            ...(search ? { tools: [{ googleSearch: {} }] } : { responseMimeType: 'application/json' }),
            temperature: 0.2,
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        });
        text = response.text ?? '';
      } catch (err) {
        // Refused (quota, overload, unknown model) or timed out: leave it alone for a while.
        skipUntil.set(i, Date.now() + SKIP_REFUSED_MS);
        lastError = err;
        logger.warn('Model attempt failed', { model, search, err: String(err).slice(0, 200) });
        continue;
      }
      try {
        return parse(text);
      } catch (err) {
        lastError = err;
        logger.warn('Model reply unusable', { model, search, err: String(err).slice(0, 200) });
      }
    }
    throw lastError;
  };
}

const SKIP_REFUSED_MS = 10 * 60 * 1000;

/** Pulls the JSON object out of a reply that may be wrapped in prose or code fences. */
export function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in the reply');
  const value: unknown = JSON.parse(text.slice(start, end + 1));
  if (typeof value !== 'object' || value === null) throw new Error('Reply is not an object');
  return value as Record<string, unknown>;
}

/** Keeps names from a request from breaking out of a prompt. */
export function plain(text: string, max = 120): string {
  return text.replace(/[\p{Cc}"`<>{}[\]]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
