import net from "node:net";
import tls from "node:tls";

const host = process.env.VEDA_MAIL_STALWART_HOST;
const username = process.env.VEDA_MAIL_ACCEPTANCE_USERNAME;
const password = process.env.VEDA_MAIL_ACCEPTANCE_PASSWORD;
if (!host || !username || !password || !username.startsWith("veda-accept-")) {
  throw new Error("An isolated acceptance account and provider host are required.");
}
delete process.env.VEDA_MAIL_ACCEPTANCE_PASSWORD;

class Reader {
  constructor(socket) {
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.failure = null;
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    };
    this.onError = (error) => { this.failure = error; this.flush(); };
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", () => {
      if (!this.failure) this.failure = new Error("Connection closed.");
      this.flush();
    });
    this.socket = socket;
  }

  release() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
  }

  async line() {
    return this.take((buffer) => {
      const end = buffer.indexOf("\r\n");
      return end < 0 ? null : [buffer.subarray(0, end).toString("utf8"), end + 2];
    });
  }

  async exact(size) {
    return this.take((buffer) => buffer.length < size ? null : [buffer.subarray(0, size), size]);
  }

  take(select) {
    const selected = select(this.buffer);
    if (selected) {
      this.buffer = this.buffer.subarray(selected[1]);
      return Promise.resolve(selected[0]);
    }
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ reject, resolve, select }));
  }

  flush() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];
      const selected = waiter.select(this.buffer);
      if (!selected && !this.failure) return;
      this.waiters.shift();
      if (selected) {
        this.buffer = this.buffer.subarray(selected[1]);
        waiter.resolve(selected[0]);
      } else waiter.reject(this.failure);
    }
  }
}

const response = async (reader) => {
  const lines = [];
  let literal = null;
  while (true) {
    const line = await reader.line();
    const literalMatch = /^\{([0-9]{1,9})\+?\}$/u.exec(line);
    if (literalMatch) {
      literal = await reader.exact(Number(literalMatch[1]));
      continue;
    }
    const status = /^(OK|NO|BYE)(?:\s|$)/iu.exec(line)?.[1]?.toUpperCase();
    if (status) return { lines, literal, status, statusLine: line };
    if (line) lines.push(line);
  }
};

const write = async (socket, reader, command, literal) => {
  socket.write(`${command}${literal ? ` {${literal.length}+}` : ""}\r\n`);
  if (literal) socket.write(Buffer.concat([literal, Buffer.from("\r\n")]));
  return response(reader);
};

const assertOk = (phase, result) => {
  console.error(JSON.stringify({
    ...(phase.startsWith("list-") ? {
      lines: result.lines,
      literal: result.literal?.toString("utf8") ?? null,
    } : {}),
    phase,
    status: result.status,
  }));
  if (result.status !== "OK") {
    const detail = [result.statusLine, ...result.lines].join(" ").slice(0, 512);
    throw new Error(`${phase} rejected${detail ? `: ${detail}` : "."}`);
  }
};

const connected = (socket, event) => new Promise((resolve, reject) => {
  socket.once(event, resolve);
  socket.once("error", reject);
});

const name = "Veda Mail Diagnostic";
const script = Buffer.from(
  "# Veda-Mail-Owned-v1: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA." +
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\r\n" +
  "# Veda Mail generated rules v1. Do not edit.\r\n" +
  "require [\"imap4flags\"];\r\n\r\n" +
  "if allof(header :contains \"subject\" \"veda-live-diagnostic\") {\r\n" +
  "  addflag \"\\\\Seen\";\r\n" +
  "}\r\n",
  "utf8",
);
let socket = net.createConnection({ host, port: 4190 });
let reader;
try {
  await connected(socket, "connect");
  reader = new Reader(socket);
  assertOk("greeting", await response(reader));
  assertOk("starttls", await write(socket, reader, "STARTTLS"));
  reader.release();
  socket = tls.connect({ rejectUnauthorized: true, servername: host, socket });
  await connected(socket, "secureConnect");
  reader = new Reader(socket);
  assertOk("capability", await write(socket, reader, "CAPABILITY"));
  const auth = Buffer.from(`\0${username}\0${password}`, "utf8").toString("base64");
  assertOk("authenticate", await write(socket, reader, `AUTHENTICATE \"PLAIN\" \"${auth}\"`));
  assertOk("list-before", await write(socket, reader, "LISTSCRIPTS"));
  assertOk("check", await write(socket, reader, "CHECKSCRIPT", script));
  assertOk("put", await write(socket, reader, `PUTSCRIPT \"${name}\"`, script));
  assertOk("list-after-put", await write(socket, reader, "LISTSCRIPTS"));
  assertOk("get", await write(socket, reader, `GETSCRIPT \"${name}\"`));
  assertOk("activate", await write(socket, reader, `SETACTIVE \"${name}\"`));
  assertOk("list-active", await write(socket, reader, "LISTSCRIPTS"));
  assertOk("deactivate", await write(socket, reader, "SETACTIVE \"\""));
  assertOk("delete", await write(socket, reader, `DELETESCRIPT \"${name}\"`));
  console.log(JSON.stringify({ result: "passed" }));
} finally {
  if (socket && !socket.destroyed) socket.destroy();
}
