const TelegramBot = require('node-telegram-bot-api');
const { Rcon } = require('rcon-client');
const fs = require('fs');
const path = require('path');

// ------------------------
// Режим теста
// ------------------------
const TEST_MODE = 1; // 0 — основной бот, 1 — тестовый бот

const TOKENS = {
  main: 'YOUR_MAIN_BOT_TOKEN',
  test: 'YOUR_TEST_BOT_TOKEN'
};

// ------------------------
// Настройки чата
// ------------------------
const chatId = 0;

// ------------------------
// Папка для JSON и сборок
// ------------------------
const BOT_FOLDER = path.join(__dirname, 'BotFile');
if (!fs.existsSync(BOT_FOLDER)) fs.mkdirSync(BOT_FOLDER);

// ------------------------
// Админы
// ------------------------
const ADMIN_FILE = path.join(BOT_FOLDER, 'admins.json');
const MAIN_ADMIN = 'Errnick';
let admins = [];

if (!fs.existsSync(ADMIN_FILE)) {
  fs.writeFileSync(ADMIN_FILE, JSON.stringify([MAIN_ADMIN], null, 2));
}
admins = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));

// ------------------------
// Пользователи
// ------------------------
const USERS_FILE = path.join(BOT_FOLDER, 'users.json');
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
}

// =========================
// Бот Telegram
// =========================
const token = TEST_MODE === 1 ? TOKENS.test : TOKENS.main;

// Создаем бота один раз
const bot = new TelegramBot(token, { polling: true });
bot.on('polling_error', console.error);
console.log(`Бот запущен в ${TEST_MODE === 1 ? 'тестовом' : 'основном'} режиме`);

