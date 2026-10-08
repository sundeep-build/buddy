// Ready-made reminders offered in Settings. A reminder's question and replies are
// what the buddy says; "{count}" in yesReply becomes today's number of yes answers.
const DEFAULT_REPLIES = {
  yes: 'Yay! Well done 🎉',
  no: "Oh no… 😢 Please don't skip it, okay?",
};

const PRESETS = [
  {
    key: 'water',
    name: 'Water',
    emoji: '💧',
    prop: 'bottle', // the buddy carries a 3D bottle instead of the emoji
    question: 'Hey! Time for some water 💧 Did you drink any?',
    yesReply: "Yay! That's glass #{count} today 🎉",
    noReply: 'Oh no… 😢 Please take a sip soon, okay?',
    schedule: { type: 'interval', minutes: 30 },
  },
  {
    key: 'lunch',
    name: 'Lunch',
    emoji: '🍛',
    question: "Hey! It's lunch time 🍛 Did you eat?",
    yesReply: 'Yay! Glad you ate 🎉',
    noReply: 'Oh no… 😢 Please go and eat soon, okay?',
    schedule: { type: 'daily', time: '13:00' },
  },
  {
    key: 'stretch',
    name: 'Stretch',
    emoji: '🧘',
    question: 'Hey! Time to stand up and stretch 🧘 Did you move a bit?',
    yesReply: 'Yay! Your back says thanks 🎉',
    noReply: 'Oh no… 😢 Please stand up for a minute, okay?',
    schedule: { type: 'interval', minutes: 60 },
  },
  {
    key: 'eyes',
    name: 'Eye break',
    emoji: '👀',
    question: 'Hey! Look away from the screen for 20 seconds 👀 Done?',
    yesReply: 'Yay! Your eyes say thanks 🎉',
    noReply: 'Oh no… 😢 Please rest your eyes soon, okay?',
    schedule: { type: 'interval', minutes: 20 },
  },
  {
    key: 'medicine',
    name: 'Medicine',
    emoji: '💊',
    question: 'Hey! Time for your medicine 💊 Did you take it?',
    yesReply: 'Yay! Well done 🎉',
    noReply: 'Oh no… 😢 Please take it soon, okay?',
    schedule: { type: 'daily', time: '09:00' },
  },
];

// What a fresh install starts with.
const DEFAULT_REMINDERS = ['water', 'lunch'].map((key) => {
  const { key: id, ...preset } = PRESETS.find((p) => p.key === key);
  return { id, ...preset, prop: preset.prop ?? 'emoji', enabled: true };
});

module.exports = { PRESETS, DEFAULT_REMINDERS, DEFAULT_REPLIES };
