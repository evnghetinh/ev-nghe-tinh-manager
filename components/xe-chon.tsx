"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type GoiY = { hang: string; dong: string[] }[];
const KHAC = "__khac";
const input = "w-full border px-3 py-2";

/** Tải danh sách hãng/dòng xe gợi ý */
export function useGoiYXe(): [GoiY, () => Promise<void>] {
  const [goiY, setGoiY] = useState<GoiY>([]);
  async function load() {
    const [h, d] = await Promise.all([
      supabase.from("xe_hang").select("id, ten").order("ten"),
      supabase.from("xe_dong").select("hang_id, ten").order("ten"),
    ]);
    if (!h.data) return;
    const dong = (d.data ?? []) as { hang_id: string; ten: string }[];
    setGoiY((h.data as { id: string; ten: string }[]).map((x) => ({ hang: x.ten, dong: dong.filter((m) => m.hang_id === x.id).map((m) => m.ten) })));
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);
  return [goiY, load];
}

/** Ô chọn Hãng xe + Dòng xe (có "Khác (nhập tay)"; dòng lọc theo hãng) */
export function ChonHangDong({ hang, dong, goiY, onChange }: { hang: string; dong: string; goiY: GoiY; onChange: (hang: string, dong: string) => void }) {
  const [tayHang, setTayHang] = useState(false);
  const [tayDong, setTayDong] = useState(false);
  const found = goiY.find((g) => g.hang.toLowerCase() === hang.trim().toLowerCase());
  const loaded = goiY.length > 0;
  const manualHang = tayHang || (loaded && hang.trim() !== "" && !found);
  const dongList = manualHang ? [] : found?.dong ?? [];
  const manualDong = manualHang || tayDong || (hang.trim() !== "" && dong.trim() !== "" && !dongList.some((m) => m.toLowerCase() === dong.trim().toLowerCase()));

  return (
    <>
      <div className="space-y-2">
        <select aria-label="Hãng xe" className={input} value={manualHang ? KHAC : found?.hang ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setTayDong(false);
            if (v === KHAC) { setTayHang(true); onChange("", ""); } else { setTayHang(false); onChange(v, ""); }
          }}>
          <option value="">-- Hãng xe --</option>
          {goiY.map((g) => <option key={g.hang} value={g.hang}>{g.hang}</option>)}
          <option value={KHAC}>Khác (nhập tay)</option>
        </select>
        {manualHang && <input aria-label="Nhập hãng xe" placeholder="Gõ tên hãng xe" className={input} value={hang} onChange={(e) => onChange(e.target.value, dong)} />}
      </div>
      <div className="space-y-2">
        {!manualHang && (
          <select aria-label="Dòng xe" className={input} disabled={!hang} value={manualDong ? KHAC : dong}
            onChange={(e) => {
              const v = e.target.value;
              if (v === KHAC) { setTayDong(true); onChange(hang, ""); } else { setTayDong(false); onChange(hang, v); }
            }}>
            <option value="">{hang ? "-- Dòng xe (VD: VF5) --" : "-- Chọn hãng trước --"}</option>
            {dongList.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={KHAC}>Khác (nhập tay)</option>
          </select>
        )}
        {(manualHang || manualDong) && <input aria-label="Nhập dòng xe" placeholder="Gõ tên dòng xe (VD: VF5)" className={input} value={dong} onChange={(e) => onChange(hang, e.target.value)} />}
      </div>
    </>
  );
}
