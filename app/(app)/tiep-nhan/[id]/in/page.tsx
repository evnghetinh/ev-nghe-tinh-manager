"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { GARA } from "@/lib/gara";

type Item = { id: string; kind: "part" | "labor"; name: string; qty: number; unit_price: number };
type Dtc = { ma: string; ghi_chu: string | null; sau_sua: string | null };
type Kt = { ten: string; ket_qua: "dat" | "khong_dat" | null; ghi_chu: string | null; nguoi_kt_ten: string | null; kt_luc: string | null };
type Order = { soc_nhan: number | null; soh_nhan: number | null; pin_ghi_chu: string | null; nguyen_nhan: string | null; tiep_nhan_ten: string | null; kt_bo_qua_ly_do: string | null; code: number; odometer: number | null; issue: string; created_at: string; vehicles: { plate: string } | null; customers: { name: string; phone: string | null; address: string | null } | null };

export default function PrintQuote() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [ktv, setKtv] = useState<string[]>([]);
  const [dtcs, setDtcs] = useState<Dtc[]>([]);
  const [kts, setKts] = useState<Kt[]>([]);
  const [size, setSize] = useState<"A4" | "A5">("A5");

  useEffect(() => {
    (async () => {
      // Chỉ lấy giá bán, không đụng tới giá nhập/lợi nhuận.
      const o = await supabase.from("repair_orders").select("soc_nhan, soh_nhan, pin_ghi_chu, nguyen_nhan, tiep_nhan_ten, kt_bo_qua_ly_do, code, odometer, issue, created_at, vehicles(plate), customers(name, phone, address)").eq("id", id).single();
      const i = await supabase.rpc("dong_bao_gia", { p_order: id });
      const [t, d, k] = await Promise.all([
        supabase.from("ev_phieu_ky_thuat_vien").select("ev_ky_thuat_vien(ten)").eq("order_id", id),
        supabase.from("ev_ma_loi").select("ma, ghi_chu, sau_sua").eq("order_id", id).order("created_at"),
        supabase.from("ev_kt_phieu").select("ten, ket_qua, ghi_chu, nguoi_kt_ten, kt_luc").eq("order_id", id).order("thu_tu").order("ten"),
      ]);
      type T = { ev_ky_thuat_vien: { ten: string } | { ten: string }[] | null };
      if (t.data) setKtv((t.data as unknown as T[]).flatMap((x) => (Array.isArray(x.ev_ky_thuat_vien) ? x.ev_ky_thuat_vien : x.ev_ky_thuat_vien ? [x.ev_ky_thuat_vien] : []).map((y) => y.ten)));
      if (d.data) setDtcs(d.data as Dtc[]);
      if (k.data) setKts(k.data as Kt[]);
      if (o.error) setError(o.error.message); else setOrder(o.data as unknown as Order);
      if (i.error) setError(i.error.message); else if (i.data) setItems((i.data as Item[]).map((x) => ({ ...x, qty: Number(x.qty), unit_price: Number(x.unit_price) })));
    })();
  }, [id]);

  const total = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const date = order ? new Date(order.created_at).toLocaleDateString("vi-VN") : "";
  const rows = [...items.filter((i) => i.kind === "part"), ...items.filter((i) => i.kind === "labor")];

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
      {order && (
        <div className="bg-white text-black max-w-[210mm] mx-auto p-4 sm:p-6 shadow print:shadow-none print:p-0 text-sm">
          <div className="text-center border-b pb-2">
            <div className="text-lg font-bold">{GARA.name}</div>
            <div>{GARA.address}</div>
            <div>ĐT: {GARA.phone}</div>
          </div>
          <h1 className="text-center text-xl font-bold my-3">BÁO GIÁ SỬA CHỮA</h1>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
            <div>Mã phiếu: <b>PT{String(order.code).padStart(4, "0")}</b></div>
            <div>Ngày: <b>{date}</b></div>
            <div>Khách hàng: <b>{order.customers?.name}</b></div>
            <div>Điện thoại: <b>{order.customers?.phone ?? ""}</b></div>
            <div className="col-span-2">Địa chỉ: <b>{order.customers?.address ?? ""}</b></div>
            <div>Biển số xe: <b>{order.vehicles?.plate}</b></div>
            <div>Số km đã đi: <b>{order.odometer != null ? `${new Intl.NumberFormat("vi-VN").format(order.odometer)} km` : ""}</b></div>
            <div className="col-span-2">Nội dung: {order.issue}</div>
          </div>
          <div className="border border-black p-2 mb-3 space-y-1" style={{ breakInside: "avoid" }}>
            <div className="font-bold">Thông tin xe điện</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>Nhân viên tiếp nhận: <b>{order.tiep_nhan_ten ?? ""}</b></div>
              <div>Kỹ thuật viên: <b>{ktv.join(", ")}</b></div>
              <div>SOC lúc nhận: <b>{order.soc_nhan != null ? `${order.soc_nhan}%` : ""}</b></div>
              <div>SOH pin: <b>{order.soh_nhan != null ? `${order.soh_nhan}%` : ""}</b></div>
              <div className="col-span-2">Tình trạng pin: {order.pin_ghi_chu ?? ""}</div>
              <div className="col-span-2">Nguyên nhân hư hỏng: {order.nguyen_nhan ?? ""}</div>
            </div>
            <div>
              Mã lỗi DTC: {dtcs.length === 0 ? "không có" : dtcs.map((d) => `${d.ma}${d.ghi_chu ? ` (${d.ghi_chu})` : ""}${d.sau_sua ? ` – sau sửa: ${d.sau_sua === "da_xoa" ? "đã xóa" : "còn"}` : ""}`).join("; ")}
            </div>
            <div>
              Kiểm tra sau sửa:{kts.length === 0 && " chưa có"}
              {kts.map((k) => (
                <div key={k.ten} className="pl-3">• {k.ten}: <b>{k.ket_qua === "dat" ? "Đạt" : k.ket_qua === "khong_dat" ? "Không đạt" : "Chưa kiểm tra"}</b>{k.ghi_chu ? ` (${k.ghi_chu})` : ""}</div>
              ))}
              {kts.some((k) => k.kt_luc) && (() => { const l = kts.filter((k) => k.kt_luc).sort((a, b) => (a.kt_luc! < b.kt_luc! ? 1 : -1))[0]; return <div className="text-xs">Người kiểm tra: {l.nguoi_kt_ten ?? ""} · {new Date(l.kt_luc!).toLocaleString("vi-VN")}</div>; })()}
              {order.kt_bo_qua_ly_do && <div className="text-xs">Bỏ qua kiểm tra, lý do: {order.kt_bo_qua_ly_do}</div>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 print:bg-transparent">
                  {["STT", "Nội dung", "SL", "Đơn giá", "Thành tiền"].map((h, k) => (
                    <th key={h} className={`border border-black px-2 py-1 ${k > 1 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((it, n) => (
                  <tr key={it.id}>
                    <td className="border border-black px-2 py-1">{n + 1}</td>
                    <td className="border border-black px-2 py-1">{it.name}{it.kind === "labor" ? " (công)" : ""}</td>
                    <td className="border border-black px-2 py-1 text-right">{it.qty}</td>
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(it.unit_price)}</td>
                    <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(it.qty * it.unit_price)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td colSpan={4} className="border border-black px-2 py-1 text-right">Tổng cộng</td>
                  <td className="border border-black px-2 py-1 text-right whitespace-nowrap">{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 text-center mt-6" style={{ breakInside: "avoid" }}>
            <div><b>Khách hàng</b><div className="italic text-xs">(Ký, ghi rõ họ tên)</div><div className="h-20" /></div>
            <div><b>Gara</b><div className="italic text-xs">(Ký, ghi rõ họ tên)</div><div className="h-20" /></div>
          </div>
        </div>
      )}
    </div>
  );
}
