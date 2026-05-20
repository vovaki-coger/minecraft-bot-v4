/**
 * Scripted task system — бот выполняет команды без AI на каждый шаг.
 * AI используется только для понимания команды, дальше скрипт сам рулит.
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

class TaskManager {
  constructor(botInstance, emit) {
    this.instance = botInstance;
    this.emit = emit;
    this.currentTask = null;
    this._running = false;
    this._followInterval = null;
  }

  get bot() { return this.instance.bot; }

  _log(msg) {
    this.instance.chatHistory.push({ type: "survivor", text: `[ЗАДАЧА] ${msg}`, timestamp: Date.now() });
    this.emit("bot:survivorLog", { botId: this.instance.id, message: msg });
  }

  _chat(msg) {
    if (this.bot && msg) {
      const text = String(msg).slice(0, 100);
      this.bot.chat(text);
      this.instance.chatHistory.push({ type: "bot", text, timestamp: Date.now() });
      this.emit("bot:chat", { botId: this.instance.id, username: this.instance.config.nick, message: text, type: "bot" });
    }
  }

  async stopAll() {
    this._running = false;
    if (this._followInterval) { clearInterval(this._followInterval); this._followInterval = null; }
    this.currentTask = null;
    try { if (this.bot?.pathfinder) this.bot.pathfinder.stop(); } catch {}
    try { if (this.bot) this.bot.clearControlStates(); } catch {}
    this._log("Все задачи остановлены");
  }

  async runTask(name, args) {
    if (!args) args = {};
    if (this._running) {
      await this.stopAll();
    }
    this._running = true;
    this.currentTask = name;

    try {
      switch (name) {
        case "come_to":      await this._taskComeToPlayer(args.player); break;
        case "follow":       await this._taskFollowPlayer(args.player); break;
        case "stop":         await this.stopAll(); return;
        case "gather_wood":  await this._taskGatherWood(args.count || 20); break;
        case "gather_stone": await this._taskGatherBlock("cobblestone", args.count || 32, "Добываю камень"); break;
        case "gather_food":  await this._taskGatherFood(); break;
        case "build_farm":   await this._taskBuildFarm(args.size || 4); break;
        case "build_house":  await this._taskBuildHouse(); break;
        case "craft":        await this._taskCraft(args.item, args.count || 1); break;
        case "attack":       await this._taskAttackMob(args.target); break;
        case "walk_to":      await this._taskWalkTo(args.x, args.y, args.z); break;
        case "explore":      await this._taskExplore(); break;
        case "farm_trees":   await this._taskFarmTrees(args.radius || 20, args.crop || "oak"); break;
        case "farm_crops":   await this._taskFarmCrops(args.radius || 20, args.crop || "wheat", args.delay || 300, args.useBoneMeal !== false); break;
        case "pvp_attack":   await this._taskPvpAttack(args.target); break;
        case "inventory":    this._reportInventory(); break;
        case "status":       this._reportStatus(); break;
        default:
          this._chat("Не знаю как это сделать");
      }
    } catch (err) {
      log.error("Task error:", err.message);
      this._chat("Ой, не получилось: " + err.message.slice(0, 50));
    }

    this._running = false;
    this.currentTask = null;
  }

  async _taskComeToPlayer(playerName) {
    const target = this._findPlayer(playerName);
    if (!target) {
      this._chat(playerName ? "Не вижу игрока " + playerName : "Не вижу никого рядом");
      return;
    }
    this._chat("Иду к тебе, " + target.username + "!");
    await this.bot.pathfinder.goto(
      new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)
    ).catch(() => {});
    this._chat("Я здесь!");
  }

  async _taskFollowPlayer(playerName) {
    const target = this._findPlayer(playerName);
    if (!target) {
      this._chat("Не вижу " + (playerName || "тебя"));
      return;
    }
    this._chat("Слежу за " + target.username + "! Напиши 'стоп' чтобы остановить");
    const deadline = Date.now() + 300_000; // 5 минут максимум

    while (this._running && Date.now() < deadline && target.isValid) {
      await this.bot.pathfinder.goto(new goals.GoalFollow(target, 2)).catch(() => {});
      await this._sleep(500);
    }
  }

  async _taskGatherWood(count) {
    this._chat("Иду рубить дерево, нужно " + count + " бревён!");
    const logIds = ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]
      .map(n => this.bot.registry.blocksByName[n]?.id).filter(Boolean);

    let collected = 0;
    let searchRadius = 64;
    let exploreAttempts = 0;

    while (this._running && collected < count) {
      const block = this.bot.findBlock({ matching: logIds, maxDistance: searchRadius });

      if (!block) {
        if (exploreAttempts >= 8) {
          this._chat("Не нашёл деревьев даже после исследования. Собрал: " + collected);
          break;
        }
        this._log("Деревьев нет в " + searchRadius + "м, исследую...");
        const pos = this.bot.entity.position;
        const angle = (exploreAttempts / 8) * Math.PI * 2;
        const dist = 40 + exploreAttempts * 20;
        await this.bot.pathfinder.goto(new goals.GoalNear(
          pos.x + Math.cos(angle) * dist, pos.y, pos.z + Math.sin(angle) * dist, 4
        )).catch(() => {});
        searchRadius = Math.min(searchRadius + 32, 192);
        exploreAttempts++;
        continue;
      }

      exploreAttempts = 0;
      // Идём к блоку и сразу ищем следующий
      await this.bot.pathfinder.goto(
        new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2)
      ).catch(() => {});
      if (!this._running) break;
      const refreshed = this.bot.blockAt(block.position);
      if (refreshed && refreshed.name !== "air") {
        await this.bot.dig(refreshed).catch(() => {});
        collected++;
      }
      if (collected % 5 === 0) this._log("Собрано " + collected + "/" + count + " бревён");
    }
    this._chat("Готово! Собрал " + collected + " бревён");
  }

  async _taskGatherBlock(blockName, count, label) {
    this._chat((label || "Добываю " + blockName) + "...");
    const blockType = this.bot.registry.blocksByName[blockName];
    if (!blockType) { this._chat("Не знаю блок: " + blockName); return; }

    let collected = 0;
    while (this._running && collected < count) {
      const block = this.bot.findBlock({ matching: blockType.id, maxDistance: 32 });
      if (!block) { this._chat("Не нашёл рядом!"); break; }
      await this.bot.pathfinder.goto(
        new goals.GoalBlock(block.position.x, block.position.y, block.position.z)
      ).catch(() => {});
      if (!this._running) break;
      await this.bot.dig(block).catch(() => {});
      collected++;
    }
    this._chat("Добыл " + collected + " " + blockName);
  }

  async _taskGatherFood() {
    this._chat("Ищу еду...");
    const animalNames = ["cow", "pig", "sheep", "chicken"];
    for (const name of animalNames) {
      const entity = Object.values(this.bot.entities).find(
        e => e.name === name && e.position.distanceTo(this.bot.entity.position) < 32
      );
      if (entity) {
        this._chat("Нашёл " + name + ", атакую!");
        for (let i = 0; i < 8 && this._running && entity.isValid; i++) {
          await this.bot.pathfinder.goto(new goals.GoalFollow(entity, 1)).catch(() => {});
          this.bot.attack(entity);
          await this._sleep(600);
        }
        return;
      }
    }
    this._chat("Нет животных рядом");
  }

  async _taskBuildFarm(size) {
    this._chat("Строю ферму " + size + "x" + size + "!");
    if (!this.bot?.entity) return;

    const seedItem = this.bot.inventory.items().find(i =>
      ["wheat_seeds","seeds","carrot","potato","beetroot_seeds"].includes(i.name)
    );
    if (!seedItem) {
      this._chat("Нет семян! Нужны wheat_seeds (семена пшеницы)");
      return;
    }

    const hoe = this.bot.inventory.items().find(i => i.name.includes("hoe"));
    const pos = this.bot.entity.position.clone().floor();
    let planted = 0;

    for (let dx = 0; dx < size && this._running; dx++) {
      for (let dz = 0; dz < size && this._running; dz++) {
        const tp = pos.offset(dx, 0, dz);
        await this.bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 2)).catch(() => {});
        if (!this._running) break;

        const block = this.bot.blockAt(tp);
        if (!block) continue;

        if (hoe && (block.name === "dirt" || block.name === "grass_block")) {
          await this.bot.equip(hoe, "hand").catch(() => {});
          await this.bot.activateBlock(block).catch(() => {});
          await this._sleep(200);
        }

        await this.bot.equip(seedItem, "hand").catch(() => {});
        const tilled = this.bot.blockAt(tp);
        if (tilled) {
          await this.bot.activateBlock(tilled).catch(() => {});
          planted++;
        }
        await this._sleep(100);
      }
    }
    this._chat("Ферма готова! Посадил " + planted + " семян");
  }

  async _taskBuildHouse() {
    this._chat("Строю домик!");
    const buildBlock = this.bot.inventory.items().find(i =>
      i.name.includes("planks") || i.name.includes("cobblestone") || i.name.includes("log")
    );
    if (!buildBlock || buildBlock.count < 24) {
      this._chat("Нужно минимум 24 блока (доски/камень). Есть: " + (buildBlock?.count || 0));
      return;
    }
    await this.bot.equip(buildBlock, "hand").catch(() => {});
    const pos = this.bot.entity.position.clone().floor();
    let placed = 0;

    // Простой периметр 5x5, 3 блока высотой
    const size = 5;
    for (let y = 0; y < 3 && this._running; y++) {
      for (let dx = 0; dx < size && this._running; dx++) {
        for (let dz = 0; dz < size && this._running; dz++) {
          if (dx === 0 || dx === size-1 || dz === 0 || dz === size-1) {
            const tp = pos.offset(dx, y, dz);
            await this.bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 3)).catch(() => {});
            const below = this.bot.blockAt(tp.offset(0, -1, 0));
            if (below) {
              await this.bot.placeBlock(below, new (require("vec3"))(0,1,0)).catch(() => {});
              placed++;
            }
            await this._sleep(100);
          }
        }
      }
    }
    this._chat("Домик готов! Поставил " + placed + " блоков");
  }

  async _taskCraft(itemName, count) {
    if (!itemName) { this._chat("Что скрафтить?"); return; }
    this._chat("Крафчу " + itemName + "...");

    // Получаем minecraft-data для текущей версии сервера
    let mcData = null;
    try { mcData = require("minecraft-data")(this.bot.version); } catch {}

    // Ищем предмет по registry-имени, displayName или частичному совпадению
    let item = this.bot.registry.itemsByName[itemName];
    if (!item && mcData) {
      const ln = itemName.toLowerCase().replace(/\s+/g, "_");
      item = Object.values(mcData.itemsByName).find(i =>
        i.name === ln ||
        (i.displayName || "").toLowerCase() === ln ||
        i.name.includes(ln) ||
        ln.includes(i.name)
      );
    }
    if (!item) { this._chat("Не знаю предмет: " + itemName); return; }

    // Ищем верстак рядом (не обязательно — некоторые рецепты 2x2)
    let table = null;
    const craftingTableId = this.bot.registry.blocksByName["crafting_table"]?.id;
    if (craftingTableId) {
      table = this.bot.findBlock({ matching: craftingTableId, maxDistance: 16 });
      if (table) {
        // Подходим к верстаку
        await this.bot.pathfinder.goto(
          new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
        ).catch(() => {});
      }
    }

    try {
      // Пробуем с верстаком, затем без (2x2 рецепты)
      let recipes = this.bot.recipesFor(item.id, null, 1, table);
      if (!recipes.length && table) {
        recipes = this.bot.recipesFor(item.id, null, 1, null);
      }
      if (!recipes.length) {
        this._chat("Нет рецепта для " + (item.displayName || item.name));
        return;
      }
      await this.bot.craft(recipes[0], count, table);
      this._chat("✅ Скрафтил " + count + "x " + (item.displayName || item.name));
    } catch (err) {
      this._chat("Ошибка крафта: " + err.message.slice(0, 60));
    }
  }

  async _taskAttackMob(targetName) {
    const entity = Object.values(this.bot.entities).find(e => {
      if (e.username === this.bot.username) return false;
      const nm = (e.name || "").toLowerCase();
      const dn = (e.displayName || "").toLowerCase();
      const tn = (targetName || "").toLowerCase();
      return (!tn || nm === tn || dn.includes(tn)) && e.position.distanceTo(this.bot.entity.position) < 32;
    });
    if (!entity) {
      this._chat("Не вижу " + (targetName || "врага") + " рядом");
      return;
    }
    this._chat("Атакую " + (entity.displayName || entity.name) + "!");
    while (this._running && entity.isValid && entity.health > 0) {
      await this.bot.pathfinder.goto(new goals.GoalFollow(entity, 2)).catch(() => {});
      this.bot.attack(entity);
      await this._sleep(500);
    }
    this._chat((entity.displayName || entity.name) + " побеждён!");
  }

  async _taskWalkTo(x, y, z) {
    if (x === undefined || x === null) return;
    const fy = y !== undefined && y !== null ? Math.round(y) : Math.round(this.bot.entity.position.y);
    this._chat("Иду к " + Math.round(x) + " " + fy + " " + Math.round(z));
    await this.bot.pathfinder.goto(new goals.GoalBlock(Math.round(x), fy, Math.round(z))).catch(() => {});
    this._chat("Пришёл!");
  }

  async _taskExplore() {
    this._chat("Исследую окрестности!");
    for (let i = 0; i < 5 && this._running; i++) {
      const dx = Math.floor(Math.random() * 60 - 30);
      const dz = Math.floor(Math.random() * 60 - 30);
      const p = this.bot.entity.position;
      await this.bot.pathfinder.goto(new goals.GoalNear(p.x + dx, p.y, p.z + dz, 2)).catch(() => {});
      await this._sleep(300);
    }
    this._chat("Исследование завершено!");
  }

  _reportInventory() {
    const items = this.bot.inventory.items();
    if (!items.length) { this._chat("Инвентарь пустой"); return; }
    const top = items.sort((a,b) => b.count - a.count).slice(0,5)
      .map(i => (i.displayName || i.name) + " x" + i.count).join(", ");
    this._chat("Инвентарь: " + top);
  }

  _reportStatus() {
    const s = this.instance.stats;
    this._chat("HP:" + Math.round(s.health) + "/20 Еда:" + Math.round(s.food) + "/20 XP:" + s.experience + " Позиция:" + s.x + " " + s.y + " " + s.z);
  }

  _findPlayer(name) {
    return Object.values(this.bot.entities).find(e =>
      e.type === "player" &&
      e.username !== this.bot.username &&
      (!name || e.username?.toLowerCase().includes(name.toLowerCase()))
    ) || null;
  }



  // ══════════════════════════════════════════════════════════════════
  // ФЕРМА ДЕРЕВЬЕВ — рубит → сажает саженцы → бонемил → повторяет
  // ══════════════════════════════════════════════════════════════════

  async _taskFarmTrees(radius, cropType) {
    this._chat("🌲 Ферма деревьев: " + cropType + " радиус " + radius + "м");
    if (!this.bot?.entity) return;

    const TREE_MAP = {
      oak:      { log: "oak_log",      sapling: "oak_sapling",      leaves: "oak_leaves" },
      birch:    { log: "birch_log",    sapling: "birch_sapling",    leaves: "birch_leaves" },
      spruce:   { log: "spruce_log",   sapling: "spruce_sapling",   leaves: "spruce_leaves" },
      jungle:   { log: "jungle_log",   sapling: "jungle_sapling",   leaves: "jungle_leaves" },
      acacia:   { log: "acacia_log",   sapling: "acacia_sapling",   leaves: "acacia_leaves" },
      dark_oak: { log: "dark_oak_log", sapling: "dark_oak_sapling", leaves: "dark_oak_leaves" },
    };
    const tree = TREE_MAP[cropType] || TREE_MAP.oak;
    const logId = this.bot.registry.blocksByName[tree.log]?.id;
    if (!logId) { this._chat("Не знаю тип: " + cropType); return; }

    let totalChopped = 0;
    let exploreDir = 0;

    for (let cycle = 0; cycle < 9999 && this._running; cycle++) {
      const pos = this.bot.entity.position.clone();

      // ── Ищем дерево (поиск + движение одновременно) ─────────────
      let logBlock = this.bot.findBlock({ matching: logId, maxDistance: radius });

      if (!logBlock) {
        // Исследуем зигзагом чтобы найти деревья
        this._log("Деревьев нет в " + radius + "м, ищу дальше...");
        const angle = (exploreDir++ * 1.1) % (Math.PI * 2);
        const dist = 20 + (exploreDir % 6) * 15;
        await this.bot.pathfinder.goto(new goals.GoalNear(
          pos.x + Math.cos(angle) * dist, pos.y, pos.z + Math.sin(angle) * dist, 3
        )).catch(() => {});
        await this._sleep(300);
        continue;
      }
      exploreDir = 0;

      // ── Находим основание дерева (нижний log) ────────────────────
      let bx = logBlock.position.x, bz = logBlock.position.z;
      let by = logBlock.position.y;
      for (let dy = 0; dy < 20; dy++) {
        const below = this.bot.blockAt({ x: bx, y: by - 1, z: bz });
        if (!below || below.name !== tree.log) break;
        by--;
      }

      // ── Собираем все блоки ствола ─────────────────────────────────
      const stemBlocks = [];
      for (let dy = 0; dy <= 20; dy++) {
        const lb = this.bot.blockAt({ x: bx, y: by + dy, z: bz });
        if (!lb || lb.name !== tree.log) break;
        stemBlocks.push(lb);
      }

      // ── Начинаем движение к дереву и рубим на ходу ───────────────
      this._log("Рублю " + cropType + " (" + stemBlocks.length + " блоков)");
      for (const lb of stemBlocks) {
        if (!this._running) return;
        const d = this.bot.entity.position.distanceTo(lb.position);
        if (d > 4) {
          await this.bot.pathfinder.goto(new goals.GoalNear(lb.position.x, lb.position.y, lb.position.z, 2)).catch(() => {});
        }
        await this.bot.dig(lb).catch(() => {});
        await this._sleep(100);
      }
      totalChopped += stemBlocks.length;

      // ── Подбираем дроп (ждём немного) ────────────────────────────
      await this._sleep(400);
      const dropped = Object.values(this.bot.entities)
        .filter(e => e.type === "object" && e.objectType === "Item" &&
          e.position?.distanceTo({ x: bx, y: by, z: bz }) < 12)
        .slice(0, 15);
      for (const item of dropped) {
        if (!this._running) return;
        if (item.position?.distanceTo(this.bot.entity.position) > 2) {
          await this.bot.pathfinder.goto(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1)).catch(() => {});
        }
        await this._sleep(80);
      }

      // ── Сажаем саженец ────────────────────────────────────────────
      const saplingItem = this.bot.inventory.items().find(i => i.name === tree.sapling);
      if (saplingItem) {
        const groundBlock = this.bot.blockAt({ x: bx, y: by - 1, z: bz });
        const airBlock = this.bot.blockAt({ x: bx, y: by, z: bz });
        if (groundBlock && airBlock?.name === "air" &&
          ["grass_block","dirt","coarse_dirt","podzol","rooted_dirt"].includes(groundBlock.name)) {
          await this.bot.pathfinder.goto(new goals.GoalNear(bx, by, bz, 2)).catch(() => {});
          await this.bot.equip(saplingItem, "hand").catch(() => {});
          await this.bot.activateBlock(groundBlock).catch(() => {});
          await this._sleep(150);

          // Бонемил на саженец
          const bone = this.bot.inventory.items().find(i => i.name === "bone_meal");
          if (bone) {
            await this.bot.equip(bone, "hand").catch(() => {});
            for (let bmi = 0; bmi < 8; bmi++) {
              const bn = this.bot.inventory.items().find(ii => ii.name === "bone_meal");
              if (!bn) break;
              const sap = this.bot.blockAt({ x: bx, y: by, z: bz });
              if (!sap || sap.name === "air") break; // вырос в дерево
              await this.bot.equip(bn, "hand").catch(() => {});
              await this.bot.activateBlock(sap).catch(() => {});
              await this._sleep(80);
            }
          }
        }
      }

      // ── Сдать в сундук если инвентарь полон ───────────────────────
      if (this.bot.inventory.items().length > 25) await this._depositFarmItems();

      this._log("✅ Цикл #" + (cycle + 1) + " | всего срублено: " + totalChopped + " блоков");
      await this._sleep(300);
    }
    this._chat("🌲 Ферма деревьев остановлена. Срублено: " + totalChopped + " блоков");
  }

  // ══════════════════════════════════════════════════════════════════
  // ФЕРМА КУЛЬТУР — полный автоматический цикл с костной мукой
  // ══════════════════════════════════════════════════════════════════

  async _taskFarmCrops(radius, cropType, delay = 300, useBoneMeal = true) {
    this._log("Запускаю ферму культур: " + cropType + " радиус " + radius + "м");
    this._chat("🌾 Ферма культур запущена: " + cropType);
    if (!this.bot?.entity) return;

    const CROPS = {
      wheat:    { seed: "wheat_seeds",    block: "wheat",        maxAge: 7, requiredGround: "farmland" },
      carrot:   { seed: "carrot",         block: "carrots",      maxAge: 7, requiredGround: "farmland" },
      potato:   { seed: "potato",         block: "potatoes",     maxAge: 7, requiredGround: "farmland" },
      beetroot: { seed: "beetroot_seeds", block: "beetroots",    maxAge: 3, requiredGround: "farmland" },
      melon:    { seed: "melon_seeds",    block: "melon_stem",   maxAge: 7, requiredGround: "farmland" },
      pumpkin:      { seed: "pumpkin_seeds",  block: "pumpkin_stem",  maxAge: 7, requiredGround: "farmland" },
      nether_wart:  { seed: "nether_wart",     block: "nether_wart",   maxAge: 3, requiredGround: "soul_sand"  },
    };
    const crop = CROPS[cropType] || CROPS.wheat;

    for (let cycle = 0; cycle < 9999 && this._running; cycle++) {
      const pos = this.bot.entity.position.clone();
      this._log("Цикл #" + (cycle + 1) + " pos:" + Math.round(pos.x) + "," + Math.round(pos.y) + "," + Math.round(pos.z));

      // ── 1. Вспахать землю ────────────────────────────────────────
      const hoe = this.bot.inventory.items().find(i => i.name.includes("_hoe"));
      const farmlands = this._blocksInRadius(crop.requiredGround || "farmland", radius, pos);
      if (farmlands.length < 4 && hoe && (crop.requiredGround || "farmland") === "farmland") {
        const dirtBlocks = this._blocksInRadius("dirt", Math.min(radius, 12), pos)
          .concat(this._blocksInRadius("grass_block", Math.min(radius, 12), pos))
          .slice(0, 30);
        if (dirtBlocks.length > 0) {
          await this.bot.equip(hoe, "hand").catch(() => {});
          for (const b of dirtBlocks) {
            if (!this._running) return;
            await this.bot.pathfinder.goto(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 2)).catch(() => {});
            await this.bot.activateBlock(b).catch(() => {});
            await this._sleep(150);
          }
        }
      }

      // ── 2. Посадить семена на пустые грядки ─────────────────────
      const groundType = (crop && crop.requiredGround) ? crop.requiredGround : "farmland";
      const freshFarmlands = this._blocksInRadius(groundType, radius, pos);
      if (freshFarmlands.length === 0) {
        this._chat("⚠️ Нет " + groundType + "! Нужен подходящий блок почвы.");
        await this._sleep(15000);
        continue;
      }

      const seedName = crop.seed;
      let seedItem = this.bot.inventory.items().find(i => i.name === seedName);
      if (!seedItem && (cropType === "carrot" || cropType === "potato")) {
        seedItem = this.bot.inventory.items().find(i => i.name === cropType);
      }
      if (!seedItem) {
        this._chat("⚠️ Нет семян (" + seedName + ") в инвентаре!");
        await this._sleep(10000);
        continue;
      }

      let planted = 0;
      for (const farmland of freshFarmlands) {
        if (!this._running) return;
        const above = this.bot.blockAt(farmland.position.offset(0, 1, 0));
        if (!above || above.name !== "air") continue;

        const s = this.bot.inventory.items().find(i =>
          i.name === seedName || ((cropType === "carrot" || cropType === "potato") && i.name === cropType)
        );
        if (!s) break;
        await this.bot.pathfinder.goto(new goals.GoalNear(farmland.position.x, farmland.position.y, farmland.position.z, 2)).catch(() => {});
        if (!this._running) return;
        await this.bot.equip(s, "hand").catch(() => {});
        await this.bot.activateBlock(farmland).catch(() => {});
        planted++;
        await this._sleep(Math.min(delay, 200));
      }
      if (planted > 0) this._log("Посадил " + planted + " культур");

      // ── 3. Костная мука для ускорения ───────────────────────────
      if (useBoneMeal) await this._applyBoneMeal(crop, radius, pos);

      // ── 4. Ждём роста (проверяем каждые 15 сек, применяем бонемил) ─
      this._log("Жду роста...");
      for (let w = 0; w < 120 && this._running; w++) {
        await this._sleep(5000);
        const grown = this._findMatureCrops(crop, radius, pos);
        if (grown.length > 0) { this._log(grown.length + " культур выросло!"); break; }
        if (useBoneMeal && w % 4 === 0) await this._applyBoneMeal(crop, radius, pos);
        if (w % 8 === 0) this._log("Жду роста... выросло: " + grown.length + "/" + freshFarmlands.length);
      }

      // ── 5. Собрать урожай ─────────────────────────────────────────
      const harvestTargets = this._findMatureCrops(crop, radius, pos);
      let harvested = 0;
      for (const b of harvestTargets) {
        if (!this._running) return;
        await this.bot.pathfinder.goto(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 2)).catch(() => {});
        await this.bot.dig(b).catch(() => {});
        harvested++;
        await this._sleep(100);
      }
      if (harvested > 0) this._log("Собрал " + harvested + " культур!");
      await this._sleep(1200);

      // ── 6. Сложить в сундук если инвентарь полон ─────────────────
      if (this.bot.inventory.items().length > 25) {
        await this._depositFarmItems();
      }

      this._log("✅ Цикл " + (cycle + 1) + ": посажено=" + planted + " собрано=" + harvested);
      await this._sleep(500);
    }
    this._chat("🌾 Ферма остановлена");
  }

  // Применить костную муку к незрелым культурам
  async _applyBoneMeal(crop, radius, pos) {
    const bone = this.bot.inventory.items().find(i => i.name === "bone_meal");
    if (!bone) return;
    const unripe = this._blocksInRadius(crop.block, radius, pos).slice(0, 20);
    await this.bot.equip(bone, "hand").catch(() => {});
    for (const b of unripe) {
      if (!this._running) return;
      const age = b.metadata ?? 0;
      if (age >= crop.maxAge) continue;
      await this.bot.pathfinder.goto(new goals.GoalNear(b.position.x, b.position.y, b.position.z, 2)).catch(() => {});
      for (let i = 0; i < 3; i++) {
        const bn = this.bot.inventory.items().find(ii => ii.name === "bone_meal");
        if (!bn) return;
        await this.bot.equip(bn, "hand").catch(() => {});
        await this.bot.activateBlock(b).catch(() => {});
        await this._sleep(80);
      }
    }
  }

  // Найти зрелые культуры в радиусе
  _findMatureCrops(crop, radius, pos) {
    const r = Math.round(radius);
    const results = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = -3; dy <= 3; dy++) {
          const b = this.bot.blockAt(pos.offset(dx, dy, dz));
          if (b && b.name === crop.block && (b.metadata ?? 0) >= crop.maxAge) results.push(b);
        }
      }
    }
    return results;
  }

  // Найти блоки определённого типа в радиусе
  _blocksInRadius(blockName, radius, pos) {
    const r = Math.round(Math.min(radius, 40));
    const results = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = -5; dy <= 5; dy++) {
          const b = this.bot.blockAt(pos.offset(dx, dy, dz));
          if (b && b.name === blockName) results.push(b);
        }
      }
    }
    return results;
  }

  // Сложить урожай в ближайший сундук
  async _depositFarmItems() {
    let mcData;
    try { mcData = require("minecraft-data")(this.bot.version); } catch { return; }
    const chestIds = ["chest","barrel"].map(n => mcData.blocksByName[n]?.id).filter(Boolean);
    const chestBlock = this.bot.findBlock({ matching: b => chestIds.includes(b.type), maxDistance: 24 });
    if (!chestBlock) { this._log("Сундук не найден рядом"); return; }
    await this.bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)).catch(() => {});
    try {
      const window = await this.bot.openContainer(chestBlock);
      await this._sleep(400);
      const KEEP = new Set(["wooden_hoe","stone_hoe","iron_hoe","diamond_hoe","golden_hoe",
        "wheat_seeds","carrot","potato","beetroot_seeds","melon_seeds","pumpkin_seeds","bone_meal",
        "iron_pickaxe","diamond_pickaxe","stone_pickaxe","wooden_pickaxe"]);
      for (const item of this.bot.inventory.items()) {
        if (KEEP.has(item.name)) continue;
        await window.deposit(item.type, null, item.count).catch(() => {});
        await this._sleep(50);
      }
      await this.bot.closeWindow(window);
      this._log("Сдал урожай в сундук ✅");
    } catch (err) {
      this._log("Ошибка сдачи в сундук: " + err.message);
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ===================================================================
// ПАРСЕР КОМАНД ИЗ ЧАТА (русский язык → задача)
// ===================================================================
function parseCommand(message, botName) {
  const raw = message.trim();
  const msg = raw.toLowerCase();
  const nick = (botName || "").toLowerCase();

  // Обращение к боту: по нику, "бот,", или команда начинается без имени если короткая
  const addressed = !nick ||
    msg.includes(nick) ||
    /^бот[ ,!]|^bot[ ,!]/.test(msg) ||
    msg.startsWith("!") ||
    msg.length < 20; // короткие сообщения — скорее команды

  if (!addressed) return null;

  // Чистим обращение
  const clean = msg
    .replace(new RegExp(nick, "g"), "")
    .replace(/^бот[ ,!]+|^bot[ ,!]+|^!/, "")
    .replace(/[,!?.]+/g, " ")
    .trim();

  // --- СТОП ---
  if (/^(стоп|stop|останов|хватит|отмен|замри)/.test(clean)) {
    return { task: "stop" };
  }

  // --- ИНВЕНТАРЬ ---
  if (/инвентар|что (у тебя|есть)|покажи (что|вещи)|items|inventory/.test(clean)) {
    return { task: "inventory" };
  }

  // --- СТАТУС ---
  if (/статус|жизн|сколько хп|где ты|позиц|координат|status/.test(clean)) {
    return { task: "status" };
  }

  // --- ПОДОЙДИ / ИДИ СЮДА ---
  if (/иди (сюда|ко мне|ко мн|до мене|здесь)|come( here| to me)?|подойди|ко мне/.test(clean)) {
    return { task: "come_to" };
  }

  // --- СЛЕДУЙ ---
  if (/следуй|следи за мной|иди за мной|follow/.test(clean)) {
    return { task: "follow" };
  }

  // --- ДЕРЕВО ---
  if (/руби|сруб|добудь дерев|принеси дерев|gather wood|заготов дерев/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "gather_wood", count: m ? parseInt(m[1]) : 20 };
  }

  // --- КАМЕНЬ / COBBLE ---
  if (/добудь камень|накопай камн|камень|cobblestone|cobble/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "gather_stone", count: m ? parseInt(m[1]) : 32 };
  }

  // --- ЕДА ---
  if (/найди еду|добудь еду|поохоться|убей (корову|свинью|курицу|овцу)|food|hunt/.test(clean)) {
    return { task: "gather_food" };
  }

  // --- ФЕРМА ДЕРЕВЬЕВ ---
  if (/ферм.{0,8}дерев|дерево.{0,8}ферм|руби.{0,8}зон|farm.{0,8}tree|сажай дерев|вырашив/.test(clean)) {
    const radiusM = clean.match(/(\d+)/);
    const cropM = clean.match(/(дуб|берёза|берез|ель|акация|oak|birch|spruce|jungle|acacia|dark_oak)/);
    const cropMap = { 'дуб':'oak','oak':'oak','берёза':'birch','берез':'birch','birch':'birch','ель':'spruce','spruce':'spruce','jungle':'jungle','акация':'acacia','acacia':'acacia','dark_oak':'dark_oak' };
    return { task: "farm_trees", radius: radiusM ? Math.min(parseInt(radiusM[1]), 60) : 20, crop: cropM ? (cropMap[cropM[1].toLowerCase()] || 'oak') : 'oak' };
  }

  // --- ФЕРМА ПШЕНИЦЫ ---
  if (/построй ферм|сделай ферм|посади (семена|пшениц|ферм|огород)|farm/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "build_farm", size: m ? Math.min(parseInt(m[1]), 8) : 4 };
  }

  // --- ДОМ ---
  if (/построй (дом|домик|укрытие|базу)|build (house|home|shelter)/.test(clean)) {
    return { task: "build_house" };
  }

  // --- АТАКА ---
  const mobMap = {
    "зомби": "zombie", "скелет": "skeleton", "паук": "spider",
    "крипер": "creeper", "корова": "cow", "свинья": "pig",
    "курица": "chicken", "овца": "sheep", "эндермен": "enderman",
    "фантом": "phantom", "утопленник": "drowned", "zombie": "zombie",
    "skeleton": "skeleton", "creeper": "creeper",
  };
  if (/убей|атакуй|kill|attack|напади/.test(clean)) {
    for (const [ru, en] of Object.entries(mobMap)) {
      if (clean.includes(ru)) return { task: "attack", target: en };
    }
    return { task: "attack", target: null };
  }

  // --- КРАФТ ---
  const craftMap = {
    "верстак": "crafting_table", "стол": "crafting_table",
    "деревянный меч": "wooden_sword", "меч": "wooden_sword",
    "деревянная кирка": "wooden_pickaxe", "кирку": "wooden_pickaxe", "кирка": "wooden_pickaxe",
    "топор": "wooden_axe", "лопата": "wooden_shovel",
    "доски": "oak_planks", "факел": "torch", "лестница": "ladder",
  };
  if (/скрафти|сделай|изготов|craft/.test(clean)) {
    for (const [ru, en] of Object.entries(craftMap)) {
      if (clean.includes(ru)) return { task: "craft", item: en };
    }
    return { task: "craft", item: "crafting_table" };
  }

  // --- ИССЛЕДОВАНИЕ ---
  if (/исследуй|погуляй|похо|explore|прогуляйс/.test(clean)) {
    return { task: "explore" };
  }

  // --- КООРДИНАТЫ (3 числа) ---
  const coordM = clean.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
  if (coordM) {
    return { task: "walk_to", x: parseInt(coordM[1]), y: parseInt(coordM[2]), z: parseInt(coordM[3]) };
  }

  return null; // не распознали → ответит AI
}

module.exports = { TaskManager, parseCommand };
