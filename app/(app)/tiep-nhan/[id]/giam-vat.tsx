"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { money, decimalInput, digits, toNum } from "@/lib/format";

export type Kieu = "pt" | "tien";
export type GvItem = { id: string; name: string; thanh_tien: number; giam_kieu: Kieu; giam_gia_tri: number };
export type GvOrder = { giam_kieu: Kieu; giam_gia_tri: number; giam_ly_do: string | null; vat_suat: number; vat_che_do: "chua" | "da" };
export type GvCfg = { giam_toi_da_nv: number; vat_suat_ds: number[] };
// Các dòng tổng do hàm tinh_tong_phieu (giai đoạn 31) trả về - nguồn số duy nhất
export type Tot = { tam_tinh: number; giam_dong: number; giam_phieu: number; giam_gia: number; tien_hang: number; vat: number; tong_thanh_toan: number; doanh_thu: number };
export const toTot = (r: Record<string, unknown>): Tot => ({
  tam_tinh: Number(r.tam_tinh), giam_dong: Number(r.giam_dong), giam_phieu: Number(r.giam_phieu), giam_gia: Number(r.giam_gia),
  tien_hang: Number(r.tien_hang), vat: Number(r.vat), tong_thanh_toan: Number(r.tong_thanh_toan), doanh_thu: Number(r.doanh_thu),
});
export const vatText = (suat: number, che: "chua" | "da") => `${String(suat).replace(".", ",")}%${che === "da" ? " đã gồm trong giá" : ""}`;
export const giamText = (kieu: Kieu, v: number) => (kieu === "pt" ? `${String(v).replace(".", ",")}%` : money(v));

const input = "w-full border px-3 py-2";
const sel = (k: Kieu, v: string) => (k === "tien" ? digits(v) : decimalInput(v, 2));
const toN = (k: Kieu, v: string) => (k === "tien" ? Number(digits(v) || 0) : toNum(v || "0") || 0);
const start = (v: number) => (v ? String(v).replace(".", ",") : "");

