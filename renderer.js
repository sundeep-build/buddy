// Water Buddy — overlay renderer.
// Draws the 3D buddy and plays one "visit": walk in, ask the reminder's question,
// react to the answer, walk off again.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const CHAR_HEIGHT = 250; // px
const GROUND_Y = 30; // px between the bottom of the window and the buddy's feet
const ANSWER_TIMEOUT = 45; // seconds the buddy waits for a click before giving up
const MAX_CLIP_SECONDS = 4; // a one-shot clip is cut short after this, so a long clip can't stall a visit
const TILT = 0.16; // look at the buddy slightly from above, so it reads as 3D
const FACE_FRONT = 0;
const FACE_RIGHT = Math.PI / 2;
const FACE_LEFT = -Math.PI / 2;

// How a character plays each part of a visit. The built-in robot is described here;
// a custom character gets the same shape from the clips picked in Settings.
// Any clip may be missing: the buddy then hops, spins or leans instead.
const ROBOT = {
  url: 'assets/RobotExpressive.glb',
  walk: 'Walking',
  idle: 'Idle',
  greet: 'Wave',
  happy: [{ clip: 'ThumbsUp' }, { clip: 'Jump' }, { clip: 'Dance', seconds: 2.2 }], // `seconds` loops the clip
  sad: 'No',
  stride: 0.68, // walking speed in body heights per second; matches the Walking clip so the feet don't slide
  head: 'Head',
  hand: 'Palm2L', // carries the prop (the other hand waves)
  // extra rotation about a bone's x axis, driven by a pose: [bone, pose, angle]
  overlays: [
    ['Head', 'sad', 0.45],
    ['Abdomen', 'sad', 0.18],
    ['UpperArmL', 'present', 0.7],
    ['LowerArmL', 'present', 1],
  ],
};

function customCharacter({ roles, yaw }) {
  return {
    walk: roles.walk,
    idle: roles.idle,
    greet: roles.greet,
    happy: roles.happy ? [{ clip: roles.happy, seconds: 3 }] : [],
    sad: roles.sad,
    stride: 0.6,
    head: /head$/i,
    hand: /(left.?hand|l.?hand|hand.?l(eft)?)$/i,
    overlays: [],
    yaw: THREE.MathUtils.degToRad(yaw || 0),
  };
}

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleActions = document.getElementById('bubble-actions');
const yesButton = document.getElementById('yes');
const noButton = document.getElementById('no');
const fx = document.getElementById('fx');

// --- scene -----------------------------------------------------------------
// The camera is orthographic with one world unit per CSS pixel, so the buddy's
// x position and the bubble's CSS position share the same coordinates.

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('stage'), alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 3));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(-300, 600, 500);
scene.add(sun);

const stage = new THREE.Group(); // the floor the buddy walks on
stage.position.y = GROUND_Y;
stage.rotation.x = TILT;
scene.add(stage);
const walker = new THREE.Group(); // moves left/right
stage.add(walker);
const bouncer = new THREE.Group(); // lifts off the floor for hops
walker.add(bouncer);
const turner = new THREE.Group(); // turns to face the walking direction or the user
bouncer.add(turner);
const leaner = new THREE.Group(); // tips forward when a character without sad bones is sad
turner.add(leaner);
walker.add(makeShadow());

// The thing the buddy carries: a 3D bottle, or the reminder's emoji.
const prop = new THREE.Group();
const bottle = makeBottle();
const emojiCanvas = document.createElement('canvas');
emojiCanvas.width = emojiCanvas.height = 128;
const emojiTexture = new THREE.CanvasTexture(emojiCanvas);
emojiTexture.colorSpace = THREE.SRGBColorSpace;
const emojiProp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture }));
emojiProp.scale.setScalar(CHAR_HEIGHT * 0.32);
emojiProp.position.set(0, CHAR_HEIGHT * 0.1, CHAR_HEIGHT * 0.1); // sits on top of the hand, in front of it
prop.add(bottle, emojiProp);
turner.add(prop);

let stageWidth = 0;
function resize(width, height) {
  stageWidth = width;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  camera.right = width;
  camera.top = height;
  camera.updateProjectionMatrix();
}

function makeShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(CHAR_HEIGHT * 0.8, CHAR_HEIGHT * 0.8),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  return shadow;
}

