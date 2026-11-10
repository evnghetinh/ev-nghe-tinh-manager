"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { ChonHangDong, useGoiYXe } from "@/components/xe-chon";
import { money, namMauXe, tenXe } from "@/lib/format";

type Vehicle = { id: string; customer_id: string; plate: string; vin: string | null; vehicle_type: string; model: string | null; hang_xe: string | null; dong_xe: string | null; nam_san_xuat: number | null; mau_xe: string | null; customers: { name: string; phone: string | null } | null; no: number };
type Flat = Omit<Vehicle, "customers" | "no"> & { ten_khach: string; sdt_khach: string | null; no_khach: number };
type Cust = { id: string; name: string; phone: string | null };
const TYPES = ["Xe máy điện", "Xe đạp điện", "Ô tô điện", "Xe ba bánh điện", "Khác"];
const TRANG = 20;
const SAP_XEP = [{ v: "moi", t: "Mới nhất" }, { v: "ten", t: "Tên chủ xe A-Z" }, { v: "no", t: "Nợ nhiều nhất" }];
const empty = { customer_id: "", plate: "", vin: "", vehicle_type: TYPES[0], model: "", hang_xe: "", dong_xe: "", nam: "", mau_xe: "" };

export default function VehiclesPage() {
  const [list, setList] = useState<Vehicle[]>([]);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sort, setSort] = useState("moi");
  const [hasMore, setHasMore] = useState(false);
  const [dangTai, setDangTai] = useState(false);
  const [lam, setLam] = useState(0);
  const lan = useRef(0);
  const [goiY, loadGoiY] = useGoiYXe();
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Chờ 250ms sau khi ngừng gõ rồi mới tìm
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const tai = useCallback(async (batDau: number) => {
    const my = ++lan.current;
    setDangTai(true);
    const v = await supabase.rpc("xe_danh_sach", { p_q: dq, p_sap_xep: sort, p_so: TRANG + 1, p_bat_dau: batDau });
    if (my !== lan.current) return;
    setDangTai(false);
    setLoaded(true);
    if (v.error) return setError(v.error.message + " (đã chạy giai-doan-27.sql chưa?)");
    const rows = ((v.data ?? []) as Flat[]).map((x) => ({ ...x, customers: { name: x.ten_khach, phone: x.sdt_khach }, no: Number(x.no_khach) })) as Vehicle[];
    setHasMore(rows.length > TRANG);
    setList((cu) => (batDau === 0 ? rows.slice(0, TRANG) : [...cu, ...rows.slice(0, TRANG)]));
  }, [dq, sort]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { tai(0); }, [tai, lam]);
  useEffect(() => {
    supabase.from("customers").select("id, name, phone").order("name").then(({ data }) => { if (data) setCusts(data); });
  }, [lam]);

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
    setForm(empty); setEditId(null); setLam((n) => n + 1);
  }
  async function remove(v: Vehicle) {
    if (!confirm(`Xóa xe ${v.plate}? Phiếu tiếp nhận của xe này cũng bị xóa.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
    if (error) setError(error.message); else setLam((n) => n + 1);
  }

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
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <input type="search" placeholder="Tìm theo biển số, hãng, dòng xe (vf5), số khung, tên chủ xe..." aria-label="Tìm xe" className={input} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Sắp xếp" className={input} value={sort} onChange={(e) => setSort(e.target.value)}>
          {SAP_XEP.map((o) => <option key={o.v} value={o.v}>Sắp xếp: {o.t}</option>)}
        </select>
      </div>
      <ul className="space-y-2">
        {list.map((v) => (
          <li key={v.id} className="card flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-navy-900">{v.plate} {tenXe(v) && <span>· {tenXe(v)}</span>} <span className="text-sm font-normal text-slate-500">· {v.vehicle_type}{namMauXe(v) ? ` · ${namMauXe(v)}` : ""}{v.model ? ` · ${v.model}` : ""}</span></div>
              <div className="text-sm text-slate-500 break-words">Chủ xe: <Link href={`/khach-hang/${v.customer_id}`} className="text-brand-700 underline py-2 -my-2 inline-block">{v.customers?.name}</Link>{v.customers?.phone ? ` (${v.customers.phone})` : ""}{v.vin ? ` · Số khung: ${v.vin}` : ""}{v.no > 0 && <span className="font-semibold text-red-700"> · Nợ {money(v.no)}</span>}</div>
            </div>
            <div className="flex gap-1 text-sm shrink-0 items-start">
              <button onClick={() => { setEditId(v.id); setForm({ customer_id: v.customer_id, plate: v.plate, vin: v.vin ?? "", vehicle_type: v.vehicle_type, model: v.model ?? "", hang_xe: v.hang_xe ?? "", dong_xe: v.dong_xe ?? "", nam: v.nam_san_xuat ? String(v.nam_san_xuat) : "", mau_xe: v.mau_xe ?? "" }); window.scrollTo(0, 0); }} className="bare text-green-700 px-3 min-h-11">Sửa</button>
              <button onClick={() => remove(v)} className="bare text-red-600 px-3 min-h-11">Xóa</button>
            </div>
          </li>
        ))}
        {!loaded && <li><LoadingBlock rows={3} /></li>}
        {loaded && list.length === 0 && <li><EmptyState icon={<Icon name="car" />} text={dq ? "Không có xe nào khớp từ khóa." : "Chưa có xe. Nhập form phía trên để thêm xe đầu tiên."} /></li>}
      </ul>
      {hasMore && <button type="button" disabled={dangTai} onClick={() => tai(list.length)} className="btn-secondary w-full">{dangTai ? "Đang tải..." : "Tải thêm"}</button>}
    </div>
  );
}
