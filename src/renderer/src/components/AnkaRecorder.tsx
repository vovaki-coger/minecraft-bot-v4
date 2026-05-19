import React, { useState, useEffect, useRef } from "react";
import { useAppStore, BotState } from "../store/appStore";

interface AnkaProfile {
  id: string;
  serverName: string;
  ankaName: string;
  serverHost: string;
  createdAt: number;
  steps: { windowTitle: string; slot: number; button: number; delay: number }[];
}

interface WindowSlot {
  slot: number;
  name: string;
  displayName: string;
  count: number;
}

interface BotWindow {
  title: string;
  slots: WindowSlot[];
}

// Minecraft item name → emoji
const ITEM_EMOJI: Record<string, string> = {
  diamond_sword: "⚔️", iron_sword: "🗡️", bow: "🏹", shield: "🛡️",
  diamond_helmet: "⛑️", diamond_chestplate: "🦺", diamond_leggings: "👖",
  leather_boots: "👢", diamond_boots: "👟",
  golden_apple: "🍎", apple: "🍏", bread: "🍞", cooked_beef: "🥩",
  potion: "🧪", splash_potion: "💥",
  paper: "📄", book: "📕", writable_book: "📓", written_book: "📖",
  emerald: "💚", diamond: "💎", gold_ingot: "🪙", iron_ingot: "⚙️",
  nether_star: "⭐", end_crystal: "🔮",
  chest: "📦", ender_chest: "🎁",
  compass: "🧭", map: "🗺️", clock: "⏰",
  skull: "💀", player_head: "👤",
  arrow: "➡️", oak_planks: "🪵",
  grass_block: "🟩", stone: "🪨",
  default: "📦",
};

function getEmoji(name: string) {
  return ITEM_EMOJI[name] || ITEM_EMOJI.default;
}

const colorBtn = {
  background: "none", border: "1px solid #3a3a3a", borderRadius: 4,
  color: "#aaa", cursor: "pointer", padding: "3px 10px", fontSize: 11,
};

