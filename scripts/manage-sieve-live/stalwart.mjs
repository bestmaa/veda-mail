import { randomBytes } from "node:crypto";

import { fetchJson, invariant } from "./http.mjs";

const CORE = "urn:ietf:params:jmap:core";
const STALWART = "urn:stalwart:jmap";

const safeOrigin = (value) => {
  const url = new URL(value);
  invariant(
    url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash && ["", "/"].includes(url.pathname),
    "The Stalwart management origin must be an HTTPS origin.",
  );
  return url.origin;
};

const call = async (client, methodCalls) => {
  const { payload } = await fetchJson(client.apiUrl, {
    body: JSON.stringify({ methodCalls, using: [CORE, STALWART] }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${client.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  invariant(Array.isArray(payload.methodResponses), "Invalid management response.");
  return payload.methodResponses;
};

const result = (responses, callId, method) => {
  const matches = responses.filter((entry) => entry[2] === callId);
  invariant(matches.length === 1, `Missing ${callId} management response.`);
  invariant(matches[0][0] === method, `${callId} management call was rejected.`);
  return matches[0][1];
};

export const openManagement = async (origin, apiKey) => {
  const expectedOrigin = safeOrigin(origin);
  invariant(apiKey && apiKey.length <= 4_096, "Management API key is unavailable.");
  const { payload } = await fetchJson(`${expectedOrigin}/.well-known/jmap`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
  });
  const apiUrl = new URL(payload.apiUrl, expectedOrigin);
  invariant(apiUrl.origin === expectedOrigin, "Management API changed origin.");
  return { apiKey, apiUrl: apiUrl.href, origin: expectedOrigin };
};

const resolveDomain = async (client, domain) => {
  const queryResponses = await call(client, [[
    "x:Domain/query",
    { calculateTotal: true, filter: { name: domain }, limit: 10 },
    "domain-query",
  ]]);
  const query = result(queryResponses, "domain-query", "x:Domain/query");
  invariant(Array.isArray(query.ids) && query.ids.length > 0, "Domain was not found.");
  const getResponses = await call(client, [[
    "x:Domain/get",
    { ids: query.ids, properties: ["id", "name", "isEnabled", "directoryId"] },
    "domain-get",
  ]]);
  const get = result(getResponses, "domain-get", "x:Domain/get");
  const matches = get.list.filter((item) => item.name.toLowerCase() === domain);
  invariant(matches.length === 1 && matches[0].isEnabled !== false,
    "The acceptance domain is missing or disabled.");
  invariant(!matches[0].directoryId, "The domain uses an external directory.");
  return matches[0];
};

export const createTemporaryAccount = async (client, domain) => {
  const resolved = await resolveDomain(client, domain);
  const localPart = `veda-accept-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const password = `Vm1-${randomBytes(24).toString("base64url")}`;
  const account = {
    "@type": "User",
    aliases: {},
    credentials: { "0": { "@type": "Password", secret: password } },
    domainId: resolved.id,
    encryptionAtRest: { "@type": "Disabled" },
    memberGroupIds: {},
    name: localPart,
    permissions: { "@type": "Inherit" },
    quotas: {},
    roles: { "@type": "User" },
  };
  const responses = await call(client, [[
    "x:Account/set", { create: { acceptance: account } }, "account-create",
  ]]);
  const created = result(responses, "account-create", "x:Account/set");
  const id = created.created?.acceptance?.id;
  invariant(id && !created.notCreated?.acceptance, "Temporary account creation failed.");
  return { email: `${localPart}@${domain}`, id, localPart, password };
};

export const deleteTemporaryAccount = async (client, account) => {
  invariant(account.localPart.startsWith("veda-accept-"),
    "Refusing to delete a non-acceptance account.");
  const responses = await call(client, [[
    "x:Account/set", { destroy: [account.id] }, "account-delete",
  ]]);
  const deleted = result(responses, "account-delete", "x:Account/set");
  invariant(deleted.destroyed?.includes(account.id), "Temporary account cleanup failed.");
};
