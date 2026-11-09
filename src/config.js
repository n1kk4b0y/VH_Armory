const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class ConfigError extends Error {
  constructor(message) { super(message); this.code = 'CONFIG_ERROR'; this.status = 503; }
}
const defaults = {
  local: { worldPath: 'data/world', instancePath: '' },
  sftp: { enabled: false, host: '', port: 22, username: '', password: '', remoteWorldPath: '', remoteInstancePath: '',
    privateKeyPath: '', passphrase: '', hostFingerprint: '', timeoutSeconds: 20, maxFileSizeMB: 256 },
  refreshSeconds: 60,
  web: { host: '127.0.0.1', port: 3000, openBrowser: true }
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigError(`${name} deve ser um número inteiro entre ${min} e ${max}.`);
  return value;
}
function string(value, name) {
  if (typeof value !== 'string' || value.includes('\0')) throw new ConfigError(`${name} deve ser um texto entre aspas.`);
  return value;
}
function parseConfig(input, { root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  if (!object(input)) throw new ConfigError('config.json deve conter um objeto JSON.');
  for (const key of ['local', 'sftp', 'web']) if (input[key] != null && !object(input[key])) throw new ConfigError(`${key} deve ser um objeto em config.json.`);
  const config = { local: { ...defaults.local, ...input.local }, sftp: { ...defaults.sftp, ...input.sftp },
    web: { ...defaults.web, ...input.web }, refreshSeconds: input.refreshSeconds ?? defaults.refreshSeconds };
  if (typeof config.sftp.enabled !== 'boolean') throw new ConfigError('sftp.enabled deve ser true ou false, sem aspas.');
  if (typeof config.web.openBrowser !== 'boolean') throw new ConfigError('web.openBrowser deve ser true ou false, sem aspas.');
  config.refreshSeconds = integer(config.refreshSeconds, 0, 86400, 'refreshSeconds');
  if (config.refreshSeconds > 0 && config.refreshSeconds < 5) throw new ConfigError('refreshSeconds deve ser 0 (manual) ou pelo menos 5.');
  config.local.worldPath = path.resolve(root, env.VH_WORLD_PATH?.trim() || string(config.local.worldPath, 'local.worldPath').trim() || defaults.local.worldPath);
  config.local.instancePath = string(config.local.instancePath, 'local.instancePath').trim();
  if (config.local.instancePath) config.local.instancePath = path.resolve(root, config.local.instancePath);
  config.web.host = string(config.web.host, 'web.host').trim() || defaults.web.host;
  config.web.port = integer(env.VH_PORT ? Number(env.VH_PORT) : config.web.port, 1, 65535, 'web.port');
  // Disabled settings are never passed to an SSH client or read as key files.
  let missing = [];
  if (config.sftp.enabled) {
    const s = config.sftp;
    for (const name of ['host', 'username', 'password', 'remoteWorldPath', 'remoteInstancePath', 'privateKeyPath', 'passphrase', 'hostFingerprint']) {
      s[name] = string(s[name], 'sftp.' + name);
      if (!['password', 'passphrase'].includes(name)) s[name] = s[name].trim();
    }
    missing = ['host', 'username', 'remoteWorldPath'].filter(name => !s[name]);
    if (!s.password.trim() && !s.privateKeyPath) missing.push('password ou privateKeyPath');
    if (!missing.length) {
      s.port = integer(s.port === '' ? 22 : s.port, 1, 65535, 'sftp.port');
      s.timeoutSeconds = integer(s.timeoutSeconds, 1, 300, 'sftp.timeoutSeconds');
      s.maxFileSizeMB = integer(s.maxFileSizeMB, 1, 2048, 'sftp.maxFileSizeMB');
      if (s.privateKeyPath) s.privateKeyPath = path.resolve(root, s.privateKeyPath);
      for (const name of ['remoteWorldPath', 'remoteInstancePath']) {
        if (s[name]) s[name] = path.posix.normalize(s[name].replace(/\\/g, '/'));
      }
      if (s.hostFingerprint && !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(s.hostFingerprint))
        throw new ConfigError('sftp.hostFingerprint deve estar vazio ou usar o formato SHA256:... fornecido pelo servidor.');
    }
  }
  const kind = config.sftp.enabled && !missing.length ? 'sftp' : 'local';
  const identity = kind === 'sftp'
    ? ['sftp', config.sftp.host.toLowerCase(), config.sftp.port, config.sftp.username, config.sftp.remoteWorldPath, config.sftp.remoteInstancePath, config.sftp.hostFingerprint]
    : ['local', config.local.worldPath, config.local.instancePath];
  return { ...config, kind, sourceKey: crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    fallbackReason: !config.sftp.enabled ? 'disabled' : missing.length ? 'incomplete' : null,
    missingFields: missing, root: path.resolve(root) };
}
function readConfig(options = {}) {
  const root = options.root || path.resolve(__dirname, '..');
  const file = options.configPath || path.join(root, 'config.json');
  let input = {};
  try { input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new ConfigError(error instanceof SyntaxError
      ? 'config.json contém JSON inválido. Confira aspas, vírgulas e true/false.'
      : 'Não foi possível ler config.json. Confira o arquivo e suas permissões.');
  }
  return parseConfig(input, { root, env: options.env || process.env });
}
module.exports = { defaults, readConfig, parseConfig, ConfigError };
