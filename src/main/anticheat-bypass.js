/**
 * AnticheatBypass — обход античита для Mineflayer-ботов.
 *
 * Поддерживаемые античиты:
 *  - GrimAC (открытый, строгая детерминированная физика)
 *  - Vulcan (премиум, строгая таймер-проверка)
 *  - Intave (премиум, продвинутая эвристика)
 *  - Matrix (платный, анализ движений)
 *  - Spartan (платный, анализ пакетов)
 *
 * Целевые серверы: ReallyWorld, Spookytime, Funtime
 *
 * ВАЖНО о GrimAC/Vulcan:
 *  - Эти античиты используют детерминированную физику — они сами симулируют
 *    где должен быть игрок каждый тик и сравнивают с отправленными координатами.
 *  - НЕЛЬЗЯ добавлять X/Z-джиттер к position-пакетам — это сразу VL Speed/Position.
 *  - НЕЛЬЗЯ добавлять таймерный джиттер — GrimAC/Vulcan считают пакеты в секунду.
 *  - Можно добавлять микро-джиттер к yaw/pitch (взгляд) — не предсказывается.
 */

const log = require("electron-log");

const MAX_REACH = 4.5;
const LOOK_STEPS = 4;

// ── Утилиты ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Проверка дистанции до блока ──────────────────────────────────────────────

function isInReach(bot, blockPosition, maxReach) {
  if (!bot.entity || !blockPosition) return false;
  const dist = bot.entity.position.distanceTo(blockPosition);
  return dist <= (maxReach || MAX_REACH);
}

// ── Безопасное копание с взглядом на блок ────────────────────────────────────
//
// Перед копанием бот:
//   1. Смотрит на центр блока (как человек)
//   2. Проверяет прямую видимость (line of sight) через bot.canSeeBlock
//   3. Копает с задержкой между action-пакетами
//
async function safeDig(bot, block, opts) {
  if (!block || !bot.entity) return false;
  opts = opts || {};
  const reach = opts.reach || MAX_REACH;

  // Берём актуальный блок по координатам (мог смениться пока шли к нему)
  const refreshed = bot.blockAt(block.position);
  if (!refreshed || refreshed.name === "air" || refreshed.name === "cave_air") return false;
  if (!isInReach(bot, refreshed.position, reach)) {
    log.debug("[AnticheatBypass] safeDig: out of reach (" +
      bot.entity.position.distanceTo(refreshed.position).toFixed(2) + " блоков)");
    return false;
  }

  // ── Смотрим на центр блока перед копанием ──
  // Человек всегда смотрит на блок который копает.
  // Без lookAt бот отправляет dig-пакет НЕ глядя на блок → античит/сервер
  // регистрирует "hit air" и блок не разрушается.
  const center = refreshed.position.offset(0.5, 0.5, 0.5);
  await smoothLookAt(bot, center, false);
  await sleep(randInt(55, 90));

  // ── Проверяем видимость (line of sight) ──
  // Если блок за другим блоком — не копаем, идём ближе.
  try {
    if (typeof bot.canSeeBlock === "function" && !bot.canSeeBlock(refreshed)) {
      log.debug("[AnticheatBypass] safeDig: блок не виден (нет LOS)");
      return false;
    }
  } catch {}

  // ── Машем рукой (arm_animation) — большинство античитов требуют этот пакет ──
  // GrimAC/Intave проверяют: перед разрушением должен быть sent arm_animation.
  // Без него — "hitting air" (сервер отбрасывает пакет).
  try { bot.swingArm(); } catch {}
  await sleep(randInt(30, 60));

  // ── Копаем ──
  try {
    await bot.dig(refreshed);
    await sleep(randInt(50, 120));
    return true;
  } catch (err) {
    log.debug("[AnticheatBypass] safeDig error:", err.message);
    return false;
  }
}

// ── Плавный поворот головы ───────────────────────────────────────────────────

async function smoothLookAt(bot, targetPos, force) {
  if (!bot.entity || !targetPos) return;
  const steps = force ? 1 : randInt(LOOK_STEPS - 1, LOOK_STEPS + 1);
  const eyePos = bot.entity.position.offset(0, 1.62, 0);
  const dx = targetPos.x - eyePos.x;
  const dy = targetPos.y - eyePos.y;
  const dz = targetPos.z - eyePos.z;
  const targetYaw   = Math.atan2(-dx, dz);
  const targetPitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz));
  const startYaw   = bot.entity.yaw;
  const startPitch = bot.entity.pitch;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Микро-джиттер взгляда (≤ 0.009 рад ≈ 0.5°) — GrimAC не предсказывает взгляд
    let yaw   = startYaw   + (targetYaw   - startYaw)   * t + randFloat(-0.009, 0.009);
    let pitch = startPitch + (targetPitch - startPitch) * t + randFloat(-0.009, 0.009);
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    await bot.look(yaw, pitch, force || false).catch(() => {});
    await sleep(randInt(45, 55));
  }
}

