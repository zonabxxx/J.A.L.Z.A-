"use client";
import { useState } from "react";
import { loginUser, getKnownUsers, type User } from "@/lib/auth";

interface Props {
  onLogin: (user: User) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [name, setName] = useState("");
  const knownUsers = getKnownUsers();

  const handleLogin = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const user = loginUser(trimmed);
    onLogin(user);
  };

  const handleQuickLogin = (user: User) => {
    const loggedIn = loginUser(user.name);
    onLogin(loggedIn);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm space-y-8 px-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h1 className="text-3xl font-bold tracking-tight">J.A.L.Z.A.</h1>
          <p className="text-sm text-zinc-500 mt-2">
            Lokálny AI asistent — prihlás sa
          </p>
        </div>

        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Tvoje meno (napr. Juraj)"
            autoFocus
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
          <button
            onClick={handleLogin}
            disabled={!name.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-medium transition-colors"
          >
            Prihlásiť sa
          </button>
        </div>

        {knownUsers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-xs text-zinc-600">alebo pokračuj ako</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>

            <div className="space-y-2">
              {knownUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleQuickLogin(user)}
                  className="w-full flex items-center gap-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl px-4 py-3 text-sm transition-colors"
                >
                  <div
                    className={`w-8 h-8 rounded-full ${user.color} flex items-center justify-center text-xs font-bold text-white`}
                  >
                    {user.avatar}
                  </div>
                  <span>{user.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
