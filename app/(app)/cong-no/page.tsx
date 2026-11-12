"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { digits, money } from "@/lib/format";
import { useRole } from "@/lib/role";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";

type Phieu = { order_id: string; ma_phieu: number; customer_id: string; bien_so: string; ngay_hoan_thanh: string | null; tong: number; da_thu: number; con_no: number };
type Note = { id: string; customer_id: string; ngay_hen: string | null; ghi_chu: string | null; created_by_name: string | null; created_at: string };
type Khach = { id: string; name: string; phone: string | null; tong: number; phieu: Phieu[]; oldest: string; tuoi: number; nhom: number; hen: string | null; ghiChu: string | null };
type TongLech = { loai: string; order_id: string; ma_phieu: number; ten_khach: string; tong_phieu: number; tong_so_sanh: number; chenh: number };
type Lech = { loai: string; order_id: string; ma_phieu: number; ten_khach: string; tong: number; da_thu: number; chenh: number };

const NHOM = [
  { label: "0-7 ngày", tone: "bg-sky-100 text-sky-800", bar: "border-sky-400" },
  { label: "8-30 ngày", tone: "bg-amber-100 text-amber-800", bar: "border-amber-500" },
  { label: "Trên 30 ngày", tone: "bg-red-100 text-red-700", bar: "border-red-600" },
];
const nhomOf = (d: number) => (d <= 7 ? 0 : d <= 30 ? 1 : 2);
const maPhieu = (n: number) => "PT" + String(n).padStart(4, "0");
const fmtDate = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");
const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));
const input = "w-full border px-3 py-2";

function nhacNo(ten: string, tong: number) {
  return `Chào ${ten}, gara EV Nghệ Tĩnh Auto xin nhắc anh/chị còn khoản ${money(tong)} chưa thanh toán. Anh/chị sắp xếp thanh toán giúp gara nhé. Xin cảm ơn!`;
}
async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const a = document.createElement("textarea");
    a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select();
    const ok = document.execCommand("copy"); document.body.removeChild(a); return ok;
  }
}

