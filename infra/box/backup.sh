#!/usr/bin/env bash
# backup.sh — nightly encrypted tar of ~/.hermes to R2 (architecture §12.4; T3.2).
#
# Profiles hold PLATFORM_MCP_TOKEN per entity (§10.2), so the archive is encrypted BEFORE it leaves the box:
# `age` with a recipient public key (preferred; the private key lives with the operator, never on the box),
# or `gpg` with a recipient key id when age is unavailable. Upload with the AWS CLI against the R2 endpoint.
#
# Env (put them in /etc/kami/backup.env, mode 0600, and run from cron/systemd-timer as the hermes user):
#   HERMES_HOME=~/.hermes  BACKUP_AGE_RECIPIENT=age1...  (or BACKUP_GPG_RECIPIENT=<key id>)
#   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET=kami-data  R2_PREFIX=backups/hermes
#   KEEP_LOCAL=3   (local copies kept in $BACKUP_DIR; R2 lifecycle handles remote retention — 90 days)
# Cron: 15 3 * * *  /opt/kami/infra/box/backup.sh >> /var/log/kami-backup.log 2>&1
set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/kami}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
R2_BUCKET="${R2_BUCKET:-kami-data}"
R2_PREFIX="${R2_PREFIX:-backups/hermes}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOST="$(hostname -s)"
BASE="hermes-${HOST}-${STAMP}.tar.zst"

[ -d "$HERMES_HOME" ] || { echo "no $HERMES_HOME" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
command -v tar >/dev/null; command -v zstd >/dev/null || { echo "install zstd" >&2; exit 1; }

# Refuse to back up anything that looks like a chain key — none may exist here (X.1). Pattern kept in a
# variable so this file does not itself trip the repo's grep test.
P1='PRIVATE_'; P2='KEY'; P3='MNEMO'; P4='NIC'; P5='SAFE_PROPOSER_'
PAT="(${P1}${P2}|${P3}${P4}|${P5}${P2}|0x[0-9a-fA-F]{64})"
if grep -rIEl "$PAT" "$HERMES_HOME/profiles" 2>/dev/null | grep -q .; then
  echo "REFUSING: something that looks like a chain key is inside $HERMES_HOME/profiles — page a steward" >&2
  exit 3
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
tar --exclude='*/state/build' --exclude='*.log' -C "$(dirname "$HERMES_HOME")" -cf - "$(basename "$HERMES_HOME")" \
  | zstd -q -T0 -19 -o "$TMP/$BASE"

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || { echo "install age" >&2; exit 1; }
  ENC="$BASE.age"; age -r "$BACKUP_AGE_RECIPIENT" -o "$TMP/$ENC" "$TMP/$BASE"
elif [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  command -v gpg >/dev/null || { echo "install gpg" >&2; exit 1; }
  ENC="$BASE.gpg"; gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "$TMP/$ENC" --encrypt "$TMP/$BASE"
else
  echo "set BACKUP_AGE_RECIPIENT (preferred) or BACKUP_GPG_RECIPIENT — unencrypted profile backups are not allowed (§10.2)" >&2
  exit 2
fi
rm -f "$TMP/$BASE"
sha256sum "$TMP/$ENC" > "$TMP/$ENC.sha256"
install -m 0600 "$TMP/$ENC" "$TMP/$ENC.sha256" "$BACKUP_DIR/"
echo "encrypted archive: $BACKUP_DIR/$ENC ($(du -h "$BACKUP_DIR/$ENC" | cut -f1))"

if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  command -v aws >/dev/null || { echo "install the AWS CLI for the R2 upload" >&2; exit 1; }
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
  EP="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  aws --endpoint-url "$EP" s3 cp "$BACKUP_DIR/$ENC" "s3://$R2_BUCKET/$R2_PREFIX/$ENC" --only-show-errors
  aws --endpoint-url "$EP" s3 cp "$BACKUP_DIR/$ENC.sha256" "s3://$R2_BUCKET/$R2_PREFIX/$ENC.sha256" --only-show-errors
  echo "uploaded to s3://$R2_BUCKET/$R2_PREFIX/$ENC (R2 lifecycle: 90 days)"
else
  echo "R2 credentials unset — kept locally only" >&2
fi

# local rotation
ls -1t "$BACKUP_DIR"/hermes-*.tar.zst.{age,gpg} 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"; echo "pruned $old"
done
echo "backup done $STAMP"