// JSON функции
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// =========================
// Хелперы
// =========================
function escapeHTML(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getMention(user) {
  if (user.username) return `@${user.username}`;
  return `<a href="tg://user?id=${user.id}">${escapeHTML(user.first_name)}</a>`;
}

// =========================
// RCON SETTINGS
// =========================
const rconConfig = {
  host: 'your_rcon_host',
  port: 12345,
  password: 'YOUR_RCON_PASSWORD'
};

// =========================
// RCON FUNCTIONS
// =========================
async function sendRconCommand(cmd) {
  const rcon = new Rcon(rconConfig);
  try {
    await rcon.connect();
    const resp = await rcon.send(cmd);
    await rcon.end();
    return resp;
  } catch (err) {
    console.error('RCON ошибка:', err);
    return null;
  }
}

async function addToWhitelist(playerNick, playerType) {
  const cmd = playerType.toLowerCase().includes('пират')
    ? `easywhitelist add ${playerNick}`
    : `whitelist add ${playerNick}`;
  return sendRconCommand(cmd);
}

async function removeFromWhitelist(nick) {
  await sendRconCommand(`whitelist remove ${nick}`);
  return sendRconCommand(`easywhitelist remove ${nick}`);
}

async function getWhitelist() {
  return sendRconCommand('whitelist list');
}

// =========================
// Хранение заявок
// =========================
const applications = new Map(); // key: message_id, value: { nick, type, playerId }
// =========================
// Хранение жалоб
// =========================
const reports = new Map(); // key: message_id, value: { reporterId, targetNick, reason }

// =========================
// SAFE SEND (анти 400 reply)
// =========================
async function sendSafe(msg, text, options = {}) {
  try {
    return await bot.sendMessage(msg.chat.id, text, {
      reply_to_message_id: msg.message_id,
      message_thread_id: msg.message_thread_id,
      ...options
    });
  } catch (err) {
    if (err.response?.body?.description?.includes('message to be replied not found')) {
      return bot.sendMessage(msg.chat.id, text, {
        message_thread_id: msg.message_thread_id,
        ...options
      });
    }
    console.error('Telegram error:', err.message);
  }
}

// =========================
// SAFE CALLBACK (аналог sendSafe для кнопок)
// =========================
async function safeAnswerQuery(id, options) {
  try {
    await bot.answerCallbackQuery(id, options);
  } catch (err) {
    if (err.code === 'ETELEGRAM' && err.response?.body?.description?.includes('query is too old')) {
      console.warn('Старый callback_query проигнорирован');
    } else {
      console.error('Ошибка callback_query:', err.message);
    }
  }
}
// =========================
// ОБРАБОТКА СООБЩЕНИЙ
// =========================
const PREFIXES = ['!EC', '!ЕС'];

bot.on('message', async (msg) => {
  if (!msg.text || msg.from.is_bot) return;
  if (msg.chat.id !== chatId) return;

  const rawText = msg.text.trim();
  const txt = rawText.toLowerCase();
  const username = msg.from.username;
  const isAdmin = admins.includes(username);
  const users = loadUsers();

  // --- Проверка ника ---
  if (txt.startsWith('проверить')) {
    const args = msg.text.trim().split(/\s+/).slice(1);
    const nickToCheck = args[0];
    if (!nickToCheck) return sendSafe(msg, `❗ Укажите ник для проверки, например:\nпроверить Errnick_`);

    const tgId = users[nickToCheck];
    const boundInfo = tgId
      ? `<a href="tg://user?id=${tgId}">${escapeHTML(nickToCheck)}</a>`
      : '❌ Не найден в базе';

    let serverInfo = '❌ Не найден на сервере';
    try {
      const whitelistRaw = await getWhitelist();
      if (whitelistRaw && whitelistRaw.includes(nickToCheck)) serverInfo = '✅ Есть на сервере';
    } catch (err) {
      serverInfo = `❌ Ошибка при проверке сервера: ${escapeHTML(err.message)}`;
    }

    return sendSafe(msg,
      `🔍 Проверка ника: <b>${escapeHTML(nickToCheck)}</b>\n` +
      `📄 Привязан к: ${boundInfo}\n` +
      `🖥 На сервере: ${serverInfo}`,
      { parse_mode: 'HTML' }
    );
  }

  // --- Информация о боте ---
  if (txt.toLowerCase() === 'инфо') {
    return sendSafe(
      msg,
      `ℹ️ <b>Информация о боте</b>\n\n` +
      `👤 <b>Автор:</b> Errnick_\n` +
      `📦 <b>Версия:</b> 1.0.4\n\n` +
      `💬 <b>Telegram:</b> <a href="https://t.me/Errnick_code">Инфо о разработке и т.д.</a>\n` +
      `💻 <b>GitHub:</b> <a href="https://github.com/Errnick-code/EasyTGWhiteListMC">Исходный код</a>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }

  // --- Список игроков ---
  if (txt === 'список') {
    const entries = Object.entries(users);
    if (!entries.length) return sendSafe(msg, `<b>Whitelist игроков:</b>\nПусто`, { parse_mode: 'HTML' });

    const listText = entries.map(([nick, tgId]) => `🔹 <a href="tg://user?id=${tgId}">${escapeHTML(nick)}</a>`).join('\n');
    return sendSafe(msg, `<b>Whitelist игроков:</b>\n${listText}`, { parse_mode: 'HTML' });
  }

  // --- Узнать свой ник ---
  if (txt === 'мой ник') {
    const fromId = msg.from.id;
    const foundEntry = Object.entries(users).find(([nick, tgId]) => tgId === fromId);
    if (foundEntry) return sendSafe(msg, `🔹 Ваш ник на сервере: <b>${escapeHTML(foundEntry[0])}</b>`, { parse_mode: 'HTML' });
    return sendSafe(msg, `❌ Ваш ник не найден в базе данных сервера`, { parse_mode: 'HTML' });
  }

  // --- Узнать чужой ник (или свой, если ответ) ---
  if (txt === 'ник') {
    const targetId = msg.reply_to_message?.from.id || msg.from.id;
    const mention = msg.reply_to_message ? `Ник игрока ${getMention(msg.reply_to_message.from)}` : 'Ваш ник';
    const foundEntry = Object.entries(users).find(([nick, tgId]) => tgId === targetId);

    if (foundEntry) return sendSafe(msg, `🔹 ${mention}: <b>${escapeHTML(foundEntry[0])}</b>`, { parse_mode: 'HTML' });
    return sendSafe(msg, `❌ Ник не найден в базе данных сервера`, { parse_mode: 'HTML' });
  }

  // --- Подсказка по заявке ---
  if (txt === 'заявка') {
    return sendSafe(msg,
      `📄 Чтобы подать заявку, напишите её одним сообщением в формате:\n\n` +
      `Заявка\n` +
      `Ник в Minecraft\n` +
      `Лицензия / пиратка\n` +
      `Возраст\n` +
      `Откуда узнали о сервере\n` +
      `Чем будете заниматься\n` +
      `Почему выбрали наш сервер\n\n` +
      `Пример:\nЗаявка\nErrnick_\nЛицензия\n16\nDiscord\nИграть и помогать новичкам\nДружелюбная атмосфера`,
      { parse_mode: 'HTML' }
    );
  }

  // --- Обработка заявки ---
  if (txt.startsWith('заявка')) {
    const afterKeyword = rawText.slice(6).trim();
    const lines = afterKeyword.split(/\r?\n/).map(l => l.trim()).filter(l => l);

    if (lines.length !== 6) {
      return sendSafe(msg,
        `❗ ${getMention(msg.from)}, заявка неполная. Должно быть 7 строк:\n` +
        `Заявка\nНик\nЛицензия / пиратка\nВозраст\nОткуда узнали\nЧем будете заниматься\nПочему выбрали сервер`,
        { parse_mode: 'HTML' }
      );
    }

    const [nick, type, age, source, activity, reason] = lines;

    if (!/^[a-zA-Z0-9_]+$/.test(nick)) return sendSafe(msg, `❗ ${getMention(msg.from)}, ник должен содержать только английские буквы, цифры и _`, { parse_mode:'HTML' });
    if (nick.length < 3 || nick.length > 16) return sendSafe(msg, `❗ ${getMention(msg.from)}, ник должен быть 3–16 символов`, { parse_mode:'HTML' });
    if (users[nick]) return sendSafe(msg, `❌ Ник <b>${escapeHTML(nick)}</b> уже занят`, { parse_mode:'HTML' });

    const playerMention = getMention(msg.from);
    const applicationText =
      `🔐 <b>Новая заявка / WhiteList</b>\n\n` +
      `От: ${playerMention}\n\n` +
      `🧑 Ник: ${escapeHTML(nick)}\n` +
      `💻 Тип: ${escapeHTML(type)}\n` +
      `🎂 Возраст: ${escapeHTML(age)}\n` +
      `🌐 Откуда: ${escapeHTML(source)}\n` +
      `🎯 План: ${escapeHTML(activity)}\n` +
      `❓ Причина: ${escapeHTML(reason)}`;

    applications.set(msg.message_id, { nick, type, playerId: msg.from.id });

    return sendSafe(msg, applicationText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Добавить ✅', callback_data: `add_${msg.message_id}` },
            { text: 'Отказать ❌', callback_data: `deny_${msg.message_id}` }]
        ]
      }
    });
  }

  // --- Обработка жалобы ---
  // --- Жалоба ---
  if (txt.startsWith('жалоба')) {
    const afterKeyword = rawText.slice(6).trim();
    const lines = afterKeyword.split(/\r?\n/).map(l => l.trim()).filter(l => l);

    if (lines.length !== 2) {
      return sendSafe(msg, `❗ ${getMention(msg.from)}, заполните жалобу корректно: две строки\nНа ник\nПричина`, { parse_mode: 'HTML' });
    }

    const [targetNickRaw, reason] = lines;
    const reporterId = msg.from.id;

    // Проверяем, что автор есть в базе
    const reporterExists = Object.values(users).includes(reporterId);
    if (!reporterExists) return sendSafe(msg, `❌ ${getMention(msg.from)}, вы не можете писать жалобы, вас нет в базе`, { parse_mode: 'HTML' });

    // Цель кликабельная, если есть в базе
    let targetNick = escapeHTML(targetNickRaw);
    const targetEntry = Object.entries(users).find(([nick]) => nick.toLowerCase() === targetNickRaw.toLowerCase());
    if (targetEntry) {
      const [nick, tgId] = targetEntry;
      targetNick = `<a href="tg://user?id=${tgId}">${escapeHTML(nick)}</a>`;
    }
    const reporterEntry = Object.entries(users).find(([nick, tgId]) => tgId === reporterId);
    let reporterNick = reporterEntry ? `<a href="tg://user?id=${reporterId}">${escapeHTML(reporterEntry[0])}</a>` : getMention(msg.from);

    const reportText =
      `📄 <b>Жалоба</b>\n` +
      `От: ${reporterNick}\n` +
      `На: ${targetNick}\n` +
      `Причина: ${escapeHTML(reason)}\n\n` +
      `❗ <b>Статус:</b> 🔴 Не решена`;

    // Сохраняем жалобу
    reports.set(msg.message_id, { reporterId, targetNickRaw, reason, status: 'NEW' });

    // Кнопки для админа
    const inlineKeyboard = [
      [{ text: 'Рассмотреть ⚡', callback_data: `rep_review_${msg.message_id}` }]
    ];

    return sendSafe(msg, reportText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
  }

  // --- Команды с префиксом ---
  const isCommand = PREFIXES.some(p => rawText.toUpperCase().startsWith(p.toUpperCase()));
  if (!isCommand) return;

  const prefix = PREFIXES.find(p => rawText.toUpperCase().startsWith(p.toUpperCase()));
  const withoutPrefix = rawText.slice(prefix.length).trim();
  const [command, ...rest] = withoutPrefix.split(/\s+/);
  const bodyText = rest.join(' ').trim();
  const args = bodyText.split(/\s+/);

// --- Список доступных команд ---
  if (!command) {
    const cmds = [
      'заявка(без !EC)  - создать заявку на whitelist',
      'жалоба(без !EC)  - оставить жалобу на игрока',
      'список(без !EC)  - список игроков',
      'проверить [ник] (без !EC)  - проверка ника',
      'админы - показать список админов',
      'сайт - перейти на магазин/донат',
      'мой ник(без !EC) - покажет ваш ник на сервере',
      'ник(без !EC, в ответ на соо) - покажет ник того на чьё сообщение вы ответили',
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
      `💻 <b>GitHub:</b> <a href="https://github.com/Errnick-code/EasyTGWhiteListMC">Исходный код бота</a>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );
  }

// --- Остальные команды ---
  if (command === 'убрать') {
    if (!isAdmin) return sendSafe(msg, `❌ Только админ может использовать эту команду`);
    const nick = args[0];
    if (!nick) return;
    await removeFromWhitelist(nick);
    return sendSafe(msg, `❌ Ник ${escapeHTML(nick)} удалён из whitelist админом @${username}`, { parse_mode: 'HTML' });
  }

  if (command === 'сборка') {
    if (!isAdmin) return sendSafe(msg, `❌ Только админ может использовать эту команду`);
    const files = fs.readdirSync(BOT_FOLDER).filter(f => f.endsWith('.mrpack'));
    if (!files.length) return sendSafe(msg, `❌ Файл сборки не найден в папке BotFile`);
    const filePath = path.join(BOT_FOLDER, files[0]);
    await sendSafe(msg, `📦 Сборка сервера:`);
    return bot.sendDocument(msg.chat.id, filePath, {}, { filename: files[0], contentType: 'application/octet-stream' });
  }

  if (command.toLowerCase() === 'админ') {
    if (!isAdmin) return sendSafe(msg, `❌ Только админ может использовать эту команду`);

    const [subCommand, targetMention] = bodyText.split(/\s+/);
    if (!subCommand || !['add','remove'].includes(subCommand.toLowerCase())) return;
    if (!targetMention || !targetMention.startsWith('@')) return;

    const targetUsername = targetMention.slice(1);

    if (subCommand.toLowerCase() === 'add') {
      if (!admins.includes(targetUsername)) admins.push(targetUsername);
      fs.writeFileSync(ADMIN_FILE, JSON.stringify(admins, null, 2));
      return sendSafe(msg, `✅ Пользователь @${targetUsername} добавлен в админы`);
    }
    if (subCommand.toLowerCase() === 'remove') {
      if (targetUsername === MAIN_ADMIN) return;
      admins = admins.filter(u => u !== targetUsername);
      fs.writeFileSync(ADMIN_FILE, JSON.stringify(admins, null, 2));
      return sendSafe(msg, `❌ Пользователь @${targetUsername} удалён из админов`);
    }
  }

  if (command === 'сайт') return sendSafe(msg, `🌐 Наш магазин / донат: https://errnicraft.cdonate.ru/#shop`);
  if (command === 'админы') return sendSafe(msg, `<b>Список админов:</b>\n${admins.map(a => '@'+a).join('\n')}`, { parse_mode: 'HTML' });

  if (command === 'команда') {
    if (!isAdmin) {
      return sendSafe(msg, '❌ Только админ может использовать эту команду');
    }

    // Берём все строки после !ЕС команда
    const cmds = bodyText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (!cmds.length) return sendSafe(msg, '❌ Укажите хотя бы одну команду для RCON');

    // Отправляем команды по очереди
    for (const cmd of cmds) {
      await sendRconCommand(cmd);
    }

    return sendSafe(
      msg,
      `✅ ${cmds.length} команд(ы) успешно отправлены на сервер:\n` +
      cmds.map(c => `<code>${escapeHTML(c)}</code>`).join('\n'),
      { parse_mode: 'HTML' }
    );
  }
// --- !EC добавить / удалить ---
  if (['добавить','удалить'].includes(command)) {
    if (!isAdmin) return sendSafe(msg, `❌ Только админ может использовать эту команду`);
    const lines = bodyText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const replyId = msg.reply_to_message?.from.id;

    // --- Добавить ---
    if (command === 'добавить') {
      const nick = lines[0]?.replace(/[^a-zA-Z0-9_]/g, '');
      const license = lines[1] || 'Лицензия';
      if (!nick) return sendSafe(msg, `❗ ${getMention(msg.from)}, укажите ник игрока`);
      if (nick.length < 3 || nick.length > 16) return sendSafe(msg, `❗ ${getMention(msg.from)}, ник должен быть длиной 3–16 символов`);
      if (!replyId) return sendSafe(msg, `❗ ${getMention(msg.from)}, нужно ответить на сообщение игрока для привязки Telegram ID`);

      try {
        const rconResult = await addToWhitelist(nick, license);
        const users = loadUsers();
        users[nick] = replyId;
        saveUsers(users);

        return sendSafe(msg, `✅ Игрок ${escapeHTML(nick)} (${license}) добавлен в whitelist\n📄 RCON: ${escapeHTML(rconResult || 'Нет ответа')}`, { parse_mode: 'HTML' });
      } catch (err) {
        return sendSafe(msg, `❌ Ошибка при добавлении: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' });
      }
    }

    // --- Удалить ---
    if (command === 'удалить') {
      let nickToRemove = lines[0];
      if (!nickToRemove && replyId) {
        const users = loadUsers();
        const found = Object.entries(users).find(([nick, id]) => id === replyId);
        if (!found) return sendSafe(msg, `❌ Ник этого игрока не найден в базе`);
        nickToRemove = found[0];
      }
      if (!nickToRemove) return sendSafe(msg, `❗ ${getMention(msg.from)}, укажите ник или ответьте на сообщение игрока`);

      try {
        const rconWhitelist = await sendRconCommand(`whitelist remove ${nickToRemove}`);
        const rconEasy = await sendRconCommand(`easywhitelist remove ${nickToRemove}`);
        const users = loadUsers();
        delete users[nickToRemove];
        saveUsers(users);

        return sendSafe(msg, `❌ Игрок ${escapeHTML(nickToRemove)} удалён из whitelist\n📄 RCON:\nWhitelist: ${escapeHTML(rconWhitelist || 'Нет ответа')}\nEasyWhitelist: ${escapeHTML(rconEasy || 'Нет ответа')}`, { parse_mode: 'HTML' });
      } catch (err) {
        return sendSafe(msg, `❌ Ошибка при удалении: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' });
      }
    }
  }
});
// =========================
// CALLBACK QUERY (заявки и жалобы)
// =========================
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatIdForReply = query.message.chat.id;
  const threadId = query.message.message_thread_id;
  const username = query.from.username;
  const userId = query.from.id;

  // -------------------------
  // 1️⃣ Обработка заявок
  // -------------------------
  if (data.startsWith('add_') || data.startsWith('deny_')) {
    // Только админ может нажимать
    if (!admins.includes(username)) {
      return safeAnswerQuery(query.id, { text: '❌ Только админ может нажимать кнопки заявок', show_alert: true });
    }

    const [action, msgIdStr] = data.split('_');
    const messageId = parseInt(msgIdStr);
    const app = applications.get(messageId);

    if (!app) return safeAnswerQuery(query.id, { text: '❌ Заявка не найдена или уже обработана', show_alert: true });

    const { nick: playerNick, type: playerType, playerId } = app;
    const adminMention = `@${username}`;
    const playerMention = `<a href="tg://user?id=${playerId}">${escapeHTML(playerNick)}</a>`;

    if (action === 'add') {
      safeAnswerQuery(query.id, { text: 'Заявка одобрена ✅' });
      try {
        await addToWhitelist(playerNick, playerType);
        const users = loadUsers();
        users[playerNick] = playerId;
        saveUsers(users);

        await sendSafe(
          { chat: { id: chatIdForReply }, message_id: query.message.message_id, message_thread_id: threadId },
          `${playerMention}, ваша заявка принята админом ${adminMention} ✅`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        await sendSafe(
          { chat: { id: chatIdForReply }, message_id: query.message.message_id, message_thread_id: threadId },
          `${playerMention}, ошибка при добавлении в whitelist: ${escapeHTML(err.message)}`,
          { parse_mode: 'HTML' }
        );
      }
    }

    if (action === 'deny') {
      safeAnswerQuery(query.id, { text: 'Заявка отклонена ❌' });
      await sendSafe(
        { chat: { id: chatIdForReply }, message_id: query.message.message_id, message_thread_id: threadId },
        `${playerMention}, ваша заявка отклонена админом ${adminMention} ❌`,
        { parse_mode: 'HTML' }
      );
    }

    // Удаляем сообщения и заявку из памяти
    try { await bot.deleteMessage(chatIdForReply, messageId); } catch {}
    try { await bot.deleteMessage(chatIdForReply, query.message.message_id); } catch {}
    applications.delete(messageId);
    return;
  }

  // -------------------------
  // 2️⃣ Обработка жалоб
  // -------------------------
  if (data.startsWith('rep_')) {
    const parts = data.split('_');
    const action = parts[1]; // review / close / reopen
    const reportId = parseInt(parts[2]);
    const rep = reports.get(reportId);
    if (!rep) return safeAnswerQuery(query.id, { text: '❌ Жалоба не найдена или уже удалена', show_alert: true });

    const adminUsername = query.from.username;  // <-- для админа
    const userId = query.from.id;               // <-- для автора

    const users = loadUsers();

    // Ник автора из базы
    const reporterEntry = Object.entries(users).find(([nick, tgId]) => tgId === rep.reporterId);
    let reporterNick = reporterEntry ? `<a href="tg://user?id=${rep.reporterId}">${escapeHTML(reporterEntry[0])}</a>` : getMention({id: rep.reporterId, first_name: 'Автор'});

    // Ник цели
    const targetEntry = Object.entries(users).find(([nick]) => nick.toLowerCase() === rep.targetNickRaw.toLowerCase());
    let targetNick = escapeHTML(rep.targetNickRaw);
    if (targetEntry) {
      const [nick, tgId] = targetEntry;
      targetNick = `<a href="tg://user?id=${tgId}">${escapeHTML(nick)}</a>`;
    }

    // --- Рассмотрение админом ---
    if (action === 'review') {
      if (!admins.includes(adminUsername)) return safeAnswerQuery(query.id, { text: '❌ Только админ может рассматривать', show_alert: true });
      rep.status = 'REVIEWED';
      reports.set(reportId, rep);

      await safeAnswerQuery(query.id, { text: 'Жалоба помечена как рассмотренная ⚡' });

      const reportText =
        `📄 <b>Жалоба</b>\n` +
        `От: ${reporterNick}\n` +
        `На: ${targetNick}\n` +
        `Причина: ${escapeHTML(rep.reason)}\n\n` +
        `❗ <b>Статус:</b> ⚡ Рассмотрена / ещё не закрыта автором`;

      await bot.editMessageText(reportText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Закрыть ✅', callback_data: `rep_close_${reportId}` },
              { text: 'Оставить открытой ↩️', callback_data: `rep_reopen_${reportId}` }
            ]
          ]
        }
      });
      return;
    }

    // --- Закрытие автором ---
    if (action === 'close') {
      if (userId !== rep.reporterId) return safeAnswerQuery(query.id, { text: '❌ Только автор жалобы может закрыть', show_alert: true });
      rep.status = 'CLOSED';
      reports.set(reportId, rep);

      await safeAnswerQuery(query.id, { text: 'Жалоба закрыта ✅' });
      try { await bot.deleteMessage(query.message.chat.id, reportId); } catch {}
      try { await bot.deleteMessage(query.message.chat.id, query.message.message_id); } catch {}
      reports.delete(reportId);
      return;
    }

    // --- Возобновление автором ---
    if (action === 'reopen') {
      if (userId !== rep.reporterId) return safeAnswerQuery(query.id, { text: '❌ Только автор жалобы может возобновить', show_alert: true });
      rep.status = 'NEW';
      reports.set(reportId, rep);

      await safeAnswerQuery(query.id, { text: 'Жалоба возобновлена 🔴' });

      const reportText =
        `📄 <b>Жалоба</b>\n` +
        `От: ${reporterNick}\n` +
        `На: ${targetNick}\n` +
        `Причина: ${escapeHTML(rep.reason)}\n\n` +
        `❗ <b>Статус:</b> 🔴 Не решена`;

      await bot.editMessageText(reportText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Рассмотреть ⚡', callback_data: `rep_review_${reportId}` }]
          ]
        }
      });
      return;
    }
  }
});