function makeBottle() {
  const group = new THREE.Group();
  const water = new THREE.MeshStandardMaterial({ color: 0x38a8ff, roughness: 0.2, transparent: true, opacity: 0.85 });
  const label = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x1565d8, roughness: 0.5 });
  const part = (radiusTop, radiusBottom, height, y, material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 24), material);
    mesh.position.y = y;
    group.add(mesh);
  };
  part(10, 10, 36, 18, water); // body
  part(10.5, 10.5, 12, 20, label);
  part(5, 10, 8, 40, water); // shoulder
  part(5.5, 5.5, 7, 47.5, cap);
  group.scale.setScalar((CHAR_HEIGHT * 0.27) / 51); // the parts above stack up to 51 units
  group.position.y = -CHAR_HEIGHT * 0.1; // held around its middle
  return group;
}

function setProp(reminder) {
  bottle.visible = reminder.prop === 'bottle';
  emojiProp.visible = !bottle.visible;
  if (!emojiProp.visible) return;
  const ctx = emojiCanvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(reminder.emoji, 64, 70);
  emojiTexture.needsUpdate = true;
}

// --- character ---------------------------------------------------------------

let character = null; // ROBOT or customCharacter()
let mixer = null;
let current = null; // the action that is playing
const actions = {};
let head = null;
let hand = null;
let height = CHAR_HEIGHT; // how tall the buddy actually stands, px
let flat = false; // a picture on a flat plane can't turn sideways, so it always faces the user
let headTop = 0; // px from the head bone up to the top of the head
const faces = []; // meshes with a "Sad" morph target

// Two poses are layered on top of whatever clip is playing: `sad` hangs the head
// and `present` holds the prop up. Each eases from 0 to 1 toward its target.
const pose = { sad: 0, present: 0 };
const poseTarget = { sad: 0, present: 0 };
const overlays = []; // { bone, pose, angle, applied }

function addCharacter(gltf, description) {
  const model = gltf.scene;
  model.rotation.y = description.yaw || 0;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0)) throw new Error('This model has nothing to show.');
  // Stand CHAR_HEIGHT tall, unless that would make a wide model enormous.
  const scale = Math.min(CHAR_HEIGHT / size.y, (CHAR_HEIGHT * 1.5) / Math.max(size.x, size.z));
  height = size.y * scale;
  flat = size.z < size.y * 0.02;
  model.scale.setScalar(scale);
  model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
  leaner.add(model);

  const bone = (name) => {
    let found = null;
    model.traverse((node) => {
      if (!found && node.isBone && (name instanceof RegExp ? name.test(node.name) : node.name === name)) found = node;
    });
    return found;
  };
  head = bone(description.head);
  hand = bone(description.hand);
  for (const [name, poseName, angle] of description.overlays) {
    overlays.push({ bone: bone(name), pose: poseName, angle, applied: new THREE.Quaternion() });
  }
  model.traverse((node) => {
    if (node.morphTargetDictionary && 'Sad' in node.morphTargetDictionary) faces.push(node);
  });

  scene.updateMatrixWorld(true);
  if (head) headTop = GROUND_Y + height - head.getWorldPosition(new THREE.Vector3()).y;

  mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  character = description;
}

async function loadCharacter() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath('node_modules/three/examples/jsm/libs/draco/gltf/'));

  const custom = await window.buddy.getCharacter();
  if (custom) {
    try {
      const { buffer, byteOffset, byteLength } = custom.data;
      const gltf = await loader.parseAsync(buffer.slice(byteOffset, byteOffset + byteLength), '');
      return addCharacter(gltf, customCharacter(custom));
    } catch (error) {
      window.buddy.characterFailed(error.message || String(error));
    }
  }
  addCharacter(await loader.loadAsync(ROBOT.url), ROBOT);
}

const ready = loadCharacter();

// Crossfades to a clip (or to no clip at all, if the character has none for this part).
// Looping clips resolve immediately; `once` clips resolve when they finish.
function play(name, { once = false, timeScale = 1, fade = 0.25 } = {}) {
  const next = actions[name] ?? null;
  if (next !== current) {
    if (current) current.fadeOut(fade);
    if (next) next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    current = next;
  }
  if (!next) return Promise.resolve();
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  next.clampWhenFinished = once;
  next.setEffectiveTimeScale(timeScale);
  if (!once) return Promise.resolve();
  return new Promise((resolve) => {
    let elapsed = 0;
    const finish = () => {
      mixer.removeEventListener('finished', onFinished);
      tasks.delete(timeLimit);
      resolve();
    };
    const onFinished = (event) => {
      if (event.action === next) finish();
    };
    const timeLimit = (dt) => {
      if ((elapsed += dt) >= MAX_CLIP_SECONDS) finish();
    };
    mixer.addEventListener('finished', onFinished);
    tasks.add(timeLimit);
  });
}

