import { test } from "node:test";
import assert from "node:assert/strict";
import { startWebClient } from "../src/net/webclient.ts";

test("Bun serves the complete browser module graph as JavaScript without opening a game session", async () => {
  const server = await startWebClient({ host: "127.0.0.1", port: 0, loginPort: 0 });
  const origin = `http://127.0.0.1:${server.port}`;
  const parser = new Bun.Transpiler({ loader: "js" });
  try {
    const html = await (await fetch(origin)).text();
    const queue = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)].map(
      (match) => new URL(match[1], origin),
    );
    assert.equal(queue.length, 2, "startup guard and application must both be included");
    const visited = new Set<string>();
    while (queue.length) {
      const url = queue.shift()!;
      if (visited.has(url.href)) continue;
      visited.add(url.href);
      const response = await fetch(url);
      assert.equal(response.status, 200, url.href);
      assert.match(response.headers.get("content-type") ?? "", /javascript/, url.href);
      const source = await response.text();
      assert.doesNotThrow(() => parser.transformSync(source), url.href);
      for (const imported of parser.scan(source).imports) {
        assert.ok(imported.path.startsWith("."), `Unexpected browser external: ${imported.path}`);
        queue.push(new URL(imported.path, url));
      }
    }
    assert.ok(visited.has(new URL("/native-terrain.ts", origin).href));
    assert.ok(visited.has(new URL("/faces.ts", origin).href));
    const terrain = await (await fetch(`${origin}/native-terrain.ts`)).text();
    assert.match(terrain, /function terrainContact/);
    assert.doesNotMatch(terrain, /export interface|: TerrainWorld|: PhysicalBounds/);
  } finally {
    await server.close();
  }
});
