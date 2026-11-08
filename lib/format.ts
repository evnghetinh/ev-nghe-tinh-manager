export const money = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + " đ";
// Giá vốn mỗi đơn vị bán có thể lẻ (vd 33.333,3333 đ/lít): hiện tối đa 2 số lẻ
export const money2 = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n) + " đ";
export const digits = (s: string) => s.replace(/\D/g, "");

// Số lượng: cho phép số lẻ tối đa 3 chữ số thập phân. Nhận cả dấu phẩy lẫn dấu chấm.
export const qtyText = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(n);
export function decimalInput(s: string, maxDec = 3): string {
  const t = s.replace(",", ".").replace(/[^\d.]/g, "");
  const i = t.indexOf(".");
  if (i < 0) return t;
  return t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "").slice(0, maxDec);
}
// "12,5" hoặc "12.5" -> 12.5
export const toNum = (s: string) => Number(s.replace(",", "."));

export type DonVi = { don_vi_nhap: string; don_vi_ban: string; he_so: number };
export const COT_PHU_TUNG = "id, name, code, sale_price, stock, don_vi_nhap, don_vi_ban, he_so";
export const donViMacDinh = (p: { don_vi_ban?: string | null }) => p.don_vi_ban || "cái";

// Tồn dễ đọc: "12,5 lít (khoảng 2 can 2,5 lít)"
export function tonText(stock: number, p: DonVi): string {
  const ban = qtyText(stock) + " " + p.don_vi_ban;
  const he = Number(p.he_so);
  if (!(he > 1) || p.don_vi_nhap === p.don_vi_ban || stock < he) return ban;
  const whole = Math.floor(stock / he + 1e-9);
  const rem = Math.round((stock - whole * he) * 1000) / 1000;
  const nhap = `${qtyText(whole)} ${p.don_vi_nhap}`;
  return rem > 0 ? `${ban} (khoảng ${nhap} ${qtyText(rem)} ${p.don_vi_ban})` : `${ban} (${nhap})`;
}

// Hãng + dòng xe: "VinFast VF5" (bỏ trống thì trả chuỗi rỗng)
export const tenXe = (v: { hang_xe?: string | null; dong_xe?: string | null } | null | undefined) =>
  [v?.hang_xe, v?.dong_xe].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
// Năm, màu: "2023 · Trắng"
export const namMauXe = (v: { nam_san_xuat?: number | null; mau_xe?: string | null } | null | undefined) =>
  [v?.nam_san_xuat ? String(v.nam_san_xuat) : "", (v?.mau_xe ?? "").trim()].filter(Boolean).join(" · ");