export default function CongNoPage() {
  const role = useRole();
  const [today] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [phieu, setPhieu] = useState<Phieu[]>([]);
  const [names, setNames] = useState<Record<string, { name: string; phone: string | null }>>({});
  const [notes, setNotes] = useState<Note[]>([]);
  const [tongQuan, setTongQuan] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, c, n, t] = await Promise.all([
      supabase.rpc("cong_no_phieu"),
      supabase.from("customers").select("id, name, phone"),
      supabase.from("cong_no_ghi_chu").select("id, customer_id, ngay_hen, ghi_chu, created_by_name, created_at").order("seq", { ascending: false }),
      supabase.rpc("cong_no_tong"),
    ]);
    const err = p.error ?? c.error ?? n.error ?? t.error;
    if (err) setError(err.message + " (đã chạy giai-doan-23.sql chưa?)");
    setPhieu(((p.data ?? []) as Phieu[]).map((x) => ({ ...x, tong: Number(x.tong), da_thu: Number(x.da_thu), con_no: Number(x.con_no) })));
    setNames(Object.fromEntries(((c.data ?? []) as { id: string; name: string; phone: string | null }[]).map((x) => [x.id, x])));
    setNotes((n.data ?? []) as Note[]);
    const tq = (t.data as { tong: number }[] | null)?.[0];
    setTongQuan(tq ? Number(tq.tong) : null);
    setLoaded(true);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const khach = useMemo<Khach[]>(() => {
    const by = new Map<string, Phieu[]>();
    for (const p of phieu) by.set(p.customer_id, [...(by.get(p.customer_id) ?? []), p]);
    const out: Khach[] = [];
    for (const [id, ps] of by) {
      ps.sort((a, b) => (a.ngay_hoan_thanh ?? "").localeCompare(b.ngay_hoan_thanh ?? "") || a.ma_phieu - b.ma_phieu);
      const oldest = ps[0].ngay_hoan_thanh ?? today;
      const tuoi = days(oldest, today);
      const mine = notes.filter((n) => n.customer_id === id); // mới nhất trước
      out.push({
        id, name: names[id]?.name ?? "(không rõ)", phone: names[id]?.phone ?? null,
        tong: ps.reduce((s, x) => s + x.con_no, 0), phieu: ps, oldest, tuoi, nhom: nhomOf(tuoi),
        hen: mine.find((n) => n.ngay_hen)?.ngay_hen ?? null, ghiChu: mine.find((n) => n.ghi_chu)?.ghi_chu ?? null,
      });
    }
    return out.sort((a, b) => b.tuoi - a.tuoi || b.tong - a.tong);
  }, [phieu, names, notes, today]);

  const tongTrang = khach.reduce((s, k) => s + k.tong, 0);
  const tongNhom = [0, 1, 2].map((g) => khach.filter((k) => k.nhom === g).reduce((s, k) => s + k.tong, 0));
  const demNhom = [0, 1, 2].map((g) => khach.filter((k) => k.nhom === g).length);
  const shown = khach.filter((k) => (filter === "all" || k.nhom === Number(filter))
    && (k.name + " " + (k.phone ?? "")).toLowerCase().includes(q.trim().toLowerCase()));
  const cur = sel ? khach.find((k) => k.id === sel) : null;

  if (!loaded) return <div className="space-y-4"><PageTitle icon={<Icon name="receipt" />} title="Công nợ khách" /><LoadingBlock rows={3} /></div>;

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="receipt" />} title="Công nợ khách" />
      <Toast text={error} onClose={() => setError("")} />
      <Toast text={ok} kind="ok" onClose={() => setOk("")} />
      {cur ? (
        <Detail k={cur} notes={notes.filter((n) => n.customer_id === cur.id)} today={today} isOwner={role === "chu"}
          onBack={() => setSel(null)} onDone={(m) => { setOk(m); load(); }} onError={setError} />
      ) : (
        <>
          <div className="card space-y-3">
            <div>
              <div className="text-sm text-slate-500">Tổng nợ toàn bộ ({khach.length} khách, {phieu.length} phiếu)</div>
              <div className="text-3xl font-bold text-navy-900">{money(tongTrang)}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {NHOM.map((n, i) => (
                <div key={n.label} className={`rounded-xl p-3 ${n.tone}`}>
                  <div className="text-sm font-medium">{n.label} · {demNhom[i]} khách</div>
                  <div className="text-xl font-bold">{money(tongNhom[i])}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">Tuổi nợ tính từ ngày hoàn thành của phiếu nợ lâu nhất của khách.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <input placeholder="Tìm theo tên hoặc số điện thoại..." aria-label="Tìm khách" className={input} value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Lọc theo tuổi nợ" className={input} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Mọi tuổi nợ</option>
              {NHOM.map((n, i) => <option key={n.label} value={i}>{n.label}</option>)}
            </select>
          </div>

          {shown.length === 0 ? (
            <EmptyState icon={<Icon name="receipt" />} text={khach.length === 0 ? "Hiện không có khách nào còn nợ." : "Không có khách nào khớp bộ lọc."} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {shown.map((k) => (
                <li key={k.id} className={`card border-l-4 ${NHOM[k.nhom].bar} space-y-2`}>
                  <button type="button" onClick={() => setSel(k.id)} className="bare text-left w-full min-h-11 space-y-1">
                    <div className="flex justify-between gap-2 items-start">
                      <div className="min-w-0">
                        <div className="font-semibold text-navy-900 break-words">{k.name}</div>
                        <div className="text-sm text-slate-500">{k.phone || "Chưa có số điện thoại"}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-bold text-red-700">{money(k.tong)}</div>
                        <div className="text-xs text-slate-500">{k.phieu.length} phiếu nợ</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-sm text-slate-600">
                      <span className={`badge ${NHOM[k.nhom].tone}`}>{NHOM[k.nhom].label}</span>
                      <span>Nợ từ {fmtDate(k.oldest)} ({k.tuoi} ngày)</span>
                    </div>
                    <div className="text-sm text-slate-600">
                      Hẹn trả: <b className={k.hen && k.hen < today ? "text-red-700" : ""}>{fmtDate(k.hen)}{k.hen && k.hen < today ? " (quá hạn)" : ""}</b>
                      {k.ghiChu && <div className="break-words">Ghi chú: {k.ghiChu}</div>}
                    </div>
                  </button>
                  <Lien k={k} setOk={setOk} setError={setError} />
                </li>
              ))}
            </ul>
          )}

          <DoiChieu tongTrang={tongTrang} tongQuan={tongQuan} tongPhieu={phieu.reduce((s, p) => s + p.con_no, 0)} onError={setError} />
        </>
      )}
    </div>
  );
}

/** Nút Gọi, Zalo, sao chép câu nhắc nợ. */
function Lien({ k, setOk, setError }: { k: Khach; setOk: (s: string) => void; setError: (s: string) => void }) {
  const [show, setShow] = useState(false);
  const phone = (k.phone ?? "").replace(/[^\d+]/g, "");
  const msg = nhacNo(k.name, k.tong);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {phone ? <a href={`tel:${phone}`} className="btn btn-secondary">Gọi</a> : null}
        {phone ? <a href={`https://zalo.me/${digits(phone)}`} target="_blank" rel="noreferrer" className="btn btn-secondary">Zalo</a> : null}
        <button type="button" onClick={() => setShow(!show)} className="btn-secondary">Câu nhắc nợ</button>
      </div>
      {show && (
        <div className="space-y-2">
          <textarea readOnly rows={4} aria-label="Câu nhắc nợ" className={input} value={msg} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn-primary" onClick={async () => (await copyText(msg)) ? setOk("Đã sao chép câu nhắc nợ.") : setError("Không sao chép được, hãy chọn chữ rồi sao chép tay.")}>Sao chép</button>
        </div>
      )}
    </div>
  );
}

