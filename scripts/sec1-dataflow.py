#!/usr/bin/env python3
"""A-11: conservative, straight-line JS evidence; not a JavaScript/XSS proof.

Only bare references in multiline direct innerHTML templates are reported.
No dependencies; no code execution. Branches, blocks, calls with side effects,
object aliases and unsupported syntax invalidate facts rather than imply safety.
HTML-safe values are not declared safe in attributes/JavaScript/CSS contexts.
"""
import argparse
import glob
import json
import re
import sys
from pathlib import Path

IDENT = re.compile(r'[A-Za-z_$][\w$]*')
BARE = re.compile(r'[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\Z')
HELPERS = {'esc', 'escapeHtml', 'RoomkRTDB.esc'}
SOURCES = {'document', 'location', 'window', 'localStorage', 'sessionStorage'}


def text_context(template, position, source):
    """Certify only literal HTML text context before the first interpolation.

    Quote-aware tag scanning avoids treating an attribute's '>' as a tag end.
    Raw-text/RCDATA elements and earlier dynamic markup are intentionally unknown.
    """
    if any(pos < position for _, pos, _ in template[4]):
        return False
    prefix = source[template[2] + 1:position - 2]
    # Source spelling is not the runtime template value (e.g. \x3cscript>).
    if '\\' in prefix:
        return False
    in_tag, quote, begin = False, '', 0
    for i, char in enumerate(prefix):
        if not in_tag:
            if char == '<':
                in_tag, begin = True, i
        elif quote:
            if char == quote:
                quote = ''
        elif char in "'\"":
            quote = char
        elif char == '>':
            tag = prefix[begin:i + 1]
            if tag.startswith('<!') or tag.startswith('<?'):
                return False
            match = re.match(r'<\s*(/?)\s*([A-Za-z][\w:-]*)', tag)
            if not match:
                return False
            name = match[2].lower()
            if name in ('script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'):
                # Do not parse apparent nested markup inside a raw-text element.
                # Even an apparent closing tag keeps this prefix uncertified.
                return False
            in_tag = False
    return not in_tag


def quoted(source, start, quote):
    i = start + 1
    while i < len(source):
        if source[i] == '\\':
            i += 2
        elif source[i] == quote:
            return i + 1
        else:
            i += 1
    raise ValueError('Unterminated string/template')


def lex(source, start=0, stop_brace=False):
    """Tokens include offsets; template expressions are tokenized recursively."""
    out, i, depth = [], start, 0
    while i < len(source):
        c = source[i]
        if c.isspace():
            i += 1
            continue
        if source.startswith('//', i):
            end = source.find('\n', i)
            i = len(source) if end < 0 else end
            continue
        if source.startswith('/*', i):
            end = source.find('*/', i + 2)
            if end < 0:
                raise ValueError('Unterminated comment')
            i = end + 2
            continue
        if c == '}' and stop_brace and depth == 0:
            return out, i + 1
        if c in "'\"":
            end = quoted(source, i, c)
            out.append(('string', source[i:end], i, end, []))
            i = end
            continue
        if c == '`':
            begin, parts = i, []
            i += 1
            while i < len(source):
                if source[i] == '\\':
                    i += 2
                elif source[i] == '`':
                    i += 1
                    break
                elif source.startswith('${', i):
                    pos = i + 2
                    tokens, i = lex(source, pos, True)
                    parts.append((tokens, pos, i - 1))
                else:
                    i += 1
            else:
                raise ValueError('Unterminated template')
            out.append(('template', source[begin:i], begin, i, parts))
            continue
        # Regex literals must not expose fake sinks or braces to the scanner.
        if c == '/' and (not out or out[-1][1] in ('=', '(', '[', ',', ':', ';', 'return', '=>', '!')):
            begin, char_class = i, False
            i += 1
            while i < len(source):
                if source[i] == '\\':
                    i += 2
                    continue
                if source[i] == '[':
                    char_class = True
                elif source[i] == ']':
                    char_class = False
                elif source[i] == '/' and not char_class:
                    i += 1
                    while i < len(source) and source[i].isalpha():
                        i += 1
                    break
                i += 1
            out.append(('regex', source[begin:i], begin, i, []))
            continue
        match = IDENT.match(source, i)
        if match:
            end, kind = match.end(), 'identifier'
        else:
            match = re.match(r'\d+(?:\.\d+)?\b', source[i:])
            if match:
                end, kind = i + match.end(), 'number'
            else:
                match = re.match(r'===|!==|=>|\+=|-=|\+\+|--|==|!=|&&|\|\||\?\.|\?\?', source[i:])
                end, kind = i + (len(match[0]) if match else 1), 'punct'
        value = source[i:end]
        if value == '{':
            depth += 1
        elif value == '}':
            depth -= 1
        out.append((kind, value, i, end, []))
        i = end
    if stop_brace:
        raise ValueError('Unterminated interpolation')
    return out, i


