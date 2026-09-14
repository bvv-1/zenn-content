---
title: Docker Sandboxesで再現可能なAIエージェント評価環境を作ってみる
emoji: "\U0001F9EA"
type: tech
topics:
  - Docker Sandboxes
  - sbx-ai-eval-kit
  - Codex
  - AIエージェント
  - LLM評価
published: true
---
## Docker Sandboxesとは

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/)は、コーディングエージェントを隔離されたsandbox環境で動かすための仕組みです。通常のDockerコンテナがホスト側のLinuxカーネルを共有するのに対し、Docker SandboxesはsandboxごとにmicroVMを起動し、その内部に独立したLinuxカーネル、ファイルシステム、Docker Engineを持ちます。
![Docker Sandboxesの構成](/images/docker-sandbox-agent-evaluation/sandbox-architecture.png)

https://docs.docker.com/ai/sandboxes/security/

各環境でプロセスやメモリが厳密に隔離されているため、コーディングエージェントはsandbox内で`sudo`を含む権限を使って自由に作業を行えます。その一方で、明示的にマウントされた作業ディレクトリを除き、コーディングエージェントがホスト環境に干渉することはできません。

ネットワーク面においても隔離の仕組みが組み込まれており、sandbox内から外部への通信はすべてproxy経由で行われます。proxyにはAllow/Denyポリシーを設定できるため、通信先を必要な外部サービスのみに制限できます。さらに、APIキーなどの認証情報をsandbox内のプロセスに直接渡さず、proxy側で認証を代行させる構成も可能です。

