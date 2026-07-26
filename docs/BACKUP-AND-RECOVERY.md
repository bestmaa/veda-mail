# Backup, restore, and recovery

Veda Mail's durable state lives in `VEDA_MAIL_DATA_DIR`, mounted as `/data` in
the supplied Compose deployment.

## What `/data` contains

- Completed-installation state
- Administrator username and scrypt password hash
- Random 48-byte administrator session-signing secret and auth version
- Encrypted administrator TOTP secret and salted backup-code digests, if enabled
- Organization and product branding
- Optional normalized WebP logo
- Mail-provider endpoint and allowed-domain configuration, embedded in the
  atomic installation record

It does not contain mailbox messages or durable copies of member passwords.
Messages remain on the configured mail server. Active member sessions are
process-memory only and disappear on restart.

## Compose volume backup

First identify the actual volume name:

```bash
docker volume ls
docker compose config --volumes
```

From the repository directory on a Linux host, choose a private backup
directory, then stop writes:

```bash
mkdir -p backups
BACKUP_FILE="veda-mail-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose stop veda-mail
```

Archive the mounted volume through a one-off container:

```bash
docker compose run --rm --no-deps --user 0:0 \
  --entrypoint sh \
  -e BACKUP_FILE="$BACKUP_FILE" \
  -v "$PWD/backups:/backup" \
  veda-mail \
  -c 'tar -czf "/backup/$BACKUP_FILE" -C /data .'
docker compose start veda-mail
sha256sum "backups/$BACKUP_FILE"
```

Store the archive and checksum outside the server. If your platform provides
atomic volume snapshots, use that feature instead.

Encrypt backup archives at rest and restrict access. Treat them like
administrator credentials.

Dockploy users should schedule backups for the volume mounted at `/data` and
periodically test restoration to a separate non-production service.

## Bind-mount backup

If `/data` is a bind mount, stop the service and copy the entire directory with
ownership, permissions, timestamps, and hidden files preserved. Do not copy
individual JSON files while the application is writing them.

## Restore

Restore into a fresh Compose project first, never over the only production
volume:

```bash
export COMPOSE_PROJECT_NAME=veda-mail-restore
export VEDA_MAIL_PORT=3100
export BACKUP_FILE=veda-mail-data-YYYYMMDDTHHMMSSZ.tar.gz

docker compose run --rm --no-deps --user 0:0 \
  --entrypoint sh \
  -e BACKUP_FILE="$BACKUP_FILE" \
  -v "$PWD/backups:/backup:ro" \
  veda-mail \
  -c 'test -z "$(ls -A /data)" &&
      tar -xzf "/backup/$BACKUP_FILE" -C /data &&
      chown -R 1001:1001 /data'
docker compose up -d
curl --fail http://127.0.0.1:3100/api/health
```

Then sign in to `/admin` on the isolated instance and test one member login.
For a production cutover, stop the old project, point the reverse proxy at the
verified restored project, and preserve the old volume until validation is
complete.

Restoring an older backup also restores its administrator credentials,
branding, provider profile, and setup lock. Existing member sessions are not
restored.

## Administrator recovery

Before enabling admin 2FA, set a separate random deployment secret:

```bash
openssl rand -hex 32
```

Store its output as `VEDA_MAIL_ADMIN_RECOVERY_TOKEN` in the deployment secret
manager. Do not reuse the setup token, admin password, or an authenticator
backup code.

If the admin password is forgotten, or both the authenticator device and all
backup codes are lost, open an interactive terminal inside the running Veda
Mail container and run:

```bash
node /app/scripts/admin-recovery.mjs
```

Enter the recovery token and new password at the hidden prompts, then type
`RESET`. The command atomically resets the password, removes administrator 2FA
and its backup codes, increments the authentication version, and invalidates
every existing administrator session. It preserves branding and mail-provider
configuration. Enable 2FA again after signing in.

The recovery token is never accepted by a web API. Rotate the deployment
secret after using it and redeploy. Do not manually edit or delete
`installation.json`.

## Recovery rehearsal

At least quarterly:

1. Restore the latest backup to an isolated hostname.
2. Confirm `/setup` remains locked.
3. Confirm administrator login.
4. Confirm branding and provider configuration.
5. Test a dedicated non-production mailbox.
6. Delete the isolated environment after recording the result.

Never test a restore by overwriting the only production volume.
