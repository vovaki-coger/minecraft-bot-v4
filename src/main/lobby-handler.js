/**
 * LobbyHandler v4.4 — автовыбор анки/ранга в лобби.
 *
 * Исправления v4.4:
 *  - КРИТИЧНО: убран windowAge < 1300 check — он делал так что бот НИКОГДА
 *    не кликал окно (после _delay(800) возраст всегда ~800ms < 1300ms)
 *  - КРИТИЧНО: _checkAndHandleLobby теперь вызывает _trySelectRank() при
 *    ЛЮБОМ mode (не только "compass") — раньше при mode="auto"/undefined пропускалось
 *  - Retry: если окно закрылось до клика — планируем повтор через 2с
 *  - _onRespawn: пропускает re-check только если ранг выбран < 15с назад
 *    (BungeeCord-переброс в игровой мир)
 */

const log = require("electron-log");

const LOBBY_KEYWORDS = [
  "lobby", "лобби", "hub", "хаб", "waiting", "ожидание",
  "select", "выбор", "choose", "rank", "ранг", "анка", "class",
];

const RANK_SELECT_KEYWORDS = [
  "выбери", "выберите", "select your", "choose your", "pick your",
  "class", "rank", "kit", "кит", "роль", "role", "анку", "анк",
  "profession", "профессия", "класс",
];

const RANK_NPC_NAMES = [
  "ранг", "rank", "class", "kit", "кит", "класс", "выбор", "select",
  "анка", "анк", "role", "роль", "профессия", "profession",
];

function parseWindowTitle(raw) {
  if (!raw) return "";
  try {
    if (typeof raw === "object") {
      function extract(o) {
        if (!o) return "";
        if (typeof o === "string") return o;
        let t = o.text || o.translate || "";
        if (Array.isArray(o.extra)) t += o.extra.map(extract).join("");
        if (Array.isArray(o.with)) t += o.with.map(extract).join("");
        return t;
      }
      return extract(raw);
    }
    const obj = JSON.parse(raw);
    if (typeof obj === "string") return obj;
    function extract(o) {
      if (!o) return "";
      if (typeof o === "string") return o;
      let t = o.text || o.translate || "";
      if (Array.isArray(o.extra)) t += o.extra.map(extract).join("");
      if (Array.isArray(o.with)) t += o.with.map(extract).join("");
      return t;
    }
    return extract(obj);
  } catch {
    return String(raw);
  }
}

class LobbyHandler {
  constructor(instance, emit) {
    this.instance = instance;
    this.emit = emit;
    this.inLobby = false;
    this.rankSelected = false;
    this._lastRankSelectedAt = 0;
    this.lobbyCheckTimer = null;
    this._windowOpenHandler = null;
    this._respawnHandler = null;
    this._titleHandler = null;
    this._pendingTimers = [];
    this.config = instance.config.lobbyConfig || {};
  }

  _setTimeout(fn, ms) {
    const timer = setTimeout(() => {
      this._pendingTimers = this._pendingTimers.filter(t => t !== timer);
      fn();
    }, ms);
    this._pendingTimers.push(timer);
    return timer;
  }

