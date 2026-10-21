# Convert MODULE_TESTS_3.128 into DOC06 family-tree test data.
# Output: tests.json (data) and conversion_report.txt (for checking by hand).
import re, json, itertools
from fractions import Fraction

RAW = json.load(open('raw_tests.json', encoding='utf-8'))
SRC, SRC_LINES, SRC_TESTS = open('source.txt').read().split('|')

# ---------------------------------------------------------------- tree
class Tree:
    def __init__(self, sex):
        self.n = {'X': dict(id='X', sex=sex, alive=False, father=None, mother=None)}
        self.key = {'X': 'X'}          # key -> id
        self.c = 0
    def new(self, sex, key=None, **kw):
        self.c += 1; i = 'p%d' % self.c
        d = dict(id=i, sex=sex, alive=False, father=None, mother=None); d.update(kw); self.n[i] = d
        if key: self.key[key] = i
        return i
    def get(self, key):
        """Resolve a key such as X/F/B:full to a node, creating link nodes."""
        if key in self.key: return self.key[key]
        parent, seg = key.rsplit('/', 1)
        base = re.sub(r'[#@].*$', '', seg)
        p = self.get(parent)
        if base in ('F', 'M'):
            i = self.new('m' if base == 'F' else 'f', key)
            self.n[p]['father' if base == 'F' else 'mother'] = i
            return i
        if base in ('S', 'D'):
            i = self.new('m' if base == 'S' else 'f', key)
            self.n[i]['father' if self.n[p]['sex'] == 'm' else 'mother'] = p
            return i
        m = re.match(r'([BZ]):(full|pat|mat)$', base)
        if m:
            sex = 'm' if m.group(1) == 'B' else 'f'; t = m.group(2)
            f = self.get(parent + '/F') if t in ('full', 'pat') else None
            mo = self.get(parent + '/M') if t in ('full', 'mat') else None
            return self.new(sex, key, father=f, mother=mo)
        raise ValueError('bad key ' + key)

# ---------------------------------------------------------------- relationship labels (same logic as the mock-up)
def kid(s): return 'son' if s == 'm' else 'daughter'
def paths_up(T, p, target, d=0):
    if p == target: return [[]]
    if d > 9: return []
    out = []
    for par in (T.n[p]['father'], T.n[p]['mother']):
        if par: out += [x + [p] for x in paths_up(T, par, target, d + 1)]
    return out
def ancestors(T):
    out = [('X', [])]; q = [('X', [])]
    while q:
        a, up = q.pop(0)
        if len(up) >= 4: continue
        for w in ('father', 'mother'):
            par = T.n[a][w]
            if par: out.append((par, up + [w])); q.append((par, up + [w]))
    return out
ALIAS = [("father's father's father", 'paternal great-grandfather'), ("father's father", 'paternal grandfather'),
         ("father's mother", 'paternal grandmother'), ("mother's father", 'maternal grandfather'), ("mother's mother", 'maternal grandmother')]
def alias(s):
    for a, b in ALIAS:
        if s.startswith(a): return b + s[len(a):]
    return s
def labels(T, p):
    out = []
    for path in paths_up(T, p, 'X'): out.append("'s ".join(kid(T.n[i]['sex']) for i in path))
    for node, up in ancestors(T):
        pre = "'s ".join(up)
        if node == p and up: out.append(pre); continue
        Ln = T.n[node]
        for c, cn in T.n.items():
            if c == node: continue
            f = Ln['father'] and cn['father'] == Ln['father']
            m = Ln['mother'] and cn['mother'] == Ln['mother']
            if not (f or m): continue
            word = ('full' if f and m else 'paternal' if f else 'maternal') + ' ' + ('brother' if cn['sex'] == 'm' else 'sister')
            for path in paths_up(T, p, c):
                out.append("'s ".join([pre + "'s " + word if pre else word] + [kid(T.n[i]['sex']) for i in path]))
    seen = []
    for s in out:
        s = alias(s)
        if s not in seen: seen.append(s)
    return seen

