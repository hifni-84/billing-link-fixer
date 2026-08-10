import net from "node:net";
import type { Json, MtCreds, MtResult } from "./mikrotik-types";

/** Encode panjang word sesuai protokol API RouterOS. */
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const v = len | 0x8000;
    return Buffer.from([(v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x200000) {
    const v = len | 0xc00000;
    return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  const v = len | 0xe0000000;
  return Buffer.from([(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
}

function encodeWord(word: string): Buffer {
  const body = Buffer.from(word, "utf8");
  return Buffer.concat([encodeLength(body.length), body]);
}

function encodeSentence(words: string[]): Buffer {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

class Reader {
  private buf = Buffer.alloc(0);
  private offset = 0;

  push(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf.subarray(this.offset), chunk]);
    this.offset = 0;
  }

  /** Ambil semua sentence lengkap yang tersedia. */
  drain(): string[][] {
    const out: string[][] = [];
    let words: string[] = [];
    for (;;) {
      const start = this.offset;
      const word = this.readWord();
      if (word === undefined) {
        this.offset = start;
        break;
      }
      if (word === "") {
        out.push(words);
        words = [];
        this.pending = [];
        continue;
      }
      words.push(word);
      this.pending = words;
    }
    if (words.length) {
      // sentence belum lengkap: mundur ke awal sentence
      this.offset = this.sentenceStart;
    } else {
      this.sentenceStart = this.offset;
    }
    return out;
  }

  private pending: string[] = [];
  private sentenceStart = 0;

  private readWord(): string | undefined {
    if (this.offset >= this.buf.length) return undefined;
    const first = this.buf[this.offset]!;
    let len = 0;
    let head = 1;
    if (first < 0x80) len = first;
    else if ((first & 0xc0) === 0x80) {
      head = 2;
      if (this.offset + 2 > this.buf.length) return undefined;
      len = ((first & 0x3f) << 8) | this.buf[this.offset + 1]!;
    } else if ((first & 0xe0) === 0xc0) {
      head = 3;
      if (this.offset + 3 > this.buf.length) return undefined;
      len = ((first & 0x1f) << 16) | (this.buf[this.offset + 1]! << 8) | this.buf[this.offset + 2]!;
    } else {
      head = 4;
      if (this.offset + 4 > this.buf.length) return undefined;
      len =
        ((first & 0x0f) << 24) |
        (this.buf[this.offset + 1]! << 16) |
        (this.buf[this.offset + 2]! << 8) |
        this.buf[this.offset + 3]!;
    }
    if (this.offset + head + len > this.buf.length) return undefined;
    const word = this.buf.subarray(this.offset + head, this.offset + head + len).toString("utf8");
    this.offset += head + len;
    return word;
  }
}

type Sentence = { reply: string; attrs: Record<string, string> };

function parse(words: string[]): Sentence {
  const [reply = "", ...rest] = words;
  const attrs: Record<string, string> = {};
  for (const w of rest) {
    if (!w.startsWith("=")) continue;
    const idx = w.indexOf("=", 1);
    if (idx === -1) attrs[w.slice(1)] = "";
    else attrs[w.slice(1, idx)] = w.slice(idx + 1);
  }
  return { reply, attrs };
}

class ApiSession {
  private socket: net.Socket;
  private reader = new Reader();
  private queue: Sentence[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;
  private failure: Error | null = null;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.reader.push(chunk);
      for (const words of this.reader.drain()) this.queue.push(parse(words));
      this.wake();
    });
    socket.on("error", (e: Error) => {
      this.failure = e;
      this.closed = true;
      this.wake();
    });
    socket.on("close", () => {
      this.closed = true;
      this.wake();
    });
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  private async next(): Promise<Sentence> {
    for (;;) {
      const s = this.queue.shift();
      if (s) return s;
      if (this.failure) throw this.failure;
      if (this.closed) throw new Error("Koneksi API RouterOS ditutup");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  send(words: string[]) {
    this.socket.write(encodeSentence(words));
  }

  /** Kirim command dan kumpulkan semua !re sampai !done / !trap. */
  async command(words: string[]): Promise<Record<string, string>[]> {
    this.send(words);
    const rows: Record<string, string>[] = [];
    for (;;) {
      const s = await this.next();
      if (s.reply === "!re") rows.push(s.attrs);
      else if (s.reply === "!done") {
        if (Object.keys(s.attrs).length && !rows.length) rows.push(s.attrs);
        return rows;
      } else if (s.reply === "!trap" || s.reply === "!fatal") {
        throw new Error(s.attrs["message"] || "Perintah RouterOS ditolak");
      }
    }
  }

  async login(username: string, password: string) {
    // RouterOS >= 6.43 memakai plain login; versi lama butuh challenge MD5.
    try {
      await this.command(["/login", `=name=${username}`, `=password=${password}`]);
      return;
    } catch (e) {
      void e;
    }
    const first = await this.command(["/login"]);
    const challengeHex = first[0]?.["ret"];
    if (!challengeHex) throw new Error("Login API RouterOS gagal");
    const { createHash } = await import("node:crypto");
    const hash = createHash("md5")
      .update(Buffer.concat([
        Buffer.from([0]),
        Buffer.from(password, "utf8"),
        Buffer.from(challengeHex, "hex"),
      ]))
      .digest("hex");
    await this.command(["/login", `=name=${username}`, `=response=00${hash}`]);
  }

  close() {
    try {
      this.socket.destroy();
    } catch {
      /* noop */
    }
  }
}

function connect(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Waktu sambung ke port API habis"));
    });
    socket.once("error", (e) => reject(e));
  });
}

/** REST path + method → command API RouterOS + argumen. */
function toCommand(path: string, method: string, body?: unknown) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const segments = clean.split("/").filter(Boolean);
  let id: string | undefined;
  const last = segments[segments.length - 1];
  // Perintah RouterOS (bukan CRUD) dikirim apa adanya, mis. /radius/monitor.
  const COMMANDS = new Set([
    "monitor",
    "print",
    "reset-counters",
    "getall",
    "reset",
    "ping",
    "scan",
  ]);
  if (last && COMMANDS.has(last)) {
    const attrsRaw = Object.entries((body ?? {}) as Record<string, unknown>).map(
      ([k, v]) => `=${k}=${v === undefined || v === null ? "" : String(v)}`,
    );
    return { words: [clean, ...attrsRaw], single: false, id: undefined as string | undefined };
  }
  if (last && (last.startsWith("*") || /^\d+$/.test(last))) {
    id = segments.pop();
  }
  const base = `/${segments.join("/")}`;
  const verb = method.toUpperCase();
  const attrs = (obj: unknown) =>
    Object.entries((obj ?? {}) as Record<string, unknown>)
      .filter(([k]) => k !== ".id")
      .map(([k, v]) => `=${k}=${v === undefined || v === null ? "" : String(v)}`);

  const record = (body ?? {}) as Record<string, unknown>;
  const bodyId = typeof record[".id"] === "string" ? (record[".id"] as string) : undefined;
  const targetId = id ?? bodyId;

  if (verb === "GET") return { words: [`${base}/print`], single: !!targetId, id: targetId };
  if (verb === "POST" && !targetId) return { words: [`${base}/add`, ...attrs(body)], single: false };
  if (verb === "DELETE")
    return { words: [`${base}/remove`, `=.id=${targetId ?? ""}`], single: false };
  if (verb === "POST" && targetId)
    return { words: [`${base}/set`, `=.id=${targetId}`, ...attrs(body)], single: false };
  // PUT / PATCH
  if (targetId) return { words: [`${base}/set`, `=.id=${targetId}`, ...attrs(body)], single: false };
  return { words: [`${base}/add`, ...attrs(body)], single: false };
}

