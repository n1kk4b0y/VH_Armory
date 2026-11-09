const path = require('path');
const modules = process.env.VH_3D_NODE_MODULES;
const esbuild = modules ? require(path.join(modules,'esbuild')) : require('esbuild');
esbuild.build({entryPoints:[path.join(__dirname,'viewer-entry.mjs')],bundle:true,minify:true,
  format:'iife',globalName:'VH3DLibrary',target:['es2020'],legalComments:'linked',
  nodePaths:modules ? [modules] : [],outfile:path.join(__dirname,'../public/vendor/vh3d.js')
}).catch(()=>process.exit(1));
