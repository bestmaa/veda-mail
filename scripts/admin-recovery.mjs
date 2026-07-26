#!/usr/bin/env node

import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const dataDirectory = process.env.VEDA_MAIL_DATA_DIR ?? "/data";
const installationPath = path.join(dataDirectory, "installation.json");

const fail = (message) => {
  process.stderr.write(`Recovery failed: ${message}\n`);
  process.exitCode = 1;
};

const safeEqual = (left, right) => {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
};

const readHidden = (prompt) =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
      reject(new Error("Run this command in an interactive container terminal."));
      return;
    }
    let value = "";
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    };
    process.stdin.on("data", onData);
  });

const hashPassword = async (password) => {
  const salt = randomBytes(24);
  const digest = await scrypt(password, salt, 64);
  return {
    algorithm: "scrypt",
    digest: Buffer.from(digest).toString("base64"),
    salt: salt.toString("base64"),
  };
};

const validPassword = (password) =>
  password.length >= 12 &&
  password.length <= 1024 &&
  /[a-z]/i.test(password) &&
  /\d/.test(password);

const writeAtomic = async (installation) => {
  const temporary = path.join(
    dataDirectory,
    `.installation.json.${crypto.randomUUID()}`,
  );
  await mkdir(dataDirectory, { mode: 0o700, recursive: true });
  await writeFile(temporary, `${JSON.stringify(installation, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporary, installationPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const main = async () => {
  const expectedToken = process.env.VEDA_MAIL_ADMIN_RECOVERY_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    throw new Error(
      "VEDA_MAIL_ADMIN_RECOVERY_TOKEN is missing or shorter than 32 characters.",
    );
  }
  const installation = JSON.parse(await readFile(installationPath, "utf8"));
  if (
    installation?.version !== 1 ||
    !Number.isInteger(installation?.owner?.authVersion) ||
    typeof installation?.owner?.username !== "string"
  ) {
    throw new Error("The installation record is invalid.");
  }
  const token = await readHidden("Emergency recovery token: ");
  if (!safeEqual(token, expectedToken)) {
    throw new Error("The emergency recovery token is incorrect.");
  }
  const password = await readHidden("New administrator password: ");
  const confirmation = await readHidden("Confirm new password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  if (!validPassword(password)) {
    throw new Error(
      "Use 12-1024 characters with at least one letter and one number.",
    );
  }
  process.stdout.write(
    `This resets "${installation.owner.username}", removes 2FA and backup codes, and signs out every admin session.\n`,
  );
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const confirmationText = await readline.question('Type "RESET" to continue: ');
  readline.close();
  if (confirmationText !== "RESET") throw new Error("Cancelled.");
  const now = new Date().toISOString();
  await writeAtomic({
    ...installation,
    owner: {
      ...installation.owner,
      authVersion: installation.owner.authVersion + 1,
      password: await hashPassword(password),
      twoFactor: null,
      updatedAt: now,
    },
    updatedAt: now,
  });
  process.stdout.write(
    `Administrator "${installation.owner.username}" recovered successfully. All prior admin sessions are invalid.\n`,
  );
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Unknown error.");
});
