import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserPreferenceStorage,
  loadInventoryTab,
  loadInventoryWindowPosition,
  loadShopWindowPosition,
  saveInventoryTab,
  saveInventoryWindowPosition,
  saveShopWindowPosition,
  type BrowserPreferenceStorage,
} from "../../client/browser-preferences.ts";

function memoryStorage(initial: Record<string, string> = {}): {
  storage: BrowserPreferenceStorage;
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
}

test("inventory position keeps finite saved coordinates and otherwise clones the native home", () => {
  const fallback = { x: 24, y: 24 };
  const { storage } = memoryStorage({
    "kms111.inventoryAt": JSON.stringify({ x: -120.5, y: 760 }),
  });
  assert.deepEqual(loadInventoryWindowPosition(storage, fallback), { x: -120.5, y: 760 });

  const defaultPosition = loadInventoryWindowPosition(undefined, fallback);
  assert.deepEqual(defaultPosition, fallback);
  assert.notEqual(defaultPosition, fallback);
  assert.deepEqual(
    loadInventoryWindowPosition(
      memoryStorage({ "kms111.inventoryAt": '{"x":12,"y":"24"}' }).storage,
      fallback,
    ),
    fallback,
  );
  assert.deepEqual(
    loadInventoryWindowPosition(memoryStorage({ "kms111.inventoryAt": "{" }).storage, fallback),
    fallback,
  );

  const blocked: BrowserPreferenceStorage = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {},
  };
  assert.deepEqual(loadInventoryWindowPosition(blocked, fallback), fallback);
  assert.deepEqual(
    loadShopWindowPosition(blocked, { x: 196, y: 154 }, { width: 800, height: 600 }, 407),
    { x: 196, y: 154 },
  );
});

test("shop position rounds and clamps to its visible grab strips", () => {
  const fallback = { x: 196, y: 154 };
  const viewport = { width: 800, height: 600 };
  const below = memoryStorage({
    "kms111.shopAt": JSON.stringify({ x: -999.7, y: 999.7 }),
  });
  const above = memoryStorage({
    "kms111.shopAt": JSON.stringify({ x: 999.7, y: -10.6 }),
  });

  assert.deepEqual(loadShopWindowPosition(below.storage, fallback, viewport, 407), {
    x: -359,
    y: 568,
  });
  assert.deepEqual(loadShopWindowPosition(above.storage, fallback, viewport, 407), {
    x: 752,
    y: 0,
  });
  assert.deepEqual(loadShopWindowPosition(undefined, fallback, viewport, 407), fallback);
});

test("inventory tab preference accepts only the original four tab numbers", () => {
  assert.equal(loadInventoryTab(undefined), 1);
  assert.equal(loadInventoryTab(memoryStorage({ "kms111.inventoryTab": "4" }).storage), 4);
  for (const saved of ["0", "5", "2.5", "invalid"]) {
    assert.equal(loadInventoryTab(memoryStorage({ "kms111.inventoryTab": saved }).storage), 1);
  }
  assert.equal(
    loadInventoryTab(
      {
        getItem() {
          throw new Error("storage blocked");
        },
        setItem() {},
      },
      2,
    ),
    2,
  );
});

test("preference reads and writes fail softly when storage access is blocked", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });
  try {
    assert.equal(browserPreferenceStorage(), undefined);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }

  const { storage, values } = memoryStorage();
  saveInventoryWindowPosition(storage, { x: 30, y: 40 });
  saveShopWindowPosition(storage, { x: 200, y: 160 });
  saveInventoryTab(storage, 3);
  assert.equal(values.get("kms111.inventoryAt"), '{"x":30,"y":40}');
  assert.equal(values.get("kms111.shopAt"), '{"x":200,"y":160}');
  assert.equal(values.get("kms111.inventoryTab"), "3");

  const blocked: BrowserPreferenceStorage = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("storage blocked");
    },
  };
  assert.doesNotThrow(() => {
    saveInventoryWindowPosition(blocked, { x: 24, y: 24 });
    saveShopWindowPosition(blocked, { x: 196, y: 154 });
    saveInventoryTab(blocked, 1);
  });
});
