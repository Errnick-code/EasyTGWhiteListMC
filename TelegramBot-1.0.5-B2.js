require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Rcon } = require('rcon-client');
const fs = require('fs');
const path = require('path');

// ============================================================
//  НАСТРОЙКИ
// ============================================================
const TEST_MODE = 1; // 0 — основной бот, 1 — тестовый

const TOKENS = {
  main: process.env.TG_TOKEN_MAIN,
  test: process.env.TG_TOKEN_TEST
};

const chatId    = parseInt(process.env.TG_CHAT_ID);
const MAIN_ADMIN = process.env.MAIN_ADMIN_USERNAME;

const RATE_LIMIT = {
  applicationCooldown: 5 * 60 * 1000,
  reportCooldown:      2 * 60 * 1000,
  ticketCooldown:      3 * 60 * 1000
};

const NICK_CHANGE_COOLDOWN = 30 * 60 * 1000;

// ============================================================
//  RCON
// ============================================================
const rconConfig = {
  host:     process.env.RCON_HOST,
  port:     parseInt(process.env.RCON_PORT),
  password: process.env.RCON_PASSWORD
};

async function sendRconCommand(cmd) {
  let rcon;
  try {
    rcon = new Rcon(rconConfig);
    await rcon.connect();
    const resp = await rcon.send(cmd);
    await rcon.end();
    return resp;
  } catch (err) {
    console.error('RCON:', err);
    if (rcon) { try { await rcon.end(); } catch {} }
    return null;
  }
}

async function addToWhitelist(nick, type) {
  const cmd = type.toLowerCase().includes('пират') ? `easywhitelist add ${nick}` : `whitelist add ${nick}`;
  return sendRconCommand(cmd);
}

// ============================================================
//  ФАЙЛЫ / ПАПКИ
// ============================================================
const BOT_FOLDER   = path.join(__dirname, 'BotFile');
if (!fs.existsSync(BOT_FOLDER)) fs.mkdirSync(BOT_FOLDER);

const ADMIN_FILE   = path.join(BOT_FOLDER, 'admins.json');
const USERS_FILE   = path.join(BOT_FOLDER, 'users.json');
const CODES_FILE   = path.join(BOT_FOLDER, 'promocodes.json');
const DONATES_FILE = path.join(BOT_FOLDER, 'donates.json');

for (const [f, d] of [
  [ADMIN_FILE,   JSON.stringify([MAIN_ADMIN], null, 2)],
  [USERS_FILE,   JSON.stringify({}, null, 2)],
  [CODES_FILE,   JSON.stringify({}, null, 2)],
  [DONATES_FILE, JSON.stringify({}, null, 2)]
]) { if (!fs.existsSync(f)) fs.writeFileSync(f, d); }

let admins = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));

// ============================================================
//  JSON HELPERS
// ============================================================
function loadJSON(file, fallback = {}) {
  try {
    const d = fs.readFileSync(file, 'utf8');
    if (!d || !d.trim()) { saveJSON(file, fallback); return fallback; }
    return JSON.parse(d);
  } catch {
    saveJSON(file, fallback);
    return fallback;
  }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error(e); }
}
const loadUsers   = () => loadJSON(USERS_FILE);
const saveUsers   = d  => saveJSON(USERS_FILE, d);
const loadCodes   = () => loadJSON(CODES_FILE);
const saveCodes   = d  => saveJSON(CODES_FILE, d);
const loadDonates = () => loadJSON(DONATES_FILE);
const saveDonates = d  => saveJSON(DONATES_FILE, d);

// ============================================================
//  MINECRAFT ЦВЕТА
// ============================================================
const MINECRAFT_COLORS = {
  'черный':          { code: '&0', name: 'Черный' },
  'темно-синий':     { code: '&1', name: 'Темно-синий' },
  'темно-зеленый':   { code: '&2', name: 'Темно-зеленый' },
  'темно-бирюзовый': { code: '&3', name: 'Темно-бирюзовый' },
  'темно-красный':   { code: '&4', name: 'Темно-красный' },
  'фиолетовый':      { code: '&5', name: 'Фиолетовый' },
  'золотой':         { code: '&6', name: 'Золотой' },
  'серый':           { code: '&7', name: 'Серый' },
  'темно-серый':     { code: '&8', name: 'Темно-серый' },
  'синий':           { code: '&9', name: 'Синий' },
  'зеленый':         { code: '&a', name: 'Зеленый' },
  'бирюзовый':       { code: '&b', name: 'Бирюзовый' },
  'красный':         { code: '&c', name: 'Красный' },
  'розовый':         { code: '&d', name: 'Розовый' },
  'желтый':          { code: '&e', name: 'Желтый' },
  'белый':           { code: '&f', name: 'Белый' }
};

const DONATE_TYPE_NAMES = {
  'подписка1':  'Подписка "Плюс" 1 мес.',
  'подписка3':  'Подписка "Плюс" 3 мес.',
  'подписка6':  'Подписка "Плюс" 6 мес.',
  'префикс':    '1 смена префикса',
  'префикс5':   '5 смен префикса',
  'префикс10':  '10 смен префикса',
  'ник':         '1 смена ника',
  'ник5':        '5 смен ника',
  'ник10':       '10 смен ника'
};
for (const [k, v] of Object.entries(MINECRAFT_COLORS))
  DONATE_TYPE_NAMES[`цвет_${k}`] = `Цвет ника: ${v.name}`;

const DONATE_PRICES = {
  nickChanges:   { 1: 350, 5: 1500, 10: 2800 },
  prefixChanges: { 1: 250, 5: 1100, 10: 2000 }
};

function calcPrice(type, data) {
  if (type === 'подписка') {
    const m = data.months || 1;
    const base = 250 * m;
    const disc = m >= 6 ? 0.10 : m >= 3 ? 0.05 : 0;
    return Math.round(base * (1 - disc));
  }
  if (type === 'цвета')   return (data.colors ? data.colors.length : 0) * 150;
  if (type === 'ник')     return DONATE_PRICES.nickChanges[data.count] || 350;
  if (type === 'префикс') return DONATE_PRICES.prefixChanges[data.count] || 250;
  return 0;
}

// ============================================================
//  ВАЛИДАЦИЯ ЦВЕТОВЫХ КОДОВ
// ============================================================
const VALID_CC = ['0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f','k','l','m','n','o','r'];

