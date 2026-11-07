"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";
import { useRole } from "@/lib/role";

type Part = { id: string; name: string; code: string | null; sale_price: number; stock: number };
type Row = { id: string; loai: string; so_luong: number; ton_sau: number; order_id: string | null; order_code: number | null; import_id: string | null; created_by_name: string | null; ghi_chu: string | null; created_at: string };

const LOAI: Record<string, string> = {
  ton_dau: "Tồn đầu kỳ", nhap_hang: "Nhập hàng", xuat_phieu: "Xuất cho phiếu", them_khi_sua: "Thêm khi sửa phiếu",
  xoa_khi_sua: "Xóa khi sửa phiếu", khach_tra: "Khách trả hàng", kiem_ke: "Kiểm kê điều chỉnh",
};

export default function PartDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isOwner = useRole() === "chu";
  const [tab, setTab] = useState<"info" | "log">("log");
  const [part, setPart] = useState<Part | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const p = await supabase.from("parts").select("id, name, code, sale_price, stock").eq("id", id).maybeSingle();
    if (p.error) return setError(p.error.message);
    if (!p.data) return setError("Không tìm thấy phụ tùng.");
    setPart(p.data as Part);
    const l = await supabase.from("stock_ledger")
      .select("id, loai, so_luong, ton_sau, order_id, order_code, import_id, created_by_name, ghi_chu, created_at")
      .eq("part_id", id).order("seq", { ascending: false }).limit(500);
    if (l.error) return setError("Không tải được sổ kho (đã chạy giai-doan-13.sql chưa?): " + l.error.message);
    setRows(l.data as Row[]);
    if (isOwner) {
      const c = await supabase.from("part_costs").select("cost_price").eq("part_id", id).maybeSingle();
      setCost(c.data ? Number(c.data.cost_price) : 0);
    }
  }, [id, isOwner]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const counted = count === "" ? null : Number(count);
  const diff = part && counted !== null && !Number.isNaN(counted) ? counted - part.stock : null;

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    if (!part || diff === null || counted === null) return;
    setError(""); setNotice("");
    if (diff === 0) return setError("Số đếm bằng tồn hiện tại, không có gì để điều chỉnh.");
    if (!reason.trim()) return setError("Bắt buộc nhập lý do điều chỉnh.");
    if (!confirm(`Điều chỉnh tồn "${part.name}" từ ${part.stock} thành ${counted} (${diff > 0 ? "+" : ""}${diff})? Không xóa được khỏi sổ kho.`)) return;
    setBusy(true);
    const r = await supabase.rpc("kiem_ke", { p_part: part.id, p_dem: counted, p_ton_thay: part.stock, p_ly_do: reason });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã điều chỉnh: ${part.stock} → ${counted}.`);
    setCount(""); setReason(""); load();
  }

  function open(r: Row) {
    if (r.order_id) router.push(`/tiep-nhan/${r.order_id}`);
    else if (r.import_id && isOwner) router.push(`/nhap-hang?mo=${r.import_id}`);
  }
  const clickable = (r: Row) => !!r.order_id || (!!r.import_id && isOwner);

  const input = "w-full border rounded-lg px-3 py-2";
  const tabBtn = (t: "info" | "log", label: string) => (
    <button onClick={() => setTab(t)} className={`flex-1 px-3 py-2 rounded-lg text-sm ${tab === t ? "bg-green-600 text-white" : "bg-white border"}`}>{label}</button>
  );

  return (
    <div className="space-y-4">
      <Link href="/phu-tung" className="text-sm text-blue-600">← Phụ tùng</Link>
      <h1 className="text-xl font-bold">{part ? <>{part.name}{part.code ? <span className="text-slate-500 font-normal"> · {part.code}</span> : null}</> : "Phụ tùng"}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}
      {part && (
        <>
          <div className="bg-white rounded-xl shadow p-4 flex justify-between items-center">
            <span className="text-slate-600">Tồn hiện tại</span>
            <span className="text-2xl font-bold">{part.stock}</span>
          </div>
          <div className="flex gap-2">{tabBtn("log", "Lịch sử nhập xuất")}{tabBtn("info", "Thông tin")}</div>

          {tab === "info" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow p-4 text-sm space-y-1">
                <div>Giá bán: <b>{money(part.sale_price)}</b></div>
                {isOwner && cost !== null && <div>Giá nhập: <b>{money(cost)}</b></div>}
              </div>
              {isOwner && (
                <form onSubmit={adjust} className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="font-bold">Kiểm kê điều chỉnh</h2>
                  <label className="block space-y-1"><span className="text-xs text-slate-500">Số đếm thực tế</span>
                    <input inputMode="decimal" className={input} value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d.]/g, ""))} /></label>
                  {diff !== null && (
                    <p className={`text-sm ${diff === 0 ? "text-slate-500" : diff > 0 ? "text-green-700" : "text-red-600"}`}>
                      Tồn hiện tại {part.stock} → thực tế {counted}: chênh lệch <b>{diff > 0 ? "+" : ""}{diff}</b>
                    </p>
                  )}
                  <label className="block space-y-1"><span className="text-xs text-slate-500">Lý do (bắt buộc)</span>
                    <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: đếm lại kho cuối tháng, hàng hỏng..." /></label>
                  <button disabled={busy || diff === null || diff === 0} className="bg-amber-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Ghi điều chỉnh</button>
                </form>
              )}
            </div>
          )}

          {tab === "log" && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} onClick={() => clickable(r) && open(r)}
                  className={`bg-white rounded-xl shadow p-3 text-sm space-y-1 ${clickable(r) ? "cursor-pointer active:bg-slate-50" : ""}`}>
                  <div className="flex justify-between gap-2">
                    <b>{LOAI[r.loai] ?? r.loai}{r.order_code ? ` · phiếu #${r.order_code}` : ""}{r.import_id ? " · lần nhập" : ""}</b>
                    <b className={r.so_luong > 0 ? "text-green-700" : "text-red-600"}>{r.so_luong > 0 ? "+" : ""}{r.so_luong}</b>
                  </div>
                  <div className="text-slate-600">Tồn sau: {r.ton_sau}</div>
                  <div className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString("vi-VN")} · {r.created_by_name ?? "Không rõ"}</div>
                  {r.ghi_chu && <div className="text-slate-700">{r.ghi_chu}</div>}
                  {clickable(r) && <div className="text-xs text-blue-600">Bấm để mở {r.order_id ? "phiếu" : "lần nhập"} →</div>}
                </li>
              ))}
              {rows.length === 0 && <li className="text-slate-500 text-sm">Chưa có dòng nào trong sổ kho.</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
