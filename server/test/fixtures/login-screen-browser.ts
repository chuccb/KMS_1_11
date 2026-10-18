/** Inert component fixture: real HTML/canvas/WZ images, but no game transport or authentication. */
import { loginScreen } from "../../../client/login-screen.ts";
import { gameElements } from "../../../client/game-dom.ts";
import { requireContext2d, requireElement } from "../../../client/dom.ts";
import { displayControls } from "../../../client/display-controls.ts";
import { archiveImages, avatarImages } from "../../../client/image-cache.ts";
import type { LoginSelectionRequest } from "../../../client/login-data.ts";

export function installLoginFixture() {
  const { canvas, ui } = gameElements(),
    ctx = requireContext2d(canvas);
  canvas.width = 800;
  canvas.height = 600;
  const display = displayControls({
    canvas,
    context: ctx,
    overlay: ui.gameUi,
    stage: requireElement("game-stage", "div"),
    scroll: requireElement("game-viewport", "div"),
    select: requireElement("view-scale", "select"),
    onScale() {},
  });
  const archive = archiveImages(),
    avatars = avatarImages();
  const pending = new Set<Promise<unknown>>(),
    sources = new WeakMap<CanvasImageSource, string>();
  const requests: LoginSelectionRequest[] = [],
    effects: string[] = [],
    music: string[] = [],
    logs: string[] = [];
  const lookups: string[] = [],
    draws: { path: string; coordinates: number[] }[] = [],
    texts: { text: string; x: number; y: number; align: CanvasTextAlign; alpha: number }[] = [];
  const poses: { id: number; stance: string; now: number }[] = [],
    preloaded: number[][] = [];
  let connections = 0,
    modalOpen = false,
    labOpen = false,
    creates = 0,
    deletes = 0,
    creationDraws = 0,
    dismissals = 0;
  const drawImage = ctx.drawImage,
    fillText = ctx.fillText;
  ctx.drawImage = (source: CanvasImageSource, dx: number, dy: number, ...coordinates: number[]) => {
    draws.push({ path: sources.get(source) ?? "unknown", coordinates: [dx, dy, ...coordinates] });
    Reflect.apply(drawImage, ctx, [source, dx, dy, ...coordinates]);
  };
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    texts.push({ text, x, y, align: ctx.textAlign, alpha: ctx.globalAlpha });
    if (maxWidth === undefined) fillText.call(ctx, text, x, y);
    else fillText.call(ctx, text, x, y, maxWidth);
  };
  const screen: ReturnType<typeof loginScreen> = loginScreen({
    ctx,
    ui,
    image(path) {
      lookups.push(path);
      const image = archive.get(path);
      sources.set(image.img, path);
      pending.add(image.loading);
      return image;
    },
    avatar(look, stance, frame, flip, emotion, planes, faceFrame) {
      const image = avatars.get(look, stance, frame, flip, emotion, planes, faceFrame);
      sources.set(image.img, `avatar:${look.face}:${look.hair}:${stance}`);
      pending.add(image.loading);
      return image;
    },
    bodyPose(actor, _look, stance, now) {
      poses.push({ id: actor.id, stance, now });
      return { stance, frame: 0 };
    },
    face() {
      return { frame: 0 };
    },
    jobName(job) {
      return `job:${job}`;
    },
    preload(look) {
      preloaded.push([...look.items]);
    },
    audio: {
      effect(path) {
        effects.push(path);
      },
      setBgm(path) {
        music.push(path);
      },
    },
    connect() {
      connections++;
      screen.setLoginPending(true);
    },
    send(request) {
      requests.push(request);
    },
    log(text) {
      logs.push(text);
    },
    dismissLabs() {
      dismissals++;
    },
    labOpen: () => labOpen,
    creation: () => ({
      get open() {
        return modalOpen;
      },
      openCreate() {
        creates++;
      },
      openDelete() {
        deletes++;
      },
      draw() {
        creationDraws++;
      },
    }),
  });
  screen.start();
  const fixture = {
    screen,
    requests,
    effects,
    music,
    logs,
    lookups,
    draws,
    texts,
    poses,
    preloaded,
    get connections() {
      return connections;
    },
    get creates() {
      return creates;
    },
    get deletes() {
      return deletes;
    },
    get creationDraws() {
      return creationDraws;
    },
    get dismissals() {
      return dismissals;
    },
    setModal(open: boolean) {
      modalOpen = open;
    },
    setLab(open: boolean) {
      labOpen = open;
    },
    show(stage: "title" | "worlds" | "characters") {
      screen.showPanel(
        stage === "title" ? ui.connect : stage === "worlds" ? ui.worlds : ui.characters,
      );
    },
    paint(now = 1234) {
      lookups.length = draws.length = texts.length = poses.length = 0;
      screen.draw(now);
    },
    async readyPaint() {
      fixture.paint();
      await Promise.all(pending);
      fixture.paint();
    },
    dispose() {
      screen.dispose();
      display.dispose();
    },
  };
  window.loginFixture = fixture;
  return fixture;
}
declare global {
  interface Window {
    loginFixture: ReturnType<typeof installLoginFixture>;
  }
}
