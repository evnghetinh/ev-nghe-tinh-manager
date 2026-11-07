"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { GARA } from "@/lib/gara";

type Item = { id: string; kind: "part" | "labor"; name: string; qty: number; unit_price: number };
type Order = { code: number; odometer: number | null; issue: string; created_at: string; vehicles: { plate: string } | null; customers: { name: string; phone: string | null; address: string | null } | null };

export default function PrintQuote() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [size, setSize] = useState<"A4" | "A5">("A5");

  useEffect(() => {
    (async () => {
      // Chỉ lấy giá bán, không đụng tới giá nhập/lợi nhuận.
      const o = await supabase.from("repair_orders").select("code, odometer, issue, created_at, vehicles(plate), customers(name, phone, address)").eq("id", id).single();
      const i = await supabase.from("repair_items").select("id, kind, name, qty, unit_price").eq("order_id", id).order("created_at");
      if (o.error) setError(o.error.message); else setOrder(o.data as unknown as Order);
      if (i.data) setItems(i.data as Item[]);
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
