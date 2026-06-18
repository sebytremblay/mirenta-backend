// Live smoke test for the in-process agent loop (D45): Haiku drives an Exa
// search tool and finishes with a forced structured result. Proves the core
// adaptation before the full agents are built. Run: node scripts/smoke-loop.ts
import { runAgentLoop } from "../src/providers/anthropic.ts";
import { exaSearch } from "../src/providers/exa.ts";
import { config } from "../src/config/env.ts";

try {
  const result = await runAgentLoop({
    model: config.anthropic.researchModel,
    system:
      "You research companies. Use the search_web tool to find facts, then call emit_summary exactly once with what you found. Keep it brief.",
    prompt:
      "Research Plexus Corp (a manufacturing services company). Find what they do and roughly how many employees they have. Then emit a summary.",
    maxTurns: 5,
    maxTokens: 1500,
    tools: [
      {
        name: "search_web",
        description: "Search the web for facts about a company.",
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        run: async (input) => {
          const results = await exaSearch(String(input.query), { numResults: 3, maxCharacters: 800 });
          return results.map((r) => `# ${r.title}\n${r.url}\n${r.text ?? ""}`).join("\n\n");
        },
      },
    ],
    finalTool: {
      name: "emit_summary",
      description: "Emit the final structured summary. Call exactly once.",
      input_schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          what_they_do: { type: "string" },
          approx_employees: { type: "number" },
        },
        required: ["company", "what_they_do", "approx_employees"],
      },
    },
    onStep: (s) => console.log(`  [t${s.turn}] ${s.kind}: ${s.detail}`),
  });

  console.log("\nRESULT:", JSON.stringify(result, null, 2));
  const ok = typeof result.company === "string" && typeof result.what_they_do === "string";
  console.log(ok ? "SMOKE LOOP: PASS" : "SMOKE LOOP: FAIL (shape)");
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("SMOKE LOOP: FAIL", (e as Error).constructor.name, (e as Error).message);
  process.exitCode = 1;
}