# ---------------------------------------------------------------- parsing heir terms
BASE = {
 'son': 'S', 'daughter': 'D', 'father': 'F', 'mother': 'M',
 'paternal grandfather': 'F/F', 'paternal grandmother': 'F/M', 'maternal grandfather': 'M/F', 'maternal grandmother': 'M/M',
 'paternal great-grandfather': 'F/F/F', "mother's father's mother": 'M/F/M',
 'full brother': 'B:full', 'full sister': 'Z:full', 'paternal brother': 'B:pat', 'paternal sister': 'Z:pat',
 'maternal brother': 'B:mat', 'maternal sister': 'Z:mat', 'maternal half-brother': 'B:mat', 'maternal half-sister': 'Z:mat',
 'paternal half-brother': 'B:pat', 'maternal sibling': '?:mat',
 'full paternal uncle': 'F/B:full', 'half paternal uncle': 'F/B:pat', "father's maternal half-brother": 'F/B:mat',
 'full brother of paternal grandfather': 'F/F/B:full', 'full brother of paternal great-grandfather': 'F/F/F/B:full',
 'paternal half-brother of paternal great-grandfather': 'F/F/F/B:pat',
 # defaults where MODULE_TESTS does not say full or half (flagged in the report)
 'paternal uncle': 'F/B:full', 'paternal aunt': 'F/Z:full', 'maternal uncle': 'M/B:full', 'maternal aunt': 'M/Z:full',
 'paternal cousin': 'F/B:full/S',
}
DEFAULTED = {'paternal uncle', 'paternal aunt', 'maternal uncle', 'maternal aunt', 'paternal cousin'}
SPEC = {  # parentheticals that fix which kind of aunt or uncle
 'paternal half-brother of father': 'F/B:pat', 'full sister of the father': 'F/Z:full', 'paternal half-sister of the father': 'F/Z:pat',
 'full sister of the mother': 'M/Z:full', 'maternal half-sister of the mother': 'M/Z:mat', 'paternal half-sister of the mother': 'M/Z:pat',
}
PAIR_SPEC = {  # parenthetical on the second of a pair, applying to both
 'full brother and full sister of the mother': 'full', 'full sister and full brother of the mother': 'full',
 'maternal half-brother and maternal half-sister of the mother': 'mat',
}
CONTEXT = [r' absent$', r'full (sister|brother) of the (father|mother)', r'full paternal uncle$', r'^(son|daughter) of that ', r'maternal half-brother of the father$', r'^no ', r'^father absent', r'^daughter predeceased$', r'^son of that daughter$', r'^children of one ', r'^both descended from one daughter$',
           r'^one aunt on each side$', r'^the two maternal half-sister', r'^estate to the charities']
EXCLUDED = [r'excluded under section 1\.2\.5', r'did not profess the islamic faith']
NONASSERT = [r'does not assert a claim', r'no claim asserted']

def norm(s): return s.replace('’', "'").strip()

def parse_term(raw):
    """Return dict: rel (lower-case relationship), n (ordinal or None), parens [..]."""
    s = norm(raw)
    parens, depth, buf, outside = [], 0, '', ''
    for ch in s:
        if ch == '(':
            if depth: buf += ch
            depth += 1; continue
        if ch == ')':
            depth -= 1
            if depth: buf += ch
            else: parens.append(buf); buf = ''
            continue
        if depth: buf += ch
        else: outside += ch
    s = re.sub(r'\s+', ' ', outside).strip()
    extra = None
    m = re.match(r"(.*?) who is also an? (.*)$", s)
    if m: s, extra = m.group(1), m.group(2)
    s = re.sub(r'^(One|Only) ', '', s); s = re.sub(r' (only|Only|Survives)$', '', s)
    m = re.match(r'^Son of (?:the )?(.*)$', s)
    if m:
        inner = m.group(1).replace('Paternal Half Uncle', 'Half Paternal Uncle').replace('of the Paternal', 'of Paternal')
        s = inner + "'s Son"
    n = None
    m = re.match(r'^(.*?) ([0-9]+|[AB])$', s)
    if m: s, n = m.group(1), m.group(2)
    parens = [q.strip() for p in parens for q in (p.split('; ') if not re.search(r'does not assert|no claim asserted|did not profess|excluded under', p) or 'full sister of the mother' in p else [p])]
    return dict(raw=raw, rel=s.lower(), n=n, parens=parens, extra=extra)