/** Panggil RouterOS lewat API biner (port 8728) — dipakai untuk RouterOS v6. */
export async function callRouterOsApi(
  creds: MtCreds,
  path: string,
  method: string,
  body?: unknown,
): Promise<MtResult> {
  const port = creds.apiPort && creds.apiPort > 0 ? creds.apiPort : 8728;
  let session: ApiSession | null = null;
  try {
    const socket = await connect(creds.host, port, 12000);
    session = new ApiSession(socket);
    await session.login(creds.username, creds.password);

    // Command khusus RouterOS (mis. /radius/monitor) tetap lewat print jika perlu.
    const cmd = toCommand(path, method, body);
    const rows = await session.command(cmd.words);
    let data: Json;
    if (cmd.single) {
      const found = rows.find((r) => r[".id"] === cmd.id) ?? rows[0] ?? null;
      data = (found ?? null) as Json;
    } else if (method.toUpperCase() === "GET") {
      const isSingleObject = /\/(resource|identity|routerboard|clock|license)$/.test(path);
      data = isSingleObject ? ((rows[0] ?? null) as Json) : (rows as unknown as Json);
    } else {
      data = (rows[0] ?? null) as Json;
    }
    return { ok: true, status: 200, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kesalahan tidak diketahui";
    return {
      ok: false,
      status: 0,
      data: null,
      error: `API RouterOS (port ${port}) gagal: ${message}. Pastikan service "api" aktif di router dan port-nya dapat diakses.`,
    };
  } finally {
    session?.close();
  }
}