def spelling(tokens):
    return ''.join(t[1] for t in tokens)


def literal_array(tokens, env, shadowed, source):
    """Side-effect-free scalar elements only; this is not an array safety state."""
    if len(tokens) < 3 or tokens[0][1] != '[' or tokens[-1][1] != ']':
        return None
    elements = tokens[1:-1]
    if len(elements) % 2 != 1:
        return None
    states = []
    for i, token in enumerate(elements):
        if i % 2:
            if token[1] != ',':
                return None
        elif token[0] in ('number', 'string') or (
                token[0] == 'identifier' and token[1] in env
                and env[token[1]] in ('raw', 'safe', 'html')):
            states.append(evaluate([token], env, shadowed, source))
        else:
            return None
    return states


def literal_conditional(tokens):
    """Finite literal leaves only; never merge raw aliases or execute conditions.

    Deliberately exclude calls/properties/parentheses and JS string decoding.
    Recursive branches follow the ternary grammar, not a regex split at ':'.
    """
    forbidden = {'await', 'yield', 'new', 'delete', 'typeof', 'void', 'return',
                 'throw', 'function', 'class', 'this', 'super', 'import'}

    def branch(index, depth):
        if index >= len(tokens) or depth > 32:
            return None
        token = tokens[index]
        if index + 1 < len(tokens) and tokens[index + 1][1] == '?':
            if token[0] not in ('identifier', 'number') or token[1] in forbidden:
                return None
            left = branch(index + 2, depth + 1)
            if left is None or left[1] >= len(tokens) or tokens[left[1]][1] != ':':
                return None
            right = branch(left[1] + 1, depth + 1)
            if right is None:
                return None
            return ('html' if 'html' in (left[0], right[0]) else 'safe', right[1])
        if token[0] == 'number':
            return 'safe', index + 1
        if token[0] == 'string' and not any(c in token[1] for c in ('\\', '\n', '\r')):
            return ('html' if '<' in token[1] or '>' in token[1] else 'safe', index + 1)
        return None

    if len(tokens) < 5 or tokens[1][1] != '?':
        return None
    result = branch(0, 0)
    return result[0] if result and result[1] == len(tokens) else None