function validateColorCodes(text) {
  const amps = text.match(/&[^\s&#]/g) || [];
  for (const c of amps)
    if (!VALID_CC.includes(c[1].toLowerCase()))
      return { valid: false, message: `❌ Неверный код: <code>${c}</code>\nДопустимые: &0-9, &a-f, &k-o, &r\nHEX: &#RRGGBB` };
  const bad = text.match(/&#[0-9A-Fa-f]{1,5}(?:[^0-9A-Fa-f]|$)/g);
  if (bad) return { valid: false, message: `❌ Неполный HEX. Формат: &#RRGGBB` };
  return { valid: true };
}

function stripCC(text) {
  return text.replace(/&#[0-9A-Fa-f]{6}/g, '').replace(/&[0-9a-fk-or]/gi, '');
}

function checkNickDup(newNick, curNick, users) {
  const nc = stripCC(newNick).toLowerCase();
  const cc = stripCC(curNick).toLowerCase();
  for (const [ex] of Object.entries(users)) {
    if (stripCC(ex).toLowerCase() === cc) continue;
    if (stripCC(ex).toLowerCase() === nc) return { isDuplicate: true, duplicateWith: ex };
  }
  return { isDuplicate: false };
}

// ============================================================
//  ФИЛЬТР НИКОВ
// ============================================================
const blacklistWords = [
  { word:'admin', category:'impersonation' }, { word:'moderator', category:'impersonation' },
  { word:'nigga', category:'insult' },        { word:'nigger', category:'insult' },
  { word:'fuck', category:'insult' },         { word:'ziga', category:'insult' },
  { word:'zigga', category:'insult' }
];

function normNick(n) {
  return String(n||'').toLowerCase()
    .replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e')
    .replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t')
    .replace(/_/g,'').replace(/(.)\1+/g,'$1');
}
function trigrams(s) {
  const r=[]; for(let i=0;i<s.length-2;i++) r.push(s.slice(i,i+3)); return r;
}
function triSim(a, b) {
  const t1=trigrams(a), t2=trigrams(b);
  if(!t1.length||!t2.length) return 0;
  let m=0;
  outer: for(const g1 of t1) { for(const g2 of t2) { if(g1===g2){m++;continue outer;} } }
  return m/Math.max(t1.length,t2.length);
}
function filterNick(nick, users) {
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(nick))
    return { status:'blacklist', reason:'Недопустимый формат', category:'format', similarity:100 };
  const n = normNick(nick);
  let maxS=0, reason='', cat='';
  for (const bad of blacklistWords) {
    const bn = normNick(bad.word);
    if (bn.length < 3) { if(n.includes(bn)) return {status:'blacklist',reason:`Запрещённое слово: ${bad.word}`,category:bad.category,similarity:100}; continue; }
    const s = triSim(n, bn);
    if (s > maxS) { maxS=s; reason=`Похож на: ${bad.word}`; cat=bad.category; }
  }
  const pct = Math.round(maxS*100);
  if (pct > 75) return {status:'blacklist',reason,category:cat,similarity:pct};
  if (pct >= 50) return {status:'suspicious',reason,category:cat,similarity:pct};
  for (const ex of Object.keys(users||{})) {
    const en = normNick(ex);
    if (n===en || triSim(n,en)>0.75) return {status:'suspicious',reason:`Похож на: ${ex}`,category:'clone',similarity:100};
  }
  return {status:'normal',similarity:0};
}

// ============================================================
//  ГЕНЕРАЦИЯ КОДОВ
// ============================================================
function genPromoCode(type) {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  const pfxMap = {
    'подписка1':'PLUS1M','подписка3':'PLUS3M','подписка6':'PLUS6M',
    'префикс':'PREFIX','префикс5':'PREFIX5','префикс10':'PREFIX10',
    'ник':'NICK','ник5':'NICK5','ник10':'NICK10'
  };
  if (type && type.startsWith('цвет_')) {
    const short = type.replace('цвет_','').substring(0,3).toUpperCase();
    return `CLR-${short}-${rand}`;
  }
  const p = pfxMap[type] || 'PROMO';
  return `${p}-${rand}`;
}

function genLinkCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================
//  RATE LIMIT
// ============================================================
const userCooldowns = new Map();
const nickChangeCDs = new Map();

function checkCooldown(userId, type) {
  const now  = Date.now();
  const cd   = userCooldowns.get(userId) || {};
  const last = cd[type] || 0;
  const lim  = RATE_LIMIT[`${type}Cooldown`];
  const diff = now - last;
  if (diff < lim) return { ok: false, remainingSec: Math.ceil((lim - diff) / 1000) };
  cd[type] = now;
  userCooldowns.set(userId, cd);
  return { ok: true };
}

// ============================================================
//  ХЕЛПЕРЫ
// ============================================================
function escapeHTML(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function getMention(user, nick) {
  return `<a href="tg://user?id=${user.id}">${escapeHTML(nick || user.first_name || 'Игрок')}</a>`;
}
async function sendSafe(msg, text, opts) {
  opts = opts || {};
  try {
    const cid = msg.chat && msg.chat.id;
    const tid = msg.message_thread_id;
    if (tid) opts.message_thread_id = tid;
    try {
      return await bot.sendMessage(cid, text, Object.assign({ reply_to_message_id: msg.message_id }, opts));
    } catch (e) {
      if (e.response && e.response.body && e.response.body.description && e.response.body.description.includes('replied not found'))
        return bot.sendMessage(cid, text, opts);
      throw e;
    }
  } catch (e) { console.error('sendSafe:', e.message); }
}
async function safeAQ(id, opts) {
  try { await bot.answerCallbackQuery(id, opts || {}); } catch (e) { console.error('answerCQ:', e.message); }
}

// ============================================================
//  ХРАНИЛИЩА В ПАМЯТИ
// ============================================================
const applications = new Map();
const reports      = new Map();
const tickets      = new Map();
const tempState    = new Map();
const linkCodes    = new Map();
let nextReportId   = 1;
let nextTicketId   = 1;

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of tempState.entries())
    if (s.timestamp && now - s.timestamp > 15 * 60 * 1000) tempState.delete(k);
  for (const [k, d] of linkCodes.entries())
    if (now - d.timestamp > 5 * 60 * 1000) linkCodes.delete(k);
}, 5 * 60 * 1000);

// ============================================================
//  ЗАПУСК
// ============================================================
const token = TEST_MODE === 1 ? TOKENS.test : TOKENS.main;
const bot   = new TelegramBot(token, { polling: true });
bot.on('polling_error', console.error);
console.log(`Бот запущен (${TEST_MODE === 1 ? 'тестовый' : 'основной'})`);

const EC_PREFIXES = ['!EC', '!ЕС'];

// ============================================================
//  /start — приветствие из бота 1
// ============================================================
bot.onText(/^\/start$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  tempState.delete(msg.from.id);
  return bot.sendMessage(msg.chat.id,
    `🎮 <b>Добро пожаловать на сервер ERRNICRAFT!</b>\n\n` +
    `📌 <b>Важно:</b> это бот-помощник для управления аккаунтом и активации промокодов. Который ещё в разработке!!\n\n` +
    `<b>Чтобы играть:</b>\n` +
    `1. Скачайте Fabric 1.21.11 (0.18.4) и моды (подробности в <a href="${process.env.WIKI_LINK}">Wiki</a>).\n` +
    `2. Установите сборку через <a href="https://modrinth.com/app">Modrinth App</a>, <a href="https://git.astralium.su/didirus/AstralRinth/releases">AstralRinth</a> (для пиратки) или конвертируйте в zip на <a href="https://mrpacktozip.com/ru/#converter">mrpacktozip</a>.\n` +
    `3. Подайте заявку на вайтлист в закреплённой теме <a href="${process.env.TG_CHAT_LINK}">чата ERRNICRAFT</a>.\n` +
    `4. Подключайтесь: <code>${process.env.MC_SERVER_ADDRESS}</code>\n\n` +
    `❗️ Поддержка только для ПК с лицензионными лаунчерами или Legacy Launcher и AstralRinth для пиратки.\n\n` +
    `📢 <b>Ресурсы:</b>\n` +
    `🔹 <a href="${process.env.TG_CHAT_LINK}">Чат сервера</a>\n` +
    `🔹 <a href="${process.env.TG_CHANNEL_LINK}">ТГК сервера</a>\n` +
    `🔹 <a href="${process.env.WIKI_LINK}">Wiki сервера</a>\n\n` +
    `💎 <b>Команды бота:</b>\n` +
    `🔹 <code>/donate</code> — Список всех донатов\n` +
    `🔹 <code>/promo</code> — Активировать промокод\n` +
    `🔹 <code>/profile</code> — Мой профиль и донаты\n` +
    `🔹 <code>/help</code> — Все команды\n\n` +
    `Удачной игры! 🎮`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
});

// ============================================================
//  /help
// ============================================================
bot.onText(/^\/help$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const nick   = Object.keys(users).find(n => users[n] === userId);
  let t = nick ? `🎮 Ваш ник: <b>${escapeHTML(nick)}</b>\n\n` : `⚠️ Ник не привязан напиши заявку в чате\n\n`;
  t += `/link — привязать игровой ник\n/donate — донаты\n/promo — активировать промокод\n/profile — профиль\n`;
  t += `/nickcolor — сменить цвет ника\n/setprefix — установить префикс\n/setnick — сменить отображаемый ник\n`;
  if (admins.includes(msg.from.username)) {
    t += `\n👑 <b>Админ:</b>\n/admin — генерация промокодов\nгенерировать [тип] — промокод\nкоды — активные промокоды\n/addadmin / /removeadmin\n`;
  }
  return bot.sendMessage(msg.chat.id, t, { parse_mode: 'HTML' });
});

// ============================================================
//  /link
// ============================================================
bot.onText(/^\/link$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const cur    = Object.keys(users).find(n => users[n] === userId);
  if (cur) return bot.sendMessage(msg.chat.id,
    `⚠️ Вы уже привязаны: <b>${escapeHTML(cur)}</b>.\nОбратитесь к администратору.`,
    { parse_mode: 'HTML' }
  );
  tempState.set(userId, { action: 'link_nickname', timestamp: Date.now() });
  return bot.sendMessage(msg.chat.id, '🎮 Введите ваш игровой ник:');
});

// ============================================================
//  /profile — с кнопкой привязки если не привязан
// ============================================================
bot.onText(/^\/profile$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const entry  = Object.entries(users).find(([, id]) => id === userId);

  if (!entry) {
    return bot.sendMessage(msg.chat.id,
      '❌ Вы не зарегистрированы на сервере.\n\n💡 Привяжите игровой ник чтобы видеть профиль.',
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔗 Привязать ник', callback_data: 'do_link' }]] } }
    );
  }

  const [nick] = entry;
  const pd     = loadDonates()[nick];
  let t  = `👤 <b>Профиль игрока</b>\n\n`;
  t += `🎮 <b>Ник:</b> ${escapeHTML(nick)}\n`;
  t += `🆔 <b>Telegram ID:</b> <code>${userId}</code>\n\n`;
  t += `💎 <b>Мои донаты:</b>\n\n`;

  if (!pd) {
    t += `❌ Нет активных донатов.\n\n💡 Активируйте промокод: <code>/promo КОД</code>\n📋 <code>/donate</code>`;
  } else {
    if (pd.subscription && pd.subscription.active) {
      const until = new Date(pd.subscription.until);
      t += until > new Date()
        ? `✅ <b>Подписка "Плюс"</b>\n   До: ${until.toLocaleDateString('ru-RU')}\n\n`
        : `⌛ <b>Подписка "Плюс"</b> — истекла\n\n`;
    } else { t += `❌ Подписка "Плюс" — нет\n\n`; }
    if (pd.colors && pd.colors.length) {
      t += `🎨 <b>Цвета:</b> ${pd.colors.map(c => MINECRAFT_COLORS[c] ? MINECRAFT_COLORS[c].name : c).join(', ')}\n💡 Сменить: <code>/nickcolor</code>\n\n`;
    } else { t += `🎨 <b>Цвета ника:</b> ❌ Нет\n\n`; }
    t += `🔰 <b>Кастомный префикс:</b> ${pd.prefix ? (typeof pd.prefix === 'number' ? `✅ Куплен (осталось: ${pd.prefix})` : '✅ Куплен') : '❌ Нет'}\n`;
    t += `📝 <b>Смена ника:</b> ${pd.customNick ? (typeof pd.customNick === 'number' ? `✅ Доступна (осталось: ${pd.customNick})` : '✅ Доступна') : '❌ Нет'}\n\n`;
    t += `📋 Все донаты: <code>/donate</code>`;
  }
  t += `\n\n⚡ <code>/promo</code> — промокод · <code>/nickcolor</code> — цвет`;
  return bot.sendMessage(msg.chat.id, t, { parse_mode: 'HTML' });
});

// ============================================================
//  /promo — активация промокода
// ============================================================
bot.onText(/^\/promo(?:\s+(.+))?$/, async (msg, match) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const code   = match[1] ? match[1].trim().toUpperCase() : null;

  if (!code) {
    const entry = Object.entries(users).find(([, id]) => id === userId);
    if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы. Подайте заявку на whitelist.');
    tempState.set(userId, { action: 'use_promo', timestamp: Date.now() });
    return bot.sendMessage(msg.chat.id, '🎁 Введите промокод:');
  }
  const entry = Object.entries(users).find(([, id]) => id === userId);
  if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы. Подайте заявку на whitelist.');
  return _activatePromo(msg.chat.id, userId, entry[0], code);
});

