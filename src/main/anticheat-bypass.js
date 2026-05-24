/**
 * AnticheatBypass v2.1 — легитимное поведение бота.
 *
 * ИСПРАВЛЕНИЯ v2.1:
 *  • smoothLookAt: normalizeAngle() — кратчайший путь, нет разворота на 360°
 *  • patchDigAndPlace: убран патч bot.attack — async-attack нарушал pathfinder
 *    и вызывал эффект "ходьбы на месте". bot-tasks.js уже вызывает smoothLookAt
 *    перед attack, так что двойной патч не нужен.
 *  • setupIdleBehavior: пропускает случайные повороты пока pathfinder движется
 *  • Position-пакеты НЕ трогаем — GrimAC симулирует физику детерминированно.
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

/**
 * Нормализует угол в диапазон [-π, π].
 * Критично для smoothLookAt: без этого бот делает разворот через 360°
 * вместо поворота на кратчайший угол (например, -0.1 рад вместо +6.18).
 */
function normalizeAngle(a) {
  while (a > Math.PI)  a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ── Плавный поворот головы ────────────────────────────────────────────────────
//
// FIX: используем normalizeAngle для разности углов, чтобы выбрать
// кратчайший путь поворота. Раньше бот крутился на 360° если startYaw и
// targetYaw были по разные стороны от ±π.

async function smoothLookAt(bot, targetPos, force) {
  if (!bot.entity || !targetPos) return;
  const steps = force ? 1 : randInt(LOOK_STEPS - 1, LOOK_STEPS + 1);
  const eyePos = bot.entity.position.offset(0, 1.62, 0);
  const dx = targetPos.x - eyePos.x;
  const dy = targetPos.y - eyePos.y;
  const dz = targetPos.z - eyePos.z;
  const targetYaw   = Math.atan2(-dx, dz);
  const targetPitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz));
  const startYaw    = bot.entity.yaw;
  const startPitch  = bot.entity.pitch;

  // Кратчайшая разность углов → нет разворота через 360°
  const yawDiff = normalizeAngle(targetYaw - startYaw);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    let yaw   = startYaw + yawDiff * t + randFloat(-0.008, 0.008);
    let pitch = startPitch + (targetPitch - startPitch) * t + randFloat(-0.006, 0.006);
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    await bot.look(yaw, pitch, force || false).catch(() => {});
    await sleep(randInt(42, 58));
  }
}

// ── Проверка дальности до блока ──────────────────────────────────────────────

function isInReach(bot, blockPosition, maxReach) {
  if (!bot.entity || !blockPosition) return false;
  return bot.entity.position.distanceTo(blockPosition) <= (maxReach || MAX_REACH);
}

// ── Случайная точка в хитбоксе моба ─────────────────────────────────────────

function randomHitboxPoint(entity) {
  if (!entity || !entity.position) return null;
  const h = (entity.height || 1.8) * (0.75 + randFloat(-0.05, 0.1));
  return entity.position.offset(randFloat(-0.1, 0.1), h, randFloat(-0.1, 0.1));
}

// ── Выбор правильной грани блока ─────────────────────────────────────────────

function getBlockFace(bot, block) {
  if (!bot.entity || !block) return 1;
  const eye = bot.entity.position.offset(0, 1.62, 0);
  const center = block.position.offset(0.5, 0.5, 0.5);
  const dx = eye.x - center.x;
  const dy = eye.y - center.y;
  const dz = eye.z - center.z;
  const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
  if (ady >= adx && ady >= adz) return dy > 0 ? 1 : 0;
  if (adx >= adz) return dx > 0 ? 5 : 4;
  return dz > 0 ? 3 : 2;
}

// ── ПАТЧ dig + placeBlock ─────────────────────────────────────────────────────
//
// FIX v2.1: убран патч bot.attack.
//
// Проблема с async attack:
//   Mineflayer и pathfinder вызывают bot.attack() синхронно во внутреннем коде.
//   Сделав его async, мы возвращаем Promise, который никто не await-ит → look
//   и sleep из патча выполняются ПАРАЛЛЕЛЬНО с pathfinder-навигацией → конфликт
//   look-пакетов → бот «ходит на месте» или останавливается.
//
//   bot-tasks.js уже вызывает smoothLookAt(bot, hitPoint, true) перед каждым
//   bot.attack(entity), поэтому двойной патч не нужен.

