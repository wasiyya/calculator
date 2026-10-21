const fs = require('fs');
const Frac = (() => {
  const abs = x => x < 0n ? -x : x;
  const gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; };
  function make(n, d) { n = BigInt(n); d = BigInt(d); if (d === 0n) throw new Error('zero denominator'); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
  function parse(v) { if (v && typeof v === 'object' && 'n' in v) return make(v.n, v.d); const m = String(v).trim().match(/^(-?\d+)(?:\s*\/\s*(\d+))?$/); if (!m) throw new Error('not a fraction: "' + v + '"'); return make(m[1], m[2] || 1); }
  const eq = (a, b) => a.n === b.n && a.d === b.d; const str = f => f.d === 1n ? String(f.n) : f.n + '/' + f.d;
  const add = (a, b) => make(a.n * b.d + b.n * a.d, a.d * b.d); const sub = (a, b) => make(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => make(a.n * b.n, a.d * b.d); const div = (a, b) => { if (b.n === 0n) throw new Error('division by zero'); return make(a.n * b.d, a.d * b.n); };
  const cmp = (a, b) => { const x = a.n * b.d, y = b.n * a.d; return x < y ? -1 : x > y ? 1 : 0; };
  const sum = list => list.reduce(add, make(0, 1)); const isZero = a => a.n === 0n;
  return { make, parse, eq, str, add, sub, mul, div, cmp, sum, isZero, pct: () => '', ZERO: make(0, 1), ONE: make(1, 1) };
})();
eval(fs.readFileSync('engine.js', 'utf8') + '\nglobalThis.E = DOC06Engine;');
const D = JSON.parse(fs.readFileSync('tests.json', 'utf8'));
const want = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sec = {}, fails = [], testOk = new Map();
for (const t of D.tests) for (const v of t.variants) {
  let ok = true, msg = '', got = null;
  try { got = E.calculate(JSON.parse(JSON.stringify({ deceased_sex: v.deceased_sex, persons: v.persons, spouses: v.spouses }))).shares; } catch (e) { ok = false; msg = e.message; }
  if (got) { let tot = Frac.ZERO; const keys = new Set([...Object.keys(v.expect), ...Object.keys(got)]);
    for (const k of keys) { const e = k in v.expect ? Frac.parse(v.expect[k]) : Frac.ZERO, c = k in got ? Frac.parse(got[k]) : Frac.ZERO; tot = Frac.add(tot, c); if (!Frac.eq(e, c)) { ok = false; msg += `${k}(${v.heir_text[k] || '?'}) exp ${Frac.str(e)} got ${Frac.str(c)}; `; } }
    if (!Frac.eq(tot, Frac.ONE)) { ok = false; msg += 'total ' + Frac.str(tot); } }
  const s = t.section.slice(0, 12); sec[s] = sec[s] || [0, 0]; sec[s][1]++; if (ok) sec[s][0]++;
  testOk.set(t.id, (testOk.get(t.id) ?? true) && ok);
  if (!ok) fails.push(t.id + ' [' + v.name + '] ' + msg);
}
for (const s in sec) console.log(s.padEnd(13), sec[s][0] + '/' + sec[s][1]);
const tp = [...testOk.values()].filter(Boolean).length;
console.log('TESTS', tp, '/', testOk.size, ' RUNS', Object.values(sec).reduce((a, b) => a + b[0], 0), '/', Object.values(sec).reduce((a, b) => a + b[1], 0));
const shown = fails.filter(f => !want || want.test(f));
const wrong = shown.filter(f => !/stage not built/.test(f));
console.log('\nWRONG (not "stage not built"):', wrong.length); wrong.forEach(f => console.log(' ', f));
if (process.argv[3] === 'all') shown.forEach(f => console.log(' ', f));
