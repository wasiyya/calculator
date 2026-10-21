import re,json
import sys
L=open(sys.argv[1] if len(sys.argv)>1 else '/home/claude/MT.txt',encoding='utf-8',newline='').read().split('\r\n')
tests=[];sec=None;cur=None
for i,l in enumerate(L):
    s=l.strip()
    if re.match(r'^Section \d+',s): sec=s
    elif s.startswith('Tests for BLOCKING-DESCENDANTS'): sec='Tests for BLOCKING-DESCENDANTS'; cur=None
    m=re.match(r'^Test (\d+) Heirs: (.*?) \((Majority)\)(.*)$',s)
    if m:
        cur={'label':'BLOCKING-DESCENDANTS-'+m.group(1),'section':sec,'line':i+1,'title':s,'heirs':m.group(2),'heirs_line':i+1,'notes':[]};tests.append(cur);continue
    if s.startswith('Test '):
        cur={'label':s[5:].split(' ')[0],'section':sec,'line':i+1,'title':s,'notes':[]};tests.append(cur);continue
    if cur is None: continue
    if s.startswith('Heirs:'): cur['heirs']=s[6:].strip();cur['heirs_line']=i+1
    elif s.startswith('Outcome:'): cur['outcome']=s[8:].strip();cur['outcome_line']=i+1
    elif s.startswith('Note:') or s.startswith('(Compliance'): cur['notes'].append(s)
open('source.txt','w').write('%s|%d|%d' % (L[0].strip(), len(L), len(tests)))
json.dump(tests,open('raw_tests.json','w'),ensure_ascii=False,indent=1)
print(len(tests), sum('heirs' in t for t in tests), sum('outcome' in t for t in tests))
labs=[t['label'] for t in tests]; print('dupe labels',[x for x in set(labs) if labs.count(x)>1])
