/**
 * Detección de confirmación / rechazo (Documento 3 §11, reglas 4 y 5).
 * Respaldo determinístico al intent del LLM.
 */
const CONFIRM_WORDS = ["si", "sí", "ok", "okay", "dale", "perfecto", "va", "confirmo", "claro", "adelante"];
const REJECT_WORDS = ["no", "mejor no", "espera", "cancelar", "olvidalo", "olvídalo"];

function normalize(t) {
  return String(t).trim().toLowerCase();
}

export function isConfirmation(text) {
  const t = normalize(text);
  return CONFIRM_WORDS.some((w) => t === w || t.startsWith(w + " ") || t.includes(" " + w));
}

export function isRejection(text) {
  const t = normalize(text);
  return REJECT_WORDS.some((w) => t === w || t.startsWith(w + " ") || t.includes(" " + w));
}