def term_key(t, flags):
    parts = t['rel'].split("'s ")
    # longest prefix that is a base relationship
    for k in range(len(parts), 0, -1):
        head = "'s ".join(parts[:k])
        if head in BASE: break
    else: raise ValueError('unknown relationship: ' + t['raw'])
    key = BASE[head]
    if head in DEFAULTED and not QUAL.get(head) and not t.get('pair') and not any(p in SPEC or p in PAIR_SPEC or p.startswith('paternal half-sister of the father and also') for p in t['parens']):
        flags.append('default: "%s" taken as %s' % (head, {'F/B:full': "the father's full brother", 'F/Z:full': "the father's full sister",
                     'M/B:full': "the mother's full brother", 'M/Z:full': "the mother's full sister", 'F/B:full/S': "the son of the father's full brother"}[key]))
    for p in t['parens']:
        if p in SPEC: key = SPEC[p]
    for step in parts[k:]:
        key += '/' + {'son': 'S', 'daughter': 'D'}[step]
    return 'X/' + key

def classify(p):
    pl = p.lower()
    if any(re.search(r, pl) for r in EXCLUDED): return 'excluded'
    if any(re.search(r, pl) for r in NONASSERT): return 'nonassert'
    if pl in SPEC or pl in PAIR_SPEC: return 'spec'
    if pl == 'any type': return 'any'
    if re.match(r'^child of son [ab]$', pl): return 'tag'
    if pl in ('descended from two different daughters', 'each the daughter of a different sister'): return 'distinct'
    if pl.startswith('also '): return 'also'
    if pl.startswith('paternal half-sister of the father and also'): return 'special'
    if any(re.search(r, pl) for r in CONTEXT): return 'context'
    raise ValueError('unclassified parenthetical: ' + p)

# ---------------------------------------------------------------- building one variant
QUAL = {}
QUALRX = {'maternal aunt': r'full sister of the mother', 'paternal aunt': r'full sister of the father',
          'maternal uncle': r'full brother (and full sister )?of the mother', 'paternal cousin': r'son of a full paternal uncle'}
