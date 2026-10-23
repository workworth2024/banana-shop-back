/**
 * SSRF guard shared by every outbound connection the Site Analyzer makes on behalf of a user
 * (OWASP A01:2025 — SSRF, CWE-918): the page fetch, robots/sitemap/policy pages, the favicon and
 * the headless-Chrome egress proxy.
 *
 * The address is vetted inside the socket's own `lookup`, so the IP that is checked is the IP that
 * is connected to — no DNS-rebinding window between "check" and "connect".
 */
import dns from 'dns';
import net from 'net';

export const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

const BLOCKED = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]
].forEach(([a, p]) => BLOCKED.addSubnet(a, p, 'ipv4'));
// '::/96' = IPv4-compatible (::7f00:1), NAT64, 6to4, discard, ULA, link-local, multicast.
// (IPv4-mapped ::ffff:0:0/96 is NOT added here — node's BlockList would then match every IPv4
// address; mapped addresses are unwrapped to IPv4 in isBlockedIp instead.)
// 2001::/23 = IETF protocol assignments incl. Teredo 2001::/32 (embeds an IPv4) and ORCHID/benchmarking
[['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32]]
  .forEach(([a, p]) => BLOCKED.addSubnet(a, p, 'ipv6'));

export class BlockedHostError extends Error {}

// ::ffff:127.0.0.1 and its hex form ::ffff:7f00:1 (how `new URL` normalises it) → 127.0.0.1
function unwrapMapped(addr) {
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (dotted) return dotted[1];
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isBlockedIp(ip) {
  const addr = String(ip || '').replace(/^\[|\]$/g, '');
  const mapped = unwrapMapped(addr);
  if (mapped) return BLOCKED.check(mapped, 'ipv4');
  const family = net.isIP(addr);
  if (!family) return true;
  return BLOCKED.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

export const isBlockedHostname = (host) => /^localhost$|\.localhost$|\.local$|\.internal$|\.home\.arpa$/i.test(String(host || '').replace(/\.$/, ''));

/** Throws BlockedHostError for non-http(s) schemes, odd ports, internal names and literal private IPs. */
export function assertPublicUrl(url) {
  const u = url instanceof URL ? url : new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new BlockedHostError('scheme');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!ALLOWED_PORTS.has(u.port) || isBlockedHostname(host)) throw new BlockedHostError('host');
  if (net.isIP(host) && isBlockedIp(host)) throw new BlockedHostError('ip');
  return u;
}

/** Drop-in `lookup` for http/https/net: resolves, rejects any non-public answer, hands the vetted address to the socket. */
export function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  if (isBlockedHostname(hostname)) return cb(new BlockedHostError('host'));
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    if (!list.length || list.some((a) => isBlockedIp(a.address))) return cb(new BlockedHostError('ip'));
    if (options?.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}
