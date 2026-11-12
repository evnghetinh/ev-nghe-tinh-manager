"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money, qtyText, tenXe } from "@/lib/format";
import { GARA } from "@/lib/gara";
import { toTot, vatText, type Tot } from "../giam-vat";

type Item = { id: string; kind: "part" | "labor"; name: string; qty: number; unit_price: number; don_vi: string | null; thanh_tien: number; giam_tien: number; sau_giam: number };
type Dtc = { ma: string; ghi_chu: string | null; sau_sua: string | null };
type Kt = { ten: string; ket_qua: "dat" | "khong_dat" | null; ghi_chu: string | null; nguoi_kt_ten: string | null; kt_luc: string | null };
type Pay = { id: string; loai: string; so_tien: number; hinh_thuc: string; ngay_thu: string; da_huy: boolean };
type Order = { vat_suat: number; vat_che_do: "chua" | "da"; stock_deducted: boolean; da_huy: boolean; huy_ly_do: string | null; received_at: string | null; soc_nhan: number | null; soh_nhan: number | null; pin_ghi_chu: string | null; nguyen_nhan: string | null; tiep_nhan_ten: string | null; kt_bo_qua_ly_do: string | null; code: number; odometer: number | null; issue: string; created_at: string; vehicles: { plate: string; vin: string | null; vehicle_type: string | null; hang_xe: string | null; dong_xe: string | null; nam_san_xuat: number | null; mau_xe: string | null } | null; customers: { name: string; phone: string | null; address: string | null } | null };

