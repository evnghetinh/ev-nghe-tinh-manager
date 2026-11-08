"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money, qtyText, tenXe } from "@/lib/format";
import { GARA } from "@/lib/gara";

type Item = { id: string; kind: "part" | "labor"; name: string; qty: number; unit_price: number; don_vi: string | null };
const lineTotal = (i: { qty: number; unit_price: number }) => Math.round(i.qty * i.unit_price);
type Dtc = { ma: string; ghi_chu: string | null; sau_sua: string | null };
type Kt = { ten: string; ket_qua: "dat" | "khong_dat" | null; ghi_chu: string | null; nguoi_kt_ten: string | null; kt_luc: string | null };
type Pay = { id: string; loai: string; so_tien: number; hinh_thuc: string; ngay_thu: string; da_huy: boolean };
type Order = { stock_deducted: boolean; da_huy: boolean; huy_ly_do: string | null; received_at: string | null; soc_nhan: number | null; soh_nhan: number | null; pin_ghi_chu: string | null; nguyen_nhan: string | null; tiep_nhan_ten: string | null; kt_bo_qua_ly_do: string | null; code: number; odometer: number | null; issue: string; created_at: string; vehicles: { plate: string; vin: string | null; vehicle_type: string | null; hang_xe: string | null; dong_xe: string | null; nam_san_xuat: number | null; mau_xe: string | null } | null; customers: { name: string; phone: string | null; address: string | null } | null };

