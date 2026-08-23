#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path('frontend/src')
TARGET_EXTS = {'.ts', '.tsx', '.js', '.jsx'}
import_re = re.compile(
    r"^(?P<indent>\s*)import\s*\{(?P<names>[^}]+)\}\s*from\s*(?P<quote>['\"])(?P<path>[^'\"]*supabaseClient)(?P=quote)\s*;?\s*$",
    re.MULTILINE,
)

changed = []
rewrites = 0

for path in sorted(p for p in ROOT.rglob('*') if p.is_file() and p.suffix in TARGET_EXTS):
    text = path.read_text(encoding='utf-8')
    original = text

    def repl(match: re.Match[str]) -> str:
        global rewrites
        names = [part.strip() for part in match.group('names').split(',') if part.strip()]
        invoke = [n for n in names if re.match(r'^invokeApi(?:\s+as\s+\w+)?$', n)]
        if not invoke:
            return match.group(0)
        if len(invoke) != 1:
            raise SystemExit(f'{path}: expected one invokeApi import, got {invoke!r}')
        remaining = [n for n in names if n not in invoke]
        q = match.group('quote')
        old_path = match.group('path')
        new_path = old_path[:-len('supabaseClient')] + 'invokeApi'
        indent = match.group('indent')
        lines = []
        if remaining:
            lines.append(f"{indent}import {{ {', '.join(remaining)} }} from {q}{old_path}{q}")
        lines.append(f"{indent}import {{ {invoke[0]} }} from {q}{new_path}{q}")
        rewrites += 1
        return '\n'.join(lines)

    text = import_re.sub(repl, text)
    if text != original:
        path.write_text(text, encoding='utf-8')
        changed.append(str(path))

client = ROOT / 'lib' / 'supabaseClient.ts'
text = client.read_text(encoding='utf-8')
original = text
text = re.sub(
    r"\n// Backward-compatible re-export for legacy imports:\n// import \{ invokeApi \} from '\.\./lib/supabaseClient'\nexport \{ invokeApi \} from './invokeApi'\n?",
    '\n',
    text,
    count=1,
)
if text == original:
    raise SystemExit('supabaseClient legacy invokeApi re-export not found exactly once')
client.write_text(text.rstrip() + '\n', encoding='utf-8')
changed.append(str(client))

# Contract: no source import or re-export may route invokeApi through supabaseClient.
violations = []
for path in sorted(p for p in ROOT.rglob('*') if p.is_file() and p.suffix in TARGET_EXTS):
    text = path.read_text(encoding='utf-8')
    for i, line in enumerate(text.splitlines(), 1):
        if 'invokeApi' in line and 'supabaseClient' in line:
            violations.append(f'{path}:{i}:{line.strip()}')
if violations:
    raise SystemExit('legacy invokeApi/supabaseClient references remain:\n' + '\n'.join(violations))

if rewrites == 0:
    raise SystemExit('no invokeApi imports were rewritten')

print(f'INVOKE_API_CYCLE_PATCH=PASS rewrites={rewrites} files={len(set(changed))}')
for item in sorted(set(changed)):
    print(item)
