import { CAMERA_MODES, cameraMode } from "./camera.ts";

export const CAMERA_STORAGE_KEY = "kms111.cameraMode";
type CameraStorage = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): CameraStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Only browser presentation preferences are stored; never sends a game packet or touches a save. */
export function cameraControls(
  select: HTMLSelectElement,
  recenter: HTMLButtonElement,
  onRecenter: () => void,
  storage: CameraStorage | undefined = browserStorage(),
) {
  let mode = cameraMode(undefined);
  try {
    mode = cameraMode(storage?.getItem(CAMERA_STORAGE_KEY));
  } catch {
    // Sandboxed/private browsers may deny localStorage reads and writes independently.
  }
  select.replaceChildren(
    ...CAMERA_MODES.map((definition) => {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.label;
      return option;
    }),
  );
  function sync() {
    select.value = mode;
    select.title = CAMERA_MODES.find((definition) => definition.id === mode)?.detail ?? "";
  }
  sync();
  let disposed = false;
  function change() {
    if (disposed) return;
    mode = cameraMode(select.value);
    sync();
    try {
      storage?.setItem(CAMERA_STORAGE_KEY, mode);
    } catch {
      // The preference still works for this page without persistent storage.
    }
  }
  function center() {
    if (!disposed) onRecenter();
  }
  function keydown(event: KeyboardEvent) {
    // Keyboard activation of this browser button must not also jump/attack in the field.
    if (event.key === " " || event.key === "Enter") event.stopPropagation();
  }
  select.addEventListener("change", change);
  recenter.addEventListener("click", center);
  recenter.addEventListener("keydown", keydown);
  return {
    mode: () => mode,
    dispose() {
      if (disposed) return;
      disposed = true;
      select.removeEventListener("change", change);
      recenter.removeEventListener("click", center);
      recenter.removeEventListener("keydown", keydown);
    },
  };
}