def build(test, terms, outcome):
    flags = []
    QUAL.clear()
    for h, rx in QUALRX.items(): QUAL[h] = bool(re.search(rx, test['heirs']))
    deceased = 'f' if any(norm(x).lower().startswith(('husband', 'only husband')) for x in terms) else 'm'
    T = Tree(deceased)
    spouses, expect, held, not_entered, heir_rows = [], {}, [], [], []
    oi = 0
    parsed = [parse_term(x) for x in terms]
    # pair parentheticals apply to the previous term as well
    for i, t in enumerate(parsed):
        for p in t['parens']:
            if p in PAIR_SPEC and i > 0:
                parsed[i - 1]['pair'] = PAIR_SPEC[p]; t['pair'] = PAIR_SPEC[p]
    test_distinct = any(classify(p) == 'distinct' for u in parsed for p in u['parens'])
    dcount = [0]
    for t in parsed:
        kinds = [classify(p) for p in t['parens']]
        val = outcome[oi]; oi += 1
        rel = t['rel']
        if rel.startswith('no heir and no dhawu'):
            expect['charity'] = val; oi = len(outcome); continue
        if rel in ('wife', 'husband', 'two wives'):
            cnt = 2 if rel == 'two wives' else 1
            for j in range(cnt):
                sid = 'W%d' % (len(spouses) + 1) if rel != 'husband' else 'H'
                spouses.append(dict(id=sid, type='husband' if rel == 'husband' else 'wife'))
                if j: val = outcome[oi]; oi += 1
                expect[sid] = val
                heir_rows.append((sid, t['raw'], ['Husband' if rel == 'husband' else 'Wife'], val))
            continue
        key = term_key(t, flags)
        if t.get('pair'):
            key = re.sub(r':(full|pat|mat)$', ':' + t['pair'], key)
        if 'special' in kinds:
            # paternal half-sister of the father and also maternal half-sister of the mother
            pid = T.new('f', 'X/AUNT2', father=T.get('X/F/F'), mother=T.get('X/M/M'))
            key = 'X/AUNT2'
        if 'tag' in kinds:
            tag = [p for p in t['parens'] if classify(p) == 'tag'][0][-1]
            key = key.replace('X/S/', 'X/S@%s/' % tag, 1)
        if test_distinct:
            segs = key.split('/')
            if len(segs) >= 3 and re.match(r'^[SDBZ]', segs[1]):
                dcount[0] += 1; segs[1] += '#d%d' % dcount[0]; key = '/'.join(segs)
        if t['n']: key += '#' + t['n']
        if key in T.key and T.n[T.key[key]].get('heir'):
            raise ValueError('two heirs on one key %s in %s' % (key, test['label']))
        if t['extra']:  # "who is also a Paternal Half-Brother's Daughter"
            other = term_key(parse_term(t['extra']), flags)
            i = T.new('f', key + '#two-lines', father=T.get(other.rsplit('/', 1)[0]), mother=T.get(key.rsplit('/', 1)[0]))
        elif 'also' in kinds:  # Paternal Cousin 1 (also Maternal Half-Brother)
            i = T.get(key); T.n[i]['mother'] = T.get('X/M')
        else:
            i = T.get(key)
        node = T.n[i]
        if 'excluded' in kinds:
            node['note'] = 'excluded'
            not_entered.append(dict(text=t['raw'], expected=val))
            if Fraction(val) != 0: raise ValueError('excluded person with non-zero expectation ' + test['label'])
            continue
        node['alive'] = True; node['heir'] = True
        expect[i] = val
        if 'nonassert' in kinds or '(held)' in val:
            held.append(i)
        heir_rows.append((i, t['raw'], None, val))
    if oi != len(outcome): raise ValueError('outcome count mismatch in %s: %d heirs, %d outcomes' % (test['label'], oi, len(outcome)))
    pairs = {t['raw']: t.get('pair') for t in parsed}
    rows = []
    for i, raw, lab, val in heir_rows:
        rows.append(dict(id=i, text=raw, derived=lab or labels(T, i), expected=val, pair=pairs.get(raw)))
    persons = [dict((k, v) for k, v in n.items() if k in ('id', 'sex', 'alive', 'father', 'mother')) for i, n in T.n.items()]
    heir_text = {i: re.sub(r'\s+', ' ', norm(raw)) for i, raw, lab, val in heir_rows}
    return dict(deceased_sex=deceased, persons=persons, spouses=spouses, heir_text=heir_text,
                expect={k: v.replace(' (held)', '') for k, v in expect.items()}, held=held,
                not_entered=not_entered), rows, flags

# ---------------------------------------------------------------- variants for unspecified siblings
SIB6 = [('Full Brother', 'full brother'), ('Full Sister', 'full sister'), ('Paternal Brother', 'paternal brother'),
        ('Paternal Sister', 'paternal sister'), ('Maternal Brother', 'maternal brother'), ('Maternal Sister', 'maternal sister')]
