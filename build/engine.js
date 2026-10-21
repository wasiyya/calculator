// ===================================================================
// 2. THE CALCULATOR (Clause 5 and Schedule A of DOC01 v1.1.004.212).
//    Built in stages (DOC06 plan step (d), item 4). Each rule is tagged with
//    the DOC01 provision it applies, so it can be read against Schedule A.
//    calculate(family) receives
//      { deceased_sex: 'm'|'f',
//        persons: [{ id, sex, alive, father, mother }],   // 'X' is the deceased
//        spouses: [{ id, type: 'wife'|'husband' }] }
//    and returns { shares: { id: "n/d", ..., charity?: "n/d" }, steps: [{ rule, text }] }.
//    Stages built: Pre-Stage (i); Stage 1 (fixed shares, sole-heir closure); Stage 2 (residuary heirs); Stage 3 (awl); Stage 4 (radd); SA5.1(a), (b), (e), (g), (h) and SA4.2 (named rules and sole spouse); Stage 6 (SA6.1 fallback relatives); Stage 7 (SA7.1).
// ===================================================================
const DOC06Engine = (() => {
  const F = Frac;
  const fr = (n, d) => F.make(n, d);

  // -------- 2.1 Reading the family: who is who, relative to the deceased --------
  function readFamily(family) {
    const by = {}; for (const p of family.persons) by[p.id] = p;
    const X = by.X;
    const alive = id => !!(id && by[id] && by[id].alive && id !== 'X');
    const childrenOf = id => family.persons.filter(p => p.id !== 'X' && (p.father === id || p.mother === id));

    // Descendants (SA-GEN.3.1): children of the deceased, then only through sons.
    const desc = [];                       // { id, sex, level, alive }
    (function walk(id, level) {
      for (const c of childrenOf(id)) {
        desc.push({ id: c.id, sex: c.sex, level, alive: !!c.alive });
        if (c.sex === 'm') walk(c.id, level + 1);
      }
    })('X', 1);
    const liveDesc = desc.filter(d => d.alive);

    // Male ascendants through males (father, paternal grandfather, ...): SA-GEN.5.
    const maleAsc = []; for (let a = X.father, k = 1; a && by[a]; a = by[a].father, k++) maleAsc.push({ id: a, level: k });
    const father = alive(X.father) ? X.father : null;
    const gfEntry = father ? null : maleAsc.slice(1).find(a => alive(a.id)) || null;
    const grandfather = gfEntry ? gfEntry.id : null;     // the paternal grandfather, or the ascendant in his place

    const mother = alive(X.mother) ? X.mother : null;
    const pgm = X.father && by[X.father] && alive(by[X.father].mother) ? by[X.father].mother : null;
    const mgm = X.mother && by[X.mother] && alive(by[X.mother].mother) ? by[X.mother].mother : null;

    // Siblings: share at least one parent with the deceased (SA-PRE(d)).
    const sib = [];
    for (const p of family.persons) {
      if (!alive(p.id)) continue;
      const f = !!(X.father && p.father === X.father), m = !!(X.mother && p.mother === X.mother);
      if (f || m) sib.push({ id: p.id, sex: p.sex, kind: f && m ? 'full' : f ? 'paternal' : 'maternal' });
    }
    // Male-line agnates beyond the siblings (SA2.2.6, SA2.2.7). Walking up from a living male through fathers only,
    // the first person whose father is the deceased's father, grandfather, ... (and who is not on the deceased's own line)
    // fixes the relationship: j = 1 a brother of the deceased, j = 2 a paternal uncle, j = 3 a brother of the paternal grandfather, ...
    const chain = ['X'].concat(maleAsc.map(a => a.id));          // A0 = deceased, A1 = father, A2 = paternal grandfather, ...
    const agn = [];
    for (const p of family.persons) {
      if (!alive(p.id) || p.sex !== 'm' || chain.includes(p.id)) continue;
      for (let n = p.id, g = 0; n && by[n]; n = by[n].father, g++) {
        if (chain.includes(n)) break;
        const j = chain.indexOf(by[n].father);
        if (j >= 1) {
          if (!(j === 1 && g === 0)) {                              // a brother himself is a sibling, not an agnate here
            const ref = by[chain[j - 1]];
            agn.push({ id: p.id, j, gen: g, full: !!(ref.mother && by[n].mother === ref.mother) });
          }
          break;
        }
      }
    }
    return { by, X, alive, desc, liveDesc, maleAsc, father, grandfather, gfLevel: gfEntry ? gfEntry.level : 0,
             mother, pgm, mgm, sib, agn, spouses: family.spouses || [] };
  }

  // -------- 2.2 The calculation --------
  function calculate(family, opts) {
    opts = opts || {};
    const R = readFamily(family);
    const steps = [], step = (rule, text) => steps.push({ rule, text });
    const shares = {};                     // id -> Frac (fixed shares)
    const give = (id, f) => { shares[id] = shares[id] ? F.add(shares[id], f) : f; };
    const split = (ids, total) => ids.forEach(id => give(id, F.div(total, fr(ids.length, 1))));

    const descAlive = R.liveDesc.length > 0;
    const sons = R.liveDesc.filter(d => d.level === 1 && d.sex === 'm');
    const daughters = R.liveDesc.filter(d => d.level === 1 && d.sex === 'f');
    const maleLine = R.liveDesc.filter(d => d.sex === 'm');      // sons and male descendants through sons
    const femaleDesc = R.liveDesc.filter(d => d.sex === 'f');    // daughters and female descendants through sons
    const hasGF = !!R.grandfather;

    // ---- Pre-Stage (i): descendant-triggered sibling blocking (SA-PRE(i)) ----
    let siblings = R.sib.slice();
    if (descAlive && siblings.length) {
      const trigF = femaleDesc.length > 0 && !maleLine.length && !R.father && !hasGF;           // SA5.1(f).1 as amended for P-235 (DOC01 v1.1.004.212): daughters or female descendants through sons
      const trigE = !maleLine.length && !R.father && hasGF && siblings.some(s => s.kind !== 'maternal'); // SA5.1(e).1
      const keep = siblings.filter(s => s.kind !== 'maternal' && (trigF || trigE));
      if (siblings.length > keep.length)
        step('SA-PRE(i)', 'A descendant survives, so ' + (keep.length ? 'every maternal sibling is' : 'every sibling is') + ' removed from the heir set.');
      if (keep.length) step(trigF ? 'SA-PRE(i), SA5.1(f)' : 'SA-PRE(i), SA5.1(e)', 'Full and paternal siblings are kept: ' + (trigF ? 'the express override for daughters or female descendants through sons applies.' : 'the paternal grandfather and sibling competition rule applies.'));
      siblings = keep;
    }
    const removedPre = new Set(R.sib.filter(s => !siblings.includes(s)).map(s => s.id));
    const sibAllCount = R.sib.length;                               // SA1.2.3(d): counted whether or not they take
    const fullB = siblings.filter(s => s.kind === 'full' && s.sex === 'm');
    const fullZ = siblings.filter(s => s.kind === 'full' && s.sex === 'f');
    const patB = siblings.filter(s => s.kind === 'paternal' && s.sex === 'm');
    const patZ = siblings.filter(s => s.kind === 'paternal' && s.sex === 'f');
    const matS = siblings.filter(s => s.kind === 'maternal');

    // ---- Stage 1, opening check: SA5.1 trigger conditions (Stage 5) ----
    const anySpouse = R.spouses.length > 0, husbandAlive = R.spouses.some(s => s.type === 'husband');
    const onlySpouses = anySpouse && !family.persons.some(p => p.alive && p.id !== 'X' && linesOf(R.by, p.id).length);
    const trig = {
      a: anySpouse && R.mother && R.father && !descAlive && sibAllCount < 2,
      b: anySpouse && R.mother && R.father && !descAlive && sibAllCount >= 2,
      e: !maleLine.length && !R.father && hasGF && siblings.some(s => s.kind !== 'maternal'),
      g: husbandAlive && (R.mother || R.mgm || R.pgm) && !descAlive && !R.father && !hasGF
         && matS.length >= 2 && fullB.length > 0,
      h: onlySpouses,
    };
        if (trig.h) {                                                         // SA5.1(h), SA4.2: sole surviving spouse
      const ids = R.spouses.map(x => x.id), out = {};
      ids.forEach(id => out[id] = F.div(F.ONE, fr(ids.length, 1)));
      step('SA5.1(h), SA4.2', 'Only ' + (ids.length > 1 ? 'the wives survive and no fallback relative is entered: they take the fixed share and the whole remainder, divided equally.' : 'the spouse survives and no fallback relative is entered: the spouse takes the fixed share and the whole remainder.'));
      return finish(out, steps);
    }
    const spouseFixed = () => {                                           // SA1.2.1, SA1.2.2 for the named rules
      const out = {};
      const h = R.spouses.filter(x => x.type === 'husband'), w = R.spouses.filter(x => x.type === 'wife');
      if (h.length) out[h[0].id] = descAlive ? fr(1, 4) : fr(1, 2);
      w.forEach(x => out[x.id] = F.div(descAlive ? fr(1, 8) : fr(1, 4), fr(w.length, 1)));
      return out;
    };
    if (trig.a || trig.b) {                                               // SA5.1(a) Umariyyah; SA5.1(b)
      const out = spouseFixed(), sp = F.sum(Object.values(out));
      out[R.mother] = trig.a ? F.div(F.sub(F.ONE, sp), fr(3, 1)) : fr(1, 6);
      out[R.father] = F.sub(F.sub(F.ONE, sp), out[R.mother]);
      if (trig.a) step('SA5.1(a)', 'Spouse and both parents, no descendant, fewer than two siblings: the spouse takes the fixed share, the mother 1/3 of the remainder, the father the balance' + (sibAllCount ? '; the single sibling takes nothing.' : '.'));
      else step('SA5.1(b)', 'Spouse and both parents, no descendant, two or more siblings: the spouse takes the fixed share, the mother 1/6, the father the remainder; every sibling is excluded by the father.');
      return finish(out, steps);
    }
    if (trig.g) {                                                         // SA5.1(g) al-Himariyya
      const out = spouseFixed();
      if (R.mother) out[R.mother] = fr(1, 6);
      else { const gm = [R.mgm, R.pgm].filter(Boolean); gm.forEach(g => out[g] = F.div(fr(1, 6), fr(gm.length, 1))); }
      const pool = matS.concat(fullB, fullZ);
      pool.forEach(x => out[x.id] = F.div(fr(1, 3), fr(pool.length, 1)));
      step('SA5.1(g)', 'Husband, ' + (R.mother ? 'mother' : 'grandmother') + ', two or more maternal siblings and a full brother: the husband takes 1/2, the ' + (R.mother ? 'mother' : 'grandmother or grandmothers') + ' 1/6, and the maternal and full siblings share a pool of 1/3 equally per head' + (patB.length + patZ.length ? '; paternal siblings take nothing.' : '.'));
      return finish(out, steps);
    }

    // The heirs who are still in play after blocking; filled in below.
    const blocked = new Set(removedPre);
    const res = { a: [], b: [], c: [], d: [], e: [] };   // residuary heirs by SA2.1.1 category, in order of priority (SA2.1.2)
    const sexOf = id => R.by[id].sex;

    // ---- Stage 1: fixed shares ----
    // Spouse: SA1.2.1, SA1.2.2
    const husband = R.spouses.filter(s => s.type === 'husband');
    const wives = R.spouses.filter(s => s.type === 'wife');
    if (husband.length) { give(husband[0].id, descAlive ? fr(1, 4) : fr(1, 2)); step('SA1.2.1', 'Husband: ' + (descAlive ? '1/4, a descendant survives.' : '1/2, no descendant survives.')); }
    if (wives.length) { split(wives.map(w => w.id), descAlive ? fr(1, 8) : fr(1, 4)); step('SA1.2.2', (wives.length > 1 ? 'Wives together' : 'Wife') + ': ' + (descAlive ? '1/8, a descendant survives.' : '1/4, no descendant survives.') + (wives.length > 1 ? ' Divided equally.' : '')); }

    // Mother: SA1.2.3
    if (R.mother) {
      const sixth = descAlive || sibAllCount >= 2;
      give(R.mother, sixth ? fr(1, 6) : fr(1, 3));
      step('SA1.2.3', 'Mother: ' + (sixth ? '1/6, ' + (descAlive ? 'a descendant survives.' : 'two or more siblings survive (counted whether or not they take).') : '1/3, no descendant and fewer than two siblings.'));
    }

    // Father: SA1.2.4, SA2.2.2, SA2.2.3
    if (R.father) {
      if (descAlive) { give(R.father, fr(1, 6)); step('SA1.2.4(a)', 'Father: 1/6, a descendant survives.'); }
      if (!sons.length) res.b.push(R.father);
    }
    // Paternal grandfather (or the ascendant in his place): SA2.2.4, SA-GEN.5
    if (hasGF) {
      const who = R.gfLevel > 2 ? 'Nearest male ascendant in place of the paternal grandfather (SA-GEN.5)' : 'Paternal grandfather';
      if (!trig.e) {
        if (descAlive) { give(R.grandfather, fr(1, 6)); step('SA2.2.4.1', who + ': 1/6, the father is absent and a descendant survives.'); }
        if (!sons.length) res.c.push(R.grandfather);
      }
    }

    // Grandmothers: SA1.2.8
    if (R.pgm || R.mgm) {
      if (R.mother) { [R.pgm, R.mgm].filter(Boolean).forEach(g => blocked.add(g)); step('SA1.2.8(a)', 'The mother blocks both grandmothers.'); }
      else {
        const gm = [R.mgm, R.father ? null : R.pgm].filter(Boolean);
        if (R.father && R.pgm) { blocked.add(R.pgm); step('SA1.2.8(b)', 'The father blocks the paternal grandmother.'); }
        if (gm.length) { split(gm, fr(1, 6)); step('SA1.2.8', (gm.length > 1 ? 'Both grandmothers share' : 'The grandmother takes') + ' 1/6.'); }
      }
    }

    // Descendants: SA1.2.5, SA1.2.6, SA1.3, SA2.2.1
    if (sons.length) {
      R.liveDesc.filter(d => d.level > 1).forEach(d => blocked.add(d.id));
      R.liveDesc.filter(d => d.level === 1).forEach(d => res.a.push(d.id));
      step('SA2.2.1(a), (c); SA5.1(d)', 'A son survives: sons and daughters take the residue together, male two units and female one; more remote descendants are blocked.');
    } else if (R.liveDesc.length) {
      const levels = [...new Set(R.liveDesc.map(d => d.level))].sort((a, b) => a - b);
      const at = (l, sex) => R.liveDesc.filter(d => d.level === l && (!sex || d.sex === sex));
      const minMale = maleLine.length ? Math.min(...maleLine.map(d => d.level)) : Infinity;
      let half = null;                          // the level of a single female taking 1/2
      let fixedDone = false;                     // the 1/2 or 2/3 has been placed
      let completionLevel = null;
      const takers = new Set();
      if (daughters.length) {
        split(daughters.map(d => d.id), daughters.length > 1 ? fr(2, 3) : fr(1, 2));
        daughters.forEach(d => takers.add(d.id));
        step('SA1.2.5', daughters.length > 1 ? 'Daughters: 2/3 together, no son survives.' : 'Daughter: 1/2, no son survives.');
        fixedDone = true; if (daughters.length === 1) half = 1;
        if (daughters.length > 1) step('SA1.2.6(c)', 'Two or more daughters take the 2/3; no female descendant through sons takes a fixed or completion share.');
      } else {
        const l1 = levels.find(l => at(l, 'f').length);
        if (l1 !== undefined && minMale > l1) {          // SA1.2.6(a), conditions (d)(i) and (iii)
          const fs = at(l1, 'f');
          split(fs.map(d => d.id), fs.length > 1 ? fr(2, 3) : fr(1, 2)); fs.forEach(d => takers.add(d.id));
          step('SA1.2.6(a)', 'Female descendant' + (fs.length > 1 ? 's' : '') + ' through sons at the nearest level (' + l1 + '): ' + (fs.length > 1 ? '2/3 together.' : '1/2.'));
          fixedDone = true; if (fs.length === 1) half = l1;
        }
      }
      if (half !== null) {                                 // SA1.2.6(b), SA1.3: completion once, at the nearest level below with a female
        const l2 = levels.find(l => l > half && at(l, 'f').length);
        if (l2 !== undefined && minMale > l2) {
          const fs = at(l2, 'f');
          split(fs.map(d => d.id), fr(1, 6)); fs.forEach(d => takers.add(d.id)); completionLevel = l2;
          step('SA1.2.6(b), SA1.3', 'Female descendant' + (fs.length > 1 ? 's' : '') + ' through sons at level ' + l2 + ': 1/6 ' + (fs.length > 1 ? 'together ' : '') + 'to complete 2/3.');
        }
      }
      // Male descendants through sons at the nearest male level, with the females admitted with them (SA2.2.1(d), (e)).
      if (maleLine.length) {
        for (const d of R.liveDesc) {
          if (takers.has(d.id)) continue;
          if (d.level === minMale) res.a.push(d.id);
          else if (d.sex === 'f' && d.level < minMale) res.a.push(d.id);     // SA2.2.1(e)(ii): would otherwise take nothing
          else blocked.add(d.id);
        }
      } else for (const d of R.liveDesc) if (!takers.has(d.id)) blocked.add(d.id);
    }

    // Siblings.
    if (siblings.length) {
      if (R.father) {                                                   // SA2.2.5(b)(i), (c)
        siblings.forEach(s => blocked.add(s.id)); step('SA2.2.5(b), (c)', 'The father excludes every sibling.');
      } else if (hasGF) {                                               // SA2.2.5(c); full and paternal only under SA5.1(e)
        matS.forEach(s => blocked.add(s.id));
        if (matS.length) step('SA2.2.5(c)', 'The paternal grandfather excludes every maternal sibling.');
        // full and paternal siblings: SA5.1(e) below
      } else if (descAlive) {                                           // only kept under SA5.1(f)
        // Full siblings exclude paternal siblings (SA2.2.5(a)): only the admitted class takes.
        const cls = siblings.some(s => s.kind === 'full') ? 'full' : 'paternal';
        for (const s of siblings) if (s.kind === cls) res.d.push(s.id); else blocked.add(s.id);
        step('SA5.1(f).2', 'The ' + cls + ' sibling' + (siblings.filter(s => s.kind === cls).length > 1 ? 's are' : ' is') + ' admitted as residuary heir with the daughters or female descendants through sons.');
      } else {
        // Maternal siblings: SA1.2.7
        if (matS.length) { split(matS.map(s => s.id), matS.length > 1 ? fr(1, 3) : fr(1, 6)); step('SA1.2.7', 'Maternal sibling' + (matS.length > 1 ? 's: 1/3 together, divided equally.' : ': 1/6.')); }
        // Full siblings: SA2.2.5
        if (fullB.length) { fullB.concat(fullZ).forEach(s => res.d.push(s.id)); patB.concat(patZ).forEach(s => blocked.add(s.id));
          if (patB.length + patZ.length) step('SA2.2.5(a)(i)', 'A full brother blocks every paternal sibling.'); }
        else {
          if (fullZ.length) { split(fullZ.map(s => s.id), fullZ.length > 1 ? fr(2, 3) : fr(1, 2)); step('SA2.2.5(d)', fullZ.length > 1 ? 'Full sisters: 2/3 together.' : 'Full sister: 1/2.'); }
          if (patB.length) { patB.concat(patZ).forEach(s => res.d.push(s.id)); }
          else if (patZ.length) {
            if (!fullZ.length) { split(patZ.map(s => s.id), patZ.length > 1 ? fr(2, 3) : fr(1, 2)); step('SA2.2.5(d)', patZ.length > 1 ? 'Paternal sisters: 2/3 together.' : 'Paternal sister: 1/2.'); }
            else if (fullZ.length === 1) { split(patZ.map(s => s.id), fr(1, 6)); step('SA2.2.5(d)(v)', 'Paternal sister' + (patZ.length > 1 ? 's: 1/6 together' : ': 1/6') + ', completing 2/3 with the full sister.'); }
            else { patZ.forEach(s => blocked.add(s.id)); step('SA2.2.5(a)(ii)', 'Two or more full sisters taking 2/3 block the paternal sisters.'); }
          }
        }
      }
    }

    // SA5.1(e): paternal grandfather and sibling competition, after every other fixed share (SA5.1(e).3).
    if (trig.e) {
      const GF = R.grandfather, fp = siblings.filter(x => x.kind !== 'maternal');
      R.agn.forEach(x => blocked.add(x.id));
      const husbandId = (R.spouses.find(x => x.type === 'husband') || {}).id;
      const fpZ = fp.filter(x => x.sex === 'f');
      if (husbandId && R.mother && !descAlive && fp.length === 1 && fpZ.length === 1 && sibAllCount < 2) {   // SA5.1(e).8 al-Akdariyyah
        const out = { [husbandId]: fr(9, 27), [R.mother]: fr(6, 27), [GF]: fr(8, 27), [fpZ[0].id]: fr(4, 27) };
        step('SA5.1(e).8', 'Husband, mother, paternal grandfather and one sister (al-Akdariyyah): 1/2, 1/3, 1/6 and 1/2 are reduced to 3/9, 2/9, 1/9 and 3/9, and the grandfather\'s and sister\'s parts are pooled and shared two to one: 9/27, 6/27, 8/27, 4/27.');
        return finish(out, steps);
      }
      const fixedTot = F.sum(Object.values(shares));
      if (femaleDesc.length && F.cmp(F.add(fixedTot, fr(1, 6)), F.ONE) >= 0) {                      // SA5.1(e).7
        give(GF, fr(1, 6)); fp.forEach(x => blocked.add(x.id));
        const tot = F.add(fixedTot, fr(1, 6));
        if (F.eq(tot, F.ONE)) { step('SA5.1(e).7', 'The fixed shares with the grandfather\'s 1/6 equal the estate: the grandfather takes 1/6 and no sibling takes.'); return finish(shares, steps); }
        step('SA5.1(e).7, SA3.1', 'The fixed shares with the grandfather\'s 1/6 total ' + F.str(tot) + ': no sibling takes, and every fixed share is reduced by the same factor.');
        const out = {}; for (const id in shares) out[id] = F.div(shares[id], tot); return finish(out, steps);
      }
      const pool = F.sub(F.ONE, fixedTot);
      if (F.cmp(pool, fr(1, 6)) < 0) throw new Error('Not calculated: the residue is less than 1/6 with no female descendant; SA5.1(e) does not state this case.');
      const unit = x => x.sex === 'm' ? 2 : 1;
      const units = 2 + fp.reduce((t, x) => t + unit(x), 0);                     // SA5.1(e).4: every full and paternal sibling counted
      const opts = [['(i)', fr(1, 6)], ['(ii)', F.div(pool, fr(3, 1))], ['(iii)', F.mul(pool, fr(2, units))]];
      let best = opts[0]; for (const o of opts) if (F.cmp(o[1], best[1]) >= 0) best = o;   // ties: the last listed (SA5.1(e).2)
      give(GF, best[1]);
      step('SA5.1(e).2', 'Grandfather and siblings compete for the residue of ' + F.str(pool) + ': (i) 1/6 = ' + F.str(opts[0][1]) + ', (ii) 1/3 of the residue = ' + F.str(opts[1][1]) + ', (iii) sharing as a brother = ' + F.str(opts[2][1]) + '. Option ' + best[0] + ' is selected.');
      let portion = F.sub(pool, best[1]);
      const fullBs = fp.filter(x => x.kind === 'full' && x.sex === 'm'), fullZs = fp.filter(x => x.kind === 'full' && x.sex === 'f');
      const pats = fp.filter(x => x.kind === 'paternal');
      const agnatic = (list, amt) => { const u = list.reduce((t, x) => t + unit(x), 0); list.forEach(x => give(x.id, F.mul(amt, fr(unit(x), u)))); };
      if (F.isZero(portion)) { fp.forEach(x => blocked.add(x.id)); step('SA5.1(e).6', 'The grandfather\'s share exhausts the residue: no sibling takes.'); }
      else if (fullBs.length) { agnatic(fullBs.concat(fullZs), portion); pats.forEach(x => blocked.add(x.id)); step('SA5.1(e).5(A)', 'A full brother survives: the sibling portion of ' + F.str(portion) + ' passes to the full siblings, male two units and female one' + (pats.length ? '; paternal siblings take nothing.' : '.')); }
      else if (fullZs.length) {
        const cap = fullZs.length > 1 ? fr(2, 3) : fr(1, 2), take = F.cmp(portion, cap) <= 0 ? portion : cap;
        fullZs.forEach(x => give(x.id, F.div(take, fr(fullZs.length, 1))));
        const bal = F.sub(portion, take);
        if (!F.isZero(bal)) { if (!pats.length) throw new Error('Not calculated: a balance remains after the full sisters\' limit and no paternal sibling survives; SA5.1(e).5(B) does not state this case.'); agnatic(pats, bal); }
        else pats.forEach(x => blocked.add(x.id));
        step('SA5.1(e).5(B)', 'No full brother: the full sister' + (fullZs.length > 1 ? 's take' : ' takes') + ' the sibling portion up to ' + F.str(cap) + ' of the estate' + (pats.length ? (F.isZero(bal) ? '; nothing is left for the paternal siblings.' : '; the balance of ' + F.str(bal) + ' passes to the paternal siblings, male two units and female one.') : '.'));
      } else { agnatic(pats, portion); step('SA5.1(e).5(C)', 'No full sibling: the sibling portion of ' + F.str(portion) + ' passes to the paternal siblings, male two units and female one.'); }
      return finish(shares, steps);
    }

    // Higher male-line relatives (SA2.1.1(e)): only where no category (a) to (d) heir is admitted.
    if (!res.a.length && !res.b.length && !res.c.length && !res.d.length && R.agn.length) {
      const pick = (list, rule, what) => {
        const g = Math.min(...list.map(x => x.gen)), near = list.filter(x => x.gen === g);
        const best = near.some(x => x.full) ? near.filter(x => x.full) : near;
        list.filter(x => !best.includes(x)).forEach(x => blocked.add(x.id));
        best.forEach(x => res.e.push(x.id));
        step(rule, what + ': the nearest generation takes' + (near.length > best.length ? ', and those through a full brother exclude those through a paternal half-brother' : '') + '; they share the residue equally.');
      };
      const bs = R.agn.filter(x => x.j === 1);
      if (bs.length) { pick(bs, 'SA2.2.7(c)', 'Brothers\' sons'); R.agn.filter(x => x.j > 1).forEach(x => blocked.add(x.id)); if (R.agn.some(x => x.j > 1)) step('SA2.2.7(f)', 'Brothers\' sons exclude every paternal uncle and more remote male-line relative.'); }
      else {
        const lv = Math.min(...R.agn.map(x => x.j));
        pick(R.agn.filter(x => x.j === lv), 'SA2.2.6(g), (h)', lv === 2 ? 'Paternal uncles and their male-line descendants' : 'Male-line relatives at level ' + (lv - 1) + ' (brothers of the ' + (lv === 3 ? 'paternal grandfather' : 'paternal ascendant ' + (lv - 1) + ' generations up') + ')');
        R.agn.filter(x => x.j > lv).forEach(x => blocked.add(x.id));
      }
    } else R.agn.forEach(x => { if (!res.d.includes(x.id)) blocked.add(x.id); });

    // The residuary category that takes (SA2.1.2): the first listed with any member.
    const CAT = { a: 'SA2.1.1(a), descendants through sons', b: 'SA2.1.1(b), the father', c: 'SA2.1.1(c), the paternal grandfather', d: 'SA2.1.1(d), full or paternal siblings', e: 'SA2.1.1(e), higher male-line relatives' };
    const takeCat = ['a', 'b', 'c', 'd', 'e'].find(k => res[k].length) || null;
    const takers = takeCat ? res[takeCat] : [];

    // Relatives who are neither heirs nor blocked heirs: fallback relatives (Stage 6), not read yet.
    const known = new Set(Object.keys(shares).concat(...Object.values(res), [...blocked], R.spouses.map(s => s.id)));
    const others = family.persons.filter(p => p.alive && p.id !== 'X' && !known.has(p.id) && linesOf(R.by, p.id).length);   // SA6.1.2(b): blood relatives only

    // Stage 1(d), SA1.4: sole-heir closure.
    const eligible = [...new Set(Object.keys(shares).concat(takers))];
    if (eligible.length === 1 && !R.spouses.length) {
      step('Stage 1(d), SA1.4', 'Exactly one eligible heir remains and takes 100% of the Distributable Net Estate.');
      return finish({ [eligible[0]]: F.ONE }, steps);
    }
    const total = F.sum(Object.values(shares));
    if (F.eq(total, F.ONE)) { step('Stage 1, after (i)', 'The fixed shares total exactly 100%: the estate closes at Stage 1' + (takers.length ? '; no residue arises for the residuary heirs.' : '.')); return finish(shares, steps); }
    if (F.cmp(total, F.ONE) > 0) {                                       // Stage 3, SA3.1
      step('Stage 3, SA3.1', 'The fixed shares total ' + F.str(total) + ', more than 100%: every fixed share is reduced by the same factor.');
      const out = {}; for (const id in shares) out[id] = F.div(shares[id], total);
      return finish(out, steps);
    }
    const residue = F.sub(F.ONE, total);
    if (takers.length) {                                                  // Stage 2: the residue to the residuary heirs
      const equal = takeCat === 'e';                                      // SA2.2.6(h)(iii), SA2.2.7(c)(iii): equally per capita
      const units = id => equal ? 1 : (sexOf(id) === 'm' ? 2 : 1);       // otherwise male two units, female one
      const all = F.make(takers.reduce((t, id) => t + units(id), 0), 1);
      for (const id of takers) give(id, F.mul(residue, F.div(F.make(units(id), 1), all)));
      step('Stage 2, ' + CAT[takeCat].split(',')[0], 'The residue of ' + F.str(residue) + ' passes to ' + CAT[takeCat].split(', ')[1] + (takers.length > 1 ? (equal ? ', equally.' : ', male two units and female one.') : '.'));
      return finish(shares, steps);
    }
    // Stage 4, SA4.1: radd to the blood fixed-share heirs, in proportion to their fixed shares; spouses excluded (SA4.1.3).
    const spouseIds = new Set(R.spouses.map(x => x.id));
    const blood = Object.keys(shares).filter(id => !spouseIds.has(id) && !F.isZero(shares[id]));
    if (blood.length) {
      const base = F.sum(blood.map(id => shares[id]));
      for (const id of blood) give(id, F.mul(residue, F.div(shares[id], base)));
      step('Stage 4, SA4.1', 'No residuary heir: the residue of ' + F.str(residue) + ' returns to the blood fixed-share heirs in proportion to their fixed shares' + (spouseIds.size ? '; the spouse does not take part (SA4.1.3).' : '.'));
      return finish(shares, steps);
    }
    // Stage 6, SA6.1: fallback relatives. SA6.1.1.1 (no heir at all) or SA6.1.1.2 (a spouse only: the spouse keeps the fixed share in full).
    if (others.length) {
      const amount = residue;                                              // the whole estate, or the remainder after the spouse (SA6.1.5(d))
      if (Object.keys(shares).length) step('SA6.1.1.2, SA6.1.5(d)', 'Only a spouse takes a fixed share and fallback relatives are entered: the spouse keeps the fixed share in full, and the remainder of ' + F.str(amount) + ' passes under SA6.1 as if no spouse survived.');
      else step('SA6.1.1.1', 'No heir takes under the fixed share or residuary rules: the whole estate passes to the fallback relatives under SA6.1.');
      const got = fallback(family, R, others.map(p => p.id), amount, step, opts);
      for (const id in got) give(id, got[id]);
      return finish(shares, steps);
    }
    // Stage 7, SA7.1: no heir and no fallback relative.
    step('Stage 7, SA7.1', 'No heir and no fallback relative: the whole estate passes to the charities in the Charitable Disposition Register (SA7.2), equally among the eligible entries.');
    return finish({ charity: F.ONE }, steps);
  }
  // -------- 2.3 Fallback relatives (SA6.1.3 to SA6.1.7) --------
  // A line is one route by which a fallback relative is related to the deceased (SA6.1.7):
  //   D: through a child of the deceased, down;  A: the person is an ascendant;
  //   C: through a brother or sister (m) of the deceased or of an ascendant (c), then down to the person.
  function linesOf(by, r) {
    const anc = new Map();
    (function up(path) { if (path.length > 10) return; const n = by[path[path.length - 1]];
      for (const par of [n.father, n.mother]) if (par && by[par]) { const q = path.concat(par); if (!anc.has(par)) anc.set(par, []); anc.get(par).push(q); up(q); } })(['X']);
    const out = [], seen = new Set();
    (function dfs(path) {
      const n = path[path.length - 1];
      if (n === 'X') { out.push({ type: 'D', nodes: path.slice(0, -1).reverse() }); return; }
      if (anc.has(n)) {
        if (path.length === 1) { for (const upp of anc.get(n)) out.push({ type: 'A', up: upp }); return; }
        const m = path[path.length - 2], down = path.slice(0, -1).reverse();
        for (const upp of anc.get(n)) {
          const c = upp[upp.length - 2], key = c + '|' + down.join(',');
          if (seen.has(key)) continue; seen.add(key);
          const f = !!(by[m].father && by[m].father === by[c].father), mo = !!(by[m].mother && by[m].mother === by[c].mother);
          out.push({ type: 'C', up: upp.slice(0, -1), kind: f && mo ? 'full' : f ? 'paternal' : 'maternal', down });
        }
        return;
      }
      if (path.length > 12) return;
      for (const par of [by[n].father, by[n].mother]) if (par && by[par] && !path.includes(par)) dfs(path.concat(par));
    })([r]);
    return out;
  }
  // Placement (SA6.1.3(d)) of one line: the chain from the fallback relative up to the heir, the steps and the side (SA6.1.4).
  function place(by, line) {
    const male = id => by[id].sex === 'm';
    const ascHeir = (up, i) => i === 1 || up.slice(1, i + 1).every((a, j) => by[up[j]].father === a)
      || (i === 2 && by[up[1]].mother === up[2]);                       // father, mother, male-line ascendants, the two grandmothers
    if (line.type === 'D') {
      const nd = line.nodes; let k = 0; while (k < nd.length - 1 && male(nd[k])) k++;
      return { chain: nd.slice(k).reverse(), steps: nd.length - 1 - k, side: 'descendants', matSib: false };
    }
    const sideOf = up => by.X.father && up[1] === by.X.father ? 'father' : 'mother';
    if (line.type === 'A') {
      const up = line.up; let i = up.length - 1; const chain = [up[i]];
      while (!ascHeir(up, i)) { i--; chain.push(up[i]); }
      return { chain, steps: chain.length - 1, side: sideOf(up), matSib: false };
    }
    const { up, kind, down } = line, cIsX = up.length === 1, m = down[0];
    const upMale = up.slice(1).every((a, j) => by[up[j]].father === a);
    const mHeir = cIsX || (upMale && male(m) && kind !== 'maternal');
    const downHeir = j => mHeir && (cIsX ? male(m) && kind !== 'maternal' : true) && down.slice(1, j + 1).every(male);
    let j = down.length - 1; const chain = [down[j]];
    while (j > 0 && !downHeir(j)) { j--; chain.push(down[j]); }
    if (j === 0 && !mHeir) {
      let i = up.length - 1; chain.push(up[i]);
      while (!ascHeir(up, i)) { i--; chain.push(up[i]); }
    }
    return { chain, steps: chain.length - 1, side: cIsX ? (kind === 'maternal' ? 'mother' : 'father') : sideOf(up), matSib: cIsX && kind === 'maternal' && chain[chain.length - 1] === m };
  }
  // Run the rules for a person treated as the deceased, with only the given persons surviving (SA6.1.5(b), SA6.1.6(a)).
  function runAs(family, root, aliveIds) {
    const map = id => id === root ? 'X' : id === 'X' ? '_X0' : id, back = id => id === '_X0' ? 'X' : id;
    const persons = family.persons.map(p => ({ id: map(p.id), sex: p.sex, alive: aliveIds.has(p.id), father: p.father ? map(p.father) : null, mother: p.mother ? map(p.mother) : null }));
    persons.find(p => p.id === 'X').alive = false;
    const res = calculate({ deceased_sex: family.persons.find(p => p.id === root).sex, persons, spouses: [] });
    const out = {}; for (const id in res.shares) out[back(id)] = F.parse(res.shares[id]); return out;
  }
  function fallback(family, R, ids, amount, step, opts) {
    const by = R.by, name = id => (opts.label ? opts.label(id) : id);
    // every line of every fallback relative, placed
    let lines = [];
    for (const r of ids) for (const ln of linesOf(by, r)) lines.push(Object.assign({ r }, place(by, ln)));
    // SA6.1.4(d): within one side, the fewest steps exclude the rest
    const minBy = {}; for (const l of lines) minBy[l.side] = Math.min(minBy[l.side] ?? Infinity, l.steps);
    const out = lines.filter(l => l.steps > minBy[l.side]);
    lines = lines.filter(l => l.steps === minBy[l.side]);
    for (const side of Object.keys(minBy)) step('SA6.1.3, SA6.1.4', 'On the ' + side + (side === 'descendants' ? '\' side' : '\'s side') + ', the fallback relatives ' + (minBy[side] === 1 ? 'one step' : minBy[side] + ' steps') + ' from an heir take' + (out.some(l => l.side === side) ? ' and exclude the more remote ones.' : '.'));
    // SA6.1.5: divide among the linking heirs as if they alone survived
    const linking = new Set(lines.map(l => l.chain[l.chain.length - 1]));
    const div = runAs(family, 'X', linking);
    step('SA6.1.5', 'The ' + F.str(amount) + ' is divided among the linking heirs (' + [...linking].map(name).join('; ') + ') as if they alone survived.');
    const got = {};
    const add = (id, f) => { got[id] = got[id] ? F.add(got[id], f) : f; };
    // SA6.1.6: pass each linking heir's share down its lines
    function pass(holder, amt, ls, matSib) {
      const done = ls.filter(l => l.pos === 0), go = ls.filter(l => l.pos > 0);
      if (done.length && go.length) throw new Error('Not calculated: a fallback relative is also the link for another; SA6.1.6 does not state this case.');
      if (done.length) { add(holder, amt); return; }
      const next = [...new Set(go.map(l => l.chain[l.pos - 1]))];
      const isChild = id => by[id].father === holder || by[id].mother === holder;
      let part = {};
      if (next.every(isChild)) {                                          // SA6.1.6(b), (c), (d)
        const w = id => matSib ? 1 : (by[id].sex === 'm' ? 2 : 1), tot = next.reduce((t, id) => t + w(id), 0);
        next.forEach(id => part[id] = F.mul(amt, fr(w(id), tot)));
      } else if (!next.some(isChild)) {                                   // SA6.1.6(a): the holder treated as the deceased
        const sh = runAs(family, holder, new Set(next));
        next.forEach(id => part[id] = F.mul(amt, sh[id] || F.ZERO));
      } else throw new Error('Not calculated: an heir\'s share passes both to children and to brothers, sisters or parents; SA6.1.6 does not state this case.');
      for (const id of next) if (!F.isZero(part[id])) pass(id, part[id], go.filter(l => l.chain[l.pos - 1] === id).map(l => Object.assign({}, l, { pos: l.pos - 1 })), matSib);
    }
    for (const h of linking) {
      const sh = div[h] ? F.mul(amount, div[h]) : F.ZERO;
      if (F.isZero(sh)) continue;
      const ls = lines.filter(l => l.chain[l.chain.length - 1] === h).map(l => Object.assign({}, l, { pos: l.chain.length - 1 }));
      pass(h, sh, ls, ls.every(l => l.matSib));
    }
    if (ids.some(r => lines.filter(l => l.r === r).length > 1 || linesOf(by, r).length > 1)) step('SA6.1.7', 'A fallback relative related through two or more lines takes through each line separately.');
    step('SA6.1.6', 'Each linking heir\'s share passes to the fallback relatives in that heir\'s position.');
    return got;
  }
  function finish(shares, steps) {
    const out = {}; for (const id in shares) if (!F.isZero(shares[id])) out[id] = F.str(shares[id]);
    return { shares: out, steps };
  }
  return { built: true, calculate };
})();
