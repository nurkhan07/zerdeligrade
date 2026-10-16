/**
 * Client-side score PREVIEW used on the review screen while a teacher edits
 * answers. It mirrors public.recompute_result() in the database, which is the
 * only place where stored scores are computed (see tests/grading/parity.test.ts).
 */
import type { OptionLabel } from "@/lib/omr/layout";

export interface ScoringQuestion {
  position: number;
  points: number;
  correct: OptionLabel;
}

export interface ScoringRules {
  negativeMarking: boolean;
  negativePoints: number;
  passingScore: number;
}

export interface ScoreBreakdown {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  correct: number;
  incorrect: number;
  blank: number;
  perQuestion: Array<{ position: number; selected: OptionLabel | null; isCorrect: boolean; points: number }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreAnswers(
  questions: ScoringQuestion[],
  rules: ScoringRules,
  answers: Record<number, OptionLabel | null | undefined>,
): ScoreBreakdown {
  let correct = 0;
  let incorrect = 0;
  let blank = 0;
  let total = 0;
  let maxScore = 0;
  const perQuestion = questions.map((q) => {
    maxScore += q.points;
    const selected = answers[q.position] ?? null;
    let points = 0;
    let isCorrect = false;
    if (selected === null) {
      blank++;
    } else if (selected === q.correct) {
      correct++;
      isCorrect = true;
      points = q.points;
    } else {
      incorrect++;
      points = rules.negativeMarking ? -rules.negativePoints : 0;
    }
    total += points;
    return { position: q.position, selected, isCorrect, points };
  });
  const score = round2(Math.max(0, total));
  return {
    score,
    maxScore: round2(maxScore),
    percentage: maxScore > 0 ? round2((score / maxScore) * 100) : 0,
    passed: score >= rules.passingScore,
    correct,
    incorrect,
    blank,
    perQuestion,
  };
}
