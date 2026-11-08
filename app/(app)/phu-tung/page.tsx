"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, Icon, LoadingBlock, PageTitle, Toast } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, money2, digits, decimalInput, toNum, qtyText, tonText, type DonVi } from "@/lib/format";
import { useRole } from "@/lib/role";

type Lech = { part_id: string; ten: string; ma: string | null; ton_hien_tai: number; tong_so: number; lech: number };

function Reconcile() {
  const [rows, setRows] = useState<Lech[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setErr("");
    const r = await supabase.rpc("doi_chieu_ton");
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    setRows(r.data as Lech[]);
  }
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <b className="text-navy-900">Đối chiếu tồn kho</b>
        <button onClick={run} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">{busy ? "Đang đối chiếu..." : "Đối chiếu ngay"}</button>
      </div>
      <Toast text={err} onClose={() => setErr("")} />
      {rows && (rows.length === 0 ? <p className="text-sm text-green-700">Khớp: tồn của mọi phụ tùng bằng tổng sổ kho (tính theo đơn vị bán).</p> : (
        <ul className="space-y-1">
          <li className="text-sm text-red-700">Có {rows.length} món lệch:</li>
          {rows.map((x) => (
            <li key={x.part_id} className="text-sm border border-slate-200 rounded-xl p-2">
              <Link href={`/phu-tung/${x.part_id}`} className="text-blue-700 font-medium">{x.ten}{x.ma ? ` · ${x.ma}` : ""}</Link>
              <div className="text-slate-600">Tồn hiện tại {qtyText(x.ton_hien_tai)} · Tổng sổ kho {qtyText(x.tong_so)} · Lệch {x.lech > 0 ? "+" : ""}{qtyText(x.lech)}</div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

type Part = { id: string; name: string; code: string | null; cost_price?: number; sale_price: number; stock: number; is_hidden?: boolean; gia_tri_von?: number; gia_tri_ban?: number; co_gia_nhap?: boolean } & DonVi;
type GiaTri = { part_id: string; gia_von: number; co_gia_nhap: boolean; gia_tri_von: number; gia_tri_ban: number };
type Tong = { tong_von: number; tong_ban: number; so_con_hang: number; so_het_hang: number; so_thieu_gia: number };
type LechTien = { part_id: string; ten: string; ma: string | null; loai: string; ton: number; tong_so: number; tien_lech: number };

function TongTon({ rows, loc }: { rows: Part[]; loc: boolean }) {
  const [db, setDb] = useState<Tong | null>(null);
  const [lech, setLech] = useState<LechTien[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const r = await supabase.rpc("tong_gia_tri_ton");
      if (r.error) return setErr(r.error.message + " (đã chạy giai-doan-24.sql chưa?)");
      const x = (r.data as Tong[])[0];
      setDb({ tong_von: Number(x.tong_von), tong_ban: Number(x.tong_ban), so_con_hang: Number(x.so_con_hang), so_het_hang: Number(x.so_het_hang), so_thieu_gia: Number(x.so_thieu_gia) });
    })();
  }, []);
  const von = rows.reduce((t, p) => t + (p.gia_tri_von ?? 0), 0);
  const ban = rows.reduce((t, p) => t + (p.gia_tri_ban ?? 0), 0);
  const con = rows.filter((p) => p.stock > 0).length;
  const het = rows.filter((p) => p.stock <= 0).length;
  const thieu = rows.filter((p) => p.stock !== 0 && !p.co_gia_nhap).length;
  const an = rows.filter((p) => p.is_hidden && p.stock !== 0).length;
  const khop = !loc && db ? Math.round(db.tong_von) === Math.round(von) && Math.round(db.tong_ban) === Math.round(ban) : null;
  async function run() {
    setBusy(true); setErr("");
    const r = await supabase.rpc("doi_chieu_gia_tri_ton");
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    setLech((r.data as LechTien[]).map((x) => ({ ...x, ton: Number(x.ton), tong_so: Number(x.tong_so), tien_lech: Number(x.tien_lech) })));
  }
  return (
    <div className="card space-y-2">
      <b className="text-navy-900">Giá trị tồn kho{loc ? " (theo bộ lọc)" : ""}</b>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div><div className="text-sm text-slate-500">Theo giá nhập</div><div className="text-2xl font-bold text-navy-900">{money(von)}</div></div>
        <div><div className="text-sm text-slate-500">Theo giá bán dự kiến</div><div className="text-2xl font-bold text-navy-900">{money(ban)}</div></div>
      </div>
      <div className="text-sm text-slate-600">{con} loại còn hàng · {het} loại hết hàng{an > 0 ? ` · gồm ${an} món đã ẩn còn tồn` : ""}</div>
      {thieu > 0 && <p className="text-sm text-amber-700">Có {thieu} món còn tồn nhưng chưa có giá nhập (tính 0) nên tổng chưa đầy đủ.</p>}
      {khop === true && <p className="text-sm text-green-700">Khớp với thẻ “Tiền hàng trong kho” ở Tổng quan.</p>}
      {khop === false && db && <p className="text-sm text-red-700">Lệch với Tổng quan: Tổng quan {money(db.tong_von)}, trang này {money(von)}. Bấm “Liệt kê chỗ lệch”.</p>}
      <button onClick={run} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">{busy ? "Đang kiểm tra..." : "Liệt kê chỗ lệch"}</button>
      <Toast text={err} onClose={() => setErr("")} />
      {lech && (lech.length === 0 ? <p className="text-sm text-green-700">Không có chỗ lệch: không món nào tồn âm, lệch sổ kho hay thiếu giá nhập.</p> : (
        <ul className="space-y-1">
          <li className="text-sm text-red-700">Có {lech.length} món cần xem:</li>
          {lech.map((x) => (
            <li key={x.part_id + x.loai} className="text-sm border border-slate-200 rounded-xl p-2">
              <Link href={`/phu-tung/${x.part_id}`} className="text-blue-700 font-medium">{x.ten}{x.ma ? ` · ${x.ma}` : ""}</Link>
              <div className="text-slate-600">{x.loai}</div>
              <div className={x.ton < 0 ? "text-red-700" : "text-slate-600"}>Tồn {qtyText(x.ton)} · Tổng sổ kho {qtyText(x.tong_so)}{x.tien_lech !== 0 ? ` · Tiền lệch ${money(x.tien_lech)}` : ""}</div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
const empty = { name: "", code: "", cost_price: "", sale_price: "", stock: "", don_vi_nhap: "cái", don_vi_ban: "cái", he_so: "1" };

export default function PartsPage() {
  const isOwner = useRole() === "chu";
  const [list, setList] = useState<Part[]>([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [sortGt, setSortGt] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("parts").select("*").order("name");
    if (error) return setError(error.message);
    let rows = (data as Part[]).map((p) => ({ ...p, stock: Number(p.stock), he_so: Number(p.he_so) }));
    if (isOwner) {
      const c = await supabase.from("part_costs").select("part_id, cost_price");
      if (c.error) return setError(c.error.message);
      const m = new Map((c.data ?? []).map((x) => [x.part_id as string, Number(x.cost_price)]));
      const g = await supabase.rpc("gia_tri_ton");
      if (g.error) return setError(g.error.message + " (đã chạy giai-doan-24.sql chưa?)");
      const gm = new Map((g.data as GiaTri[]).map((x) => [x.part_id, x]));
      rows = rows.map((p) => {
        const x = gm.get(p.id);
        return { ...p, cost_price: m.get(p.id) ?? 0, gia_tri_von: Number(x?.gia_tri_von ?? 0), gia_tri_ban: Number(x?.gia_tri_ban ?? 0), co_gia_nhap: x?.co_gia_nhap ?? false };
      });
    }
    setList(rows);
    setLoaded(true);
  }, [isOwner]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const row = {
      name: form.name.trim(), code: form.code.trim() || null,
      sale_price: Number(form.sale_price || 0),
    };
    const initQty = toNum(form.stock || "0");
    const he = toNum(form.he_so || "1");
    if (!editId) {
      if (!form.don_vi_ban.trim() || !form.don_vi_nhap.trim()) return setError("Hãy nhập đơn vị nhập và đơn vị bán.");
      if (!(he > 0)) return setError("Hệ số phải lớn hơn 0.");
    }
    const res = editId
      ? await supabase.from("parts").update(row).eq("id", editId).select("id").single()
      : await supabase.from("parts").insert({ ...row, stock: 0, don_vi_nhap: form.don_vi_nhap.trim(), don_vi_ban: form.don_vi_ban.trim(), he_so: he }).select("id").single();
    if (res.error) return setError(res.error.code === "23505" ? "Mã phụ tùng đã tồn tại." : res.error.message);
    if (!editId && initQty > 0) {
      const t = await supabase.rpc("dat_ton_dau", { p_part: res.data.id, p_qty: initQty });
      if (t.error) return setError(t.error.message);
    }
    if (isOwner) {
      // Thêm mới: ô giá nhập là giá 1 đơn vị nhập -> giá vốn mỗi đơn vị bán = giá nhập / hệ số. Sửa: ô là giá vốn mỗi đơn vị bán.
      const cost = editId ? toNum(form.cost_price || "0") : Math.round((toNum(form.cost_price || "0") / he) * 10000) / 10000;
      const c = await supabase.from("part_costs").upsert({ part_id: res.data.id, cost_price: cost });
      if (c.error) return setError(c.error.message);
    }
    setForm(empty); setEditId(null); load();
  }
  function edit(p: Part) {
    setEditId(p.id);
    setForm({ name: p.name, code: p.code ?? "", cost_price: String(p.cost_price ?? 0), sale_price: String(p.sale_price), stock: String(p.stock), don_vi_nhap: p.don_vi_nhap, don_vi_ban: p.don_vi_ban, he_so: String(p.he_so) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function remove(p: Part) {
    if (!confirm(`Xóa phụ tùng "${p.name}"? Chỉ xóa được phụ tùng chưa có lịch sử kho / phiếu / nhập hàng; việc xóa được ghi nhật ký.`)) return;
    const { error } = await supabase.from("parts").delete().eq("id", p.id);
    if (error) setError(error.message); else load();
  }

  async function unhide(p: Part) {
    const { error } = await supabase.rpc("bo_an_phu_tung", { p_part: p.id });
    if (error) setError(error.message); else load();
  }
  const khopTim = (p: Part) => !q || `${p.name} ${p.code ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const tinhTong = list.filter(khopTim); // tổng luôn gồm cả phụ tùng đã ẩn
  const shown = list.filter((p) => (showHidden || !p.is_hidden) && khopTim(p));
  if (isOwner && sortGt) shown.sort((a, b) => (b.gia_tri_von ?? 0) - (a.gia_tri_von ?? 0));
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-4">
      <PageTitle icon={<Icon name="box" />} title="Phụ tùng" />
      {isOwner && loaded && <TongTon rows={tinhTong} loc={!!q} />}
      {isOwner && <Reconcile />}
      <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
        <input required placeholder="Tên phụ tùng *" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Mã phụ tùng" className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        {!editId && (
          <div className="sm:col-span-2 grid grid-cols-3 gap-2">
            <label className="space-y-1"><span className="text-xs text-slate-500">Đơn vị nhập</span>
              <input className={input} value={form.don_vi_nhap} onChange={(e) => setForm({ ...form, don_vi_nhap: e.target.value })} placeholder="can" /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Đơn vị bán</span>
              <input className={input} value={form.don_vi_ban} onChange={(e) => setForm({ ...form, don_vi_ban: e.target.value })} placeholder="lít" /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Hệ số (1 {form.don_vi_nhap || "nhập"} = ? {form.don_vi_ban || "bán"})</span>
              <input inputMode="decimal" className={input} value={form.he_so} onChange={(e) => setForm({ ...form, he_so: decimalInput(e.target.value) })} /></label>
          </div>
        )}
        {isOwner && <input placeholder={editId ? `Giá vốn mỗi ${form.don_vi_ban} (đ)` : `Giá nhập 1 ${form.don_vi_nhap || "đơn vị nhập"} (đ)`} inputMode="decimal" className={input} value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: decimalInput(e.target.value, 4) })} />}
        <input placeholder={`Giá bán mỗi ${form.don_vi_ban || "đơn vị"} (đ)`} inputMode="numeric" className={input} value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: digits(e.target.value) })} />
        {editId
          ? <p className="text-sm text-slate-500 self-center">Tồn kho không sửa ở đây: dùng Nhập hàng hoặc Kiểm kê điều chỉnh (trong trang chi tiết). Đổi đơn vị: vào chi tiết phụ tùng (chỉ Chủ).</p>
          : <input placeholder={`Tồn đầu (tính theo ${form.don_vi_ban || "đơn vị bán"})`} inputMode="decimal" className={input} value={form.stock} onChange={(e) => setForm({ ...form, stock: decimalInput(e.target.value) })} />}
        <div className="flex gap-2">
          <button className="btn-primary">{editId ? "Lưu thay đổi" : "Thêm phụ tùng"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(empty); }} className="btn-secondary">Hủy</button>}
        </div>
      </form>
      <Toast text={error} onClose={() => setError("")} />
      <input placeholder="Tìm theo tên hoặc mã..." className={input} value={q} onChange={(e) => setQ(e.target.value)} />
      {isOwner && (
        <label className="flex items-center gap-2 text-sm text-slate-600">Sắp xếp
          <select className="border px-3 py-2 min-h-11 text-base" value={sortGt ? "gt" : "ten"} onChange={(e) => setSortGt(e.target.value === "gt")}>
            <option value="ten">Theo tên A-Z</option>
            <option value="gt">Giá trị tồn cao xuống thấp</option>
          </select>
        </label>
      )}
      {isOwner && list.some((p) => p.is_hidden) && (
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Hiện cả phụ tùng đã ẩn</label>
      )}
      <ul className="space-y-2">
        {shown.map((p) => (
          <li key={p.id} className="card space-y-1">
            <div className="flex justify-between gap-2">
              <Link href={`/phu-tung/${p.id}`} className="font-semibold text-green-700">{p.name}{p.code ? <span className="text-slate-500 font-normal"> · {p.code}</span> : null}{p.is_hidden ? <span className="ml-1 text-xs text-amber-700 font-normal">(đã ẩn)</span> : null}</Link>
              <span className={`badge text-right max-w-[55%] shrink-0 ${p.stock > 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}${p.stock < 0 ? " ring-2 ring-red-500" : ""}`}>Tồn: {tonText(p.stock, p)}</span>
            </div>
            <div className="text-sm text-slate-500">{isOwner ? `Vốn ${money2(p.cost_price ?? 0)}/${p.don_vi_ban} · ` : ""}Bán {money(p.sale_price)}/{p.don_vi_ban}</div>
            {isOwner && (
              <div className="text-sm">
                {p.co_gia_nhap || p.stock === 0
                  ? <span className={p.stock < 0 ? "text-red-700 font-semibold" : "text-slate-700"}>Giá trị tồn: {money(p.gia_tri_von ?? 0)}{p.stock < 0 ? " (tồn âm)" : ""}</span>
                  : <span className="text-amber-700">Giá trị tồn: chưa có giá nhập (tính 0)</span>}
              </div>
            )}
            <div className="flex gap-1 text-sm flex-wrap">
              <Link href={`/phu-tung/${p.id}`} className="btn-secondary text-sm !px-3">Lịch sử</Link>
              {isOwner && <button onClick={() => edit(p)} className="btn-secondary text-sm !px-3">Sửa</button>}
              {isOwner && <button onClick={() => remove(p)} className="bare text-red-600 px-3 min-h-11">Xóa</button>}
              {isOwner && p.is_hidden && <button onClick={() => unhide(p)} className="bare text-amber-700 px-3 min-h-11">Bỏ ẩn</button>}
            </div>
          </li>
        ))}
        {!loaded && <li><LoadingBlock rows={3} /></li>}
        {loaded && shown.length === 0 && <li><EmptyState icon={<Icon name="box" />} text={q ? "Không có phụ tùng nào khớp từ khóa." : "Chưa có phụ tùng. Nhập form phía trên để thêm."} /></li>}
      </ul>
    </div>
  );
}
