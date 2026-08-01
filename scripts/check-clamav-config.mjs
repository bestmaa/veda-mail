import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "clamd.conf");
const composePath = path.join(root, "compose.yaml");
const [source, compose] = await Promise.all([
  readFile(configPath, "utf8"),
  readFile(composePath, "utf8"),
]);

const directives = new Map();
for (const [index, raw] of source.split(/\r?\n/u).entries()) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.search(/\s/u);
  if (separator < 1 || separator === line.length - 1) {
    throw new Error(`Invalid clamd.conf directive on line ${index + 1}.`);
  }
  const name = line.slice(0, separator);
  if (directives.has(name)) {
    throw new Error(`Duplicate clamd.conf directive: ${name}.`);
  }
  directives.set(name, line.slice(separator).trim());
}

const required = {
  AlertEncrypted: "yes",
  AlertExceedsMax: "yes",
  BytecodeTimeout: "5000",
  CommandReadTimeout: "5",
  EnableShutdownCommand: "no",
  ExtendedDetectionInfo: "no",
  Foreground: "yes",
  LeaveTemporaryFiles: "no",
  LocalSocket: "/tmp/clamd.sock",
  LocalSocketMode: "660",
  FixStaleSocket: "yes",
  MaxConnectionQueueLength: "16",
  MaxFileSize: "50M",
  MaxFiles: "1000",
  MaxQueue: "16",
  MaxRecursion: "8",
  MaxScanSize: "100M",
  MaxScanTime: "90000",
  MaxThreads: "4",
  StreamMaxLength: "50M",
  TCPSocket: "3310",
};

for (const [name, expected] of Object.entries(required)) {
  const actual = directives.get(name);
  if (actual !== expected) {
    throw new Error(
      `Unsafe clamd.conf ${name}: expected ${expected}, received ${actual ?? "missing"}.`,
    );
  }
}

const composeRequirements = [
  "./config/clamd.conf:/etc/clamav/clamd.conf:ro",
  "cpus: ${VEDA_MAIL_CLAMAV_CPU_LIMIT:-2.0}",
  "mem_limit: ${VEDA_MAIL_CLAMAV_MEMORY_LIMIT:-3072m}",
  "pids_limit: ${VEDA_MAIL_CLAMAV_PIDS_LIMIT:-128}",
  "printf 'PING\\n' | nc 127.0.0.1 3310 | grep -qx PONG",
  "start_period: 6m",
  "/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777",
];
for (const requirement of composeRequirements) {
  if (!compose.includes(requirement)) {
    throw new Error(`Compose is missing ClamAV control: ${requirement}.`);
  }
}

console.log("ClamAV configuration limits are pinned and fail closed.");
