"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/lib/role";

type Ktv = { id: string; ten: string; dang_lam: boolean };
type Dtc = { id: string; ma: string; ghi_chu: string | null; sau_sua: "da_xoa" | "con" | null };
type Kt = { id: string; ten: string; thu_tu: number; ket_qua: "dat" | "khong_dat" | null; ghi_chu: string | null; nguoi_kt_ten: string | null; kt_luc: string | null };
type Info = { soc_nhan: number | null; soh_nhan: number | null; pin_ghi_chu: string | null; nguyen_nhan: string | null; tiep_nhan_ten: string | null; kt_bo_qua_ly_do: string | null };
type Nk = { id: string; noi_dung: string; created_by_name: string | null; created_at: string };

const input = "w-full border rounded-lg px-3 py-2";

export default function EvInfo({ orderId, done, onChanged }: { orderId: string; done: boolean; onChanged?: () => void }) {
  const role = useRole();
  const canEdit = !done || role === "chu";
  const [info, setInfo] = useState<Info | null>(null);
  const [form, setForm] = useState({ soc: "", soh: "", pin: "", nguyen_nhan: "" });
  const [all, setAll] = useState<Ktv[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [dtcs, setDtcs] = useState<Dtc[]>([]);
  const [newDtc, setNewDtc] = useState({ ma: "", ghi_chu: "" });
  const [kts, setKts] = useState<Kt[]>([]);
  const [logs, setLogs] = useState<Nk[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!done) await supabase.rpc("khoi_tao_kiem_tra", { p_order: orderId });
    const [o, k, pk, d, c] = await Promise.all([
      supabase.from("repair_orders").select("soc_nhan, soh_nhan, pin_ghi_chu, nguyen_nhan, tiep_nhan_ten, kt_bo_qua_ly_do").eq("id", orderId).single(),
      supabase.from("ev_ky_thuat_vien").select("id, ten, dang_lam").order("ten"),
      supabase.from("ev_phieu_ky_thuat_vien").select("ktv_id").eq("order_id", orderId),
      supabase.from("ev_ma_loi").select("id, ma, ghi_chu, sau_sua").eq("order_id", orderId).order("created_at"),
      supabase.from("ev_kt_phieu").select("id, ten, thu_tu, ket_qua, ghi_chu, nguoi_kt_ten, kt_luc").eq("order_id", orderId).order("thu_tu").order("ten"),
    ]);
    const err = o.error || k.error || pk.error || d.error || c.error;
    if (err) return setError(err.message + " (đã chạy giai-doan-12.sql chưa?)");
    const i = o.data as Info;
    setInfo(i);
    setForm({ soc: i.soc_nhan?.toString() ?? "", soh: i.soh_nhan?.toString() ?? "", pin: i.pin_ghi_chu ?? "", nguyen_nhan: i.nguyen_nhan ?? "" });
    setAll(k.data as Ktv[]);
    setChosen((pk.data as { ktv_id: string }[]).map((x) => x.ktv_id));
    setDtcs(d.data as Dtc[]);
    setKts(c.data as Kt[]);
    if (role === "chu") {
      const l = await supabase.from("ev_nhat_ky").select("id, noi_dung, created_by_name, created_at").eq("order_id", orderId).order("created_at", { ascending: false });
      if (l.data) setLogs(l.data as Nk[]);
    }
  }, [orderId, done, role]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    setError(""); setMsg("");
    const { error } = await p;
    if (error) { setError(error.message); return false; }
    if (ok) setMsg(ok);
    await load(); onChanged?.();
    return true;
  }
  const pct = (v: string) => (v === "" ? null : Math.min(100, Number(v)));

  function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    if (done && !confirm("Phiếu đã hoàn thành. Lưu thay đổi? Thay đổi sẽ được ghi nhật ký.")) return;
    run(supabase.from("repair_orders").update({ soc_nhan: pct(form.soc), soh_nhan: pct(form.soh), pin_ghi_chu: form.pin.trim() || null, nguyen_nhan: form.nguyen_nhan.trim() || null }).eq("id", orderId), "Đã lưu.");
  }
  function toggleKtv(id: string) {
    if (chosen.includes(id)) run(supabase.from("ev_phieu_ky_thuat_vien").delete().eq("order_id", orderId).eq("ktv_id", id));
    else run(supabase.from("ev_phieu_ky_thuat_vien").insert({ order_id: orderId, ktv_id: id }));
  }
  async function addDtc(e: React.FormEvent) {
    e.preventDefault();
    const ma = newDtc.ma.trim().toUpperCase();
    if (!ma) return;
    if (await run(supabase.from("ev_ma_loi").insert({ order_id: orderId, ma, ghi_chu: newDtc.ghi_chu.trim() || null }))) setNewDtc({ ma: "", ghi_chu: "" });
  }
  function setKt(k: Kt, patch: Partial<Pick<Kt, "ket_qua" | "ghi_chu">>) {
    run(supabase.from("ev_kt_phieu").update(patch).eq("id", k.id));
  }
  async function skip() {
    if (!reason.trim()) return setError("Hãy nhập lý do bỏ qua kiểm tra.");
    const r = await supabase.rpc("bo_qua_kiem_tra", { p_order: orderId, p_ly_do: reason.trim() });
    if (r.error) return setError(r.error.message);
    setReason(""); setMsg("Đã ghi lý do bỏ qua. Bây giờ có thể chuyển sang Hoàn thành."); load();
  }

  const visibleKtv = all.filter((t) => t.dang_lam || chosen.includes(t.id));
  const chua = kts.filter((k) => !k.ket_qua).length;
  const dis = !canEdit;

  return (
    <section className="bg-white rounded-xl shadow p-4 space-y-4">
      <h2 className="font-bold">⚡ Thông tin xe điện</h2>
      {!canEdit && <p className="text-sm text-slate-500">Phiếu đã hoàn thành: chỉ Chủ xưởng được sửa.</p>}
      {done && role === "chu" && <p className="text-sm text-amber-800">Mọi thay đổi ở mục này đều được ghi nhật ký.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-800">{msg}</p>}

      <p className="text-sm text-slate-600">Nhân viên tiếp nhận: <b>{info?.tiep_nhan_ten ?? "—"}</b></p>

      <form onSubmit={saveInfo} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">SOC lúc nhận xe (%)
          <input disabled={dis} inputMode="numeric" placeholder="0–100" className={input} value={form.soc} onChange={(e) => setForm({ ...form, soc: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
        </label>
        <label className="text-sm">SOH pin (%) – không bắt buộc
          <input disabled={dis} inputMode="numeric" placeholder="0–100" className={input} value={form.soh} onChange={(e) => setForm({ ...form, soh: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
        </label>
        <label className="text-sm sm:col-span-2">Ghi chú tình trạng pin
          <input disabled={dis} className={input} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
        </label>
        <label className="text-sm sm:col-span-2">Nguyên nhân hư hỏng (chẩn đoán)
          <textarea disabled={dis} rows={2} className={input} value={form.nguyen_nhan} onChange={(e) => setForm({ ...form, nguyen_nhan: e.target.value })} />
        </label>
        {canEdit && <div className="sm:col-span-2"><button className="bg-green-600 text-white rounded-lg px-4 py-2">Lưu thông tin</button></div>}
      </form>

      <div className="space-y-2">
        <h3 className="font-medium">Kỹ thuật viên</h3>
        {visibleKtv.length === 0 && <p className="text-sm text-slate-500">Chưa có kỹ thuật viên. Chủ xưởng thêm ở mục Cài đặt.</p>}
        <div className="flex flex-wrap gap-2">
          {visibleKtv.map((t) => (
            <button key={t.id} type="button" disabled={dis} onClick={() => toggleKtv(t.id)}
              className={`px-3 py-2 rounded-full border text-sm ${chosen.includes(t.id) ? "bg-green-600 text-white border-green-600" : "bg-white"}`}>
              {chosen.includes(t.id) ? "✓ " : ""}{t.ten}{t.dang_lam ? "" : " (đã nghỉ)"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Mã lỗi DTC</h3>
        <ul className="space-y-2">
          {dtcs.map((d) => (
            <li key={d.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex justify-between gap-2 items-center">
                <b>{d.ma}</b>
                {canEdit && <button onClick={() => confirm(`Xóa mã lỗi ${d.ma}?`) && run(supabase.from("ev_ma_loi").delete().eq("id", d.id))} className="text-red-600 text-sm">Xóa</button>}
              </div>
              <input disabled={dis} placeholder="Ghi chú" className={input} defaultValue={d.ghi_chu ?? ""} key={d.id + (d.ghi_chu ?? "")}
                onBlur={(e) => e.target.value.trim() !== (d.ghi_chu ?? "") && run(supabase.from("ev_ma_loi").update({ ghi_chu: e.target.value.trim() || null }).eq("id", d.id))} />
              <select disabled={dis} className={input} value={d.sau_sua ?? ""} onChange={(e) => run(supabase.from("ev_ma_loi").update({ sau_sua: e.target.value || null }).eq("id", d.id))}>
                <option value="">Tình trạng sau sửa: chưa ghi</option>
                <option value="da_xoa">Sau sửa: đã xóa mã</option>
                <option value="con">Sau sửa: mã vẫn còn</option>
              </select>
            </li>
          ))}
          {dtcs.length === 0 && <li className="text-sm text-slate-500">Chưa có mã lỗi.</li>}
        </ul>
        {canEdit && (
          <form onSubmit={addDtc} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
            <input placeholder="Mã (P0A80)" className={input} value={newDtc.ma} onChange={(e) => setNewDtc({ ...newDtc, ma: e.target.value })} />
            <input placeholder="Ghi chú" className={input} value={newDtc.ghi_chu} onChange={(e) => setNewDtc({ ...newDtc, ghi_chu: e.target.value })} />
            <button className="bg-green-600 text-white rounded-lg px-4 py-2">Thêm mã</button>
          </form>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Kiểm tra sau sửa {chua > 0 && <span className="text-sm text-amber-700">(còn {chua} mục chưa làm)</span>}</h3>
        <ul className="space-y-2">
          {kts.map((k) => (
            <li key={k.id} className="border rounded-lg p-3 space-y-2">
              <div className="font-medium">{k.ten}</div>
              <div className="grid grid-cols-2 gap-2">
                <button disabled={dis} onClick={() => setKt(k, { ket_qua: k.ket_qua === "dat" ? null : "dat" })}
                  className={`rounded-lg px-3 py-2 border ${k.ket_qua === "dat" ? "bg-green-600 text-white border-green-600" : "bg-white"}`}>Đạt</button>
                <button disabled={dis} onClick={() => setKt(k, { ket_qua: k.ket_qua === "khong_dat" ? null : "khong_dat" })}
                  className={`rounded-lg px-3 py-2 border ${k.ket_qua === "khong_dat" ? "bg-red-600 text-white border-red-600" : "bg-white"}`}>Không đạt</button>
              </div>
              <input disabled={dis} placeholder="Ghi chú" className={input} defaultValue={k.ghi_chu ?? ""} key={k.id + (k.ghi_chu ?? "")}
                onBlur={(e) => e.target.value.trim() !== (k.ghi_chu ?? "") && setKt(k, { ghi_chu: e.target.value.trim() || null })} />
              {k.kt_luc && <div className="text-xs text-slate-500">Kiểm tra bởi {k.nguoi_kt_ten ?? "—"} lúc {new Date(k.kt_luc).toLocaleString("vi-VN")}</div>}
            </li>
          ))}
          {kts.length === 0 && <li className="text-sm text-slate-500">Chưa có mục kiểm tra (danh sách mặc định đang trống).</li>}
        </ul>
        {info?.kt_bo_qua_ly_do && <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">Chủ xưởng đã bỏ qua kiểm tra. Lý do: {info.kt_bo_qua_ly_do}</p>}
        {!done && role === "chu" && chua > 0 && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input placeholder="Lý do bỏ qua kiểm tra (chỉ Chủ)" className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button onClick={skip} className="border border-amber-600 text-amber-800 rounded-lg px-4 py-2">Bỏ qua kiểm tra</button>
          </div>
        )}
      </div>

      {done && role === "chu" && (
        <div className="space-y-2">
          <h3 className="font-medium">Nhật ký sửa thông tin xe điện</h3>
          {logs.length === 0 ? <p className="text-sm text-slate-500">Chưa có thay đổi nào sau khi hoàn thành.</p> : (
            <ul className="space-y-2">
              {logs.map((l) => (
                <li key={l.id} className="border rounded-lg p-3 text-sm">
                  <div className="text-slate-500">{new Date(l.created_at).toLocaleString("vi-VN")} · {l.created_by_name ?? "Không rõ"}</div>
                  <div>{l.noi_dung}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
