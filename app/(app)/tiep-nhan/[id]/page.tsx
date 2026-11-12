"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { tenXe, namMauXe, money, digits, qtyText, decimalInput, toNum, COT_PHU_TUNG, tonText, type DonVi } from "@/lib/format";
import { useRole } from "@/lib/role";
import { StatusBadge, Toast } from "@/components/ui";
import Photos from "./photos";
import PartPicker from "./part-picker";
import Costs from "./costs";
import EvInfo from "./ev";
import GiamVat, { toTot, vatText, giamText, type Tot, type GvCfg, type Kieu } from "./giam-vat";

type Item = { id: string; kind: "part" | "labor"; name: string; qty: number; unit_price: number; don_vi: string | null; giam_kieu: Kieu; giam_gia_tri: number; thanh_tien: number; giam_tien: number; sau_giam: number };
type GvSnap = { giam_kieu: Kieu; giam_gia_tri: number; vat_suat: number; vat_che_do: "chua" | "da"; giam_dong?: { dong: string; kieu: Kieu; gia_tri: number }[]; giam_gia: number; vat: number; tong_thanh_toan: number };
type GvLog = { id: string; created_at: string; created_by_name: string | null; da_hoan_thanh: boolean; ly_do: string | null; tong_truoc: number; tong_sau: number; truoc: GvSnap; sau: GvSnap };
const snapText = (x: GvSnap) => [
  Number(x.giam_gia_tri) > 0 ? `giảm toàn phiếu ${giamText(x.giam_kieu, Number(x.giam_gia_tri))}` : "",
  x.giam_dong?.length ? `giảm ${x.giam_dong.length} dòng (${x.giam_dong.map((d) => `${d.dong}: ${giamText(d.kieu, Number(d.gia_tri))}`).join("; ")})` : "",
  `VAT ${Number(x.vat_suat) > 0 ? vatText(Number(x.vat_suat), x.vat_che_do) : "0%"}`,
].filter(Boolean).join(" · ");
type Part = { id: string; name: string; code: string | null; sale_price: number; stock: number } & DonVi;
type Past = { id: string; code: number; received_at: string; odometer: number | null; issue: string; status: string; items: { kind: "part" | "labor"; name: string; qty: number }[] };
type Log = { id: string; action: "them" | "xoa" | "tra"; ghi_chu: string | null; kind: "part" | "labor"; item_name: string; qty: number; unit_price: number; total_before: number; total_after: number; created_by_name: string | null; created_at: string };
type Pay = { id: string; ref_id: string | null; loai: "thu" | "dieu_chinh" | "dao"; so_tien: number; hinh_thuc: string; ngay_thu: string; ghi_chu: string | null; da_huy: boolean; huy_ly_do: string | null; huy_boi_ten: string | null; huy_luc: string | null; created_by_name: string | null; created_at: string };
const LOAI_THU: Record<string, string> = { thu: "Khoản thu", dieu_chinh: "Điều chỉnh", dao: "Dòng đảo do hủy phiếu" };
type Order = { giam_kieu: Kieu; giam_gia_tri: number; giam_ly_do: string | null; vat_suat: number; vat_che_do: "chua" | "da"; code: number; issue: string; status: string; payment_method: string | null; paid_at: string | null; stock_deducted: boolean; da_huy: boolean; huy_ly_do: string | null; huy_boi_ten: string | null; huy_luc: string | null; odometer: number | null; vehicles: { plate: string; hang_xe: string | null; dong_xe: string | null; nam_san_xuat: number | null; mau_xe: string | null } | null; customers: { name: string; phone: string | null; address: string | null } | null };

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const [labor, setLabor] = useState({ name: "", price: "" });
  const [error, setError] = useState("");
  const [pay, setPay] = useState({ method: "Tiền mặt", date: new Date().toLocaleDateString("sv-SE") });
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<Past[] | null>(null);
  const [pastError, setPastError] = useState("");
  const role = useRole();
  const [editing, setEditing] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [notice, setNotice] = useState("");
  const [ret, setRet] = useState<{ id: string; qty: string; reason: string } | null>(null);
  const [partsCost, setPartsCost] = useState(0);
  const [showPay, setShowPay] = useState(false);
  const [pays, setPays] = useState<Pay[]>([]);
  const [newPay, setNewPay] = useState({ amount: "", method: "Tiền mặt", date: new Date().toLocaleDateString("sv-SE"), note: "" });
  const [tot, setTot] = useState<Tot | null>(null);
  const [cfg, setCfg] = useState<GvCfg | null>(null);
  const [gvLogs, setGvLogs] = useState<GvLog[]>([]);

  const load = useCallback(async () => {
    const o = await supabase.from("repair_orders").select("giam_kieu, giam_gia_tri, giam_ly_do, vat_suat, vat_che_do, code, issue, status, payment_method, paid_at, stock_deducted, da_huy, huy_ly_do, huy_boi_ten, huy_luc, odometer, vehicles(plate, hang_xe, dong_xe, nam_san_xuat, mau_xe), customers(name, phone, address)").eq("id", id).single();
    const i = await supabase.rpc("dong_bao_gia", { p_order: id });
    const p = await supabase.from("parts").select(COT_PHU_TUNG).eq("is_hidden", false).order("name");
    if (o.error) setError(o.error.message + " (đã chạy giai-doan-31.sql chưa?)"); else { const d = o.data as unknown as Order; setOrder({ ...d, giam_gia_tri: Number(d.giam_gia_tri), vat_suat: Number(d.vat_suat) }); }
    if (i.error) setError(i.error.message + " (đã chạy giai-doan-31.sql chưa?)"); else if (i.data) setItems((i.data as Item[]).map((x) => ({ ...x, qty: Number(x.qty), unit_price: Number(x.unit_price), giam_gia_tri: Number(x.giam_gia_tri), thanh_tien: Number(x.thanh_tien), giam_tien: Number(x.giam_tien), sau_giam: Number(x.sau_giam) })));
    const tt = await supabase.rpc("tinh_tong_phieu", { p_order: id });
    const trow = (tt.data as Record<string, unknown>[] | null)?.[0];
    if (tt.error) setError(tt.error.message + " (đã chạy giai-doan-31.sql chưa?)"); else setTot(trow ? toTot(trow) : null);
    const cd = await supabase.from("phieu_cai_dat").select("giam_toi_da_nv, vat_suat_ds").maybeSingle();
    if (cd.data) setCfg({ giam_toi_da_nv: Number(cd.data.giam_toi_da_nv), vat_suat_ds: (cd.data.vat_suat_ds as (number | string)[]).map(Number) });
    if (p.data) setParts((p.data as Part[]).map((x) => ({ ...x, stock: Number(x.stock), he_so: Number(x.he_so) })));
    const pm = await supabase.from("order_payments").select("id, ref_id, loai, so_tien, hinh_thuc, ngay_thu, ghi_chu, da_huy, huy_ly_do, huy_boi_ten, huy_luc, created_by_name, created_at").eq("order_id", id).order("seq");
    if (pm.data) setPays((pm.data as Pay[]).map((x) => ({ ...x, so_tien: Number(x.so_tien) })));
    if (role === "chu") {
      const l = await supabase.from("repair_edit_logs").select("id, action, ghi_chu, kind, item_name, qty, unit_price, total_before, total_after, created_by_name, created_at").eq("order_id", id).order("created_at", { ascending: false });
      if (l.data) setLogs(l.data as Log[]);
      const gl = await supabase.from("phieu_giam_vat_nhat_ky").select("id, created_at, created_by_name, da_hoan_thanh, ly_do, tong_truoc, tong_sau, truoc, sau").eq("order_id", id).order("created_at", { ascending: false });
      if (gl.data) setGvLogs((gl.data as GvLog[]).map((x) => ({ ...x, tong_truoc: Number(x.tong_truoc), tong_sau: Number(x.tong_sau) })));
      const c = await supabase.from("repair_items").select("kind, qty, repair_item_costs(cost_price)").eq("order_id", id);
      if (c.data) {
        type Row = { kind: string; qty: number; repair_item_costs: { cost_price: number } | { cost_price: number }[] | null };
        setPartsCost((c.data as unknown as Row[]).filter((r) => r.kind === "part").reduce((s, r) => {
          const x = r.repair_item_costs;
          return s + r.qty * ((Array.isArray(x) ? x[0]?.cost_price : x?.cost_price) ?? 0);
        }, 0));
      }
    }
    const h = await supabase.rpc("lich_su_xe", { p_order: id });
    if (h.error) { setPastError(h.error.message); setPast([]); } else { setPastError(""); setPast(h.data as Past[]); }
  }, [id, role]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function addPart(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const p = parts.find((x) => x.id === partId);
    if (!p) return setError("Hãy chọn phụ tùng.");
    const n = toNum(qty);
    if (!(n > 0)) return setError("Số lượng phải lớn hơn 0.");
    if (Math.round(n * 1000) / 1000 !== n) return setError("Số lượng chỉ được tối đa 3 chữ số thập phân.");
    if (n > p.stock) return setError(`Không đủ tồn: còn ${tonText(p.stock, p)}, bạn nhập ${qtyText(n)} ${p.don_vi_ban}.`);
    if (done) {
      if (!confirm(`Thêm "${p.name}" × ${qtyText(n)} ${p.don_vi_ban} vào phiếu đã hoàn thành? Kho sẽ bị trừ ${qtyText(n)} ${p.don_vi_ban}.`)) return;
      setBusy(true);
      const r = await supabase.rpc("sua_phieu_them_phu_tung", { p_order: id, p_part: p.id, p_qty: n });
      setBusy(false);
      if (r.error) return setError(r.error.message);
      report(r.data);
    } else {
      const { error } = await supabase.rpc("phieu_them_phu_tung", { p_order: id, p_part: p.id, p_qty: n });
      if (error) return setError(error.message);
    }
    setPartId(""); setQty("1"); load();
  }
  async function addLabor(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (done) {
      if (!confirm(`Thêm tiền công "${labor.name.trim()}" ${money(Number(labor.price || 0))} vào phiếu đã hoàn thành?`)) return;
      setBusy(true);
      const r = await supabase.rpc("sua_phieu_them_cong", { p_order: id, p_name: labor.name.trim(), p_price: Number(labor.price || 0) });
      setBusy(false);
      if (r.error) return setError(r.error.message);
      report(r.data);
    } else {
      const { error } = await supabase.rpc("phieu_them_cong", { p_order: id, p_name: labor.name.trim(), p_price: Number(labor.price || 0) });
      if (error) return setError(error.message);
    }
    setLabor({ name: "", price: "" }); load();
  }
  async function remove(it: Item) {
    setError("");
    if (done) {
      if (!confirm(`Xóa dòng "${it.name}" khỏi phiếu đã hoàn thành?${it.kind === "part" ? ` Kho sẽ được cộng lại ${qtyText(it.qty)} ${it.don_vi ?? ""}.` : ""}`)) return;
      setBusy(true);
      const r = await supabase.rpc("sua_phieu_xoa_dong", { p_item: it.id });
      setBusy(false);
      if (r.error) return setError(r.error.message);
      report(r.data);
      return load();
    }
    if (!confirm(`Xóa dòng "${it.name}"?`)) return;
    const { error } = await supabase.rpc("phieu_xoa_dong", { p_item: it.id });
    if (error) setError(error.message); else load();
  }
  async function giveBack(it: Item) {
    if (!ret) return;
    setError("");
    const n = toNum(ret.qty);
    if (!n || n <= 0) return setError("Số lượng trả phải lớn hơn 0.");
    if (n > it.qty) return setError(`Số lượng trả không được quá ${qtyText(it.qty)}.`);
    if (!ret.reason.trim()) return setError("Hãy nhập lý do trả hàng.");
    if (!confirm(`Khách trả ${qtyText(n)} ${it.don_vi ?? ""} × ${it.name}? Kho cộng lại ${qtyText(n)} ${it.don_vi ?? ""}, tổng phiếu được tính lại (giảm giá và VAT của phiếu vẫn giữ nguyên).`)) return;
    setBusy(true);
    const r = await supabase.rpc("khach_tra_hang", { p_item: it.id, p_qty: n, p_ly_do: ret.reason });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setRet(null); report(r.data); load();
  }
  async function cancelOrder() {
    const ly = window.prompt("Hủy phiếu: kho được hoàn lại, mọi khoản đã thu được đảo khỏi sổ quỹ, mọi chi phí của phiếu được hủy (khoản đã chi được đảo khỏi sổ quỹ), phiếu bị loại khỏi doanh thu, lợi nhuận và công nợ. Không hoàn tác được.\n\nLý do hủy (bắt buộc):");
    if (ly === null) return;
    if (!ly.trim()) return setError("Bắt buộc nhập lý do hủy phiếu.");
    setBusy(true);
    const r = await supabase.rpc("huy_phieu", { p_order: id, p_ly_do: ly.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice("Đã hủy phiếu: hoàn kho, đảo khoản thu, hủy chi phí và ghi nhật ký."); load();
  }
  async function cancelPay(p: Pay) {
    const ly = window.prompt(`Hủy khoản thu ${money(p.so_tien)} (${p.hinh_thuc}). Dòng được giữ lại và đánh dấu đã hủy; muốn sửa số tiền thì ghi khoản thu mới.\n\nLý do hủy (bắt buộc):`);
    if (ly === null) return;
    if (!ly.trim()) return setError("Bắt buộc nhập lý do hủy khoản thu.");
    setBusy(true);
    const r = await supabase.rpc("huy_khoan_thu", { p_payment: p.id, p_ly_do: ly.trim() });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice("Đã hủy khoản thu và ghi nhật ký."); load();
  }
  async function addPay(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const amount = Number(newPay.amount || 0);
    if (!(amount > 0)) return setError("Số tiền phải lớn hơn 0.");
    if (!newPay.date) return setError("Hãy chọn ngày thu tiền.");
    if (amount > conNo) return setError(`Số thu vượt số còn nợ (${money(conNo)}).`);
    setBusy(true);
    const r = await supabase.rpc("ghi_khoan_thu", { p_order: id, p_so_tien: amount, p_hinh_thuc: newPay.method, p_ngay: newPay.date, p_ghi_chu: newPay.note });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNewPay({ ...newPay, amount: "", note: "" }); setShowPay(false); setNotice("Đã ghi khoản thu và vào sổ quỹ."); load();
  }
  function report(d: { truoc: number; sau: number }) {
    const diff = d.sau - d.truoc;
    setNotice(`Đã lưu và ghi nhật ký. Tổng trước ${money(d.truoc)} → sau ${money(d.sau)} (${diff >= 0 ? "tăng " : "giảm "}${money(Math.abs(diff))}).`);
  }

  async function complete() {
    setError("");
    if (!pay.date) return setError("Hãy chọn ngày hoàn thành.");
    const last = [...pays].reverse().find((p) => !p.da_huy && p.loai === "thu");
    if (!confirm(`Hoàn thành phiếu?${conNo > 0 ? ` Còn nợ ${money(conNo)} sẽ được ghi nợ.` : ""} Kho phụ tùng sẽ bị trừ và không hoàn tác được.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("hoan_thanh_phieu", { p_order: id, p_method: last?.hinh_thuc ?? "Tiền mặt", p_date: pay.date });
    setBusy(false);
    if (error) return setError(error.message);
    load();
  }

  const sum = (k: Item["kind"]) => items.filter((i) => i.kind === k).reduce((s, i) => s + i.thanh_tien, 0);
  const picked = parts.find((x) => x.id === partId);
  const overStock = !!picked && toNum(qty) > picked.stock;
  const partsTotal = sum("part");
  const laborTotal = sum("labor");
  const done = !!order?.stock_deducted;
  const cancelled = !!order?.da_huy;
  const canEdit = !cancelled && (!done || (role === "chu" && editing));
  const thuRong = pays.filter((p) => !p.da_huy).reduce((s, p) => s + p.so_tien, 0);
  const tong = tot?.tong_thanh_toan ?? 0; // tổng thanh toán (đã gồm VAT) do máy chủ tính - dùng cho công nợ và khoản thu
  const conNo = cancelled ? 0 : Math.max(0, Math.round(tong - thuRong));
  const conThieu = cancelled ? 0 : Math.round(tong - thuRong);
  // Phiếu đã hủy: khoản thu đã bị đảo (đánh dấu hủy, hoặc có dòng đảo kiểu cũ)
  const daDao = (p: Pay) => cancelled && p.loai !== "dao" && (p.da_huy || pays.some((d) => d.loai === "dao" && d.ref_id === p.id && !d.da_huy));
  const huyCungPhieu = (p: Pay) => !!order?.huy_luc && !!p.huy_luc && new Date(p.huy_luc).getTime() >= new Date(order.huy_luc).getTime();
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <Link href="/tiep-nhan" className="text-sm font-medium text-brand-700 inline-flex items-center min-h-11">← Quay lại danh sách phiếu</Link>
        <Link href={`/tiep-nhan/${id}/in`} className="btn btn-primary text-sm">In báo giá</Link>
      </div>
      {order && (
        <div className="card border-l-4 border-brand-500">
          <div className="flex justify-between gap-2 items-start"><h1 className={`text-xl font-bold text-navy-900 ${cancelled ? "line-through text-slate-400" : ""}`}>Báo giá PT{String(order.code).padStart(4, "0")} · {order.vehicles?.plate}{tenXe(order.vehicles) ? ` · ${tenXe(order.vehicles)}` : ""}</h1><StatusBadge status={order.status} /></div>
          {namMauXe(order.vehicles) && <p className="text-sm text-slate-500">Xe: {[tenXe(order.vehicles), namMauXe(order.vehicles)].filter(Boolean).join(" · ")}</p>}
          <p className="text-sm text-slate-500">{order.customers?.name}{order.customers?.phone ? ` (${order.customers.phone})` : ""}</p>
          {order.customers?.address && <p className="text-sm text-slate-500">Địa chỉ: {order.customers.address}</p>}
          {order.odometer != null && <p className="text-sm text-slate-500">Số km: {new Intl.NumberFormat("vi-VN").format(order.odometer)} km</p>}
          <p className="text-sm mt-1">{order.issue}</p>
          {cancelled && (
            <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              <b>PHIẾU ĐÃ HỦY</b> — không tính vào doanh thu, lợi nhuận. {order.huy_boi_ten ? `Hủy bởi ${order.huy_boi_ten}` : ""}{order.huy_luc ? ` lúc ${new Date(order.huy_luc).toLocaleString("vi-VN")}` : ""}.
              <div>Lý do: {order.huy_ly_do}</div>
            </div>
          )}
        </div>
      )}
      <Toast text={error} onClose={() => setError("")} />
      <Toast text={error ? "" : notice} kind="ok" onClose={() => setNotice("")} />

      {canEdit && <form onSubmit={addPart} className="card grid gap-3 sm:grid-cols-[1fr_10rem_auto] items-start">
        <PartPicker parts={parts} value={partId} onChange={setPartId} className={input} />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input placeholder="SL" inputMode="decimal" aria-label="Số lượng" className={`${input} ${overStock ? "border-red-500 text-red-700" : ""}`} value={qty} onChange={(e) => setQty(decimalInput(e.target.value))} />
            <span className="text-sm text-slate-600 shrink-0">{picked?.don_vi_ban ?? ""}</span>
          </div>
          {picked && <div className="text-xs text-slate-500">Đơn giá {money(picked.sale_price)}/{picked.don_vi_ban}</div>}
          {overStock && picked && <div className="text-xs text-red-600 font-medium">Vượt tồn: chỉ còn {tonText(picked.stock, picked)}</div>}
        </div>
        <button disabled={busy} className="btn-primary disabled:opacity-50">Thêm phụ tùng</button>
        {parts.length === 0 && <p className="sm:col-span-3 text-sm text-amber-700">Chưa có phụ tùng. Hãy thêm ở mục Phụ tùng.</p>}
      </form>}

      {canEdit && <form onSubmit={addLabor} className="card grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
        <input required placeholder="Tiền công (vd: Thay bộ sạc) *" className={input} value={labor.name} onChange={(e) => setLabor({ ...labor, name: e.target.value })} />
        <input required placeholder="Số tiền (đ) *" inputMode="numeric" className={input} value={labor.price} onChange={(e) => setLabor({ ...labor, price: digits(e.target.value) })} />
        <button disabled={busy} className="btn-primary disabled:opacity-50">Thêm tiền công</button>
      </form>}

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="card space-y-2">
          <div className="flex justify-between gap-2 items-center">
            <div>
              <div className="font-medium">{it.name} <span className="text-xs text-slate-500">({it.kind === "part" ? "Phụ tùng" : "Tiền công"})</span></div>
              <div className="text-sm text-slate-500">{qtyText(it.qty)}{it.kind === "part" && it.don_vi ? ` ${it.don_vi}` : ""} × {money(it.unit_price)}{it.kind === "part" && it.don_vi ? `/${it.don_vi}` : ""}</div>
              {it.giam_tien > 0 && <div className="text-sm text-rose-700">Giảm {giamText(it.giam_kieu, it.giam_gia_tri)}: −{money(it.giam_tien)}</div>}
            </div>
            <div className="text-right shrink-0">
              {it.giam_tien > 0 && <div className="text-xs text-slate-400 line-through">{money(it.thanh_tien)}</div>}
              <div className="font-medium">{money(it.sau_giam)}</div>
              {canEdit && <button disabled={busy} onClick={() => remove(it)} className="text-red-600 text-sm">Xóa</button>}
              {done && role === "chu" && it.kind === "part" && <button disabled={busy} onClick={() => setRet(ret?.id === it.id ? null : { id: it.id, qty: "1", reason: "" })} className="text-amber-700 text-sm ml-3">Khách trả</button>}
            </div>
          </div>
          {ret?.id === it.id && (
            <div className="border-t pt-2 grid gap-2 sm:grid-cols-[100px_1fr_auto]">
              <input inputMode="decimal" aria-label="Số lượng trả" className={input} value={ret.qty} onChange={(e) => setRet({ ...ret, qty: decimalInput(e.target.value) })} />
              <input aria-label="Lý do trả" placeholder="Lý do trả hàng (bắt buộc)" className={input} value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })} />
              <button disabled={busy} onClick={() => giveBack(it)} className="btn bg-amber-600 text-white px-4 disabled:opacity-50">Xác nhận trả</button>
            </div>
          )}
          </li>
        ))}
        {items.length === 0 && <li className="text-slate-500 text-sm">Chưa có dòng nào.</li>}
      </ul>

      {canEdit && order && cfg && items.length > 0 && (
        <GiamVat key={JSON.stringify([order.giam_kieu, order.giam_gia_tri, order.giam_ly_do, order.vat_suat, order.vat_che_do, items.map((i) => [i.id, i.giam_kieu, i.giam_gia_tri])])}
          orderId={id} order={order} cfg={cfg} isOwner={role === "chu"} done={done}
          items={items.map((i) => ({ id: i.id, name: i.name, thanh_tien: i.thanh_tien, giam_kieu: i.giam_kieu, giam_gia_tri: i.giam_gia_tri }))}
          onError={setError} onSaved={(d) => { if (d.doi) report(d); else setNotice("Không có gì thay đổi."); load(); }} />
      )}

      <div className="rounded-2xl p-4 space-y-1 text-white" style={{ background: "linear-gradient(135deg,#0f2747,#0866b8)" }}>
        <div className="flex justify-between"><span>Tạm tính</span><span>{money(tot?.tam_tinh ?? partsTotal + laborTotal)}</span></div>
        <div className="text-sm text-white/80 pl-3">Phụ tùng {money(partsTotal)} · Tiền công {money(laborTotal)}</div>
        <div className="flex justify-between text-sm"><span>Giảm giá{tot && tot.giam_dong > 0 && tot.giam_phieu > 0 ? " (dòng + toàn phiếu)" : ""}</span><span>−{money(tot?.giam_gia ?? 0)}</span></div>
        <div className="flex justify-between"><span>Tiền hàng sau giảm</span><span>{money(tot?.tien_hang ?? 0)}</span></div>
        <div className="flex justify-between text-sm"><span>{order && order.vat_che_do === "da" ? "Trong đó VAT" : "VAT"} ({order ? vatText(Number(order.vat_suat), order.vat_che_do) : "0%"})</span><span>{money(tot?.vat ?? 0)}</span></div>
        <div className="flex justify-between text-xl font-bold border-t border-white/30 pt-2 mt-1"><span>Tổng thanh toán</span><span>{money(tong)}</span></div>
        <div className="flex justify-between text-sm"><span>Đã thu</span><span>{money(thuRong)}</span></div>
        <div className="flex justify-between text-sm font-semibold"><span>{conThieu < 0 ? "Thu dư (cần hoàn khách)" : "Còn nợ"}</span><span>{money(conThieu < 0 ? -conThieu : conNo)}</span></div>
      </div>

      {cancelled ? null : done ? (
        <div className="bg-slate-100 rounded-xl p-4 text-sm space-y-3">
          <div>Đã hoàn thành ngày {order?.paid_at?.split("-").reverse().join("/")}. Kho đã được trừ.{conNo > 0 ? ` Khách còn nợ ${money(conNo)}.` : ""}</div>
          {role === "chu" ? (
            editing ? (
              <div className="space-y-2">
                <p className="text-amber-800">Đang mở chỉnh sửa: thêm phụ tùng sẽ trừ kho, xóa phụ tùng sẽ cộng lại kho. Mọi thay đổi đều được ghi nhật ký.</p>
                <button onClick={() => { setEditing(false); setNotice(""); }} className="border bg-white rounded-lg px-4 py-2">Đóng chỉnh sửa</button>
              </div>
            ) : (
              <button onClick={() => { setEditing(true); setNotice(""); }} className="btn bg-amber-600 text-white px-4">Mở chỉnh sửa</button>
            )
          ) : <p className="text-slate-500">Chỉ Chủ xưởng được sửa phiếu đã hoàn thành.</p>}
        </div>
      ) : (
        <div className="card grid gap-3 sm:grid-cols-[1fr_auto] items-center">
          <label className="text-sm flex items-center gap-2">Ngày hoàn thành
            <input type="date" className={input} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
          </label>
          <button onClick={complete} disabled={busy || items.length === 0} className="btn-primary disabled:opacity-50">Hoàn thành{conNo > 0 && items.length > 0 ? ` (ghi nợ ${money(conNo)})` : ""}</button>
        </div>
      )}

      {role === "chu" && !cancelled && (items.length > 0 || done) && (
        <div className="flex justify-end"><button disabled={busy} onClick={cancelOrder} className="btn bg-red-600 text-white px-4 disabled:opacity-50">Hủy phiếu</button></div>
      )}

      {(items.length > 0 || pays.length > 0) && (
        <section className="card space-y-3">
          <h2 className="font-bold">Thanh toán</h2>
          <div className="grid grid-cols-3 gap-2 text-sm text-center">
            <div className="rounded-lg bg-slate-100 p-2"><div className="text-slate-500">Tổng thanh toán</div><b>{money(tong)}</b></div>
            <div className="rounded-lg bg-green-50 p-2"><div className="text-slate-500">Đã thu</div><b className="text-green-700">{money(thuRong)}</b></div>
            <div className={`rounded-lg p-2 ${conNo > 0 ? "bg-amber-50" : "bg-green-50"}`}><div className="text-slate-500">Còn nợ</div><b className={conNo > 0 ? "text-amber-700" : "text-green-700"}>{money(conNo)}</b></div>
          </div>
          {cancelled && Math.round(thuRong) !== 0 && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">Phiếu đã hủy nhưng còn lệch {money(thuRong)} chưa đảo. Chủ xưởng vào Sổ quỹ → &quot;Đối chiếu phiếu đã hủy&quot; để sửa.</p>}
          {conThieu < 0 && <p className="text-sm text-amber-700">Thu dư {money(-conThieu)} so với tổng phiếu.</p>}
          <ul className="space-y-2">
            {pays.map((p) => (
              <li key={p.id} className={`border rounded-lg p-3 text-sm space-y-1 ${p.da_huy || daDao(p) ? "bg-slate-50 text-slate-400" : ""}`}>
                <div className="flex justify-between gap-2">
                  <span><b className={p.da_huy || daDao(p) ? "line-through" : p.so_tien < 0 ? "text-red-600" : ""}>{LOAI_THU[p.loai]}</b> · {p.hinh_thuc} · {p.ngay_thu.split("-").reverse().join("/")}</span>
                  <b className={p.da_huy || daDao(p) ? "line-through" : p.so_tien < 0 ? "text-red-600" : "text-green-700"}>{p.so_tien > 0 && p.loai !== "thu" ? "+" : ""}{money(p.so_tien)}</b>
                </div>
                {daDao(p) && <span className="inline-block text-xs font-semibold bg-red-100 text-red-700 rounded-full px-2 py-0.5">{p.da_huy && !huyCungPhieu(p) ? "đã hủy" : "đã hủy do hủy phiếu"}</span>}
                {p.ghi_chu && <div>{p.ghi_chu}</div>}
                <div className="text-xs">Ghi bởi {p.created_by_name ?? "Không rõ"} · {new Date(p.created_at).toLocaleString("vi-VN")}</div>
                {p.da_huy && <div className="text-xs text-red-600">Đã hủy bởi {p.huy_boi_ten ?? "Không rõ"} lúc {p.huy_luc ? new Date(p.huy_luc).toLocaleString("vi-VN") : ""} · Lý do: {p.huy_ly_do}</div>}
                {role === "chu" && !p.da_huy && p.loai === "thu" && !cancelled && <button disabled={busy} onClick={() => cancelPay(p)} className="bare text-red-600 text-sm min-h-11">Hủy khoản thu</button>}
              </li>
            ))}
            {pays.length === 0 && <li className="text-sm text-slate-500">Chưa có lần thu nào.</li>}
          </ul>
          {!cancelled && conNo > 0 && !showPay && (
            <button onClick={() => { setNewPay({ ...newPay, amount: String(conNo) }); setShowPay(true); }} className="btn-primary">Thu tiền</button>
          )}
          {!cancelled && showPay && (
            <form onSubmit={addPay} className="grid gap-2 sm:grid-cols-2 border-t pt-3">
              <div className="sm:col-span-2 font-medium text-sm">Thu tiền (tối đa {money(conNo)})</div>
              <input required inputMode="numeric" aria-label="Số tiền thu" placeholder="Số tiền (đ)" className={input} value={newPay.amount} onChange={(e) => setNewPay({ ...newPay, amount: digits(e.target.value) })} />
              <select aria-label="Hình thức" className={input} value={newPay.method} onChange={(e) => setNewPay({ ...newPay, method: e.target.value })}><option>Tiền mặt</option><option>Chuyển khoản</option></select>
              <input type="date" aria-label="Ngày thu" className={input} value={newPay.date} onChange={(e) => setNewPay({ ...newPay, date: e.target.value })} />
              <input placeholder="Ghi chú" className={input} value={newPay.note} onChange={(e) => setNewPay({ ...newPay, note: e.target.value })} />
              <div className="sm:col-span-2 flex gap-2">
                <button disabled={busy} className="btn-primary disabled:opacity-50">Ghi khoản thu</button>
                <button type="button" onClick={() => setShowPay(false)} className="btn-secondary px-3">Đóng</button>
              </div>
            </form>
          )}
        </section>
      )}

      {role === "chu" && (done || gvLogs.length > 0) && (
        <section className="card space-y-2">
          <h2 className="font-bold">Nhật ký chỉnh sửa</h2>
          {logs.length === 0 && gvLogs.length === 0 ? <p className="text-sm text-slate-500">Chưa có lần sửa nào sau khi hoàn thành.</p> : (
            <ul className="space-y-2">
              {[...gvLogs.map((g) => ({ at: g.created_at, el: (
                <li key={"gv" + g.id} className="border rounded-lg p-3 text-sm space-y-1">
                  <div className="text-slate-500">{new Date(g.created_at).toLocaleString("vi-VN")} · {g.created_by_name ?? "Không rõ"}</div>
                  <div><b className="text-violet-700">Sửa giảm giá / VAT</b>{g.da_hoan_thanh ? " (phiếu đã hoàn thành)" : ""}</div>
                  <div>Trước: {snapText(g.truoc)}</div>
                  <div>Sau: {snapText(g.sau)}</div>
                  {g.ly_do && <div>Lý do: {g.ly_do}</div>}
                  <div>Tổng: {money(g.tong_truoc)} → {money(g.tong_sau)} ({g.tong_sau - g.tong_truoc >= 0 ? "+" : "−"}{money(Math.abs(g.tong_sau - g.tong_truoc))})</div>
                </li>) })),
              ...logs.map((l) => {
                const diff = l.total_after - l.total_before;
                return { at: l.created_at, el: (
                  <li key={l.id} className="border rounded-lg p-3 text-sm space-y-1">
                    <div className="text-slate-500">{new Date(l.created_at).toLocaleString("vi-VN")} · {l.created_by_name ?? "Không rõ"}</div>
                    <div><b className={l.action === "them" ? "text-green-700" : l.action === "tra" ? "text-amber-700" : "text-red-600"}>{l.action === "them" ? "Thêm" : l.action === "tra" ? "Khách trả" : "Xóa"}</b> {l.kind === "part" ? "phụ tùng" : "tiền công"} <b>{l.item_name}</b> ({qtyText(l.qty)} × {money(l.unit_price)})</div>
                    {l.ghi_chu && <div>Lý do: {l.ghi_chu}</div>}
                    <div>Tổng: {money(l.total_before)} → {money(l.total_after)} ({diff >= 0 ? "+" : "−"}{money(Math.abs(diff))})</div>
                  </li>) };
              })].sort((a, b) => (a.at < b.at ? 1 : -1)).map((x) => x.el)}
            </ul>
          )}
        </section>
      )}

      {role === "chu" && <Costs orderId={id} revenue={tot?.doanh_thu ?? 0} partsCost={partsCost} cancelled={cancelled} huyLuc={order?.huy_luc ?? null} />}

      {order && <EvInfo key={String(done)} orderId={id} done={done} />}

      <Photos orderId={id} />

      <section className="card space-y-3">
        <h2 className="font-bold">Lịch sử sửa chữa của xe này{tenXe(order?.vehicles) ? ` (${order?.vehicles?.plate} · ${tenXe(order?.vehicles)})` : ""}</h2>
        {past === null ? <p className="text-sm text-slate-500">Đang tải...</p> : (
          <>
            <p className="text-sm text-slate-600">Tổng số lượt xe đã vào xưởng: <b>{past.length + 1}</b>{past.length === 0 ? " (đây là lần đầu)" : ""}</p>
            {pastError && <p className="text-sm text-red-600">Không tải được lịch sử: {pastError}</p>}
            <ul className="space-y-2">
              {past.map((h) => {
                const ps = h.items.filter((x) => x.kind === "part");
                const ls = h.items.filter((x) => x.kind === "labor");
                return (
                  <li key={h.id}>
                    <Link href={`/tiep-nhan/${h.id}`} className="block border rounded-lg p-3 hover:bg-slate-50 space-y-1">
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span className="font-medium">PT{String(h.code).padStart(4, "0")} · {new Date(h.received_at).toLocaleDateString("vi-VN")}{h.odometer != null ? ` · ${new Intl.NumberFormat("vi-VN").format(h.odometer)} km` : ""}</span>
                        <span className="text-sm text-slate-500">{h.status}</span>
                      </div>
                      <div className="text-sm"><span className="text-slate-500">Khách báo: </span>{h.issue}</div>
                      <div className="text-sm"><span className="text-slate-500">Phụ tùng đã thay: </span>{ps.length ? ps.map((x) => `${x.name} ×${qtyText(x.qty)}`).join(", ") : "—"}</div>
                      <div className="text-sm"><span className="text-slate-500">Công đã làm: </span>{ls.length ? ls.map((x) => x.name).join(", ") : "—"}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
