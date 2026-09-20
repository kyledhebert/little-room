import { setTimeout as delay } from "node:timers/promises";

// Content is required for a deploy, but a brief upstream outage should be retried.
export const fetchContentJson = async <T>(url: URL): Promise<T> => {
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (cause) {
      if (attempt < attempts) {
        await delay(1_000 * attempt);
        continue;
      }
      throw new Error(`Content request to ${url} failed after ${attempts} attempts.`, { cause });
    }

    if (response.ok) return await response.json() as T;

    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    // Read the error before retrying so the response body is consumed.
    const detail = (await response.text()).slice(0, 500);
    if (retryable && attempt < attempts) {
      await delay(1_000 * attempt);
      continue;
    }

    throw new Error(
      `Content request to ${url} failed: HTTP ${response.status} ${response.statusText} ` +
      `(attempt ${attempt}/${attempts})${detail ? `: ${detail}` : ""}`
    );
  }

  throw new Error("Content request exhausted its retry attempts.");
};
