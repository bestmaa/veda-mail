#!/bin/sh
set -eu

docker_architecture="$(docker version --format '{{.Server.Arch}}')"
case "$docker_architecture" in
  amd64 | x86_64)
    ;;
  *)
    echo \
      "Unsupported Docker server architecture '$docker_architecture': the approved ClamAV sidecar is currently linux/amd64-only." \
      >&2
    echo \
      "Refusing the secure-attachment deployment rather than bypassing malware scanning." \
      >&2
    exit 1
    ;;
esac

approved_image="clamav/clamav:1.5.3@sha256:7f5389ccaa2368c383fa80e167ccfe44348d71e685f926fce4755eed1757673a"
docker compose config --quiet
matching_images="$(
  docker compose config --images \
    | awk -v approved="$approved_image" '$0 == approved { count += 1 } END { print count + 0 }'
)"
if [ "$matching_images" -ne 1 ]; then
  echo \
    "Compose must reference the approved immutable ClamAV image exactly once." \
    >&2
  exit 1
fi

echo "ClamAV platform preflight passed for linux/amd64."
