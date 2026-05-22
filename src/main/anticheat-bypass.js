/**
 * AnticheatBypass — обход античита для Mineflayer-ботов.
 *
 * Фиксит:
 *  - "Фантомные координаты": копание блока после rubber-band откатa позиции
 *  - Идеальные тайминги движения, поворота, кликов
 *  - Мгновенное ускорение/торможение без инерции
 *  - Детектируемый brand "mineflayer" → маскируем в "vanilla"
 *  - Мгновенный settings-пакет → задерживаем 450–1250мс + рандомизируем
 *  - Стационарный начальный взгляд → добавляем случайный осмотр после спавна
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

// ── Безопасное копание с проверкой позиции ───────────────────────────────────

async function safeDig(bot, block, opts) {
  if (!block || !bot.entity) return false;
  opts = opts || {};
  const reach = opts.reach || MAX_REACH;
  const refreshed = bot.blockAt(block.position);
  if (!refreshed || refreshed.name === "air" || refreshed.name === "cave_air") return false;
  if (!isInReach(bot, refreshed.position, reach)) {
    log.debug("[AnticheatBypass] safeDig: out of reach (" +
      bot.entity.position.distanceTo(refreshed.position).toFixed(2) + " блоков)");
    return false;
  }
  await sleep(randInt(45, 65));
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

// ── Патч пакетов движения (джиттер позиции и таймингов) ──────────────────────

function patchMovementPackets(bot) {
  try {
    const client = bot._client;
    if (!client) return;
    const origWrite = client.write.bind(client);
    client.write = function(name, data) {
      if (name === "position" || name === "position_look" || name === "look") {
        if (data.x !== undefined) {
          data.x = Math.round(data.x * 1000) / 1000 + randFloat(-0.001, 0.001);
          data.y = Math.round(data.y * 1000) / 1000;
          data.z = Math.round(data.z * 1000) / 1000 + randFloat(-0.001, 0.001);
        }
        const jitter = randInt(0, 4);
        if (jitter > 0) {
          setTimeout(() => origWrite(name, data), jitter);
          return;
        }
      }
      origWrite(name, data);
    };
    log.info("[AnticheatBypass] Патч пакетов движения применён");
  } catch (err) {
    log.warn("[AnticheatBypass] patchMovementPackets error:", err.message);
  }
}

// ── Патч спринта — задержка 1–2 тика перед включением ───────────────────────

function patchSprintDelay(bot) {
  try {
    const origSetControl = bot.setControlState.bind(bot);
    bot.setControlState = function(control, state) {
      if (control === "sprint" && state === true) {
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

// ── Обработчик rubber-band ────────────────────────────────────────────────────

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

// ── Маскировка пакетов при входе ─────────────────────────────────────────────
//
// Вызывается СРАЗУ после mineflayer.createBot(), ДО _attachEvents.
// Перехватывает client.write и:
//   • brand "mineflayer" → "vanilla"
//   • settings-пакет задерживается на 450–1250 мс, locale/viewDistance рандомизируются
//
function initLoginMasking(bot) {
  try {
    const client = bot._client;
    if (!client) {
      // _client устанавливается синхронно — если его нет, ждём один тик
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
        buf[0] = brand.length;           // varint (1 байт для коротких строк)
        buf.write(brand, 1, "utf8");
        log.info("[LoginMask] brand: mineflayer → vanilla");
        return origWrite(name, { ...data, data: buf });
      }

      // ── 2. Settings: задержка + рандом ────────────────────────────────────
      if (!settingsMasked && name === "settings") {
        settingsMasked = true;
        const delay   = randInt(450, 1250);
        const locales = ["en_US", "ru_RU", "uk_UA", "en_GB", "de_DE"];
        const patched = {
          ...data,
          locale:       locales[randInt(0, locales.length - 1)],
          viewDistance: randInt(7, 12),
          chatMode:     0,
          chatColors:   true,
          skinParts:    randInt(121, 127),   // не идеальный 127
          mainHand:     1,
        };
        log.info(`[LoginMask] settings delayed ${delay}ms | locale=${patched.locale} view=${patched.viewDistance}`);
        setTimeout(() => { try { origWrite(name, patched); } catch {} }, delay);
        return;  // не отправляем немедленно
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
// Вызывается из spawn-обработчика в bot-manager.
//
async function doSpawnLookAround(bot) {
  try {
    const turns = randInt(2, 4);
    for (let i = 0; i < turns; i++) {
      await sleep(randInt(350, 950));
      if (!bot.entity) return;
      await bot.look(randFloat(-Math.PI, Math.PI), randFloat(-0.4, 0.3), false).catch(() => {});
    }
  } catch {}
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

// ── Инициализация движения/спринта/forcedMove ─────────────────────────────────
//
// Вызывается в spawn-обработчике (после initLoginMasking).
//
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
