// Buddy — settings window.
// Shows the reminders and the character, and sends every change to the main process,
// which answers by pushing the new state back.

const ROLE_LABELS = { walk: 'Walking', idle: 'Standing', greet: 'Saying hello', happy: 'Happy', sad: 'Sad' };
const BLANK_REMINDER = { name: '', emoji: '⏰', question: '', schedule: { type: 'interval', minutes: 30 }, enabled: true };

const $ = (id) => document.getElementById(id);

let state = null;
let editing = null; // what the editor is showing: an existing reminder, or a draft of a new one
let pickError = null; // why the last chosen character file was rejected

// Falsy children are skipped, so `condition && el(…)` works in a child list.
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

function fill(node, ...children) {
  node.replaceChildren(...children.filter(Boolean));
}

// --- reminders ---------------------------------------------------------------

function scheduleText({ type, minutes, time }) {
  if (type === 'daily') {
    const [hours, mins] = time.split(':').map(Number);
    const at = new Date();
    at.setHours(hours, mins, 0, 0);
    return `Every day at ${clock(at)}`;
  }
  if (minutes === 1) return 'Every minute';
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function statusText(reminder) {
  if (state.visiting === reminder.id) return 'on screen now';
  if (!reminder.enabled) return 'off';
  if (state.paused) return 'paused';
  const at = new Date(reminder.nextAt);
  const tomorrow = at.getDate() !== new Date().getDate();
  return `next ${tomorrow ? 'tomorrow ' : ''}at ${clock(at)}`;
}

function reminderCard(reminder) {
  const details = [scheduleText(reminder.schedule), statusText(reminder)];
  if (reminder.doneToday) details.push(`${reminder.doneToday} done today`);

  const toggle = el('input', {
    type: 'checkbox',
    className: 'switch',
    checked: reminder.enabled,
    title: 'Turn this reminder on or off',
    onchange: () => window.settings.saveReminder({ ...reminder, enabled: toggle.checked }),
  });
  return el(
    'article',
    { className: `card reminder${reminder.enabled ? '' : ' off'}` },
    el('div', { className: 'emoji', textContent: reminder.emoji }),
    el(
      'div',
      { className: 'grow' },
      el('h3', { textContent: reminder.name }),
      el('p', { className: 'muted', textContent: details.join(' · ') }),
    ),
    el(
      'div',
      { className: 'card-actions' },
      el('button', {
        textContent: 'Remind me now',
        disabled: Boolean(state.visiting),
        onclick: () => window.settings.remindNow(reminder.id),
      }),
      el('button', { textContent: 'Edit', onclick: () => openEditor(reminder) }),
      toggle,
    ),
  );
}

// --- reminder editor ---------------------------------------------------------

function fillEditor(reminder) {
  editing = reminder;
  const daily = reminder.schedule.type === 'daily';
  $('f-emoji').value = reminder.emoji;
  $('f-name').value = reminder.name;
  $('f-question').value = reminder.question;
  $('f-interval').checked = !daily;
  $('f-daily').checked = daily;
  $('f-minutes').value = daily ? 30 : reminder.schedule.minutes;
  $('f-time').value = daily ? reminder.schedule.time : '13:00';
  syncWhen();
}

// Only the chosen kind of schedule has to be filled in.
function syncWhen() {
  $('f-minutes').required = $('f-interval').checked;
  $('f-time').required = $('f-daily').checked;
}

function openEditor(reminder) {
  const isNew = !reminder;
  $('editor-title').textContent = isNew ? 'New reminder' : 'Edit reminder';
  $('delete').hidden = isNew;
  $('presets').hidden = !isNew;
  fill(
    $('presets'),
    ...state.presets.map(({ key, ...preset }) =>
      el('button', {
        type: 'button',
        textContent: `${preset.emoji} ${preset.name}`,
        onclick: () => fillEditor({ ...preset, enabled: true }),
      }),
    ),
  );
  fillEditor(reminder ?? BLANK_REMINDER);
  $('editor').showModal();
}

$('f-interval').onchange = syncWhen;
$('f-daily').onchange = syncWhen;
$('f-minutes').onfocus = () => {
  $('f-interval').checked = true;
  syncWhen();
};
$('f-time').onfocus = () => {
  $('f-daily').checked = true;
  syncWhen();
};

$('editor-form').onsubmit = async (event) => {
  event.preventDefault();
  await window.settings.saveReminder({
    ...editing,
    emoji: $('f-emoji').value,
    name: $('f-name').value,
    question: $('f-question').value,
    schedule: $('f-daily').checked
      ? { type: 'daily', time: $('f-time').value }
      : { type: 'interval', minutes: Number($('f-minutes').value) },
  });
  $('editor').close();
};

$('delete').onclick = async () => {
  await window.settings.deleteReminder(editing.id);
  $('editor').close();
};

$('cancel').onclick = () => $('editor').close();

// --- character ---------------------------------------------------------------

async function chooseCharacter() {
  pickError = await window.settings.chooseCharacter();
  render();
}

function saveCharacterOptions(change) {
  const { roles, yaw } = state.character;
  window.settings.setCharacterOptions({ roles: { ...roles, ...change.roles }, yaw: change.yaw ?? yaw });
}

function select(options, value, onchange) {
  const node = el('select', {}, ...options.map(([optionValue, label]) => el('option', { value: optionValue, textContent: label })));
  node.value = value;
  node.onchange = () => onchange(node.value);
  return node;
}

function characterOptions(character) {
  const clips = [['', 'No animation'], ...character.clips.map((clip) => [clip, clip])];
  return el(
    'div',
    { className: 'options' },
    ...state.roles.map((role) =>
      el(
        'label',
        { className: 'field' },
        el('span', { textContent: ROLE_LABELS[role] }),
        select(clips, character.roles[role] ?? '', (clip) => saveCharacterOptions({ roles: { [role]: clip || null } })),
      ),
    ),
    el(
      'label',
      { className: 'field' },
      el('span', { textContent: 'Turn the model' }),
      select(
        [0, 90, 180, 270].map((degrees) => [String(degrees), degrees ? `${degrees}°` : 'As it is']),
        String(character.yaw),
        (degrees) => saveCharacterOptions({ yaw: Number(degrees) }),
      ),
    ),
  );
}

function renderCharacter() {
  const character = state.character;
  let hint = 'Any 3D model saved as a .glb file works. If it has animations (walk, idle, wave, dance…), you can pick which one to use for each moment.';
  if (character) {
    hint = character.clips.length
      ? 'Pick which of the file\'s animations to use for each moment. With "No animation" the character hops, spins or leans instead. If it walks backwards or sideways, turn the model.'
      : 'This file has no animations, so the character hops along. If it faces the wrong way, turn the model.';
  }

  fill(
    $('character'),
    el(
      'div',
      { className: 'character-head' },
      el('div', { className: 'emoji', textContent: character ? '🧍' : '🤖' }),
      el(
        'div',
        { className: 'grow' },
        el('h3', { textContent: character ? character.name : 'Robot' }),
        el('p', { className: 'muted', textContent: character ? 'Your own character' : 'The built-in character' }),
      ),
      el(
        'div',
        { className: 'card-actions' },
        character && el('button', { textContent: 'Use the robot', onclick: () => window.settings.resetCharacter() }),
        el('button', {
          className: character ? '' : 'primary',
          textContent: character ? 'Choose another file…' : 'Use my own character…',
          onclick: chooseCharacter,
        }),
      ),
    ),
    pickError && el('p', { className: 'error', textContent: pickError }),
    state.characterError &&
      el('p', {
        className: 'error',
        textContent: `This file could not be shown (${state.characterError}). The robot is standing in for now.`,
      }),
    character && characterOptions(character),
    el('p', { className: 'hint', textContent: hint }),
  );
}

// --- page --------------------------------------------------------------------

function render() {
  $('paused').checked = state.paused;
  fill(
    $('reminders'),
    ...state.reminders.map(reminderCard),
    !state.reminders.length && el('p', { className: 'empty', textContent: 'No reminders yet. Add one to get started.' }),
  );
  renderCharacter();
}

function show(next) {
  state = next;
  render();
}

$('add').onclick = () => openEditor(null);
$('paused').onchange = () => window.settings.setPaused($('paused').checked);
window.settings.onState(show);
window.settings.get().then(show);
