const esbuild = require('esbuild');
const path = require('path');
esbuild.build({ entryPoints: [path.join(__dirname, 'entry.ts')], bundle: true, outfile: path.join(__dirname, '.out', 'bundle.js'), format: 'iife', target: 'es2020', logLevel: 'warning' })
  .then(() => console.log('bundled')).catch(() => process.exit(1));