// ── Случайная точка внутри хитбокса моба ────────────────────────────────────

function randomHitboxPoint(entity) {
  if (!entity || !entity.position) return null;
  const h = (entity.height || 1.8) * (0.75 + randFloat(-0.05, 0.1));
  return entity.position.offset(randFloat(-0.1, 0.1), h, randFloat(-0.1, 0.1));
}

// ── Патч пакетов движения (только look-джиттер, без position-джиттера) ────────
//
// ВАЖНО: для GrimAC и Vulcan НЕ добавляем:
//   • X/Z координатный джиттер — ломает детерминированную физику GrimAC
//   • Таймерный джиттер (setTimeout) — GrimAC/Vulcan считают пакетов/сек
//
// Добавляем только:
//   • Микро-джиттер yaw/pitch в look-пакетах (≤ 0.003 рад, не предсказывается)
//
function patchMovementPackets(bot) {
  try {
    const client = bot._client;
    if (!client) return;
    const origWrite = client.write.bind(client);

    client.write = function(name, data) {
      // Только look-пакеты получают микро-джиттер взгляда
      // position/position_look НЕ трогаем — GrimAC предсказывает позицию точно
      if (name === "look") {
        if (data.yaw !== undefined) {
          data = {
            ...data,
            yaw:   data.yaw   + randFloat(-0.003, 0.003),
            pitch: data.pitch + randFloat(-0.002, 0.002),
          };
        }
      }
      origWrite(name, data);
    };

    log.info("[AnticheatBypass] Патч пакетов движения применён (GrimAC-safe mode)");
  } catch (err) {
    log.warn("[AnticheatBypass] patchMovementPackets error:", err.message);
  }
}

// ── Патч спринта — задержка 1–2 тика ────────────────────────────────────────
//
// Vanilla: игрок нажимает Ctrl, спринт включается через 1-2 тика.
// Vulcan/GrimAC проверяют что спринт не включается мгновенно при изменении velocity.
//
function patchSprintDelay(bot) {
  try {
    const origSetControl = bot.setControlState.bind(bot);
    bot.setControlState = function(control, state) {
      if (control === "sprint" && state === true) {
        // 1–2 тика (50–100мс) — имитация нажатия Ctrl у человека
        setTimeout(() => origSetControl(control, state), randInt(50, 100));
        return;
      }
      origSetControl(control, state);
    };
    log.info("[AnticheatBypass] Патч задержки спринта применён");
  } catch (err) {
    log.warn("[AnticheatBypass] patchSprintDelay error:", err.message);
  }
}

// ── Обработчик rubber-band (откат позиции от сервера) ─────────────────────────
//
// GrimAC/Vulcan: после forcedMove нужно немедленно остановить движение
// и подтвердить новую позицию прежде чем двигаться дальше.
//
function setupForcedMoveHandler(bot, instance) {
  let _forcedMoveTimer = null;
  bot.on("forcedMove", () => {
    try { bot.pathfinder?.stop(); } catch {}
    try { bot.clearControlStates(); } catch {}
    try { bot.setControlState("jump",   false); } catch {}
    try { bot.setControlState("sprint", false); } catch {}

    instance._antiCheatCooldownUntil = Date.now() + 1200;

    if (_forcedMoveTimer) clearTimeout(_forcedMoveTimer);
    _forcedMoveTimer = setTimeout(() => {
      if (instance._antiCheatCooldownUntil > 0 && Date.now() < instance._antiCheatCooldownUntil) {
        instance._antiCheatCooldownUntil = 0;
      }
    }, 1300);

    log.debug("[AnticheatBypass] forcedMove: кулдаун 1.2с");
  });
}

// ── Маскировка пакетов при входе на сервер ───────────────────────────────────
//
// Вызывается СРАЗУ после mineflayer.createBot(), ДО _attachEvents.
// НЕ вызывается для localhost/127.0.0.1 — локальному серверу маскировка
// не нужна и задержка settings может мешать быстрому локальному подключению.
//
// Что делает:
//   1. brand "mineflayer" → "vanilla"
//   2. settings-пакет задерживается на 120–450 мс (снижено с 1250мс — серверы
//      требуют settings быстро иначе кикают при загрузке мира)
//   3. locale и viewDistance рандомизируются
//
function initLoginMasking(bot) {
  try {
    const client = bot._client;
    if (!client) {
      setTimeout(() => initLoginMasking(bot), 10);
      return;
    }

    const origWrite = client.write.bind(client);
    let brandMasked    = false;
    let settingsMasked = false;

    client.write = function(name, data) {

      // ── 1. Brand: "mineflayer" → "vanilla" ────────────────────────────────
      if (!brandMasked &&
          (name === "plugin_message" || name === "custom_payload") &&
          data?.channel === "minecraft:brand") {
        brandMasked = true;
        const brand = "vanilla";
        const buf = Buffer.allocUnsafe(1 + brand.length);
        buf[0] = brand.length;       // varint: 1 байт для коротких строк
        buf.write(brand, 1, "utf8");
        log.info("[LoginMask] brand: mineflayer → vanilla");
        return origWrite(name, { ...data, data: buf });
      }

      // ── 2. Settings: задержка 120–450мс + рандомизация ────────────────────
      // Снижено с 1250мс! Некоторые серверы кикают если settings не получен
      // в течение первых 500мс — это вызывало "загрузка начинается и прекращается".
      if (!settingsMasked && name === "settings") {
        settingsMasked = true;
        const delay   = randInt(120, 450);
        const locales = ["en_US", "ru_RU", "uk_UA", "en_GB", "de_DE"];
        const patched = {
          ...data,
          locale:       locales[randInt(0, locales.length - 1)],
          viewDistance: randInt(8, 12),
          chatMode:     0,
          chatColors:   true,
          skinParts:    randInt(121, 127),
          mainHand:     1,
        };
        log.info(`[LoginMask] settings delayed ${delay}ms | locale=${patched.locale} view=${patched.viewDistance}`);
        setTimeout(() => { try { origWrite(name, patched); } catch {} }, delay);
        return;
      }

      origWrite(name, data);
    };

    log.info("[LoginMask] Маскировка пакетов входа активирована");
  } catch (err) {
    log.warn("[LoginMask] initLoginMasking error:", err.message);
  }
}

