"""Extract P2 labels and UI textures from the supplied native mod (developer only).

Requires Python 3 and Java 17. The dashboard ships the generated files.
Quest defaults only describe the 17 definitions in QuestConfig.reset; unknown
IDs are intentionally not assigned targets or rewards.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile


def javap(jar, name):
    return subprocess.check_output(['java', '-XX:-UsePerfData', '--module', 'jdk.jdeps/com.sun.tools.javap.Main', '-classpath', str(jar), '-p', '-c', name], text=True)


def extract(jar, root):
    quests = {}
    bytecode = javap(jar, 'iskallia.vault.config.quest.QuestConfig')
    body = bytecode.split('  protected void reset();', 1)[1].split('\n  public ', 1)[0]
    for segment in re.split(r'\n\s*\d+: aload_0\n', body):
        literals = re.findall(r'// String (.*)', segment)
        if len(literals) < 2 or not re.fullmatch(r'[a-zA-Z0-9_]+', literals[0]):
            continue
        head = segment.split('// class iskallia/vault/quest/base/Quest$QuestReward', 1)[0]
        progress = re.search(r'// float ([\d.]+)f', head)
        if progress:
            goal = float(progress[1])
        else:
            constants = re.findall(r'fconst_(\d)', head)
            goal = float(constants[-1]) if constants else None
        quests[literals[0]] = {'id':literals[0], 'name':literals[1], 'targetProgress':goal}
    enums = {}
    for key, cls in [('emblems', 'iskallia.vault.config.EmblemConfig'), ('trails', 'iskallia.vault.item.PlayerParticleTrailItem$TrailType')]:
        static = javap(jar, cls).split('  static {};', 1)[1]
        chunks = re.split(r'\n\s*\d+: new\s', static)[1:]
        enums[key] = []
        for chunk in chunks:
            strings = re.findall(r'// String (.*)', chunk)
            if len(strings) >= 2:
                enums[key].append({'id':len(enums[key]), 'name':strings[1], 'symbol':strings[2] if len(strings) >= 3 else None})
    assert len(quests) == 17 and len(enums['emblems']) == 25 and len(enums['trails']) == 6
    with ZipFile(jar) as archive:
        lang = json.loads(archive.read('assets/the_vault/lang/en_us.json'))
        data = {'version':'20.0.3-remastered.6872', 'sourceSha256':hashlib.sha256(jar.read_bytes()).hexdigest(),
                'quests':quests, 'items':{}, **enums}
        for key, name in lang.items():
            if key.startswith(('item.the_vault.', 'block.the_vault.')):
                data['items'].setdefault('the_vault:' + key.split('.', 2)[2], name)
        destination = root / 'data' / 'p2-catalog.json'
        destination.parent.mkdir(exist_ok=True)
        destination.write_text(json.dumps(data, indent=2, ensure_ascii=False)+'\n')
        assets = root / 'public' / 'assets' / 'vault'
        catfile = assets / 'catalog.js'
        catalog = json.loads(catfile.read_text().removeprefix('window.VH_ASSET_CATALOG = ').strip().removesuffix(';'))
        catalog['quests'] = {}; catalog['bounties'] = {}
        for domain, prefix in [('quests','gui/quests/'), ('bounties','gui/screen/bounty/')]:
            for name in archive.namelist():
                native = 'assets/the_vault/textures/' + prefix
                if not name.startswith(native) or not name.endswith('.png'):
                    continue
                stem = name[len(native):-4]
                if '/' in stem or (domain == 'bounties' and not stem.endswith('_bounty')):
                    continue
                target = assets / 'icons' / domain / (stem+'.png')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
                catalog[domain][stem] = '/assets/vault/icons/' + domain + '/' + stem + '.png'
        for domain, name in [('quests','gui/screen/icon/quests.png'), ('bounties','gui/screen/bounty/unidentified_bounty.png'), ('discoveries','item/model_discovery.png')]:
            native = 'assets/the_vault/textures/' + name
            if native in archive.namelist():
                target = assets / 'icons' / 'ui' / ('p2_'+domain+'.png')
                target.write_bytes(archive.read(native))
                catalog['ui'][domain] = '/assets/vault/icons/ui/' + target.name
            elif domain == 'discoveries':
                catalog['ui'][domain] = catalog['quests'].get('transmog')
        catfile.write_text('window.VH_ASSET_CATALOG = '+json.dumps(catalog,separators=(',',':'))+';\n')
        reportfile = assets / 'build-report.json'
        report = json.loads(reportfile.read_text())
        report['counts'].update({key:len(catalog[key]) for key in ['quests','bounties','ui']})
        report['p2Catalog']={'file':'data/p2-catalog.json','sourceSha256':data['sourceSha256'],'quests':len(quests),'emblems':len(enums['emblems']),'trails':len(enums['trails'])}
        reportfile.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'quests':len(quests), 'emblems':len(enums['emblems']), 'trails':len(enums['trails']), 'icons':{k:len(catalog[k]) for k in ['quests','bounties']}}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('jar', type=Path)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    extract(args.jar, args.root)
