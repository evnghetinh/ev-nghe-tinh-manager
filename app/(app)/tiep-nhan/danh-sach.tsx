"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/lib/role";
import { money } from "@/lib/format";
import { EmptyState, Icon, LoadingBlock, StatusBadge } from "@/components/ui";

export type Row = {
  id: string; code: number; received_at: string; status: string; da_huy: boolean; stock_deducted: boolean;
  khach: string; sdt: string | null; bien_so: string; xe: string; vin: string | null; odometer: number | null; ktv: string | null;
  issue: string; tong: number; da_thu: number; con_no: number; loi_nhuan: number | null; tong_hang: number;
};
type Nhom = { nhom: string; so_luong: number; tong: number | null };
type ColKey = "code" | "received_at" | "status" | "khach" | "sdt" | "bien_so" | "xe" | "vin" | "odometer" | "ktv" | "issue" | "tong" | "da_thu" | "con_no" | "loi_nhuan";
type Col = { key: ColKey; label: string; num?: boolean; owner?: boolean; group?: "status" | "ngay" | "khach" | "ktv" };

const ALL_COLS: Col[] = [
  { key: "code", label: "Mã phiếu" },
  { key: "bien_so", label: "Biển số" },
  { key: "received_at", label: "Ngày giờ tiếp nhận", group: "ngay" },
  { key: "status", label: "Trạng thái", group: "status" },
  { key: "khach", label: "Khách hàng", group: "khach" },
  { key: "sdt", label: "Số điện thoại" },
  { key: "xe", label: "Hãng và dòng xe" },
  { key: "vin", label: "Số khung" },
  { key: "odometer", label: "Số km", num: true },
  { key: "ktv", label: "Kỹ thuật viên", group: "ktv" },
  { key: "issue", label: "Khách báo hỏng" },
  { key: "tong", label: "Tổng tiền", num: true },
  { key: "da_thu", label: "Đã thu", num: true },
  { key: "con_no", label: "Còn nợ", num: true },
  { key: "loi_nhuan", label: "Lợi nhuận", num: true, owner: true },
];
const COL_BY = Object.fromEntries(ALL_COLS.map((c) => [c.key, c])) as Record<ColKey, Col>;
const PINNED: ColKey[] = ["code", "bien_so"]; // luôn cố định ở bên trái
const DEFAULT_ORDER = ALL_COLS.map((c) => c.key);
const PAGE = 50;
const DAY = 86400000;

const VIEWS = [
  { key: "all", label: "Tất cả", tt: [] as string[], chiNo: false, homNay: false },
  { key: "xuong", label: "Đang trong xưởng", tt: ["Chờ xử lý", "Đang sửa"], chiNo: false, homNay: false },
  { key: "cho", label: "Chờ phụ tùng", tt: ["Chờ xử lý"], chiNo: false, homNay: false },
  { key: "xong", label: "Xong chờ giao xe", tt: ["Hoàn thành"], chiNo: false, homNay: false },
  { key: "no", label: "Còn nợ", tt: [] as string[], chiNo: true, homNay: false },
  { key: "homnay", label: "Hôm nay", tt: [] as string[], chiNo: false, homNay: true },
  { key: "huy", label: "Đã hủy", tt: ["Đã hủy"], chiNo: false, homNay: false },
];
const STATUS = ["Chờ xử lý", "Đang sửa", "Hoàn thành", "Đã giao xe", "Đã hủy"];
const STATUS_CHON = ["Chờ xử lý", "Đang sửa", "Đã giao xe"];
const ma = (n: number) => "PT" + String(n).padStart(4, "0");
const fmtTime = (s: string) => new Date(s).toLocaleString("vi-VN");
const today = () => new Date().toLocaleDateString("sv-SE");

function cell(r: Row, k: ColKey): string {
  switch (k) {
    case "code": return ma(r.code);
    case "received_at": return fmtTime(r.received_at);
    case "sdt": return r.sdt ?? "";
    case "vin": return r.vin ?? "";
    case "odometer": return r.odometer != null ? String(r.odometer) : "";
    case "ktv": return r.ktv ?? "";
    case "tong": return money(r.tong);
    case "da_thu": return money(r.da_thu);
    case "con_no": return r.con_no > 0.5 ? money(r.con_no) : "—";
    case "loi_nhuan": return r.loi_nhuan == null ? "—" : money(r.loi_nhuan);
    default: return String(r[k as keyof Row] ?? "");
  }
}

