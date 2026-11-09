#!/usr/bin/env bash
# Sube las copias cifradas por FTPS a $FTP_DIR (relativo a la carpeta de la
# cuenta FTP) y borra las más viejas, dejando las últimas $KEEP.
# Lo usa .github/workflows/backup-supabase.yml.
set -euo pipefail

: "${FTP_SERVER:?}" "${FTP_USER:?}" "${FTP_PASS:?}" "${FTP_DIR:?}"
KEEP="${KEEP:-30}"
BASE="ftp://${FTP_SERVER}/${FTP_DIR}/"
# FTPS explícito. Usuario y contraseña van en un archivo de configuración de
# curl temporal (no en la línea de comandos), con comillas y escapes para que
# funcionen contraseñas con espacios, comillas o cualquier símbolo.
CFG="$(mktemp)"
trap 'rm -f "$CFG"' EXIT
esc() { local v="${1//\\/\\\\}"; printf '%s' "${v//\"/\\\"}"; }
printf 'user = "%s:%s"\n' "$(esc "$FTP_USER")" "$(esc "$FTP_PASS")" > "$CFG"
CURL=(curl --silent --show-error --fail --ssl-reqd -K "$CFG" ${FTP_INSECURE:+--insecure})

for f in "$@"; do
  "${CURL[@]}" --ftp-create-dirs -T "$f" "$BASE"
  echo "[backup] subida: $(basename "$f")"
done

# Lista, ordena por nombre (lleva la fecha) y borra todo menos las últimas $KEEP.
mapfile -t files < <("${CURL[@]}" --list-only "$BASE" | tr -d '\r' | grep -E '^supabase-[0-9]{4}-[0-9]{2}-[0-9]{2}\.json\.gz\.enc$' | sort)
total=${#files[@]}
echo "[backup] copias en el servidor: $total"
if (( total > KEEP )); then
  for f in "${files[@]:0:total-KEEP}"; do
    "${CURL[@]}" --output /dev/null --quote "DELE ${FTP_DIR}/${f}" "ftp://${FTP_SERVER}/"
    echo "[backup] borrada (vieja): $f"
  done
fi