function patchDigAndPlace(bot) {
  // ── Патч bot.dig ──────────────────────────────────────────────────────────
  const origDig = bot.dig.bind(bot);
  bot.dig = async function patchedDig(block, _forceLook, digFace) {
    if (!block || !bot.entity) return origDig(block, _forceLook, digFace);

    const fresh = bot.blockAt(block.position);
    if (!fresh || fresh.name === "air" || fresh.name === "cave_air") return;

    // 1. Смотрим на правильную грань блока
    const faceNormal = [
      { x: 0, y: -1, z:  0 }, // 0 bottom
      { x: 0, y:  1, z:  0 }, // 1 top
      { x: 0, y:  0, z: -1 }, // 2 north
      { x: 0, y:  0, z:  1 }, // 3 south
      { x:-1, y:  0, z:  0 }, // 4 west
      { x: 1, y:  0, z:  0 }, // 5 east
    ];
    const face = getBlockFace(bot, fresh);
    const n = faceNormal[face];
    const aimPoint = fresh.position.offset(
      0.5 + n.x * 0.5,
      0.5 + n.y * 0.5,
      0.5 + n.z * 0.5
    );
    try { await smoothLookAt(bot, aimPoint, false); } catch {}
    await sleep(randInt(40, 75));

    // 2. arm_animation до начала копания
    try { bot.swingArm("right"); } catch {}
    await sleep(randInt(28, 52));

    // 3. Копаем — параллельно посылаем arm_animation каждый тик
    let stillDigging = true;
    const animLoop = (async () => {
      while (stillDigging) {
        await sleep(randInt(52, 68));
        if (stillDigging && bot.entity) {
          try { bot.swingArm("right"); } catch {}
        }
      }
    })();

    try {
      await origDig(fresh, false, digFace != null ? digFace : face);
    } catch (err) {
      log.debug("[AntiCheat dig]", err.message);
      throw err;
    } finally {
      stillDigging = false;
      await animLoop;
    }
  };

  // ── Патч bot.placeBlock ───────────────────────────────────────────────────
  const origPlace = bot.placeBlock.bind(bot);
  bot.placeBlock = async function patchedPlace(referenceBlock, faceVector, options) {
    if (!bot.entity) return origPlace(referenceBlock, faceVector, options);

    const target = referenceBlock.position.offset(
      0.5 + (faceVector.x || 0) * 0.5,
      0.5 + (faceVector.y || 0) * 0.5,
      0.5 + (faceVector.z || 0) * 0.5
    );
    try { await smoothLookAt(bot, target, false); } catch {}
    await sleep(randInt(50, 90));

    try { bot.swingArm("right"); } catch {}
    await sleep(randInt(28, 52));

    try {
      return await origPlace(referenceBlock, faceVector, options);
    } catch (err) {
      log.debug("[AntiCheat place]", err.message);
      throw err;
    }
  };

  log.info("[AnticheatBypass] Патч dig/place применён (attack без патча — pathfinder-safe)");
}

// ── Патч пакетов движения (look-джиттер) ─────────────────────────────────────
//
// Только look-пакеты: минимальный джиттер ≤ 0.003 рад.
// Position-пакеты НЕ трогаем — GrimAC предсказывает позицию детерминированно.

function patchMovementPackets(bot) {
  try {
    const client = bot._client;
    if (!client) return;
    const origWrite = client.write.bind(client);

    client.write = function(name, data) {
      if (name === "look" && data.yaw !== undefined) {
        data = {
          ...data,
          yaw:   data.yaw   + randFloat(-0.003, 0.003),
          pitch: data.pitch + randFloat(-0.002, 0.002),
        };
      }
      return origWrite(name, data);
    };

    log.info("[AnticheatBypass] Патч пакетов движения применён");
  } catch (err) {
    log.warn("[AnticheatBypass] patchMovementPackets error:", err.message);
  }
}

