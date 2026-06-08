/**
 * Cliente OpenAI para producción.
 * Implementa la interfaz deps.llm que espera processInbound().
 *
 * Usa response_format: json_object + SYSTEM_PROMPT para forzar JSON válido.
 * El output siempre pasa por parseLlmOutput() — si falla, degrada a UNKNOWN.
 */
import { parseLlmOutput, SYSTEM_PROMPT } from "./llm.js";

export function makeOpenAiLlm() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  return {
    async extract(input) {
      if (!apiKey) throw new Error("OPENAI_API_KEY no configurada");

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI ${res.status}: ${body}`);
      }

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? "";
      return parseLlmOutput(raw);
    },
  };
}
