import React, { useState, useEffect, useRef } from "react";
import { BotState } from "../store/appStore";

interface AnkaProfile {
  id: string;
  serverName: string;
  ankaName: string;
  serverHost: string;
  createdAt: number;
  steps: { windowTitle: string; slot: number; button: number; delay: number }[];
}

export default function AnkaRecorder({ bot }: { bot: BotState }) {
  const [profiles, setProfiles]       = useState<AnkaProfile[]>([]);
  const [recording, setRecording]     = useState(false);
  const [stepCount, setStepCount]     = useState(0);
  const [showForm, setShowForm]       = useState(false);
  const [serverName, setServerName]   = useState(bot.config.host || "");
  const [ankaName, setAnkaName]       = useState("");
  const [playing, setPlaying]         = useState(false);
  const [playMsg, setPlayMsg]         = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOnline = bot.status === "online";

  useEffect(() => { loadProfiles(); }, [bot.id]);

  useEffect(() => {
    if (recording) {
      pollRef.current = setInterval(async () => {
        try {
          const n = await window.electronAPI.anka.getStepCount(bot.id) as number;
          setStepCount(n || 0);
        } catch {}
      }, 500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
      setStepCount(0);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [recording, bot.id]);

  async function loadProfiles() {
    try {
      const list = await window.electronAPI.anka.list();
      if (Array.isArray(list)) setProfiles(list as AnkaProfile[]);
    } catch {}
  }

  async function startRec() {
    try { await window.electronAPI.anka.startRecording(bot.id); } catch {}
    setRecording(true); setShowForm(false); setStepCount(0);
  }

  async function stopAndSave() {
    if (!ankaName.trim()) return;
    try {
      const result: any = await window.electronAPI.anka.stopRecording(bot.id, {
        serverName, ankaName, serverHost: bot.config.host,
      });
      if (result?.error) { alert(result.error); return; }
    } catch (e: any) { alert(e?.message || "Ошибка"); return; }
    setRecording(false); setShowForm(false); setAnkaName("");
    loadProfiles();
  }

  async function cancelRec() {
    try { await window.electronAPI.anka.cancelRecording(bot.id); } catch {}
    setRecording(false); setShowForm(false); setStepCount(0);
  }

  async function playProfile(p: AnkaProfile) {
    setPlaying(true); setPlayMsg("▶ Воспроизведение…");
    try {
      const result: any = await window.electronAPI.anka.play(bot.id, p.id);
      setPlayMsg(result?.error ? `❌ ${result.error}` : "✅ Готово!");
    } catch (e: any) { setPlayMsg(`❌ ${e?.message || "Ошибка"}`); }
    setTimeout(() => { setPlaying(false); setPlayMsg(""); }, 3000);
  }

  async function deleteProfile(id: string) {
    try { await window.electronAPI.anka.delete(id); } catch {}
    loadProfiles();
  }

  const serverProfiles = profiles.filter(p =>
    !p.serverHost || p.serverHost === bot.config.host ||
    bot.config.host?.includes(p.serverHost) ||
    p.serverHost?.includes(bot.config.host ?? "")
  );

  return (
    <div style={{ fontFamily: "monospace", fontSize: 11 }}>
      {/* Header */}
      <div style={{
        padding: "6px 10px", borderBottom: "1px solid #1a2040",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>🎯</span>
          <span style={{ color: "#00ff9d" }}>Запись анки</span>
          {recording && (
            <span className="pulse" style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 3,
              background: "rgba(255,34,85,.08)", border: "1px solid #2a1020",
              color: "#ff5555",
            }}>● {stepCount > 0 ? stepCount : "0"}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {!recording ? (
            <button
              onClick={startRec} disabled={!isOnline}
              style={{
                fontSize: 9, padding: "2px 8px", borderRadius: 3,
                background: isOnline ? "rgba(0,255,157,.08)" : "rgba(0,0,0,.3)",
                border: `1px solid ${isOnline ? "rgba(0,255,157,.3)" : "#1a2040"}`,
                color: isOnline ? "#00ff9d" : "#2a3a5a",
                cursor: isOnline ? "pointer" : "not-allowed",
              }}
            >● Запись</button>
          ) : (
            <>
              {stepCount > 0 && !showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "rgba(0,255,157,.08)", border: "1px solid rgba(0,255,157,.3)", color: "#00ff9d", cursor: "pointer" }}
                >💾 ({stepCount})</button>
              )}
              <button
                onClick={cancelRec}
                style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "none", border: "1px solid #2a1a1a", color: "#4a3a3a", cursor: "pointer" }}
              >✕</button>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 5 }}>

        {/* Recording tip */}
        {recording && (
          <div style={{
            fontSize: 9, color: "#2a4060", padding: "4px 7px",
            background: "rgba(255,34,85,.04)", border: "1px solid rgba(255,34,85,.12)",
            borderRadius: 4, lineHeight: 1.5,
          }}>
            ● Кликай предметы в инвентаре (центральная панель) — клики записываются автоматически
          </div>
        )}

        {/* Save form */}
        {showForm && (
          <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 4, padding: "7px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ color: "#00ff9d", fontSize: 10, marginBottom: 2 }}>Сохранить анку ({stepCount} кликов)</div>
            <input
              style={{ background: "#05070f", border: "1px solid #1a2040", borderRadius: 3, padding: "3px 6px", color: "#c8d8f0", fontSize: 10, outline: "none" }}
              placeholder="Сервер (funtime.su)"
              value={serverName} onChange={e => setServerName(e.target.value)}
            />
            <input
              autoFocus
              style={{ background: "#05070f", border: "1px solid #1a2040", borderRadius: 3, padding: "3px 6px", color: "#c8d8f0", fontSize: 10, outline: "none" }}
              placeholder="Название анки"
              value={ankaName} onChange={e => setAnkaName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && stopAndSave()}
            />
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={stopAndSave} disabled={!ankaName.trim()}
                style={{
                  flex: 1, fontSize: 10, padding: "4px", borderRadius: 3,
                  background: ankaName.trim() ? "rgba(0,255,157,.1)" : "rgba(0,0,0,.3)",
                  border: `1px solid ${ankaName.trim() ? "rgba(0,255,157,.3)" : "#1a2040"}`,
                  color: ankaName.trim() ? "#00ff9d" : "#2a3a5a",
                  cursor: ankaName.trim() ? "pointer" : "not-allowed",
                }}
              >✅ Сохранить</button>
              <button
                onClick={() => setShowForm(false)}
                style={{ flex: 1, fontSize: 10, padding: "4px", borderRadius: 3, background: "none", border: "1px solid #1a2040", color: "#3a4a6a", cursor: "pointer" }}
              >Отмена</button>
            </div>
          </div>
        )}

        {/* Play result */}
        {playMsg && (
          <div style={{ fontSize: 10, padding: "3px 7px", borderRadius: 3, background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", color: "#6a80a8", textAlign: "center" }}>
            {playMsg}
          </div>
        )}

        {/* Profile list for this server */}
        {serverProfiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 9, color: "#2a3a5a", padding: "2px 0" }}>Анки — {bot.config.host}:</div>
            {serverProfiles.map(p => (
              <div key={p.id} style={{ background: "rgba(0,0,0,.3)", border: "1px solid #1a2040", borderRadius: 4, padding: "5px 7px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#00ff9d", fontSize: 10 }}>🎯 {p.ankaName}</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    <button
                      onClick={() => playProfile(p)}
                      disabled={playing || recording || !isOnline}
                      style={{
                        fontSize: 9, padding: "2px 7px", borderRadius: 3,
                        background: "none", border: "1px solid rgba(0,255,157,.3)",
                        color: "#00ff9d", cursor: "pointer",
                        opacity: (playing || recording || !isOnline) ? 0.35 : 1,
                      }}
                    >▶</button>
                    <button
                      onClick={() => deleteProfile(p.id)}
                      style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: "none", border: "1px solid rgba(255,34,85,.3)", color: "#ff2255", cursor: "pointer" }}
                    >✕</button>
                  </div>
                </div>
                <div style={{ color: "#2a3a5a", fontSize: 9, marginTop: 2 }}>
                  {p.steps.length} кликов · {new Date(p.createdAt).toLocaleDateString("ru")}
                </div>
                <div style={{ display: "flex", gap: 2, marginTop: 3, flexWrap: "wrap" }}>
                  {p.steps.slice(0, 8).map((st, i) => (
                    <span key={i} style={{
                      fontSize: 8, padding: "1px 3px", borderRadius: 2,
                      background: st.button === 0 ? "rgba(0,255,157,.05)" : "rgba(255,170,0,.05)",
                      border: `1px solid ${st.button === 0 ? "rgba(0,255,157,.18)" : "rgba(255,170,0,.18)"}`,
                      color: st.button === 0 ? "#00ff9d44" : "#ffaa0044",
                    }}>
                      {st.button === 1 ? "П" : "Л"}#{String(st.slot)}
                    </span>
                  ))}
                  {p.steps.length > 8 && <span style={{ fontSize: 8, color: "#1e2a3a" }}>+{p.steps.length - 8}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isOnline && !recording && serverProfiles.length === 0 && (
          <div style={{ textAlign: "center", color: "#1e2a3a", padding: "10px 0", fontSize: 10 }}>
            Подключите бота для записи
          </div>
        )}

        {isOnline && !recording && serverProfiles.length === 0 && (
          <div style={{ textAlign: "center", color: "#2a3a5a", padding: "10px 0", fontSize: 10 }}>
            Нажмите «● Запись», кликай в инвентаре
          </div>
        )}

      </div>
    </div>
  );
}
