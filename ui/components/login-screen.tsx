"use client";
import { useState, useEffect } from "react";
import { loginUser, registerUser, hasUsers, type User } from "@/lib/auth";

interface Props {
  onLogin: (user: User) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [isRegistration, setIsRegistration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    hasUsers().then((exists) => {
      setIsRegistration(!exists);
      setChecking(false);
    });
  }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || password.length < 6) {
      setError("Meno a heslo (min. 6 znakov) sú povinné.");
      return;
    }
    setLoading(true);
    setError("");

    if (isRegistration) {
      const result = await registerUser(trimmed, password, setupKey);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      if (result.user) onLogin(result.user);
    } else {
      const result = await loginUser(trimmed, password);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      if (result.user) onLogin(result.user);
    }
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-500 text-sm">Overujem zabezpečenie...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">J.A.L.Z.A.</h1>
          <p className="text-sm text-zinc-500 mt-2">
            {isRegistration
              ? "Prvé spustenie — vytvor si účet"
              : "Zabezpečený prístup — prihlás sa"}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className="space-y-3"
          autoComplete="on"
        >
          <input
            name="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Meno"
            autoFocus
            autoComplete="username"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
          <input
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Heslo (min. 6 znakov)"
            autoComplete={isRegistration ? "new-password" : "current-password"}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />

          {isRegistration && (
            <input
              value={setupKey}
              onChange={(e) => setSetupKey(e.target.value)}
              type="password"
              placeholder="Registračný kľúč"
              autoComplete="off"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
            />
          )}

          <button
            type="submit"
            disabled={loading || !name.trim() || password.length < 6}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <svg
                className="animate-spin w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : null}
            {isRegistration ? "Vytvoriť účet" : "Prihlásiť sa"}
          </button>
        </form>

        {!isRegistration && (
          <button
            onClick={() => setIsRegistration(true)}
            className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Prvýkrát tu? Zaregistruj sa
          </button>
        )}
        {isRegistration && (
          <button
            onClick={() => setIsRegistration(false)}
            className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Už mám účet? Prihlásiť sa
          </button>
        )}

        <div className="flex items-center gap-2 justify-center text-[10px] text-zinc-700 pt-4">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          PBKDF2-SHA256 600k iter. | JWT HS256 | AES-256 encrypted DB | httpOnly cookies
        </div>
      </div>
    </div>
  );
}
