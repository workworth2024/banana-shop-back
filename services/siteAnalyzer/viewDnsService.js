/**
 * ViewDNS.info API — real reverse-IP neighbor lookup + WHOIS, replacing the
 * demo REVERSE_IP_DB / simulated whois block from scanner-engine.js.
 * Docs: https://viewdns.info/api/documentation/
 */
import dns from 'dns';

const VIEWDNS_BASE = 'https://api.viewdns.info';
const VIEWDNS_TIMEOUT_MS = 15000;

async function viewDnsGet(path, params) {
  const apiKey = process.env.VIEWDNS_API_KEY;
  if (!apiKey) throw new Error('VIEWDNS_API_KEY не настроен на сервере');

  const qs = new URLSearchParams({ ...params, apikey: apiKey, output: 'json' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIEWDNS_TIMEOUT_MS);
  try {
    const res = await fetch(`${VIEWDNS_BASE}${path}?${qs.toString()}`, { signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(`ViewDNS HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveIp(hostname) {
  try {
    const addresses = await dns.promises.resolve4(hostname);
    return addresses[0] || null;
  } catch {
    try {
      const addresses = await dns.promises.resolve6(hostname);
      return addresses[0] || null;
    } catch {
      return null;
    }
  }
}

function classifyNeighborRisk(domain) {
  const d = domain.toLowerCase();
  if (/casino|bet|poker|slot|gambl/.test(d)) return { category: 'gambling', risk: 'high' };
  if (/loan|credit|forex|crypto|invest/.test(d)) return { category: 'finance', risk: 'high' };
  if (/pharma|rx|pill|med(s)?\b/.test(d)) return { category: 'pharma', risk: 'high' };
  if (/adult|xxx|escort|dating|hookup/.test(d)) return { category: 'adult', risk: 'medium' };
  if (/diet|weight|detox|nutra/.test(d)) return { category: 'nutra', risk: 'medium' };
  return { category: 'other', risk: 'low' };
}

export async function reverseIpLookup(ip) {
  if (!ip) return { ip: null, totalDomains: 0, neighbors: [], riskAnalysis: null, source: 'unavailable' };
  try {
    const data = await viewDnsGet('/reverseip/', { host: ip });
    const domains = data?.response?.domains || [];
    const neighbors = domains.slice(0, 25).map(d => {
      const { category, risk } = classifyNeighborRisk(d.name);
      return { domain: d.name, lastResolved: d.last_resolved || null, category, risk };
    });
    const highRiskNeighbors = neighbors.filter(n => n.risk === 'high').length;
    const mediumRiskNeighbors = neighbors.filter(n => n.risk === 'medium').length;
    const lowRiskNeighbors = neighbors.length - highRiskNeighbors - mediumRiskNeighbors;

    return {
      ip,
      totalDomains: domains.length,
      neighbors,
      isShared: domains.length > 1,
      riskAnalysis: {
        highRiskNeighbors,
        mediumRiskNeighbors,
        lowRiskNeighbors,
        summary: domains.length > 1
          ? `На этом IP обнаружено ${domains.length} доменов, из них ${highRiskNeighbors} высокорисковых. Риск «плохих соседей» — если Google забанит соседний домен, ваш может попасть под перекрёстную проверку.`
          : 'Выделенный IP — соседей не обнаружено.'
      },
      source: 'viewdns'
    };
  } catch (e) {
    console.error('[ViewDNS] reverseIpLookup error:', e.message);
    return { ip, totalDomains: 0, neighbors: [], riskAnalysis: null, source: 'unavailable', error: e.message };
  }
}

export async function whoisLookup(domain) {
  try {
    const data = await viewDnsGet('/whois/v2/', { domain });
    const r = data?.response;
    if (!r) throw new Error('empty response');
    const created = r.registryData?.createdDate || r.createdDate || null;
    const domainAge = created ? Math.floor((Date.now() - new Date(created).getTime()) / 86400000) : null;
    return {
      registrar: r.registrarName || r.registryData?.registrarName || null,
      createdDate: created,
      expiresDate: r.registryData?.expiresDate || r.expiresDate || null,
      domainAge,
      registrant: r.registryData?.registrant?.organization || r.registrant?.organization || null,
      source: 'viewdns'
    };
  } catch (e) {
    console.error('[ViewDNS] whoisLookup error:', e.message);
    return { registrar: null, createdDate: null, expiresDate: null, domainAge: null, registrant: null, source: 'unavailable', error: e.message };
  }
}
