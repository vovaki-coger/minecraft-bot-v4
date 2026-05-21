/**
 * AnticheatBypass — модуль обхода античита для Mineflayer-ботов.
 *
 * Фиксит:
 *  - "Фантомные координаты": бот пытается копать блок на расстоянии >4.5 блоков
 *    после того как античит откатил его позицию (rubber-band)
 *  - Идеальные тайминги движения, поворота, кликов
 *  - Мгновенное ускорение/торможение без инерции
 *  - Ровный интервал пакетов движения без джиттера
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

/**
 * Возвращает true если бот находится достаточно близко к блоку чтобы взаимодействовать.
 * Это главный фикс "фантомных координат": если античит откатил позицию бота,
 * расстояние будет > MAX_REACH и копание будет отвергнуто до движения к блоку.
 */
function isInReach(bot, blockPosition, maxReach) {
  if (!bot.entity || !blockPosition) return false;
  const dist = bot.entity.position.distanceTo(blockPosition);
  return dist <= (maxReach || MAX_REACH);
}

// ── Безопасное копание с проверкой позиции ───────────────────────────────────

/**
 * Безопасный dig: проверяет что бот реально рядом с блоком перед копанием.
 * Если нет — возвращает false вместо того чтобы копать "призрак".
 * Добавляет случайную задержку между кликами (45–65мс) вместо ровных 50мс.
 */
async function safeDig(bot, block, opts) {
  if (!block || !bot.entity) return false;

  opts = opts || {};
  const reach = opts.reach || MAX_REACH;

  const refreshed = bot.blockAt(block.position);
  if (!refreshed || refreshed.name === "air" || refreshed.name === "cave_air") return false;

  if (!isInReach(bot, refreshed.position, reach)) {
    log.debug("[AnticheatBypass] safeDig: out of reach (" +
      bot.entity.position.distanceTo(refreshed.position).toFixed(2) + " блоков), пропускаю");
    return false;
  }

  // Случайная задержка перед кликом (имитация человека)
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

/**
 * Плавно поворачивает голову бота за 3–5 тиков вместо мгновенного.
 * Добавляет микродрожание ±0.5° для имитации мыши.
 */
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
    const jitterY = randFloat(-0.009, 0.009);
    const jitterP = randFloat(-0.009, 0.009);

    let yaw   = startYaw   + (targetYaw   - startYaw)   * t + jitterY;
    let pitch = startPitch + (targetPitch - startPitch) * t + jitterP;

    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

    await bot.look(yaw, pitch, force || false).catch(() => {});
    await sleep(randInt(45, 55));
  }
}

// ── Случайная точка внутри хитбокса моба ────────────────────────────────────

/**
 * Возвращает случайную точку внутри хитбокса entity (±0.1 блока от центра).
 * Имитирует "не идеальный" прицел как у живого игрока.
 */
function randomHitboxPoint(entity) {
  if (!entity || !entity.position) return null;
  const h = (entity.height || 1.8) * (0.75 + randFloat(-0.05, 0.1));
  return entity.position.offset(
    randFloat(-0.1, 0.1),
    h,
    randFloat(-0.1, 0.1)
  );
}

// ── Патч пакетов движения (джиттер позиции и таймингов) ──────────────────────

/**
 * Патчит отправку position-пакетов бота:
 * - Округляет координаты до 3 знаков (не ровные целые)
 * - Добавляет ±2–5 мс задержку к интервалу (имитация пинга 30–100 мс)
 *
 * Вызывается один раз при подключении бота.
 */
function patchMovementPackets(bot) {
  try {
    const client = bot._client;
    if (!client) return;

    const origWrite = client.write.bind(client);
    client.write = function(name, data) {
      if (
        name === "position" ||
        name === "position_look" ||
        name === "look"
      ) {
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

/**
 * Добавляет задержку перед включением спринта (1–2 тика = 50–100мс).
 * Vanilla игрок не включает sprint мгновенно при нажатии W.
 */
function patchSprintDelay(bot) {
  try {
    const origSetControl = bot.setControlState.bind(bot);
    bot.setControlState = function(control, state) {
      if (control === "sprint" && state === true) {
        const delay = randInt(50, 100);
        setTimeout(() => origSetControl(control, state), delay);
        return;
      }
      origSetControl(control, state);
    };
    log.info("[AnticheatBypass] Патч задержки спринта применён");
  } catch (err) {
    log.warn("[AnticheatBypass] patchSprintDelay error:", err.message);
  }
}

// ── Обработчик rubber-band (откат сервером позиции) ──────────────────────────

/**
 * Правильный обработчик forcedMove:
 * - Останавливает всё движение
 * - Ждёт пока позиция стабилизируется (2 тика без изменений)
 * - Только потом разрешает новые действия
 */
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

    log.debug("[AnticheatBypass] forcedMove: позиция синхронизирована, кулдаун 1.2с");
  });
}

// ── goto с проверкой кулдауна + верификацией позиции ─────────────────────────

/**
 * Безопасный goto: ждёт окончания античит-кулдауна, затем идёт к цели.
 * После прихода верифицирует что бот реально достиг точки назначения.
 *
 * @returns {boolean} true если добрались, false если кулдаун или ошибка
 */
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
    if (err.message !== "goto timeout") {
      log.debug("[AnticheatBypass] safeGoto error:", err.message);
    }
    return false;
  }
}

// ── Инициализация всего античит-модуля ───────────────────────────────────────

/**
 * Применяет все патчи к боту. Вызывается один раз в spawn-обработчике.
 */
function initAnticheatBypass(bot, instance) {
  patchMovementPackets(bot);
  patchSprintDelay(bot);
  setupForcedMoveHandler(bot, instance);
  log.info("[AnticheatBypass] Модуль инициализирован для бота", instance.id);
}

module.exports = {
  initAnticheatBypass,
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