def evaluate(tokens, env, shadowed, source, arrays=None):
    if not tokens:
        return 'unknown'
    text = spelling(tokens)
    conditional = literal_conditional(tokens)
    if conditional is not None:
        return conditional
    # A known literal container and a fixed in-range index can retain raw only.
    # Escaped/literal elements do not gain new safe/html certification here.
    if (arrays is not None and len(tokens) == 4 and tokens[0][0] == 'identifier'
            and tokens[1][1] == '[' and tokens[3][1] == ']'
            and re.fullmatch(r'0|[1-9][0-9]*', tokens[2][1])):
        elements = arrays.get(tokens[0][1])
        if elements is not None and len(tokens[2][1]) <= len(str(len(elements))):
            index = int(tokens[2][1])
            if index < len(elements) and elements[index] == 'raw':
                return 'raw'
        return 'unknown'
    if len(tokens) == 1:
        kind, value, begin, _, parts = tokens[0]
        if kind == 'number':
            return 'safe'
        if kind == 'string':
            # Trusted literal HTML is only safe in text context, never an attribute.
            return 'html' if '<' in value or '>' in value else 'safe'
        if kind == 'template':
            states = [evaluate(p, env, shadowed, source) for p, _, _ in parts]
            if 'raw' in states:
                return 'raw'
            if any(s not in ('safe', 'html') for s in states):
                return 'unknown'
            for p, pos, _ in parts:
                if not text_context(tokens[0], pos, source):
                    return 'unknown'
            return 'html'
    # Only the documented helpers, an entire call, and no local redefinition.
    match = re.fullmatch(r'(esc|escapeHtml|RoomkRTDB\.esc)\((.*)\)', text, re.S)
    if match and match[1] not in shadowed:
        # A balanced top-level call prevents esc(x) + raw from being exempted.
        depth = 0
        for index, t in enumerate(tokens):
            if t[1] == '(':
                depth += 1
            elif t[1] == ')':
                depth -= 1
                if depth == 0 and index != len(tokens) - 1:
                    return 'unknown'
        return 'safe'
    # Only a complete no-argument suffix on an already known source/reference.
    # trim removes whitespace, not HTML. Do not extend safe/html certification.
    if [t[1] for t in tokens[-4:]] == ['.', 'trim', '(', ')']:
        receiver = tokens[:-4]
        receiver_text = spelling(receiver)
        # Restrict receivers to bare aliases or the existing simple DOM/storage
        # source calls. No concat, conditional, nested call or transform chain.
        simple = BARE.fullmatch(receiver_text) or re.fullmatch(
            r'(?:document\.(?:getElementById|querySelector)\([^()]*\)\.(?:value|textContent|innerHTML)'
            r'|(?:localStorage|sessionStorage)\.getItem\([^()]*\))', receiver_text)
        if simple and 'trim' not in shadowed and evaluate(receiver, env, shadowed, source) == 'raw':
            return 'raw'
        return 'unknown'
    if 'document' not in shadowed and re.fullmatch(r'document\.(?:getElementById|querySelector)\([^()]*\)', text):
        return 'dom'
    if 'document' not in shadowed and re.fullmatch(r'document\.(?:getElementById|querySelector)\([^()]*\)\.(?:value|textContent|innerHTML)', text):
        return 'raw'
    if text in ('location.hash', 'location.search', 'window.location.hash', 'window.location.search') and text.split('.')[0] not in shadowed:
        return 'raw'
    if re.fullmatch(r'(?:localStorage|sessionStorage)\.getItem\([^()]*\)', text) and text.split('.')[0] not in shadowed:
        return 'raw'
    match = re.fullmatch(r'([\w$]+)\.(?:value|textContent|innerHTML|dataset\.[\w$]+)', text)
    if match and env.get(match[1]) == 'dom':
        return 'raw'
    if BARE.fullmatch(text):
        return env.get(text, 'unknown')
    # Literal/alias concatenation only; no operator-precedence approximation.
    if all(t[1] not in ('(', ')', '?', ':', '=', '=>', '{', '}') for t in tokens):
        groups, group = [], []
        for t in tokens:
            if t[1] == '+':
                groups.append(group)
                group = []
            else:
                group.append(t)
        groups.append(group)
        if len(groups) > 1:
            states = [evaluate(g, env, shadowed, source) for g in groups]
            if 'raw' in states:
                return 'raw'
            if all(s in ('safe', 'html') for s in states):
                return 'html' if 'html' in states else 'safe'
    return 'unknown'


