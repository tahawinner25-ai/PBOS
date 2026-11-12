#!/usr/bin/env node
// Simple load test for simultaneous visitors. No dependencies. Usage:
//   node scripts/load-test.mjs https://your-domain [concurrency=25] [seconds=20]
// It only requests PUBLIC pages (/, /api/health, /privacy) and reports requests, errors, and latency percentiles.
// Be gentle: this is your own site on a free plan. Do not point it at anyone else's.
const base = (process.argv[2] || '').replace(/\/$/, '');
const concurrency = Math.min(Number(process.argv[3] || 25), 100);
const seconds = Math.min(Number(process.argv[4] || 20), 120);
if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/load-test.mjs https://your-domain [concurrency] [seconds]'); process.exit(2); }
const paths = ['/', '/api/health', '/privacy'];
const lat = []; const codes = {}; let errors = 0;
const stopAt = Date.now() + seconds * 1000;
async function worker(i) {
  let n = i;
  while (Date.now() < stopAt) {
    const t = performance.now();
    try {
      const res = await fetch(base + paths[n++ % paths.length], { signal: AbortSignal.timeout(15000) });
      await res.arrayBuffer();
      codes[res.status] = (codes[res.status] || 0) + 1;
    } catch { errors++; }
    lat.push(performance.now() - t);
  }
}
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
lat.sort((a, b) => a - b);
const p = (q) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] || 0);
console.log(JSON.stringify({ concurrency, seconds, requests: lat.length, perSecond: Math.round(lat.length / seconds), statusCodes: codes, networkErrors: errors, ms: { p50: p(0.5), p95: p(0.95), p99: p(0.99), max: p(1) } }, null, 2));
const bad = Object.entries(codes).filter(([c]) => Number(c) >= 500).reduce((n, [, v]) => n + v, 0);
process.exit(bad + errors > lat.length * 0.01 ? 1 : 0);
