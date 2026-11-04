// Drizzle schema for this space.
// Tables: the scaffold `entries` table (unused by the UI) and
// `quiz_results`, one row per completed quiz round.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const quizResults = sqliteTable("quiz_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  difficulty: text("difficulty").notNull(),
  total: integer("total").notNull(),
  correct: integer("correct").notNull(),
  percentage: integer("percentage").notNull(),
  playedAt: integer("played_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
