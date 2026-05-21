import React, { useState, useRef, useEffect, useCallback } from "react";
import { BotState, ChatMessage } from "../../store/appStore";

interface Props {
  bot: BotState | null;
}

type ChatTab = "minecraft" | "ai";

function useChatScroll(dep: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const [hasNew, setHasNew] = useState(false);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 30) {
      pinnedToBottom.current = true;
      setHasNew(false);
    } else {
      pinnedToBottom.current = false;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [dep]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedToBottom.current = true;
    setHasNew(false);
  }, []);

  return { containerRef, hasNew, scrollToBottom };
}

function getMsgColor(type: ChatMessage["type"]) {
  switch (type) {
    case "user":     return "#7fb3d3";
    case "player":   return "#e8e8e8";
    case "bot":      return "#7ecc49";
    case "ai":       return "#c084fc";
    case "system":   return "#888888";
    case "server":   return "#bdc3c7";
    case "survivor": return "#f59e0b";
    default:         return "#e8e8e8";
  }
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const CHAT_TYPES: ChatMessage["type"][] = ["player", "user", "bot", "ai", "server"];
const LOG_TYPES:  ChatMessage["type"][] = ["system", "survivor"];

function ScrollArea({
  msgs, scroll, fontSize = 11, emptyText,
}: {
  msgs: ChatMessage[];
  scroll: ReturnType<typeof useChatScroll>;
  fontSize?: number;
  emptyText: string;
}) {
  return (
    <div style={{ flex: 1, position: "relative", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        ref={scroll.containerRef}
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          padding: "4px 8px", minHeight: 0,
          fontFamily: "'Courier New', monospace",
          fontSize, lineHeight: 1.45,
        }}
      >
        {msgs.length === 0 ? (
          <div style={{ color: "#444", textAlign: "center", marginTop: 12, fontSize: 10 }}>{emptyText}</div>
        ) : (
          msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 1, wordBreak: "break-word" }}>
              <span style={{ color: "#3a4a5a", marginRight: 4 }}>[{formatTime(m.timestamp)}]</span>
              <span style={{ color: getMsgColor(m.type) }}>{m.text}</span>
            </div>
          ))
        )}
      </div>
      {scroll.hasNew && (
        <button
          onClick={scroll.scrollToBottom}
          style={{
            position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
            background: "rgba(30,40,60,0.9)", border: "1px solid rgba(0,200,255,.4)",
            borderRadius: 10, padding: "2px 10px", cursor: "pointer",
            color: "#00c8ff", fontSize: 10, fontFamily: "monospace",
            zIndex: 10, whiteSpace: "nowrap", boxShadow: "0 1px 6px rgba(0,0,0,.6)",
          }}
        >
          ↓ новые
        </button>
      )}
    </div>
  );
}