// ============================================================
//  /use — алиас /promo
// ============================================================
bot.onText(/^\/use$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const entry  = Object.entries(users).find(([, id]) => id === userId);
  if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы. Подайте заявку на whitelist.');
  tempState.set(userId, { action: 'use_promo', timestamp: Date.now() });
  return bot.sendMessage(msg.chat.id, '🎁 Введите промокод:');
});

// ============================================================
//  _activatePromo — логика активации (структура бота 1)
// ============================================================
async function _activatePromo(chatId_, userId, playerNick, code) {
  const codes    = loadCodes();
  const codeData = codes[code];

  if (!codeData) return bot.sendMessage(chatId_, '❌ Промокод не найден или недействителен.');
  if (codeData.status === 'used') return bot.sendMessage(chatId_, '❌ Этот промокод уже использован.');
  if (codeData.status === 'expired') return bot.sendMessage(chatId_, '❌ Срок действия промокода истёк.');
  if (codeData.expires && new Date() > new Date(codeData.expires)) {
    codeData.status = 'expired'; saveCodes(codes);
    return bot.sendMessage(chatId_, '❌ Срок действия промокода истёк.');
  }

  const donates = loadDonates();
  if (!donates[playerNick]) donates[playerNick] = { subscription: null, colors: [], prefix: false, customNick: false };
  const pd = donates[playerNick];

  if (codeData.type.startsWith('подписка')) {
    const m = codeData.type === 'подписка1' ? 1 : codeData.type === 'подписка3' ? 3 : 6;
    pd.subscription = { active: true, until: new Date(Date.now() + m * 30 * 24 * 60 * 60 * 1000).toISOString() };
    try { await sendRconCommand(`lp user ${playerNick} permission set group.plus true`); } catch {}
  } else if (codeData.type.startsWith('цвет_')) {
    if (!pd.colors) pd.colors = [];
    const clr = codeData.type.replace('цвет_', '');
    if (!pd.colors.includes(clr)) pd.colors.push(clr);
  } else if (codeData.type === 'префикс' || codeData.type === 'префикс5' || codeData.type === 'префикс10') {
    const countMap = { 'префикс': 1, 'префикс5': 5, 'префикс10': 10 };
    const add = countMap[codeData.type] || 1;
    const cur = typeof pd.prefix === 'number' ? pd.prefix : (pd.prefix ? 1 : 0);
    pd.prefix = cur + add;
  } else if (codeData.type === 'ник' || codeData.type === 'ник5' || codeData.type === 'ник10') {
    const countMap = { 'ник': 1, 'ник5': 5, 'ник10': 10 };
    const add = countMap[codeData.type] || 1;
    const cur = typeof pd.customNick === 'number' ? pd.customNick : (pd.customNick ? 1 : 0);
    pd.customNick = cur + add;
  }
// Mr.Kitty - Hollow
  saveDonates(donates);
  codeData.status = 'used'; codeData.usedBy = playerNick; codeData.usedAt = new Date().toISOString();
  saveCodes(codes);

  const typeName = DONATE_TYPE_NAMES[codeData.type] || codeData.type;
  let remainMsg = '';
  if (codeData.type.startsWith('префикс')) remainMsg = `\n📊 Осталось смен префикса: <b>${pd.prefix}</b>`;
  else if (codeData.type.startsWith('ник') && !codeData.type.startsWith('ник')) remainMsg = '';
  if (codeData.type === 'ник' || codeData.type === 'ник5' || codeData.type === 'ник10') remainMsg = `\n📊 Осталось смен ника: <b>${pd.customNick}</b>`;

  try {
    await bot.sendMessage(chatId,
      `💎 <b>Новая покупка!</b>\nИгрок: <a href="tg://user?id=${userId}">${escapeHTML(playerNick)}</a>\nПолучено: <b>${typeName}</b>\n✅ Донат активирован!`,
      { parse_mode: 'HTML' }
    );
  } catch {}

  return bot.sendMessage(chatId_,
    `✅ Промокод активирован!\n\n💎 Получено: ${typeName}${remainMsg}`,
    { parse_mode: 'HTML' }
  );
}

// ============================================================
//  /donate — интерактивное меню (стиль бота 2)
// ============================================================
bot.onText(/^\/donate$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  if (!Object.keys(users).find(n => users[n] === userId))
    return bot.sendMessage(msg.chat.id,
      '❌ Вы не зарегистрированы на сервере.\n💡 Подайте заявку на whitelist в чате.',
      { parse_mode: 'HTML' }
    );
  tempState.delete(userId);
  return bot.sendMessage(msg.chat.id, '💎 <b>Выберите тип доната:</b>', {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌟 Подписка "Плюс"', callback_data: 'donate_subscription' }],
        [{ text: '🎨 Цвета ника',      callback_data: 'donate_colors' }],
        [{ text: '✏️ Смена ника',       callback_data: 'donate_nick' }],
        [{ text: '🏷️ Смена префикса',  callback_data: 'donate_prefix' }],
        [{ text: '📋 Подробнее',        callback_data: 'donate_info' }]
      ]
    }
  });
});

// ============================================================
//  /nickcolor — смена цвета ника
// ============================================================
bot.onText(/^\/(nickcolor|цветника|changecolor)$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const entry  = Object.entries(users).find(([, id]) => id === userId);
  if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы на сервере.');
  const [nick] = entry;
  const pd     = loadDonates()[nick];
  if (!pd || !pd.colors || !pd.colors.length)
    return bot.sendMessage(msg.chat.id, '❌ У вас нет купленных цветов.\n\n💡 Активируйте промокод: /promo КОД', { parse_mode: 'HTML' });
  const last = nickChangeCDs.get(userId);
  if (last && Date.now() - last < NICK_CHANGE_COOLDOWN) {
    const left = Math.ceil((NICK_CHANGE_COOLDOWN - (Date.now() - last)) / 1000 / 60);
    return bot.sendMessage(msg.chat.id, `⏰ Вы недавно меняли цвет.\nПопробуйте через ${left} минут.`);
  }
  const btns = pd.colors.map(k => ([{ text: MINECRAFT_COLORS[k] ? MINECRAFT_COLORS[k].name : k, callback_data: `nickcolor_${k}` }]));
  return bot.sendMessage(msg.chat.id,
    `🎨 <b>Выбери цвет для ника</b>\n\nТекущий ник: <b>${escapeHTML(nick)}</b>\n⏰ Можно менять раз в 30 минут`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: btns } }
  );
});

// ============================================================
//  /setnick
// ============================================================
bot.onText(/^\/(setnick|установитьник)(?:\s(.+))?$/s, async (msg, match) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const entry  = Object.entries(users).find(([, id]) => id === userId);
  if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы на сервере.');
  const [curNick] = entry;
  const donates   = loadDonates();
  const pd        = donates[curNick];
  if (!pd || !pd.customNick)
    return bot.sendMessage(msg.chat.id, '❌ У вас нет купленной смены ника.\n💡 /promo КОД', { parse_mode: 'HTML' });
  const newNick = match[2] ? match[2] : null;
  if (!newNick) return bot.sendMessage(msg.chat.id,
    '❗ Укажите ник:\n<code>/setnick новый ник</code>\n\nПример: <code>/setnick &cPro Gamer</code>\n\n📝 Коды: &0-9, &a-f, &#RRGGBB\nДлина без кодов: 2-16 символов (пробел считается)',
    { parse_mode: 'HTML' }
  );
  const cv = validateColorCodes(newNick);
  if (!cv.valid) return bot.sendMessage(msg.chat.id, cv.message, { parse_mode: 'HTML' });
  const clen = stripCC(newNick).length;
  if (clen < 2 || clen > 16) return bot.sendMessage(msg.chat.id, `❌ Длина без кодов: ${clen}. Допустимо: 2-16 (пробел считается символом)`, { parse_mode: 'HTML' });
  try {
    await sendRconCommand(`name other nickname ${curNick} ${newNick}`);
    const remainNick = (typeof pd.customNick === 'number' ? pd.customNick : 1) - 1;
    pd.customNick = remainNick > 0 ? remainNick : false; saveDonates(donates);
    const remNickText = remainNick > 0 ? `\n📊 Осталось смен ника: <b>${remainNick}</b>` : '\n📊 Смены ника закончились';
    return bot.sendMessage(msg.chat.id,
      `✅ <b>Ник изменён!</b>\nСтарый: <code>${escapeHTML(curNick)}</code>\nНовый: <code>${escapeHTML(newNick)}</code>${remNickText}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    try { await bot.sendMessage(chatId, `⚠️ <b>ВНИМАНИЕ!</b> ${admins.map(a => `@${a}`).join(', ')}\n❌ Ошибка смены ника!\nИгрок: <b>${escapeHTML(curNick)}</b>\nНовый: <code>${escapeHTML(newNick)}</code>\nОшибка: <code>${escapeHTML(err.message)}</code>\n⚡ Вручную: <code>/name other nickname ${curNick} ${newNick}</code>`, { parse_mode: 'HTML' }); } catch {}
    return bot.sendMessage(msg.chat.id, '❌ Ошибка смены ника. Админы уведомлены.', { parse_mode: 'HTML' });
  }
});

// ============================================================
//  /setprefix
// ============================================================
bot.onText(/^\/(setprefix|установитьпрефикс)(?:\s(.+))?$/s, async (msg, match) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const users  = loadUsers();
  const entry  = Object.entries(users).find(([, id]) => id === userId);
  if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы на сервере.');
  const [curNick] = entry;
  const donates   = loadDonates();
  const pd        = donates[curNick];
  if (!pd || !pd.prefix)
    return bot.sendMessage(msg.chat.id, '❌ У вас нет купленного префикса.\n💡 /promo КОД', { parse_mode: 'HTML' });
  const newPfx = match[2] ? match[2] : null;
  if (!newPfx) return bot.sendMessage(msg.chat.id,
    '❗ Укажите префикс:\n<code>/setprefix [PRO]</code>\n\n📝 Коды: &0-9, &a-f, &#RRGGBB\nДлина без кодов: 1-8 символов (пробел считается)',
    { parse_mode: 'HTML' }
  );
  const cv = validateColorCodes(newPfx);
  if (!cv.valid) return bot.sendMessage(msg.chat.id, cv.message, { parse_mode: 'HTML' });
  const clen = stripCC(newPfx).length;
  if (clen < 1 || clen > 8) return bot.sendMessage(msg.chat.id, `❌ Длина без кодов: ${clen}. Допустимо: 1-8 (пробел считается символом)`, { parse_mode: 'HTML' });
  try {
    await sendRconCommand(`name other prefix ${curNick} ${newPfx}`);
    const remainPfx = (typeof pd.prefix === 'number' ? pd.prefix : 1) - 1;
    pd.prefix = remainPfx > 0 ? remainPfx : false; saveDonates(donates);
    const remPfxText = remainPfx > 0 ? `\n📊 Осталось смен префикса: <b>${remainPfx}</b>` : '\n📊 Смены префикса закончились';
    return bot.sendMessage(msg.chat.id,
      `✅ <b>Префикс установлен!</b>\nИгрок: <code>${escapeHTML(curNick)}</code>\nПрефикс: <code>${escapeHTML(newPfx)}</code>${remPfxText}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    try { await bot.sendMessage(chatId, `⚠️ <b>ВНИМАНИЕ!</b> ${admins.map(a => `@${a}`).join(', ')}\n❌ Ошибка установки префикса!\nИгрок: <b>${escapeHTML(curNick)}</b>\nПрефикс: <code>${escapeHTML(newPfx)}</code>\nОшибка: <code>${escapeHTML(err.message)}</code>\n⚡ Вручную: <code>/name other prefix ${curNick} ${newPfx}</code>`, { parse_mode: 'HTML' }); } catch {}
    return bot.sendMessage(msg.chat.id, '❌ Ошибка установки префикса. Админы уведомлены.', { parse_mode: 'HTML' });
  }
});