function Detail({ k, notes, today, isOwner, onBack, onDone, onError }:
  { k: Khach; notes: Note[]; today: string; isOwner: boolean; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [showPay, setShowPay] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(k.tong)));
  const [method, setMethod] = useState("Tiền mặt");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [pick, setPick] = useState(false);
  const [per, setPer] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [hen, setHen] = useState(k.hen ?? "");
  const [gc, setGc] = useState("");

  const total = pick ? Object.values(per).reduce((s, v) => s + Number(v || 0), 0) : Number(amount || 0);
  // Phân bổ tự động: phiếu cũ nhất trước
  const auto = useMemo(() => {
    const out: { p: Phieu; t: number }[] = [];
    let left = Number(amount || 0);
    for (const p of k.phieu) {
      const t = Math.min(left, Math.round(p.con_no));
      left -= t;
      if (t > 0) out.push({ p, t });
    }
    return out;
  }, [k.phieu, amount]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!(total > 0)) return onError("Số tiền phải lớn hơn 0.");
    if (total > Math.round(k.tong)) return onError(`Số thu vượt tổng nợ (${money(k.tong)}).`);
    if (!date) return onError("Hãy chọn ngày thu.");
    if (pick) for (const p of k.phieu) if (Number(per[p.order_id] || 0) > Math.round(p.con_no)) return onError(`Phiếu ${maPhieu(p.ma_phieu)} chỉ còn nợ ${money(p.con_no)}.`);
    setBusy(true);
    const phanBo = pick ? k.phieu.filter((p) => Number(per[p.order_id] || 0) > 0).map((p) => ({ order_id: p.order_id, so_tien: Number(per[p.order_id]) })) : null;
    const r = await supabase.rpc("thu_no_khach", { p_customer: k.id, p_so_tien: total, p_hinh_thuc: method, p_ngay: date, p_ghi_chu: note, p_phan_bo: phanBo });
    setBusy(false);
    if (r.error) return onError(r.error.message);
    setShowPay(false); setPer({}); setNote("");
    onDone(`Đã thu ${money(total)} của ${k.name}, vào sổ quỹ và ghi nhật ký.`);
  }
  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!hen && !gc.trim()) return onError("Hãy nhập ngày hẹn trả hoặc ghi chú.");
    setBusy(true);
    const r = await supabase.rpc("cong_no_ghi_chu_them", { p_customer: k.id, p_ngay_hen: hen || null, p_ghi_chu: gc });
    setBusy(false);
    if (r.error) return onError(r.error.message);
    setGc(""); onDone("Đã lưu ngày hẹn / ghi chú.");
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="btn-secondary">← Danh sách công nợ</button>
      <div className="card space-y-2">
        <div className="flex justify-between gap-2 items-start">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-navy-900 break-words">{k.name}</h2>
            <div className="text-sm text-slate-500">{k.phone || "Chưa có số điện thoại"}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-red-700">{money(k.tong)}</div>
            <span className={`badge ${NHOM[k.nhom].tone}`}>{NHOM[k.nhom].label}</span>
          </div>
        </div>
        <Lien k={k} setOk={onDone} setError={onError} />
      </div>

      <div className="card space-y-2">
        <h3 className="font-semibold text-navy-900">Các phiếu đang nợ ({k.phieu.length})</h3>
        <ul className="divide-y">
          {k.phieu.map((p) => (
            <li key={p.order_id}>
              <Link href={`/tiep-nhan/${p.order_id}`} className="block py-2 min-h-11 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-brand-700">{maPhieu(p.ma_phieu)} · {p.bien_so}</span>
                  <span className="font-bold text-red-700 shrink-0">{money(p.con_no)}</span>
                </div>
                <div className="text-sm text-slate-600 flex flex-wrap gap-x-3">
                  <span>Hoàn thành {fmtDate(p.ngay_hoan_thanh)}</span><span>Tổng {money(p.tong)}</span><span>Đã thu {money(p.da_thu)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="card space-y-3">
        {!showPay ? (
          <button type="button" className="btn-primary" onClick={() => { setAmount(String(Math.round(k.tong))); setShowPay(true); }}>Thu nợ</button>
        ) : (
          <form onSubmit={pay} className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2 font-medium">Thu nợ (tối đa {money(k.tong)})</div>
            {isOwner && (
              <label className="sm:col-span-2 flex items-center gap-2 min-h-11">
                <input type="checkbox" className="w-5 h-5" checked={pick} onChange={(e) => setPick(e.target.checked)} />
                <span className="text-sm">Chọn từng phiếu để thu (mặc định thu phiếu cũ nhất trước)</span>
              </label>
            )}
            {!pick ? (
              <>
                <input required inputMode="numeric" aria-label="Số tiền thu" placeholder="Số tiền (đ)" className={input} value={amount} onChange={(e) => setAmount(digits(e.target.value))} />
                <div className="sm:col-span-2 text-sm text-slate-600 space-y-0.5">
                  {auto.length === 0 ? "Nhập số tiền để xem phân bổ." : <>Phân bổ: {auto.map((x) => <div key={x.p.order_id}>{maPhieu(x.p.ma_phieu)}: {money(x.t)}</div>)}</>}
                </div>
              </>
            ) : (
              <div className="sm:col-span-2 space-y-2">
                {k.phieu.map((p) => (
                  <label key={p.order_id} className="flex items-center gap-2 justify-between">
                    <span className="text-sm min-w-0">{maPhieu(p.ma_phieu)} · {p.bien_so}<br /><span className="text-slate-500">nợ {money(p.con_no)}</span></span>
                    <input inputMode="numeric" aria-label={`Thu phiếu ${maPhieu(p.ma_phieu)}`} placeholder="0" className="!w-36 border px-3 py-2 text-right" value={per[p.order_id] ?? ""}
                      onChange={(e) => setPer({ ...per, [p.order_id]: digits(e.target.value) })} />
                  </label>
                ))}
                <div className="font-semibold">Tổng thu: {money(total)}</div>
              </div>
            )}
            <select aria-label="Hình thức" className={input} value={method} onChange={(e) => setMethod(e.target.value)}><option>Tiền mặt</option><option>Chuyển khoản</option></select>
            <input type="date" aria-label="Ngày thu" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
            <input placeholder="Ghi chú" aria-label="Ghi chú thu" className={`${input} sm:col-span-2`} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="sm:col-span-2 flex gap-2">
              <button disabled={busy} className="btn-primary disabled:opacity-50">Ghi khoản thu</button>
              <button type="button" onClick={() => setShowPay(false)} className="btn-secondary">Đóng</button>
            </div>
          </form>
        )}
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-navy-900">Ngày hẹn trả và ghi chú</h3>
        <form onSubmit={saveNote} className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-slate-600">Ngày hẹn trả<input type="date" className={`${input} mt-1`} value={hen} onChange={(e) => setHen(e.target.value)} /></label>
          <label className="text-sm text-slate-600">Ghi chú<input className={`${input} mt-1`} maxLength={500} value={gc} onChange={(e) => setGc(e.target.value)} placeholder="VD: hẹn cuối tháng, gọi không nghe máy..." /></label>
          <div className="sm:col-span-2"><button disabled={busy} className="btn-primary disabled:opacity-50">Lưu</button></div>
        </form>
        {notes.length === 0 ? <p className="text-sm text-slate-500">Chưa có ghi chú nào.</p> : (
          <ul className="divide-y text-sm">
            {notes.map((n) => (
              <li key={n.id} className="py-2">
                <div className="text-xs text-slate-500">{new Date(n.created_at).toLocaleString("vi-VN")} · {n.created_by_name ?? "Không rõ"}</div>
                {n.ngay_hen && <div>Hẹn trả: <b>{fmtDate(n.ngay_hen)}</b></div>}
                {n.ghi_chu && <div className="break-words">{n.ghi_chu}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DoiChieu({ tongTrang, tongQuan, tongPhieu, onError }: { tongTrang: number; tongQuan: number | null; tongPhieu: number; onError: (m: string) => void }) {
  const [lech, setLech] = useState<Lech[] | null>(null);
  const [tongLech, setTongLech] = useState<TongLech[] | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = useRole() === "chu";
  const khop = tongQuan !== null && Math.abs(tongTrang - tongQuan) < 1 && Math.abs(tongTrang - tongPhieu) < 1;
  async function run() {
    setBusy(true);
    const r = await supabase.rpc("cong_no_doi_chieu");
    setBusy(false);
    if (r.error) return onError(r.error.message);
    setLech(((r.data ?? []) as Lech[]).map((x) => ({ ...x, tong: Number(x.tong), da_thu: Number(x.da_thu), chenh: Number(x.chenh) })));
  }
  async function runTong() {
    setBusy(true);
    const r = await supabase.rpc("phieu_doi_chieu_tong");
    setBusy(false);
    if (r.error) return onError(r.error.message + " (đã chạy giai-doan-31.sql chưa?)");
    setTongLech(((r.data ?? []) as TongLech[]).map((x) => ({ ...x, tong_phieu: Number(x.tong_phieu), tong_so_sanh: Number(x.tong_so_sanh), chenh: Number(x.chenh) })));
  }
  return (
    <div className="card space-y-2">
      <h2 className="font-semibold text-navy-900">Đối chiếu</h2>
      <div className="text-sm space-y-1">
        <div className="flex justify-between gap-2"><span>Tổng nợ trên trang này</span><b>{money(tongTrang)}</b></div>
        <div className="flex justify-between gap-2"><span>Thẻ &quot;Khách còn nợ&quot; ở Tổng quan</span><b>{tongQuan === null ? "—" : money(tongQuan)}</b></div>
        <div className="flex justify-between gap-2"><span>Tổng các phiếu còn nợ</span><b>{money(tongPhieu)}</b></div>
      </div>
      <p className={`text-sm font-medium ${khop ? "text-green-700" : "text-red-700"}`}>{khop ? "✓ Ba số khớp nhau." : "✗ Các số đang lệch nhau."}</p>
      <button type="button" disabled={busy} onClick={run} className="btn-secondary disabled:opacity-50">Liệt kê chỗ lệch</button>
      {lech && (lech.length === 0 ? <p className="text-sm text-green-700">Không có phiếu nào lệch (không thu thừa, không phiếu hủy còn khoản thu).</p> : (
        <ul className="divide-y text-sm">
          {lech.map((l) => (
            <li key={l.order_id + l.loai}>
              <Link href={`/tiep-nhan/${l.order_id}`} className="block py-2 min-h-11">
                <div className="font-semibold">{maPhieu(l.ma_phieu)} · {l.ten_khach}</div>
                <div className="text-red-700">{l.loai}</div>
                <div className="text-slate-600">Tổng phiếu {money(l.tong)} · đã thu {money(l.da_thu)} · chênh {money(l.chenh)}</div>
              </Link>
            </li>
          ))}
        </ul>
      ))}
      {isOwner && (
        <div className="border-t pt-2 space-y-2">
          <p className="text-sm text-slate-600">Đối chiếu tổng thanh toán của mọi phiếu: trang in = tổng trong phiếu = tổng tính công nợ = tổng trong danh sách phiếu.</p>
          <button type="button" disabled={busy} onClick={runTong} className="btn-secondary disabled:opacity-50">Đối chiếu tổng phiếu</button>
          {tongLech && (tongLech.length === 0 ? <p className="text-sm text-green-700">✓ Mọi phiếu khớp: không có chỗ lệch.</p> : (
            <ul className="divide-y text-sm">
              {tongLech.map((l) => (
                <li key={l.order_id + l.loai}>
                  <Link href={`/tiep-nhan/${l.order_id}`} className="block py-2 min-h-11">
                    <div className="font-semibold">{maPhieu(l.ma_phieu)} · {l.ten_khach}</div>
                    <div className="text-red-700">{l.loai}</div>
                    <div className="text-slate-600">Tổng trong phiếu {money(l.tong_phieu)} · số so sánh {money(l.tong_so_sanh)} · chênh {money(l.chenh)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}
