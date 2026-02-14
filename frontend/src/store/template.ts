import { create } from "zustand";
import type { ColumnSchema } from "../types/api";

interface TemplateState {
  templateRow: Record<string, unknown> | null;
  templateTable: string;
  templateColumns: ColumnSchema[];
  changeColumn: string;
  setTemplate: (row: Record<string, unknown>, table: string, columns: ColumnSchema[]) => void;
  clearTemplate: () => void;
  setChangeColumn: (col: string) => void;
}

export const useTemplateStore = create<TemplateState>((set) => ({
  templateRow: null,
  templateTable: "",
  templateColumns: [],
  changeColumn: "",
  setTemplate: (templateRow, templateTable, templateColumns) =>
    set({ templateRow, templateTable, templateColumns, changeColumn: "" }),
  clearTemplate: () =>
    set({ templateRow: null, templateTable: "", templateColumns: [], changeColumn: "" }),
  setChangeColumn: (changeColumn) => set({ changeColumn }),
}));
