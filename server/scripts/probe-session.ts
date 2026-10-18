/** Native-protocol tooling transport only. Importing never connects or authenticates. */
import { connect, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { CipherState, SERVER_SEND_MAGIC } from "../src/protocol/cipher.ts";
import { SessionDeframer, encodeSessionPacket } from "../src/protocol/session.ts";

function checkOpcode(opcode: number) {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 255) throw new Error("Invalid opcode");
}

export class ProbeSession {
  private readonly queue: Uint8Array[] = [];
  private readonly socket: Socket;
  private readonly deframer = new SessionDeframer({ expectedMagic: SERVER_SEND_MAGIC });
  private sendState: CipherState | undefined;
  private failure: Error | undefined;
  private closed = false;
  private taking = false;

  private constructor(port: number) {
    this.socket = connect(port, "127.0.0.1");
    this.socket.on("error", (error) => {
      this.failure = error;
    });
    this.socket.on("close", () => {
      if (!this.closed) this.failure ??= new Error("Probe peer closed the connection");
    });
    this.socket.on("data", (chunk: Buffer) => {
      try {
        for (const event of this.deframer.push(chunk)) {
          if (event.kind === "handshake")
            this.sendState = new CipherState(event.handshake.sendSeed);
          else {
            if (this.queue.length >= 4096)
              throw new Error("Probe receive queue exceeds 4096 packets");
            this.queue.push(event.plain);
          }
        }
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        this.socket.destroy();
      }
    });
  }

  static async connect(port: number, timeoutMs = 4000): Promise<ProbeSession> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid probe port");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid handshake timeout");
    const client = new ProbeSession(port);
    const deadline = performance.now() + timeoutMs;
    try {
      while (!client.sendState) {
        client.assertOpen();
        if (performance.now() >= deadline) throw new Error("Probe handshake timed out");
        await delay(5);
      }
      client.assertOpen();
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private assertOpen() {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error("Probe session is closed");
  }
  send(body: Uint8Array): void {
    this.assertOpen();
    if (!this.sendState) throw new Error("Probe handshake is not complete");
    this.socket.write(encodeSessionPacket(body, this.sendState, "c2s"));
  }

  /** Match one opcode without silently losing the field/stat/pool packets around it. */
  async take(opcode: number, timeoutMs = 5000): Promise<Uint8Array> {
    checkOpcode(opcode);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid packet timeout");
    if (this.taking) throw new Error("Concurrent probe packet consumers are not supported");
    this.taking = true;
    const deadline = performance.now() + timeoutMs;
    try {
      for (;;) {
        this.assertOpen();
        const index = this.queue.findIndex((packet) => packet[0] === opcode);
        if (index >= 0) return this.queue.splice(index, 1)[0]!;
        if (performance.now() >= deadline)
          throw new Error(`No opcode 0x${opcode.toString(16)} within ${timeoutMs}ms`);
        await delay(5);
      }
    } finally {
      this.taking = false;
    }
  }
  /** Snapshot only; does not steal packets owned by a later protocol stage. */
  pendingCount(opcode: number): number {
    checkOpcode(opcode);
    this.assertOpen();
    return this.queue.filter((packet) => packet[0] === opcode).length;
  }
  /** Collect during an observation window; optional opcode leaves unrelated packets in order. */
  async drain(ms = 300, opcode?: number): Promise<Uint8Array[]> {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("Invalid drain duration");
    if (opcode !== undefined) checkOpcode(opcode);
    if (this.taking) throw new Error("Concurrent probe packet consumers are not supported");
    this.taking = true;
    try {
      this.assertOpen();
      await delay(ms);
      this.assertOpen();
      if (opcode === undefined) return this.queue.splice(0);
      const matched: Uint8Array[] = [],
        kept: Uint8Array[] = [];
      for (const packet of this.queue) (packet[0] === opcode ? matched : kept).push(packet);
      this.queue.splice(0, this.queue.length, ...kept);
      return matched;
    } finally {
      this.taking = false;
    }
  }
  close(): void {
    this.closed = true;
    this.socket.destroy();
  }
}
