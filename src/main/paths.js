// Where things live on disk, so no other module has to count "../".
const { app } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

module.exports = {
  asset: (name) => path.join(ROOT, 'assets', name),
  preload: (name) => path.join(ROOT, 'src', 'preload', `${name}.js`),
  page: (name) => path.join(ROOT, 'src', 'renderer', name, 'index.html'),
  // Per-user files.
  stateFile: () => path.join(app.getPath('userData'), 'state.json'),
  characterFile: () => path.join(app.getPath('userData'), 'character.glb'),
};