このような設計は、[Managed Agents](https://aistudio.google.com/managed-agents)や[Cloud Agents](https://cursor.com/ja/cloud)をはじめとするクラウド型エージェントで広く採用されている標準的なアプローチです。同様の隔離をローカル環境で実現できることが、Docker Sandboxesの大きな魅力です。

## コーディングエージェントをYOLOモードで実行する

Docker Sandboxesを利用するには、まず`sbx` CLIをインストールします（[インストール](https://docs.docker.com/ai/sandboxes/install/)）。

```bash
sbx version
# sbx version: v0.42.1 cc6e400a4a3ce3ce5e0b2b77b8ee352aac854c64
```

sandbox内でコーディングエージェントを起動するには、`sbx run`を実行します。以下はCodexの例ですが、他にも様々なサービスに対応しています（[対応エージェント一覧](https://docs.docker.com/ai/sandboxes/agents/)）。CodexのOAuth認証はホスト側で管理されるため、一度認証すればログイン状態を再利用できます。

```bash
cd ~/your-project
sbx run codex
```

デフォルトの動作モードは`Direct mode`です。このモードでは、指定したホスト上の作業ディレクトリがそのままsandboxにマウントされます。コーディングエージェントはマウントされたファイルを直接編集するため、sandbox終了後も変更内容がホスト側に保持されます。

一方、ホスト側の作業ツリーを汚したくない場合は`Clone mode`を使用します。このモードでは、ホスト上のリポジトリが読み取り専用でsandboxに共有され、コーディングエージェントはsandbox内に作成されたclone上で作業します。

```bash
sbx run codex --clone
```

Dockerの公式ドキュメントでは、sandboxそのものをセキュリティ境界とみなし、コーディングエージェントをユーザー承認なし（YOLO mode）で動かす構成が推奨されています。

例えば、Codexのデフォルトの起動コマンドは`codex --dangerously-bypass-approvals-and-sandbox`に設定されています。そのため、ホスト側の環境への影響をsandboxが防止してくれるため、対話的に承認を行わずに安心して長時間のタスクをコーディングエージェントに任せやすくなります。

## Docker Sandboxes上でコーディングエージェントを評価する

microVM上で動作するDocker Sandboxesは、隔離された実行基盤を提供すると同時に、同じ構成のsandboxを作り直せるという強みがあります。言い換えると、環境の再現性が担保しやすいと言えます。

Docker Sandboxesには、環境の構成・再利用を支援する[Kits](https://docs.docker.com/ai/sandboxes/customize/kits/)という仕組みが用意されています。Kitsでは、`setup`で事前インストールコマンド、`environment`で環境変数、`agentInstructions`でコーディングエージェント向けの指示などを定義できます。

今回は、[Docker公式の技術記事](https://www.docker.com/ja-jp/blog/building-reproducible-ai-evaluation-workflows-with-docker-sandboxes/)を参考に、Kitsを活用したコーディングエージェントの評価環境を構築しました。リポジトリはこちらにあります。

https://github.com/bvv-1/docker-sandboxes-test

Kitsが評価・実行環境を固定し、Pythonスクリプト経由で各試行を起動します。標準出力、標準エラー出力、終了コード、実行時間、生成パッチ、テスト結果はすべて`.runs/<run-id>/`に保存されます。なお、評価にはLLM-as-a-judgeではなく、`unittest`による決定的なテストを使用しています。

今回はモデルを[Qwen3-Coder-30B-A3B-Instruct](https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF)をOpenCode / Cline / Aiderの3つのエージェントツール経由で動かした際のパフォーマンスを比較しました。Qwen3-CoderはMoE (Mixture of Experts) 構成のモデルであり、`A3B`は推論時にアクティブになるパラメータ数が約30億であることを示します。軽量なため、24GBメモリのM3 Macbook上でも動作します。モデルサーバーには`llama.cpp`を使用しました。

ディレクトリ構成は以下の通りです。

```text
kits/
├── ai-eval/        共通の評価用ツールとエージェント指示
├── opencode-local/ OpenCodeとローカルモデルの接続設定
├── cline-local/    Cline CLIとローカルモデルの接続設定
└── aider-local/    Aiderとローカルモデルの接続設定
```

例えば、OpenCode用のKitsでは以下のように定義しています。

```yaml
schemaVersion: "2"
kind: sandbox
name: opencode-local
version: "0.1.0"
displayName: OpenCode with local llama.cpp
description: Extends the built-in OpenCode agent for the pinned local model endpoint.
extends: opencode

args:
  opencode_version:
    default: "1.18.30"
    pattern: '^[0-9]+\.[0-9]+\.[0-9]+$'
  model_port:
    default: "9931"
    pattern: '^[0-9]{2,5}$'
  model_alias:
    default: qwen3-coder-30b-a3b-instruct-q3-k-s

agentInstructions:
  filename: AGENTS.md
  content: |
    Use the local OpenAI-compatible model configured by this kit.

environment:
  variables:
    OPENCODE_CONFIG: /home/agent/.config/opencode/local-eval.json

permissions:
  network:
    allow:
      - host.docker.internal
      - localhost
      - registry.npmjs.org

setup:
  install:
    - command: "npm install --global opencode-ai@${{ kit.args.opencode_version }}"
      user: "1000"
```

評価は以下のコマンドで実行します。

```bash
make eval-polyglot AGENTS="opencode" TASKS="proverb" TRIALS=3
```

ベンチマークには、[Aider Polyglot Benchmark](https://github.com/Aider-AI/polyglot-benchmark)から次の4課題を選定しました。

- [connect](https://github.com/Aider-AI/polyglot-benchmark/tree/main/python/exercises/practice/connect): Hex（ボードゲーム）の勝者を判定する
- [bowling](https://github.com/Aider-AI/polyglot-benchmark/tree/main/python/exercises/practice/bowling): ボウリングの投球結果からスコアを計算する
- [go-counting](https://github.com/Aider-AI/polyglot-benchmark/tree/main/python/exercises/practice/go-counting): 囲碁の盤面における地を判定する
- [proverb](https://github.com/Aider-AI/polyglot-benchmark/tree/main/python/exercises/practice/proverb): 入力からことわざを組み立てる

各課題を3回ずつ実行した結果は以下のようになりました。

| エージェント   | connect | bowling | go-counting | proverb |
| -------- | ------: | ------: | ----------: | ------- |
| OpenCode |   0 / 3 |   0 / 3 |       0 / 3 | 3 / 3   |
| Cline    |   0 / 3 |   0 / 3 |       0 / 3 | 2 / 3   |
| Aider    |   0 / 3 |   0 / 3 |       0 / 3 | 3 / 3   |

`proverb`のような比較的シンプルな問題は安定して解けた一方で、それ以外の問題は解くことができませんでした。なお、`proverb`でClineが失敗した回は、コンテキスト長の上限（16,384 tokens）の超過が原因となっており、環境的な制約で十分な能力を発揮できなかった可能性もあります。

## おわりに

いかがでしたか？Docker Sandboxesは、コーディングエージェントをYOLO modeで安全に動かすためのセキュリティ境界として強力なツールなだけでなく、再現可能な評価環境を作る仕組みにも使えます。

コーディングエージェントを安全に活用したい方や、eval-drivenでハーネスを整備したい方はぜひ触ってみてください！
