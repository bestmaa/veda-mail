import { spawnSync } from "node:child_process";

const REQUIRED_ENVIRONMENT = {
  VEDA_MAIL_ALLOWED_PROVIDER_HOSTS: "mail.example.com",
  VEDA_MAIL_JOB_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  VEDA_MAIL_PUBLIC_URL: "https://webmail.example.com",
  VEDA_MAIL_SETUP_TOKEN: "ci-only-token-not-used-in-production",
};

const DIGEST_PIN =
  "ghcr.io/bestmaa/veda-mail:sha-test@sha256:" + "a".repeat(64);

function composeConfig(files, environment = {}) {
  const fileArguments = files.flatMap((file) => ["-f", file]);
  const result = spawnSync(
    "docker",
    ["compose", ...fileArguments, "config", "--format", "json"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...REQUIRED_ENVIRONMENT,
        ...environment,
      },
    },
  );

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Docker Compose validation failed: ${detail}`);
  }

  return JSON.parse(result.stdout);
}

function sortedKeys(record) {
  return Object.keys(record ?? {}).sort();
}

function requireContract(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const release = composeConfig(["compose.yaml"]);
const source = composeConfig(["compose.yaml", "compose.build.yaml"]);
const digestRelease = composeConfig(["compose.yaml"], {
  VEDA_MAIL_IMAGE: DIGEST_PIN,
});

requireContract(
  !("build" in release.services["veda-mail"]),
  "Release Compose must pull the configured image, not build it.",
);
requireContract(
  "build" in source.services["veda-mail"],
  "Source-build override must define the Veda Mail build.",
);
requireContract(
  JSON.stringify(sortedKeys(release.services)) ===
    JSON.stringify(sortedKeys(source.services)),
  "Release and source configurations must expose the same services.",
);
requireContract(
  JSON.stringify(sortedKeys(release.volumes)) ===
    JSON.stringify(sortedKeys(source.volumes)),
  "Release and source configurations must preserve the same named volumes.",
);
requireContract(
  digestRelease.services["veda-mail"].image === DIGEST_PIN,
  "Release Compose must preserve an exact immutable digest reference.",
);

console.log("Compose release/source contracts passed.");
