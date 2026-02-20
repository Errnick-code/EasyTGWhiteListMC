# EasyTGWhiteListMC
Это исходный код и только так будет файл он подходит для закидывания на хост или локального запуска (белый айпи не требуется)
Не забудьте поменять юз главного админа на свой это тут:

const ADMIN_FILE = path.join(BOT_FOLDER, 'admins.json');
const MAIN_ADMIN = 'Errnick'; тут на ваш юз
let admins = [];

так же указать токен или токены ботов есть поддержка тестового:

// ------------------------
// Режим теста
// ------------------------
const TEST_MODE = 1; // 0 — основной бот, 1 — тестовый бот

const TOKENS = {
  main: 'YOUR_MAIN_BOT_TOKEN', основной
  test: 'YOUR_TEST_BOT_TOKEN' тестовый
};

и настроить RCON:

// =========================
// RCON SETTINGS
// =========================
const rconConfig = {
  host: 'your_rcon_host',
  port: 12345,
  password: 'YOUR_RCON_PASSWORD'
};

Так же бот различает пиратку и лицензию из заявки:

async function addToWhitelist(playerNick, playerType) {
  const cmd = playerType.toLowerCase().includes('пират')
    ? `easywhitelist add ${playerNick}` команда для пиратки
    : `whitelist add ${playerNick}`; для лицензии
  return sendRconCommand(cmd);
}

Для примера заявки можно написать "Заявка" в чат или !ЕС(не важно на русс или анг) то будет выведен весь список команд
для смены префиксов для вызова поменяйте эту настройку:
const PREFIXES = ['!EC', '!ЕС'];

Есть скидывание сборки по команде "!ЕС сборка" но толлько в формате .mrpack (для модринт и прочих лаунчеров)

По факту бот не только для майна если в игре есть RCON то он подойдёт
