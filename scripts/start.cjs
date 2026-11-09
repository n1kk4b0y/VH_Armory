const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { readConfig } = require('../src/config');
const root = path.resolve(__dirname, '..');

function browserUrl(settings) {
  let host = ['0.0.0.0', '::'].includes(settings.host) ? '127.0.0.1' : settings.host;
  if (host.includes(':')) host = '[' + host + ']';
  return `http://${host}:${settings.port}`;
}
function openBrowser(url) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Abra ${url} no navegador.`));child.unref();
}
function dependenciesPresent() {
  try {
    const wanted = require('../package.json').dependencies;
    for (const name of ['express','cors','prismarine-nbt','ssh2']) {
      const file = require.resolve(name + '/package.json', {paths:[root]});
      // A copied old node_modules must not suppress installation of the new SFTP client.
      if (name === 'ssh2' && JSON.parse(fs.readFileSync(file,'utf8')).version !== wanted[name]) return false;
    }
    return true;
  } catch { return false; }
}
async function start({ open = openBrowser } = {}) {
  const config = readConfig({root});
  if (!dependenciesPresent()) {
    console.log('Preparando o site na primeira execução. Aguarde a instalação das dependências...');
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args = process.platform === 'win32' ? ['/d','/s','/c','npm ci --omit=dev --omit=optional'] : ['ci','--omit=dev','--omit=optional'];
    const installed = spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false});
    if (installed.error || installed.status !== 0) throw new Error('Não foi possível instalar as dependências. Confira a internet e a instalação do Node.js.');
  }
  const { createApp } = require('../src/server');
  const app = createApp({projectRoot:root});
  const server = app.listen(config.web.port,config.web.host);
  server.once('close',app.locals.dispose);
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const url = browserUrl(config.web);
  console.log(`VH Armory aberto em ${url}`);
  console.log('Edite config.json e clique em Recarregar dados para aplicar a origem.');
  console.log('Mantenha esta janela aberta enquanto usar o site; pode minimizá-la.');
  app.locals.reload().catch(error=>console.error(error.message));
  if (config.web.openBrowser) open(url);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{app.locals.dispose();server.close(()=>process.exit(0));});
  return {app,server,url};
}
if (require.main === module) start().catch(error=>{
  console.error(error.code==='EADDRINUSE'?'A porta já está ocupada. Feche a outra janela do site ou altere web.port em config.json.':error.message);
  process.exitCode=1;
});
module.exports = { start, browserUrl, dependenciesPresent };
