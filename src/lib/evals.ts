import { chatOnce, streamChat } from "./providers";
import type { Eval, EvalScoring, Provider } from "./types";

export interface CellResult {
  caseId: string;
  modelKey: string;
  output: string;
  ms: number;
  tokens: number;
  score: number | null; // 0..1, or null if not scored
  error?: string;
}

export function modelKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

function estTokens(s: string): number {
  return Math.round(s.length / 4);
}

async function scoreCell(
  scoring: EvalScoring,
  output: string,
  expected: string,
  judge: { provider?: Provider; model?: string; prompt: string; signal: AbortSignal } | null,
): Promise<number | null> {
  const out = output.trim();
  const exp = expected.trim();
  switch (scoring) {
    case "none":
      return null;
    case "contains":
      return exp && out.toLowerCase().includes(exp.toLowerCase()) ? 1 : 0;
    case "equals":
      return out === exp ? 1 : 0;
    case "regex":
      try {
        return new RegExp(exp).test(out) ? 1 : 0;
      } catch {
        return 0;
      }
    case "judge": {
      if (!judge?.provider || !judge.model) return null;
      const raw = await chatOnce(
        judge.provider,
        judge.model,
        "You are a strict grader. Score the ANSWER against the CRITERIA from 1 (poor) to 5 (excellent). Reply with ONLY the integer.",
        judge.prompt,
        judge.signal,
      );
      const n = parseInt((raw.match(/[1-5]/) ?? ["3"])[0], 10);
      return Math.max(0, Math.min(1, (n - 1) / 4));
    }
  }
}

export interface RunHooks {
  providers: Provider[];
  signal: AbortSignal;
  onCell: (r: CellResult) => void;
}

/** Run every case × model, scoring each cell. Cells stream results via onCell. */
export async function runEval(ev: Eval, hooks: RunHooks): Promise<void> {
  const judgeProvider = ev.judgeProviderId
    ? hooks.providers.find((p) => p.id === ev.judgeProviderId)
    : undefined;

  const jobs: (() => Promise<void>)[] = [];
  for (const c of ev.cases) {
    for (const m of ev.models) {
      jobs.push(async () => {
        const provider = hooks.providers.find((p) => p.id === m.providerId);
        const key = modelKey(m.providerId, m.model);
        if (!provider || !m.model) {
          hooks.onCell({ caseId: c.id, modelKey: key, output: "", ms: 0, tokens: 0, score: null, error: "no provider/model" });
          return;
        }
        const start = Date.now();
        try {
          let out = "";
          await streamChat({
            provider,
            model: m.model,
            system: ev.system,
            messages: [{ role: "user", content: c.prompt }],
            temperature: 0.7,
            maxTokens: 0,
            signal: hooks.signal,
            onDelta: (d) => (out += d),
          });
          const ms = Date.now() - start;
          const score = await scoreCell(ev.scoring, out, c.expected, {
            provider: judgeProvider,
            model: ev.judgeModel,
            prompt: `CRITERIA:\n${c.expected}\n\nANSWER:\n${out.slice(0, 4000)}`,
            signal: hooks.signal,
          });
          hooks.onCell({ caseId: c.id, modelKey: key, output: out, ms, tokens: estTokens(out), score });
        } catch (e) {
          hooks.onCell({ caseId: c.id, modelKey: key, output: "", ms: Date.now() - start, tokens: 0, score: null, error: (e as Error).message || String(e) });
        }
      });
    }
  }

  // limited concurrency
  const POOL = 4;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(POOL, jobs.length) }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++];
        await job();
      }
    }),
  );
}
