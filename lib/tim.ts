// Bỏ dấu tiếng Việt, hoa/thường và mọi ký tự không phải chữ/số (dấu cách, chấm, gạch...) để tìm kiếm dễ khớp
export const squash = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");
