const esbuild = require('./node_modules/esbuild');
esbuild.build({
    bundle: true,
    platform: 'node',
    external: ['obsidian'],
    format: 'cjs',
    mainFields: ['browser', 'module', 'main'],
    entryPoints: ['src/publish.ts'],
    outfile: 'main.js'
}).then(() => console.log('Build OK')).catch(e => { console.error(e); process.exit(1); });
