/**
 * Zod schemas shared by client forms (React Hook Form) and server actions.
 * Error messages are i18n keys from `validation.*`; the UI translates them.
 */
import { z } from "zod";

const name = z.string().trim().min(1, "required").max(100, "tooLong");
const uuid = z.string().uuid();
const optionalUuid = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const studentSchema = z.object({
  id: uuid.optional(),
  first_name: name,
  last_name: name,
  student_code: z
    .union([z.string().trim().max(32, "tooLong").regex(/^[A-Za-z0-9_-]*$/, "code"), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  class_id: optionalUuid,
  status: z.enum(["active", "inactive", "graduated"]).default("active"),
});
export type StudentInput = z.input<typeof studentSchema>;
export type StudentOutput = z.output<typeof studentSchema>;

export const classSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "required").max(100, "tooLong"),
  kind: z.enum(["class", "group"]),
  grade: z
    .union([z.coerce.number().int().min(0, "range").max(12, "range"), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  academic_year: z.string().trim().max(20, "tooLong").default(""),
  is_active: z.boolean().default(true),
});
export type ClassInput = z.input<typeof classSchema>;

export const centerSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2, "tooShort").max(200, "tooLong"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "code"),
  city: z.string().trim().max(100, "tooLong").default(""),
  address: z.string().trim().max(300, "tooLong").default(""),
});
export type CenterInput = z.input<typeof centerSchema>;

export const testMetaSchema = z
  .object({
    id: uuid.optional(),
    title: z.string().trim().min(2, "tooShort").max(200, "tooLong"),
    subject_id: uuid,
    grade: z
      .union([z.coerce.number().int().min(0, "range").max(12, "range"), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    language: z.enum(["kk", "ru"]),
    instructions: z.string().trim().max(2000, "tooLong").default(""),
    question_count: z.coerce.number().int("number").min(1, "range").max(120, "range"),
    negative_marking: z.boolean().default(false),
    negative_points: z.coerce.number().min(0, "range").max(10, "range").default(0),
    passing_score: z.coerce.number().min(0, "range").max(10000, "range").default(0),
    time_limit_minutes: z
      .union([z.coerce.number().int().min(1, "range").max(600, "range"), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    is_template: z.boolean().default(false),
    hq_template: z.boolean().default(false),
  })
  .transform((v) => ({ ...v, negative_points: v.negative_marking ? v.negative_points : 0 }));
export type TestMetaInput = z.input<typeof testMetaSchema>;

export const LABELS = ["A", "B", "C", "D", "E"] as const;

export const questionSchema = z.object({
  position: z.number().int().min(1).max(120),
  type: z.enum(["single_choice", "true_false"]),
  option_count: z.number().int().min(2).max(5),
  prompt: z.string().max(2000, "tooLong").default(""),
  points: z.coerce.number().gt(0, "range").max(100, "range"),
  correct: z.enum(LABELS).nullable(),
  options: z.array(z.string().max(500, "tooLong")).max(5).default([]),
});
export const questionsSchema = z.array(questionSchema).min(1).max(120);
export type QuestionInput = z.input<typeof questionSchema>;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("email").max(320, "tooLong"),
  full_name: z.string().trim().min(2, "tooShort").max(200, "tooLong"),
  role: z.enum(["center_admin", "teacher"]),
  center_id: uuid,
  can_finalize: z.boolean().default(true),
});
export type InviteInput = z.input<typeof inviteSchema>;

export const subjectSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,40}$/, "code"),
  name_kk: z.string().trim().min(1, "required").max(100, "tooLong"),
  name_ru: z.string().trim().min(1, "required").max(100, "tooLong"),
});

/** Flattens zod issues into { field: i18n-key }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
