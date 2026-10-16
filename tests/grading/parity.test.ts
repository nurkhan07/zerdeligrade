/**
 * The browser preview (scoreAnswers) must agree with the database scorer
 * (public.recompute_result), which is the only source of stored scores.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { scoreAnswers } from "@/lib/grading/score";
import type { OptionLabel } from "@/lib/omr/layout";
import { addMember, admin, asService, asUser, createCenter, createTestDb, createUser } from "../db/harness";

let db: PGlite;
let center: string;
let user: string;
let subject: string;

beforeAll(async () => {
  db = await createTestDb();
  center = await createCenter(db, "PAR-01");
  user = await createUser(db, "parity@zerdeli.kz");
  await addMember(db, center, user, "center_admin");
  subject = (await admin<{ id: string }>(db, "select id from public.subjects where code = 'math'"))[0]!.id;
});

const LABELS: OptionLabel[] = ["A", "B", "C", "D", "E"];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

describe("score parity between browser preview and database", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("random test #%i", async (seed) => {
    const r = rng(seed * 7919);
    const n = 5 + Math.floor(r() * 25);
    const negative = r() < 0.5;
    const negativePoints = negative ? [0.25, 0.5, 1][Math.floor(r() * 3)]! : 0;
    const questions = Array.from({ length: n }, (_, i) => {
      const tf = r() < 0.2;
      const count = tf ? 2 : 4 + Math.floor(r() * 2);
      return {
        position: i + 1,
        type: tf ? "true_false" : "single_choice",
        points: [0.5, 1, 2, 3][Math.floor(r() * 4)]!,
        correct: LABELS[Math.floor(r() * count)]!,
        options: LABELS.slice(0, count).map((label) => ({ label })),
      };
    });
    const passing = Math.round(r() * n);
    const [t] = await asUser<{ id: string }>(
      db,
      user,
      `insert into public.tests (center_id, title, subject_id, question_count, negative_marking, negative_points, passing_score, created_by)
       values ($1, 'Parity', $2, $3, $4, $5, $6, $7) returning id`,
      [center, subject, n, negative, negativePoints, passing, user],
    );
    await asUser(db, user, "select public.save_test_content($1, $2::jsonb)", [t!.id, JSON.stringify(questions)]);
    await asUser(db, user, "select public.publish_test($1)", [t!.id]);

    const answers: Record<number, OptionLabel | null> = {};
    const recognized = questions.map((q) => {
      const chosen = r() < 0.15 ? null : q.options[Math.floor(r() * q.options.length)]!.label;
      answers[q.position] = chosen;
      return { position: q.position, chosen, status: chosen ? "ok" : "blank", detected: chosen ? [chosen] : [], confidence: 1, fill: {} };
    });
    const [job] = await asService<{ id: string }>(
      db,
      "insert into public.scan_jobs (center_id, test_id, uploaded_by) values ($1,$2,$3) returning id",
      [center, t!.id, user],
    );
    const [{ create_scan_result: id }] = (await asService<{ create_scan_result: string }>(
      db,
      "select public.create_scan_result($1, $2::jsonb)",
      [job!.id, JSON.stringify(recognized)],
    )) as [{ create_scan_result: string }];
    const [row] = await asUser<Record<string, string | number | boolean>>(
      db,
      user,
      "select score, max_score, percentage, passed, correct_count, incorrect_count, blank_count from public.assessment_results where id = $1",
      [id],
    );

    const preview = scoreAnswers(
      questions.map((q) => ({ position: q.position, points: q.points, correct: q.correct })),
      { negativeMarking: negative, negativePoints, passingScore: passing },
      answers,
    );
    expect({
      score: Number(row!.score),
      max: Number(row!.max_score),
      pct: Number(row!.percentage),
      passed: row!.passed,
      c: row!.correct_count,
      i: row!.incorrect_count,
      b: row!.blank_count,
    }).toEqual({
      score: preview.score,
      max: preview.maxScore,
      pct: preview.percentage,
      passed: preview.passed,
      c: preview.correct,
      i: preview.incorrect,
      b: preview.blank,
    });
  });
});
