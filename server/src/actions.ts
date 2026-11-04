// Actions for the Quiz App.
//
// Questions come live from the Open Trivia Database (opentdb.com), a free
// keyless public API, fetched here on the server — never from the browser.
// Completed rounds are saved to `quiz_results` so the user builds up their
// own history, best score and averages.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc } from "drizzle-orm";
import * as schema from "./schema";

// Open Trivia DB encodes text with HTML entities (&#039;, &quot;, &eacute;…).
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  Eacute: "É",
  aacute: "á",
  oacute: "ó",
  uacute: "ú",
  agrave: "à",
  egrave: "è",
  ccedil: "ç",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  szlig: "ß",
  ntilde: "ñ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  times: "×",
  divide: "÷",
  plusmn: "±",
  micro: "µ",
  pound: "£",
  euro: "€",
  yen: "¥",
  cent: "¢",
};

function decodeEntities(input: string): string {
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = parseInt(body.slice(2), 16);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      if (body.startsWith("#")) {
        const code = parseInt(body.slice(1), 10);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j] as T;
    arr[j] = tmp as T;
  }
  return arr;
}

interface TriviaResult {
  type: string;
  difficulty: string;
  category: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

interface TriviaResponse {
  response_code: number;
  results: TriviaResult[];
}

const questionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correctIndex: z.number().int(),
  category: z.string(),
  difficulty: z.string(),
});

const fetchQuizResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  questions: z.array(questionSchema),
});

export const Actions = {
  fetchQuiz: defineAction({
    request: z.object({
      amount: z.number().int().min(5).max(20),
      categoryId: z.number().int().positive().nullable(),
      difficulty: z.enum(["any", "easy", "medium", "hard"]),
    }),
    response: fetchQuizResponse,
    async handler(_ctx, args): Promise<z.infer<typeof fetchQuizResponse>> {
      const params = new URLSearchParams({
        amount: String(args.amount),
        type: "multiple",
      });
      if (args.categoryId != null) {
        params.set("category", String(args.categoryId));
      }
      if (args.difficulty !== "any") {
        params.set("difficulty", args.difficulty);
      }
      const url = `https://opentdb.com/api.php?${params.toString()}`;

      let data: TriviaResponse;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          return {
            ok: false,
            error: `The trivia service replied with an error (HTTP ${res.status}). Please try again in a few seconds.`,
            questions: [],
          };
        }
        data = (await res.json()) as TriviaResponse;
      } catch {
        return {
          ok: false,
          error:
            "Could not reach the trivia service. Check your connection and try again.",
          questions: [],
        };
      }

      if (data.response_code === 1 || !data.results || data.results.length === 0) {
        return {
          ok: false,
          error:
            "No questions found for that combination. Try a different category or difficulty.",
          questions: [],
        };
      }
      if (data.response_code === 5) {
        return {
          ok: false,
          error:
            "The trivia service is rate-limiting requests right now. Wait a few seconds and try again.",
          questions: [],
        };
      }
      if (data.response_code !== 0) {
        return {
          ok: false,
          error: "The trivia service could not build that quiz. Please try again.",
          questions: [],
        };
      }

      const questions = data.results.map((r) => {
        const correct = decodeEntities(r.correct_answer);
        const options = shuffle([
          correct,
          ...r.incorrect_answers.map(decodeEntities),
        ]);
        return {
          question: decodeEntities(r.question),
          options,
          correctIndex: options.indexOf(correct),
          category: decodeEntities(r.category),
          difficulty: r.difficulty,
        };
      });

      return { ok: true, error: null, questions };
    },
  }),

  saveResult: defineAction({
    request: z.object({
      category: z.string().min(1).max(120),
      difficulty: z.string().min(1).max(20),
      total: z.number().int().min(1).max(50),
      correct: z.number().int().min(0).max(50),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      if (args.correct > args.total) {
        throw new Error("saveResult: correct cannot exceed total");
      }
      const db = ctx.db<typeof schema>();
      const percentage = Math.round((args.correct / args.total) * 100);
      const result = await db
        .insert(schema.quizResults)
        .values({
          category: args.category,
          difficulty: args.difficulty,
          total: args.total,
          correct: args.correct,
          percentage,
        })
        .returning({ id: schema.quizResults.id });
      const inserted = result[0];
      if (!inserted) {
        throw new Error("saveResult: insert returned no rows");
      }
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  getHistory: defineAction({
    request: z.object({
      limit: z.number().int().positive().max(100).default(20),
    }),
    response: z.object({
      results: z.array(
        z.object({
          id: z.number(),
          category: z.string(),
          difficulty: z.string(),
          total: z.number(),
          correct: z.number(),
          percentage: z.number(),
          played_at: z.string(),
        }),
      ),
      stats: z.object({
        played: z.number(),
        bestPercentage: z.number(),
        averagePercentage: z.number(),
        totalCorrect: z.number(),
        totalQuestions: z.number(),
      }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const all = await db
        .select()
        .from(schema.quizResults)
        .orderBy(desc(schema.quizResults.id));
      const played = all.length;
      const totalCorrect = all.reduce((sum, r) => sum + r.correct, 0);
      const totalQuestions = all.reduce((sum, r) => sum + r.total, 0);
      const bestPercentage =
        played === 0 ? 0 : Math.max(...all.map((r) => r.percentage));
      const averagePercentage =
        played === 0
          ? 0
          : Math.round(all.reduce((sum, r) => sum + r.percentage, 0) / played);
      return {
        results: all.slice(0, args.limit).map((row) => ({
          id: row.id,
          category: row.category,
          difficulty: row.difficulty,
          total: row.total,
          correct: row.correct,
          percentage: row.percentage,
          played_at: row.playedAt.toISOString(),
        })),
        stats: {
          played,
          bestPercentage,
          averagePercentage,
          totalCorrect,
          totalQuestions,
        },
      };
    },
  }),

  clearHistory: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.quizResults);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
