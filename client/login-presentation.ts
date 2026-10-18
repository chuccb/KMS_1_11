/** Native 800×600 login paintings. Canvas only: DOM hit targets and transitions live elsewhere. */
import type { CanvasImage, ImageLookup } from "./render-types.ts";
import type { LoginCharacter, LoginLook, LoginSelection } from "./login-data.ts";
import { facingFlip } from "./motion.ts";
import {
  WORLD_UI,
  CHARACTER_UI,
  SELECTION_BUTTONS,
  characterSlot,
  worldPopulation,
  worldGaugeClip,
} from "./selection.ts";

export type LoginStage = "title" | "worlds" | "characters" | "game";
export interface LoginPainting {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  avatar(
    look: LoginLook,
    stance: string,
    frame: number,
    flip: boolean,
    emotion?: string,
    planes?: boolean,
    faceFrame?: number,
  ): CanvasImage & { dx: number; dy: number };
  bodyPose(
    actor: LoginCharacter,
    look: LoginLook,
    stance: string,
    now: number,
  ): { stance: string; frame: number };
  face(actor: LoginCharacter, look: LoginLook, now: number): { emotion?: string; frame: number };
  jobName(job: number): string;
}
export interface LoginPointerState {
  hover?: string;
  pressed?: string;
  disabled(id: string): boolean;
}
interface TitlePaintingState extends LoginPointerState {
  dialogOpen: boolean;
  remember: boolean;
}
interface SelectionPaintingState extends LoginPointerState {
  stage: "worlds" | "characters";
  selection: LoginSelection;
}

export const TITLE_BUTTONS = [
  {
    id: "title-new",
    path: "UI/Login.img/Title/BtNew",
    x: 356,
    y: 394,
    dialog: false,
  },
  {
    id: "title-continue",
    path: "UI/Login.img/Title/BtContinue",
    x: 356,
    y: 423,
    dialog: false,
  },
  {
    id: "title-homepage",
    path: "UI/Login.img/Title/BtHomepage",
    x: 356,
    y: 452,
    dialog: false,
  },
  {
    id: "title-quit",
    path: "UI/Login.img/Title/BtQuit",
    x: 356,
    y: 481,
    dialog: false,
  },
  {
    id: "login-lost",
    path: "UI/Login.img/Title/BtIdPasswdLost",
    x: 287,
    y: 331,
    dialog: true,
  },
  { id: "login", path: "UI/Basic.img/BtOK", x: 373, y: 342, dialog: true },
  {
    id: "login-cancel",
    path: "UI/Basic.img/BtCancel",
    x: 445,
    y: 342,
    dialog: true,
  },
] as const;

export function drawTitleScreen(
  { ctx, image }: Pick<LoginPainting, "ctx" | "image">,
  { dialogOpen, hover, pressed, remember, disabled }: TitlePaintingState,
) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 800, 600);
  const stamp = (path: string, x: number, y: number) => {
    const art = image(path);
    if (art.ready) ctx.drawImage(art.img, x, y);
  };
  stamp("UI/Login.img/Title/backgrnd", 0, 0);
  stamp("UI/Login.img/Title/menu", 302, 358);
  // Modal login sits above the still-visible title menu, centred by sub_461C50.
  for (const button of TITLE_BUTTONS.filter((entry) => !entry.dialog)) {
    const state =
      !dialogOpen && pressed === button.id
        ? "pressed"
        : !dialogOpen && hover === button.id
          ? "mouseOver"
          : "normal";
    stamp(`${button.path}/${state}/0`, button.x, button.y);
  }
  if (dialogOpen) {
    stamp("UI/Login.img/Title/loginDlg", 247, 215);
    stamp(`UI/Basic.img/CheckBox/${remember ? 1 : 0}`, 331, 299);
    ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#000000";
    ctx.fillText("메일주소 저장", 347, 299);
    for (const button of TITLE_BUTTONS.filter((entry) => entry.dialog)) {
      const isDisabled = disabled(button.id);
      const state = isDisabled
        ? "disabled"
        : pressed === button.id
          ? "pressed"
          : hover === button.id
            ? "mouseOver"
            : "normal";
      stamp(`${button.path}/${state}/0`, button.x, button.y);
    }
  }
  // CTitle/sub_4D0000 prints Ver. 1.11 at right=796, top=584.
  ctx.font = "11px 'Dotum', '돋움', 'KMSCJK', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("Ver. 1.11", 796, 584);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export function drawSelectionScreen(
  { ctx, image, avatar, bodyPose, face: sampleFace, jobName }: LoginPainting,
  { stage, selection, hover, pressed, disabled }: SelectionPaintingState,
  now: number,
) {
  const worldStage = stage === "worlds";
  const root = `UI/Login.img/${worldStage ? "WorldSelect" : "CharSelect"}`;
  const layout = worldStage ? WORLD_UI : CHARACTER_UI;
  const stamp = (path: string, x: number, y: number) => {
    const art = image(path);
    if (art.ready) ctx.drawImage(art.img, x, y);
  };
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 800, 600);
  stamp(`${root}/backgrnd`, 0, 0);
  stamp(`${root}/menu`, layout.x, layout.y);
  ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (worldStage) {
    const rowX = WORLD_UI.x + WORLD_UI.rowX;
    stamp(`${root}/wsHeader`, rowX, WORLD_UI.y + WORLD_UI.headerY);
    selection.worlds
      .slice(selection.scroll, selection.scroll + WORLD_UI.visibleRows)
      .forEach((world, index) => {
        const y = WORLD_UI.y + WORLD_UI.rowY + index * WORLD_UI.rowHeight;
        stamp(`${root}/wsItem`, rowX, y);
        if (selection.worldIndex === index + selection.scroll) {
          ctx.fillStyle = "rgba(0,0,0,.25)";
          ctx.fillRect(rowX, y, WORLD_UI.rowWidth, WORLD_UI.rowHeight);
        }
        ctx.globalAlpha = selection.worldIndex === index + selection.scroll ? 1 : 140 / 255;
        stamp(`${root}/wsIcon`, 276, y + 3);
        const count = worldPopulation(world);
        const gauge = image(`${root}/wsGauge`);
        const clip = worldGaugeClip(world);
        if (gauge.ready)
          ctx.drawImage(
            gauge.img,
            clip.x,
            0,
            clip.width,
            clip.height,
            412 + clip.x,
            y + 15,
            clip.width,
            clip.height,
          );
        ctx.fillStyle = "#000";
        ctx.fillText(world.name, 296, y + 7, 110);
        ctx.textAlign = "right";
        ctx.fillText(count < 0 ? "접속불가" : `${count.toLocaleString("ko-KR")} 명`, 514, y);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      });
  } else {
    selection.characters.forEach((character, index) => {
      const slot = characterSlot(index);
      if (!slot) throw new Error(`Character index ${index} exceeds native slots`);
      const look = character;
      const { stance, frame } = bodyPose(
        character,
        look,
        index === selection.characterIndex ? "walk1" : "stand1",
        now,
      );
      const face = sampleFace(character, look, now);
      let frameImage = avatar(look, stance, frame, facingFlip(0), face.emotion, false, face.frame);
      if (!frameImage.ready) frameImage = avatar(look, stance, frame, facingFlip(0));
      if (frameImage.ready)
        ctx.drawImage(frameImage.img, slot.feetX + frameImage.dx, slot.feetY + frameImage.dy);
      ctx.globalAlpha = index === selection.characterIndex ? 1 : 0.5;
      ctx.textAlign = "center";
      ctx.fillStyle = "#000";
      ctx.fillText(character.name, slot.feetX + 3, 325);
      ctx.globalAlpha = 1;
    });
    const character = selection.characters[selection.characterIndex];
    if (character) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.fillText(character.name, 253, 388);
      ctx.fillText(jobName(character.job), 211, 408);
      ctx.fillText(String(character.level), 349, 408);
      ctx.textAlign = "center";
      [character.str, character.dex, character.int, character.luk].forEach((value, index) =>
        ctx.fillText(String(value), 207 + index * 62, 451),
      );
    }
  }
  for (const button of SELECTION_BUTTONS.filter((b) => b.stage === stage)) {
    const isDisabled = disabled(button.id);
    const state = isDisabled
      ? "disabled"
      : pressed === button.id
        ? "pressed"
        : hover === button.id
          ? "mouseOver"
          : "normal";
    stamp(`${button.path}/${state}/0`, button.x, button.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