export default function GiamVat({ orderId, items, order, cfg, isOwner, done, onSaved, onError }: {
  orderId: string; items: GvItem[]; order: GvOrder; cfg: GvCfg; isOwner: boolean; done: boolean;
  onSaved: (d: { truoc: number; sau: number; doi: boolean }) => void; onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Record<string, { k: Kieu; v: string }>>(
    () => Object.fromEntries(items.map((i) => [i.id, { k: i.giam_kieu, v: start(i.giam_gia_tri) }])));
  const [k, setK] = useState<Kieu>(order.giam_kieu);
  const [v, setV] = useState(start(order.giam_gia_tri));
  const [ly, setLy] = useState(order.giam_ly_do ?? "");
  const [vat, setVat] = useState(String(order.vat_suat));
  const [che, setChe] = useState<"chua" | "da">(order.vat_che_do);
  const [pre, setPre] = useState<Tot | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const dong = items.map((i) => ({ id: i.id, kieu: lines[i.id]?.k ?? "tien", gia_tri: toN(lines[i.id]?.k ?? "tien", lines[i.id]?.v ?? "") }));
  const args = { p_order: orderId, p_giam_kieu: k, p_giam_gia_tri: toN(k, v), p_vat_suat: Number(vat), p_vat_che_do: che, p_dong: dong };
  const key = JSON.stringify(args);

  // Xem trước: dùng đúng hàm tính của máy chủ với giá trị đang nhập (chưa lưu)
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await supabase.rpc("tinh_tong_xem_truoc", args);
      if (my !== seq.current) return;
      const row = (r.data as Record<string, unknown>[] | null)?.[0];
      setPre(r.error || !row ? null : toTot(row));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const hasDiscount = (pre?.giam_gia ?? 0) > 0 || dong.some((d) => d.gia_tri > 0) || toN(k, v) > 0;
  const nvOver = !isOwner && pre != null && pre.tam_tinh > 0 && pre.giam_gia * 100 > pre.tam_tinh * cfg.giam_toi_da_nv + 0.0001;
  const suatList = Array.from(new Set([...cfg.vat_suat_ds, order.vat_suat])).sort((a, b) => a - b);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (done && !ly.trim()) return onError("Hãy nhập lý do sửa giảm giá / VAT của phiếu đã hoàn thành.");
    if (hasDiscount && !ly.trim()) return onError("Hãy nhập lý do giảm giá.");
    setBusy(true);
    const r = await supabase.rpc("phieu_dat_giam_vat", { ...args, p_ly_do: ly.trim() });
    setBusy(false);
    if (r.error) return onError(r.error.message);
    setOpen(false);
    onSaved(r.data as { truoc: number; sau: number; doi: boolean });
  }

  const sumText = [
    order.giam_gia_tri > 0 || items.some((i) => i.giam_gia_tri > 0) ? "có giảm giá" : "chưa giảm giá",
    order.vat_suat > 0 ? `VAT ${vatText(order.vat_suat, order.vat_che_do)}` : "không VAT",
  ].join(" · ");

  if (!open) {
    return (
      <div className="card flex items-center justify-between gap-2">
        <div className="min-w-0"><div className="font-semibold">Giảm giá và VAT</div><div className="text-sm text-slate-500">{sumText}</div></div>
        <button type="button" className="btn-secondary shrink-0" onClick={() => setOpen(true)}>Sửa</button>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="card space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Giảm giá và VAT</h2>
        <button type="button" className="bare text-sm text-slate-600 min-h-11 px-2" onClick={() => setOpen(false)}>Đóng</button>
      </div>
      {!isOwner && <p className="text-sm text-slate-500">Nhân viên được giảm tối đa {String(cfg.giam_toi_da_nv).replace(".", ",")}% tổng tạm tính. Giảm nhiều hơn phải nhờ Chủ xưởng.</p>}
      {done && <p className="text-sm text-amber-800">Phiếu đã hoàn thành: thay đổi sẽ làm công nợ tăng hoặc cần hoàn tiền cho khách, và được ghi nhật ký kèm lý do.</p>}

      <div className="space-y-2">
        <div className="text-sm font-semibold text-navy-900">Giảm giá từng dòng</div>
        <ul className="space-y-2">
          {items.map((i) => {
            const ln = lines[i.id] ?? { k: "tien" as Kieu, v: "" };
            return (
              <li key={i.id} className="border border-slate-200 rounded-xl p-2 space-y-2">
                <div className="flex justify-between gap-2 text-sm"><span className="min-w-0 break-words">{i.name}</span><b className="shrink-0">{money(i.thanh_tien)}</b></div>
                <div className="grid gap-2 grid-cols-[8.5rem_1fr]">
                  <select aria-label={`Kiểu giảm giá dòng ${i.name}`} className={input} value={ln.k}
                    onChange={(e) => setLines({ ...lines, [i.id]: { k: e.target.value as Kieu, v: "" } })}>
                    <option value="tien">Số tiền (đ)</option><option value="pt">Phần trăm (%)</option>
                  </select>
                  <input inputMode="decimal" aria-label={`Giảm giá dòng ${i.name}`} placeholder="0" className={input} value={ln.v}
                    onChange={(e) => setLines({ ...lines, [i.id]: { k: ln.k, v: sel(ln.k, e.target.value) } })} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-navy-900">Giảm giá toàn phiếu</div>
        <div className="grid gap-2 grid-cols-[8.5rem_1fr]">
          <select aria-label="Kiểu giảm giá toàn phiếu" className={input} value={k} onChange={(e) => { setK(e.target.value as Kieu); setV(""); }}>
            <option value="tien">Số tiền (đ)</option><option value="pt">Phần trăm (%)</option>
          </select>
          <input inputMode="decimal" aria-label="Giảm giá toàn phiếu" placeholder="0" className={input} value={v} onChange={(e) => setV(sel(k, e.target.value))} />
        </div>
        <label className="block"><span className="field-label">{done ? "Lý do sửa (bắt buộc)" : "Lý do giảm giá (bắt buộc khi có giảm giá)"}</span>
          <input className={input} maxLength={500} value={ly} onChange={(e) => setLy(e.target.value)} placeholder="Ví dụ: khách quen, xe nhiều lần sửa" />
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-navy-900">Thuế VAT</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="field-label">Thuế suất</span>
            <select className={input} value={vat} onChange={(e) => setVat(e.target.value)}>
              {suatList.map((s) => <option key={s} value={s}>{String(s).replace(".", ",")}%</option>)}
            </select>
          </label>
          <label className="block"><span className="field-label">Cách tính</span>
            <select className={input} value={che} onChange={(e) => setChe(e.target.value as "chua" | "da")}>
              <option value="chua">Giá chưa gồm VAT</option><option value="da">Giá đã gồm VAT</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">VAT tính trên tiền hàng sau giảm giá, làm tròn đến đồng. Doanh thu và lợi nhuận tính trước thuế.</p>
      </div>

      <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1">
        <div className="font-semibold text-navy-900">Xem trước</div>
        {pre ? (
          <>
            <div className="flex justify-between"><span>Tạm tính</span><span>{money(pre.tam_tinh)}</span></div>
            <div className="flex justify-between"><span>Giảm giá</span><span>−{money(pre.giam_gia)}</span></div>
            <div className="flex justify-between"><span>Tiền hàng sau giảm</span><span>{money(pre.tien_hang)}</span></div>
            <div className="flex justify-between"><span>VAT ({vatText(Number(vat), che)})</span><span>{money(pre.vat)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Tổng thanh toán</span><span>{money(pre.tong_thanh_toan)}</span></div>
          </>
        ) : <div className="text-slate-500">Đang tính...</div>}
        {nvOver && <div className="text-red-700 font-medium">Giảm giá vượt ngưỡng nhân viên ({String(cfg.giam_toi_da_nv).replace(".", ",")}%). Hệ thống sẽ không cho lưu.</div>}
      </div>

      <button disabled={busy} className="btn-primary w-full disabled:opacity-50">{busy ? "Đang lưu..." : "Lưu giảm giá và VAT"}</button>
    </form>
  );
}
