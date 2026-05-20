import React, { useState } from "react";
import { useAppStore } from "../store/appStore";
import BotCreateModal from "./BotCreateModal";

export default function BotTabs() {
  const { bots, selectedBotId, setSelectedBot, activeTab, setActiveTab } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);

  const tabs = [
    { id: "bots",        label: "Боты",          color: "#00ff9d" },
    { id: "models",      label: "Модели ИИ",     color: "#9d60ff" },
    { id: "anarchy",     label: "⚓ Анархия",    color: "#ff2255" },
    { id: "coordinator", label: "Координатор",    color: "#00c8ff" },
    { id: "settings",    label: "Настройки",     color: "#ff8800" },
  ] as const;

  return (
    <div style={{
      display: "flex", alignItems: "center",
      borderBottom: "1px solid #1a2040",
      background: "#07090f", minHeight: 32, overflowX: "auto",
    }}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: "0 14px", height: 32, fontSize: 11, fontFamily: "monospace",
            color: active ? tab.color : "#3a4a6a",
            borderBottom: active ? `2px solid ${tab.color}` : "2px solid transparent",
            borderTop: "none", borderLeft: "none", borderRight: "none",
            background: "none", cursor: "pointer", whiteSpace: "nowrap",
            textShadow: active ? `0 0 8px ${tab.color}55` : "none",
            transition: "color .15s",
          }}>
            {tab.label}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      {activeTab === "bots" && (
        <>
          <div style={{ display: "flex", gap: 3, padding: "0 8px", overflowX: "auto", maxWidth: 500 }}>
            {bots.map((bot) => {
              const sel = selectedBotId === bot.id;
              const sc = bot.status === "online" ? "#00ff9d" : bot.status === "connecting" ? "#ffee22" : "#2a3a5a";
              return (
                <button key={bot.id} onClick={() => setSelectedBot(bot.id)} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "2px 10px", fontSize: 11, fontFamily: "monospace",
                  background: sel ? "rgba(0,255,157,.07)" : "transparent",
                  color: sel ? "#00ff9d" : "#4a6080",
                  border: `1px solid ${sel ? "rgba(0,255,157,.35)" : "transparent"}`,
                  borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
                  boxShadow: sel ? "0 0 8px rgba(0,255,157,.12)" : "none",
                  transition: "all .15s",
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%", background: sc,
                    display: "inline-block",
                    boxShadow: bot.status === "online" ? `0 0 5px ${sc}` : "none",
                  }} />
                  {bot.config.nick}
                  {bot.config.aiEnabled && (
                    <span style={{ color: "#9d60ff", fontSize: 9 }}>⚡</span>
                  )}
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowCreate(true)} style={{
            margin: "0 8px", padding: "2px 10px", fontSize: 11, fontFamily: "monospace",
            background: "rgba(0,200,255,.06)", border: "1px solid rgba(0,200,255,.25)",
            color: "#00c8ff", borderRadius: 4, cursor: "pointer",
          }}>
            + Добавить бота
          </button>
        </>
      )}

      {showCreate && <BotCreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