def variants(test):
    terms = [x.strip() for x in re.split(r'\s\+\s', test['heirs'])]
    out = [o.strip() for o in test['outcome'].split(';') if o.strip()]
    vs = []
    any_idx = [i for i, x in enumerate(terms) if '(any type)' in x]
    if any_idx:
        for combo in itertools.combinations_with_replacement(range(6), len(any_idx)):
            tt = list(terms); names = []
            for k, i in enumerate(any_idx):
                tt[i] = SIB6[combo[k]][0] + ' %d' % (k + 1); names.append(SIB6[combo[k]][1])
            vs.append(('siblings: ' + ', '.join(names), tt, out))
        return vs
    if 'Brothers/Sisters' in terms:
        i = terms.index('Brothers/Sisters')
        for name, low in SIB6:
            tt = list(terms); tt[i] = name; vs.append(('sibling: ' + low, tt, out))
        tt = terms[:i] + [n + ' 1' for n, _ in SIB6] + terms[i + 1:]
        vs.append(('one of each sibling type', tt, out[:i] + [out[i]] * 6 + out[i + 1:]))
        return vs
    ms = [i for i, x in enumerate(terms) if re.match(r'^(One )?Maternal Sibling', x)]
    if ms:
        for vname, pick in [('all brothers', lambda k: 'Brother'), ('all sisters', lambda k: 'Sister'),
                            ('mixed', lambda k: 'Brother' if k % 2 == 0 else 'Sister')]:
            if vname == 'mixed' and len(ms) < 2: continue
            tt = list(terms)
            for k, i in enumerate(ms):
                tt[i] = re.sub(r'(One )?Maternal Sibling', 'Maternal ' + pick(k), tt[i])
            vs.append(('maternal siblings: ' + vname, tt, out))
        return vs
    return [('', terms, out)]

# ---------------------------------------------------------------- relationship check
def wanted(raw, pair=None):
    """The relationship the test text names, in the label vocabulary, for the cross-check."""
    t = parse_term(raw); r = t['rel']
    m = re.match(r'^(full brother|paternal half-brother) of paternal (great-)?grandfather(.*)$', r)
    if m:
        r = ('paternal great-grandfather' if m.group(2) else 'paternal grandfather') + "'s " + m.group(1).replace('paternal half-brother', 'paternal brother') + m.group(3)
    for p in t['parens']:
        if p in PAIR_SPEC:
            r = "mother's " + {'full': 'full', 'mat': 'maternal'}[PAIR_SPEC[p]] + (' brother' if 'uncle' in r else ' sister')
    r = r.replace('maternal half-brother', 'maternal brother').replace('maternal half-sister', 'maternal sister')
    r = r.replace('paternal half-brother', 'paternal brother')
    r = r.replace('full paternal uncle', "father's full brother").replace('half paternal uncle', "father's paternal brother")
    r = r.replace("father's maternal half-brother", "father's maternal brother")
    r = re.sub(r'^paternal uncle', "father's full brother", r); r = re.sub(r'^paternal aunt', "father's full sister", r)
    r = re.sub(r'^maternal uncle', "mother's full brother", r); r = re.sub(r'^maternal aunt', "mother's full sister", r)
    r = r.replace('paternal cousin', "father's full brother's son")
    m = re.match(r'^(full brother|paternal half-brother) of paternal (great-)?grandfather(.*)$', r)
    if m:
        r = ('paternal great-grandfather' if m.group(2) else 'paternal grandfather') + "'s " + m.group(1).replace('paternal half-brother', 'paternal brother') + m.group(3)
    for p in t['parens']:
        if p in SPEC:
            r = {'F/B:pat': "father's paternal brother", 'F/Z:full': "father's full sister", 'F/Z:pat': "father's paternal sister",
                 'M/Z:full': "mother's full sister", 'M/Z:mat': "mother's maternal sister", 'M/Z:pat': "mother's paternal sister"}[SPEC[p]]
        if p.startswith('paternal half-sister of the father and also'):
            r = "father's paternal sister"
    if pair and r in ('maternal uncle', "mother's full brother"):
        r = "mother's " + {'full': 'full', 'mat': 'maternal'}[pair] + ' brother'
    return [alias(r)]