// --- frame loop --------------------------------------------------------------

const tasks = new Set(); // per-frame callbacks
let lastTime = 0;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const scratchV = new THREE.Vector3();

// Runs `step(dt)` every frame until it returns true.
function during(step) {
  return new Promise((resolve) => {
    const task = (dt) => {
      if (!step(dt)) return;
      tasks.delete(task);
      resolve();
    };
    tasks.add(task);
  });
}

function wait(seconds) {
  let elapsed = 0;
  return during((dt) => (elapsed += dt) >= seconds);
}

function walkTo(x, speed) {
  const bob = !character.walk; // no walk clip: bounce along instead
  let travelled = 0;
  return during((dt) => {
    const remaining = x - walker.position.x;
    const step = speed * dt;
    const arrived = Math.abs(remaining) <= step;
    walker.position.x = arrived ? x : walker.position.x + Math.sign(remaining) * step;
    travelled += step;
    if (bob) bouncer.position.y = arrived ? 0 : Math.abs(Math.sin((travelled / (height * 0.3)) * Math.PI)) * height * 0.06;
    return arrived;
  });
}

function turnTo(angle, seconds) {
  if (flat) return Promise.resolve();
  const from = turner.rotation.y;
  let elapsed = 0;
  return during((dt) => {
    const t = Math.min((elapsed += dt) / seconds, 1);
    turner.rotation.y = from + (angle - from) * (t * t * (3 - 2 * t));
    return t === 1;
  });
}

// Simple moves for characters that have no clip for a part of the visit.
function hop(count, lift, seconds, spin = 0) {
  const from = turner.rotation.y;
  let elapsed = 0;
  return during((dt) => {
    const t = Math.min((elapsed += dt) / seconds, 1);
    bouncer.position.y = Math.abs(Math.sin(t * Math.PI * count)) * height * lift;
    turner.rotation.y = from + spin * (t * t * (3 - 2 * t));
    return t === 1;
  });
}

function shakeHead(seconds) {
  const from = turner.rotation.y;
  let elapsed = 0;
  return during((dt) => {
    const t = Math.min((elapsed += dt) / seconds, 1);
    turner.rotation.y = from + Math.sin(t * Math.PI * 4) * 0.4 * (1 - t);
    return t === 1;
  });
}

function tick(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
  lastTime = time;

  for (const task of [...tasks]) task(dt);

  // Clips don't key every bone, so last frame's overlay rotation is removed
  // before the mixer runs and the new one is applied after it.
  for (const overlay of overlays) overlay.bone.quaternion.multiply(overlay.applied.invert());
  mixer.update(dt);
  for (const name in pose) pose[name] += (poseTarget[name] - pose[name]) * Math.min(1, dt * 4);
  for (const overlay of overlays) {
    overlay.applied.setFromAxisAngle(X_AXIS, overlay.angle * pose[overlay.pose]);
    overlay.bone.quaternion.multiply(overlay.applied);
  }
  for (const face of faces) face.morphTargetInfluences[face.morphTargetDictionary.Sad] = pose.sad;
  if (!overlays.length) leaner.rotation.x = pose.sad * 0.16;

  scene.updateMatrixWorld(true);
  placeProp();
  placeBubble(dt);
  renderer.render(scene, camera);
}

// The prop follows the hand but stays upright instead of rotating with the wrist.
// A character without a hand bone has it floating at its side.
function placeProp() {
  if (hand) {
    hand.getWorldPosition(scratchV);
    turner.worldToLocal(scratchV);
    prop.position.set(scratchV.x, scratchV.y, scratchV.z + CHAR_HEIGHT * 0.025);
  } else {
    prop.position.set(height * 0.42, height * (0.4 + 0.2 * pose.present), 0);
  }
}

// --- speech bubble -----------------------------------------------------------

let bubbleBottom = 0;
let reportedRect = '';

function say(text, { buttons = false } = {}) {
  bubbleText.textContent = text;
  bubbleActions.hidden = !buttons;
  bubble.classList.add('show');
}

function hush() {
  bubble.classList.remove('show');
}

