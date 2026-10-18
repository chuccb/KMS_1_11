import { NATIVE_STEP_MS } from "./native-locomotion.ts";
import {
  PHYSICS_STEPS,
  PRESENTATION_MODES,
  physicsStep,
  presentationMode,
} from "./motion-tuning.ts";
export const MOTION_STEP_STORAGE_KEY = "kms111.physicsStepMs";
export const MOTION_PRESENTATION_STORAGE_KEY = "kms111.presentationMode";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
interface MotionControlsOptions {
  panel: HTMLDetailsElement;
  step: HTMLSelectElement;
  presentation: HTMLSelectElement;
  reset: HTMLButtonElement;
  status: HTMLElement;
  onInteract(): void;
  onClose(): void;
  storage?: PreferenceStorage;
}
/** Page-only controls. No transport/save dependency; gameplay samples the chosen interval.
 * Startup reads but never writes preferences. Block panel key bubbling, not keyup releases.
 */
export function motionControls({
  panel,
  step,
  presentation,
  reset,
  status,
  onInteract,
  onClose,
  storage = browserStorage(),
}: MotionControlsOptions) {
  let interval = physicsStep(undefined),
    mode = presentationMode(undefined);
  try {
    interval = physicsStep(Number(storage?.getItem(MOTION_STEP_STORAGE_KEY)));
  } catch {
    /* Session default. */
  }
  try {
    mode = presentationMode(storage?.getItem(MOTION_PRESENTATION_STORAGE_KEY));
  } catch {
    /* Independent preference. */
  }
  step.replaceChildren(
    ...PHYSICS_STEPS.map((ms) => {
      const option = document.createElement("option");
      option.value = String(ms);
      option.textContent = `${ms}ms · ${Number((1000 / ms).toFixed(1))}Hz${ms === NATIVE_STEP_MS ? "（原版基準）" : "（實驗）"}`;
      return option;
    }),
  );
  presentation.replaceChildren(
    ...PRESENTATION_MODES.map((definition) => {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.label;
      return option;
    }),
  );
  function sync() {
    step.value = String(interval);
    presentation.value = mode;
    status.textContent = `本機角色 ${interval}ms · ${mode === "interpolate" ? `插值延遲 ≤ ${interval}ms` : "不加插值延遲"}${interval === NATIVE_STEP_MS ? " · 原版步長" : " · 非原版物理實驗"}`;
  }
  function persist() {
    try {
      storage?.setItem(MOTION_STEP_STORAGE_KEY, String(interval));
    } catch {
      /* Session still works. */
    }
    try {
      storage?.setItem(MOTION_PRESENTATION_STORAGE_KEY, mode);
    } catch {
      /* Independent write. */
    }
  }
  function change() {
    interval = physicsStep(Number(step.value));
    mode = presentationMode(presentation.value);
    sync();
    persist();
    onInteract();
  }
  function restore() {
    interval = NATIVE_STEP_MS;
    mode = "interpolate";
    sync();
    persist();
    onInteract();
  }
  function dismiss() {
    panel.open = false;
    onInteract();
  }
  function close() {
    dismiss();
    onClose();
  }
  function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }
  function interact() {
    onInteract();
  }
  function outside(event: Event) {
    if (panel.open && event.target instanceof Node && !panel.contains(event.target)) {
      dismiss(); // Do not steal focus from the clicked camera selector or native game control.
    }
  }
  document.addEventListener("pointerdown", outside, true);
  step.addEventListener("change", change);
  presentation.addEventListener("change", change);
  reset.addEventListener("click", restore);
  panel.addEventListener("keydown", keydown);
  panel.addEventListener("pointerdown", interact);
  sync();
  return {
    stepMs: () => interval,
    presentation: () => mode,
    get open() {
      return panel.open;
    },
    close,
    dismiss,
    dispose() {
      document.removeEventListener("pointerdown", outside, true);
      step.removeEventListener("change", change);
      presentation.removeEventListener("change", change);
      reset.removeEventListener("click", restore);
      panel.removeEventListener("keydown", keydown);
      panel.removeEventListener("pointerdown", interact);
    },
  };
}
