import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  cookieValue,
  fetchJson,
  invariant,
  memberRequest,
  stopChild,
  waitForHealth,
  waitForMessage,
} from "./http.mjs";
import {
  createTemporaryAccount,
  deleteTemporaryAccount,
  openManagement,
} from "./stalwart.mjs";

const freePort = async () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const setup = async (baseUrl, setupToken, domain, providerHost) => {
  const form = new FormData();
  const values = {
    accentColor: "#f97316",
    adminPassword: `Admin1-${randomBytes(24).toString("base64url")}`,
    adminUsername: "acceptance-admin",
    allowedDomains: domain,
    organizationName: "Veda Mail Acceptance",
    primaryColor: "#1d4ed8",
    productName: "Veda Mail Acceptance",
    providerConfig: JSON.stringify({
      imapHost: providerHost, imapPort: "993", imapSecurity: "tls",
      manageSieveHost: providerHost, manageSievePort: "4190",
      manageSieveSecurity: "starttls", smtpHost: providerHost,
      smtpMaxMessageBytes: "0", smtpPort: "465", smtpSecurity: "tls",
    }),
    providerDisplayName: "Live Standard IMAP SMTP",
    providerId: "imap-smtp",
    publicRepositoryUrl: "https://github.com/bestmaa/veda-mail",
    setupToken,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  await fetchJson(`${baseUrl}/api/v1/setup`, {
    body: form,
    headers: { Origin: baseUrl },
    method: "POST",
  }, [201]);
};

const login = async (baseUrl, account) => {
  const { payload, response } = await fetchJson(`${baseUrl}/api/v1/member/session`, {
    body: JSON.stringify({ email: account.email, password: account.password }),
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    method: "POST",
  }, [201]);
  invariant(payload.data.authenticated === true, "Temporary member login failed.");
  const cookie = cookieValue(response, "veda_mail_connection");
  const workspace = await memberRequest(baseUrl, "/api/v1/mail/workspace", { cookie });
  invariant(workspace.payload.data.sessionScope, "The member scope is unavailable.");
  return { cookie, scope: workspace.payload.data.sessionScope };
};

const definition = (name, token, action) => ({
  actions: [{ kind: action }],
  conditions: [{ kind: "subject", operator: "contains", value: token }],
  enabled: true,
  match: "all",
  name,
  stopProcessing: false,
});

const putRule = async (baseUrl, session, body, statuses = [200]) =>
  memberRequest(baseUrl, "/api/v1/member/rules", {
    ...session, body, method: "PUT", statuses,
  });

const exerciseRules = async (baseUrl, session, account) => {
  const initial = await memberRequest(baseUrl, "/api/v1/member/rules", session);
  const capability = initial.payload.data.capability;
  invariant(capability.supported, "ManageSieve was not advertised through Veda Mail.");
  for (const action of ["discard", "mark-read", "star"]) {
    invariant(capability.supportedActions.includes(action), `Missing ${action} action.`);
  }
  for (const condition of ["attachment", "header", "recipient", "size", "subject"]) {
    invariant(capability.supportedConditions.includes(condition),
      `Missing ${condition} condition.`);
  }
  invariant(initial.payload.data.book.rules.length === 0,
    "The temporary mailbox unexpectedly contains Veda rules.");

  const token = `veda-live-${randomBytes(8).toString("hex")}`;
  const first = await putRule(baseUrl, session, {
    definition: definition("Live mark read", token, "mark-read"),
    expectedRevision: null,
    operation: "create",
  }, [201]);
  const revisionOne = first.payload.data.revision;
  const second = await putRule(baseUrl, session, {
    definition: definition("Live star", token, "star"),
    expectedRevision: revisionOne,
    operation: "create",
  }, [201]);
  const [ruleOne, ruleTwo] = second.payload.data.rules;
  const stale = await putRule(baseUrl, session, {
    enabled: false, expectedRevision: revisionOne,
    operation: "toggle", ruleId: ruleTwo.id,
  }, [409]);
  invariant(stale.payload.error.code === "MAIL_RULE_BOOK_CONFLICT",
    "A stale rules revision did not fail closed.");

  let current = await putRule(baseUrl, session, {
    expectedRevision: second.payload.data.revision,
    operation: "reorder",
    ruleIds: [ruleTwo.id, ruleOne.id],
  });
  current = await putRule(baseUrl, session, {
    enabled: false, expectedRevision: current.payload.data.revision,
    operation: "toggle", ruleId: ruleTwo.id,
  });
  current = await putRule(baseUrl, session, {
    enabled: true, expectedRevision: current.payload.data.revision,
    operation: "toggle", ruleId: ruleTwo.id,
  });

  const subject = `${token} delivery`;
  await memberRequest(baseUrl, "/api/v1/mail/send", {
    ...session,
    body: {
      body: "Veda Mail isolated ManageSieve live acceptance.",
      draftId: randomUUID(), subject,
      to: [{ email: account.email, name: null }],
    },
    method: "POST",
    statuses: [201],
  });
  const message = await waitForMessage(
    baseUrl, session.cookie, session.scope, subject,
  );
  invariant(!message.isUnread, "ManageSieve did not mark the fixture as read.");
  invariant(message.isStarred, "ManageSieve did not star the fixture.");

  const preview = await memberRequest(baseUrl, "/api/v1/member/rules/preview", {
    ...session,
    body: { limit: 25, rules: current.payload.data.rules },
    method: "POST",
  });
  const matched = preview.payload.data.find((item) => item.subject === subject);
  invariant(matched?.evaluation.matchedRuleIds.length === 2,
    "The bounded live dry-run did not match both rules.");

  const workspace = await memberRequest(baseUrl, "/api/v1/member/rules", session);
  const operations = workspace.payload.data.book.audit.map((entry) => entry.operation);
  for (const operation of ["create", "reorder", "toggle", "deployment-deployed"]) {
    invariant(operations.includes(operation), `Missing ${operation} audit evidence.`);
  }
  for (const rule of [...current.payload.data.rules].reverse()) {
    current = await putRule(baseUrl, session, {
      expectedRevision: current.payload.data.revision,
      operation: "delete",
      ruleId: rule.id,
    });
  }
  invariant(current.payload.data.rules.length === 0,
    "The isolated rules were not removed.");
  return { actions: ["mark-read", "star"], conflict: true, dryRun: true };
};

export const runManageSieveAcceptance = async () => {
  const managementOrigin = process.env.VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN;
  const apiKey = process.env.VEDA_MAIL_STALWART_MANAGEMENT_API_KEY;
  const domain = (process.env.VEDA_MAIL_ACCEPTANCE_DOMAIN ?? "vedaconcepts.com").toLowerCase();
  invariant(managementOrigin && apiKey, "Stalwart management access is required.");
  const providerHost = new URL(managementOrigin).hostname;
  const management = await openManagement(managementOrigin, apiKey);
  let account;
  let child;
  let dataDirectory;
  try {
    account = await createTemporaryAccount(management, domain);
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const setupToken = randomBytes(32).toString("hex");
    dataDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-mail-sieve-"));
    child = spawn(process.execPath, [process.env.VEDA_MAIL_ACCEPTANCE_SERVER_ENTRY ?? "server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port),
        VEDA_MAIL_ALLOWED_PROVIDER_HOSTS: providerHost,
        VEDA_MAIL_DATA_DIR: dataDirectory,
        VEDA_MAIL_JOB_KEY: randomBytes(32).toString("base64"),
        VEDA_MAIL_PUBLIC_URL: baseUrl,
        VEDA_MAIL_SETUP_TOKEN: setupToken,
        VEDA_MAIL_TRUST_PROXY_HEADERS: "false",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    await waitForHealth(baseUrl, child);
    await setup(baseUrl, setupToken, domain, providerHost);
    const session = await login(baseUrl, account);
    const evidence = await exerciseRules(baseUrl, session, account);
    return { evidence, provider: "imap-smtp", status: "passed" };
  } finally {
    await stopChild(child);
    if (dataDirectory) await rm(dataDirectory, { force: true, recursive: true });
    if (account) await deleteTemporaryAccount(management, account);
  }
};
