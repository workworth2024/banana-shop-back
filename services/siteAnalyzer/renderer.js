/**
 * Renders JS-built pages (React/Vue/Tilda SPA shells) with headless Chrome — AdsBot and the
 * reviewers see the rendered page, and the raw HTML of an SPA has no text at all.
 *
 * Chrome binary: CHROME_PATH env (e.g. /usr/bin/chromium). Without it, falls back to Jina
 * Reader's browser engine when JINA_API_KEY is set (keyless Jina no longer renders JS),
 * otherwise rendering is skipped.
 *
 * Network safety: the target URL is SSRF-checked by the caller; Chrome's Local Network
 * Access rules block a public page's scripts from reading private/loopback addresses.
 */
import { execFile } from 'child_process';

const RENDER_TIMEOUT_MS = 20000;
const MAX_DOM_BYTES = 4 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

// One Chrome at a time: runs share Chrome's default profile (a fresh --user-data-dir hangs
// headless Chrome on this host), and a second instance on the same profile would hand off
// to the first through the process-singleton lock.
let chromeQueue = Promise.resolve();

function renderWithChrome(url, chromePath) {
  const run = () => new Promise((resolve, reject) => {
    execFile(chromePath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--mute-audio', '--no-first-run', '--disable-extensions',
      `--user-agent=${UA}`, '--virtual-time-budget=8000', '--dump-dom', url
    ], { timeout: RENDER_TIMEOUT_MS, maxBuffer: MAX_DOM_BYTES, killSignal: 'SIGKILL' }, (err, stdout) => {
      if (stdout) resolve(stdout);
      else reject(new Error(`chrome: ${err?.killed ? 'timeout' : (err?.message || 'empty DOM').split('\n')[0]}`));
    });
  });
  const result = chromeQueue.then(run, run);
  chromeQueue = result.catch(() => {});
  return result;
}

async function renderWithJina(url, apiKey) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS + 15000),
    headers: { Authorization: `Bearer ${apiKey}`, 'x-respond-with': 'html', 'x-engine': 'browser', 'x-timeout': '30', Accept: 'text/plain' }
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  return res.text();
}

/** Returns { html, via } or null when no renderer is configured / rendering failed. */
export async function renderPage(url) {
  try {
    if (process.env.CHROME_PATH) return { html: await renderWithChrome(url, process.env.CHROME_PATH), via: 'chrome' };
    if (process.env.JINA_API_KEY) return { html: await renderWithJina(url, process.env.JINA_API_KEY), via: 'jina' };
  } catch (e) {
    console.warn('[Renderer] failed:', e.message);
  }
  return null;
}
