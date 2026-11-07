"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Order = { id: string; code: number; customer_id: string; received_at: string; odometer: number | null; issue: string; status: string; note: string | null; vehicles: { plate: string; model: string | null } | null; customers: { name: string; phone: string | null } | null };
type Veh = { id: string; customer_id: string; plate: string; customers: { name: string } | null };
const STATUS = ["Chờ xử lý", "Đang sửa", "Hoàn thành", "Đã giao xe"];
const empty = { vehicle_id: "", odometer: "", issue: "", note: "", soc: "", soh: "", pin: "" };
type Ktv = { id: string; ten: string };
const color: Record<string, string> = { "Chờ xử lý": "bg-amber-100 text-amber-800", "Đang sửa": "bg-blue-100 text-blue-800", "Hoàn thành": "bg-green-100 text-green-800", "Đã giao xe": "bg-slate-100 text-slate-600" };

export default function OrdersPage() {
  const [list, setList] = useState<Order[]>([]);
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [form, setForm] = useState(empty);
  const [filter, setFilter] = useState("");
  const [ktvs, setKtvs] = useState<Ktv[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [dtcs, setDtcs] = useState<{ ma: string; ghi_chu: string }[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const o = await supabase.from("repair_orders").select("*, vehicles(plate, model), customers(name, phone)").order("created_at", { ascending: false });
    const v = await supabase.from("vehicles").select("id, customer_id, plate, customers(name)").order("plate");
    if (o.error) setError(o.error.message); else setList(o.data as unknown as Order[]);
    if (v.data) setVehs(v.data as unknown as Veh[]);
    const k = await supabase.from("ev_ky_thuat_vien").select("id, ten").eq("dang_lam", true).order("ten");
    if (k.data) setKtvs(k.data as Ktv[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const veh = vehs.find((v) => v.id === form.vehicle_id);
    if (!veh) return setError("Hãy chọn xe.");
    if (form.soc === "") return setError("Hãy nhập SOC lúc nhận xe (%).");
    if (Number(form.soc) > 100 || Number(form.soh || 0) > 100) return setError("SOC và SOH phải từ 0 đến 100.");
    const { data: created, error } = await supabase.from("repair_orders").insert({
      vehicle_id: veh.id, customer_id: veh.customer_id,
      odometer: form.odometer ? Number(form.odometer) : null,
      issue: form.issue, note: form.note || null,
      soc_nhan: Number(form.soc), soh_nhan: form.soh ? Number(form.soh) : null, pin_ghi_chu: form.pin.trim() || null,
    }).select("id").single();
    if (error) return setError(error.message);
    const oid = created.id as string;
    const rows = dtcs.filter((d) => d.ma.trim()).map((d) => ({ order_id: oid, ma: d.ma.trim().toUpperCase(), ghi_chu: d.ghi_chu.trim() || null }));
    const e1 = rows.length ? (await supabase.from("ev_ma_loi").insert(rows)).error : null;
    const e2 = chosen.length ? (await supabase.from("ev_phieu_ky_thuat_vien").insert(chosen.map((k) => ({ order_id: oid, ktv_id: k })))).error : null;
    if (e1 || e2) setError("Đã tạo phiếu nhưng chưa lưu được mã lỗi/kỹ thuật viên: " + (e1 || e2)!.message + ". Hãy mở phiếu để nhập lại.");
    setForm(empty); setChosen([]); setDtcs([]); load();
  }
  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("repair_orders").update({ status }).eq("id", id);
    if (error) setError(error.message); else load();
  }
  async function remove(o: Order) {
    if (!confirm(`Xóa phiếu PT${String(o.code).padStart(4, "0")}?`)) return;
    const { error } = await supabase.from("repair_orders").delete().eq("id", o.id);
    if (error) setError(error.message); else load();
  }

  const shown = list.filter((o) => !filter || o.status === filter);
  const input = "w-full border rounded-lg px-3 py-2";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Phiếu tiếp nhận sửa chữa</h1>
      <form onSubmit={save} className="bg-white rounded-xl shadow p-4 grid gap-3 sm:grid-cols-2">
        <select required className={`${input} sm:col-span-2`} value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
          <option value="">-- Chọn xe (biển số - chủ xe) * --</option>
          {vehs.map((v) => <option key={v.id} value={v.id}>{v.plate} - {v.customers?.name}</option>)}
        </select>
        <input placeholder="Số km đã đi" inputMode="numeric" className={input} value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value.replace(/\D/g, "") })} />
        <input placeholder="Ghi chú (tình trạng xe, đồ để lại...)" className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <input required placeholder="SOC lúc nhận xe (%) *" inputMode="numeric" className={input} value={form.soc} onChange={(e) => setForm({ ...form, soc: e.target.value.replace(/D/g, "").slice(0, 3) })} />
        <input placeholder="SOH pin (%) - không bắt buộc" inputMode="numeric" className={input} value={form.soh} onChange={(e) => setForm({ ...form, soh: e.target.value.replace(/D/g, "").slice(0, 3) })} />
        <input placeholder="Ghi chú tình trạng pin" className={`${input} sm:col-span-2`} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
        <div className="sm:col-span-2 space-y-2">
          <div className="text-sm font-medium">Mã lỗi DTC</div>
          {dtcs.map((d, n) => (
            <div key={n} className="grid gap-2 grid-cols-[6rem_1fr_auto]">
              <input placeholder="Mã" className={input} value={d.ma} onChange={(e) => setDtcs(dtcs.map((x, j) => j === n ? { ...x, ma: e.target.value } : x))} />
              <input placeholder="Ghi chú" className={input} value={d.ghi_chu} onChange={(e) => setDtcs(dtcs.map((x, j) => j === n ? { ...x, ghi_chu: e.target.value } : x))} />
              <button type="button" onClick={() => setDtcs(dtcs.filter((_, j) => j !== n))} className="text-red-600 px-2">Xóa</button>
            </div>
          ))}
          <button type="button" onClick={() => setDtcs([...dtcs, { ma: "", ghi_chu: "" }])} className="border rounded-lg px-3 py-2 text-sm">+ Thêm mã lỗi</button>
        </div>
        <div className="sm:col-span-2 space-y-2">
          <div className="text-sm font-medium">Kỹ thuật viên</div>
          {ktvs.length === 0 && <p className="text-sm text-slate-500">Chưa có kỹ thuật viên (Chủ thêm ở mục Cài đặt).</p>}
          <div className="flex flex-wrap gap-2">
            {ktvs.map((t) => (
              <button key={t.id} type="button" onClick={() => setChosen(chosen.includes(t.id) ? chosen.filter((x) => x !== t.id) : [...chosen, t.id])}
                className={`px-3 py-2 rounded-full border text-sm ${chosen.includes(t.id) ? "bg-green-600 text-white border-green-600" : "bg-white"}`}>{chosen.includes(t.id) ? "✓ " : ""}{t.ten}</button>
            ))}
          </div>
        </div>
        <p className="sm:col-span-2 text-xs text-slate-500">Nhân viên tiếp nhận được lấy theo tài khoản đăng nhập.</p>
        <textarea required placeholder="Khách báo hỏng gì? *" rows={2} className={`${input} sm:col-span-2`} value={form.issue} onChange={(e) => setForm({ ...form, issue: e.target.value })} />
        <div className="sm:col-span-2"><button className="bg-green-600 text-white rounded-lg px-4 py-2">Tạo phiếu tiếp nhận</button></div>
        {vehs.length === 0 && <p className="sm:col-span-2 text-sm text-amber-700">Cần thêm khách hàng và xe trước khi tạo phiếu.</p>}
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <select className={input} value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">Tất cả trạng thái</option>
        {STATUS.map((s) => <option key={s}>{s}</option>)}
      </select>
      <ul className="space-y-2">
        {shown.map((o) => (
          <li key={o.id} className="bg-white rounded-xl shadow p-3 space-y-2">
            <Link href={`/tiep-nhan/${o.id}`} className="block space-y-2">
              <div className="flex justify-between gap-2">
                <div className="font-medium">PT{String(o.code).padStart(4, "0")} · {o.vehicles?.plate}</div>
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${color[o.status]}`}>{o.status}</span>
              </div>
              <div className="text-sm">{o.issue}</div>
              <div className="text-sm text-slate-500">
                {o.customers?.name}{o.customers?.phone ? ` (${o.customers.phone})` : ""} · {new Date(o.received_at).toLocaleString("vi-VN")}
                {o.odometer != null ? ` · ${o.odometer} km` : ""}{o.note ? ` · ${o.note}` : ""}
              </div>
            </Link>
            <div className="flex gap-2 items-center">
              <select className="border rounded-lg px-2 py-1 text-sm" value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}>
                {STATUS.map((s) => <option key={s}>{s}</option>)}
              </select>
              <Link href={`/tiep-nhan/${o.id}`} className="text-blue-600 text-sm">Báo giá</Link>
              <button onClick={() => remove(o)} className="text-red-600 text-sm ml-auto">Xóa</button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="text-slate-500 text-sm">Chưa có phiếu.</li>}
      </ul>
    </div>
  );
}
