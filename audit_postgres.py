import os
import re

patterns = {
    'julianday': r'julianday\(',
    'strftime': r'strftime\(',
    'sqlite_date': r"date\(['\"]now['\"]",
    'bool_int': r'is_completed\s*=\s*[01]',
    'bool_int_milestone': r'is_celebrated\s*=\s*[01]',
    'is_onsite_int': r'is_onsite\s*=\s*[01]',
    'is_sent_int': r'is_sent\s*=\s*[01]',
    'is_read_int': r'is_read\s*=\s*[01]',
    'is_primary_int': r'is_primary\s*=\s*[01]',
    'ai_generated_int': r'ai_generated\s*=\s*[01]',
    'group_concat': r'group_concat\(',
    'case_sensitive_like': r'\sLIKE\s',
    'reserved_user': r'\buser\b',
    'reserved_order': r'\border\b',
}

results = []
for root, dirs, files in os.walk('.'):
    # Skip some directories
    if any(d in root for d in ['.git', '__pycache__', '.venv', 'uploads', 'backups']):
        continue
    for f in files:
        if f.endswith('.py'):
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as f_in:
                    lines = f_in.readlines()
                    for i, line in enumerate(lines):
                        for name, p in patterns.items():
                            if re.search(p, line, re.IGNORECASE):
                                results.append(f'{path}:{i+1}: [{name}] {line.strip()}')
            except Exception as e:
                print(f"Error reading {path}: {e}")

with open('audit_results.txt', 'w', encoding='utf-8') as f_out:
    f_out.write('\n'.join(results))
print(f'Done! Found {len(results)} matches.')