export default function DanhSach({ initialTim, reloadKey, onStatus, onRemove, onCancel }: {
  initialTim: string; reloadKey: number;
  onStatus: (id: string, status: string) => void; onRemove: (r: Row) => void; onCancel: (r: Row) => void;
}) {
  const isOwner = useRole() === "chu";
  const [uid, setUid] = useState("");
  const [mode, setMode] = useState<"bang" | "the" | null>(null);
  const [view, setView] = useState(initialTim ? "all" : "xuong");
  const [tt, setTt] = useState<string[]>(initialTim ? [] : ["Chờ xử lý", "Đang sửa"]);
  const [chiNo, setChiNo] = useState(false);
  const [tu, setTu] = useState("");
  const [den, setDen] = useState("");
  const [ktv, setKtv] = useState("");
  const [ktvs, setKtvs] = useState<{ id: string; ten: string }[]>([]);
  const [kw, setKw] = useState(initialTim);
  const [kwD, setKwD] = useState(initialTim);
  const [loc, setLoc] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "received_at", dir: "desc" });
  const [group, setGroup] = useState<string>("");
  const [order, setOrder] = useState<ColKey[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<ColKey[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [nhoms, setNhoms] = useState<Nhom[]>([]);
  const [open, setOpen] = useState<Record<string, { rows: Row[]; total: number; busy: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [menu, setMenu] = useState<ColKey | null>(null);
  const [chooser, setChooser] = useState(false);
  const [wide, setWide] = useState<Record<string, boolean>>({});
  const [now] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const req = useRef(0);
  const dragKey = useRef<ColKey | null>(null);

  // Nhớ cột theo tài khoản + thiết bị; chế độ xem theo thiết bị
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id ?? "";
      setUid(id);
      try {
        const saved = JSON.parse(localStorage.getItem(`ev-tn-cot-${id}`) ?? "null") as { order: ColKey[]; hidden: ColKey[] } | null;
        if (saved) {
          const known = saved.order.filter((k) => COL_BY[k]);
          setOrder([...known, ...DEFAULT_ORDER.filter((k) => !known.includes(k))]);
          setHidden(saved.hidden.filter((k) => COL_BY[k]));
        }
      } catch { /* bỏ qua */ }
    })();
    const m = localStorage.getItem("ev-tn-che-do");
    setMode(m === "bang" || m === "the" ? m : window.innerWidth >= 768 ? "bang" : "the");
    supabase.from("ev_ky_thuat_vien").select("id, ten").order("ten").then((k) => { if (k.data) setKtvs(k.data as { id: string; ten: string }[]); });
  }, []);
  useEffect(() => { const t = setTimeout(() => setKwD(kw), 300); return () => clearTimeout(t); }, [kw]);

  function saveCols(o: ColKey[], h: ColKey[]) {
    setOrder(o); setHidden(h);
    localStorage.setItem(`ev-tn-cot-${uid}`, JSON.stringify({ order: o, hidden: h }));
  }
  function pickMode(m: "bang" | "the") { setMode(m); localStorage.setItem("ev-tn-che-do", m); }

  const cols = useMemo(() => {
    const rest = order.filter((k) => !PINNED.includes(k) && !hidden.includes(k) && (isOwner || !COL_BY[k].owner));
    return [...PINNED, ...rest].map((k) => COL_BY[k]);
  }, [order, hidden, isOwner]);

  const filterArgs = useMemo(() => ({
    p_tu_khoa: kwD, p_trang_thai: tt.length ? tt : null, p_tu: tu || null, p_den: den || null,
    p_ktv: ktv || null, p_chi_no: chiNo, p_loc: loc,
  }), [kwD, tt, tu, den, ktv, chiNo, loc]);

  const fetchRows = useCallback(async (offset: number, nhom?: string) => {
    const r = await supabase.rpc("ds_phieu_tiep_nhan", {
      ...filterArgs, p_sap_xep: sort.key, p_huong: sort.dir, p_gioi_han: PAGE, p_bat_dau: offset,
      p_nhom_cot: nhom !== undefined ? group : null, p_nhom_gia_tri: nhom ?? null,
    });
    if (r.error) throw new Error(r.error.message + " (đã chạy giai-doan-29.sql chưa?)");
    return ((r.data ?? []) as Row[]).map((x) => ({ ...x, tong: Number(x.tong), da_thu: Number(x.da_thu), con_no: Number(x.con_no), loi_nhuan: x.loi_nhuan == null ? null : Number(x.loi_nhuan), tong_hang: Number(x.tong_hang) }));
  }, [filterArgs, sort, group]);

  // Tải lại khi đổi bộ lọc / sắp xếp / nhóm / sau khi đổi trạng thái
  useEffect(() => {
    const my = ++req.current;
    setLoading(true); setErr(""); setOpen({});
    (async () => {
      try {
        if (group) {
          const g = await supabase.rpc("ds_phieu_nhom", { ...filterArgs, p_nhom_cot: group });
          if (g.error) throw new Error(g.error.message);
          if (my !== req.current) return;
          const gs = ((g.data ?? []) as Nhom[]).map((x) => ({ ...x, so_luong: Number(x.so_luong), tong: x.tong == null ? null : Number(x.tong) }));
          setNhoms(gs); setRows([]); setTotal(gs.reduce((s, x) => s + x.so_luong, 0));
        } else {
          const d = await fetchRows(0);
          if (my !== req.current) return;
          setRows(d); setTotal(d[0]?.tong_hang ?? 0); setNhoms([]);
        }
      } catch (e) { if (my === req.current) setErr((e as Error).message); }
      if (my === req.current) setLoading(false);
    })();
  }, [fetchRows, filterArgs, group, reloadKey, tick]);

  async function loadMore() {
    setMore(true);
    try { const d = await fetchRows(rows.length); setRows((x) => [...x, ...d]); } catch (e) { setErr((e as Error).message); }
    setMore(false);
  }
  async function toggleNhom(n: string, loadMoreRows = false) {
    const cur = open[n];
    if (cur && !loadMoreRows) { setOpen(({ [n]: _gone, ...rest }) => { void _gone; return rest; }); return; }
    setOpen((o) => ({ ...o, [n]: { rows: cur?.rows ?? [], total: cur?.total ?? 0, busy: true } }));
    try {
      const d = await fetchRows(cur?.rows.length ?? 0, n);
      setOpen((o) => ({ ...o, [n]: { rows: [...(cur?.rows ?? []), ...d], total: d[0]?.tong_hang ?? cur?.total ?? 0, busy: false } }));
    } catch (e) { setErr((e as Error).message); setOpen(({ [n]: _gone, ...rest }) => { void _gone; return rest; }); }
  }

  function pickView(k: string) {
    const v = VIEWS.find((x) => x.key === k)!;
    setView(k); setTt(v.tt); setChiNo(v.chiNo); setKtv("");
    const t = v.homNay ? today() : "";
    setTu(t); setDen(t);
  }
  function clearOther() { setView(""); }
  function sortBy(k: ColKey, dir?: "asc" | "desc") {
    setSort((s) => ({ key: k, dir: dir ?? (s.key === k && s.dir === "asc" ? "desc" : "asc") }));
  }
  function moveCol(k: ColKey, d: -1 | 1) {
    const vis = order.filter((x) => !PINNED.includes(x));
    const i = vis.indexOf(k), j = i + d;
    if (i < 0 || j < 0 || j >= vis.length) return;
    [vis[i], vis[j]] = [vis[j], vis[i]];
    saveCols([...PINNED, ...vis], hidden);
  }
  function dropOn(target: ColKey) {
    const from = dragKey.current;
    dragKey.current = null;
    if (!from || from === target) return;
    const vis = order.filter((x) => !PINNED.includes(x) && x !== from);
    vis.splice(vis.indexOf(target), 0, from);
    saveCols([...PINNED, ...vis], hidden);
  }

  async function exportXlsx() {
    setLoading(true);
    try {
      const r = await supabase.rpc("ds_phieu_tiep_nhan", { ...filterArgs, p_sap_xep: sort.key, p_huong: sort.dir, p_gioi_han: 20000, p_bat_dau: 0, p_nhom_cot: null, p_nhom_gia_tri: null });
      if (r.error) throw new Error(r.error.message);
      const data = (r.data as Row[]).map((x) => ({ ...x, tong: Number(x.tong), da_thu: Number(x.da_thu), con_no: Number(x.con_no), loi_nhuan: x.loi_nhuan == null ? null : Number(x.loi_nhuan) }));
      const num = (r: Row, k: ColKey) => (k === "tong" || k === "da_thu" || k === "con_no" ? r[k] : k === "loi_nhuan" ? (r.loi_nhuan ?? "") : k === "odometer" ? (r.odometer ?? "") : k === "received_at" ? fmtTime(r.received_at) : k === "code" ? ma(r.code) : String(r[k as keyof Row] ?? ""));
      const aoa = [cols.map((c) => c.label), ...data.map((x) => cols.map((c) => num(x, c.key)))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = cols.map((c) => ({ wch: c.key === "issue" ? 40 : c.key === "received_at" ? 19 : 14 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Phiếu tiếp nhận");
      XLSX.writeFile(wb, `phieu-tiep-nhan-${today()}.xlsx`);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }

  const lateRow = (r: Row) => !r.da_huy && ["Chờ xử lý", "Đang sửa"].includes(r.status) && now - Date.parse(r.received_at) > 3 * DAY;
  const bg = (r: Row) => (lateRow(r) ? "bg-amber-50" : "bg-white");

  function renderCell(r: Row, c: Col) {
    const dead = r.da_huy ? "line-through text-slate-400" : "";
    switch (c.key) {
      case "code": return <Link href={`/tiep-nhan/${r.id}`} className={`font-semibold text-navy-900 underline-offset-2 hover:underline ${dead}`}>{ma(r.code)}</Link>;
      case "status": return <StatusBadge status={r.status} />;
      case "issue": {
        const w = wide[r.id];
        return <button type="button" onClick={() => setWide((x) => ({ ...x, [r.id]: !w }))} title={r.issue}
          className={`bare text-left min-h-11 ${w ? "whitespace-normal min-w-[14rem]" : "truncate max-w-[14rem]"} ${dead}`}>{r.issue}</button>;
      }
      case "con_no": return <span className={r.con_no > 0.5 && !r.da_huy ? "font-semibold text-orange-600" : "text-slate-400"}>{cell(r, c.key)}</span>;
      case "loi_nhuan": return <span className={r.loi_nhuan != null && r.loi_nhuan < 0 ? "text-red-700" : ""}>{cell(r, c.key)}</span>;
      default: return <span className={dead}>{cell(r, c.key) || "—"}</span>;
    }
  }
  const stickyL = (i: number) => (i === 0 ? "sticky left-0 z-[1] w-[6.5rem] min-w-[6.5rem]" : i === 1 ? "sticky left-[6.5rem] z-[1] w-[7.5rem] min-w-[7.5rem] shadow-[2px_0_0_#e5ebf3]" : "");

  function trRow(r: Row) {
    return (
      <tr key={r.id} className={r.da_huy ? "opacity-60" : ""}>
        {cols.map((c, i) => (
          <td key={c.key} className={`whitespace-nowrap ${bg(r)} ${stickyL(i)} ${c.num ? "text-right tabular-nums" : ""}`}>{renderCell(r, c)}</td>
        ))}
      </tr>
    );
  }
  function actions(r: Row) {
    return (
      <div className="flex gap-2 items-center flex-wrap">
        {!r.da_huy && (r.stock_deducted
          ? (isOwner && (
            <select className="border px-2 text-sm" value={r.status} onChange={(e) => onStatus(r.id, e.target.value)}>
              {["Hoàn thành", "Đã giao xe"].map((s) => <option key={s}>{s}</option>)}
            </select>))
          : (
            <select className="border px-2 text-sm" value={r.status} onChange={(e) => onStatus(r.id, e.target.value)}>
              {(STATUS_CHON.includes(r.status) ? STATUS_CHON : [r.status, ...STATUS_CHON]).map((s) => <option key={s}>{s}</option>)}
            </select>))}
        <Link href={`/tiep-nhan/${r.id}`} className="btn btn-secondary text-sm !px-3">Báo giá</Link>
        {!r.da_huy && !r.stock_deducted && <button onClick={() => onRemove(r)} className="bare text-red-600 text-sm ml-auto px-3 min-h-11">Xóa phiếu nháp</button>}
        {!r.da_huy && isOwner && <button onClick={() => onCancel(r)} className={`bare text-red-700 text-sm px-3 min-h-11 ${r.stock_deducted ? "ml-auto" : ""}`}>Hủy phiếu</button>}
      </div>
    );
  }
  function liCard(r: Row) {
    const dead = r.da_huy ? "line-through text-slate-400" : "";
    return (
      <li key={r.id} className={`card space-y-2 ${lateRow(r) ? "!bg-amber-50" : ""} ${r.da_huy ? "opacity-70" : ""}`}>
        <Link href={`/tiep-nhan/${r.id}`} className="block space-y-1">
          <div className="flex justify-between gap-2 items-center">
            <div className={`font-semibold text-navy-900 ${dead}`}>{ma(r.code)} · {r.bien_so}</div>
            <StatusBadge status={r.status} />
          </div>
          <div className="flex justify-between gap-2 text-sm">
            <span className={`truncate ${dead}`}>{r.khach}</span>
            <span className={`shrink-0 font-medium ${r.con_no > 0.5 && !r.da_huy ? "text-orange-600" : ""}`}>
              {money(r.tong)}{r.con_no > 0.5 && !r.da_huy ? ` · nợ ${money(r.con_no)}` : ""}
            </span>
          </div>
          <div className="hidden md:block space-y-1">
            <div className={`text-sm ${dead}`}>{r.issue}</div>
            <div className="text-sm text-slate-500">{r.sdt ? `${r.sdt} · ` : ""}{r.xe ? `${r.xe} · ` : ""}{fmtTime(r.received_at)}{r.odometer != null ? ` · ${r.odometer} km` : ""}</div>
          </div>
        </Link>
        {r.da_huy && <p className="text-xs text-red-700">Phiếu đã hủy · không tính vào doanh thu, lợi nhuận.</p>}
        {actions(r)}
      </li>
    );
  }

  const tableHead = (
    <thead>
      <tr>
        {cols.map((c, i) => (
          <th key={c.key} className={`whitespace-nowrap !p-0 ${stickyL(i)} ${c.num ? "text-right" : ""}`}>
            <div className={`flex items-center ${c.num ? "justify-end" : ""}`}>
              <button type="button" onClick={() => sortBy(c.key)} className="bare min-h-11 pl-3 pr-1 font-semibold">
                {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}{loc[c.key] ? " ⚑" : ""}
              </button>
              <button type="button" aria-label={`Menu cột ${c.label}`} onClick={() => setMenu(c.key)} className="bare min-h-11 min-w-9 px-2 text-slate-500">⋮</button>
            </div>
          </th>
        ))}
      </tr>
    </thead>
  );
  const colCount = cols.length;
  const groupLabel = group ? ALL_COLS.find((c) => c.group === group)?.label : "";
  const menuCol = menu ? COL_BY[menu] : null;
  const input = "w-full border px-3 py-2";

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Chế độ xem">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" onClick={() => pickView(v.key)}
            className={`shrink-0 px-3 rounded-full border text-sm ${view === v.key ? "bg-green-600 text-white border-green-600" : "bg-white"}`}>{v.label}</button>
        ))}
      </div>
      <div className="card space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className={input} placeholder="Lọc theo từ khóa (biển số, mã, khách, SĐT, số khung, dòng xe)" value={kw} onChange={(e) => setKw(e.target.value)} />
          <select className={input} value={tt.length === 1 ? tt[0] : ""} onChange={(e) => { setTt(e.target.value ? [e.target.value] : []); clearOther(); }}>
            <option value="">{tt.length > 1 ? "Nhiều trạng thái" : "Mọi trạng thái"}</option>
            {STATUS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className={input} value={ktv} onChange={(e) => { setKtv(e.target.value); clearOther(); }}>
            <option value="">Mọi kỹ thuật viên</option>
            {ktvs.map((k) => <option key={k.id} value={k.id}>{k.ten}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" aria-label="Từ ngày" className={input} value={tu} onChange={(e) => { setTu(e.target.value); clearOther(); }} />
            <input type="date" aria-label="Đến ngày" className={input} value={den} onChange={(e) => { setDen(e.target.value); clearOther(); }} />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button type="button" className="btn btn-secondary text-sm !px-3" onClick={() => setTick((t) => t + 1)}>Làm mới</button>
          <button type="button" className="btn btn-secondary text-sm !px-3" onClick={() => setChooser(true)}>Chọn cột</button>
          <button type="button" className="btn btn-secondary text-sm !px-3" onClick={exportXlsx}>Xuất Excel</button>
          <select aria-label="Nhóm theo" className="border px-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Không nhóm</option>
            {ALL_COLS.filter((c) => c.group).map((c) => <option key={c.group} value={c.group}>Nhóm theo {c.label.toLowerCase()}</option>)}
          </select>
          {Object.values(loc).some(Boolean) && <button type="button" className="btn btn-secondary text-sm !px-3" onClick={() => setLoc({})}>Bỏ lọc cột</button>}
          <div className="ml-auto flex rounded-lg border overflow-hidden" role="group" aria-label="Kiểu hiển thị">
            {(["bang", "the"] as const).map((m) => (
              <button key={m} type="button" onClick={() => pickMode(m)} className={`bare min-h-11 px-4 text-sm ${mode === m ? "bg-green-600 text-white" : "bg-white"}`}>{m === "bang" ? "Bảng" : "Thẻ"}</button>
            ))}
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-red-700 card">{err}</p>}

      {(loading && !rows.length && !nhoms.length) || mode === null ? <LoadingBlock rows={4} /> : (
        <>
          {mode === "bang" ? (
            <div className="card !p-0 overflow-x-auto">
              <table className="tbl">
                {tableHead}
                <tbody>
                  {!group && rows.map(trRow)}
                  {group && nhoms.map((n) => {
                    const o = open[n.nhom];
                    return [
                      <tr key={"g" + n.nhom}>
                        <td colSpan={colCount} className="bg-slate-100 !p-0">
                          <button type="button" onClick={() => toggleNhom(n.nhom)} className="bare w-full text-left min-h-11 px-3 font-semibold sticky left-0">
                            {o ? "▼" : "▶"} {groupLabel}: {n.nhom} · {n.so_luong} phiếu{n.tong != null ? ` · ${money(n.tong)}` : ""}
                          </button>
                        </td>
                      </tr>,
                      ...(o ? [...o.rows.map(trRow), ...(o.busy ? [<tr key={"b" + n.nhom}><td colSpan={colCount} className="text-slate-500">Đang tải...</td></tr>] : []),
                        ...(!o.busy && o.rows.length < o.total ? [<tr key={"m" + n.nhom}><td colSpan={colCount}><button type="button" className="btn btn-secondary text-sm" onClick={() => toggleNhom(n.nhom, true)}>Tải thêm</button></td></tr>] : [])] : []),
                    ];
                  })}
                  {!loading && total === 0 && <tr><td colSpan={colCount} className="text-center text-slate-500">Không có phiếu nào khớp. Thử đổi chế độ xem hoặc bỏ bộ lọc.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="space-y-2">
              {!group && rows.map(liCard)}
              {group && nhoms.map((n) => {
                const o = open[n.nhom];
                return (
                  <li key={n.nhom} className="space-y-2">
                    <button type="button" onClick={() => toggleNhom(n.nhom)} className="bare w-full text-left min-h-11 px-3 rounded-lg bg-slate-100 font-semibold">
                      {o ? "▼" : "▶"} {groupLabel}: {n.nhom} · {n.so_luong} phiếu{n.tong != null ? ` · ${money(n.tong)}` : ""}
                    </button>
                    {o && <ul className="space-y-2">{o.rows.map(liCard)}</ul>}
                    {o?.busy && <p className="text-sm text-slate-500 px-3">Đang tải...</p>}
                    {o && !o.busy && o.rows.length < o.total && <button type="button" className="btn btn-secondary text-sm" onClick={() => toggleNhom(n.nhom, true)}>Tải thêm</button>}
                  </li>
                );
              })}
              {!loading && total === 0 && <li><EmptyState icon={<Icon name="clipboard" />} text="Không có phiếu nào khớp. Thử đổi chế độ xem hoặc bỏ bộ lọc." /></li>}
            </ul>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-slate-600">Số hàng: {total}</span>
            {!group && rows.length < total && (
              <button type="button" disabled={more} onClick={loadMore} className="btn btn-secondary text-sm disabled:opacity-60">{more ? "Đang tải..." : `Tải thêm ${PAGE} dòng`}</button>
            )}
            {loading && <span className="text-sm text-slate-500">Đang tải...</span>}
          </div>
        </>
      )}

      {menuCol && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setMenu(null)}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold">{menuCol.label}</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => { sortBy(menuCol.key, "asc"); setMenu(null); }}>Sắp xếp tăng ▲</button>
              <button type="button" className="btn btn-secondary" onClick={() => { sortBy(menuCol.key, "desc"); setMenu(null); }}>Sắp xếp giảm ▼</button>
            </div>
            {!menuCol.num && menuCol.key !== "loi_nhuan" && (
              <input className={input} placeholder={`Lọc theo ${menuCol.label.toLowerCase()}`} value={loc[menuCol.key] ?? ""}
                onChange={(e) => { setLoc((l) => ({ ...l, [menuCol.key]: e.target.value })); clearOther(); }} />
            )}
            {menuCol.group && (
              <button type="button" className="btn btn-secondary w-full" onClick={() => { setGroup(group === menuCol.group ? "" : menuCol.group!); setMenu(null); }}>
                {group === menuCol.group ? "Bỏ nhóm theo cột này" : "Nhóm theo cột này"}
              </button>
            )}
            {!PINNED.includes(menuCol.key) && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => moveCol(menuCol.key, -1)}>← Sang trái</button>
                <button type="button" className="btn btn-secondary" onClick={() => moveCol(menuCol.key, 1)}>Sang phải →</button>
              </div>
            )}
            <button type="button" className="btn btn-primary w-full" onClick={() => setMenu(null)}>Xong</button>
          </div>
        </div>
      )}

      {chooser && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setChooser(false)}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold">Chọn cột hiển thị</div>
            <p className="text-xs text-slate-500">Bấm ô để bật/tắt. Kéo hoặc bấm ▲▼ để đổi thứ tự. Mã phiếu và Biển số luôn cố định bên trái. Cài đặt được nhớ cho tài khoản này trên thiết bị này.</p>
            <ul className="space-y-1">
              {order.filter((k) => !PINNED.includes(k) && (isOwner || !COL_BY[k].owner)).map((k) => (
                <li key={k} draggable onDragStart={() => { dragKey.current = k; }} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(k)}
                  className="flex items-center gap-2 border rounded-lg px-2">
                  <label className="flex items-center gap-2 flex-1 min-h-11 cursor-pointer">
                    <input type="checkbox" className="w-5 h-5" checked={!hidden.includes(k)} onChange={() => saveCols(order, hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])} />
                    {COL_BY[k].label}
                  </label>
                  <button type="button" aria-label="Lên" className="bare min-h-11 min-w-9" onClick={() => moveCol(k, -1)}>▲</button>
                  <button type="button" aria-label="Xuống" className="bare min-h-11 min-w-9" onClick={() => moveCol(k, 1)}>▼</button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => saveCols(DEFAULT_ORDER, [])}>Mặc định</button>
              <button type="button" className="btn btn-primary" onClick={() => setChooser(false)}>Xong</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