# ---------------------------------------------------------------- run
tests, report, problems = [], [], []
for t in RAW:
    entry = dict(id=t['label'], section=t['section'], source_line=t['line'], title=t['title'],
                 heirs_text=t['heirs'], outcome_text=t['outcome'], variants=[])
    rep = ['=' * 78, '%s   (MODULE_TESTS line %d)' % (t['label'], t['line']), 'Heirs:   ' + t['heirs'], 'Outcome: ' + t['outcome']]
    allflags = set()
    try:
        for vname, terms, out in variants(t):
            data, rows, flags = build(t, terms, out)
            allflags.update(flags)
            data['name'] = vname
            entry['variants'].append(data)
            rep.append('  Variant: %s' % (vname or '(single)'))
            for r in rows:
                ok = ''
                if r['id'] not in ('H',) and not r['id'].startswith('W'):
                    want = wanted(r['text'], r.get('pair'))
                    ok = '' if any(w in [d.lower() for d in r['derived']] for w in want) else '   <-- CHECK: expected "%s"' % want[0]
                    if ok: problems.append('%s: %s -> %s' % (t['label'], r['text'], r['derived']))
                rep.append('    %-8s %-48s tree says: %s%s' % (r['expected'], r['text'][:48], ' | '.join(r['derived']), ok))
            for ne in data['not_entered']:
                rep.append('    %-8s %-48s not entered (excluded at the Pre-Stage)' % (ne['expected'], ne['text'][:48]))
            if 'charity' in data['expect']:
                rep.append('    %-8s charitable disposition (no person entered)' % data['expect']['charity'])
            if data['held']:
                rep.append('    held under Clause 12.5: ' + ', '.join(data['held']) + ' (entered as an ordinary heir)')
        for f in sorted(allflags): rep.append('  Assumption: ' + f)
    except Exception as e:
        problems.append('%s: %s' % (t['label'], e)); rep.append('  ERROR: %s' % e)
    tests.append(entry); report.extend(rep)

nv = sum(len(x['variants']) for x in tests)
asum = {}
cur = None
for line in report:
    if line and not line.startswith(' ') and '(MODULE_TESTS line' in line: cur = line.split()[0]
    if line.startswith('  Assumption: '): asum.setdefault(line[14:], []).append(cur)
expanded = [(x['id'], len(x['variants'])) for x in tests if len(x['variants']) > 1]
summary = ['SUMMARY', '',
  'Conventions used for every test (not repeated below):',
  '- The deceased is female where a husband is listed, otherwise male.',
  '- People who are not listed as heirs (a parent or child that links heirs) are entered as "died before".',
  '- Heirs whose wording names the same chain share it: Son + Son\'s Son is the son of that son; Son\'s Daughter 1 + 2 are daughters of one son.',
    '  Separate branches are used only where MODULE_TESTS says so ("child of Son A", "two different daughters", "a different sister").',
  '- A person excluded at the Pre-Stage ("did not profess", "excluded under Section 1.2.5") is not entered as an heir; the expected 0 is recorded as "not entered".',
  '- A person who does not assert a claim is entered as an ordinary heir; "(held)" is recorded, holding the share is the Executor\'s task (Clause 12.5).',
  '',
  'Tests split into variants because MODULE_TESTS leaves the sibling type or sex open (each variant has the same expected shares):']
summary += ['- %s: %d variants' % e for e in expanded]
summary += ['', 'Defaults where MODULE_TESTS does not say full or half:']
for a, ids in asum.items(): summary += ['- %s (%d tests): %s' % (a.replace('default: ', ''), len(ids), ', '.join(ids))]
summary += ['']
head = ['DOC06 test data: conversion report', 'Source: %s.txt (%s lines; %s tests)' % (SRC, format(int(SRC_LINES), ','), SRC_TESTS),
        'Tests converted: %d; variants: %d; problems: %d' % (len(tests), nv, len(problems)), '',
        'How to read: each heir line shows the expected share, the text in MODULE_TESTS, and the relationship',
        'the calculator works out from the tree built for it. A line marked CHECK is one where they differ.', '']
json.dump(dict(source=SRC, tests=tests), open('tests.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
open('conversion_report.txt', 'w', encoding='utf-8').write('\n'.join(head + summary + (['PROBLEMS'] + problems + [''] if problems else []) + report) + '\n')
print(len(tests), nv, len(problems)); print('\n'.join(problems[:60]))