// ── Патч задержки спринта ─────────────────────────────────────────────────────

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

// ── Idle-поведение ────────────────────────────────────────────────────────────
//
// FIX v2.1: пропускаем поворот головы пока pathfinder активно движется.
// Раньше idle-поворот вызывал bot.look() одновременно с pathfinder-навигацией,
// что приводило к конфликту и "ходьбе на месте" при активных задачах.

function setupIdleBehavior(bot) {
  let idleTimer = null;

  function scheduleIdle() {
    const delay = randInt(4000, 12000);
    idleTimer = setTimeout(async () => {
      if (!bot.entity) { scheduleIdle(); return; }

      // Не мешаем pathfinder — проверяем наличие активной цели
      const isPathfinding = !!(bot.pathfinder && bot.pathfinder.goal !== null && bot.pathfinder.goal !== undefined);
      if (isPathfinding) { scheduleIdle(); return; }

      // Также проверяем активные control states (бот идёт вручную)
      const cs = bot.controlState;
      const isMovingManually = cs && (cs.forward || cs.back || cs.left || cs.right);
      if (isMovingManually) { scheduleIdle(); return; }

      try {
        const curYaw   = bot.entity.yaw;
        const curPitch = bot.entity.pitch;
        const newYaw   = curYaw   + randFloat(-0.44, 0.44);
        const newPitch = Math.max(-1.4, Math.min(0.9, curPitch + randFloat(-0.25, 0.25)));
        const steps = randInt(2, 4);
        for (let i = 1; i <= steps; i++) {
          // Повторно проверяем pathfinder внутри цикла
          if (bot.pathfinder?.goal !== null && bot.pathfinder?.goal !== undefined) break;
          const t = i / steps;
          await bot.look(
            curYaw   + (newYaw   - curYaw)   * t + randFloat(-0.004, 0.004),
            curPitch + (newPitch - curPitch) * t + randFloat(-0.003, 0.003),
            false
          ).catch(() => {});
          await sleep(randInt(55, 80));
        }
      } catch {}

      // 15% шанс — случайный swing рукой
      if (Math.random() < 0.15 && bot.entity) {
        // Снова проверяем
        if (!(bot.pathfinder?.goal)) {
          await sleep(randInt(200, 800));
          try { bot.swingArm("right"); } catch {}
        }
      }

      scheduleIdle();
    }, delay);
  }

  scheduleIdle();
  bot.once("end", () => { if (idleTimer) clearTimeout(idleTimer); });
  log.info("[AnticheatBypass] Idle-поведение активировано (pathfinder-safe)");
}

// ── Обработчик rubber-band ────────────────────────────────────────────────────

function setupForcedMoveHandler(bot, instance) {
  let _forcedMoveTimer = null;

  bot.on("forcedMove", () => {
    try { bot.pathfinder?.stop(); } catch {}
    try { bot.clearControlStates(); } catch {}
    try { bot.setControlState("jump",   false); } catch {}
    try { bot.setControlState("sprint", false); } catch {}

    instance._antiCheatCooldownUntil = Date.now() + 1500;

    if (_forcedMoveTimer) clearTimeout(_forcedMoveTimer);
    _forcedMoveTimer = setTimeout(() => {
      instance._antiCheatCooldownUntil = 0;
    }, 1600);

    log.debug("[AnticheatBypass] forcedMove: кулдаун 1.5с");
  });
}

// ── Маскировка пакетов при входе ─────────────────────────────────────────────
//
// Вызывается ТОЛЬКО для публичных (не-локальных) серверов из bot-manager.js.

