import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type QuizData = ApiResponse<typeof api, "fetchQuiz">;
type Question = QuizData["questions"][number];

// Category list copied verbatim from https://opentdb.com/api_category.php
const CATEGORIES: { id: number | null; name: string }[] = [
  { id: null, name: "Any Category" },
  { id: 9, name: "General Knowledge" },
  { id: 10, name: "Entertainment: Books" },
  { id: 11, name: "Entertainment: Film" },
  { id: 12, name: "Entertainment: Music" },
  { id: 13, name: "Entertainment: Musicals & Theatres" },
  { id: 14, name: "Entertainment: Television" },
  { id: 15, name: "Entertainment: Video Games" },
  { id: 16, name: "Entertainment: Board Games" },
  { id: 17, name: "Science & Nature" },
  { id: 18, name: "Science: Computers" },
  { id: 19, name: "Science: Mathematics" },
  { id: 20, name: "Mythology" },
  { id: 21, name: "Sports" },
  { id: 22, name: "Geography" },
  { id: 23, name: "History" },
  { id: 24, name: "Politics" },
  { id: 25, name: "Art" },
  { id: 26, name: "Celebrities" },
  { id: 27, name: "Animals" },
  { id: 28, name: "Vehicles" },
  { id: 29, name: "Entertainment: Comics" },
  { id: 30, name: "Science: Gadgets" },
  { id: 31, name: "Entertainment: Japanese Anime & Manga" },
  { id: 32, name: "Entertainment: Cartoon & Animations" },
];