function placeBubble(dt) {
  // Sits a little above the head, and lifts out of the way when the buddy jumps.
  const resting = GROUND_Y + height + 22;
  const clearHead = head
    ? head.getWorldPosition(scratchV).y + headTop + 10
    : resting + bouncer.position.y - 12;
  const target = Math.max(resting, clearHead);
  bubbleBottom += (target - bubbleBottom) * Math.min(1, dt * 12);

  const half = bubble.offsetWidth / 2 + 12;
  const x = Math.max(half, Math.min(walker.position.x, stageWidth - half));
  bubble.style.left = `${Math.round(x)}px`;
  bubble.style.bottom = `${Math.round(bubbleBottom)}px`;

  // Only a bubble with buttons needs to catch the mouse.
  let rect = null;
  if (bubble.classList.contains('show') && !bubbleActions.hidden) {
    const { x: left, y: top, width, height: tall } = bubble.getBoundingClientRect();
    rect = { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(tall) };
  }
  const key = JSON.stringify(rect);
  if (key !== reportedRect) {
    reportedRect = key;
    window.buddy.setHitRect(rect);
  }
}

function celebrate(emoji) {
  const sparkles = [emoji, '✨', '🎉', '💙'];
  for (let i = 0; i < 12; i++) {
    const sparkle = document.createElement('span');
    sparkle.textContent = sparkles[i % sparkles.length];
    sparkle.style.left = `${walker.position.x + (Math.random() - 0.5) * CHAR_HEIGHT}px`;
    sparkle.style.bottom = `${GROUND_Y + height * (0.3 + Math.random() * 0.5)}px`;
    sparkle.style.animationDelay = `${Math.random() * 0.8}s`;
    sparkle.addEventListener('animationend', () => sparkle.remove());
    fx.append(sparkle);
  }
}

// --- the visit ---------------------------------------------------------------

async function runVisit(reminder) {
  const offstage = CHAR_HEIGHT * 0.6;
  const spot = Math.max(200, Math.min(stageWidth * 0.3, stageWidth - 200));
  const speed = height * character.stride;

  mixer.stopAllAction();
  current = null;
  pose.sad = pose.present = poseTarget.sad = poseTarget.present = 0;
  bouncer.position.y = 0;
  walker.position.x = -offstage;
  turner.rotation.y = flat ? FACE_FRONT : FACE_RIGHT;
  setProp(reminder);

  play(character.walk ?? character.idle);
  await walkTo(spot, speed);
  play(character.idle);
  await turnTo(FACE_FRONT, 0.35);
  poseTarget.present = 1;
  await (character.greet ? play(character.greet, { once: true }) : hop(2, 0.08, 0.7));
  play(character.idle);

  say(reminder.question, { buttons: true });
  const clicked = new Promise((resolve) => {
    yesButton.onclick = () => resolve('yes');
    noButton.onclick = () => resolve('no');
  });
  const answer = await Promise.race([clicked, wait(ANSWER_TIMEOUT).then(() => 'ignored')]);

  if (answer === 'yes') {
    const count = await window.buddy.answeredYes(reminder.id);
    say(reminder.yesReply.replace('{count}', count));
    celebrate(reminder.emoji);
    if (!character.happy.length) await hop(3, 0.22, 1.6, Math.PI * 2);
    for (const [index, { clip, seconds }] of character.happy.entries()) {
      await play(clip, { once: !seconds });
      if (seconds) await wait(seconds);
      if (index === 0) poseTarget.present = 0; // the prop stays raised through the first cheer
    }
    poseTarget.present = 0;
    hush();
    play(character.walk ?? character.idle, { timeScale: 1.25 });
    await turnTo(FACE_RIGHT, 0.3);
    await walkTo(stageWidth + offstage, speed * 1.25);
  } else {
    poseTarget.sad = 1;
    poseTarget.present = 0;
    say(answer === 'no' ? reminder.noReply : "No answer… I'll check on you later 😔");
    await (character.sad ? play(character.sad, { once: true }) : shakeHead(1.4));
    play(character.idle);
    await wait(1.2);
    hush();
    // trudge back the way it came
    play(character.walk ?? character.idle, { timeScale: 0.5 });
    await turnTo(FACE_LEFT, 0.7);
    await walkTo(-offstage, speed * 0.5);
  }
  return answer;
}

let busy = false;
window.buddy.onVisit(async ({ stage: { width, height: stageHeight }, reminder }) => {
  if (busy) return;
  busy = true;
  let answer = 'ignored';
  try {
    await ready;
    resize(width, stageHeight);
    lastTime = 0;
    renderer.setAnimationLoop(tick);
    answer = await runVisit(reminder);
  } catch (error) {
    console.error(error);
  } finally {
    renderer.setAnimationLoop(null);
    tasks.clear();
    hush();
    window.buddy.setHitRect(null);
    reportedRect = '';
    busy = false;
    window.buddy.done(answer);
  }
});
