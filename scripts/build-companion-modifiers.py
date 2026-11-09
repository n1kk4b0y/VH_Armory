#!/usr/bin/env python3
"""Extract display metadata from an official Remastered config package.

Usage: python3 scripts/build-companion-modifiers.py /path/Remastered-2.0.3.zip
The package/mod is never executed. Its local config always has priority at runtime.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root=Path(__file__).resolve().parents[1]
archive=Path(sys.argv[1]).resolve()
resource='overrides/config/the_vault/vault_modifiers.json'
with zipfile.ZipFile(archive) as bundle:
    manifest=json.loads(bundle.read('manifest.json'))
    content=bundle.read(resource)
    pools=json.loads(bundle.read('overrides/config/the_vault/vault_modifier_pools.json'))['pools']
source=manifest['name']+' '+manifest['version']+' / config/the_vault/vault_modifiers.json'
modifiers={}
def visit(value,key=''):
    if isinstance(value,dict):
        display=value.get('display')
        if isinstance(display,dict):
            modifiers[key]={field:display.get(field) for field in ['name','description','descriptionFormat','color','icon']}
            modifiers[key]['definitionSource']=source
        for name,item in value.items():visit(item,name)
    elif isinstance(value,list):
        for item in value:visit(item,key)
visit(json.loads(content))
temporal=[]
for level in pools['the_vault:companion_temporal']:
    for entry in level['entries']:
        temporal.extend(row['value'] for row in entry['pool'])
if any(item not in modifiers for item in temporal):raise ValueError('Missing temporal modifier definition')
catalog={'source':source,'sourceUrl':'https://www.curseforge.com/minecraft/modpacks/vault-hunters-third-edition-remastered/files/8501770',
    'configSha256':hashlib.sha256(content).hexdigest(),'temporalIds':sorted(set(temporal)),
    'modifiers':dict(sorted(modifiers.items()))}
(root/'data/companion-modifiers.json').write_text(json.dumps(catalog,indent=2)+'\n')
print(json.dumps({'modifiers':len(modifiers),'companionTemporals':len(set(temporal))}))
