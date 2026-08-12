# Release checklist

Use this checklist for a tagged image or production promotion. Record commands,
commit/digest, approver, timestamps, exceptions, backup evidence, deployment
result, and rollback decision in the release record.

## Scope and source

- [ ] Release commit is reviewed, merged to protected `main`, and the worktree
  is clean.
- [ ] Roadmap, changelog, architecture, threat model, provider behavior,
  deployment impact, privacy lifecycle, and upgrade/rollback notes match code.
- [ ] No secrets, production data, generated local state, or unlicensed assets
  are present; AGPL source link and third-party notices are correct.
- [ ] Dependencies, actions, base images, and sidecars are locked/pinned;
  Dependabot findings and exceptions have an owner and expiry.

## Verification

- [ ] `npm ci` succeeds with the declared Node/npm versions.
- [ ] `npm run check`, coverage baseline, and `npm run build` pass.
- [ ] Full Chromium regressions pass, including accessibility and both provider
  contracts affected by the release.
- [ ] `npm audit --audit-level=high`, secret/misconfiguration scan, CodeQL,
  final-image/sidecar scans, and live pinned ClamAV acceptance pass.
- [ ] Production headers, health/readiness behavior, rate limits, redaction,
  storage permissions, and migration/rollback compatibility are verified.
- [ ] Published per-platform images match the source and manifest; generated
  SBOM and BuildKit/SLSA provenance attestations are present and inspectable.

## Data and recovery

- [ ] Exact pre-release image/commit, environment schema, `/data` snapshot,
  `VEDA_MAIL_JOB_KEY`, and other required secrets are recoverable.
- [ ] `npm run backup:drill -- --source <offline-copy> --work-dir <empty-dir>`
  reports matching restored bytes and its report/archive checksums are retained.
- [ ] Isolated restore locks `/setup`, passes health/readiness, accepts an admin
  and dedicated member login, and exposes expected encrypted member state.
- [ ] Upgrade and rollback were rehearsed against a copy; provider-native side
  effects that volume rollback cannot reverse are documented.
- [ ] Audit, external log, metrics, provider and backup retention match the
  published privacy notice; legal holds are not silently destroyed.

## Promotion and verification

- [ ] Maintenance window, monitoring owner, rollback authority, and user impact
  are communicated; no overlapping writable replica is introduced.
- [ ] Deploy the immutable digest, wait for readiness, then verify setup lock,
  admin/member authentication, receive/send/search, and changed features.
- [ ] Confirm public health is minimal/non-cacheable, security headers are
  intact, dashboards show no sustained provider/error/latency regression, and
  logs contain no mailbox content or secrets.
- [ ] Preserve deployment evidence and announce security/privacy/configuration
  changes. Keep the prior image and volume until the rollback window closes.

## Failure handling

Stop promotion on an unexplained failure, missing attestation, unreviewed
schema change, unverifiable backup, wrong restore key, security regression, or
ambiguous provider mutation. Preserve evidence, restore the previous immutable
image/data snapshot when safe, verify health and authentication, and document
provider-side actions that require separate reconciliation.
