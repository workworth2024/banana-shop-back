/**
 * Renders JS-built pages (React/Vue/Tilda SPA shells) with headless Chrome — AdsBot and the
 * reviewers see the rendered page, and the raw HTML of an SPA has no text at all.
 *
 * Chrome binary: CHROME_PATH env (e.g. /usr/bin/chromium). Without it, falls back to Jina
 * Reader's browser engine when JINA_API_KEY is set (keyless Jina no longer renders JS),
 * otherwise rendering is skipped.
 *
 * Network safety: the target URL is SSRF-checked by the caller, and Chrome itself is forced
 * through egressProxy.js (every navigation, subresource, CONNECT and WebSocket is resolved there
 * with the SSRF guard), so the page's JS can't redirect or rebind it to private/loopback addresses.
 * QUIC and non-proxied WebRTC UDP are disabled so nothing bypasses the proxy.
 *
 * Process safety: Chrome renders attacker-chosen pages, so a renderer exploit must not land as
 * root. Chrome runs as the unprivileged CHROME_USER (default `analyzer-chrome`) WITH its sandbox
 * (no --no-sandbox), with a scrubbed environment. If the backend runs as root and that user is
 * missing, rendering is refused instead of falling back to an unsandboxed root Chrome.
 * Keep CHROME_PATH on a current Chrome for Testing stable build (V8 0-days are fixed every few weeks).
 */
import { execFile } from 'child_process';
import fs from 'fs';
import { getEgressProxy } from './egressProxy.js';
import { assertPublicUrl } from './netGuard.js';

const RENDER_TIMEOUT_MS = 20000;
const MAX_DOM_BYTES = 4 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

let sandboxUser;
/** uid/gid/home of CHROME_USER from /etc/passwd (null when missing). */
function chromeUser() {
  if (sandboxUser !== undefined) return sandboxUser;
  const name = process.env.CHROME_USER || 'analyzer-chrome';
  const line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.split(':')[0] === name);
  const [, , uid, gid, , home] = line ? line.split(':') : [];
  sandboxUser = line && Number(uid) > 0 ? { uid: Number(uid), gid: Number(gid), home } : null;
  return sandboxUser;
}

// One Chrome at a time: runs share Chrome's default profile (a fresh --user-data-dir hangs
// headless Chrome on this host), and a second instance on the same profile would hand off
// to the first through the process-singleton lock.
let chromeQueue = Promise.resolve();

async function renderWithChrome(url, chromePath) {
  assertPublicUrl(url);
  const user = process.getuid?.() === 0 ? chromeUser() : null;
  if (process.getuid?.() === 0 && !user) throw new Error(`sandbox user ${process.env.CHROME_USER || 'analyzer-chrome'} is missing — refusing to run Chrome as root`);
  const proxy = await getEgressProxy();
  const run = () => new Promise((resolve, reject) => {
    execFile(chromePath, [
      '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--mute-audio', '--no-first-run', '--disable-extensions', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--no-pings',
      `--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>', '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-features=DnsOverHttps',
      `--user-agent=${UA}`, '--virtual-time-budget=8000', '--dump-dom', url
    ], {
      timeout: RENDER_TIMEOUT_MS, maxBuffer: MAX_DOM_BYTES, killSignal: 'SIGKILL',
      ...(user ? { uid: user.uid, gid: user.gid, cwd: user.home } : {}),
      // no secrets from the backend's environment (.env) inside the browser process
      env: { PATH: '/usr/bin:/bin', HOME: user?.home || process.env.HOME, LANG: 'en_US.UTF-8' }
    }, (err, stdout) => {
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
