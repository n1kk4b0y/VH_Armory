const path = require('node:path');
const { readConfig } = require('../config');
const { LocalProvider } = require('./LocalProvider');
const { SftpMirror } = require('./SftpMirror');
const { SftpError } = require('./SftpSession');

class SourceManager {
  constructor(options = {}) {
    this.options = { ...options, root: options.root || path.resolve(__dirname, '../..') };
    this.current = null;
    this.lastConfig = null;
    this.state = 'idle';
    this.lastError = null;
    this.lastAttemptAt = null;
    this.lastSuccessAt = null;
  }
  settings() { return readConfig(this.options); }
  async prepare(options) {
    const config = this.settings();
    this.lastConfig = config;
    this.lastAttemptAt = new Date().toISOString();
    this.state = 'loading';
    const candidate = config.kind === 'sftp'
      ? await new SftpMirror(config, this.options).prepare(options)
      : { provider: new LocalProvider(config.local.worldPath, { instancePath: config.local.instancePath || undefined, env: this.options.env || process.env }) };
    return { ...candidate, config, sourceKey: config.sourceKey };
  }
  async commit(candidate) {
    await candidate.mirror?.commit();
    this.current = candidate;
    this.state = 'connected';
    this.lastError = null;
    this.lastSuccessAt = new Date().toISOString();
  }
  async fail(candidate, error, hasWorld) {
    await candidate?.mirror?.discard();
    const matches = !this.lastConfig || this.current?.sourceKey === this.lastConfig.sourceKey;
    const retained = Boolean(hasWorld && matches);
    this.state = retained ? 'stale' : 'error';
    this.lastError = error?.code === 'CONFIG_ERROR' || error instanceof SftpError ? error.message
      : 'Não foi possível atualizar os dados. Confira a pasta do mundo e tente Recarregar dados.';
    return retained;
  }
  status() {
    let config = this.lastConfig || this.current?.config;
    if (!config) {
      try { config = this.settings(); }
      catch (error) { return { kind: 'unknown', state: 'error', message: error.message, refreshSeconds: 0 }; }
    }
    const message = this.lastError || (config.kind === 'sftp' ? (this.state==='idle'?'Aguardando leitura SFTP':'Servidor SFTP conectado')
      : config.fallbackReason === 'incomplete' ? 'SFTP incompleto; usando pasta local' : 'Mundo local conectado');
    return { kind: config.kind, state: this.state, message, fallbackReason: config.fallbackReason,
      refreshSeconds: config.refreshSeconds, lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.current?.sourceKey === config.sourceKey ? this.lastSuccessAt : null,
      ...(this.current?.metrics && this.current.sourceKey === config.sourceKey ? { sync: this.current.metrics } : {}) };
  }
}
module.exports = { SourceManager };
