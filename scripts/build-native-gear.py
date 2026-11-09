#!/usr/bin/env python3
"""Extract attribute types and display metadata from the supplied mod, without executing it.

Usage: python3 scripts/build-native-gear.py /path/the_vault.jar
Requires Java 17's jdk.jdeps module for javap.
"""
import hashlib
import json
import re
import subprocess
import sys
from zipfile import ZipFile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
jar = Path(sys.argv[1]).resolve()

def bytecode(cls):
    return subprocess.check_output(['java', '-XX:-UsePerfData', '-m', 'jdk.jdeps/com.sun.tools.javap.Main',
        '-p', '-c', '-constants', '-classpath', str(jar), cls], text=True)

code = bytecode('iskallia.vault.init.ModGearAttributes').split('  static {};')[-1]
attributes = {}
end = 0
for match in re.finditer(r'\d+: putstatic[^\n]*// Field ([A-Z_0-9]+):Liskallia/vault/gear/attribute/VaultGearAttribute;', code):
    block = code[end:match.start()]
    end = match.end()
    if '// Method attr:' not in block and 'VaultGearAttribute."<init>"' not in block:
        continue
    strings = re.findall(r'// String (.*)', block)
    strings = strings[next(i for i, value in enumerate(strings) if re.fullmatch(r'[a-z][a-z0-9_]*', value)):]
    if not strings:
        raise ValueError('Missing attribute identity: ' + match[1])
    factory = re.search(r'VaultGearAttributeType\.(\w+):', block)
    custom = re.search(r'// Method (iskallia/vault/gear/attribute/[^\s]+)\.type:', block)
    reader = re.search(r'ModGearAttributeReaders\.(\w+):', block)
    reader_class = re.search(r'// class (iskallia/vault/gear/reader/[^\s]+)', block)
    label = strings[1] if len(strings) > 1 else None
    colors = re.findall(r'// int (\d+)', block)
    row = {'type': factory[1].removesuffix('Type') if factory else 'custom',
        'reader': reader[1] if reader else reader_class[1].split('/')[-1] if reader_class else None,
        'name': label, 'color': '#%06x' % int(colors[-1]) if colors and int(colors[-1]) <= 0xffffff else None}
    if custom:
        row['class'] = custom[1].replace('/', '.')
    if row['type'] == 'enum':
        enum_class = re.findall(r'// class ([^\s]+)', block)[0].replace('/', '.')
        enum_code = bytecode(enum_class)
        row['values'] = re.findall(r'public static final '+re.escape(enum_class)+r' ([A-Z_0-9]+);', enum_code)
        if not row['values']:
            raise ValueError('Missing enum: ' + enum_class)
    attributes['the_vault:' + strings[0]] = row

if len(attributes) != 164:
    raise ValueError('Unexpected native attribute registry size: ' + str(len(attributes)))
with ZipFile(jar) as archive:
    language = json.loads(archive.read('assets/the_vault/lang/en_us.json'))
effect_labels = {key.removeprefix('effect.the_vault.'): value for key, value in language.items()
    if key.startswith('effect.the_vault.') and isinstance(value, str)}
catalog = {'source': jar.name + ' / ModGearAttributes + en_us', 'jarSha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
    'attributes': dict(sorted(attributes.items())), 'effectLabels': dict(sorted(effect_labels.items()))}
(root / 'data/native-gear-attributes.json').write_text(json.dumps(catalog, indent=2) + '\n')
print(json.dumps({'attributes': len(attributes), 'customClasses': sorted(set(v.get('class') for v in attributes.values() if v.get('class')))}))
