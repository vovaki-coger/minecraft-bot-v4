import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const TREE_TYPES = [
  { id: "oak",      label: "🌳 Дуб",         color: "#7ecc49" },
  { id: "birch",    label: "🌿 Берёза",       color: "#d4e8a0" },
  { id: "spruce",   label: "🌲 Ель",          color: "#2e7d32" },
  { id: "jungle",   label: "🌴 Джунгли",      color: "#4caf50" },
  { id: "acacia",   label: "🍂 Акация",       color: "#ff8a65" },
  { id: "dark_oak", label: "🌑 Тёмный дуб",  color: "#5d4037" },
];

const CROP_TYPES = [
  { id: "wheat",    label: "🌾 Пшеница",     color: "#ffd54f" },
  { id: "potato",   label: "🥔 Картошка",    color: "#bcaaa4" },
  { id: "carrot",   label: "🥕 Морковка",    color: "#ff7043" },
  { id: "beetroot", label: "🫛 Свёкла",      color: "#c62828" },
  { id: "melon",    label: "🍈 Дыня",        color: "#66bb6a" },
  { id: "pumpkin",  label: "🎃 Тыква",       color: "#fb8c00" },
];

type FarmMode = "trees" | "crops";

interface TaskLog {
  msg: string;
  time: number;
}

