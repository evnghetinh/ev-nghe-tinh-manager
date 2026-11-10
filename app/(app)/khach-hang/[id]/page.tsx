"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, Icon, LoadingBlock, PageTitle, StatusBadge, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, namMauXe, tenXe } from "@/lib/format";

type Xe = { id: string; plate: string; hang_xe: string | null; dong_xe: string | null; vehicle_type: string | null; nam_san_xuat: number | null; mau_xe: string | null; model: string | null; vin: string | null };
type Phieu = { id: string; code: number; plate: string; status: string; ngay: string | null; tong: number | null; da_thu: number | null; con_no: number };
type HoSo = {
  khach: { id: string; name: string; phone: string | null; address: string | null; note: string | null };
  xe: Xe[]; phieu: Phieu[]; tong_da_chi: number | null; cong_no: number;
};

const maPhieu = (n: number) => "PT" + String(n).padStart(4, "0");
const fmtNgay = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
// Số Zalo: bỏ ký tự lạ, đổi 0 đầu thành 84
const soZalo = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("0") ? "84" + d.slice(1) : d; };

export default function HoSoKhach() {
  const { id } = useParams<{ id: string }>();
  const [hs, setHs] = useState<HoSo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let huy = false;
    supabase.rpc("khach_ho_so", { p_id: id }).then(({ data, error }) => {
      if (huy) return;
      if (error) setError(error.message + " (đã chạy giai-doan-27.sql chưa?)");
      else if (data) {
        const d = data as HoSo;
        setHs({ ...d, cong_no: Number(d.cong_no), tong_da_chi: d.tong_da_chi == null ? null : Number(d.tong_da_chi),
          phieu: d.phieu.map((p) => ({ ...p, tong: p.tong == null ? null : Number(p.tong), da_thu: p.da_thu == null ? null : Number(p.da_thu), con_no: Number(p.con_no) })) });
      }
      setLoaded(true);
    });
    return () => { huy = true; };
  }, [id]);

  if (!loaded) return <div className="space-y-4"><LoadingBlock rows={3} /></div>;
  if (!hs) return (
    <div className="space-y-4">
      <Toast text={error} onClose={() => setError("")} />
      <EmptyState icon={<Icon name="users" />} text="Không tìm thấy khách này." />
      <Link href="/khach-hang" className="btn btn-secondary w-full">Về danh sách khách</Link>
    </div>
  );

  const k = hs.khach;
  const sdt = (k.phone ?? "").replace(/[^\d+]/g, "");
  return (
    <div className="space-y-4">
      <Toast text={error} onClose={() => setError("")} />
      <PageTitle icon={<Icon name="users" />} title={k.name} />

      <div className="card space-y-3">
        <div className="text-sm text-slate-600 space-y-1 break-words">
          <div>Điện thoại: <b className="text-navy-900">{k.phone || "—"}</b></div>
          {k.address && <div>Địa chỉ: {k.address}</div>}
          {k.note && <div>Ghi chú: {k.note}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-100 p-3">
            <div className="text-xs text-slate-500">Công nợ</div>
            <div className={`text-lg font-bold ${hs.cong_no > 0 ? "text-red-700" : "text-navy-900"}`}>{money(hs.cong_no)}</div>
          </div>
          {hs.tong_da_chi != null && (
            <div className="rounded-xl bg-slate-100 p-3">
              <div className="text-xs text-slate-500">Tổng đã chi</div>
              <div className="text-lg font-bold text-navy-900">{money(hs.tong_da_chi)}</div>
            </div>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {sdt ? <a href={`tel:${sdt}`} className="btn btn-secondary">Gọi</a> : <span className="btn btn-secondary opacity-50" aria-disabled>Gọi</span>}
          {sdt ? <a href={`https://zalo.me/${soZalo(sdt)}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Zalo</a> : <span className="btn btn-secondary opacity-50" aria-disabled>Zalo</span>}
          <Link href={`/tiep-nhan?khach=${k.id}`} className="btn btn-primary">Tiếp nhận xe cho khách này</Link>
        </div>
        {hs.cong_no > 0 && <Link href="/cong-no" className="block text-sm text-brand-700 underline py-2">Xem và thu công nợ</Link>}
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold text-navy-900">Xe của khách ({hs.xe.length})</h2>
        {hs.xe.length === 0 && <EmptyState icon={<Icon name="car" />} text="Khách này chưa có xe." />}
        <ul className="space-y-2">
          {hs.xe.map((x) => (
            <li key={x.id} className="card">
              <div className="font-semibold text-navy-900 break-words">{x.plate}{tenXe(x) ? ` · ${tenXe(x)}` : ""}</div>
              <div className="text-sm text-slate-500 break-words">{[x.vehicle_type, namMauXe(x), x.model, x.vin ? `Số khung: ${x.vin}` : ""].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-navy-900">Lịch sử phiếu (mới nhất trước)</h2>
        {hs.phieu.length === 0 && <EmptyState icon={<Icon name="clipboard" />} text="Chưa có phiếu nào." />}
        <ul className="space-y-2">
          {hs.phieu.map((p) => (
            <li key={p.id}>
              <Link href={`/tiep-nhan/${p.id}`} className="card flex justify-between gap-3 items-start min-h-11">
                <div className="min-w-0">
                  <div className="font-semibold text-navy-900">{maPhieu(p.code)} · {p.plate}</div>
                  <div className="text-sm text-slate-500">{fmtNgay(p.ngay)}{p.tong != null ? ` · ${money(p.tong)}` : ""}</div>
                  {p.con_no > 0 && <div className="text-sm font-semibold text-red-700">Còn nợ {money(p.con_no)}</div>}
                </div>
                <StatusBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
