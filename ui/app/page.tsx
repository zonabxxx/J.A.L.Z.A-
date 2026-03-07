"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "@/components/sidebar";
import Chat from "@/components/chat";
import EmailPanel from "@/components/email-panel";
import CalendarPanel from "@/components/calendar-panel";
import IntegrationsPanel from "@/components/integrations-panel";
import TasksPanel from "@/components/tasks-panel";
import UsagePanel from "@/components/usage-panel";
import SettingsModal from "@/components/settings-modal";
import LoginScreen from "@/components/login-screen";
import { useChat } from "@/lib/hooks";
import { checkSession, logoutUser, type User } from "@/lib/auth";
import { getConversation } from "@/lib/chat-storage";
import { initLocationOnStartup } from "@/lib/location";
import { registerServiceWorker } from "@/lib/register-sw";
import { useHealth } from "@/lib/use-health";
import type { Agent } from "@/lib/types";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [activeTab, setActiveTab] = useState("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const {
    messages,
    isStreaming,
    sendMessage,
    sendVisionMessage,
    clearChat,
    currentRoute,
    conversationId,
    loadConversation,
    selectedModel,
    setSelectedModel,
    readEmailById,
    stopGeneration,
    confirmCalendarEvent,
    cancelCalendarEvent,
  } = useChat(activeAgent);

  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const health = useHealth();

  useEffect(() => {
    checkSession().then((u) => {
      setUser(u);
      setLoaded(true);
      if (u) {
        initLocationOnStartup();
        registerServiceWorker();
        fetch("/api/agents")
          .then((r) => r.json())
          .then((data) => {
            const mapped: Record<string, Agent> = {};
            for (const [key, val] of Object.entries(data)) {
              const v = val as Agent;
              mapped[key] = { ...v, key };
            }
            setAgents(mapped);
          })
          .catch(() => {});
      }
    });
  }, []);

  const handleLogin = useCallback((u: User) => {
    setUser(u);
    initLocationOnStartup();
    registerServiceWorker();
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const mapped: Record<string, Agent> = {};
        for (const [key, val] of Object.entries(data)) {
          const v = val as Agent;
          mapped[key] = { ...v, key };
        }
        setAgents(mapped);
      })
      .catch(() => {});
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setActiveAgent(null);
    setActiveTab("chat");
  }, []);

  const handleSelectAgent = useCallback(
    (agent: Agent | null) => {
      setActiveAgent(agent);
      clearChat();
      setActiveTab("chat");
      setSidebarOpen(false);
    },
    [clearChat]
  );

  const handleNewChat = useCallback(() => {
    clearChat();
    setActiveTab("chat");
    setSidebarOpen(false);
  }, [clearChat]);

  const handleLoadConversation = useCallback(
    async (id: string, agentKey: string | null) => {
      if (agentKey && agents[agentKey]) {
        setActiveAgent(agents[agentKey]);
      } else {
        const convo = await getConversation(id);
        if (convo?.agentKey && agents[convo.agentKey]) {
          setActiveAgent(agents[convo.agentKey]);
        } else {
          setActiveAgent(null);
        }
      }
      await loadConversation(id);
      setActiveTab("chat");
      setSidebarOpen(false);
    },
    [loadConversation, agents]
  );

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  }, []);

  if (!loaded) return null;

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-[100dvh] relative">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-200 ease-out md:relative md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          user={user}
          activeAgent={activeAgent}
          onSelectAgent={handleSelectAgent}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSidebarOpen(false);
          }}
          onNewChat={handleNewChat}
          onLoadConversation={handleLoadConversation}
          activeConversationId={conversationId}
          health={health}
        />
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        {activeTab === "chat" && (
          <Chat
            messages={messages}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onSendVision={sendVisionMessage}
            onClear={handleNewChat}
            activeAgent={activeAgent}
            currentRoute={currentRoute}
            onMenuToggle={() => setSidebarOpen((p) => !p)}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onReadEmail={readEmailById}
            onStop={stopGeneration}
            onConfirmCalendar={confirmCalendarEvent}
            onCancelCalendar={cancelCalendarEvent}
          />
        )}
        {activeTab === "email" && <EmailPanel onMenuToggle={() => setSidebarOpen((p) => !p)} onBack={() => setActiveTab("chat")} />}
        {activeTab === "calendar" && <CalendarPanel onMenuToggle={() => setSidebarOpen((p) => !p)} onBack={() => setActiveTab("chat")} />}
        {activeTab === "integrations" && <IntegrationsPanel health={health} onMenuToggle={() => setSidebarOpen((p) => !p)} onBack={() => setActiveTab("chat")} />}
        {activeTab === "usage" && <UsagePanel onMenuToggle={() => setSidebarOpen((p) => !p)} onBack={() => setActiveTab("chat")} />}
        {activeTab === "tasks" && <TasksPanel onMenuToggle={() => setSidebarOpen((p) => !p)} onBack={() => setActiveTab("chat")} />}
      </main>

      <SettingsModal
        user={user}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onLogout={handleLogout}
      />
    </div>
  );
}