export default function FarmTab() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find(b => b.id === selectedBotId) || bots[0] || null;

  const [mode, setMode]         = useState<FarmMode>("trees");
  const [treeType, setTreeType] = useState("oak");
  const [cropType, setCropType] = useState("wheat");
  const [radius, setRadius]     = useState(20);
  const [isRunning, setIsRunning] = useState(false);
  const [log, setLog]           = useState<TaskLog[]>([]);
  const logRef                  = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) =>
    setLog(prev => [...prev.slice(-99), { msg, time: Date.now() }]);

  // Listen to task log events from backend
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubs: Array<() => void> = [];

    unsubs.push(window.electronAPI.on("bot:taskLog", (d: any) => {
      if (d?.botId !== bot?.id) return;
      addLog(d.message || String(d.msg || ""));
    }));
    unsubs.push(window.electronAPI.on("bot:taskStarted", (d: any) => {
      if (d?.botId !== bot?.id) return;
      setIsRunning(true);
      addLog("▶️ Ферма запущена: " + (d.task || ""));
    }));
    unsubs.push(window.electronAPI.on("bot:taskStopped", (d: any) => {
      if (d?.botId !== bot?.id) return;
      setIsRunning(false);
      addLog("⏹ Ферма остановлена");
    }));

    return () => { for (const fn of unsubs) { try { fn(); } catch {} } };
  }, [bot?.id]);

  useEffect(() => {
    setIsRunning(false);
    setLog([]);
  }, [bot?.id]);

  useEffect(() => {
    logRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  async function handleStart() {
    if (!bot || bot.status !== "online") return;
    const taskName = mode === "trees" ? "farm_trees" : "farm_crops";
    const args     = mode === "trees"
      ? { radius, crop: treeType }
      : { radius, crop: cropType };

    setLog([]);
    addLog(`🚀 Запускаю ${mode === "trees" ? "ферму деревьев" : "ферму культур"}...`);

    try {
      await (window.electronAPI?.bot as any).runTask(bot.id, taskName, args);
    } catch {
      // fallback: send as text command via chat (triggers bot-tasks parser)
      const text = mode === "trees"
        ? `ферма деревьев ${radius}м ${treeType}`
        : `ферма ${cropType} ${radius}м`;
      addLog(`📨 Команда: ${text}`);
      await window.electronAPI.bot.sendChat(bot.id, text);
      setIsRunning(true);
    }
  }

  async function handleStop() {
    if (!bot) return;
    try {
      await (window.electronAPI?.bot as any).stopTask(bot.id);
    } catch {
      await window.electronAPI.bot.stopAction(bot.id);
    }
    setIsRunning(false);
    addLog("⏹ Останавливаю ферму...");
  }

  const isOnline  = bot?.status === "online";
  const modeColor = mode === "trees" ? "#7ecc49" : "#ffd54f";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "6px 10px", borderBottom: "1px solid #1a2040", fontSize: 11, color: "#2a3a5a", fontFamily: "monospace", background: "#060810" }}>
        🌲 Ферма ресурсов
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>

        {/* Mode switcher */}
        <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,.4)", border: "1px solid #1a2040", borderRadius: 6, padding: 3 }}>
          {(["trees", "crops"] as FarmMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "5px 0", fontSize: 11, fontFamily: "monospace", borderRadius: 4, cursor: "pointer",
              background: mode === m ? (m === "trees" ? "rgba(126,204,73,.12)" : "rgba(255,213,79,.12)") : "transparent",
              border: mode === m ? `1px solid ${m === "trees" ? "rgba(126,204,73,.4)" : "rgba(255,213,79,.4)"}` : "1px solid transparent",
              color: mode === m ? (m === "trees" ? "#7ecc49" : "#ffd54f") : "#3a4a6a",
              transition: "all .15s",
            }}>
              {m === "trees" ? "🌲 Деревья" : "🌾 Культуры"}
            </button>
          ))}
        </div>

        {/* Tree selector */}
        {mode === "trees" && (
          <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 5, padding: 8 }}>
            <p style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "monospace", marginBottom: 6 }}>ВИД ДЕРЕВА:</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {TREE_TYPES.map(t => (
                <button key={t.id} onClick={() => setTreeType(t.id)} style={{
                  padding: "6px 8px", fontSize: 11, fontFamily: "monospace", borderRadius: 4, cursor: "pointer",
                  background: treeType === t.id ? `rgba(126,204,73,.1)` : "rgba(0,0,0,.3)",
                  border: treeType === t.id ? `1px solid ${t.color}55` : "1px solid #1a2040",
                  color: treeType === t.id ? t.color : "#3a4a6a",
                  textAlign: "left", transition: "all .15s",
                }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Crop selector */}
        {mode === "crops" && (
          <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 5, padding: 8 }}>
            <p style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "monospace", marginBottom: 6 }}>ВИД КУЛЬТУРЫ:</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {CROP_TYPES.map(c => (
                <button key={c.id} onClick={() => setCropType(c.id)} style={{
                  padding: "6px 8px", fontSize: 11, fontFamily: "monospace", borderRadius: 4, cursor: "pointer",
                  background: cropType === c.id ? `rgba(255,213,79,.08)` : "rgba(0,0,0,.3)",
                  border: cropType === c.id ? `1px solid ${c.color}55` : "1px solid #1a2040",
                  color: cropType === c.id ? c.color : "#3a4a6a",
                  textAlign: "left", transition: "all .15s",
                }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Radius */}
        <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 5, padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <p style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "monospace" }}>РАДИУС ЗОНЫ:</p>
            <span style={{ fontSize: 13, color: modeColor, fontFamily: "monospace", fontWeight: "bold" }}>
              {radius}м
            </span>
          </div>
          <input type="range" min={5} max={60} step={5} value={radius}
            onChange={e => setRadius(Number(e.target.value))}
            disabled={isRunning}
            style={{ width: "100%", accentColor: modeColor, cursor: isRunning ? "not-allowed" : "pointer" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#2a3a5a", fontFamily: "monospace", marginTop: 2 }}>
            <span>5м</span><span>30м</span><span>60м</span>
          </div>
        </div>

        {/* Summary */}
        <div style={{ background: `rgba(${mode === "trees" ? "126,204,73" : "255,213,79"},.04)`, border: `1px solid rgba(${mode === "trees" ? "126,204,73" : "255,213,79"},.15)`, borderRadius: 5, padding: "7px 10px" }}>
          <p style={{ fontSize: 10, fontFamily: "monospace", color: "#3a5070" }}>
            Задача:&nbsp;
            <span style={{ color: modeColor }}>
              {mode === "trees"
                ? `${TREE_TYPES.find(t => t.id === treeType)?.label} в зоне ${radius}м`
                : `${CROP_TYPES.find(c => c.id === cropType)?.label} в зоне ${radius}м`}
            </span>
          </p>
          {mode === "trees" && (
            <p style={{ fontSize: 9, color: "#2a3a5a", marginTop: 3 }}>
              Рубит → сдаёт в сундук → сажает саженцы → бонемил → повторяет
            </p>
          )}
          {mode === "crops" && (
            <p style={{ fontSize: 9, color: "#2a3a5a", marginTop: 3 }}>
              Поливает → собирает урожай → сажает снова → сдаёт в сундук
            </p>
          )}
        </div>

        {/* Start/Stop button */}
        <button
          onClick={isRunning ? handleStop : handleStart}
          disabled={!isOnline}
          style={{
            padding: "10px 0", fontSize: 12, fontFamily: "monospace", borderRadius: 5, cursor: isOnline ? "pointer" : "not-allowed",
            background: isRunning
              ? "rgba(255,34,85,.08)"
              : isOnline ? `rgba(${mode === "trees" ? "126,204,73" : "255,213,79"},.08)` : "rgba(0,0,0,.3)",
            border: isRunning
              ? "1px solid rgba(255,34,85,.4)"
              : isOnline ? `1px solid rgba(${mode === "trees" ? "126,204,73" : "255,213,79"},.4)` : "1px solid #1a2040",
            color: isRunning ? "#ff2255" : isOnline ? modeColor : "#2a3a5a",
            boxShadow: isRunning ? "0 0 12px rgba(255,34,85,.15)" : isOnline ? `0 0 12px rgba(${mode === "trees" ? "126,204,73" : "255,213,79"},.1)` : "none",
            transition: "all .2s", opacity: isOnline ? 1 : 0.4,
          }}
        >
          {!isOnline ? "⚠️ Бот не в сети" : isRunning ? "⏹ Остановить ферму" : "▶ Запустить ферму"}
        </button>

        {/* Log */}
        {log.length > 0 && (
          <div style={{ background: "rgba(0,0,0,.4)", border: "1px solid #1a2040", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ padding: "4px 8px", borderBottom: "1px solid #1a2040", fontSize: 9, color: "#2a3a5a", fontFamily: "monospace" }}>
              ЛOGI ФЕРМЫ
            </div>
            <div style={{ maxHeight: 160, overflowY: "auto", padding: 6 }}>
              {log.map((entry, i) => {
                const d = new Date(entry.time);
                const t = `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}`;
                return (
                  <div key={i} style={{ fontSize: 10, fontFamily: "monospace", color: "#4a6080", marginBottom: 2, lineHeight: 1.4 }}>
                    <span style={{ color: "#2a3a5a" }}>[{t}]</span>{" "}
                    <span style={{ color: entry.msg.startsWith("⏹") ? "#ff5555" : entry.msg.startsWith("▶") || entry.msg.startsWith("🚀") ? modeColor : "#4a6080" }}>
                      {entry.msg}
                    </span>
                  </div>
                );
              })}
              <div ref={logRef} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
