# Zenn Content

Obsidian Vault 内の原稿をZenn形式へ変換し、GitHub連携用の `articles/` と `images/` に同期する公開専用リポジトリです。原稿の正本はVaultにあり、このリポジトリでは直接編集しません。

## セットアップ

```sh
npm install
cp .env.example .env
```

`.env` の `OBSIDIAN_ARTICLES_DIR` を実在する `tech-blog-articles` の絶対パスに変更します。

## 原稿の形式

原稿は `tech-blog-articles/*.md`、画像は `tech-blog-articles/images/<zenn_slug>/` に置きます。

```md
---
title: 記事タイトル
status: writing
tags:
  - Docker
zenn_slug: 12-to-50-char-slug
emoji: 📝
type: tech
---

本文
```

`status: writing` はZennの下書き、`status: published` は公開記事へ変換されます。画像はObsidianで `![](images/<zenn_slug>/image.png)` と書くと、同期時にZenn用の `/images/...` へ変換されます。

## 操作

```sh
# Vaultから同期して形式を検証
npm run sync
npm run validate

# Zenn形式でプレビュー
npm run preview

# 同期・検証・コミット・push
npm run publish
```

`publish` は差分と公開対象を表示し、確認後にコミットして現在のブランチをpushします。初回のみ、このリポジトリをZennのGitHub連携先として設定してください。
