const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { configFiles } = require('./SftpMirror');

async function sourceRevision(candidate, world) {
  const hash = crypto.createHash('sha256').update(candidate.sourceKey || 'injected');
  if (candidate.mirror) {
    for (const [name, metadata] of Object.entries(candidate.mirror.manifest.files).sort(([a],[b])=>a.localeCompare(b)))
      hash.update(JSON.stringify([name, metadata]));
    return hash.digest('hex');
  }
  const provider = candidate.provider;
  if (!provider.configRoots || !Array.isArray(world.files)) return null;
  const files = new Set(world.files.map(relative => path.join(provider.worldPath,relative)));
  for (const root of provider.configRoots) {
    for (const relative of ['usernamecache.json','usercache.json',...configFiles]) files.add(path.join(root,relative));
    const folder = path.join(root,'playerSnapshots');
    try { for (const file of await fs.readdir(folder)) if (/\.json$/i.test(file)) files.add(path.join(folder,file)); } catch {}
  }
  for (const key of ['VH_VAULT_LEVELS_PATH','VH_TRINKET_CONFIG_PATH','VH_COMPANIONS_CONFIG_PATH','VH_MODIFIERS_CONFIG_PATH','VH_VAULT_STATS_CONFIG_PATH'])
    if (provider.env[key]) files.add(path.resolve(provider.env[key]));
  for (const file of [...files].sort()) {
    try { const stat = await fs.stat(file);hash.update(JSON.stringify([file,stat.size,stat.mtimeMs,stat.ctimeMs])); }
    catch { hash.update(JSON.stringify([file,null])); }
  }
  return hash.digest('hex');
}
module.exports = { sourceRevision };
