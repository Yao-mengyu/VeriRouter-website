#!/bin/zsh
cd -- "${0:A:h}" || exit 1
exec node scripts/open-preview.mjs "$@"
