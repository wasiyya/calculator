# Build DOC06_Inheritance_Calculator.html from calculator_template.html, engine.js and tests.json.
# engine.js is the only copy of the share rules: this script puts it into section 2 of the page.
# Usage (from the build folder): python3 build_page.py  ->  writes ../DOC06_Inheritance_Calculator.html
import json
t = open('calculator_template.html', encoding='utf-8').read()
a = t.index('// ===================================================================\n// 2. THE CALCULATOR')
b = t.index('// ===================================================================\n// 3. FAMILY TREE')
t = t[:a] + open('engine.js', encoding='utf-8').read().rstrip('\n') + '\n\n' + t[b:]
tests = json.load(open('tests.json', encoding='utf-8'))
data = json.dumps(tests, ensure_ascii=False).replace('</', '<\\/')
assert t.count('/*TESTS*/') == 1
t = t.replace('/*TESTS*/', data)
open('../DOC06_Inheritance_Calculator.html', 'w', encoding='utf-8').write(t)
print('built: %d tests, %d runs' % (len(tests['tests']), sum(len(x['variants']) for x in tests['tests'])))
