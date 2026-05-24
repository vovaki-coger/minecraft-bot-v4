/**
 * AnticheatBypass v2 — легитимное поведение бота.
 *
 * Принципы:
 *  • Все пакеты взаимодействия (dig, place, attack) предваряются взглядом на цель
 *    и анимацией руки — ровно как это делает vanilla-клиент.
 *  • Движение — только ходьба (allowSprinting=false уже выставлен в bot-manager).
 *    Position-пакеты НЕ трогаем — GrimAC симулирует физику детерминированно.
 *  • Idle: небольшие случайные повороты головы пока бот стоит — живой игрок
 *    никогда не стоит как статуя.
 *  • Brand — "vanilla", settings-пакет с рандомными locale/view.
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

// ── Плавный поворот головы (микро-джиттер взгляда) ───────────────────────────

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
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    let yaw   = startYaw   + (targetYaw   - startYaw)   * t + randFloat(-0.008, 0.008);
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
//
// Vanilla-клиент отправляет грань, на которую смотрит игрок.
// GrimAC проверяет, что грань в dig-пакете совпадает с направлением взгляда.
//
function getBlockFace(bot, block) {
  if (!bot.entity || !block) return 1; // top by default
  const eye = bot.entity.position.offset(0, 1.62, 0);
  const center = block.position.offset(0.5, 0.5, 0.5);
  const dx = eye.x - center.x;
  const dy = eye.y - center.y;
  const dz = eye.z - center.z;
  const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
  if (ady >= adx && ady >= adz) return dy > 0 ? 1 : 0; // top / bottom
  if (adx >= adz) return dx > 0 ? 5 : 4;               // east / west
  return dz > 0 ? 3 : 2;                               // south / north
}

// ── ПАТЧ dig + placeBlock ─────────────────────────────────────────────────────
//
// Vanilla-клиент ВСЕГДА:
//   1. Смотрит на блок/поверхность (look-пакеты)
//   2. Посылает arm_animation (swing main hand) ДО dig/place
//   3. Для многотиковой добычи: посылает arm_animation каждый тик
//
// Mineflayer без патча: не посылает look и не посылает arm_animation →
// GrimAC/Vulcan/Intave отбрасывают пакет как "hit air".
//
function patchDigAndPlace(bot) {
  // ── Патч bot.dig ──────────────────────────────────────────────────────────
  const origDig = bot.dig.bind(bot);
  bot.dig = async function patchedDig(block, _forceLook, digFace) {
    if (!block || !bot.entity) return origDig(block, _forceLook, digFace);

    // Берём актуальный блок по координатам
    const fresh = bot.blockAt(block.position);
    if (!fresh || fresh.name === "air" || fresh.name === "cave_air") return;

    // 1. Смотрим на правильную грань блока
    const faceNormal = [
      { x: 0, y: -1, z: 0 }, // 0 bottom
      { x: 0, y:  1, z: 0 }, // 1 top    ← чаще всего
      { x: 0, y:  0, z:-1 }, // 2 north
      { x: 0, y:  0, z: 1 }, // 3 south
      { x:-1, y:  0, z: 0 }, // 4 west
      { x: 1, y:  0, z: 0 }, // 5 east
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
        await sleep(randInt(52, 68)); // ≈ 1 тик = 50мс
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

    // 1. Смотрим на поверхность куда ставим блок
    const target = referenceBlock.position.offset(
      0.5 + (faceVector.x || 0) * 0.5,
      0.5 + (faceVector.y || 0) * 0.5,
      0.5 + (faceVector.z || 0) * 0.5
    );
    try { await smoothLookAt(bot, target, false); } catch {}
    await sleep(randInt(50, 90));

    // 2. arm_animation перед размещением
    try { bot.swingArm("right"); } catch {}
    await sleep(randInt(28, 52));

    // 3. Ставим блок
    try {
      return await origPlace(referenceBlock, faceVector, options);
    } catch (err) {
      log.debug("[AntiCheat place]", err.message);
      throw err;
    }
  };

  // ── Патч bot.attack ───────────────────────────────────────────────────────
  // Vanilla: смотрит на хитбокс → arm_animation → attack
  const origAttack = bot.attack.bind(bot);
  bot.attack = async function patchedAttack(entity) {
    if (!entity || !bot.entity) return origAttack(entity);
    const pt = randomHitboxPoint(entity);
    if (pt) {
      try { await smoothLookAt(bot, pt, false); } catch {}
      await sleep(randInt(30, 60));
    }
    try { bot.swingArm("right"); } catch {}
    await sleep(randInt(20, 40));
    return origAttack(entity);
  };

  log.info("[AnticheatBypass] Патч dig/place/attack применён");
}

// ── Патч пакетов движения (look-джиттер, без позиционного джиттера) ──────────

function patchMovementPackets(bot) {
  try {
    const client = bot._client;
    if (!client) return;
    const origWrite = client.write.bind(client);

    client.write = function(name, data) {
      // Только look-пакеты: минимальный джиттер взгляда (≤ 0.003 рад)
      // position/position_look НЕ трогаем — GrimAC предсказывает позицию точно
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

// ── Idle-поведение: небольшие повороты головы пока бот стоит ─────────────────
//
// Настоящий игрок никогда не стоит абсолютно неподвижно.
// Anticheats как Intave/Matrix анализируют движение взгляда — полная неподвижность
// является одним из сигналов бота.
//
function setupIdleBehavior(bot) {
  let idleTimer = null;

  function scheduleIdle() {
    const delay = randInt(4000, 12000);
    idleTimer = setTimeout(async () => {
      if (!bot.entity) { scheduleIdle(); return; }

      // Небольшой случайный поворот (+/- до 25°) — не резкий, плавный
      try {
        const curYaw   = bot.entity.yaw;
        const curPitch = bot.entity.pitch;
        const newYaw   = curYaw   + randFloat(-0.44, 0.44);
        const newPitch = Math.max(-1.4, Math.min(0.9, curPitch + randFloat(-0.25, 0.25)));
        const steps = randInt(2, 4);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await bot.look(
            curYaw   + (newYaw   - curYaw)   * t + randFloat(-0.004, 0.004),
            curPitch + (newPitch - curPitch) * t + randFloat(-0.003, 0.003),
            false
          ).catch(() => {});
          await sleep(randInt(55, 80));
        }
      } catch {}

      // Иногда (15% шанс) — случайный swing рукой (типа игрок кликнул мышкой)
      if (Math.random() < 0.15 && bot.entity) {
        await sleep(randInt(200, 800));
        try { bot.swingArm("right"); } catch {}
      }

      scheduleIdle();
    }, delay);
  }

  scheduleIdle();

  // Очищаем таймер при отключении
  bot.once("end", () => { if (idleTimer) clearTimeout(idleTimer); });

  log.info("[AnticheatBypass] Idle-поведение активировано");
}

// ── Обработчик rubber-band ────────────────────────────────────────────────────

function setupForcedMoveHandler(bot, instance) {
  let _forcedMoveTimer = null;

  bot.on("forcedMove", () => {
    try { bot.pathfinder?.stop(); } catch {}
    try { bot.clearControlStates(); } catch {}
    try { bot.setControlState("jump",   false); } catch {}
    try { bot.setControlState("sprint", false); } catch {}

    // Кулдаун 1.5с перед следующим движением
    instance._antiCheatCooldownUntil = Date.now() + 1500;

    if (_forcedMoveTimer) clearTimeout(_forcedMoveTimer);
    _forcedMoveTimer = setTimeout(() => {
      instance._antiCheatCooldownUntil = 0;
    }, 1600);

    log.debug("[AnticheatBypass] forcedMove: кулдаун 1.5с");
  });
}

// ── Маскировка пакетов при входе ─────────────────────────────────────────────

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

      // Settings: задержка 120–450мс + рандомизация (locale, viewDistance, skinParts)
      if (!settingsMasked && name === "settings") {
        settingsMasked = true;
        const delay   = randInt(120, 450);
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

// ── Подтверждение position-пакетов при загрузке мира ─────────────────────────

function setupLoadingTerrainHandler(bot) {
  try {
    const client = bot._client;
    if (!client) return;

    const confirmedIds = new Set();
    client.on("position", (packet) => {
      if (packet.teleportId === undefined) return;
      if (confirmedIds.has(packet.teleportId)) return;
      confirmedIds.add(packet.teleportId);
      try { client.write("teleport_confirm", { teleportId: packet.teleportId }); } catch {}
      log.debug("[LoadingTerrain] teleport_confirm teleportId=" + packet.teleportId);
    });

    log.info("[AnticheatBypass] Loading terrain handler установлен");
  } catch (err) {
    log.warn("[AnticheatBypass] setupLoadingTerrainHandler error:", err.message);
  }
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

// ── safeDig: копание с проверкой дальности и видимости ───────────────────────
// (Используется таск-менеджером / внешним кодом)

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

  // Видимость (line of sight)
  try {
    if (typeof bot.canSeeBlock === "function" && !bot.canSeeBlock(fresh)) {
      log.debug("[AnticheatBypass] safeDig: нет LOS");
      return false;
    }
  } catch {}

  try {
    // bot.dig уже пропатчен и сам делает look + arm_animation
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

// ── Главная инициализация (вызывается в spawn-обработчике) ───────────────────

function initAnticheatBypass(bot, instance) {
  patchDigAndPlace(bot);          // ← ГЛАВНЫЙ ФИК: look + arm_animation для dig/place/attack
  patchMovementPackets(bot);      // look-джиттер
  patchSprintDelay(bot);          // задержка включения спринта
  setupForcedMoveHandler(bot, instance); // rubber-band handler
  setupIdleBehavior(bot);         // живые движения головы в idle

  log.info("[AnticheatBypass] Модуль v2 инициализирован для бота", instance.id);
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
