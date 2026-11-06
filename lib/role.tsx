"use client";
import { createContext, useContext } from "react";

export type Role = "chu" | "nhan_vien";
export const RoleContext = createContext<Role>("nhan_vien");
export const useRole = () => useContext(RoleContext);
export const roleLabel: Record<Role, string> = { chu: "Chủ xưởng", nhan_vien: "Nhân viên" };
