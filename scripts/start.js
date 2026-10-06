// Starts the app from source on any OS.
// Editors built on Electron (VS Code, for one) set ELECTRON_RUN_AS_NODE in the shells
// they spawn, which would make Electron start as plain Node instead of opening the app.
const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(require('electron'), [path.join(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env });
app.on('exit', (code) => process.exit(code ?? 0));
