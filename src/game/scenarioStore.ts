import type { KeyValueStore } from './profiles';
import { isOriginal, normalizeScenario, SCENARIOS, scenarioById, type ScenarioDef } from './scenarios';

const STORAGE_KEY = 'reclonk.scenarios.v1';

/** The player's own scenarios, saved in the browser next to the profiles. */
export function loadScenarios(storage: KeyValueStore): ScenarioDef[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as { scenarios?: unknown }) : null;
    if (!data || !Array.isArray(data.scenarios)) return [];
    return data.scenarios
      .filter((s): s is Partial<ScenarioDef> => !!s && typeof s === 'object')
      .map((s) => normalizeScenario(s, scenarioById(String(s.basedOn ?? '')) ?? SCENARIOS[0]))
      .filter((s) => !isOriginal(s));
  } catch {
    // Corrupt data: no own scenarios rather than a broken menu.
    return [];
  }
}

export function saveScenarios(storage: KeyValueStore, own: readonly ScenarioDef[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ scenarios: own }));
}

let idCounter = 0;
function newId(): string {
  return `scenario-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Save edited settings, like Clonk: an original scenario is never changed,
 * so editing one saves a copy with the changes. Editing one of your own
 * scenarios changes it in place. Returns the saved scenario.
 */
export function saveEdit(own: ScenarioDef[], edited: ScenarioDef): ScenarioDef {
  const original = SCENARIOS.find((s) => s.id === edited.id);
  if (original) {
    const title = edited.title === original.title ? `${original.title} (copy)` : edited.title;
    const copy = normalizeScenario({ ...edited, id: newId(), title, basedOn: original.id }, original);
    own.push(copy);
    return copy;
  }
  const saved = normalizeScenario(edited, scenarioById(edited.basedOn ?? '') ?? SCENARIOS[0]);
  const i = own.findIndex((s) => s.id === edited.id);
  if (i >= 0) own[i] = saved;
  else own.push(saved);
  return saved;
}

export function deleteScenario(own: ScenarioDef[], id: string): void {
  const i = own.findIndex((s) => s.id === id);
  if (i >= 0) own.splice(i, 1);
}
