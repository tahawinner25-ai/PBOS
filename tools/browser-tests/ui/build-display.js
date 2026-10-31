const esbuild = require('esbuild');
const path = require('path');
const here = __dirname, src = path.resolve(__dirname, '../../../src');
esbuild.build({
  entryPoints: [path.join(here, 'display-entry.tsx')], bundle: true, outfile: path.join(here, '.out', 'display-bundle.js'), format: 'iife', nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), jsx: 'automatic', target: 'es2020',
define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
  plugins: [{ name: 'alias', setup(b) {
    const to = (re, f) => b.onResolve({ filter: re }, () => ({ path: f }));
    to(/^@\/actions\/studio$/, path.join(here, 'mock-studio.ts'));
    to(/^@\/actions\/publish$/, path.join(here, 'mock-publish.ts'));
    to(/^lucide-react$/, path.join(here, 'lucide-shim.tsx'));
    to(/^@radix-ui\/react-slot$/, path.join(here, 'slot-shim.tsx'));
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(src, a.path.slice(2));
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (require('fs').existsSync(base + ext)) return { path: base + ext };
      return { errors: [{ text: 'cannot resolve ' + a.path }] };
    });
  } }],
}).then(() => console.log('bundled')).catch(() => process.exit(1));

// The inline script the page head uses, compiled from the same source the app uses.
esbuild.build({ entryPoints: [path.join(src, 'lib', 'display-prefs.ts')], bundle: true, format: 'cjs', write: false, logLevel: 'warning' }).then((r) => {
  const m = { exports: {} };
  new Function('module', 'exports', r.outputFiles[0].text)(m, m.exports);
  require('fs').writeFileSync(path.join(here, '.out', 'init-script.js'), m.exports.DISPLAY_INIT_SCRIPT);
});
