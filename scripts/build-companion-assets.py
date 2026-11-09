#!/usr/bin/env python3
"""Copy the exact PetModelType variants from the supplied Remastered mod JAR.

Usage: python3 scripts/build-companion-assets.py /path/to/the_vault.jar
Requires Java 17's jdk.jdeps module; the game/mod is never executed.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
jar = pathlib.Path(sys.argv[1]).resolve()

def bytecode(cls):
    return subprocess.check_output([
        'java', '-XX:-UsePerfData', '-m', 'jdk.jdeps/com.sun.tools.javap.Main',
        '-p', '-c', '-constants', '-classpath', str(jar), cls
    ], text=True)

text = bytecode('iskallia.vault.entity.entity.pet.PetModelType')
variants = {}
destination = ROOT / 'public/assets/companions'
destination.mkdir(parents=True, exist_ok=True)
copied = set()
with zipfile.ZipFile(jar) as archive:
    for block in re.split(r'\n\s+\d+: new\s+#[^\n]*// class iskallia/vault/entity/entity/pet/PetHelper\$PetVariant\n', text)[1:]:
        block = block.split('// Method iskallia/vault/entity/entity/pet/PetHelper$PetVariant."<init>"')[0]
        strings = re.findall(r'// String (.*)', block)
        if len(strings) < 5:
            continue
        model = next((s for s in strings if s.startswith('geo/')), None)
        texture = next((s for s in strings if s.startswith('textures/')), None)
        if not model or not texture:
            continue
        assets = []
        for resource in (model, texture):
            source = 'assets/the_vault/' + resource
            if source not in archive.namelist():
                raise ValueError('Registered companion resource missing: ' + source)
            output = destination / resource
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.read(source))
            copied.add(resource)
            assets.append('/assets/companions/' + resource)
        variants[strings[0]] = {'name': strings[1].replace("\\'", "'"), 'model': assets[0], 'texture': assets[1]}

manifest = {'source': jar.name, 'sha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
            'registry': 'PetModelType / PetHelper.PetVariant', 'variants': variants,
            'resourceCount': len(copied)}
(destination / 'catalog.json').write_text(json.dumps(manifest, indent=2) + '\n')
(ROOT / 'src/progression/companionModels.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'variants': len(variants), 'resources': len(copied)}))