export default function RightPanel({ bot }: Props) {
  const [input, setInput]         = useState("");
  const [aiInput, setAiInput]     = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("minecraft");
  const [autoResponse, setAutoResponse] = useState(false);
  const [lobbyLoading, setLobbyLoading] = useState(false);

  const allMsgs  = bot?.chatHistory    || [];
  const aiMsgs   = bot?.aiChatHistory  || [];

  const chatMsgs = allMsgs.filter(m => CHAT_TYPES.includes(m.type));
  const logMsgs  = allMsgs.filter(m => LOG_TYPES.includes(m.type));

  const chatScroll = useChatScroll(chatMsgs.length);
  const logScroll  = useChatScroll(logMsgs.length);
  const aiScroll   = useChatScroll(aiMsgs.length);

  useEffect(() => {
    if (bot) setAutoResponse(!!(bot.config as any).autoResponse);
  }, [bot?.id]);

  async function handleAutoResponseToggle(checked: boolean) {
    setAutoResponse(checked);
    if (bot) await window.electronAPI.bot.updateConfig(bot.id, { autoResponse: checked });
  }

  async function handleSendMinecraft() {
    if (!input.trim() || !bot) return;
    await window.electronAPI.bot.sendChat(bot.id, input.trim());
    setInput("");
  }

  async function handleSendAI() {
    if (!aiInput.trim() || !bot) return;
    await window.electronAPI.bot.sendAIOnly(bot.id, aiInput.trim());
    setAiInput("");
  }

  async function handleTriggerLobby() {
    if (!bot) return;
    setLobbyLoading(true);
    try { await window.electronAPI.bot.triggerLobby(bot.id); } catch {}
    setLobbyLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent, sender: "mc" | "ai") {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sender === "mc" ? handleSendMinecraft() : handleSendAI();
    }
  }

  return (
    <div
      className="panel"
      style={{
        width: 320, flexShrink: 0,
        display: "flex", flexDirection: "column",
        overflow: "hidden", minHeight: 0,
      }}
    >
      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
        {(["minecraft", "ai"] as ChatTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, fontSize: 11, padding: "5px 0", fontFamily: "monospace",
              background: "none", cursor: "pointer",
              color: activeTab === tab ? (tab === "minecraft" ? "#7ecc49" : "#c084fc") : "#555",
              borderBottom: activeTab === tab
                ? `2px solid ${tab === "minecraft" ? "#7ecc49" : "#c084fc"}`
                : "2px solid transparent",
            }}
          >
            {tab === "minecraft" ? "⛏ Minecraft" : "🤖 ИИ-чат"}
          </button>
        ))}
      </div>

      {/* ── Minecraft tab ─────────────────────────────────────── */}
      {activeTab === "minecraft" && (
        <>
          {/* Header */}
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "4px 10px", borderBottom: "1px solid #2a2a2a", flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, color: "#555", fontFamily: "monospace" }}>
              {bot?.status === "online" ? "В сети" : "Оффлайн"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, cursor: "pointer", color: autoResponse ? "#7ecc49" : "#555" }}>
                <input type="checkbox" checked={autoResponse} onChange={e => handleAutoResponseToggle(e.target.checked)} style={{ accentColor: "#7ecc49" }} />
                Автоответ
              </label>
              <button
                className="btn" onClick={handleTriggerLobby}
                disabled={!bot || bot.status !== "online" || lobbyLoading}
                style={{ fontSize: 9, padding: "2px 6px" }}
              >
                {lobbyLoading ? "⏳" : "🏠 Анка"}
              </button>
            </div>
          </div>

          {/* ── Game chat section (flex:2) ── */}
          <div style={{ flex: 2, display: "flex", flexDirection: "column", minHeight: 0, borderBottom: "1px solid #1e1e1e" }}>
            <div style={{ padding: "2px 8px", fontSize: 9, color: "#3a5a3a", flexShrink: 0, letterSpacing: 1 }}>
              💬 ЧАТ
            </div>
            <ScrollArea
              msgs={chatMsgs}
              scroll={chatScroll}
              fontSize={11}
              emptyText={bot ? "Сообщений нет" : "Выберите бота"}
            />
          </div>

          {/* ── Bot log section (flex:1) ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, borderBottom: "1px solid #1e1e1e" }}>
            <div style={{ padding: "2px 8px", fontSize: 9, color: "#5a4a1e", flexShrink: 0, letterSpacing: 1 }}>
              📋 ЛОГ БОТА
            </div>
            <ScrollArea
              msgs={logMsgs}
              scroll={logScroll}
              fontSize={10}
              emptyText="Лог пуст"
            />
          </div>

          {/* Input */}
          <div style={{ padding: "6px 8px", borderTop: "1px solid #2a2a2a", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                className="input" style={{ flex: 1, fontSize: 11 }}
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => handleKeyDown(e, "mc")}
                placeholder={bot?.status === "online" ? "Написать в чат..." : "Нет подключения"}
                disabled={!bot}
              />
              <button
                className="btn btn-primary" style={{ fontSize: 11, padding: "0 10px" }}
                onClick={handleSendMinecraft} disabled={!bot || !input.trim()}
              >
                ➤
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── AI-only tab ────────────────────────────────────────── */}
      {activeTab === "ai" && (
        <>
          <div style={{ padding: "4px 10px", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
            <p style={{ fontSize: 10, color: "#555" }}>Приватный разговор с ИИ — не пишет в игру</p>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <ScrollArea msgs={aiMsgs} scroll={aiScroll} fontSize={11} emptyText={bot ? "ИИ-чат пуст" : "Выберите бота"} />
          </div>

          <div style={{ padding: "6px 8px", borderTop: "1px solid #2a2a2a", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                className="input" style={{ flex: 1, fontSize: 11 }}
                value={aiInput} onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => handleKeyDown(e, "ai")}
                placeholder="Спросить у ИИ..."
                disabled={!bot}
              />
              <button
                className="btn" style={{ fontSize: 11, padding: "0 10px", borderColor: "#7c3aed", color: "#c084fc" }}
                onClick={handleSendAI} disabled={!bot || !aiInput.trim()}
              >
                ➤
              </button>
            </div>
            <p style={{ fontSize: 10, color: "#333", marginTop: 4 }}>🔒 Только между вами и ИИ</p>
          </div>
        </>
      )}
    </div>
  );
}