function initLoginMasking(bot) {
  try {
    const client = bot._client;
    if (!client) { setTimeout(() => initLoginMasking(bot), 10); return; }

    const origWrite = client.write.bind(client);
    let brandMasked = false, settingsMasked = false;

    client.write = function(name, data) {
      // Brand: mineflayer → vanilla
      if (!brandMasked &&
          (name === "plugin_message" || name === "custom_payload") &&
          data?.channel === "minecraft:brand") {
        brandMasked = true;
        const brand = "vanilla";
        const buf = Buffer.allocUnsafe(1 + brand.length);
        buf[0] = brand.length;
        buf.write(brand, 1, "utf8");
        log.info("[LoginMask] brand: mineflayer → vanilla");
        return origWrite(name, { ...data, data: buf });
      }

      // Settings: задержка 80–250мс + рандомизация
      if (!settingsMasked && name === "settings") {
        settingsMasked = true;
        const delay   = randInt(80, 250);
        const locales = ["en_US", "ru_RU", "uk_UA", "en_GB", "de_DE", "pl_PL", "fr_FR"];
        const patched = {
          ...data,
          locale:       locales[randInt(0, locales.length - 1)],
          viewDistance: randInt(8, 12),
          chatMode:     0,
          chatColors:   true,
          skinParts:    randInt(121, 127),
          mainHand:     1,
        };
        log.info(`[LoginMask] settings delayed ${delay}ms locale=${patched.locale} view=${patched.viewDistance}`);
        setTimeout(() => { try { origWrite(name, patched); } catch {} }, delay);
        return;
      }

      return origWrite(name, data);
    };

    log.info("[LoginMask] Маскировка пакетов входа активирована");
  } catch (err) {
    log.warn("[LoginMask] error:", err.message);
  }
}

// ── setupLoadingTerrainHandler: ОТКЛЮЧЁН (v2.2) ──────────────────────────────
//
// ПРИЧИНА: mineflayer уже обрабатывает teleport_confirm внутри своего
// physics-движка. Если мы тоже шлём teleport_confirm, сервер получает
// ДУБЛИРУЮЩИЙ пакет для того же teleportId → InvalidMove / HALTED.
//
// Функция оставлена как заглушка для обратной совместимости с bot-manager.js.

function setupLoadingTerrainHandler(bot) {
  // Ничего не делаем — mineflayer handles teleport_confirm internally
  log.info('[AnticheatBypass] Loading terrain handler: no-op (mineflayer handles internally)');
}

// ── Случайный осмотр после спавна ────────────────────────────────────────────

async function doSpawnLookAround(bot) {
  try {
    const turns = randInt(3, 5);
    for (let i = 0; i < turns; i++) {
      await sleep(randInt(250, 850));
      if (!bot.entity) return;
      await bot.look(
        randFloat(-Math.PI, Math.PI),
        randFloat(-0.5, 0.35),
        false
      ).catch(() => {});
    }
  } catch {}
}

// ── safeDig ───────────────────────────────────────────────────────────────────

async function safeDig(bot, block, opts) {
  if (!block || !bot.entity) return false;
  opts = opts || {};
  const reach = opts.reach || MAX_REACH;

  const fresh = bot.blockAt(block.position);
  if (!fresh || fresh.name === "air" || fresh.name === "cave_air") return false;
  if (!isInReach(bot, fresh.position, reach)) {
    log.debug("[AnticheatBypass] safeDig: out of reach " +
      bot.entity.position.distanceTo(fresh.position).toFixed(2));
    return false;
  }

  try {
    if (typeof bot.canSeeBlock === "function" && !bot.canSeeBlock(fresh)) {
      log.debug("[AnticheatBypass] safeDig: нет LOS");
      return false;
    }
  } catch {}

  try {
    await bot.dig(fresh);
    return true;
  } catch (err) {
    log.debug("[AnticheatBypass] safeDig error:", err.message);
    return false;
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
    await sleep(randInt(80, 160));
    return true;
  } catch (err) {
    if (err.message !== "goto timeout") log.debug("[AnticheatBypass] safeGoto error:", err.message);
    return false;
  }
}

// ── Главная инициализация ─────────────────────────────────────────────────────

function initAnticheatBypass(bot, instance) {
  patchDigAndPlace(bot);           // look + arm_animation для dig/place
  patchMovementPackets(bot);       // look-джиттер
  patchSprintDelay(bot);           // задержка включения спринта
  setupForcedMoveHandler(bot, instance);
  setupIdleBehavior(bot);          // живые движения головы (pathfinder-safe)

  log.info("[AnticheatBypass] Модуль v2.1 инициализирован для бота", instance.id);
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
