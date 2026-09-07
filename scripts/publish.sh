#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
npm run sync
npm run validate

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard articles images)" ]; then
  echo "公開する変更はありません"
  exit 0
fi

git status --short
git diff -- articles images
printf 'この内容をZennへ送りますか？ [y/N] '
read -r answer
[ "$answer" = y ] || [ "$answer" = Y ] || exit 0

git add articles images
git commit -m "publish: sync Zenn articles"
git push
