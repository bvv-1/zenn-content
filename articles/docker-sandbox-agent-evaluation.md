---
title: sbx-ai-eval-kitでQwenのコーディング能力を測ってみる
emoji: "\U0001F9EA"
type: tech
topics:
  - Docker Sandboxes
  - sbx-ai-eval-kit
  - Qwen
  - Qwen Code
  - AIエージェント
published: false
---
## 仮タイトル

sbx-ai-eval-kitでQwenのコーディング能力を測ってみる

## この記事の位置づけ

Docker Sandboxes、sbx-ai-eval-kit、Qwen、コーディングエージェント評価の関係を、実際に小さく動かしながら理解する最初の記事。

この段階ではモデル性能を厳密に比較したり、SWE-benchのスコアを出したりすることを目標にしない。Qwenが課題を受け取り、コードを変更し、テスト結果と実行ログが残るまでの一連の流れを作り、評価基盤の全体像をつかむ。

## 読者に持ち帰ってほしいこと

- Docker Sandboxesが通常のDockerコンテナと何が違うか
- sbx-ai-eval-kitが担当する範囲と、担当しない範囲
- モデル、エージェントハーネス、実行環境、評価器を分けて考える理由
- AIコーディング評価で最低限残したい証跡
- 次にSWE-benchへ進むために何が不足しているか

## 記事の問い

1. sbx-ai-eval-kitだけでQwenのコーディング能力を測れるのか
2. Qwenをコーディングエージェントとして動かすには、どのハーネスが必要か
3. Docker Sandboxesは実行の安全性と再現性にどう関わるか
4. 小さなテスト付き課題を、どこまで自動実行・自動判定できるか
5. 実験をもう一度実行したとき、同じ結果になるか

## 想定する全体構成

```text
コーディング課題
    ↓
Qwenモデル
    ↓
コーディングエージェントのハーネス
    ↓
Docker Sandboxes上でファイル編集・コマンド実行
    ↓
テストによる判定
    ↓
ログ・生成パッチ・評価結果を保存
```

## 構成案

### 1. なぜ試すのか

- AIコーディングエージェントはコード生成だけでなく、任意コマンドを実行する
- ホストで自動承認モードを使うことへの不安
- モデルを固定しても、実行環境が違えば評価結果が変わる問題
- まず小さく一周動かし、評価に必要な部品を把握したい

### 2. Docker Sandboxesとは何か

- サンドボックスごとに独立したmicroVMを使う
- VM内に独立したLinuxカーネル、ファイルシステム、ネットワーク、Docker Engineがある
- 通常のコンテナやDocker socket共有との違い
- direct mount、clone mode、mountlessの違い
- 「隔離されている」と「ホストへ影響しない」は同義ではない

### 3. sbx-ai-eval-kitを読んでみる

- `evaluation.yaml`が表すもの
- Local ExecutorとSBX Executor
- stdout、stderr、終了コード、所要時間、設定ダイジェストの保存
- 実行ごとにsandboxを作成・削除する流れ
- 現状はモデル実行や自動採点を行わないこと

### 4. Qwenをどう接続するか考える

- モデルとコーディングエージェントハーネスの違い
- Qwen Codeなどの候補
- ローカルモデルサーバーとOpenAI互換API
- Qwen 8B系のモデル名、revision、量子化方式を固定する必要
- 自動承認モードをsandbox内だけで許可する構成

### 5. 最小の評価課題を作る

- 初回はSWE-benchではなく、小さなテスト付き課題を1〜3問使う
- 例: 境界値バグの修正、既存APIを維持した小機能追加
- 問題文、開始commit、制限時間、試行回数を固定する
- 既存テストと課題専用テストで成否を判定する

### 6. 実際に一周動かす

- sandboxを作る
- 課題をQwenへ渡す
- エージェントが調査・編集・テストする
- 終了後に生成パッチとログを回収する
- sandboxを削除する

この節のコマンドと画面出力は、実際に触った後で記載する。

### 7. 結果を見る

| 課題 | 成功回数 / 試行回数 | 所要時間 | ツール呼び出し回数 | 主な失敗理由 |
|---|---:|---:|---:|---|
| 課題1 | 未実施 | 未実施 | 未実施 | 未実施 |
| 課題2 | 未実施 | 未実施 | 未実施 | 未実施 |
| 課題3 | 未実施 | 未実施 | 未実施 | 未実施 |

スコアだけでなく、代表的な成功例と失敗例を一つずつ取り上げる。モデルの失敗、ハーネスの失敗、環境構築の失敗を分けて考える。

### 8. 触って分かったこと

実験後、以下の観点で整理する。

- 想定より簡単だった部分
- 手作業が残った部分
- 再実行して結果が変わった部分
- Docker Sandboxesによって防げたリスク
- Docker Sandboxesだけでは防げないリスク
- sbx-ai-eval-kitへ追加したくなった機能

### 9. 今回の限界

- 少数の自作課題ではQwenの一般的な性能を評価できない
- 他モデル、他ハーネスとの比較ではない
- 量子化とローカル実行環境の影響を含む
- sandboxを使っても、モデルや依存関係を固定しなければ再現性は保証されない

### 10. 次はSWE-bench Verifiedへ

- 小さな課題をSWE-benchの固定サブセットへ置き換える
- SWE-benchの評価コンテナをsandbox内のDocker Engineで動かす
- 10〜20問を複数回実行してばらつきを見る
- 公式リーダーボード相当ではなく、評価ワークフローの検証として扱う

## 実験前に決めること

- [ ] Qwenの正確なモデルIDとrevision
- [ ] 量子化方式
- [ ] 推論ランタイム
- [ ] コーディングエージェントハーネス
- [ ] 自動承認・非対話実行の方法
- [ ] 最初の評価課題
- [ ] 制限時間と試行回数
- [ ] ネットワークポリシー
- [ ] 保存するログと成果物の形式
- [ ] 成功・失敗の判定基準

## 保存したい証跡

- 環境情報と各ツールのバージョン
- モデルID、revision、量子化方式、生成パラメータ
- 課題文と開始commit
- 実行コマンド
- エージェントのイベントログ
- stdoutとstderr
- 終了コードと所要時間
- 生成されたGit diff
- テスト結果
- 最終的な判定と失敗理由

## 参考資料

- [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/)
- [Docker Sandboxesのアーキテクチャ](https://docs.docker.com/ai/sandboxes/architecture/)
- [Docker Sandboxesのセキュリティモデル](https://docs.docker.com/ai/sandboxes/security/)
- [sbx-ai-eval-kit](https://github.com/karanverma/sbx-ai-eval-kit)
- [Dockerサンドボックスを使用して再現可能なAI評価ワークフローを構築する](https://www.docker.com/ja-jp/blog/building-reproducible-ai-evaluation-workflows-with-docker-sandboxes/)
- [Qwen Code](https://github.com/QwenLM/qwen-code)
- [SWE-bench](https://github.com/SWE-bench/SWE-bench)
