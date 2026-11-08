"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useRole, roleLabel, type Role } from "@/lib/role";

type Tk = { tk_id: string; tk_email: string; tk_vai_tro: Role | null; tk_ten: string | null; tk_ten_tam: boolean };
type Ktv = { id: string; ten: string; dang_lam: boolean };
type Mau = { id: string; thu_tu: number; ten: string };

const input = "w-full border px-3 py-2";

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

  if (role !== "chu") return <EmptyState icon={<Icon name="alert" />} text="Chỉ Chủ xưởng được vào mục này." />;

  return (
    <div className="space-y-6">
      <PageTitle icon={<Icon name="cog" />} title="Cài đặt" />
      <Toast text={error} onClose={() => setError("")} />

      <section className="card space-y-3">
        <h2 className="font-bold text-navy-900">Tên hiển thị của tài khoản</h2>
        <p className="text-sm text-slate-500">Bắt buộc có tên cho mọi tài khoản (ví dụ KTV02). Tên này hiện ở &quot;Nhân viên tiếp nhận&quot;, &quot;Người kiểm tra&quot; và trong Nhật ký hoạt động. Tài khoản chưa được đặt tên đang dùng tạm phần trước dấu @ của email.</p>
        <ul className="space-y-2">
          {tks.map((t) => (
            <li key={t.tk_id} className="border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="text-sm text-slate-600">{t.tk_email} · {t.tk_vai_tro ? roleLabel[t.tk_vai_tro] : "chưa có vai trò"}</div>
              {t.tk_ten_tam && <div className="text-xs text-amber-700">Chưa đặt tên chính thức (đang dùng tạm). Hãy nhập tên rồi bấm ra ngoài ô để lưu.</div>}
              <input required placeholder="Tên hiển thị (bắt buộc)" className={input} defaultValue={t.tk_ten ?? ""} key={t.tk_id + (t.tk_ten ?? "")}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) { setError("Bắt buộc nhập tên hiển thị cho mọi tài khoản (ví dụ KTV02)."); e.target.value = t.tk_ten ?? ""; return; }
                  if (v !== (t.tk_ten ?? "") || t.tk_ten_tam) run(supabase.rpc("dat_ten_hien_thi", { p_user: t.tk_id, p_ten: v }));
                }} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold text-navy-900">Kỹ thuật viên</h2>
        <form className="grid gap-2 grid-cols-[1fr_auto]" onSubmit={async (e) => { e.preventDefault(); if (newKtv.trim() && await run(supabase.from("ev_ky_thuat_vien").insert({ ten: newKtv.trim() }))) setNewKtv(""); }}>
          <input placeholder="Tên kỹ thuật viên" className={input} value={newKtv} onChange={(e) => setNewKtv(e.target.value)} />
          <button className="btn-primary">Thêm</button>
        </form>
        <ul className="space-y-2">
          {ktvs.map((k) => (
            <li key={k.id} className="border border-slate-200 rounded-xl p-3 flex gap-2 items-center">
              <input className={`${input} ${k.dang_lam ? "" : "text-slate-400"}`} defaultValue={k.ten} key={k.id + k.ten}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== k.ten && run(supabase.from("ev_ky_thuat_vien").update({ ten: e.target.value.trim() }).eq("id", k.id))} />
              <button onClick={() => run(supabase.from("ev_ky_thuat_vien").update({ dang_lam: !k.dang_lam }).eq("id", k.id))} className="bare text-sm text-blue-600 shrink-0 px-2 min-h-11">{k.dang_lam ? "Cho nghỉ" : "Làm lại"}</button>
              <button onClick={() => confirm(`Xóa ${k.ten}?`) && run(supabase.from("ev_ky_thuat_vien").delete().eq("id", k.id))} className="bare text-sm text-red-600 shrink-0 px-2 min-h-11">Xóa</button>
            </li>
          ))}
          {ktvs.length === 0 && <li><EmptyState icon={<Icon name="users" />} text="Chưa có kỹ thuật viên. Nhập tên ở ô phía trên để thêm." /></li>}
        </ul>
        <p className="text-xs text-slate-500">Người đã được gán vào phiếu thì không xóa được; hãy bấm &quot;Cho nghỉ&quot; (vẫn hiện trên phiếu cũ).</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold text-navy-900">Danh sách kiểm tra sau sửa (mặc định)</h2>
        <p className="text-sm text-slate-500">Áp dụng cho phiếu mới; phiếu đã tạo giữ danh sách cũ. Số bên trái là thứ tự.</p>
        <form className="grid gap-2 grid-cols-[1fr_auto]" onSubmit={async (e) => { e.preventDefault(); if (newMau.trim() && await run(supabase.from("ev_kt_mau").insert({ ten: newMau.trim(), thu_tu: (maus.at(-1)?.thu_tu ?? 0) + 1 }))) setNewMau(""); }}>
          <input placeholder="Mục kiểm tra mới" className={input} value={newMau} onChange={(e) => setNewMau(e.target.value)} />
          <button className="btn-primary">Thêm</button>
        </form>
        <ul className="space-y-2">
          {maus.map((m) => (
            <li key={m.id} className="border border-slate-200 rounded-xl p-3 flex gap-2 items-center">
              <input inputMode="numeric" className="w-14 border px-2 py-2 text-center" defaultValue={m.thu_tu} key={m.id + m.thu_tu}
                onBlur={(e) => Number(e.target.value) !== m.thu_tu && run(supabase.from("ev_kt_mau").update({ thu_tu: Number(e.target.value) || 0 }).eq("id", m.id))} />
              <input className={input} defaultValue={m.ten} key={m.id + m.ten}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.ten && run(supabase.from("ev_kt_mau").update({ ten: e.target.value.trim() }).eq("id", m.id))} />
              <button onClick={() => confirm(`Xóa mục "${m.ten}"?`) && run(supabase.from("ev_kt_mau").delete().eq("id", m.id))} className="bare text-sm text-red-600 shrink-0 px-2 min-h-11">Xóa</button>
            </li>
          ))}
          {maus.length === 0 && <li><EmptyState icon={<Icon name="clipboard" />} text="Danh sách trống: phiếu mới sẽ không có mục kiểm tra." /></li>}
        </ul>
      </section>
    </div>
  );
}