export default function AnkaRecorder({ bot }: { bot: BotState }) {
  const [profiles, setProfiles] = useState<AnkaProfile[]>([]);
  const [recording, setRecording] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [currentWindow, setCurrentWindow] = useState<BotWindow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [serverName, setServerName] = useState(bot.config.host || "");
  const [ankaName, setAnkaName] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playMsg, setPlayMsg] = useState("");
  const [clickedSlots, setClickedSlots] = useState<number[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadProfiles();
    // Listen to window open events
    const unsub = window.electronAPI.on("bot:windowOpen", (d: { botId: string; window: BotWindow }) => {
      if (d.botId === bot.id) setCurrentWindow(d.window);
    });
    const unsub2 = window.electronAPI.on("bot:windowClose", (d: { botId: string }) => {
      if (d.botId === bot.id) setCurrentWindow(null);
    });
    return () => { unsub(); unsub2(); };
  }, [bot.id]);

  useEffect(() => {
    if (recording) {
      pollRef.current = setInterval(async () => {
        const n = await window.electronAPI.anka.getStepCount(bot.id).catch(() => 0);
        setStepCount(n);
      }, 500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
      setStepCount(0);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [recording, bot.id]);

  async function loadProfiles() {
    const list = await window.electronAPI.anka.list().catch(() => []);
    setProfiles(list);
  }

  async function startRec() {
    await window.electronAPI.anka.startRecording(bot.id);
    setRecording(true);
    setClickedSlots([]);
    setShowForm(false);
  }

  async function clickSlot(slot: WindowSlot) {
    if (!recording) return;
    await window.electronAPI.anka.addStep(bot.id, {
      windowTitle: currentWindow?.title || "",
      slot: slot.slot,
      button: 0,
    });
    setClickedSlots(prev => [...prev, slot.slot]);
    // Visually flash
    setTimeout(() => setClickedSlots(prev => prev.filter(s => s !== slot.slot)), 600);
  }

  async function stopAndSave() {
    if (!ankaName.trim()) return;
    const result = await window.electronAPI.anka.stopRecording(bot.id, {
      serverName,
      ankaName,
      serverHost: bot.config.host,
    }).catch((e: any) => ({ error: e.message }));
    if (result.error) { alert(result.error); return; }
    setRecording(false);
    setShowForm(false);
    setAnkaName("");
    await loadProfiles();
  }

  async function cancelRec() {
    await window.electronAPI.anka.cancelRecording(bot.id);
    setRecording(false);
    setShowForm(false);
    setClickedSlots([]);
  }

  async function playProfile(profile: AnkaProfile) {
    setPlaying(true);
    setPlayMsg("▶️ Воспроизведение...");
    const result = await window.electronAPI.anka.play(bot.id, profile.id)
      .catch((e: any) => ({ error: e.message }));
    setPlayMsg(result.error ? `❌ ${result.error}` : "✅ Выполнено!");
    setTimeout(() => { setPlaying(false); setPlayMsg(""); }, 2500);
  }

  async function deleteProfile(id: string) {
    await window.electronAPI.anka.delete(id);
    loadProfiles();
  }

  const serverProfiles = profiles.filter(p =>
    !p.serverHost || p.serverHost === bot.config.host ||
    bot.config.host?.includes(p.serverHost)
  );

  return (
    <div style={{ fontFamily: "monospace" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "#3a3a3a" }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }}>🎯</span>
          <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>Запись анки</span>
          {recording && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#3a0000", color: "#ff5555", border: "1px solid #550000" }}>
              ● РЕК {stepCount > 0 ? `(${stepCount} кликов)` : ""}
            </span>
          )}
        </div>
        {!recording && (
          <button onClick={startRec} className="text-xs px-2 py-1 rounded"
            style={{ background: "#1a3a1a", border: "1px solid #3a6a3a", color: "#7ecc49", cursor: "pointer" }}>
            + Записать
          </button>
        )}
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Recording UI */}
        {recording && (
          <div style={{ background: "#1a0a0a", border: "1px solid #5a1a1a", borderRadius: 6, padding: 10 }}>
            <div className="text-xs mb-2" style={{ color: "#ff8888" }}>
              🔴 Запись активна — нажимай на слоты ниже, бот их кликнет
            </div>

            {/* Current window */}
            {currentWindow ? (
              <div>
                <div className="text-xs mb-2" style={{ color: "#888" }}>
                  Окно: <span style={{ color: "#e8e8e8" }}>{currentWindow.title}</span>
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(9, 1fr)",
                  gap: 3,
                  background: "#111",
                  padding: 6,
                  borderRadius: 4,
                  border: "1px solid #2a2a2a",
                }}>
                  {currentWindow.slots.map((slot) => (
                    <div key={slot.slot}
                      onClick={() => clickSlot(slot)}
                      title={`Слот ${slot.slot}: ${slot.displayName || slot.name}`}
                      style={{
                        width: "100%",
                        aspectRatio: "1",
                        background: clickedSlots.includes(slot.slot)
                          ? "#3a6a3a" : "#1e1e1e",
                        border: clickedSlots.includes(slot.slot)
                          ? "2px solid #7ecc49" : "1px solid #2a2a2a",
                        borderRadius: 3,
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        transition: "all 0.2s",
                        position: "relative",
                      }}>
                      <span>{slot.name ? getEmoji(slot.name) : ""}</span>
                      {slot.count > 1 && (
                        <span style={{ fontSize: 8, color: "#ffcc44", position: "absolute", bottom: 1, right: 2 }}>
                          {slot.count}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-xs mt-1" style={{ color: "#555" }}>
                  Наведи на слот чтобы увидеть название
                </div>
              </div>
            ) : (
              <div className="text-xs text-center py-4" style={{ color: "#555", border: "1px dashed #2a2a2a", borderRadius: 4 }}>
                Ожидаю открытие окна инвентаря/меню в игре...
                <br />
                <span style={{ color: "#444", fontSize: 10 }}>Бот должен зайти в лобби и открыть меню</span>
              </div>
            )}

            {/* Save form */}
            {stepCount > 0 && !showForm && (
              <button onClick={() => setShowForm(true)} className="w-full text-xs mt-2 py-1.5 rounded"
                style={{ background: "#1a3a1a", border: "1px solid #3a6a3a", color: "#7ecc49", cursor: "pointer" }}>
                💾 Сохранить запись ({stepCount} кликов)
              </button>
            )}

            {showForm && (
              <div className="mt-2 flex flex-col gap-2">
                <input style={{ background: "#111", border: "1px solid #3a3a3a", borderRadius: 4, padding: "4px 8px", color: "#e8e8e8", fontSize: 11 }}
                  placeholder="Сервер (напр. funtime.su)"
                  value={serverName} onChange={e => setServerName(e.target.value)} />
                <input style={{ background: "#111", border: "1px solid #3a3a3a", borderRadius: 4, padding: "4px 8px", color: "#e8e8e8", fontSize: 11 }}
                  placeholder="Название анки (напр. Лучник, Маг...)"
                  value={ankaName} onChange={e => setAnkaName(e.target.value)}
                  autoFocus />
                <div className="flex gap-2">
                  <button onClick={stopAndSave} disabled={!ankaName.trim()}
                    style={{ flex: 1, background: "#1a3a1a", border: "1px solid #3a6a3a", borderRadius: 4, color: "#7ecc49", fontSize: 11, padding: "5px", cursor: "pointer", opacity: ankaName.trim() ? 1 : 0.4 }}>
                    ✅ Сохранить
                  </button>
                  <button onClick={cancelRec} style={{ ...colorBtn, flex: 1 }}>Отмена</button>
                </div>
              </div>
            )}

            {!showForm && (
              <button onClick={cancelRec} className="w-full text-xs mt-1 py-1 rounded"
                style={{ background: "none", border: "1px solid #3a1a1a", color: "#888", cursor: "pointer" }}>
                ✕ Отменить запись
              </button>
            )}
          </div>
        )}

        {/* Play status */}
        {playMsg && (
          <div className="text-xs px-2 py-1.5 rounded text-center"
            style={{ background: "#1a1a2a", border: "1px solid #3a3a6a", color: "#aaaaff" }}>
            {playMsg}
          </div>
        )}

        {/* Saved profiles */}
        {serverProfiles.length > 0 ? (
          <div>
            <div className="text-xs mb-1.5" style={{ color: "#555" }}>
              Сохранённые анки для {bot.config.host}:
            </div>
            <div className="flex flex-col gap-2">
              {serverProfiles.map(p => (
                <div key={p.id} style={{
                  background: "#1a1a1a", border: "1px solid #2a3a2a",
                  borderRadius: 6, padding: "8px 10px",
                }}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span style={{ fontSize: 14 }}>🎯</span>
                        <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>{p.ankaName}</span>
                      </div>
                      <div className="text-xs" style={{ color: "#555" }}>
                        🖥️ {p.serverName}
                        {p.serverHost && ` · ${p.serverHost}`}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "#444" }}>
                        {p.steps.length} кликов · {new Date(p.createdAt).toLocaleDateString("ru")}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 ml-2">
                      <button onClick={() => playProfile(p)} disabled={playing || recording || bot.status !== "online"}
                        style={{ ...colorBtn, color: "#7ecc49", borderColor: "#3a6a3a",
                          background: "#1a2a1a", opacity: (playing || recording || bot.status !== "online") ? 0.4 : 1 }}>
                        ▶ Выбрать
                      </button>
                      <button onClick={() => deleteProfile(p.id)}
                        style={{ ...colorBtn, color: "#ff5555", borderColor: "#3a1a1a" }}>
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Steps preview */}
                  <div className="mt-1.5 flex gap-1 flex-wrap">
                    {p.steps.slice(0, 8).map((s, i) => (
                      <span key={i} style={{
                        background: "#0a1a0a", border: "1px solid #2a3a2a",
                        borderRadius: 3, padding: "1px 5px", fontSize: 9, color: "#556655",
                      }}>
                        #{s.slot}
                      </span>
                    ))}
                    {p.steps.length > 8 && (
                      <span style={{ fontSize: 9, color: "#444" }}>+{p.steps.length - 8}...</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : !recording && (
          <div className="text-xs text-center py-6" style={{ color: "#444" }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>🎯</div>
            Нет записей анок для этого сервера
            <br />
            <span style={{ color: "#333" }}>Нажми «+ Записать» и кликни нужные слоты</span>
          </div>
        )}

        {/* Other profiles */}
        {profiles.length > serverProfiles.length && (
          <details>
            <summary className="text-xs cursor-pointer" style={{ color: "#444" }}>
              Другие серверы ({profiles.length - serverProfiles.length})
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              {profiles.filter(p => !serverProfiles.find(s => s.id === p.id)).map(p => (
                <div key={p.id} style={{
                  background: "#111", border: "1px solid #1e1e1e",
                  borderRadius: 4, padding: "6px 8px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <span className="text-xs" style={{ color: "#888" }}>🎯 {p.ankaName}</span>
                    <span className="text-xs ml-2" style={{ color: "#444" }}>{p.serverName}</span>
                  </div>
                  <button onClick={() => deleteProfile(p.id)}
                    style={{ ...colorBtn, color: "#ff5555", borderColor: "#3a1a1a", padding: "2px 6px" }}>
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
