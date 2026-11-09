const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('ssh2');

class SftpError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 503; }
}
const isMissing = error => error?.code === 2 || error?.code === 'ENOENT';
const isDirectory = attrs => typeof attrs?.isDirectory === 'function' ? attrs.isDirectory() : (attrs?.mode & 0o170000) === 0o040000;
const isFile = attrs => typeof attrs?.isFile === 'function' ? attrs.isFile() : (attrs?.mode & 0o170000) === 0o100000;

class SftpSession {
  constructor(settings, root) {
    this.settings = settings;
    this.root = root;
    this.pending = new Set();
    this.closed = false;
    this.failure = null;
  }
  publicError(error) {
    if (error instanceof SftpError) return error;
    if (this.keyMismatch) return new SftpError('SFTP_HOST_KEY', 'A chave do servidor SFTP mudou ou não corresponde à configuração. Confira o servidor e sftp.hostFingerprint.');
    if (error?.level === 'client-authentication') return new SftpError('SFTP_AUTH', 'O servidor SFTP recusou a autenticação. Confira usuário, senha ou chave em config.json.');
    if (/private.?key|passphrase|decrypt/i.test(error?.message || '')) return new SftpError('SFTP_PRIVATE_KEY', 'Não foi possível usar a chave SSH. Confira o arquivo privado e a passphrase em config.json.');
    return new SftpError('SFTP_CONNECTION', 'Não foi possível acessar o SFTP. Confira endereço, porta e conexão; tente Recarregar dados.');
  }
  async connect() {
    const s = this.settings;
    const hostId = crypto.createHash('sha256').update(s.host.toLowerCase() + ':' + s.port).digest('hex');
    const knownFile = path.join(this.root, 'data', 'sftp-host-keys', hostId + '.json');
    let known = null;
    try { known = JSON.parse(await fs.readFile(knownFile, 'utf8')).fingerprint; }
    catch (error) { if (error.code !== 'ENOENT') throw new SftpError('SFTP_HOST_FILE', 'Não foi possível ler a identidade SFTP registrada em data/sftp-host-keys.'); }
    const expected = s.hostFingerprint || known;
    let fingerprint;
    let privateKey;
    if (s.privateKeyPath) {
      try { privateKey = await fs.readFile(s.privateKeyPath); }
      catch { throw new SftpError('SFTP_PRIVATE_KEY', 'Não foi possível ler o arquivo definido em sftp.privateKeyPath.'); }
    }
    this.conn = new Client();
    const ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      this.conn.on('error', error => this.abort(this.publicError(error)));
      this.conn.on('close', () => {
        this.closed = true;
        if (!this.closing) this.abort(new SftpError('SFTP_CLOSED', 'A conexão SFTP foi interrompida. A última leitura válida foi preservada.'));
      });
      this.conn.once('ready', () => { this.conn.setNoDelay(true);resolve(); });
    });
    try {
      this.conn.connect({ host: s.host, port: s.port, username: s.username,
        ...(s.password ? { password: s.password } : {}), ...(privateKey ? { privateKey, passphrase: s.passphrase || undefined } : {}),
        readyTimeout: s.timeoutSeconds * 1000, keepaliveInterval: 10000, keepaliveCountMax: 2,
        hostVerifier: raw => {
          fingerprint = 'SHA256:' + crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
          this.keyMismatch = Boolean(expected && expected.replace(/=+$/, '') !== fingerprint);
          return !this.keyMismatch;
        }
      });
    } catch (error) { this.abort(this.publicError(error)); }
    await ready;
    this.fingerprint = fingerprint;
    this.rejectReady = null;
    if (!known && !s.hostFingerprint) {
      try {
        await fs.mkdir(path.dirname(knownFile), { recursive: true, mode: 0o700 });
        await fs.writeFile(knownFile, JSON.stringify({ fingerprint }) + '\n', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw new SftpError('SFTP_HOST_FILE', 'Não foi possível registrar a identidade SFTP em data/sftp-host-keys.');
        const stored = JSON.parse(await fs.readFile(knownFile, 'utf8'));
        if (stored.fingerprint !== fingerprint) throw new SftpError('SFTP_HOST_KEY', 'A identidade SFTP registrada mudou durante a conexão.');
      }
    }
    this.sftp = await this.callOn(this.conn, 'sftp', []);
    return this;
  }
  abort(error) {
    this.failure ||= error;
    this.rejectReady?.(this.failure);
    for (const fail of [...this.pending]) fail(this.failure);
    this.conn?.destroy();
  }
  callOn(target, method, args) {
    if (this.failure || this.closed) return Promise.reject(this.failure || new SftpError('SFTP_CLOSED', 'A conexão SFTP está fechada.'));
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer); this.pending.delete(fail);
        if (error) reject(error); else resolve(value);
      };
      const fail = error => finish(error);
      const timer = setTimeout(() => this.abort(new SftpError('SFTP_TIMEOUT', 'O SFTP demorou a responder. A última leitura válida foi preservada.')), this.settings.timeoutSeconds * 1000);
      this.pending.add(fail);
      try { target[method](...args, finish); } catch (error) { finish(this.publicError(error)); }
    });
  }
  async stat(remote) {
    try { return await this.callOn(this.sftp, 'lstat', [remote]); }
    catch (error) { if (isMissing(error)) return null; throw this.publicError(error); }
  }
  async list(remote, optional = false) {
    try { return await this.callOn(this.sftp, 'readdir', [remote]); }
    catch (error) { if (optional && isMissing(error)) return []; throw this.publicError(error); }
  }
  async readStable(remote, before) {
    const max = this.settings.maxFileSizeMB * 1024 * 1024;
    if (!isFile(before) || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > max)
      throw new SftpError('SFTP_FILE_SIZE', 'Um arquivo do mundo não pôde ser lido ou excedeu sftp.maxFileSizeMB.');
    const handle = await this.callOn(this.sftp, 'open', [remote, 'r']);
    try {
      const chunks = []; let offset = 0;
      while (offset < before.size) {
        const buffer = Buffer.allocUnsafe(Math.min(65536, before.size - offset));
        const bytes = await this.callOn(this.sftp, 'read', [handle, buffer, 0, buffer.length, offset]);
        if (!Number.isInteger(bytes) || bytes <= 0 || bytes > buffer.length) throw new SftpError('SFTP_CHANGED', 'Um arquivo do Minecraft mudou durante a leitura. Tente novamente após o jogo salvar.');
        chunks.push(buffer.subarray(0, bytes)); offset += bytes;
      }
      const after = await this.stat(remote);
      if (!after || after.size !== before.size || after.mtime !== before.mtime)
        throw new SftpError('SFTP_CHANGED', 'Um arquivo do Minecraft mudou durante a leitura. Tente novamente após o jogo salvar.');
      return Buffer.concat(chunks, offset);
    } finally { if (!this.failure && !this.closed) await this.callOn(this.sftp, 'close', [handle]); }
  }
  async close() {
    if (!this.conn || this.closed) return;
    this.closing = true;
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.conn.destroy(); resolve(); }, 500);
      this.conn.once('close', () => { clearTimeout(timer); resolve(); }); this.conn.end();
    });
  }
}
module.exports = { SftpSession, SftpError, isDirectory, isFile };