export default function PrintQuote() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [appTotal, setAppTotal] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [ktv, setKtv] = useState<string[]>([]);
  const [dtcs, setDtcs] = useState<Dtc[]>([]);
  const [kts, setKts] = useState<Kt[]>([]);
  const [size, setSize] = useState<"A4" | "A5">("A5");

  useEffect(() => {
    let alive = true;
    // Luôn đọc lại dữ liệu mới nhất: mỗi lần mở trang và mỗi lần quay lại tab / trang từ bộ nhớ đệm.
    async function load() {
      // Chỉ lấy giá bán, không đụng tới giá nhập/giá vốn/lợi nhuận/sổ quỹ.
      const o = await supabase.from("repair_orders").select("stock_deducted, da_huy, huy_ly_do, received_at, soc_nhan, soh_nhan, pin_ghi_chu, nguyen_nhan, tiep_nhan_ten, kt_bo_qua_ly_do, code, odometer, issue, created_at, vehicles(plate, vin, vehicle_type, hang_xe, dong_xe, nam_san_xuat, mau_xe), customers(name, phone, address)").eq("id", id).single();
      const i = await supabase.rpc("dong_bao_gia", { p_order: id });
      const [t, d, k, pm, raw] = await Promise.all([
        supabase.from("ev_phieu_ky_thuat_vien").select("ev_ky_thuat_vien(ten)").eq("order_id", id),
        supabase.from("ev_ma_loi").select("ma, ghi_chu, sau_sua").eq("order_id", id).order("created_at"),
        supabase.from("ev_kt_phieu").select("ten, ket_qua, ghi_chu, nguoi_kt_ten, kt_luc").eq("order_id", id).order("thu_tu").order("ten"),
        supabase.from("order_payments").select("id, loai, so_tien, hinh_thuc, ngay_thu, da_huy").eq("order_id", id).order("seq"),
        supabase.from("repair_items").select("qty, unit_price").eq("order_id", id), // nguồn thứ hai để tự kiểm tra tổng
      ]);
      if (!alive) return;
      type T = { ev_ky_thuat_vien: { ten: string } | { ten: string }[] | null };
      setKtv(t.data ? (t.data as unknown as T[]).flatMap((x) => (Array.isArray(x.ev_ky_thuat_vien) ? x.ev_ky_thuat_vien : x.ev_ky_thuat_vien ? [x.ev_ky_thuat_vien] : []).map((y) => y.ten)) : []);
      setDtcs((d.data as Dtc[]) ?? []);
      setKts((k.data as Kt[]) ?? []);
      setPays(((pm.data as Pay[]) ?? []).map((x) => ({ ...x, so_tien: Number(x.so_tien) })));
      setAppTotal(raw.data ? (raw.data as { qty: number; unit_price: number }[]).reduce((s, r) => s + lineTotal({ qty: Number(r.qty), unit_price: Number(r.unit_price) }), 0) : null);
      if (o.error) setError(o.error.message); else { setError(""); setOrder(o.data as unknown as Order); }
      if (i.error) setError(i.error.message); else if (i.data) setItems((i.data as Item[]).map((x) => ({ ...x, qty: Number(x.qty), unit_price: Number(x.unit_price) })));
    }
    load();
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) load(); };
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; window.removeEventListener("pageshow", onShow); document.removeEventListener("visibilitychange", onVis); };
  }, [id]);

  const total = items.reduce((s, i) => s + lineTotal(i), 0);
  const livePays = pays.filter((p) => !p.da_huy);
  const paid = livePays.reduce((s, p) => s + p.so_tien, 0);
  const remain = Math.round(total - paid);
  const mismatch = order != null && appTotal != null && appTotal !== total;
  const done = !!order?.stock_deducted;
  const cancelled = !!order?.da_huy;
  const fmt = (d: string) => new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows = [...items.filter((i) => i.kind === "part"), ...items.filter((i) => i.kind === "labor")];
  const LOAI: Record<string, string> = { dieu_chinh: "Điều chỉnh", dao: "Đảo" };
  const WIDE = ["Địa chỉ", "Tình trạng pin", "Mã lỗi DTC", "Nguyên nhân hư hỏng", "Nội dung"];
  const all: [string, string | null | undefined][] = order ? [
    ["Mã phiếu", `PT${String(order.code).padStart(4, "0")}`],
    ["Tiếp nhận lúc", fmt(order.received_at ?? order.created_at)],
    ["Khách hàng", order.customers?.name],
    ["Điện thoại", order.customers?.phone],
    ["Địa chỉ", order.customers?.address],
    ["Biển số xe", order.vehicles?.plate],
    ["Loại xe", order.vehicles?.vehicle_type],
    ["Hãng / dòng xe", tenXe(order.vehicles)],
    ["Năm sản xuất", order.vehicles?.nam_san_xuat ? String(order.vehicles.nam_san_xuat) : null],
    ["Màu xe", order.vehicles?.mau_xe],
    ["Số khung", order.vehicles?.vin],
    ["Số km", order.odometer != null ? `${new Intl.NumberFormat("vi-VN").format(order.odometer)} km` : null],
    ["SOC lúc nhận", order.soc_nhan != null ? `${order.soc_nhan}%` : null],
    ["SOH pin", order.soh_nhan != null ? `${order.soh_nhan}%` : null],
    ["Tình trạng pin", order.pin_ghi_chu],
    ["Mã lỗi DTC", dtcs.length ? dtcs.map((d) => `${d.ma}${d.ghi_chu ? ` (${d.ghi_chu})` : ""}${d.sau_sua ? ` – sau sửa: ${d.sau_sua === "da_xoa" ? "đã xóa" : "còn"}` : ""}`).join("; ") : null],
    ["Nguyên nhân hư hỏng", order.nguyen_nhan],
    ["Nội dung", order.issue],
    ["Kỹ thuật viên", ktv.join(", ")],
    ["Nhân viên tiếp nhận", order.tiep_nhan_ten],
  ] : [];
  const info = all.filter(([, v]) => v != null && String(v).trim() !== "") as [string, string][];
  const lastKt = kts.filter((k) => k.kt_luc).sort((a, b) => (a.kt_luc! < b.kt_luc! ? 1 : -1))[0];

  return (
    <div>
      <style>{`@page { size: ${size}; margin: 10mm; } @media print { body { background: #fff !important; color: #000 !important; } }`}</style>
      <div className="print:hidden flex flex-wrap gap-2 items-center mb-4">
        <Link href={`/tiep-nhan/${id}`} className="text-sm text-blue-600">← Quay lại</Link>
        <select value={size} onChange={(e) => setSize(e.target.value as "A4" | "A5")} className="border rounded-lg px-3 py-2 bg-white text-black">
          <option value="A5">Khổ A5</option><option value="A4">Khổ A4</option>
        </select>
        <button onClick={() => window.print()} className="bg-green-600 text-white rounded-lg px-4 py-2">In / Lưu PDF</button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {mismatch && <p className="print:hidden bg-red-600 text-white font-bold rounded-lg p-3 mb-3">CẢNH BÁO: tổng cộng in ra ({money(total)}) khác tổng phiếu trong app ({money(appTotal!)}). Đừng in, hãy tải lại trang và kiểm tra phiếu.</p>}
      {order && (
        <div className="relative overflow-hidden bg-white text-black max-w-[210mm] mx-auto p-4 sm:p-6 shadow print:shadow-none print:p-0 text-sm">
          {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10"><span className="text-red-600/20 font-black whitespace-nowrap" style={{ fontSize: "7rem", transform: "rotate(-35deg)", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>ĐÃ HỦY</span></div>}
          <div className="text-center border-b pb-2">
            <div className="text-lg font-bold">{GARA.name}</div>
            <div>{GARA.address}</div>
            <div>ĐT: {GARA.phone}</div>
          </div>
          <h1 className="text-center text-xl font-bold my-3">{done ? "PHIẾU SỬA CHỮA VÀ THANH TOÁN" : "BÁO GIÁ SỬA CHỮA"}</h1>
          {cancelled && <div className="border-2 border-red-600 text-red-700 p-2 mb-3 font-bold text-center">PHIẾU ĐÃ HỦY — Lý do: {order.huy_ly_do}</div>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
            {info.map(([k, v]) => (
              <div key={k} className={WIDE.includes(k) ? "col-span-2" : ""}>{k}: <b>{v}</b></div>
            ))}
          </div>
          {(kts.length > 0 || order.kt_bo_qua_ly_do) && (
            <div className="border border-black p-2 mb-3" style={{ breakInside: "avoid" }}>
              <div className="font-bold">Kết quả kiểm tra sau sửa</div>
              {kts.map((k) => (
                <div key={k.ten} className="pl-3">• {k.ten}: <b>{k.ket_qua === "dat" ? "Đạt" : k.ket_qua === "khong_dat" ? "Không đạt" : "Chưa kiểm tra"}</b>{k.ghi_chu ? ` (${k.ghi_chu})` : ""}</div>
              ))}
              {lastKt && <div className="text-xs">Người kiểm tra: {lastKt.nguoi_kt_ten ?? ""} · {fmt(lastKt.kt_luc!)}</div>}
              {order.kt_bo_qua_ly_do && <div className="text-xs">Bỏ qua kiểm tra, lý do: {order.kt_bo_qua_ly_do}</div>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 print:bg-transparent">
                  {["STT", "Nội dung", "SL", "ĐVT", "Đơn giá", "Thành tiền"].map((h, k) => (
                    <th key={h} className={`border border-black px-2 py-1 ${k > 1 && k !== 3 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((it, n) => (
                  <tr key={it.id}>
                    <td className="border border-black px-2 py-1">{n + 1}</td>
                    <td className="border border-black px-2 py-1">{it.name}{it.kind === "labor" ? " (công)" : ""}</td>
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{qtyText(it.qty)}</td>
                    <td className="border border-black px-2 py-1 whitespace-nowrap">{it.kind === "part" ? it.don_vi ?? "cái" : ""}</td>
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(it.unit_price)}</td>
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(lineTotal(it))}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td colSpan={5} className="border border-black px-2 py-1 text-right">Tổng cộng</td>
                  <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(total)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="border border-black px-2 py-1 text-right">Đã thanh toán</td>
                  <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(paid)}</td>
                </tr>
                <tr className={remain > 0 ? "font-black text-base" : "font-bold"}>
                  <td colSpan={5} className={`border border-black px-2 py-1 text-right ${remain > 0 ? "border-2" : ""}`}>{remain > 0 ? "CÒN LẠI" : remain < 0 ? "Thu dư" : "Còn lại"}</td>
                  <td className={`border border-black px-2 py-1 text-right whitespace-nowrap ${remain > 0 ? "border-2" : ""}`}>{money(Math.abs(remain))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {total > 0 && remain <= 0 && <div className="mt-2 text-center font-bold">Đã thanh toán đủ</div>}
          {livePays.length > 0 && (
            <div className="mt-2" style={{ breakInside: "avoid" }}>
              <div className="font-bold">Các lần thanh toán</div>
              {livePays.map((p) => (
                <div key={p.id} className="flex justify-between border-b border-dotted border-black">
                  <span>{p.ngay_thu.split("-").reverse().join("/")} · {p.hinh_thuc}{LOAI[p.loai] ? ` (${LOAI[p.loai]})` : ""}</span>
                  <span>{money(p.so_tien)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 text-center mt-6" style={{ breakInside: "avoid" }}>
            <div><b>Khách hàng</b><div className="italic text-xs">(Ký, ghi rõ họ tên)</div><div className="h-20" /></div>
            <div><b>Gara</b><div className="italic text-xs">(Ký, ghi rõ họ tên)</div><div className="h-20" /></div>
          </div>
        </div>
      )}
    </div>
  );
}
