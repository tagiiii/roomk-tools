#!/usr/bin/env python3
"""Permanent CLI fixtures plus current-app no-ERROR regression (unknown != safe)."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SCANNER = ROOT / 'scripts/sec1-dataflow.py'
CASES = json.loads((Path(__file__).with_name('sec1-dataflow-fixtures.json')).read_text())


def run(args, cwd=ROOT):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=False)


with tempfile.TemporaryDirectory(prefix='roomk-a11-fixtures-') as directory:
    folder = Path(directory)
    for case in CASES:
        filename = folder / ('fixture.html' if 'html' in case else 'fixture.js')
        filename.write_text(case.get('html', case.get('code')), encoding='utf-8')
        result = run([sys.executable, str(SCANNER), '--json', str(filename)])
        if 'failure' in case:
            assert result.returncode == case['failure'], (case['name'], result.stderr)
            assert 'scanner failed' in result.stderr
            continue
        data = json.loads(result.stdout)
        states = [row['state'] for row in data['findings']]
        assert states == case['states'], (case['name'], states, case['states'])
        assert result.returncode == (1 if 'raw' in states else 0), case['name']
        assert data['errors'] == states.count('raw'), case['name']
        if 'lines' in case:
            assert [r['line'] for r in data['findings']] == case['lines']
    # Missing files are failures, not an empty/successful scan.
    result = run([sys.executable, str(SCANNER), str(folder / 'missing.js')])
    assert result.returncode == 2

    # Exercise the actual SEC-1 shell section, including unchanged legacy checks.
    lint = (ROOT / 'scripts/lint.sh').read_text()
    section = lint[lint.index('# [SEC-1] XSS'):lint.index('# [SEC-2] esc()')]
    (folder / 'apps/fixture').mkdir(parents=True)
    (folder / 'scripts').mkdir()
    scanner_copy = folder / 'scripts/sec1-dataflow.py'
    scanner_copy.write_text(SCANNER.read_text(), encoding='utf-8')
    shell = 'ERRORS=0; WARNINGS=0; XSS_FILES=(apps/fixture/index.html);\n' + section
    shell += '\nprintf "COUNTS %s %s\\n" "$ERRORS" "$WARNINGS"\n'
    integration = [
        ('legacy single raw', 'el.innerHTML = `${name}`;', 1),
        ('legacy single escaped', 'el.innerHTML = `${esc(name)}`;', 0),
        ('legacy multiline concat', "el.innerHTML = `\n${'<b>' + name}\n`;", 1),
        ('new alias raw', "const raw = location.hash; el.innerHTML = `\n${raw}\n`;", 1),
        ('unknown is visible INFO', 'el.innerHTML = `\n${unknown}\n`;', 0),
        ('scanner parser failure', 'el.innerHTML = `\n${unterminated', 1),
    ]
    for name, code, errors in integration:
        (folder / 'apps/fixture/index.html').write_text('<script>\n' + code + '\n</script>')
        result = run(['bash', '-c', shell], cwd=folder)
        assert result.returncode == 0, (name, result.stderr)
        assert result.stdout.rstrip().endswith(f'COUNTS {errors} 0'), (name, result.stdout)
        if name == 'unknown is visible INFO':
            assert 'UNKNOWN (unverified, not safe)' in result.stdout
    for failure in (1, 2):
        (folder / 'apps/fixture/index.html').write_text('<script>const n = 1;</script>')
        scanner_copy.write_text('import sys\nsys.exit(' + str(failure) + ')\n')
        result = run(['bash', '-c', shell], cwd=folder)
        assert result.stdout.rstrip().endswith('COUNTS 1 0'), result.stdout

result = run([sys.executable, str(SCANNER), '--json'])
assert result.returncode == 0, result.stderr + result.stdout
data = json.loads(result.stdout)
assert data['files'] > 0 and data['checkedBareReferences'] > 0
assert data['errors'] == 0, 'New app concern: inspect it; do not add an ignore to pass this test'
print(json.dumps({'result': 'PASS', 'fixtures': len(CASES), 'missingFileFailure': True,
                  'shellIntegrationCases': len(integration) + 2,
                  'appFiles': data['files'], 'appBareReferences': data['checkedBareReferences'],
                  'appErrors': data['errors'], 'appUnknown': data['unknown'],
                  'limit': 'No current-app ERROR is not a claim that all references are safe.'}))