const DIFFICULTIES = [
  { value: "any", label: "Any" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
] as const;

type DifficultyValue = (typeof DIFFICULTIES)[number]["value"];

const AMOUNTS = [5, 10, 15, 20];
const TIME_PER_QUESTION = 30;
const LETTERS = ["A", "B", "C", "D"];

type Phase = "setup" | "playing" | "results";

function difficultyLabel(d: string): string {
  if (d === "any") return "Any difficulty";
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function scoreMessage(pct: number): string {
  if (pct === 100) return "Perfect round — flawless!";
  if (pct >= 80) return "Brilliant — nearly perfect!";
  if (pct >= 60) return "Solid work — keep climbing!";
  if (pct >= 40) return "Good effort — one more round?";
  return "Tough round — try Easy mode to warm up.";
}

export function App() {
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>("setup");
  const [categoryId, setCategoryId] = useState<number | null>(18);
  const [difficulty, setDifficulty] = useState<DifficultyValue>("easy");
  const [amount, setAmount] = useState<number>(10);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [roundCategory, setRoundCategory] = useState<string>("");
  const [roundDifficulty, setRoundDifficulty] = useState<string>("");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [timeLeft, setTimeLeft] = useState(TIME_PER_QUESTION);
  const savedRef = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const history = useQuery({
    queryKey: ["history"],
    queryFn: () => api.getHistory({ limit: 20 }),
  });

  const fetchQuiz = useMutation({
    mutationFn: () =>
      api.fetchQuiz({ amount, categoryId, difficulty }),
    onSuccess: (data) => {
      if (!data.ok || data.questions.length === 0) {
        setFetchError(data.error ?? "Could not load questions. Try again.");
        return;
      }
      setFetchError(null);
      setQuestions(data.questions);
      const first = data.questions[0];
      setRoundCategory(
        categoryId == null
          ? "Mixed categories"
          : (CATEGORIES.find((c) => c.id === categoryId)?.name ??
              first?.category ??
              ""),
      );
      setRoundDifficulty(difficultyLabel(difficulty));
      setIndex(0);
      setPicked(null);
      setAnswers([]);
      setTimeLeft(TIME_PER_QUESTION);
      savedRef.current = false;
      setPhase("playing");
    },
    onError: () => {
      setFetchError("Could not load questions. Check your connection and try again.");
    },
  });

  const saveResult = useMutation({
    mutationFn: (args: {
      category: string;
      difficulty: string;
      total: number;
      correct: number;
    }) => api.saveResult(args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const clearHistory = useMutation({
    mutationFn: () => api.clearHistory({}),
    onSuccess: () => {
      setConfirmClear(false);
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const current: Question | undefined = questions[index];
  const correctCount = answers.reduce(
    (sum, pick, i) => sum + (pick === questions[i]?.correctIndex ? 1 : 0),
    0,
  );

  // Countdown timer for the current question.
  useEffect(() => {
    if (phase !== "playing" || picked !== null) return;
    if (timeLeft <= 0) {
      setPicked(-1);
      setAnswers((prev) => {
        const next = [...prev];
        next[index] = -1;
        return next;
      });
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, picked, timeLeft, index]);

  // Save the finished round exactly once when the results screen opens.
  useEffect(() => {
    if (phase !== "results" || savedRef.current || questions.length === 0) {
      return;
    }
    savedRef.current = true;
    saveResult.mutate({
      category: roundCategory,
      difficulty: roundDifficulty,
      total: questions.length,
      correct: correctCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function pickAnswer(i: number) {
    if (picked !== null) return;
    setPicked(i);
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = i;
      return next;
    });
  }

  function nextQuestion() {
    if (index + 1 >= questions.length) {
      setPhase("results");
    } else {
      setIndex(index + 1);
      setPicked(null);
      setTimeLeft(TIME_PER_QUESTION);
    }
  }

  function backToSetup() {
    setPhase("setup");
    setQuestions([]);
    setFetchError(null);
  }

  const pct =
    questions.length === 0
      ? 0
      : Math.round((correctCount / questions.length) * 100);
  const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : pct >= 35 ? 1 : 0;

  return (
    <div className="min-h-screen bg-[var(--bg)] font-[system-ui] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4">
        {phase === "setup" && (
          <>
            <p className="font-[Archivo,system-ui,sans-serif] text-4xl font-black leading-tight tracking-tight">
              Ready to play?
            </p>
            <p className="mt-2 text-base text-[var(--dim)]">
              Fresh questions every round — pick a category and beat the clock.
            </p>

            <div className="mt-6">
              <label
                htmlFor="category"
                className="text-sm font-bold uppercase tracking-wide text-[var(--dim)]"
              >
                Category
              </label>
              <select
                id="category"
                value={categoryId === null ? "" : String(categoryId)}
                onChange={(e) =>
                  setCategoryId(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                className="mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base font-semibold text-[var(--text)]"
              >
                {CATEGORIES.map((c) => (
                  <option
                    key={c.name}
                    value={c.id === null ? "" : String(c.id)}
                  >
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5">
              <p className="text-sm font-bold uppercase tracking-wide text-[var(--dim)]">
                Difficulty
              </p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Difficulty">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={difficulty === d.value}
                    onClick={() => setDifficulty(d.value)}
                    className={`rounded-full px-5 py-2.5 text-base font-bold ${
                      difficulty === d.value
                        ? "bg-[var(--text)] text-[var(--bg)]"
                        : "border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="text-sm font-bold uppercase tracking-wide text-[var(--dim)]">
                Questions
              </p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Number of questions">
                {AMOUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={amount === n}
                    onClick={() => setAmount(n)}
                    className={`rounded-full px-5 py-2.5 text-base font-bold ${
                      amount === n
                        ? "bg-[var(--text)] text-[var(--bg)]"
                        : "border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {fetchError && (
              <p
                role="alert"
                className="mt-5 rounded-[var(--radius)] border-2 border-[var(--lose)] bg-[var(--surface)] px-4 py-3 text-base font-semibold text-[var(--lose)]"
              >
                {fetchError}
              </p>
            )}

            <button
              type="button"
              onClick={() => fetchQuiz.mutate()}
              disabled={fetchQuiz.isPending}
              className="mt-6 w-full rounded-[var(--radius)] bg-[var(--accent)] px-6 py-4 font-[Archivo,system-ui,sans-serif] text-xl font-extrabold text-[var(--accent-ink)] disabled:opacity-60"
            >
              {fetchQuiz.isPending ? "Loading questions…" : "Start Quiz"}
            </button>
            <p className="mt-3 text-center text-sm text-[var(--dim)]">
              {TIME_PER_QUESTION} seconds per question · Questions from the
              Open Trivia DB
            </p>

            {history.data && history.data.stats.played > 0 && (
              <section className="mt-10" aria-label="Your scores">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-[var(--radius)] bg-[var(--surface)] px-2 py-4">
                    <p className="font-[Archivo,system-ui,sans-serif] text-3xl font-black">
                      {history.data.stats.played}
                    </p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                      Rounds
                    </p>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface)] px-2 py-4">
                    <p className="font-[Archivo,system-ui,sans-serif] text-3xl font-black">
                      {history.data.stats.bestPercentage}%
                    </p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                      Best score
                    </p>
                  </div>
                  <div className="rounded-[var(--radius)] bg-[var(--surface)] px-2 py-4">
                    <p className="font-[Archivo,system-ui,sans-serif] text-3xl font-black">
                      {history.data.stats.averagePercentage}%
                    </p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                      Average
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <h2 className="font-[Archivo,system-ui,sans-serif] text-xl font-extrabold">
                    Past rounds
                  </h2>
                  {confirmClear ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => clearHistory.mutate()}
                        disabled={clearHistory.isPending}
                        className="rounded-full bg-[var(--lose)] px-4 py-1.5 text-sm font-bold text-white"
                      >
                        Confirm clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClear(false)}
                        className="rounded-full border-2 border-[var(--border)] px-4 py-1.5 text-sm font-bold"
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClear(true)}
                      className="text-sm font-bold text-[var(--dim)] underline"
                    >
                      Clear history
                    </button>
                  )}
                </div>

                <ul className="mt-3 divide-y divide-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)]">
                  {history.data.results.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold">
                          {r.category}
                        </p>
                        <p className="text-sm text-[var(--dim)]">
                          {r.difficulty} ·{" "}
                          {new Date(r.played_at).toLocaleDateString(
                            undefined,
                            { day: "numeric", month: "short" },
                          )}{" "}
                          ·{" "}
                          {new Date(r.played_at).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                        </p>
                      </div>
                      <p className="shrink-0 text-right">
                        <span className="font-[Archivo,system-ui,sans-serif] text-xl font-extrabold">
                          {r.correct}/{r.total}
                        </span>{" "}
                        <span className="text-sm font-bold text-[var(--dim)]">
                          {r.percentage}%
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {history.data && history.data.stats.played === 0 && (
              <p className="mt-10 rounded-[var(--radius)] bg-[var(--surface-alt)] px-4 py-4 text-center text-base font-semibold text-[var(--dim)]">
                No rounds yet — your scores will show up here after your first
                quiz.
              </p>
            )}
          </>
        )}

        {phase === "playing" && current && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold uppercase tracking-wide text-[var(--dim)]">
                Question {index + 1} of {questions.length}
              </p>
              <p className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-sm font-bold">
                Score: {correctCount}
              </p>
            </div>

            <div
              className="mt-3 h-3 w-full overflow-hidden rounded-full bg-[var(--border)]"
              role="progressbar"
              aria-label="Time left for this question"
              aria-valuenow={timeLeft}
              aria-valuemin={0}
              aria-valuemax={TIME_PER_QUESTION}
            >
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                  timeLeft <= 10
                    ? "bg-[var(--lose)]"
                    : "bg-[var(--accent)]"
                }`}
                style={{
                  width: `${(timeLeft / TIME_PER_QUESTION) * 100}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-right text-sm font-bold text-[var(--dim)]">
              {picked === null ? `${timeLeft}s left` : " "}
            </p>

            <p className="mt-1 inline-block rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
              {current.category} · {difficultyLabel(current.difficulty)}
            </p>

            <h2 className="mt-3 font-[Archivo,system-ui,sans-serif] text-2xl font-extrabold leading-snug sm:text-3xl">
              {current.question}
            </h2>

            <div className="mt-6 grid gap-3">
              {current.options.map((option, i) => {
                const isCorrect = i === current.correctIndex;
                const isPicked = picked === i;
                let cls =
                  "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]";
                if (picked !== null) {
                  if (isCorrect) {
                    cls =
                      "border-[var(--win)] bg-[var(--win)] text-white";
                  } else if (isPicked) {
                    cls =
                      "border-[var(--lose)] bg-[var(--lose)] text-white";
                  } else {
                    cls =
                      "border-[var(--border)] bg-[var(--surface)] text-[var(--dim)] opacity-60";
                  }
                }
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickAnswer(i)}
                    disabled={picked !== null}
                    aria-label={`Option ${LETTERS[i] ?? ""}: ${option}`}
                    className={`flex w-full items-center gap-3 rounded-[var(--radius)] border-2 px-4 py-4 text-left text-base font-semibold ${cls}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 font-[Archivo,system-ui,sans-serif] text-sm font-extrabold">
                      {LETTERS[i]}
                    </span>
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>

            {picked !== null && (
              <div className="mt-6">
                <p
                  role="status"
                  className={`text-lg font-extrabold ${
                    picked === current.correctIndex
                      ? "text-[var(--win)]"
                      : "text-[var(--lose)]"
                  }`}
                >
                  {picked === -1
                    ? `Time's up! The answer was: ${current.options[current.correctIndex] ?? ""}`
                    : picked === current.correctIndex
                      ? "Correct! Nice one."
                      : `Not quite — the answer was: ${current.options[current.correctIndex] ?? ""}`}
                </p>
                <button
                  type="button"
                  onClick={nextQuestion}
                  className="mt-4 w-full rounded-[var(--radius)] bg-[var(--accent)] px-6 py-4 font-[Archivo,system-ui,sans-serif] text-xl font-extrabold text-[var(--accent-ink)]"
                >
                  {index + 1 >= questions.length
                    ? "See my score"
                    : "Next question"}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={backToSetup}
              className="mt-6 text-sm font-bold text-[var(--dim)] underline"
            >
              Quit this round
            </button>
          </>
        )}

        {phase === "results" && (
          <>
            <p className="text-center text-sm font-bold uppercase tracking-wide text-[var(--dim)]">
              {roundCategory} · {roundDifficulty}
            </p>
            <p
              className="mt-3 text-center text-5xl"
              aria-label={`${stars} out of 3 stars`}
            >
              {[0, 1, 2].map((s) => (
                <span key={s} className={s < stars ? "" : "opacity-25"}>
                  ★
                </span>
              ))}
            </p>
            <p className="mt-2 text-center font-[Archivo,system-ui,sans-serif] text-6xl font-black">
              {correctCount}
              <span className="text-3xl text-[var(--dim)]">
                /{questions.length}
              </span>
            </p>
            <p className="mt-1 text-center text-xl font-bold">{pct}%</p>
            <p className="mt-2 text-center text-lg font-semibold text-[var(--dim)]">
              {scoreMessage(pct)}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => fetchQuiz.mutate()}
                disabled={fetchQuiz.isPending}
                className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-4 font-[Archivo,system-ui,sans-serif] text-lg font-extrabold text-[var(--accent-ink)] disabled:opacity-60"
              >
                {fetchQuiz.isPending ? "Loading…" : "Play again"}
              </button>
              <button
                type="button"
                onClick={backToSetup}
                className="rounded-[var(--radius)] border-2 border-[var(--border)] bg-[var(--surface)] px-4 py-4 font-[Archivo,system-ui,sans-serif] text-lg font-extrabold"
              >
                Change settings
              </button>
            </div>
            {fetchError && (
              <p role="alert" className="mt-4 text-center font-semibold text-[var(--lose)]">
                {fetchError}
              </p>
            )}

            <h2 className="mt-10 font-[Archivo,system-ui,sans-serif] text-xl font-extrabold">
              Round review
            </h2>
            <ol className="mt-3 grid gap-3">
              {questions.map((q, i) => {
                const pick = answers[i];
                const wasCorrect = pick === q.correctIndex;
                return (
                  <li
                    key={i}
                    className="rounded-[var(--radius)] bg-[var(--surface)] px-4 py-4"
                  >
                    <p className="font-bold">
                      <span
                        className={
                          wasCorrect
                            ? "text-[var(--win)]"
                            : "text-[var(--lose)]"
                        }
                      >
                        {wasCorrect ? "✓" : "✗"}
                      </span>{" "}
                      {i + 1}. {q.question}
                    </p>
                    <p className="mt-2 text-sm">
                      <span className="font-bold text-[var(--dim)]">
                        Your answer:{" "}
                      </span>
                      {pick === undefined || pick === -1
                        ? "No answer (time ran out)"
                        : (q.options[pick] ?? "—")}
                    </p>
                    {!wasCorrect && (
                      <p className="mt-1 text-sm">
                        <span className="font-bold text-[var(--dim)]">
                          Correct answer:{" "}
                        </span>
                        {q.options[q.correctIndex] ?? "—"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
