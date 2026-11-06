export const money = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " đ";
export const digits = (s: string) => s.replace(/\D/g, "");
