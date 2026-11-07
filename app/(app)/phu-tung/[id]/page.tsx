"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { money, money2, digits, qtyText, decimalInput, toNum, tonText, COT_PHU_TUNG, type DonVi } from "@/lib/format";
import { useRole } from "@/lib/role";

type Part = { id: string; name: string; code: string | null; sale_price: number; stock: number } & DonVi;
type Row = { id: string; don_vi: string; loai: string; so_luong: number; ton_sau: number; order_id: string | null; order_code: number | null; import_id: string | null; created_by_name: string | null; ghi_chu: string | null; created_at: string };

const LOAI: Record<string, string> = {
  ton_dau: "Tồn đầu kỳ", nhap_hang: "Nhập hàng", xuat_phieu: "Xuất cho phiếu", them_khi_sua: "Thêm khi sửa phiếu",
  xoa_khi_sua: "Xóa khi sửa phiếu", khach_tra: "Khách trả hàng", kiem_ke: "Kiểm kê điều chỉnh", huy_nhap_hang: "Hủy nhập hàng", doi_don_vi: "Đổi đơn vị",
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
  const [dv, setDv] = useState({ nhap: "", ban: "", heso: "", gia: null as string | null });

  const load = useCallback(async () => {
    const p = await supabase.from("parts").select(COT_PHU_TUNG).eq("id", id).maybeSingle();
    if (p.error) return setError(p.error.message);
    if (!p.data) return setError("Không tìm thấy phụ tùng.");
    { const d = p.data as Part; setPart({ ...d, stock: Number(d.stock), he_so: Number(d.he_so) }); }
    const l = await supabase.from("stock_ledger")
      .select("id, don_vi, loai, so_luong, ton_sau, order_id, order_code, import_id, created_by_name, ghi_chu, created_at")
      .eq("part_id", id).order("seq", { ascending: false }).limit(500);
    if (l.error) return setError("Không tải được sổ kho (đã chạy giai-doan-13.sql chưa?): " + l.error.message);
    setRows((l.data as Row[]).map((x) => ({ ...x, so_luong: Number(x.so_luong), ton_sau: Number(x.ton_sau) })));
    if (isOwner) {
      const c = await supabase.from("part_costs").select("cost_price").eq("part_id", id).maybeSingle();
      setCost(c.data ? Number(c.data.cost_price) : 0);
    }
  }, [id, isOwner]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const counted = count === "" ? null : toNum(count);
  const diff = part && counted !== null && !Number.isNaN(counted) ? Math.round((counted - part.stock) * 1000) / 1000 : null;

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    if (!part || diff === null || counted === null) return;
    setError(""); setNotice("");
    if (diff === 0) return setError("Số đếm bằng tồn hiện tại, không có gì để điều chỉnh.");
    if (!reason.trim()) return setError("Bắt buộc nhập lý do điều chỉnh.");
    if (!confirm(`Điều chỉnh tồn "${part.name}" từ ${qtyText(part.stock)} thành ${qtyText(counted)} ${part.don_vi_ban} (${diff > 0 ? "+" : ""}${qtyText(diff)})? Không xóa được khỏi sổ kho.`)) return;
    setBusy(true);
    const r = await supabase.rpc("kiem_ke", { p_part: part.id, p_dem: counted, p_ton_thay: part.stock, p_ly_do: reason });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã điều chỉnh: ${qtyText(part.stock)} → ${qtyText(counted)} ${part.don_vi_ban}.`);
    setCount(""); setReason(""); load();
  }

  const heMoi = toNum(dv.heso);
  const giaGoiY = part && heMoi > 0 ? String(Math.round(part.sale_price / heMoi)) : "";
  const giaMoi = dv.gia ?? giaGoiY;
  async function changeUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!part) return;
    setError(""); setNotice("");
    if (!dv.nhap.trim() || !dv.ban.trim()) return setError("Hãy nhập tên đơn vị nhập và đơn vị bán mới.");
    if (!(heMoi > 0)) return setError("Hệ số phải lớn hơn 0.");
    if (giaMoi === "") return setError("Hãy nhập giá bán mới.");
    const tonMoi = Math.round(part.stock * heMoi * 1000) / 1000;
    if (!confirm(`Đổi đơn vị "${part.name}": 1 ${part.don_vi_ban} = ${qtyText(heMoi)} ${dv.ban.trim()}.\nTồn ${qtyText(part.stock)} ${part.don_vi_ban} → ${qtyText(tonMoi)} ${dv.ban.trim()}. Giá bán mới ${money(Number(giaMoi))}/${dv.ban.trim()}. Giá vốn sẽ chia ${qtyText(heMoi)}.\nPhiếu cũ giữ nguyên. Không hoàn tác được.`)) return;
    setBusy(true);
    const r = await supabase.rpc("doi_don_vi", { p_part: part.id, p_don_vi_nhap: dv.nhap, p_don_vi_ban: dv.ban, p_he_so: heMoi, p_gia_ban: Number(giaMoi), p_ton_thay: part.stock });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setNotice(`Đã đổi đơn vị: tồn ${qtyText(part.stock)} ${part.don_vi_ban} → ${qtyText(tonMoi)} ${dv.ban.trim()}.`);
    setDv({ nhap: "", ban: "", heso: "", gia: null }); load();
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
            <span className="text-xl font-bold text-right">{tonText(part.stock, part)}</span>
          </div>
          <div className="flex gap-2">{tabBtn("log", "Lịch sử nhập xuất")}{tabBtn("info", "Thông tin")}</div>

          {tab === "info" && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow p-4 text-sm space-y-1">
                <div>Giá bán: <b>{money(part.sale_price)}/{part.don_vi_ban}</b></div>
                {isOwner && cost !== null && <div>Giá vốn: <b>{money2(cost)}/{part.don_vi_ban}</b></div>}
                <div>Đơn vị nhập: <b>{part.don_vi_nhap}</b> · Đơn vị bán/trừ kho: <b>{part.don_vi_ban}</b>{part.he_so !== 1 ? <> · 1 {part.don_vi_nhap} = <b>{qtyText(part.he_so)} {part.don_vi_ban}</b></> : null}</div>
              </div>
              {isOwner && (
                <form onSubmit={adjust} className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="font-bold">Kiểm kê điều chỉnh</h2>
                  <label className="block space-y-1"><span className="text-xs text-slate-500">Số đếm thực tế (tính theo {part.don_vi_ban})</span>
                    <input inputMode="decimal" className={input} value={count} onChange={(e) => setCount(decimalInput(e.target.value))} /></label>
                  {diff !== null && (
                    <p className={`text-sm ${diff === 0 ? "text-slate-500" : diff > 0 ? "text-green-700" : "text-red-600"}`}>
                      Tồn hiện tại {qtyText(part.stock)} → thực tế {qtyText(counted ?? 0)} {part.don_vi_ban}: chênh lệch <b>{diff > 0 ? "+" : ""}{qtyText(diff)}</b>
                    </p>
                  )}
                  <label className="block space-y-1"><span className="text-xs text-slate-500">Lý do (bắt buộc)</span>
                    <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: đếm lại kho cuối tháng, hàng hỏng..." /></label>
                  <button disabled={busy || diff === null || diff === 0} className="bg-amber-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Ghi điều chỉnh</button>
                </form>
              )}
              {isOwner && (
                <form onSubmit={changeUnit} className="bg-white rounded-xl shadow p-4 space-y-3">
                  <h2 className="font-bold">Đổi đơn vị</h2>
                  <p className="text-xs text-slate-500">Ví dụ dầu đang tính theo &quot;can&quot; muốn bán theo lít: đơn vị nhập = can, đơn vị bán = lít, hệ số = 5 (1 {part.don_vi_ban} hiện tại = 5 đơn vị bán mới). App nhân tồn theo hệ số, chia giá vốn, ghi 1 dòng &quot;Đổi đơn vị&quot; vào sổ kho. Phiếu cũ giữ nguyên.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1"><span className="text-xs text-slate-500">Đơn vị nhập mới</span>
                      <input className={input} placeholder="can" value={dv.nhap} onChange={(e) => setDv({ ...dv, nhap: e.target.value })} /></label>
                    <label className="space-y-1"><span className="text-xs text-slate-500">Đơn vị bán mới</span>
                      <input className={input} placeholder="lít" value={dv.ban} onChange={(e) => setDv({ ...dv, ban: e.target.value })} /></label>
                    <label className="space-y-1"><span className="text-xs text-slate-500">Hệ số: 1 {part.don_vi_ban} = ? {dv.ban || "đơn vị bán mới"}</span>
                      <input inputMode="decimal" className={input} placeholder="5" value={dv.heso} onChange={(e) => setDv({ ...dv, heso: decimalInput(e.target.value) })} /></label>
                    <label className="space-y-1"><span className="text-xs text-slate-500">Giá bán mới mỗi {dv.ban || "đơn vị"} (đ)</span>
                      <input inputMode="numeric" className={input} value={giaMoi} onChange={(e) => setDv({ ...dv, gia: digits(e.target.value) })} /></label>
                  </div>
                  {heMoi > 0 && (
                    <p className="text-sm text-slate-700">
                      Tồn {qtyText(part.stock)} {part.don_vi_ban} → <b>{qtyText(Math.round(part.stock * heMoi * 1000) / 1000)} {dv.ban || "đơn vị bán mới"}</b>
                      {cost !== null ? <> · Giá vốn {money2(cost)} → <b>{money2(cost / heMoi)}</b>/{dv.ban || "đv"}</> : null}
                    </p>
                  )}
                  <button disabled={busy || !(heMoi > 0) || !dv.nhap.trim() || !dv.ban.trim()} className="bg-amber-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Đổi đơn vị</button>
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
                    <b className={r.so_luong > 0 ? "text-green-700" : "text-red-600"}>{r.so_luong > 0 ? "+" : ""}{qtyText(r.so_luong)} {r.don_vi}</b>
                  </div>
                  <div className="text-slate-600">Tồn sau: {qtyText(r.ton_sau)} {r.don_vi}</div>
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
