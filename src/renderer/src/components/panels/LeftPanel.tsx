import React, { useState } from "react";
import { useAppStore } from "../../store/appStore";
import AnkaRecorder from "../AnkaRecorder";
import ModelsTab from "../tabs/ModelsTab";
import SettingsTab from "../tabs/SettingsTab";
import CoordinatorTab from "../tabs/CoordinatorTab";
import AnarchyTab from "../tabs/AnarchyTab";
import BotEditModal from "../BotEditModal";

export default function LeftPanel() {
  const { activeTab, bots, selectedBotId } = useAppStore();
  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;
  const [nickInput, setNickInput] = useState("");
  const [showNick, setShowNick]   = useState(false);
  const [editOpen, setEditOpen]   = useState(false);

  async function handleDelete() {
    if (!selectedBot || !confirm(`Удалить бота ${selectedBot.config.nick}?`)) return;
    await window.electronAPI.bot.delete(selectedBot.id);
  }

  async function handleNickChange() {
    if (!nickInput.trim() || !selectedBot) return;
    await window.electronAPI.bot.setNick(selectedBot.id, nickInput.trim());
    setNickInput(""); setShowNick(false);
  }

  const content = () => {
    switch (activeTab) {
      case "models":      return <ModelsTab />;
      case "settings":    return <SettingsTab />;
      case "coordinator": return <CoordinatorTab />;
      case "anarchy":     return <AnarchyTab />;
      default:
        return (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            <div style={{ padding: "6px 10px", borderBottom: "1px solid #1a2040", fontSize: 11, color: "#2a3a5a", fontFamily: "monospace" }}>
              Управление ботом
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
              {selectedBot ? (
                <>
                  {/* Nick / Delete controls */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {showNick ? (
                      <>
                        <input
                          autoFocus
                          className="input"
                          style={{ flex: 1, fontSize: 11, padding: "3px 6px" }}
                          value={nickInput}
                          onChange={e => setNickInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleNickChange()}
                          placeholder="Новый ник…"
                        />
                        <button className="btn btn-primary" style={{ fontSize: 10, padding: "3px 8px" }} onClick={handleNickChange}>✓</button>
                        <button className="btn" style={{ fontSize: 10, padding: "3px 8px" }} onClick={() => setShowNick(false)}>✕</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" style={{ flex: 1, fontSize: 10, padding: "3px 6px" }} onClick={() => setShowNick(true)}>✏️ Ник</button>
                        <button className="btn" style={{ fontSize: 10, padding: "3px 6px" }} onClick={() => setEditOpen(true)}>⚙️</button>
                        <button className="btn btn-danger" style={{ fontSize: 10, padding: "3px 6px" }} onClick={handleDelete}>🗑️</button>
                      </>
                    )}
                  </div>

                  {/* AnkaRecorder */}
                  <div className="panel" style={{ overflow: "hidden" }}>
                    <AnkaRecorder bot={selectedBot} />
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "center", color: "#1e2a3a", marginTop: 32, fontSize: 11 }}>
                  Создайте или выберите бота
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <div
        className="panel flex-shrink-0"
        style={{ width: 280, overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        {content()}
      </div>
      {editOpen && selectedBot && (
        <BotEditModal bot={selectedBot} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}
