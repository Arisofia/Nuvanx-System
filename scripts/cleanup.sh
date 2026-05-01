#!/usr/bin/env bash
set -e

echo "==> Limpiando artefactos de despliegues anteriores..."

# 1. Borrar directorios típicos de build
rm -rf dist build out .next .nuxt .angular .parcel-cache
rm -rf target bin obj

# 2. Borrar dependencias instaladas
rm -rf node_modules vendor .venv venv env

# 3. Limpiar caches frecuentes
rm -rf .cache .turbo .gradle .m2

# 4. Borrar logs
find . -name "*.log" -type f -delete

# 5. Opcional: reset duro del repositorio (¡CUIDADO!)
# Descomenta estas líneas sólo si quieres volver el repo al último commit
# y perder cualquier cambio local no commiteado.
# echo "==> Haciendo git clean + reset (esto borra archivos no trackeados y cambios locales)"
# git clean -fdx
# git reset --hard HEAD

echo "==> Limpieza completa. Proyecto listo para correr desde 0."