export default function PrintQuote() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [tot, setTot] = useState<Tot | null>(null);
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
      const o = await supabase.from("repair_orders").select("vat_suat, vat_che_do, stock_deducted, da_huy, huy_ly_do, received_at, soc_nhan, soh_nhan, pin_ghi_chu, nguyen_nhan, tiep_nhan_ten, kt_bo_qua_ly_do, code, odometer, issue, created_at, vehicles(plate, vin, vehicle_type, hang_xe, dong_xe, nam_san_xuat, mau_xe), customers(name, phone, address)").eq("id", id).single();
      const i = await supabase.rpc("dong_bao_gia", { p_order: id });
      const [t, d, k, pm, tt] = await Promise.all([
        supabase.from("ev_phieu_ky_thuat_vien").select("ev_ky_thuat_vien(ten)").eq("order_id", id),
        supabase.from("ev_ma_loi").select("ma, ghi_chu, sau_sua").eq("order_id", id).order("created_at"),
        supabase.from("ev_kt_phieu").select("ten, ket_qua, ghi_chu, nguoi_kt_ten, kt_luc").eq("order_id", id).order("thu_tu").order("ten"),
        supabase.from("order_payments").select("id, loai, so_tien, hinh_thuc, ngay_thu, da_huy").eq("order_id", id).order("seq"),
        supabase.rpc("tinh_tong_phieu", { p_order: id }), // tổng do máy chủ tính - cùng hàm với công nợ
      ]);
      if (!alive) return;
      type T = { ev_ky_thuat_vien: { ten: string } | { ten: string }[] | null };
      setKtv(t.data ? (t.data as unknown as T[]).flatMap((x) => (Array.isArray(x.ev_ky_thuat_vien) ? x.ev_ky_thuat_vien : x.ev_ky_thuat_vien ? [x.ev_ky_thuat_vien] : []).map((y) => y.ten)) : []);
      setDtcs((d.data as Dtc[]) ?? []);
      setKts((k.data as Kt[]) ?? []);
      setPays(((pm.data as Pay[]) ?? []).map((x) => ({ ...x, so_tien: Number(x.so_tien) })));
      const trow = (tt.data as Record<string, unknown>[] | null)?.[0];
      setTot(trow ? toTot(trow) : null);
      if (o.error) setError(o.error.message + " (đã chạy giai-doan-31.sql chưa?)"); else { setError(""); const d0 = o.data as unknown as Order; setOrder({ ...d0, vat_suat: Number(d0.vat_suat) }); }
      if (tt.error) setError(tt.error.message + " (đã chạy giai-doan-31.sql chưa?)");
      if (i.error) setError(i.error.message + " (đã chạy giai-doan-31.sql chưa?)"); else if (i.data) setItems((i.data as Item[]).map((x) => ({ ...x, qty: Number(x.qty), unit_price: Number(x.unit_price), thanh_tien: Number(x.thanh_tien), giam_tien: Number(x.giam_tien), sau_giam: Number(x.sau_giam) })));
    }
    load();
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) load(); };
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; window.removeEventListener("pageshow", onShow); document.removeEventListener("visibilitychange", onVis); };
  }, [id]);

  // Số in ra = số trong phiếu: lấy nguyên từ hàm tinh_tong_phieu, không tự cộng lại
  const total = tot?.tong_thanh_toan ?? 0;
  const livePays = pays.filter((p) => !p.da_huy);
  const paid = livePays.reduce((s, p) => s + p.so_tien, 0);
  const remain = Math.round(total - paid);
  const coGiam = (tot?.giam_gia ?? 0) > 0;
  const coVat = (tot?.vat ?? 0) > 0 || Number(order?.vat_suat ?? 0) > 0;
  const vatDa = order?.vat_che_do === "da";
  // Tự kiểm tra: các dòng in ra cộng lại phải khớp tổng từ máy chủ, và tổng cộng từ các dòng tổng phải đúng
  const dongSau = items.reduce((s, i) => s + i.sau_giam, 0);
  const soKiemTra = tot ? tot.tam_tinh - tot.giam_dong : 0;
  const tongTuDong = tot ? tot.tien_hang + (vatDa ? 0 : tot.vat) : 0;
  const mismatch = order != null && tot != null && (dongSau !== soKiemTra || tongTuDong !== tot.tong_thanh_toan || tot.tam_tinh - tot.giam_gia !== tot.tien_hang);
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
      {mismatch && <p className="print:hidden bg-red-600 text-white font-bold rounded-lg p-3 mb-3">CẢNH BÁO: các dòng in ra cộng lại ({money(dongSau)}) không khớp tổng phiếu. Đừng in, hãy tải lại trang và kiểm tra phiếu (Công nợ khách → Đối chiếu tổng phiếu).</p>}
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
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">
                      {it.giam_tien > 0 && <div className="text-xs line-through">{money(it.thanh_tien)}</div>}
                      {money(it.sau_giam)}
                    </td>
                  </tr>
                ))}
                {!coGiam && !coVat ? (
                  <tr className="font-bold">
                    <td colSpan={5} className="border border-black px-2 py-1 text-right">Tổng cộng</td>
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(total)}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td colSpan={5} className="border border-black px-2 py-1 text-right">Tạm tính</td>
                      <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(tot?.tam_tinh ?? 0)}</td>
                    </tr>
                    {coGiam && (
                      <tr>
                        <td colSpan={5} className="border border-black px-2 py-1 text-right">Giảm giá</td>
                        <td className="border border-black px-2 py-1 text-right whitespace-nowrap">−{money(tot?.giam_gia ?? 0)}</td>
                      </tr>
                    )}
                    {coGiam && (
                      <tr>
                        <td colSpan={5} className="border border-black px-2 py-1 text-right">Tiền hàng sau giảm</td>
                        <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(tot?.tien_hang ?? 0)}</td>
                      </tr>
                    )}
                    {coVat && (
                      <tr>
                        <td colSpan={5} className="border border-black px-2 py-1 text-right">{vatDa ? "Trong đó VAT" : "VAT"} ({vatText(Number(order?.vat_suat ?? 0), order?.vat_che_do ?? "chua")})</td>
                        <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(tot?.vat ?? 0)}</td>
                      </tr>
                    )}
                    <tr className="font-bold">
                      <td colSpan={5} className="border border-black px-2 py-1 text-right">Tổng thanh toán</td>
                      <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(total)}</td>
                    </tr>
                  </>
                )}
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