// ============================================================
//  /admin — панель генерации промокодов (кнопки, бот 1)
// ============================================================
bot.onText(/^\/(admin|генерациякода)$/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  if (!admins.includes(msg.from.username))
    return bot.sendMessage(msg.chat.id, '❌ Только для администраторов.');
  const btns = [];
  btns.push([
    { text: '📅 Подписка 1 мес.', callback_data: 'gen_подписка1' },
    { text: '📅 Подписка 3 мес.', callback_data: 'gen_подписка3' }
  ]);
  btns.push([{ text: '📅 Подписка 6 мес.', callback_data: 'gen_подписка6' }]);
  const ck = Object.keys(MINECRAFT_COLORS);
  for (let i = 0; i < ck.length; i += 3)
    btns.push(ck.slice(i, i + 3).map(k => ({
      text: `${MINECRAFT_COLORS[k].code} ${MINECRAFT_COLORS[k].name}`,
      callback_data: `gen_цвет_${k}`
    })));
  btns.push([
    { text: '🏷 Префикс x1',   callback_data: 'gen_префикс' },
    { text: '🏷 Префикс x5',   callback_data: 'gen_префикс5' },
    { text: '🏷 Префикс x10',  callback_data: 'gen_префикс10' }
  ]);
  btns.push([
    { text: '📝 Ник x1',       callback_data: 'gen_ник' },
    { text: '📝 Ник x5',       callback_data: 'gen_ник5' },
    { text: '📝 Ник x10',      callback_data: 'gen_ник10' }
  ]);
  return bot.sendMessage(msg.chat.id,
    `🔧 <b>Панель генерации промокодов</b>\n\nВыберите тип:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: btns } }
  );
});

// ============================================================
//  /addadmin / /removeadmin
// ============================================================
bot.onText(/^\/addadmin(?:\s+(.+))?$/, async (msg, match) => {
  if (msg.from.username !== MAIN_ADMIN) return bot.sendMessage(msg.chat.id, '❌ Только главный админ.');
  const newA = match[1] ? match[1].trim().replace('@', '') : null;
  if (!newA) return bot.sendMessage(msg.chat.id, '❌ /addadmin username');
  if (admins.includes(newA)) return bot.sendMessage(msg.chat.id, '❌ Уже является админом!');
  admins.push(newA); fs.writeFileSync(ADMIN_FILE, JSON.stringify(admins, null, 2));
  return bot.sendMessage(msg.chat.id, `✅ @${newA} добавлен в админы!`);
});

bot.onText(/^\/removeadmin(?:\s+(.+))?$/, async (msg, match) => {
  if (msg.from.username !== MAIN_ADMIN) return bot.sendMessage(msg.chat.id, '❌ Только главный админ.');
  const rem = match[1] ? match[1].trim().replace('@', '') : null;
  if (!rem) return bot.sendMessage(msg.chat.id, '❌ /removeadmin username');
  if (rem === MAIN_ADMIN) return bot.sendMessage(msg.chat.id, '❌ Нельзя удалить главного!');
  const i = admins.indexOf(rem);
  if (i === -1) return bot.sendMessage(msg.chat.id, '❌ Не является админом!');
  admins.splice(i, 1); fs.writeFileSync(ADMIN_FILE, JSON.stringify(admins, null, 2));
  return bot.sendMessage(msg.chat.id, `✅ @${rem} удалён из админов!`);
});

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ — createReport / createTicket (для ЛС)
// ============================================================
async function createReport(msg, targetNick, reason, reporterId) {
  const id    = nextReportId++;
  const users = loadUsers();
  const re    = Object.entries(users).find(([, i]) => i === reporterId);
  const repS  = re ? `<a href="tg://user?id=${reporterId}">${escapeHTML(re[0])}</a>` : getMention(msg.from);
  const te    = Object.entries(users).find(([n]) => n.toLowerCase() === targetNick.toLowerCase());
  const tarS  = te ? `<a href="tg://user?id=${te[1]}">${escapeHTML(te[0])}</a>` : escapeHTML(targetNick);
  const text  = `📄 <b>Жалоба</b>\nОт: ${repS}\nНа: ${tarS}\nПричина: ${escapeHTML(reason)}\n\n❗ <b>Статус:</b> 🔴 Не решена`;
  await bot.sendMessage(msg.chat.id, '✅ Жалоба отправлена!');
  const aMsg  = await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'Рассмотреть ⚡', callback_data: `rep_review_${id}` }]] }
  });
  reports.set(id, { reporterId, targetNick, reason, status: 'NEW', adminMessageId: aMsg.message_id });
  tempState.delete(reporterId);
}

async function createTicket(msg, description, playerId) {
  const id   = nextTicketId++;
  const users = loadUsers();
  const pe   = Object.entries(users).find(([, i]) => i === playerId);
  const pStr = pe ? `<a href="tg://user?id=${playerId}">${escapeHTML(pe[0])}</a>` : getMention(msg.from);
  await bot.sendMessage(msg.chat.id, '✅ Тикет создан!');
  const aMsg = await bot.sendMessage(chatId,
    `📄 <b>Тикет</b>\nОт: ${pStr}\n📝 ${escapeHTML(description)}\n\n❗ <b>Статус:</b> 🔴 Новый`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Рассмотреть ⚡', callback_data: `ticket_review_${id}` }]] } }
  );
  tickets.set(id, { playerId, description, status: 'NEW', adminMessageId: aMsg.message_id });
  tempState.delete(playerId);
}

// ============================================================
//  ОСНОВНОЙ ОБРАБОТЧИК СООБЩЕНИЙ
// ============================================================
bot.on('message', async (msg) => {
  if (!msg.text || msg.from.is_bot) return;
  const rawText  = msg.text.trim();
  const txt      = rawText.toLowerCase();
  const userId   = msg.from.id;
  const username = msg.from.username;
  const isAdmin  = admins.includes(username);
  const isPrivate = msg.chat.type === 'private';
  const users    = loadUsers();

  // ================================================================
  //  ЛИЧНЫЕ СООБЩЕНИЯ
  // ================================================================
  if (isPrivate) {

    // 6-значный код привязки
    if (/^\d{6}$/.test(txt)) {
      for (const [nickname, d] of linkCodes.entries()) {
        if (d.code === txt && d.userId === userId) {
          users[nickname] = userId;
          saveUsers(users);
          linkCodes.delete(nickname);
          return bot.sendMessage(msg.chat.id,
            `✅ <b>Успешно!</b> Ник <b>${escapeHTML(nickname)}</b> привязан к Telegram!`,
            { parse_mode: 'HTML' }
          );
        }
      }
      return bot.sendMessage(msg.chat.id, '❌ Неверный или устаревший код. Срок действия — 5 минут.');
    }

    // Алиасы промокода
    if (txt === 'промокод' || txt === 'промо') {
      const entry = Object.entries(users).find(([, id]) => id === userId);
      if (!entry) return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы.');
      tempState.set(userId, { action: 'use_promo', timestamp: Date.now() });
      return bot.sendMessage(msg.chat.id, '🎁 Введите промокод:');
    }

    // Команда генерировать (текстом)
    if (txt.startsWith('генерировать')) {
      if (!isAdmin) return bot.sendMessage(msg.chat.id, '❌ Только для администраторов.');
      const args = rawText.split(/\s+/);
      if (args.length < 2) return bot.sendMessage(msg.chat.id,
        '❗ Укажите тип:\nгенерировать подписка1\nгенерировать подписка3\nгенерировать подписка6\nгенерировать цвет_красный\nгенерировать префикс\nгенерировать ник',
        { parse_mode: 'HTML' }
      );
      const type = args.slice(1).join('_').toLowerCase();
      const valid = ['подписка1','подписка3','подписка6','префикс','ник', ...Object.keys(MINECRAFT_COLORS).map(c => `цвет_${c}`)];
      if (!valid.includes(type)) return bot.sendMessage(msg.chat.id, '❌ Неизвестный тип промокода!');
      const code  = genPromoCode(type);
      const now   = new Date();
      const codes = loadCodes();
      codes[code] = { type, created: now.toISOString(), expires: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), status: 'active', createdBy: username, usedBy: null, usedAt: null };
      saveCodes(codes);
      return bot.sendMessage(msg.chat.id,
        `✅ Промокод сгенерирован!\n\n🎫 Код: <code>${code}</code>\n💎 Тип: ${DONATE_TYPE_NAMES[type] || type}\n⏰ Действует: 24 часа\n📋 Скопируй и отправь игроку`,
        { parse_mode: 'HTML' }
      );
    }

    // Список кодов
    if (txt === 'коды' || txt === 'промокоды') {
      if (!isAdmin) return bot.sendMessage(msg.chat.id, '❌ Только для администраторов.');
      const codes  = loadCodes();
      const active = Object.entries(codes).filter(([, d]) => d.status === 'active');
      if (!active.length) return bot.sendMessage(msg.chat.id, '📋 Нет активных промокодов');
      let t = '📋 <b>Активные промокоды:</b>\n\n';
      active.forEach(([c, d]) => {
        t += `🎫 <code>${c}</code>\n   Тип: ${DONATE_TYPE_NAMES[d.type] || d.type}\n   До: ${new Date(d.expires).toLocaleString('ru-RU')}\n\n`;
      });
      return bot.sendMessage(msg.chat.id, t, { parse_mode: 'HTML' });
    }

    // Обработка состояний
    const state = tempState.get(userId);
    if (!state) return;

    if (state.action === 'link_nickname') {
      const nick = rawText;
      if (!/^[a-zA-Z0-9_]+$/.test(nick)) return bot.sendMessage(msg.chat.id, '❌ Ник: только латиница, цифры и _');
      if (nick.length < 3 || nick.length > 16) return bot.sendMessage(msg.chat.id, '❌ Ник: 3-16 символов');
      if (users[nick] && users[nick] !== userId) return bot.sendMessage(msg.chat.id, '❌ Ник уже привязан к другому пользователю!');
      const code = genLinkCode();
      linkCodes.set(nick, { code, userId, timestamp: Date.now() });
      await sendRconCommand(`tellraw ${nick} ["",{"text":"[TG-Bot] ","color":"gold","bold":true},{"text":"Код привязки: ","color":"yellow"},{"text":"${code}","color":"green","bold":true},{"text":"\\nОтправьте этот код в Telegram боту.","color":"gray"}]`);
      tempState.delete(userId);
      return bot.sendMessage(msg.chat.id,
        `✅ Запрос отправлен!\n🎮 Если <b>${escapeHTML(nick)}</b> онлайн — ему отправлен 6-значный код.\n📝 Введите его здесь.\n⏱ Действует 5 минут.`,
        { parse_mode: 'HTML' }
      );
    }

    if (state.action === 'use_promo') {
      const code  = rawText.toUpperCase();
      const entry = Object.entries(users).find(([, id]) => id === userId);
      if (!entry) { tempState.delete(userId); return bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы.'); }
      tempState.delete(userId);
      return _activatePromo(msg.chat.id, userId, entry[0], code);
    }

    return;
  }

  // ================================================================
  //  ГРУППОВЫЕ СООБЩЕНИЯ
  // ================================================================
  if (msg.chat.id !== chatId) return;

  // проверить ник
  if (txt.startsWith('проверить')) {
    const nick = rawText.trim().split(/\s+/).slice(1).join(' ');
    if (!nick) return sendSafe(msg, '❗ Укажите ник: проверить Errnick_');
    const check = filterNick(nick, users);
    let status = '';
    if (check.status === 'normal') status = '✅ Ник разрешён';
    else if (check.status === 'suspicious') status = `⚠️ Подозрительный: ${check.reason} (${check.similarity}%)`;
    else status = `❌ Запрещённый: ${check.reason} (${check.category})`;
    const bound = users[nick] ? `<a href="tg://user?id=${users[nick]}">${escapeHTML(nick)}</a>` : '❌ Не в базе';
    let srv = '❌ Не на сервере';
    try { const wl = await sendRconCommand('whitelist list'); if (wl && wl.includes(nick)) srv = '✅ На сервере'; } catch {}
    return sendSafe(msg, `🔍 <b>${escapeHTML(nick)}</b>\n📄 Привязан: ${bound}\n🖥 Сервер: ${srv}\n🔐 Статус: ${status}`, { parse_mode: 'HTML' });
  }

  if (txt === 'инфо')
    return sendSafe(msg, `ℹ️ <b>Информация о боте</b>\n\n👤 Автор: Errnick_\n📦 Версия: 1.0.5 - beta-2\n💻 <a href="https://github.com/Errnick-code/EasyTGWhiteListMC">GitHub</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });

  if (txt === 'список') {
    const entries = Object.entries(users);
    if (!entries.length) return sendSafe(msg, `<b>Whitelist:</b>\nПусто`, { parse_mode: 'HTML' });
    const list = entries.map(([n, id]) => `🔹 <a href="tg://user?id=${id}">${escapeHTML(n)}</a>`).join('\n');
    return sendSafe(msg, `<b>Whitelist игроков:</b>\n${list}`, { parse_mode: 'HTML' });
  }

  if (txt === 'мой ник') {
    const e = Object.entries(users).find(([, id]) => id === userId);
    return sendSafe(msg, e ? `🔹 Ваш ник: <b>${escapeHTML(e[0])}</b>` : '❌ Ник не найден в базе', { parse_mode: 'HTML' });
  }

  if (txt === 'ник') {
    const tid = msg.reply_to_message ? msg.reply_to_message.from.id : userId;
    const lbl = msg.reply_to_message ? `Ник ${getMention(msg.reply_to_message.from)}` : 'Ваш ник';
    const e   = Object.entries(users).find(([, id]) => id === tid);
    return sendSafe(msg, e ? `🔹 ${lbl}: <b>${escapeHTML(e[0])}</b>` : '❌ Ник не найден', { parse_mode: 'HTML' });
  }

  if (txt === 'сайт' || txt === 'site')
    return sendSafe(msg, `🌐 <b>Сайт сервера:</b>\nhttps://ваш-сайт.com`, { parse_mode: 'HTML' });

  if (txt === 'админы' || txt === 'admins')
    return sendSafe(msg, `👥 <b>Администрация:</b>\n\n${admins.map(a => `• @${a}`).join('\n')}`, { parse_mode: 'HTML' });

  // заявка (в чате — 6 строк)
  if (txt.startsWith('заявка')) {
    const after = rawText.slice(6).trim();
    const lines = after.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length !== 6) return sendSafe(msg,
      `❗ ${getMention(msg.from)}, заявка неполная — нужно 7 строк:\nЗаявка\nНик\nЛицензия / пиратка\nВозраст\nОткуда узнали\nЧем будете заниматься\nПочему выбрали сервер`,
      { parse_mode: 'HTML' }
    );
    const cd = checkCooldown(userId, 'application');
    if (!cd.ok) return sendSafe(msg, `⏱️ ${getMention(msg.from)}, подождите ещё ${cd.remainingSec} сек.`, { parse_mode: 'HTML' });
    const [nick, type, age, source, activity, reason] = lines;
    if (!/^[a-zA-Z0-9_]+$/.test(nick)) return sendSafe(msg, `❗ ${getMention(msg.from)}, ник: только латиница, цифры и _`, { parse_mode: 'HTML' });
    if (nick.length < 3 || nick.length > 16) return sendSafe(msg, `❗ ${getMention(msg.from)}, ник 3–16 символов`, { parse_mode: 'HTML' });
    if (users[nick]) return sendSafe(msg, `❌ Ник <b>${escapeHTML(nick)}</b> уже занят`, { parse_mode: 'HTML' });
    const check = filterNick(nick, users);
    if (check.status === 'blacklist') return sendSafe(msg, `❌ ${getMention(msg.from)}, ник запрещён: ${check.reason}`, { parse_mode: 'HTML' });
    let appText = `🔐 <b>Заявка / WhiteList</b>\n\nОт: ${getMention(msg.from)}\n\n🧑 Ник: ${escapeHTML(nick)}\n💻 Тип: ${escapeHTML(type)}\n🎂 Возраст: ${escapeHTML(age)}\n🌐 Откуда: ${escapeHTML(source)}\n🎯 План: ${escapeHTML(activity)}\n❓ Причина: ${escapeHTML(reason)}`;
    applications.set(msg.message_id, { nick, type, playerId: userId });
    let kb;
    if (check.status === 'suspicious') {
      appText += `\n\n⚠️ Подозрительный ник: ${check.reason} (${check.similarity}%)`;
      kb = [
        [{ text: `Разрешить ⚠️ (${check.similarity}%)`, callback_data: `add_${msg.message_id}` }, { text: 'Отклонить ❌', callback_data: `deny_${msg.message_id}` }],
        [{ text: '🗑️ Отменить', callback_data: `cancel_${msg.message_id}` }]
      ];
    } else {
      kb = [
        [{ text: 'Добавить ✅', callback_data: `add_${msg.message_id}` }, { text: 'Отказать ❌', callback_data: `deny_${msg.message_id}` }],
        [{ text: '🗑️ Отменить', callback_data: `cancel_${msg.message_id}` }]
      ];
    }
    return sendSafe(msg, appText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
  }

  // жалоба (в чате)
  if (txt.startsWith('жалоба')) {
    const after = rawText.slice(6).trim();
    const lines = after.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length !== 2) return sendSafe(msg, `❗ ${getMention(msg.from)}, две строки:\nНик нарушителя\nПричина`, { parse_mode: 'HTML' });
    const cd = checkCooldown(userId, 'report');
    if (!cd.ok) return sendSafe(msg, `⏱️ ${getMention(msg.from)}, подождите ${cd.remainingSec} сек.`, { parse_mode: 'HTML' });
    const [targetNick, reason] = lines;
    const repEntry = Object.entries(users).find(([, id]) => id === userId);
    if (!repEntry) return sendSafe(msg, `❌ ${getMention(msg.from)}, вас нет в базе`, { parse_mode: 'HTML' });
    const repS = `<a href="tg://user?id=${userId}">${escapeHTML(repEntry[0])}</a>`;
    const te   = Object.entries(users).find(([n]) => n.toLowerCase() === targetNick.toLowerCase());
    const tarS = te ? `<a href="tg://user?id=${te[1]}">${escapeHTML(te[0])}</a>` : escapeHTML(targetNick);
    const rid  = nextReportId++;
    reports.set(msg.message_id, { reporterId: userId, targetNick, reason, status: 'NEW' });
    return sendSafe(msg,
      `📄 <b>Жалоба</b>\nОт: ${repS}\nНа: ${tarS}\nПричина: ${escapeHTML(reason)}\n\n❗ <b>Статус:</b> 🔴 Не решена`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Рассмотреть ⚡', callback_data: `rep_review_${msg.message_id}` }]] } }
    );
  }

  // тикет (в чате)
  if (txt.startsWith('тикет')) {
    const after = rawText.slice(5).trim();
    if (!after) return sendSafe(msg, `❗ ${getMention(msg.from)}, укажите описание`, { parse_mode: 'HTML' });
    const pe = Object.entries(users).find(([, id]) => id === userId);
    if (!pe) return sendSafe(msg, `❌ ${getMention(msg.from)}, привяжите ник: /link`, { parse_mode: 'HTML' });
    const cd = checkCooldown(userId, 'ticket');
    if (!cd.ok) return sendSafe(msg, `⏱️ ${getMention(msg.from)}, подождите ${cd.remainingSec} сек.`, { parse_mode: 'HTML' });
    nextTicketId++;
    tickets.set(msg.message_id, { playerId: userId, description: after, status: 'NEW' });
    return sendSafe(msg,
      `📄 <b>Тикет</b>\nОт: <a href="tg://user?id=${userId}">${escapeHTML(pe[0])}</a>\n📝 ${escapeHTML(after)}\n\n❗ <b>Статус:</b> 🔴 Новый`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Рассмотреть ⚡', callback_data: `ticket_review_${msg.message_id}` }]] } }
    );
  }

  // =============================================================
  //  !EC / !ЕС команды
  // =============================================================
  const hasPrefix = EC_PREFIXES.some(p => rawText.toUpperCase().startsWith(p.toUpperCase()));
  if (!hasPrefix) return;

  const pfx = EC_PREFIXES.find(p => rawText.toUpperCase().startsWith(p.toUpperCase()));
  const withoutPfx = rawText.slice(pfx.length).trim();
  const [command, ...rest] = withoutPfx.split(/\s+/);
  const bodyText = rest.join(' ').trim();
  const args = bodyText.split(/\s+/);

  if (!command) {
    const cmds = [
      'заявка - создать заявку на whitelist',
      'жалоба - оставить жалобу на игрока',
      'список - список игроков',
      'проверить [ник] - проверка ника',
      'мой ник - покажет ваш ник на сервере',
      'ник (в ответ на сообщение) - покажет ник того на чьё сообщение вы ответили',
      'админ add|remove - добавить или удалить админа [только админ]',
      'сборка - отправить файл сборки [только админ]',
      'команда - выполнить команды на сервере через RCON [только админ]',
      'добавить - добавляет игрока без заявки [только админ]',
      'удалить - удаляет из данных и whitelist [только админ]',
    ];

    return sendSafe(
      msg,
      `📜 <b>Доступные команды</b>:\n` +
      `Все команды пишутся через !EC (команда)\n\n` +
      `${cmds.join('\n')}\n\n` +
      `Команды без !EC:\n` +
      `• сайт - сайт сервера\n` +
      `• админы - список администрации\n\n` +
      `💻 <b>GitHub:</b> <a href="https://github.com/Errnick-code/EasyTGWhiteListMC">Исходный код бота</a>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }

  if (command === 'убрать') {
    if (!isAdmin) return sendSafe(msg, '❌ Только для администраторов');
    const nick = args[0]; if (!nick) return;
    await sendRconCommand(`whitelist remove ${nick}`);
    await sendRconCommand(`easywhitelist remove ${nick}`);
    return sendSafe(msg, `❌ ${escapeHTML(nick)} убран из whitelist`, { parse_mode: 'HTML' });
  }

  if (command === 'сборка') {
    if (!isAdmin) return sendSafe(msg, '❌ Только для администраторов');
    const files = fs.readdirSync(BOT_FOLDER).filter(f => f.endsWith('.mrpack'));
    if (!files.length) return sendSafe(msg, '❌ Файл .mrpack не найден');
    return bot.sendDocument(msg.chat.id, path.join(BOT_FOLDER, files[0]), {}, { filename: files[0] });
  }

  if (command.toLowerCase() === 'админ') {
    if (!isAdmin) return sendSafe(msg, '❌ Только для администраторов');
    const [sub, tgt] = bodyText.split(/\s+/);
    if (!sub || !tgt || !tgt.startsWith('@')) return;
    const tu = tgt.slice(1);
    if (sub.toLowerCase() === 'add') {
      if (!admins.includes(tu)) admins.push(tu);
      fs.writeFileSync(ADMIN_FILE, JSON.stringify(admins, null, 2));
      return sendSafe(msg, `✅ @${tu} добавлен в админы`);
    }
    if (sub.toLowerCase() === 'remove') {
      if (tu === MAIN_ADMIN) return;
      admins = admins.filter(u => u !== tu);
      fs.writeFileSync(ADMIN_FILE, JSON.stringify(admins, null, 2));
      return sendSafe(msg, `❌ @${tu} удалён из админов`);
    }
  }

  if (command === 'команда') {
    if (!isAdmin) return sendSafe(msg, '❌ Только для администраторов');
    const cmds = bodyText.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (!cmds.length) return sendSafe(msg, '❌ Укажите команду');
    for (const c of cmds) await sendRconCommand(c);
    return sendSafe(msg, `✅ ${cmds.length} команд(ы) отправлены:\n${cmds.map(c => `<code>${escapeHTML(c)}</code>`).join('\n')}`, { parse_mode: 'HTML' });
  }

  if (command === 'добавить') {
    if (!isAdmin) return sendSafe(msg, '❌ Только для администраторов');
    const lines   = bodyText.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const nick    = lines[0] ? lines[0].replace(/[^a-zA-Z0-9_]/g, '') : null;
    const license = lines[1] || 'Лицензия';
    const replyId = msg.reply_to_message ? msg.reply_to_message.from.id : null;
    if (!nick) return sendSafe(msg, '❗ Укажите ник');
    if (!replyId) return sendSafe(msg, '❗ Ответьте на сообщение игрока');
    try {
      const res = await addToWhitelist(nick, license);
      const u = loadUsers(); u[nick] = replyId; saveUsers(u);
      return sendSafe(msg, `✅ ${escapeHTML(nick)} добавлен (${license})\nRCON: ${escapeHTML(res || 'ок')}`, { parse_mode: 'HTML' });
    } catch (err) { return sendSafe(msg, `❌ Ошибка: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' }); }
  }

  if (command === 'удалить') {
    if (!isAdmin) return sendSafe(msg, '❌ Только для администраторов');
    const lines   = bodyText.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const replyId = msg.reply_to_message ? msg.reply_to_message.from.id : null;
    let nick = lines[0] || null;
    if (!nick && replyId) {
      const u = loadUsers();
      const f = Object.entries(u).find(([, id]) => id === replyId);
      if (!f) return sendSafe(msg, '❌ Ник не найден в базе');
      nick = f[0];
    }
    if (!nick) return sendSafe(msg, '❗ Укажите ник или ответьте на сообщение');
    try {
      await sendRconCommand(`whitelist remove ${nick}`);
      await sendRconCommand(`easywhitelist remove ${nick}`);
      const u = loadUsers(); delete u[nick]; saveUsers(u);
      return sendSafe(msg, `❌ ${escapeHTML(nick)} удалён`, { parse_mode: 'HTML' });
    } catch (err) { return sendSafe(msg, `❌ Ошибка: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' }); }
  }
});

// ============================================================
//  CALLBACK QUERY
// ============================================================
bot.on('callback_query', async (query) => {
  const data     = query.data;
  const userId   = query.from.id;
  const username = query.from.username;

  // Кнопка "Привязать ник" из /profile
  if (data === 'do_link') {
    await safeAQ(query.id);
    const users = loadUsers();
    const cur   = Object.keys(users).find(n => users[n] === userId);
    if (cur) return bot.sendMessage(userId, `⚠️ Вы уже привязаны к нику <b>${escapeHTML(cur)}</b>!`, { parse_mode: 'HTML' });
    tempState.set(userId, { action: 'link_nickname', timestamp: Date.now() });
    return bot.sendMessage(userId, '🎮 Введите ваш игровой ник:');
  }

  // ГЕНЕРАЦИЯ ПРОМОКОДА (gen_* из /admin)
  if (data.startsWith('gen_')) {
    if (!admins.includes(username))
      return safeAQ(query.id, { text: '❌ Только для администраторов', show_alert: true });
    const type = data.replace('gen_', '');
    const code = genPromoCode(type);
    const now  = new Date();
    const codes = loadCodes();
    codes[code] = {
      type, created: now.toISOString(),
      expires: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'active', createdBy: username, usedBy: null, usedAt: null
    };
    saveCodes(codes);
    await safeAQ(query.id, { text: '✅ Промокод создан!' });
    return bot.sendMessage(query.from.id,
      `✅ <b>Промокод сгенерирован!</b>\n\n🎫 Код: <code>${code}</code>\n💎 Тип: ${DONATE_TYPE_NAMES[type] || type}\n⏰ Действует: 24 часа\n\n📋 Скопируй и отправь игроку`,
      { parse_mode: 'HTML' }
    );
  }

  // СМЕНА ЦВЕТА НИКА (nickcolor_*)
  if (data.startsWith('nickcolor_')) {
    const ck   = data.replace('nickcolor_', '');
    const cd   = MINECRAFT_COLORS[ck];
    if (!cd) return safeAQ(query.id, { text: '❌ Неизвестный цвет', show_alert: true });
    const users = loadUsers();
    const entry = Object.entries(users).find(([, id]) => id === userId);
    if (!entry) return safeAQ(query.id, { text: '❌ Вы не зарегистрированы', show_alert: true });
    const [nick] = entry;
    const pd = loadDonates()[nick];
    if (!pd || !pd.colors || !pd.colors.includes(ck)) return safeAQ(query.id, { text: '❌ У вас нет этого цвета', show_alert: true });
    const last = nickChangeCDs.get(userId);
    if (last && Date.now() - last < NICK_CHANGE_COOLDOWN) {
      const left = Math.ceil((NICK_CHANGE_COOLDOWN - (Date.now() - last)) / 1000 / 60);
      return safeAQ(query.id, { text: `⏰ Попробуйте через ${left} минут`, show_alert: true });
    }
    const colored = `${cd.code}${nick}`;
    try {
      await sendRconCommand(`name other nickname ${nick} ${colored}`);
      nickChangeCDs.set(userId, Date.now());
      await safeAQ(query.id, { text: '✅ Цвет ника изменён!' });
      return bot.editMessageText(
        `✅ <b>Цвет ника изменён!</b>\n\nНовый ник: ${colored}\nЦвет: ${cd.name}\n\n⏰ Следующая смена через 30 минут`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' }
      );
    } catch (err) {
      try { await bot.sendMessage(chatId, `⚠️ <b>ВНИМАНИЕ!</b> ${admins.map(a => `@${a}`).join(', ')}\n❌ Ошибка смены цвета!\nИгрок: <b>${escapeHTML(nick)}</b>\nЦвет: ${cd.name}\nОшибка: <code>${escapeHTML(err.message)}</code>\n⚡ Вручную: <code>/name other nickname ${nick} ${colored}</code>`, { parse_mode: 'HTML' }); } catch {}
      return safeAQ(query.id, { text: '❌ Ошибка. Админы уведомлены.', show_alert: true });
    }
  }

  // ДОНАТ: donate_info
  if (data === 'donate_info') {
    await safeAQ(query.id);
    return bot.editMessageText(
      `💎 <b>Донат на сервере</b>\n\n` +
      `💠 <b>Подписка «Плюс»</b>\n• 1 мес. — 250₽ · 3 мес. — 690₽ · 6 мес. — 1290₽\n` +
      `🎁 /audioplayer, /lg i, /image2map и будущие функции\n\n` +
      `🌈 <b>Цвет ника — 150₽</b> (Разово, переключение между цветами)\n` +
      `🔰 <b>Префикс — 250₽</b> (Разово, 1-8 символов)\n` +
      `📝 <b>Смена ника — 350₽</b> (визуально, 2-16 символов)\n` +
      `⚖️ <b>Снятие варна — 500₽</b>\n🔓 <b>Разбан — 700₽</b>`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'donate_back' }]] } }
    );
  }

  // ДОНАТ: подписка
  if (data === 'donate_subscription') {
    await safeAQ(query.id);
    return bot.editMessageText('🌟 <b>Выберите срок подписки:</b>', {
      chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
          [{ text: '1 месяц — 250₽',                 callback_data: 'sub_1' }],
          [{ text: '3 месяца — 712₽ (скидка 5%)',     callback_data: 'sub_3' }],
          [{ text: '6 месяцев — 1350₽ (скидка 10%)',  callback_data: 'sub_6' }],
          [{ text: '◀️ Назад', callback_data: 'donate_back' }]
        ]}
    });
  }

  if (data.startsWith('sub_')) {
    const months = parseInt(data.split('_')[1]);
    await safeAQ(query.id);
    const price = calcPrice('подписка', { months });
    const uEntry = Object.entries(loadUsers()).find(([, id]) => id === userId);
    const nick   = uEntry ? uEntry[0] : 'не указан';
    return bot.editMessageText(
      `💎 <b>Запрос на донат</b>\n\n` +
      `👤 Игрок: ${getMention(query.from, nick)}\n` +
      `📦 Подписка "Плюс" на <b>${months} мес.</b>\n` +
      `💰 Стоимость: <b>${price}₽</b>\n\n` +
      `📩 <i>Перешлите это сообщение администратору для оплаты.</i>`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'donate_back' }]] } }
    );
  }

  // ДОНАТ: цвета (с галочками)
  if (data === 'donate_colors') {
    await safeAQ(query.id);
    tempState.set(userId, { action: 'donate_colors', selectedColors: [], timestamp: Date.now() });
    const btns = Object.keys(MINECRAFT_COLORS).map(k => ([{ text: MINECRAFT_COLORS[k].name, callback_data: `dc_${k}` }]));
    btns.push([{ text: '✅ Готово', callback_data: 'dc_done' }]);
    btns.push([{ text: '◀️ Назад', callback_data: 'donate_back' }]);
    return bot.editMessageText('🎨 <b>Выберите цвета для ника:</b>\n\n💰 150₽ за каждый цвет', {
      chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: btns }
    });
  }

  if (data.startsWith('dc_') && data !== 'dc_done') {
    const ck    = data.replace('dc_', '');
    const state = tempState.get(userId);
    if (!state || state.action !== 'donate_colors')
      return safeAQ(query.id, { text: '❌ Сессия истекла. Начните заново /donate', show_alert: true });
    if (state.selectedColors.includes(ck)) {
      state.selectedColors = state.selectedColors.filter(c => c !== ck);
      await safeAQ(query.id, { text: `➖ ${MINECRAFT_COLORS[ck].name} убран` });
    } else {
      state.selectedColors.push(ck);
      await safeAQ(query.id, { text: `✅ ${MINECRAFT_COLORS[ck].name} добавлен` });
    }
    tempState.set(userId, state);
    const cnt  = state.selectedColors.length;
    const btns = Object.keys(MINECRAFT_COLORS).map(k => ([{
      text: (state.selectedColors.includes(k) ? '✅ ' : '') + MINECRAFT_COLORS[k].name,
      callback_data: `dc_${k}`
    }]));
    btns.push([{ text: '✅ Готово', callback_data: 'dc_done' }]);
    btns.push([{ text: '◀️ Назад', callback_data: 'donate_back' }]);
    let hdr = '🎨 <b>Выберите цвета для ника:</b>\n\n';
    if (cnt > 0) hdr += `Выбрано: ${cnt} цвет(а) × 150₽ = <b>${cnt * 150}₽</b>\n\n`;
    hdr += '💰 150₽ за каждый цвет';
    return bot.editMessageText(hdr, {
      chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: btns }
    });
  }

  if (data === 'dc_done') {
    const state = tempState.get(userId);
    if (!state || state.action !== 'donate_colors')
      return safeAQ(query.id, { text: '❌ Сессия истекла', show_alert: true });
    if (!state.selectedColors || !state.selectedColors.length)
      return safeAQ(query.id, { text: '❌ Выберите хотя бы один цвет!', show_alert: true });
    await safeAQ(query.id);
    const price = calcPrice('цвета', { colors: state.selectedColors });
    const names = state.selectedColors.map(c => MINECRAFT_COLORS[c].name).join(', ');
    const uEntry = Object.entries(loadUsers()).find(([, id]) => id === userId);
    const nick   = uEntry ? uEntry[0] : 'не указан';
    return bot.editMessageText(
      `💎 <b>Запрос на донат</b>\n\n` +
      `👤 Игрок: ${getMention(query.from, nick)}\n` +
      `🎨 Цвета ника: <b>${names}</b>\n` +
      `💰 Стоимость: <b>${price}₽</b>\n\n` +
      `📩 <i>Перешлите это сообщение администратору для оплаты.</i>`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'donate_back' }]] } }
    );
  }

  // ДОНАТ: смена ника
  if (data === 'donate_nick') {
    await safeAQ(query.id);
    return bot.editMessageText('✏️ <b>Выберите количество смен ника:</b>', {
      chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
          [{ text: '1 смена — 350₽',               callback_data: 'nick_1' }],
          [{ text: '5 смен — 1500₽ (скидка 14%)',  callback_data: 'nick_5' }],
          [{ text: '10 смен — 2800₽ (скидка 20%)', callback_data: 'nick_10' }],
          [{ text: '◀️ Назад', callback_data: 'donate_back' }]
        ]}
    });
  }

  if (data.startsWith('nick_') && !data.startsWith('nickcolor_')) {
    const count  = parseInt(data.split('_')[1]);
    await safeAQ(query.id);
    const price  = calcPrice('ник', { count });
    const uEntry = Object.entries(loadUsers()).find(([, id]) => id === userId);
    const nick   = uEntry ? uEntry[0] : 'не указан';
    return bot.editMessageText(
      `💎 <b>Запрос на донат</b>\n\n` +
      `👤 Игрок: ${getMention(query.from, nick)}\n` +
      `✏️ Смен ника: <b>${count}</b>\n` +
      `💰 Стоимость: <b>${price}₽</b>\n\n` +
      `📩 <i>Перешлите это сообщение администратору для оплаты.</i>`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'donate_back' }]] } }
    );
  }

  // ДОНАТ: смена префикса
  if (data === 'donate_prefix') {
    await safeAQ(query.id);
    return bot.editMessageText('🏷️ <b>Выберите количество смен префикса:</b>', {
      chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
          [{ text: '1 смена — 250₽',               callback_data: 'prefix_1' }],
          [{ text: '5 смен — 1100₽ (скидка 12%)',  callback_data: 'prefix_5' }],
          [{ text: '10 смен — 2000₽ (скидка 20%)', callback_data: 'prefix_10' }],
          [{ text: '◀️ Назад', callback_data: 'donate_back' }]
        ]}
    });
  }

  if (data.startsWith('prefix_')) {
    const count  = parseInt(data.split('_')[1]);
    await safeAQ(query.id);
    const price  = calcPrice('префикс', { count });
    const uEntry = Object.entries(loadUsers()).find(([, id]) => id === userId);
    const nick   = uEntry ? uEntry[0] : 'не указан';
    return bot.editMessageText(
      `💎 <b>Запрос на донат</b>\n\n` +
      `👤 Игрок: ${getMention(query.from, nick)}\n` +
      `🏷️ Смен префикса: <b>${count}</b>\n` +
      `💰 Стоимость: <b>${price}₽</b>\n\n` +
      `📩 <i>Перешлите это сообщение администратору для оплаты.</i>`,
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'donate_back' }]] } }
    );
  }

  // Назад к меню донатов
  if (data === 'donate_back') {
    await safeAQ(query.id);
    tempState.delete(userId);
    return bot.editMessageText('💎 <b>Выберите тип доната:</b>', {
      chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
          [{ text: '🌟 Подписка "Плюс"', callback_data: 'donate_subscription' }],
          [{ text: '🎨 Цвета ника',      callback_data: 'donate_colors' }],
          [{ text: '✏️ Смена ника',       callback_data: 'donate_nick' }],
          [{ text: '🏷️ Смена префикса',  callback_data: 'donate_prefix' }],
          [{ text: '📋 Подробнее',        callback_data: 'donate_info' }]
        ]}
    });
  }

  // ЗАЯВКИ (чат): add / deny / cancel
  if (data.startsWith('add_') || data.startsWith('deny_') || data.startsWith('cancel_')) {
    let action, msgId;
    if (data.startsWith('add_'))    { action = 'add';    msgId = parseInt(data.slice(4)); }
    else if (data.startsWith('deny_'))   { action = 'deny';   msgId = parseInt(data.slice(5)); }
    else if (data.startsWith('cancel_')) { action = 'cancel'; msgId = parseInt(data.slice(7)); }

    const app = applications.get(msgId);
    if (!app) return safeAQ(query.id, { text: '❌ Заявка не найдена или уже обработана', show_alert: true });

    if (action === 'cancel') {
      if (query.from.id !== app.playerId) return safeAQ(query.id, { text: '❌ Только автор может отменить', show_alert: true });
      applications.delete(msgId);
      await safeAQ(query.id, { text: 'Заявка отменена' });
      try { await bot.deleteMessage(query.message.chat.id, query.message.message_id); } catch {}
      return;
    }

    if (!admins.includes(username)) return safeAQ(query.id, { text: '❌ Только для администраторов', show_alert: true });

    const tid   = query.message.message_thread_id;
    const cid   = query.message.chat.id;
    const admM  = `@${username}`;
    const users = loadUsers();
    const plNick = Object.keys(users).find(n => users[n] === app.playerId) || 'Игрок';
    const plMen  = `<a href="tg://user?id=${app.playerId}">${escapeHTML(plNick)}</a>`;

    if (action === 'add') {
      await safeAQ(query.id, { text: '✅ Принято' });
      try {
        await addToWhitelist(app.nick, app.type || 'Лицензия');
        const u = loadUsers(); u[app.nick] = app.playerId; saveUsers(u);
        await bot.sendMessage(cid, `${plMen}, заявка принята ${admM} ✅`, { parse_mode: 'HTML', message_thread_id: tid });
      } catch (err) {
        await bot.sendMessage(cid, `${plMen}, ошибка: ${escapeHTML(err.message)}`, { parse_mode: 'HTML', message_thread_id: tid });
      }
    } else {
      await safeAQ(query.id, { text: '❌ Отклонено' });
      await bot.sendMessage(cid, `${plMen}, заявка отклонена ${admM} ❌`, { parse_mode: 'HTML', message_thread_id: tid });
    }
    try { await bot.deleteMessage(cid, query.message.message_id); } catch {}
    applications.delete(msgId);
    return;
  }

  // ЗАЯВКИ (ЛС): app_accept / app_reject
  if (data.startsWith('app_')) {
    const parts  = data.split('_');
    const action = parts[1];
    const msgId  = parseInt(parts[2]);
    const app    = applications.get(msgId);
    if (!app) return safeAQ(query.id, { text: '❌ Заявка не найдена', show_alert: true });
    if (!admins.includes(username)) return safeAQ(query.id, { text: '❌ Только для администраторов', show_alert: true });
    const admM = `@${username}`;
    if (action === 'accept') {
      await safeAQ(query.id, { text: '✅ Принято' });
      await bot.sendMessage(app.playerId, `✅ Ваша заявка принята администратором ${admM}!`, { parse_mode: 'HTML' });
    } else {
      await safeAQ(query.id, { text: '❌ Отклонено' });
      await bot.sendMessage(app.playerId, `❌ Ваша заявка отклонена администратором ${admM}.`, { parse_mode: 'HTML' });
    }
    try {
      await bot.editMessageText(
        `Заявка ${action === 'accept' ? '✅ принята' : '❌ отклонена'} ${admM}`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' }
      );
    } catch {}
    applications.delete(msgId);
    return;
  }

  // ЖАЛОБЫ
  if (data.startsWith('rep_')) {
    const parts    = data.split('_');
    const action   = parts[1];
    const reportId = parseInt(parts[2]);
    const rep      = reports.get(reportId);
    if (!rep) return safeAQ(query.id, { text: '❌ Жалоба не найдена', show_alert: true });
    const users = loadUsers();
    const re    = Object.entries(users).find(([, id]) => id === rep.reporterId);
    const repS  = re ? `<a href="tg://user?id=${rep.reporterId}">${escapeHTML(re[0])}</a>` : `<a href="tg://user?id=${rep.reporterId}">Автор</a>`;
    const te    = Object.entries(users).find(([n]) => n.toLowerCase() === (rep.targetNick || '').toLowerCase());
    const tarS  = te ? `<a href="tg://user?id=${te[1]}">${escapeHTML(te[0])}</a>` : escapeHTML(rep.targetNick || '?');

    if (action === 'review') {
      if (!admins.includes(username)) return safeAQ(query.id, { text: '❌ Только для администраторов', show_alert: true });
      rep.status = 'REVIEWED'; reports.set(reportId, rep);
      await safeAQ(query.id, { text: '⚡ Рассмотрена' });
      return bot.editMessageText(
        `📄 <b>Жалоба</b>\nОт: ${repS}\nНа: ${tarS}\nПричина: ${escapeHTML(rep.reason)}\n\n❗ <b>Статус:</b> ⚡ Рассмотрена`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
              { text: 'Закрыть ✅', callback_data: `rep_close_${reportId}` },
              { text: 'Оставить ↩️', callback_data: `rep_reopen_${reportId}` }
            ]]} }
      );
    }
    if (action === 'close') {
      if (query.from.id !== rep.reporterId) return safeAQ(query.id, { text: '❌ Только автор жалобы', show_alert: true });
      await safeAQ(query.id, { text: '✅ Закрыта' });
      try { await bot.deleteMessage(query.message.chat.id, query.message.message_id); } catch {}
      reports.delete(reportId);
      await bot.sendMessage(query.message.chat.id, `⚡ Жалоба ${repS} закрыта`, { parse_mode: 'HTML' });
      return;
    }
    if (action === 'reopen') {
      if (query.from.id !== rep.reporterId) return safeAQ(query.id, { text: '❌ Только автор жалобы', show_alert: true });
      rep.status = 'NEW'; reports.set(reportId, rep);
      await safeAQ(query.id, { text: '🔴 Возобновлена' });
      return bot.editMessageText(
        `📄 <b>Жалоба</b>\nОт: ${repS}\nНа: ${tarS}\nПричина: ${escapeHTML(rep.reason)}\n\n❗ <b>Статус:</b> 🔴 Не решена`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'Рассмотреть ⚡', callback_data: `rep_review_${reportId}` }]] } }
      );
    }
  }

  // ТИКЕТЫ
  if (data.startsWith('ticket_')) {
    const parts    = data.split('_');
    const action   = parts[1];
    const ticketId = parseInt(parts[2]);
    const ticket   = tickets.get(ticketId);
    if (!ticket) return safeAQ(query.id, { text: '❌ Тикет не найден', show_alert: true });
    const users = loadUsers();
    const pe    = Object.entries(users).find(([, id]) => id === ticket.playerId);
    const pStr  = pe ? `<a href="tg://user?id=${ticket.playerId}">${escapeHTML(pe[0])}</a>` : `<a href="tg://user?id=${ticket.playerId}">Игрок</a>`;

    if (action === 'review') {
      if (!admins.includes(username)) return safeAQ(query.id, { text: '❌ Только для администраторов', show_alert: true });
      ticket.status = 'REVIEWED'; tickets.set(ticketId, ticket);
      await safeAQ(query.id, { text: '⚡ Рассмотрен' });
      return bot.editMessageText(
        `📄 <b>Тикет</b>\nОт: ${pStr}\n📝 ${escapeHTML(ticket.description)}\n\n❗ <b>Статус:</b> ⚡ Рассмотрен`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
              { text: 'Закрыть ✅', callback_data: `ticket_close_${ticketId}` },
              { text: 'Возобновить ↩️', callback_data: `ticket_reopen_${ticketId}` }
            ]]} }
      );
    }
    if (action === 'close') {
      if (query.from.id !== ticket.playerId) return safeAQ(query.id, { text: '❌ Только автор тикета', show_alert: true });
      await safeAQ(query.id, { text: '✅ Закрыт' });
      try { await bot.deleteMessage(query.message.chat.id, query.message.message_id); } catch {}
      tickets.delete(ticketId);
      await bot.sendMessage(query.message.chat.id, `⚡ Тикет ${pStr} закрыт`, { parse_mode: 'HTML' });
      return;
    }
    if (action === 'reopen') {
      if (query.from.id !== ticket.playerId) return safeAQ(query.id, { text: '❌ Только автор тикета', show_alert: true });
      ticket.status = 'NEW'; tickets.set(ticketId, ticket);
      await safeAQ(query.id, { text: '🔴 Возобновлён' });
      return bot.editMessageText(
        `📄 <b>Тикет</b>\nОт: ${pStr}\n📝 ${escapeHTML(ticket.description)}\n\n❗ <b>Статус:</b> 🔴 Новый`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: 'Рассмотреть ⚡', callback_data: `ticket_review_${ticketId}` }]] } }
      );
    }
  }
});

// ============================================================
//  GRACEFUL SHUTDOWN
// ============================================================
process.on('SIGINT',  () => { bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });