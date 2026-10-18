import { requireElement } from "./dom.ts";

/** The shared page schema, validated against real tags rather than unchecked JSDoc casts.
 * Keep construction explicit: startup's failure guard must be installed before this can throw.
 */
export function gameElements() {
  return {
    canvas: requireElement("view", "canvas"),
    ui: {
      where: requireElement("where", "span"),
      connect: requireElement("connect", "section"),
      user: requireElement("user", "input"),
      pass: requireElement("pass", "input"),
      login: requireElement("login", "button"),
      status: requireElement("status", "p"),
      worlds: requireElement("worlds", "section"),
      worldList: requireElement("world-list", "div"),
      characters: requireElement("characters", "section"),
      characterList: requireElement("character-list", "div"),
      characterStatus: requireElement("character-status", "p"),
      newName: requireElement("new-name", "input"),
      create: requireElement("create", "button"),
      gameUi: requireElement("game-ui", "div"),
      chatbox: requireElement("chatbox", "div"),
      chatLines: requireElement("chat-lines", "ol"),
      say: requireElement("say", "input"),
      emotes: requireElement("emotes", "div"),
      log: requireElement("log", "aside"),
      logLines: requireElement("log-lines", "ol"),
      logToggle: requireElement("log-toggle", "button"),
      dialogue: requireElement("dialogue", "section"),
    },
  };
}
export type GameElements = ReturnType<typeof gameElements>;
