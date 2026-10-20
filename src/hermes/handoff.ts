import type { HermesContext } from "./hermes-api";

const HERMES_HANDOFF_KEY = "tongzhou:hermes-handoff:v1";

export type HermesHandoff = {
  context: HermesContext;
  prompt?: string;
  createdAt: string;
};

export function handoffToHermes(context: HermesContext, prompt?: string) {
  const value: HermesHandoff = { context, prompt, createdAt: new Date().toISOString() };
  try { sessionStorage.setItem(HERMES_HANDOFF_KEY, JSON.stringify(value)); } catch { /* navigation still works */ }
  window.location.hash = "#hermes-agent";
}

export function consumeHermesHandoff(): HermesHandoff | null {
  try {
    const raw = sessionStorage.getItem(HERMES_HANDOFF_KEY);
    sessionStorage.removeItem(HERMES_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.context?.route) return null;
    return value as HermesHandoff;
  } catch {
    return null;
  }
}
