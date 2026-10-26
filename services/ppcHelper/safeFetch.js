/**
 * SSRF-safe GET for the PPC Helper (OWASP A01:2025 / API7:2023).
 *
 * The Site Analyzer's fetchPublic checks DNS first and then lets fetch() resolve again, which leaves a
 * DNS-rebinding window (public IP on the check, 127.0.0.1 on the connect). Here the check happens inside
 * the socket's own `lookup`, so the address that is validated is the address that is connected to.
 * Every redirect hop goes through the same path. Same return shape as fetchPublic.
 */
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import zlib from 'zlib';

const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const BLOCKED = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]
].forEach(([a, p]) => BLOCKED.addSubnet(a, p, 'ipv4'));
[['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]
  .forEach(([a, p]) => BLOCKED.addSubnet(a, p, 'ipv6'));

export class BlockedHostError extends Error {}

export function isBlockedIp(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
  return BLOCKED.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

// resolves, rejects any non-public answer and hands the vetted address straight to the socket
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || !list.length) return cb(new BlockedHostError('blocked address'));
    if (options?.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

function assertUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new BlockedHostError('scheme');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!ALLOWED_PORTS.has(u.port) || /^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new BlockedHostError('host');
  if (net.isIP(host) && isBlockedIp(host)) throw new BlockedHostError('ip');
  return u;
}

function getOnce(u, { signal, maxBytes, binary, accept }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, {
      lookup: guardedLookup,
      signal,
      headers: { 'User-Agent': UA, Accept: accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' }
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ status, headers: res.headers, redirect: res.headers.location }); }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = []; let size = 0; let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const buf = Buffer.concat(chunks);
        resolve({ status, headers: res.headers, body: binary ? undefined : buf.toString('utf-8'), buffer: binary ? buf : undefined });
      };
      stream.on('data', (c) => { size += c.length; if (size > maxBytes) { finish(); req.destroy(); return; } chunks.push(c); });
      stream.on('end', finish);
      stream.on('error', (e) => (size ? finish() : reject(e)));
    });
    req.on('error', reject);
  });
}

async function runSafeFetch(url, { timeoutMs = 15000, maxBytes = 2 * 1024 * 1024, binary = false, accept } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = String(url);
    for (let hop = 0; ; hop++) {
      const res = await getOnce(assertUrl(current), { signal: controller.signal, maxBytes, binary, accept });
      if (!res.redirect) return { status: res.status, finalUrl: current, headers: res.headers, body: res.body, buffer: res.buffer };
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
      current = new URL(res.redirect, current).toString();
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetch(url, opts = {}) {
  return runSafeFetch(url, { ...opts, binary: false });
}

// Same SSRF guard, but keeps the raw bytes (for images etc. instead of decoding as utf-8 text).
export async function safeFetchBuffer(url, opts = {}) {
  return runSafeFetch(url, { ...opts, binary: true, accept: opts.accept || 'image/*,*/*;q=0.8', maxBytes: opts.maxBytes ?? 8 * 1024 * 1024 });
}
