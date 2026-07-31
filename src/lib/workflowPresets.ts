import type { Workflow } from "./types";

/** A ready-to-use workflow template. Id is assigned when the user adds it. */
export type WorkflowPreset = Omit<Workflow, "id">;

/**
 * Starter workflows that work out of the box (prompt / switch / parallel steps only,
 * so they don't depend on user-specific agent ids). Added via "+ Starter workflows".
 */
export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    name: "Research & brief",
    description: "Research a topic with web tools, then write a cited briefing.",
    steps: [
      {
        type: "prompt",
        name: "research",
        instructions:
          "You are a research analyst. Use web_search and fetch_page to gather facts from multiple sources. Return concise findings with the source URL after each point.",
        prompt: "Research this topic thoroughly:\n\n{{input}}",
        useTools: true,
      },
      {
        type: "prompt",
        name: "brief",
        instructions: "You write clear executive briefings.",
        prompt:
          "Write a concise briefing (lead with the answer, then key points, then a Sources list) from these findings:\n\n{{prev}}",
        useTools: false,
      },
    ],
  },
  {
    name: "Draft → critique → revise",
    description: "Write a first draft, critique it hard, then produce a polished revision.",
    steps: [
      {
        type: "prompt",
        name: "draft",
        instructions: "You are a skilled writer.",
        prompt: "Write a strong first draft for this request:\n\n{{input}}",
        useTools: false,
      },
      {
        type: "prompt",
        name: "critique",
        instructions: "You are a demanding editor. Be specific and concrete.",
        prompt:
          "Critique this draft. List concrete, actionable improvements (clarity, structure, accuracy, tone):\n\n{{prev}}",
        useTools: false,
      },
      {
        type: "prompt",
        name: "revise",
        instructions: "You are a skilled writer applying editorial feedback.",
        prompt:
          "Rewrite the draft applying the critique.\n\nORIGINAL DRAFT:\n{{steps.draft}}\n\nCRITIQUE:\n{{steps.critique}}\n\nReturn only the improved final version.",
        useTools: false,
      },
    ],
  },
  {
    name: "Panel of perspectives",
    description: "Analyze from three angles in parallel, then synthesize.",
    steps: [
      {
        type: "parallel",
        name: "panel",
        lanes: [
          {
            label: "Optimist",
            kind: "prompt",
            instructions: "You argue the upside, opportunities, and best case.",
            prompt: "Give the optimistic case on:\n\n{{input}}",
            useTools: false,
          },
          {
            label: "Skeptic",
            kind: "prompt",
            instructions: "You argue the risks, flaws, and worst case.",
            prompt: "Give the skeptical case on:\n\n{{input}}",
            useTools: false,
          },
          {
            label: "Pragmatist",
            kind: "prompt",
            instructions: "You focus on practical next steps and trade-offs.",
            prompt: "Give the pragmatic take on:\n\n{{input}}",
            useTools: false,
          },
        ],
      },
      {
        type: "prompt",
        name: "synthesize",
        instructions: "You synthesize multiple viewpoints into a balanced conclusion.",
        prompt:
          "Weigh these three perspectives and give a balanced recommendation:\n\n{{prev}}",
        useTools: false,
      },
    ],
  },
  {
    name: "Classify & route",
    description: "Classify an incoming message, then respond differently per category.",
    steps: [
      {
        type: "prompt",
        name: "classify",
        instructions: "You are a precise classifier.",
        prompt:
          "Classify the message as exactly one of: positive, negative. Reply with only that single word.\n\nMessage:\n{{input}}",
        useTools: false,
      },
      {
        type: "switch",
        name: "route",
        cases: [{ left: "{{prev}}", op: "contains", right: "positive", goto: "reply_positive" }],
        defaultGoto: "reply_negative",
      },
      {
        type: "prompt",
        name: "reply_positive",
        instructions: "You are a warm, appreciative support agent.",
        prompt: "Write a friendly thank-you reply to this positive message:\n\n{{input}}",
        useTools: false,
      },
      // ends the workflow so it doesn't fall through into reply_negative
      { type: "switch", name: "stop", cases: [], defaultGoto: "end" },
      {
        type: "prompt",
        name: "reply_negative",
        instructions: "You are an empathetic support agent who defuses frustration.",
        prompt: "Write an empathetic, solution-oriented reply to this negative message:\n\n{{input}}",
        useTools: false,
      },
    ],
  },
];
