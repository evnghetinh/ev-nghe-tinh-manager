"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";

// Tách doanh thu của phiếu thành CÔNG (chia cho thợ) và PHỤ TÙNG (lợi nhuận của chủ). Chỉ Chủ xưởng thấy.
// Số liệu do hàm tach_phieu (giai đoạn 33) tính, chỉ đọc. Công + phụ tùng = doanh thu (trước VAT).
type T = { doanh_thu: number; dt_cong: number; dt_pt: number; gia_von_pt: number; ln_pt: number; chi_phi_phieu: number; phan_cong: number; pt_thieu_gia: number };

function Row({ label, value, bold = false, red = false }: { label: string; value: number; bold?: boolean; red?: boolean }) {
  return <div className={`flex justify-between gap-3 ${bold ? "font-bold" : "text-sm"} ${red ? "text-red-700" : ""}`}><span>{label}</span><span className="shrink-0">{money(value)}</span></div>;
}

export default function Tach({ orderId, reloadKey }: { orderId: string; reloadKey: string }) {
  const [t, setT] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await supabase.rpc("tach_phieu", { p_order: orderId });
    setBusy(false);
    if (r.error) { setError(r.error.message + " (đã chạy giai-doan-33.sql chưa?)"); return; }
    const x = ((r.data ?? []) as Record<string, unknown>[])[0];
    if (!x) return;
    setError("");
    setT({
      doanh_thu: Number(x.doanh_thu), dt_cong: Number(x.dt_cong), dt_pt: Number(x.dt_pt), gia_von_pt: Number(x.gia_von_pt),
      ln_pt: Number(x.ln_pt), chi_phi_phieu: Number(x.chi_phi_phieu), phan_cong: Number(x.phan_cong), pt_thieu_gia: Number(x.pt_thieu_gia),
    });
  }, [orderId]);
  // reloadKey đổi (sửa dòng, giảm giá, chi phí) thì tải lại
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, reloadKey]);

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Tách doanh thu công / phụ tùng</h2>
        <button type="button" disabled={busy} onClick={load} className="btn-secondary text-sm">Tải lại</button>
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
      {!t ? <p className="text-sm text-slate-500">{error ? "" : "Đang tải..."}</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-1">
              <div className="text-sm font-semibold text-sky-800">Phần CÔNG (đưa vào chia cho thợ)</div>
              <Row label="Doanh thu công" value={t.dt_cong} />
              <Row label="Chi phí phiếu (vật tư, thuê ngoài, khác)" value={-t.chi_phi_phieu} />
              <Row label="Phần công còn lại" value={t.phan_cong} bold red={t.phan_cong < 0} />
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
              <div className="text-sm font-semibold text-amber-800">Phần PHỤ TÙNG (của chủ, không chia)</div>
              <Row label="Doanh thu phụ tùng" value={t.dt_pt} />
              <Row label="Giá vốn phụ tùng (giá nhập)" value={-t.gia_von_pt} />
              <Row label="Lợi nhuận phụ tùng" value={t.ln_pt} bold red={t.ln_pt < 0} />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Công + phụ tùng = doanh thu {money(t.doanh_thu)} (sau giảm giá, chưa gồm VAT). Giảm giá cả phiếu chia theo tỷ lệ tiền công / phụ tùng.
            Chi phí nuôi xưởng trừ ở trang <Link href="/chia-tien" className="text-brand-600 underline">Chia tiền</Link> cuối tháng.
          </p>
          {t.pt_thieu_gia > 0 && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-2">
              Có {t.pt_thieu_gia} dòng phụ tùng chưa có giá nhập (giá vốn = 0), nên lợi nhuận phụ tùng đang bị tính cao hơn thực tế.
            </p>
          )}
        </>
      )}
    </section>
  );
}
