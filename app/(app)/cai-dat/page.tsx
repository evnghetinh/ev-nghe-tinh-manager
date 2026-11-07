"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRole, roleLabel, type Role } from "@/lib/role";

type Tk = { tk_id: string; tk_email: string; tk_vai_tro: Role | null; tk_ten: string | null };
type Ktv = { id: string; ten: string; dang_lam: boolean };
type Mau = { id: string; thu_tu: number; ten: string };

const input = "w-full border rounded-lg px-3 py-2";

export default function SettingsPage() {
  const role = useRole();
  const [tks, setTks] = useState<Tk[]>([]);
  const [ktvs, setKtvs] = useState<Ktv[]>([]);
  const [maus, setMaus] = useState<Mau[]>([]);
  const [newKtv, setNewKtv] = useState("");
  const [newMau, setNewMau] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.rpc("ds_tai_khoan"),
      supabase.from("ev_ky_thuat_vien").select("id, ten, dang_lam").order("ten"),
      supabase.from("ev_kt_mau").select("id, thu_tu, ten").order("thu_tu").order("ten"),
    ]);
    const err = a.error || b.error || c.error;
    if (err) return setError(err.message + " (đã chạy giai-doan-12.sql chưa?)");
    setTks(a.data as Tk[]); setKtvs(b.data as Ktv[]); setMaus(c.data as Mau[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (role === "chu") load(); }, [load, role]);

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    setError("");
    const { error } = await p;
    if (error) setError(error.message); else load();
    return !error;
  }

  if (role !== "chu") return <p className="text-slate-500">Chỉ Chủ xưởng được vào mục này.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Cài đặt</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="font-bold">Tên hiển thị của tài khoản</h2>
        <p className="text-sm text-slate-500">Tên này hiện ở &quot;Nhân viên tiếp nhận&quot; và &quot;Người kiểm tra&quot;. Để trống thì dùng email.</p>
        <ul className="space-y-2">
          {tks.map((t) => (
            <li key={t.tk_id} className="border rounded-lg p-3 space-y-2">
              <div className="text-sm text-slate-600">{t.tk_email} · {t.tk_vai_tro ? roleLabel[t.tk_vai_tro] : "chưa có vai trò"}</div>
              <input placeholder="Tên hiển thị" className={input} defaultValue={t.tk_ten ?? ""} key={t.tk_id + (t.tk_ten ?? "")}
                onBlur={(e) => e.target.value.trim() !== (t.tk_ten ?? "") && run(supabase.rpc("dat_ten_hien_thi", { p_user: t.tk_id, p_ten: e.target.value }))} />
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="font-bold">Kỹ thuật viên</h2>
        <form className="grid gap-2 grid-cols-[1fr_auto]" onSubmit={async (e) => { e.preventDefault(); if (newKtv.trim() && await run(supabase.from("ev_ky_thuat_vien").insert({ ten: newKtv.trim() }))) setNewKtv(""); }}>
          <input placeholder="Tên kỹ thuật viên" className={input} value={newKtv} onChange={(e) => setNewKtv(e.target.value)} />
          <button className="bg-green-600 text-white rounded-lg px-4 py-2">Thêm</button>
        </form>
        <ul className="space-y-2">
          {ktvs.map((k) => (
            <li key={k.id} className="border rounded-lg p-3 flex gap-2 items-center">
              <input className={`${input} ${k.dang_lam ? "" : "text-slate-400"}`} defaultValue={k.ten} key={k.id + k.ten}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== k.ten && run(supabase.from("ev_ky_thuat_vien").update({ ten: e.target.value.trim() }).eq("id", k.id))} />
              <button onClick={() => run(supabase.from("ev_ky_thuat_vien").update({ dang_lam: !k.dang_lam }).eq("id", k.id))} className="text-sm text-blue-600 shrink-0">{k.dang_lam ? "Cho nghỉ" : "Làm lại"}</button>
              <button onClick={() => confirm(`Xóa ${k.ten}?`) && run(supabase.from("ev_ky_thuat_vien").delete().eq("id", k.id))} className="text-sm text-red-600 shrink-0">Xóa</button>
            </li>
          ))}
          {ktvs.length === 0 && <li className="text-sm text-slate-500">Chưa có kỹ thuật viên.</li>}
        </ul>
        <p className="text-xs text-slate-500">Người đã được gán vào phiếu thì không xóa được; hãy bấm &quot;Cho nghỉ&quot; (vẫn hiện trên phiếu cũ).</p>
      </section>

      <section className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="font-bold">Danh sách kiểm tra sau sửa (mặc định)</h2>
        <p className="text-sm text-slate-500">Áp dụng cho phiếu mới; phiếu đã tạo giữ danh sách cũ. Số bên trái là thứ tự.</p>
        <form className="grid gap-2 grid-cols-[1fr_auto]" onSubmit={async (e) => { e.preventDefault(); if (newMau.trim() && await run(supabase.from("ev_kt_mau").insert({ ten: newMau.trim(), thu_tu: (maus.at(-1)?.thu_tu ?? 0) + 1 }))) setNewMau(""); }}>
          <input placeholder="Mục kiểm tra mới" className={input} value={newMau} onChange={(e) => setNewMau(e.target.value)} />
          <button className="bg-green-600 text-white rounded-lg px-4 py-2">Thêm</button>
        </form>
        <ul className="space-y-2">
          {maus.map((m) => (
            <li key={m.id} className="border rounded-lg p-3 flex gap-2 items-center">
              <input inputMode="numeric" className="w-14 border rounded-lg px-2 py-2 text-center" defaultValue={m.thu_tu} key={m.id + m.thu_tu}
                onBlur={(e) => Number(e.target.value) !== m.thu_tu && run(supabase.from("ev_kt_mau").update({ thu_tu: Number(e.target.value) || 0 }).eq("id", m.id))} />
              <input className={input} defaultValue={m.ten} key={m.id + m.ten}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.ten && run(supabase.from("ev_kt_mau").update({ ten: e.target.value.trim() }).eq("id", m.id))} />
              <button onClick={() => confirm(`Xóa mục "${m.ten}"?`) && run(supabase.from("ev_kt_mau").delete().eq("id", m.id))} className="text-sm text-red-600 shrink-0">Xóa</button>
            </li>
          ))}
          {maus.length === 0 && <li className="text-sm text-slate-500">Danh sách trống: phiếu mới sẽ không có mục kiểm tra.</li>}
        </ul>
      </section>
    </div>
  );
}
