/**
 * Resolución de la opción de horario elegida (Documento 2, paso A6).
 * El cliente puede responder: "1", "la primera", "10", "10:00".
 */
import { localTimeInTz } from "./time.js";

const ORDINALS = {
  primero: 0, primera: 0,
  segundo: 1, segunda: 1,
  tercero: 2, tercera: 2,
  ultimo: -1, ultima: -1, "última": -1,
};

/**
 * @param {string} text
 * @param {{startsAt:string,endsAt:string}[]} offered
 * @param {string} timeZone
 * @returns {{startsAt:string,endsAt:string}|null}
 */
export function resolveSelection(text, offered, timeZone) {
  if (!offered || offered.length === 0) return null;
  const t = String(text).trim().toLowerCase();

  // 1) Número de opción 1..3.
  const optMatch = t.match(/\b([1-3])\b/);
  if (optMatch) {
    const idx = Number(optMatch[1]) - 1;
    if (idx >= 0 && idx < offered.length) return offered[idx];
  }

  // 2) Ordinal en texto.
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (t.includes(word)) {
      const resolved = idx === -1 ? offered.length - 1 : idx;
      if (resolved >= 0 && resolved < offered.length) return offered[resolved];
    }
  }

  // 3) Hora local: "10", "10:00", "a las 12".
  const timeMatch = t.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
  if (timeMatch) {
    const hh = String(timeMatch[1]).padStart(2, "0");
    const mm = timeMatch[2] ?? "00";
    const wanted = `${hh}:${mm}`;
    const match = offered.find((s) => localTimeInTz(new Date(s.startsAt), timeZone) === wanted);
    if (match) return match;
  }

  return null;
}
