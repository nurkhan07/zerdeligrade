import { describe, expect, it } from "vitest";
import { buildImportPreview, mapHeaders } from "@/lib/csv/students";

const ctx = {
  existingCodes: new Set(["s-001"]),
  existingNames: new Set(["ахметов|ерлан"]),
  classesByName: new Map([
    ["9a", "class-9a"],
    ["10б", "class-10b"],
  ]),
};

describe("student CSV import", () => {
  it("maps Russian, Kazakh and English headers", () => {
    expect(mapHeaders(["Фамилия", "Имя", "Код", "Класс"])).toEqual({
      last_name: "Фамилия",
      first_name: "Имя",
      student_code: "Код",
      class_name: "Класс",
    });
    expect(mapHeaders(["Тегі", "Аты", "Сынып"])).toMatchObject({ last_name: "Тегі", first_name: "Аты", class_name: "Сынып" });
    expect(mapHeaders(["last_name", "first_name"])).toMatchObject({ last_name: "last_name", first_name: "first_name" });
  });

  it("validates rows and reports precise issues", () => {
    const csv = [
      "Фамилия;Имя;Код;Класс",
      "Сейткали;Аружан;S-002;9A",
      ";Без фамилии;S-003;9A",
      "Иванов;Иван;S-001;9A",
      "Петров;Пётр;S-004;11Z",
      "Сидоров;Сидор;S-005;",
      "Сидорова;Анна;S-005;10Б",
      "Ахметов;Ерлан;;9A",
      "Плохой;Код;S 9!;9A",
    ].join("\n");
    const p = buildImportPreview(csv, ctx);
    expect(p.rows.map((r) => r.errors.map((e) => e.issue))).toEqual([
      [],
      ["required"],
      ["duplicate_code_existing"],
      ["unknown_class"],
      [],
      ["duplicate_code_in_file"],
      [],
      ["invalid_code"],
    ]);
    expect(p.rows[0]!.classId).toBe("class-9a");
    expect(p.rows[5]!.classId).toBe("class-10b");
    expect(p.rows[6]!.warnings.map((w) => w.issue)).toEqual(["possible_duplicate_name"]);
    expect(p.rows[6]!.data?.student_code).toBeNull();
    expect(p.validCount).toBe(3);
  });

  it("requires the name columns", () => {
    expect(buildImportPreview("Code,Class\nA1,9A", ctx).missingColumns).toEqual(["last_name", "first_name"]);
  });

  it("handles a UTF-8 BOM, comma delimiter and Kazakh letters", () => {
    const p = buildImportPreview("﻿last_name,first_name\nНұрлан,Әлия", ctx);
    expect(p.rows[0]!.data).toMatchObject({ last_name: "Нұрлан", first_name: "Әлия" });
  });
});
