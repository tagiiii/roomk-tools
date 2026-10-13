"""KanjiVG の SVG を正規表現で読む（XML パーサーには通さない）。"""
import re

TOKEN = re.compile(r'<g\b([^>]*)>|</g>|<path\b([^>]*)/>')
ATTR = re.compile(r'([\w:]+)="([^"]*)"')

def parse(text):
    """StrokePaths の中の木を返す。node = {'el','pos','part','children':[node|stroke_index]}, strokes = [d, ...]"""
    start = text.index('kvg:StrokePaths_')
    end = text.index('kvg:StrokeNumbers_')
    body = text[text.index('>', start) + 1:end]
    strokes, stack, root = [], [], None
    for m in TOKEN.finditer(body):
        tok = m.group(0)
        if tok.startswith('<g'):
            a = dict(ATTR.findall(m.group(1)))
            node = {'el': a.get('kvg:element', ''), 'pos': a.get('kvg:position', ''), 'part': a.get('kvg:part', ''), 'children': []}
            if stack: stack[-1]['children'].append(node)
            else: root = node
            stack.append(node)
        elif tok == '</g>':
            if stack: stack.pop()
            if not stack and root is not None: break
        else:
            a = dict(ATTR.findall(m.group(2)))
            strokes.append(a['d'])
            stack[-1]['children'].append(len(strokes) - 1)
    return root, strokes

def leaves(node):
    out = []
    for c in node['children']:
        out += [c] if isinstance(c, int) else leaves(c)
    return out

def show(node, depth=0):
    lines = []
    loose = [c for c in node['children'] if isinstance(c, int)]
    lines.append('  ' * depth + f"[{node['el'] or '-'}{'/' + node['pos'] if node['pos'] else ''}{' p' + node['part'] if node['part'] else ''}] n={len(leaves(node))}" + (f" loose={loose}" if loose and any(not isinstance(c, int) for c in node['children']) else ''))
    for c in node['children']:
        if not isinstance(c, int): lines += show(c, depth + 1)
    return lines