  _delay(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      this._pendingTimers.push(timer);
      setTimeout(() => {
        this._pendingTimers = this._pendingTimers.filter(t => t !== timer);
      }, ms + 10);
    });
  }

  start() {
    const { bot } = this.instance;
    if (!bot) return;
    if (!this.config.enabled) {
      log.info("[LobbyHandler] Disabled by config");
      return;
    }
    log.info("[LobbyHandler] Starting for bot", this.instance.id);

    this._windowOpenHandler = (window) => this._onWindowOpen(window);
    this._titleHandler      = (text)   => this._onTitle(text);
    this._respawnHandler    = ()       => this._onRespawn();

    bot.on("windowOpen", this._windowOpenHandler);
    bot.on("title",      this._titleHandler);
    bot.on("respawn",    this._respawnHandler);

    // Первая проверка через 3с — дать серверу время отправить инвентарь
    this.lobbyCheckTimer = this._setTimeout(() => this._checkAndHandleLobby(), 3000);
  }

  stop() {
    if (this.lobbyCheckTimer) {
      clearTimeout(this.lobbyCheckTimer);
      this.lobbyCheckTimer = null;
    }
    for (const timer of this._pendingTimers) clearTimeout(timer);
    this._pendingTimers = [];

    const { bot } = this.instance;
    if (bot) {
      if (this._windowOpenHandler) bot.removeListener("windowOpen", this._windowOpenHandler);
      if (this._titleHandler)      bot.removeListener("title",      this._titleHandler);
      if (this._respawnHandler)    bot.removeListener("respawn",    this._respawnHandler);
    }
    this._windowOpenHandler = null;
    this._titleHandler      = null;
    this._respawnHandler    = null;
    log.info("[LobbyHandler] Stopped");
  }

  /**
   * Respawn = либо смерть в игровом мире, либо BungeeCord-переброс на другой сервер.
   * Если ранг выбирался < 15с назад — это скорее всего переброс в игровой мир.
   * Не сбрасываем флаги и не пытаемся кликать повторно.
   */
  _onRespawn() {
    const timeSinceRank = Date.now() - this._lastRankSelectedAt;
    log.info(`[LobbyHandler] Respawn detected (timeSinceRank=${timeSinceRank}ms)`);
    this.inLobby = false;

    if (timeSinceRank < 15000) {
      log.info("[LobbyHandler] Recent rank selection — skipping re-check (BungeeCord transfer OK)");
      return;
    }

    // Обычный respawn после смерти или долгого отсутствия
    this.rankSelected = false;
    this._setTimeout(() => this._checkAndHandleLobby(), 3000);
  }

  onChatMessage(message) {
    const lower = message.toLowerCase();
    if (LOBBY_KEYWORDS.some(k => lower.includes(k)) && !this.inLobby) {
      log.info("[LobbyHandler] Lobby detected via chat:", message);
      this.inLobby = true;
    }
    if (RANK_SELECT_KEYWORDS.some(k => lower.includes(k)) && !this.rankSelected) {
      log.info("[LobbyHandler] Rank prompt detected via chat:", message);
      this._setTimeout(() => this._trySelectRank(), 1500);
    }
  }

  _onTitle(text) {
    if (!text) return;
    const plain = parseWindowTitle(text);
    const lower = plain.toLowerCase();
    if (LOBBY_KEYWORDS.some(k => lower.includes(k))) {
      log.info("[LobbyHandler] Lobby detected via title:", plain);
      this.inLobby = true;
      if (!this.rankSelected) {
        this._setTimeout(() => this._trySelectRank(), 2000);
      }
    }
  }

  async _checkAndHandleLobby() {
    const { bot } = this.instance;
    if (!bot?.entity) return;
    if (this.instance.status !== "online") return;
    if (this.config.disableCompassDetection) return;

    const LOBBY_ITEMS = ["compass", "clock", "watch", "nether_star"];
    // Проверяем весь инвентарь + хотбар (слоты 36–44)
    const allItems = [...(bot.inventory?.items() || [])];
    for (let s = 36; s <= 44; s++) {
      const i = bot.inventory?.slots[s];
      if (i) allItems.push(i);
    }
    const lobbyItem = allItems.find(i => LOBBY_ITEMS.includes(i.name));

    if (lobbyItem && !this.rankSelected) {
      log.info("[LobbyHandler] Found lobby item:", lobbyItem.name);
      this.inLobby = true;
      // ИСПРАВЛЕНО: всегда вызываем _trySelectRank независимо от mode
      // (раньше был баг: вызывался только при mode === "compass")
      await this._trySelectRank();
      return;
    }

    // NPC-режим — ищем и кликаем НПС с нужным именем
    if (this.config.mode === "npc" || this.config.npcMode) {
      await this._tryFindAndClickNPC();
    }
  }

  async _trySelectRank() {
    if (this.rankSelected) return;
    const { bot } = this.instance;
    if (!bot?.entity) return;
    if (this.instance.status !== "online") return;

    const mode = this.config.mode || "auto";

    if (mode === "compass" || mode === "auto") {
      const ok = await this._useCompass();
      if (ok) return;
    }
    if (mode === "npc" || mode === "auto") {
      await this._tryFindAndClickNPC();
    }
  }

  async _useCompass() {
    const { bot } = this.instance;
    if (!bot?.entity) return false;
    if (this.instance.status !== "online") return false;

    const COMPASS_NAMES = ["compass", "clock", "watch", "nether_star", "paper", "book"];
    let item = null;

    // Сначала ищем в общем инвентаре
    for (const name of COMPASS_NAMES) {
      item = bot.inventory?.items().find(i => i.name === name);
      if (item) break;
    }
    // Потом в хотбаре (слоты 36–44)
    if (!item) {
      for (let s = 36; s <= 44; s++) {
        const si = bot.inventory?.slots[s];
        if (si && COMPASS_NAMES.includes(si.name)) { item = si; break; }
      }
    }

    if (!item) {
      log.info("[LobbyHandler] No compass/clock found in inventory");
      return false;
    }

    try {
      log.info("[LobbyHandler] Equipping and using:", item.name);
      await bot.equip(item, "hand");
      await this._delay(600);
      if (!bot?.entity || this.instance.status !== "online") return false;
      await bot.activateItem();
      await this._delay(400);
      log.info("[LobbyHandler] Compass activated — waiting for window");
      return true;
    } catch (err) {
      log.warn("[LobbyHandler] Error using compass:", err.message);
      return false;
    }
  }

  async _tryFindAndClickNPC() {
    const { bot } = this.instance;
    if (!bot?.entity) return;
    if (this.instance.status !== "online") return;

    const entities = Object.values(bot.entities || {});
    let npc = entities.find(e => {
      if (e === bot.entity) return false;
      const name = (e.displayName || e.name || e.username || "").toLowerCase();
      return RANK_NPC_NAMES.some(n => name.includes(n));
    });
    if (!npc) {
      npc = entities.find(e =>
        e !== bot.entity &&
        (e.name === "villager" || e.name === "npc") &&
        e.position?.distanceTo(bot.entity.position) < 20
      );
    }
    if (!npc) { log.info("[LobbyHandler] No NPC found"); return; }
    log.info("[LobbyHandler] Found NPC:", npc.displayName || npc.name);
    await this._interactWithEntity(npc);
  }

  async _interactWithEntity(entity) {
    const { bot } = this.instance;
    if (!bot?.entity || !entity?.position) return;
    if (this.instance.status !== "online") return;
    try {
      const { goals } = require("mineflayer-pathfinder");
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 4) {
        log.info("[LobbyHandler] Moving to NPC, dist:", dist);
        await bot.pathfinder.goto(
          new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2)
        ).catch(() => {});
        await this._delay(500);
      }
      if (!bot?.entity || this.instance.status !== "online") return;
      await bot.lookAt(entity.position.offset(0, 1, 0)).catch(() => {});
      await this._delay(300);
      if (!bot?.entity || this.instance.status !== "online") return;
      await bot.useOn(entity).catch(() => {});
      log.info("[LobbyHandler] Interacted with NPC");
    } catch (err) {
      log.warn("[LobbyHandler] NPC interact error:", err.message);
    }
  }

  async _onWindowOpen(window) {
    const { bot } = this.instance;
    if (!bot) return;

    const rawTitle = window?.title || "";
    const title    = parseWindowTitle(rawTitle);
    const lower    = title.toLowerCase();

    log.info("[LobbyHandler] windowOpen:", title || "(no title)", "| slots:", window?.slots?.length);

    // Если бот не онлайн — игнорируем (на случай BungeeCord-disconnect)
    if (this.instance.status !== "online") {
      log.warn("[LobbyHandler] windowOpen ignored — bot status:", this.instance.status);
      return;
    }

    // Проверяем кастомный заголовок окна из конфига
    const customTitle = (this.config.rankWindowTitle || "").toLowerCase();
    if (customTitle && !lower.includes(customTitle)) return;

    // Определяем — это окно выбора ранга/анки или нет
    const isRankWindow = customTitle ||
      RANK_SELECT_KEYWORDS.some(k => lower.includes(k)) ||
      LOBBY_KEYWORDS.some(k => lower.includes(k)) ||
      this.inLobby;  // если мы уже знаем что в лобби — принимаем любое окно

    if (!isRankWindow) return;

    this.rankSelected = true;
    log.info("[LobbyHandler] Rank window detected:", title || "(no title)");

    // Ждём 800мс чтобы сервер успел заполнить слоты
    await this._delay(800);

    // После ожидания бот мог отключиться или уйти в другой статус
    if (this.instance.status !== "online") {
      log.warn("[LobbyHandler] Bot no longer online after window wait (status=" + this.instance.status + ")");
      this.rankSelected = false;
      return;
    }

    // ИСПРАВЛЕНО: убран неверный windowAge < 1300 check.
    // Раньше он всегда срабатывал (после _delay(800) возраст ~800ms < 1300ms)
    // и бот НИКОГДА не кликал окно.
    if (!bot.currentWindow) {
      log.warn("[LobbyHandler] Window closed before we could click — will retry in 2s");
      this.rankSelected = false;
      // Планируем повтор через 2 секунды
      this._setTimeout(() => this._checkAndHandleLobby(), 2000);
      return;
    }

    // Выполняем клик
    const slotIndex  = this.config.rankSlot ?? 0;
    const targetName = (this.config.rankName || "").toLowerCase();

    // Если задано имя предмета — ищем по имени
    if (targetName && bot.currentWindow.slots) {
      const foundSlot = bot.currentWindow.slots.find(s => {
        if (!s) return false;
        const name = (s.customName || s.displayName || s.name || "").toLowerCase();
        return name.includes(targetName);
      });
      if (foundSlot) {
        const clickIdx = foundSlot.slot ?? foundSlot.index ?? 0;
        log.info("[LobbyHandler] Clicking by name:", foundSlot.displayName || foundSlot.name, "slot:", clickIdx);
        try {
          await bot.clickWindow(clickIdx, 0, 0);
          this._emitRankSelected(foundSlot.displayName || foundSlot.name || "by-name");
        } catch (err) {
          log.warn("[LobbyHandler] clickWindow (by name) error:", err.message);
          this.rankSelected = false;
        }
        return;
      }
      log.warn("[LobbyHandler] Item '" + targetName + "' not found in window — falling back to slot index");
    }

    // Иначе кликаем по индексу слота
    try {
      log.info("[LobbyHandler] Clicking slot by index:", slotIndex);
      await bot.clickWindow(slotIndex, 0, 0);
      this._emitRankSelected("слот " + slotIndex);
    } catch (err) {
      log.warn("[LobbyHandler] clickWindow (by slot) error:", err.message);
      this.rankSelected = false;
    }
  }

  _emitRankSelected(rankName) {
    this._lastRankSelectedAt = Date.now();
    log.info("[LobbyHandler] Rank selected:", rankName);
    this.emit("bot:chat", {
      botId: this.instance.id,
      username: "system",
      message: `✅ Анка/ранг выбран: ${rankName}`,
      type: "system",
    });
  }
}

module.exports = { LobbyHandler };
