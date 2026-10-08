// Custom characters: reads the animation list out of a .glb file and guesses
// which clip suits each part of a visit.
const fs = require('fs');

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

// The parts of a visit a clip can be assigned to.
const ROLES = ['walk', 'idle', 'greet', 'happy', 'sad'];

// Name patterns per role, best match first.
const HINTS = {
  walk: [/^walk(ing)?$/i, /walk/i, /jog|run/i],
  idle: [/^idle$/i, /idle|stand|breath/i],
  greet: [/wave|waving|hello|greet/i],
  happy: [/danc/i, /cheer|victory|celebrat|happy|clap|joy/i, /jump|thumb|agree|^yes$/i],
  sad: [/sad|defeat|disappoint|cry/i, /^no$|shake|shaking/i],
};

// Returns the names of the animation clips in a .glb, named the way three.js names them.
function inspectGlb(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    if (fs.readSync(fd, header, 0, 20, 0) < 20 || header.readUInt32LE(0) !== GLB_MAGIC) {
      throw new Error('This is not a .glb file.');
    }
    if (header.readUInt32LE(4) !== 2 || header.readUInt32LE(16) !== JSON_CHUNK) {
      throw new Error('Only glTF 2.0 .glb files are supported.');
    }
    const json = Buffer.alloc(header.readUInt32LE(12));
    fs.readSync(fd, json, 0, json.length, 20);
    let gltf;
    try {
      gltf = JSON.parse(json.toString('utf8'));
    } catch {
      throw new Error('This .glb file is damaged and could not be read.');
    }
    return { clips: (gltf.animations || []).map((animation, index) => animation.name || `animation_${index}`) };
  } finally {
    fs.closeSync(fd);
  }
}

function guessRoles(clips) {
  const roles = {};
  for (const role of ROLES) {
    roles[role] = null;
    for (const pattern of HINTS[role]) {
      const match = clips.find((clip) => pattern.test(clip));
      if (match) {
        roles[role] = match;
        break;
      }
    }
  }
  return roles;
}

module.exports = { ROLES, inspectGlb, guessRoles };
