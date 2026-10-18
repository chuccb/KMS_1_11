/** Inert native-asset component; no game page, session, accounts, input or event injection. */
import { sceneSurface } from "../../../client/scene-surface.ts";
import { archiveImages, avatarImages } from "../../../client/image-cache.ts";
import { dropRenderer, dropIconPath } from "../../../client/drop-renderer.ts";
import type { FrameLayer } from "../../scripts/probe-frame.ts";

export async function installFrameEvidence(paths: {
  background: string;
  tile: string;
  npc: string;
}) {
  const canvas = document.getElementById("view");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Expected real canvas");
  canvas.width = 800;
  canvas.height = 600;
  const surface = sceneSurface(canvas),
    archive = archiveImages(),
    avatars = avatarImages();
  const facts: unknown = await (await fetch("/api/item/4000019")).json();
  const itemPath = dropIconPath(facts);
  if (!itemPath) throw new Error("No original item iconRaw");
  const images = {
    background: archive.get(paths.background),
    tile: archive.get(paths.tile),
    npc: archive.get(paths.npc),
    avatar: avatars.get(
      { face: 20000, hair: 30000, items: [1040002, 1060002, 1072001, 1302000] },
      "stand1",
      0,
      false,
    ),
  };
  const item = archive.get(itemPath),
    meso = archive.get("Item/Special/0900.img/09000002/iconRaw/0");
  await Promise.all([...Object.values(images), item, meso].map((image) => image.loading));
  if ([...Object.values(images), item, meso].some((image) => !image.ready))
    throw new Error("Original PNG failed to decode");
  const rewards = dropRenderer({
    ctx: surface.context,
    image: (path) => archive.get(path),
    item: () => facts,
    describe() {},
  });
  const api = {
    async paint(
      layers: FrameLayer[],
      mode:
        | "normal"
        | "unpresented"
        | "transparent"
        | "outside"
        | "cleared"
        | "reset"
        | "resized" = "normal",
    ) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(function frame() {
          surface.beginUi(true);
          const ctx = surface.context,
            offset = mode === "outside" ? 1000 : 0;
          ctx.globalAlpha = mode === "transparent" ? 0 : 1;
          for (const layer of layers) {
            if (layer === "item-drop" || layer === "meso-drop")
              rewards.draw(
                {
                  kind: 2,
                  dropId: layer === "item-drop" ? 1 : 2,
                  money: layer === "meso-drop",
                  value: layer === "item-drop" ? 4000019 : 120,
                  x: 80,
                  y: 150,
                },
                { x: 80 + offset, y: 150, t: 1, phase: "rest" },
                { x: 0, y: 0 },
                0,
              );
            else if (layer !== "title") ctx.drawImage(images[layer].img, offset, 0);
          }
          if (mode === "cleared") ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          if (mode === "reset") ctx.reset();
          if (mode === "resized") ctx.canvas.width = ctx.canvas.width;
          if (mode !== "unpresented") surface.presentUi();
          resolve();
        }),
      );
    },
  };
  window.frameEvidenceFixture = api;
}
declare global {
  interface Window {
    frameEvidenceFixture: {
      paint(
        layers: FrameLayer[],
        mode?:
          "normal" | "unpresented" | "transparent" | "outside" | "cleared" | "reset" | "resized",
      ): Promise<void>;
    };
  }
}