// ── Случайный осмотр после спавна ────────────────────────────────────────────
//
// 2–4 случайных поворота головы в первые 2–4 секунды.
// Имитирует живого игрока который оглядывается при заходе на сервер.
//
async function doSpawnLookAround(bot) {
  try {
    const turns = randInt(2, 4);
    for (let i = 0; i < turns; i++) {
      await sleep(randInt(350, 950));
      if (!bot.entity) return;
      await bot.look(
        randFloat(-Math.PI, Math.PI),
        randFloat(-0.4, 0.3),
        false
      ).catch(() => {});
    }
  } catch {}
}

// ── Keepalive-пакеты во время загрузки мира ──────────────────────────────────
//
// Vanilla-клиент отвечает на keep_alive и подтверждает teleport_confirm
// даже во время экрана "Загрузка мира".
// Mineflayer делает это автоматически, но на некоторых серверах нужно
// также подтвердить свою позицию быстро после получения первого position.
//
// Этот обработчик вешается на bot._client ДО spawn-эвента.
//
function setupLoadingTerrainHandler(bot) {
  try {
    const client = bot._client;
    if (!client) return;

    // Vanilla клиент подтверждает КАЖДЫЙ position-пакет через teleport_confirm.
    // Старый код использовал флаг positionConfirmed = true после первого пакета,
    // из-за чего все последующие position-пакеты (например, при BungeeCord-трансфере
    // на игровой под-сервер) оставались неподтверждёнными → сервер кикал бота
    // за "phantom coordinates" / бот не мог двигаться после телепорта.
    // Исправление: подтверждаем каждый уникальный teleportId ровно один раз.
    const confirmedIds = new Set();
    client.on("position", (packet) => {
      if (packet.teleportId === undefined) return;
      if (confirmedIds.has(packet.teleportId)) return;
      confirmedIds.add(packet.teleportId);
      try {
        client.write("teleport_confirm", { teleportId: packet.teleportId });
      } catch {}
      log.debug("[LoadingTerrain] teleport_confirm sent, teleportId=" + packet.teleportId);
    });

    log.info("[AnticheatBypass] Loading terrain handler установлен");
  } catch (err) {
    log.warn("[AnticheatBypass] setupLoadingTerrainHandler error:", err.message);
  }
}

// ── safeGoto ──────────────────────────────────────────────────────────────────

async function safeGoto(bot, instance, goal, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  if (instance._antiCheatCooldownUntil && Date.now() < instance._antiCheatCooldownUntil) {
    const wait = instance._antiCheatCooldownUntil - Date.now();
    log.debug("[AnticheatBypass] safeGoto: ждём кулдаун " + wait + "мс");
    await sleep(wait + randInt(50, 150));
  }
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      sleep(timeoutMs).then(() => { throw new Error("goto timeout"); }),
    ]);
    await sleep(randInt(80, 150));
    return true;
  } catch (err) {
    if (err.message !== "goto timeout") log.debug("[AnticheatBypass] safeGoto error:", err.message);
    return false;
  }
}

// ── Инициализация в spawn-обработчике ────────────────────────────────────────

function initAnticheatBypass(bot, instance) {
  patchMovementPackets(bot);
  patchSprintDelay(bot);
  setupForcedMoveHandler(bot, instance);
  log.info("[AnticheatBypass] Модуль инициализирован для бота", instance.id);
}

module.exports = {
  initAnticheatBypass,
  initLoginMasking,
  doSpawnLookAround,
  setupLoadingTerrainHandler,
  safeDig,
  safeGoto,
  smoothLookAt,
  randomHitboxPoint,
  isInReach,
  randInt,
  randFloat,
  sleep,
  MAX_REACH,
};