def scan_js(source, filename, offset=0):
    tokens, _ = lex(source)
    # Any helper declaration/assignment/parameter spelling makes it untrusted
    # throughout this script. Deliberately over-conservative rather than scope guessing.
    shadowed = set()
    # Explicit method/prototype replacement makes trim untrusted script-wide.
    # This deliberately also rejects unrelated trim declarations/string keys;
    # dynamic computed mutation and changes in other scripts are not resolved.
    for i, t in enumerate(tokens):
        if t[1] in ('prototype', '__proto__', 'setPrototypeOf', 'defineProperty', 'defineProperties'):
            shadowed.add('trim')
        if t[0] == 'string' and t[1][1:-1] == 'trim':
            shadowed.add('trim')
        if t[1] == 'trim' and not (i > 0 and tokens[i - 1][1] == '.'
                                   and [x[1] for x in tokens[i + 1:i + 3]] == ['(', ')']):
            shadowed.add('trim')
    for i, t in enumerate(tokens):
        if t[1] in ('esc', 'escapeHtml', 'RoomkRTDB') or t[1] in SOURCES:
            prev = tokens[i - 1][1] if i else ''
            nxt = tokens[i + 1][1] if i + 1 < len(tokens) else ''
            if prev in ('function', 'const', 'let', 'var', '(', ',', '{') or nxt in ('=', '+=', '=>'):
                shadowed.update(HELPERS if t[1] == 'RoomkRTDB' else [t[1]])
                if prev == '.' and i >= 2 and tokens[i - 2][1] == 'RoomkRTDB':
                    shadowed.add('RoomkRTDB.esc')
    env, arrays, pending, findings = {}, {}, [], []

    def statement(ts):
        if not ts:
            return
        for i in range(len(ts) - 3):
            if ts[i][1] == '.' and ts[i + 1][1] == 'innerHTML' and ts[i + 2][1] in ('=', '+='):
                template = ts[i + 3]
                if template[0] != 'template' or '\n' not in template[1]:
                    continue
                for expr, pos, _ in template[4]:
                    ref = spelling(expr)
                    if not BARE.fullmatch(ref):
                        continue
                    state = evaluate(expr, env, shadowed, source)
                    if state in ('safe', 'html') and not text_context(template, pos, source):
                        state = 'unknown'
                    findings.append({'file': filename, 'line': offset + source.count('\n', 0, pos) + 1,
                                     'reference': ref, 'state': state})
        start = 1 if ts[0][1] in ('const', 'let', 'var') else 0
        assign = next((i for i in range(start, len(ts)) if ts[i][1] in ('=', '+=')), -1)
        key = spelling(ts[start:assign]) if assign >= 0 else ''
        if BARE.fullmatch(key) and assign + 1 < len(ts):
            rhs = ts[assign + 1:]
            # Capture before conservative invalidation; recognition excludes calls.
            elements = literal_array(rhs, env, shadowed, source) if '.' not in key and ts[assign][1] == '=' else None
            value = evaluate(rhs, env, shadowed, source, arrays)
            if ts[assign][1] == '+=':
                prior = env.get(key, 'unknown')
                value = 'raw' if 'raw' in (prior, value) else 'unknown'
            # Unknown operations may mutate object aliases or invoke callbacks.
            if value == 'unknown' or any(t[1] in ('(', '=', '+=', '++', '--') for t in ts[assign + 1:]):
                env.clear()
                arrays.clear()
            if '.' in key:
                arrays.clear()
                # Distinct roots may alias the same object. A declaration can
                # invalidate facts before later property assignments recreate
                # them, so dropping only key's descendants is insufficient.
                # Keep scalar copies, but discard every older property fact.
                for old in list(env):
                    if '.' in old:
                        del env[old]
            else:
                arrays.pop(key, None)
            # Replacing obj invalidates previously tracked obj.field values.
            for old in list(env):
                if old.startswith(key + '.'):
                    del env[old]
            env[key] = value
            if elements is not None:
                arrays[key] = elements
        else:
            env.clear()
            arrays.clear()

    for token in tokens:
        if token[1] in ('{', '}'):
            # No facts flow across block/function/control boundaries.
            env.clear()
            arrays.clear()
            pending = []
        elif token[1] == ';':
            statement(pending)
            pending = []
        else:
            pending.append(token)
    statement(pending)
    return findings


def scan_file(filename):
    source = Path(filename).read_text(encoding='utf-8')
    if Path(filename).suffix != '.html':
        return scan_js(source, filename)
    findings = []
    for match in re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script\s*>', source, re.I):
        attrs = match[1]
        if re.search(r'\bsrc\s*=', attrs, re.I) or re.search(r'type\s*=\s*[\"\'](?:application/ld\+json|application/json)', attrs, re.I):
            continue
        findings.extend(scan_js(match[2], filename, source.count('\n', 0, match.start(2))))
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='all states and locations, including unknown')
    parser.add_argument('files', nargs='*')
    args = parser.parse_args()
    files = args.files or sorted(glob.glob('apps/*/index.html') + glob.glob('apps/*/app.js'))
    findings = [row for file in files for row in scan_file(file)]
    errors = [r for r in findings if r['state'] == 'raw']
    unknown = [r for r in findings if r['state'] not in ('raw', 'safe', 'html')]
    result = {'files': len(files), 'errors': len(errors), 'unknown': len(unknown),
              'checkedBareReferences': len(findings), 'findings': findings}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for r in errors:
            print('ERROR\t{file}:{line}\t${{{reference}}}: raw source reaches HTML'.format(**r))
        if unknown:
            print(f'INFO\tA-11: {len(unknown)}/{len(findings)} bare references UNKNOWN (unverified, not safe); --json for details')
        print(f'INFO\tA-11: {len(files)} files, {len(findings)} bare references, {len(errors)} raw-source errors')
    return 1 if errors else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as exc:
        print('A-11 scanner failed: ' + str(exc), file=sys.stderr)
        sys.exit(2)
