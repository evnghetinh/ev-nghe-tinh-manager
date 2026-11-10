"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon, PageTitle, Toast } from "@/components/ui";
import DanhSach, { type Row } from "./danh-sach";
import { supabase } from "@/lib/supabase";
import { ChonHangDong, useGoiYXe } from "@/components/xe-chon";
import { namMauXe, tenXe } from "@/lib/format";

type Veh = { id: string; customer_id: string; plate: string; vehicle_type: string | null; hang_xe: string | null; dong_xe: string | null; nam_san_xuat: number | null; mau_xe: string | null; customers: { name: string; phone: string | null } | null };
type Cust = { id: string; name: string; phone: string | null };
const TYPES = ["Xe máy điện", "Xe đạp điện", "Ô tô điện", "Xe ba bánh điện", "Khác"];
const emptyNew = { plate: "", type: TYPES[0], vin: "", hang: "", dong: "", nam: "", mau: "", name: "", phone: "", address: "" };
// bỏ dấu tiếng Việt, hoa/thường và mọi ký tự không phải chữ/số (dấu cách, chấm, gạch...)
const squash = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");
const empty = { vehicle_id: "", odometer: "", issue: "", note: "", soc: "", soh: "", pin: "" };
type Ktv = { id: string; ten: string };

export default function OrdersPage() {
  const [vehs, setVehs] = useState<Veh[]>([]);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [nv, setNv] = useState(emptyNew);
  const [busy, setBusy] = useState(false);
  const [goiY, loadGoiY] = useGoiYXe();
  const [form, setForm] = useState(empty);
  const [reloadKey, setReloadKey] = useState(0);
  const [ktvs, setKtvs] = useState<Ktv[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [dtcs, setDtcs] = useState<{ ma: string; ghi_chu: string }[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const sp = useSearchParams();
  const tim = sp.get("tim") ?? "";
  const khachId = sp.get("khach");
  const moiTim = sp.get("moi");
  const daLamParam = useRef(false);

  const load = useCallback(async () => {
    const v = await supabase.from("vehicles").select("id, customer_id, plate, vehicle_type, hang_xe, dong_xe, nam_san_xuat, mau_xe, customers(name, phone)").order("plate");
    const c = await supabase.from("customers").select("id, name, phone");
    if (c.data) setCusts(c.data as Cust[]);
    setReloadKey((k) => k + 1);
    if (v.data) setVehs(v.data as unknown as Veh[]);
    setLoaded(true);
    const k = await supabase.from("ev_ky_thuat_vien").select("id, ten").eq("dang_lam", true).order("ten");
    if (k.data) setKtvs(k.data as Ktv[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Mở từ hồ sơ khách (?khach=) hoặc từ ô tìm kiếm không thấy kết quả (?moi=)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!loaded || daLamParam.current) return;
    if (khachId) {
      daLamParam.current = true;
      const cs = vehs.filter((v) => v.customer_id === khachId);
      if (cs.length === 1) pickVeh(cs[0]);
      else { setQ(custs.find((c) => c.id === khachId)?.name ?? ""); setOpen(true); }
    } else if (moiTim !== null) {
      daLamParam.current = true;
      const t = moiTim.trim();
      setIsNew(true);
      if (/^[\d\s.+-]+$/.test(t) && t.replace(/\D/g, "").length >= 6) setNv((x) => ({ ...x, phone: t }));
      else if (/\d/.test(t) && /[a-zA-Z]/.test(t)) setNv((x) => ({ ...x, plate: t.toUpperCase() }));
      else if (t) setNv((x) => ({ ...x, name: t }));
    }
  }, [loaded, khachId, moiTim, vehs, custs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const veh = vehs.find((v) => v.id === form.vehicle_id);
    if (!isNew && !veh) return setError("Hãy chọn xe, hoặc bấm \"+ Xe mới\".");
    if (form.soc === "") return setError("Hãy nhập SOC lúc nhận xe (%).");
    if (Number(form.soc) > 100 || Number(form.soh || 0) > 100) return setError("SOC và SOH phải từ 0 đến 100.");
    setBusy(true);
    try {
      let vehicleId = veh?.id ?? "";
      let customerId = veh?.customer_id ?? "";
      if (isNew) {
        const plate = nv.plate.trim().toUpperCase();
        const phoneKey = nv.phone.replace(/\D/g, "");
        if (!squash(plate)) return setError("Hãy nhập biển số.");
        if (!nv.name.trim()) return setError("Hãy nhập tên khách.");
        if (!phoneKey) return setError("Hãy nhập số điện thoại.");
        if (nv.nam && (Number(nv.nam) < 1950 || Number(nv.nam) > 2100)) return setError("Năm sản xuất không hợp lệ.");
        const dup = vehs.find((v) => squash(v.plate) === squash(plate));
        if (dup) {
          pickVeh(dup);
          return setError(`Biển số ${dup.plate} đã có xe (${dup.customers?.name ?? ""}). Đã chọn lại xe đó, hãy kiểm tra rồi bấm tạo phiếu.`);
        }
        const oldCust = custs.find((c) => (c.phone ?? "").replace(/\D/g, "") === phoneKey);
        if (oldCust && !confirm(`Số điện thoại này đã có khách "${oldCust.name}". Dùng lại khách này cho xe mới?\n\nOK = dùng khách cũ, Hủy = quay lại sửa.`)) return;
        const r = await supabase.rpc("tao_khach_xe", { p_bien_so: plate, p_loai_xe: nv.type, p_vin: nv.vin, p_ten: nv.name, p_sdt: nv.phone, p_dia_chi: nv.address, p_khach_id: oldCust?.id ?? null, p_hang: nv.hang, p_dong: nv.dong, p_nam: nv.nam ? Number(nv.nam) : null, p_mau: nv.mau });
        if (!r.error) loadGoiY();
        if (r.error) return setError(r.error.message);
        const out = r.data as { xe_id: string; khach_id: string; xe_co_san: boolean };
        if (out.xe_co_san) {
          await load(); setIsNew(false); setForm((f) => ({ ...f, vehicle_id: out.xe_id }));
          return setError("Biển số này đã có xe trong hệ thống. Đã chọn lại xe đó, hãy kiểm tra rồi bấm tạo phiếu.");
        }
        vehicleId = out.xe_id; customerId = out.khach_id;
      }
      await createOrder(vehicleId, customerId);
    } finally { setBusy(false); }
  }
  function pickVeh(v: Veh) {
    setForm((f) => ({ ...f, vehicle_id: v.id })); setIsNew(false); setOpen(false);
    setQ(`${v.plate}${tenXe(v) ? ` · ${tenXe(v)}` : ""} - ${v.customers?.name ?? ""}`);
  }
  async function createOrder(vehicleId: string, customerId: string) {
    const { data: created, error } = await supabase.from("repair_orders").insert({
      vehicle_id: vehicleId, customer_id: customerId,
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
    setForm(empty); setChosen([]); setDtcs([]); setQ(""); setIsNew(false); setNv(emptyNew); load();
  }
  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("repair_orders").update({ status }).eq("id", id);
    if (error) setError(error.message); else load();
  }
  // Chỉ xóa được phiếu NHÁP (chưa có dòng, chưa thu, chưa trừ kho); việc xóa được ghi nhật ký
  async function remove(o: Row) {
    if (!confirm(`Xóa phiếu nháp PT${String(o.code).padStart(4, "0")}? Chỉ xóa được khi phiếu chưa có dòng nào, chưa thu tiền, chưa trừ kho. Việc xóa được ghi nhật ký.`)) return;
    const { error } = await supabase.rpc("xoa_phieu_nhap", { p_order: o.id });
    if (error) setError(error.message); else load();
  }
  // Phiếu đã có dòng / đã thu / đã trừ kho: chỉ Chủ hủy, lý do bắt buộc
  async function cancelOrder(o: Row) {
    const ly = window.prompt(`Hủy phiếu PT${String(o.code).padStart(4, "0")}. Kho được hoàn lại, khoản thu được đảo, phiếu bị loại khỏi doanh thu và lợi nhuận.\n\nLý do hủy (bắt buộc):`);
    if (ly === null) return;
    if (!ly.trim()) return setError("Bắt buộc nhập lý do hủy phiếu.");
    const { error } = await supabase.rpc("huy_phieu", { p_order: o.id, p_ly_do: ly.trim() });
    if (error) setError(error.message); else load();
  }

  const tokens = q.trim().split(/\s+/).map(squash).filter(Boolean);
  const matches = vehs.filter((v) => {
    const h = squash(`${v.plate} ${v.vehicle_type ?? ""} ${tenXe(v)} ${v.customers?.name ?? ""} ${v.customers?.phone ?? ""}`);
    return tokens.every((t) => h.includes(t));
  }).slice(0, 30);
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="clipboard" />} title="Phiếu tiếp nhận sửa chữa" />
      <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-2">
          <div className="relative">
            <input placeholder="Gõ biển số, hãng/dòng xe (vf5), tên khách hoặc SĐT để tìm xe *" className={input} value={q} autoComplete="off"
              onFocus={() => setOpen(true)}
              onChange={(e) => { setQ(e.target.value); setOpen(true); setForm({ ...form, vehicle_id: "" }); }} />
            {open && !isNew && (
              <ul className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-auto bg-white border rounded-lg shadow-lg">
                {matches.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => pickVeh(v)} className="w-full text-left px-3 py-2 border-b hover:bg-green-50">
                      <div className="font-medium">{v.plate}{tenXe(v) ? ` · ${tenXe(v)}` : ""} <span className="text-sm font-normal text-slate-500">· {v.vehicle_type ?? "Xe"}{namMauXe(v) ? ` · ${namMauXe(v)}` : ""}</span></div>
                      <div className="text-sm text-slate-500">{v.customers?.name}{v.customers?.phone ? ` · ${v.customers.phone}` : ""}</div>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Không có xe nào khớp.</li>}
                <li><button type="button" onClick={() => { setIsNew(true); setOpen(false); setForm({ ...form, vehicle_id: "" }); }}
                  className="w-full text-left px-3 py-3 text-green-700 font-medium bg-green-50">+ Xe mới</button></li>
                <li><button type="button" onClick={() => setOpen(false)} className="w-full text-left px-3 py-2 text-sm text-slate-500">Đóng</button></li>
              </ul>
            )}
          </div>
          {form.vehicle_id && !isNew && <p className="text-sm text-green-700">✓ Đã chọn xe: {q}</p>}
          {isNew && (
            <div className="border rounded-lg p-3 grid gap-3 sm:grid-cols-2 bg-green-50/50">
              <div className="sm:col-span-2 flex justify-between items-center gap-2">
                <span className="font-medium">Xe mới (tự tạo khách và xe khi bấm tạo phiếu)</span>
                <button type="button" onClick={() => { setIsNew(false); setOpen(true); }} className="text-sm text-slate-600 underline shrink-0">Chọn xe có sẵn</button>
              </div>
              <input required placeholder="Biển số *" className={input} value={nv.plate} onChange={(e) => setNv({ ...nv, plate: e.target.value })} />
              <select className={input} value={nv.type} onChange={(e) => setNv({ ...nv, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              <ChonHangDong hang={nv.hang} dong={nv.dong} goiY={goiY} onChange={(h, d) => setNv((x) => ({ ...x, hang: h, dong: d }))} />
              <input placeholder="Năm sản xuất (không bắt buộc)" inputMode="numeric" className={input} value={nv.nam} onChange={(e) => setNv({ ...nv, nam: e.target.value.replace(/D/g, "").slice(0, 4) })} />
              <input placeholder="Màu xe (không bắt buộc)" className={input} value={nv.mau} onChange={(e) => setNv({ ...nv, mau: e.target.value })} />
              <input placeholder="Số khung / VIN (không bắt buộc)" className={`${input} sm:col-span-2`} value={nv.vin} onChange={(e) => setNv({ ...nv, vin: e.target.value })} />
              <input required placeholder="Tên khách *" className={input} value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} />
              <input required placeholder="Số điện thoại *" inputMode="tel" className={input} value={nv.phone} onChange={(e) => setNv({ ...nv, phone: e.target.value })} />
              <input placeholder="Địa chỉ (không bắt buộc)" className={`${input} sm:col-span-2`} value={nv.address} onChange={(e) => setNv({ ...nv, address: e.target.value })} />
            </div>
          )}
        </div>
        <input placeholder="Số km đã đi" inputMode="numeric" className={input} value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value.replace(/\D/g, "") })} />
        <input placeholder="Ghi chú (tình trạng xe, đồ để lại...)" className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <input required placeholder="SOC lúc nhận xe (%) *" inputMode="numeric" className={input} value={form.soc} onChange={(e) => setForm({ ...form, soc: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
        <input placeholder="SOH pin (%) - không bắt buộc" inputMode="numeric" className={input} value={form.soh} onChange={(e) => setForm({ ...form, soh: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
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
          <button type="button" onClick={() => setDtcs([...dtcs, { ma: "", ghi_chu: "" }])} className="btn-secondary text-sm">+ Thêm mã lỗi</button>
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
        <div className="sm:col-span-2"><button disabled={busy} className="btn-primary disabled:opacity-60">{busy ? "Đang tạo..." : "Tạo phiếu tiếp nhận"}</button></div>
      </form>
      <Toast text={error} onClose={() => setError("")} />
      <DanhSach initialTim={tim} reloadKey={reloadKey} onStatus={setStatus} onRemove={remove} onCancel={cancelOrder} />
    </div>
  );
}
