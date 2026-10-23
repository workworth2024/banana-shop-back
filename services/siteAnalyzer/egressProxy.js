/**
 * Loopback-only forward proxy that headless Chrome is forced through (renderer.js).
 *
 * Chrome executes the scanned page's JavaScript, so it can be told to navigate/fetch anywhere —
 * `location = 'http://169.254.169.254/'`, a DNS-rebinding hostname that flips to 127.0.0.1, an
 * <iframe> to an internal admin panel — and `--dump-dom` would hand that content back to the user.
 * Every connection Chrome makes (HTTP, HTTPS via CONNECT, WebSocket) goes through here and is
 * resolved with netGuard's guardedLookup: private / loopback / metadata addresses and non-web
 * ports are refused at the socket level.
 */
import http from 'http';
import net from 'net';
import { ALLOWED_PORTS, assertPublicUrl, guardedLookup, isBlockedHostname, isBlockedIp } from './netGuard.js';

const IDLE_TIMEOUT_MS = 30000;
let ready = null;

function refuse(socket, code = 403) {
  try { socket.end(`HTTP/1.1 ${code} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* closed */ }
}

function targetAllowed(host, port) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (!h || isBlockedHostname(h) || !ALLOWED_PORTS.has(String(port))) return false;
  return !(net.isIP(h) && isBlockedIp(h));
}

function createProxy() {
  const server = http.createServer((req, res) => {
    let u;
    try { u = assertPublicUrl(new URL(req.url)); } catch { res.writeHead(403).end(); return; }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = http.request({
      host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || 80, path: `${u.pathname}${u.search}`, method: req.method,
      headers, lookup: guardedLookup, agent: false, timeout: IDLE_TIMEOUT_MS
    }, (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });

  server.on('connect', (req, client, head) => {
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || '');
    if (!m || !targetAllowed(m[1], m[2])) return refuse(client);
    const upstream = net.connect({ host: m[1], port: Number(m[2]), lookup: guardedLookup });
    upstream.setTimeout(IDLE_TIMEOUT_MS, () => upstream.destroy());
    client.setTimeout(IDLE_TIMEOUT_MS, () => client.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => refuse(client, 502));
    client.on('error', () => upstream.destroy());
  });
  server.on('clientError', (err, socket) => socket.destroy());
  return server;
}

// Fixed port so the host firewall can jail the Chrome user to "this proxy only" (see CLAUDE.md).
const PORT = Number(process.env.ANALYZER_EGRESS_PORT || 18321);

/** Starts the proxy once (127.0.0.1:ANALYZER_EGRESS_PORT) and resolves to `http://127.0.0.1:<port>`. */
export function getEgressProxy() {
  ready ||= new Promise((resolve, reject) => {
    const server = createProxy();
    server.once('error', (e) => { ready = null; reject(e); });
    server.listen(PORT, '127.0.0.1', () => {
      server.unref();
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
  return ready;
}
