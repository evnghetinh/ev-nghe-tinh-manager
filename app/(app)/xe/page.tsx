"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { ChonHangDong, useGoiYXe } from "@/components/xe-chon";
import { namMauXe, tenXe } from "@/lib/format";
import { squash } from "@/lib/tim";

type Vehicle = { id: string; customer_id: string; plate: string; vin: string | null; vehicle_type: string; model: string | null; hang_xe: string | null; dong_xe: string | null; nam_san_xuat: number | null; mau_xe: string | null; customers: { name: string; phone: string | null } | null };
type Cust = { id: string; name: string; phone: string | null };
const TYPES = ["Xe máy điện", "Xe đạp điện", "Ô tô điện", "Xe ba bánh điện", "Khác"];
const empty = { customer_id: "", plate: "", vin: "", vehicle_type: TYPES[0], model: "", hang_xe: "", dong_xe: "", nam: "", mau_xe: "" };

export default function VehiclesPage() {
  const [list, setList] = useState<Vehicle[]>([]);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [goiY, loadGoiY] = useGoiYXe();
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const v = await supabase.from("vehicles").select("*, customers(name, phone)").order("created_at", { ascending: false });
    const c = await supabase.from("customers").select("id, name, phone").order("name");
    if (v.error) setError(v.error.message); else setList(v.data as unknown as Vehicle[]);
    if (c.data) setCusts(c.data);
    setLoaded(true);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const nam = form.nam ? Number(form.nam) : null;
    if (nam != null && (nam < 1950 || nam > 2100)) return setError("Năm sản xuất không hợp lệ.");
    const body = { customer_id: form.customer_id, vin: form.vin, vehicle_type: form.vehicle_type, model: form.model, plate: form.plate.trim().toUpperCase(), hang_xe: form.hang_xe.trim() || null, dong_xe: form.dong_xe.trim() || null, nam_san_xuat: nam, mau_xe: form.mau_xe.trim() || null };
    const res = editId
      ? await supabase.from("vehicles").update(body).eq("id", editId)
      : await supabase.from("vehicles").insert(body);
    if (res.error) return setError(res.error.code === "23505" ? "Biển số này đã có trong hệ thống." : res.error.message);
    if (body.hang_xe) { await supabase.rpc("xe_them_goi_y", { p_hang: body.hang_xe, p_dong: body.dong_xe ?? "" }); loadGoiY(); }
    setForm(empty); setEditId(null); load();
  }
  async function remove(v: Vehicle) {
    if (!confirm(`Xóa xe ${v.plate}? Phiếu tiếp nhận của xe này cũng bị xóa.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
    if (error) setError(error.message); else load();
  }

  const tokens = q.trim().split(/s+/).map(squash).filter(Boolean);
  const shown = list.filter((v) => { const h = squash(`${v.plate} ${v.vin ?? ""} ${v.customers?.name ?? ""} ${tenXe(v)} ${v.model ?? ""}`); return tokens.every((t) => h.includes(t)); });
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="car" />} title="Xe" />
      <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
        <select required className={input} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
          <option value="">-- Chọn chủ xe * --</option>
          {custs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` - ${c.phone}` : ""}</option>)}
        </select>
        <input required placeholder="Biển số *" className={input} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
        <input placeholder="Số khung" className={input} value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
        <select className={input} value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <ChonHangDong hang={form.hang_xe} dong={form.dong_xe} goiY={goiY} onChange={(h, d) => setForm((f) => ({ ...f, hang_xe: h, dong_xe: d }))} />
        <input placeholder="Năm sản xuất (không bắt buộc)" inputMode="numeric" className={input} value={form.nam} onChange={(e) => setForm({ ...form, nam: e.target.value.replace(/D/g, "").slice(0, 4) })} />
        <input placeholder="Màu xe (không bắt buộc)" className={input} value={form.mau_xe} onChange={(e) => setForm({ ...form, mau_xe: e.target.value })} />
        <input placeholder="Ghi chú mẫu xe khác (không bắt buộc)" className={`${input} sm:col-span-2`} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <div className="sm:col-span-2 flex gap-2">
          <button className="btn-primary">{editId ? "Lưu thay đổi" : "Thêm xe"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="btn-secondary">Hủy</button>}
        </div>
        {custs.length === 0 && <p className="sm:col-span-2 text-sm text-amber-700">Cần thêm khách hàng trước khi thêm xe.</p>}
      </form>
      <Toast text={error} onClose={() => setError("")} />
      <input placeholder="Tìm theo biển số, hãng, dòng xe (vf5), số khung, tên chủ xe..." className={input} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-2">
        {shown.map((v) => (
          <li key={v.id} className="card flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-navy-900">{v.plate} {tenXe(v) && <span>· {tenXe(v)}</span>} <span className="text-sm font-normal text-slate-500">· {v.vehicle_type}{namMauXe(v) ? ` · ${namMauXe(v)}` : ""}{v.model ? ` · ${v.model}` : ""}</span></div>
              <div className="text-sm text-slate-500">Chủ xe: {v.customers?.name}{v.customers?.phone ? ` (${v.customers.phone})` : ""}{v.vin ? ` · Số khung: ${v.vin}` : ""}</div>
            </div>
            <div className="flex gap-1 text-sm shrink-0 items-start">
              <button onClick={() => { setEditId(v.id); setForm({ customer_id: v.customer_id, plate: v.plate, vin: v.vin ?? "", vehicle_type: v.vehicle_type, model: v.model ?? "", hang_xe: v.hang_xe ?? "", dong_xe: v.dong_xe ?? "", nam: v.nam_san_xuat ? String(v.nam_san_xuat) : "", mau_xe: v.mau_xe ?? "" }); window.scrollTo(0, 0); }} className="bare text-green-700 px-3 min-h-11">Sửa</button>
              <button onClick={() => remove(v)} className="bare text-red-600 px-3 min-h-11">Xóa</button>
            </div>
          </li>
        ))}
        {!loaded && <li><LoadingBlock rows={3} /></li>}
        {loaded && shown.length === 0 && <li><EmptyState icon={<Icon name="car" />} text={q ? "Không có xe nào khớp từ khóa." : "Chưa có xe. Nhập form phía trên để thêm xe đầu tiên."} /></li>}
      </ul>
    </div>
  );
}
