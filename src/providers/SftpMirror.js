const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LocalProvider } = require('./LocalProvider');
const { SftpSession, SftpError, isDirectory, isFile } = require('./SftpSession');
const uuidFile = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(dat|json)$/i;
const nativeFile = /^the_vault_[a-z0-9_.-]+\.dat$/i;
const safeName = name => typeof name === 'string' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
const configFiles = ['vault_levels','vault_level','player_levels','levels','leveling','vault_xp','vault_experience','player_level',
  'entity_groups','trinket','companions','vault_modifiers','vault_stats'].map(name => `config/the_vault/${name}.json`)
  .concat(['config/the_vault/quest/quests.json','config/the_vault/quest/sky_quests.json']);
const cacheChild = (root, relative) => {
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new SftpError('SFTP_CACHE', 'O cache SFTP contém um caminho inválido.');
  return result;
};
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

class SftpMirror {
  constructor(config, options = {}) {
    this.config = config;
    this.base = path.join(config.root, 'data', 'sftp-cache', config.sourceKey);
    this.session = options.sessionFactory ? options.sessionFactory(config.sftp, config.root) : new SftpSession(config.sftp, config.root);
  }
  async previous() {
    try {
      const previous = JSON.parse(await fs.readFile(path.join(this.base, 'current.json'), 'utf8'));
      if (previous.sourceKey !== this.config.sourceKey || !/^[a-f0-9-]{36}$/.test(previous.generation) || !previous.files || typeof previous.files !== 'object') return null;
      return { ...previous, directory: path.join(this.base, 'snapshots', previous.generation) };
    } catch { return null; }
  }
  async prepare({ force = false } = {}) {
    const s = this.config.sftp;
    this.generation = crypto.randomUUID();
    this.directory = path.join(this.base, 'snapshots', this.generation);
    const worldRelative = 'instance/saves/world';
    const plan = new Map();
    const add = (remote, relative, attrs) => { cacheChild(this.directory, relative); plan.set(relative, { remote, attrs }); };
    try {
      await this.session.connect();
      const dataDirectory = path.posix.join(s.remoteWorldPath, 'data');
      if (!isDirectory(await this.session.stat(dataDirectory))) throw new SftpError('SFTP_WORLD_PATH', 'sftp.remoteWorldPath deve apontar para a raiz do mundo, que contém a pasta data.');
      const data = await this.session.list(dataDirectory);
      for (const entry of data) {
        if (safeName(entry.filename) && nativeFile.test(entry.filename) && isFile(entry.attrs))
          add(path.posix.join(dataDirectory, entry.filename), worldRelative + '/data/' + entry.filename, entry.attrs);
      }
      if (!plan.size) throw new SftpError('SFTP_WORLD_PATH', 'Não foram encontrados arquivos the_vault_*.dat em remoteWorldPath/data. Confira a pasta do mundo.');
      for (const folder of ['data/vault_snapshots', 'playerdata', 'stats']) {
        for (const entry of await this.session.list(path.posix.join(s.remoteWorldPath, folder), true)) {
          const extension = folder === 'stats' ? '.json' : '.dat';
          if (safeName(entry.filename) && uuidFile.test(entry.filename) && entry.filename.toLowerCase().endsWith(extension) && isFile(entry.attrs))
            add(path.posix.join(s.remoteWorldPath, folder, entry.filename), worldRelative + '/' + folder + '/' + entry.filename, entry.attrs);
        }
      }
      // Mirror only known metadata, not region chunks, mods, server scripts or backups.
      // The layout gives LocalProvider the same world/instance relationship as a local save.
      const roots = [
        { remote: s.remoteWorldPath, relative: worldRelative },
        { remote: s.remoteInstancePath || path.posix.dirname(path.posix.dirname(s.remoteWorldPath)), relative: 'instance' },
        { remote: path.posix.dirname(s.remoteWorldPath), relative: 'instance/saves' }
      ];
      const seenRoots = new Set();
      for (const root of roots) {
        if (seenRoots.has(root.remote)) continue; seenRoots.add(root.remote);
        for (const relative of ['usernamecache.json', 'usercache.json', ...configFiles]) {
          const remote = path.posix.join(root.remote, relative), attrs = await this.session.stat(remote);
          if (isFile(attrs)) add(remote, root.relative + '/' + relative, attrs);
        }
        for (const entry of await this.session.list(path.posix.join(root.remote, 'playerSnapshots'), true)) {
          if (safeName(entry.filename) && uuidFile.test(entry.filename) && entry.filename.toLowerCase().endsWith('.json') && isFile(entry.attrs))
            add(path.posix.join(root.remote, 'playerSnapshots', entry.filename), root.relative + '/playerSnapshots/' + entry.filename, entry.attrs);
        }
      }
      const previous = await this.previous();
      const files = {}; let downloaded = 0, reused = 0, bytesDownloaded = 0;
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      for (const [relative, item] of plan) {
        const { attrs } = item;
        if (!Number.isSafeInteger(attrs.size) || attrs.size < 0 || attrs.size > s.maxFileSizeMB * 1024 * 1024)
          throw new SftpError('SFTP_FILE_SIZE', 'Um arquivo do mundo excedeu sftp.maxFileSizeMB.');
        const file = cacheChild(this.directory, relative);
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const old = previous?.files[relative];
        // Files whose timestamp is still near the previous scan may have been
        // rewritten within SFTP's one-second timestamp resolution: fetch again.
        const stable = Number.isFinite(attrs.mtime) && attrs.mtime < (previous?.scannedAt || 0) / 1000 - 2;
        let copied = false, sha256;
        if (!force && previous?.fingerprint === this.session.fingerprint && stable && old?.size === attrs.size && old?.mtime === attrs.mtime && /^[a-f0-9]{64}$/.test(old?.sha256 || '')) {
          try {
            const from = cacheChild(previous.directory, relative);
            if ((await fs.stat(from)).size === attrs.size) { await fs.copyFile(from, file, constants.COPYFILE_FICLONE); copied = true; }
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (copied) { reused++;sha256=old.sha256; }
        else {
          const current = await this.session.stat(item.remote);
          if (!current || current.size !== attrs.size || current.mtime !== attrs.mtime)
            throw new SftpError('SFTP_CHANGED', 'O Minecraft salvou alterações durante a sincronização. Tente Recarregar dados novamente.');
          const bytes = await this.session.readStable(item.remote, current);
          sha256=crypto.createHash('sha256').update(bytes).digest('hex');
          await fs.writeFile(file, bytes, { mode: 0o600 }); downloaded++; bytesDownloaded += bytes.length;
        }
        files[relative] = { size: attrs.size, mtime: Number.isFinite(attrs.mtime) ? attrs.mtime : null, sha256 };
      }
      this.manifest = { version: 1, sourceKey: this.config.sourceKey, fingerprint: this.session.fingerprint, generation: this.generation, scannedAt: Date.now(), files };
      const provider = new LocalProvider(path.join(this.directory, worldRelative), {
        // Remote data must not silently use paths from the local PC's environment.
        env: { VH_USE_JAR_XP_DEFAULTS: process.env.VH_USE_JAR_XP_DEFAULTS }
      });
      return { provider, mirror: this, metrics: { files: plan.size, downloaded, reused, bytesDownloaded } };
    } catch (error) { await this.discard(); throw error instanceof SftpError ? error : new SftpError('SFTP_CACHE', 'Não foi possível preparar o cache SFTP. Confira espaço e permissões na pasta data.'); }
    finally { await this.session.close(); }
  }
  async commit() {
    await atomicJson(path.join(this.base, 'current.json'), this.manifest);
    this.committed = true;
    try {
      const generations = await fs.readdir(path.join(this.base, 'snapshots'), { withFileTypes: true });
      const others = [];
      for (const entry of generations) {
        if (!entry.isDirectory() || entry.name === this.generation || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
        const file = path.join(this.base, 'snapshots', entry.name);
        others.push({ file, time: (await fs.stat(file)).mtimeMs });
      }
      others.sort((a, b) => b.time - a.time);
      for (const old of others.slice(1)) await fs.rm(old.file, { recursive: true, force: true });
    } catch { /* Cleanup can be retried on the next successful synchronization. */ }
  }
  async discard() { if (this.directory && !this.committed) await fs.rm(this.directory, { recursive: true, force: true }); }
}
module.exports = { SftpMirror, atomicJson, configFiles };
