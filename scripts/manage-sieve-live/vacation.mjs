import { invariant, memberRequest } from "./http.mjs";

const vacationWorkspace = async (baseUrl, session) =>
  memberRequest(baseUrl, "/api/v1/member/vacation", session);

const putVacation = async (baseUrl, session, body) =>
  memberRequest(baseUrl, "/api/v1/member/vacation", {
    ...session, body, method: "PUT", statuses: [200],
  });

const canonicalUtc = (value) => new Date(Math.floor(value / 1_000) * 1_000)
  .toISOString().replace(".000Z", "Z");

export const exerciseVacation = async (baseUrl, session, expectedRuleCount) => {
  const initial = await vacationWorkspace(baseUrl, session);
  invariant(initial.payload.data.capability.supported,
    "ManageSieve vacation support was not advertised through Veda Mail.");
  invariant(initial.payload.data.response?.isEnabled === false,
    "The temporary mailbox unexpectedly contains a Veda vacation response.");
  const now = Date.now();
  const enabled = await putVacation(baseUrl, session, {
    expectedRevision: initial.payload.data.response.revision,
    fromDate: canonicalUtc(now - 60 * 60_000),
    htmlBody: "<p>Veda Mail isolated vacation acceptance.</p>",
    isEnabled: true,
    subject: "Veda Mail acceptance away",
    textBody: "Veda Mail isolated vacation acceptance.",
    toDate: canonicalUtc(now + 24 * 60 * 60_000),
  });
  invariant(enabled.payload.data.isEnabled === true,
    "The provider did not enable the vacation response.");
  const reloaded = await vacationWorkspace(baseUrl, session);
  invariant(reloaded.payload.data.response?.revision === enabled.payload.data.revision,
    "The provider did not reload the exact vacation response revision.");
  const preserved = await memberRequest(baseUrl, "/api/v1/member/rules", session);
  invariant(preserved.payload.data.book.rules.length === expectedRuleCount,
    "Vacation composition did not preserve the active Veda rules.");
  const disabled = await putVacation(baseUrl, session, {
    expectedRevision: enabled.payload.data.revision,
    fromDate: null, htmlBody: null, isEnabled: false,
    subject: null, textBody: null, toDate: null,
  });
  invariant(disabled.payload.data.isEnabled === false,
    "The provider did not disable the vacation response.");
  return true;
};
