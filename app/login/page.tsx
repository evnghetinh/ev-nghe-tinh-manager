"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Bolt, Logo } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("Email hoặc mật khẩu không đúng.");
    else router.replace("/");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ background: "linear-gradient(145deg,#0a1b33 0%,#0f2f5c 55%,#0a7fe0 130%)" }}>
      <Bolt className="absolute -right-10 -top-10 w-96 h-96 text-sky-400/10" />
      <Bolt className="absolute -left-16 bottom-0 w-80 h-80 text-sky-400/10" />
      <form onSubmit={onSubmit} className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-7 space-y-4">
        <div className="flex flex-col items-center gap-2">
          <Logo size={64} />
          <h1 className="text-xl font-bold text-navy-900">EV Nghệ Tĩnh Auto</h1>
          <p className="text-sm text-slate-500">Đăng nhập để quản lý gara</p>
        </div>
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" type="email" required autoComplete="email" placeholder="ten@email.com" value={email}
            onChange={(e) => setEmail(e.target.value)} className="w-full border px-3" />
        </div>
        <div>
          <label htmlFor="pw" className="field-label">Mật khẩu</label>
          <input id="pw" type="password" required autoComplete="current-password" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)} className="w-full border px-3" />
        </div>
        {error && <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}
        <button disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}
