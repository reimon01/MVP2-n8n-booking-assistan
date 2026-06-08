/**
 * LLM de prueba: devuelve outputs predefinidos en orden (cola).
 */
import { EMPTY_ENTITIES } from "../../src/lib/llm.js";

export function out(intent, entities = {}) {
  return { intent, entities: { ...EMPTY_ENTITIES, ...entities } };
}

export class StubLlm {
  constructor(outputs) {
    this.queue = [...outputs];
  }
  async extract() {
    return this.queue.shift() ?? out("UNKNOWN", {});
  }
}
