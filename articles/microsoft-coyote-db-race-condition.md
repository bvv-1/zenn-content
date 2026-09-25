---
title: CoyoteでDBのレースコンディションを検出する
emoji: "\U0001F43A"
type: tech
topics:
  - csharp
  - dotnet
  - database
  - coyote
  - 並行処理
published: true
---
## 1. はじめに

並行処理とは、複数の処理を時間的に重なり合わせて実行する処理方式です。処理性能や応答性の向上に役立つ一方で、実行順序やタイミングに依存する複雑なバグを埋め込むことがあります。

例えば、[2021年に発生したGitHubの障害](https://github.blog/security/vulnerability-research/how-we-found-and-fixed-a-rare-race-condition-in-our-session-handling/)は、バックグラウンドスレッドでの例外発生とメインスレッドでの複数のリクエスト処理が特定の順序で行われることで生じる、極めて稀なレースコンディションが原因でした。

こうしたバグを検出する方法として、従来はストレステストを行ったり、本番環境で問題が偶然発生した際のログを追ったりするのが一般的でした。しかし、並行処理ではタスクの実行順序の組み合わせが増えるにつれて、探索すべき状態空間が組み合わせ爆発するため、バグを見つけ出すのは極めて困難です。

そこで本記事では、.NET向けの並行処理のテストツールである[Coyote](https://microsoft.github.io/coyote/)を紹介します。題材にはLiteDBを使い、DB操作におけるレースコンディションをCoyoteで探索します。

## 2. Coyoteで並行処理を探索する

Coyoteは、Microsoftが開発した並行処理のテスト用ライブラリです（[インストール](https://microsoft.github.io/coyote/#get-started/install/)）。並行処理の実行順序（スケジューリング）をCoyote側で制御し、異なる実行順序を繰り返しテストすることで、特定の条件でのみ発生する潜在的なバグを効率的に検出します。

![hzo18_microsoft-coyote-db-race-condition_MUE4DK8TQPW8U](/images/microsoft-coyote-db-race-condition/hzo18_microsoft-coyote-db-race-condition_MUE4DK8TQPW8U.png)
https://www.microsoft.com/en-us/research/video/coyote-innovation-developer-tech-minutes/

Coyoteを使用する際は、まずテスト対象のアセンブリを書き換えることで、実行順序をCoyoteから制御できるようにします。

```bash
coyote rewrite ./Example.dll
```

書き換えたアセンブリに対して、指定した回数だけテストを実行します。各イテレーションでは独自のアルゴリズムに基づいて異なる実行順序を試すため、ストレステストでは再現しにくい実行順序も探索できます。

```bash
coyote test ./Example.dll --iterations 100
```

バグを発見すると、その実行順序が`.trace`ファイルとして保存されます。

```json
{
  "TestName": "Example",
  "CoyoteVersion": "1.7.11.0",
  "Settings": {
    "Strategy": "random",
    "StrategyBound": 0,
    "MaxFairSchedulingSteps": 100000,
    "MaxUnfairSchedulingSteps": 10000,
    "TimeoutDelay": 10,
    "DeadlockTimeout": 1000,
    "PortfolioMode": "fair",
    "IsLivenessCheckingEnabled": true,
    "LivenessTemperatureThreshold": 50000,
    "IsCollectionAccessRaceCheckingEnabled": true,
    "IsLockAccessRaceCheckingEnabled": true,
    "IsAtomicOperationRaceCheckingEnabled": true,
    "IsVolatileOperationRaceCheckingEnabled": true,
    "IsMemoryAccessRaceCheckingEnabled": false,
    "IsControlFlowRaceCheckingEnabled": false,
    "IsPartiallyControlledConcurrencyAllowed": true,
    "IsPartiallyControlledDataNondeterminismAllowed": true,
    "UncontrolledConcurrencyResolutionAttempts": 10,
    "UncontrolledConcurrencyResolutionDelay": 1000
  },
  "Steps": [
    "op(0:2654435832),sp(ContinueWith),next(1:175247760700)",
    "op(1:175247760700),sp(ContinueWith),next(1:175247760700)",
    "op(1:175247760700),sp(Complete),next(2:11093819475081)"
  ]
}
```

この`.trace`を使うことで、失敗した実行順序を決定的に再現することができます。

```bash
coyote replay ./Example.dll ./path/to/bug.trace
```

## 3. DB操作のレースコンディションを検出する

ここでは、DBの並行処理で発生する問題を検証します。今回は[LiteDB](https://www.litedb.org/) 5.0.21のインメモリDBを用いて、読み取りや書き込みのタイミングの違いが処理結果に与える影響を調べます。対象として、Read Skew、Phantom Read、Lost Update、Write Skewの4例を取り上げます。

検証に使用したコードは以下で公開しています。

https://github.com/bvv-1/coyote-test

### Read Skew
あるユーザーは口座1と口座2に100ずつ、合計200の預金があるとします。ここで、口座1から口座2に10移動させる送金処理を行い、口座1を90、口座2を110に更新してコミットします。もしこの送金処理の途中でユーザーが口座残高を参照した場合、タイミングによっては送金前の口座1と送金後の口座2を読み取ってしまい、合計が210に見えてしまう可能性があります。これがRead Skewです。

![read-skew](/images/microsoft-coyote-db-race-condition/read-skew.png)

このケースをコードで記述して、「2回の読み取りの合計が200になること」をCoyoteでテストしてみたところ、テストはパスしました。

LiteDBでは多版型同時実行制御（MVCC）を用いて読み取りバージョンを管理しています ([Deep Wiki](https://deepwiki.com/litedb-org/LiteDB/2.2-transaction-system))。今回のテストでは2回の残高照会で同じスナップショットを参照するため、処理の途中で送金がコミットされたとしても、送金前後の残高が混ざらずに整合性が保たれたことになります。

### Phantom Read
残高が100以上の口座数を複数回集計するケースを考えます。1回目の結果が2件だったとき、2回目の集計を行うまでの間に、別の処理によって条件に合う口座が新しく追加されると、2回目の結果が3件に増えてしまう可能性があります。このように、同じトランザクション内で同じ条件の集計を行っているにもかかわらず、存在しなかったレコードが途中で現れる現象をPhantom Readと呼びます。

![phantom-read](/images/microsoft-coyote-db-race-condition/phantom-read.png)

このケースをコードで記述して、「同一トランザクション内での2回の集計結果が一致すること」をCoyoteでテストしたところ、テストはパスしました。

こちらもLiteDBのMVCCの仕組みにより、検索の間に別処理で新しい口座が追加・コミットされたとしても、2回目の検索は1回目の開始時点と同じスナップショットを参照します。そのため、2回目の検索結果も1回目と同じ2件のまま維持され、Phantom Read が防止されたことが確認できました。

### Lost Update
残高100の口座に対して、2つの処理が同時に10ずつ加算するケースを考えます。実行順序によっては、両方の処理が現在の残高を同時に読み取り、そこに10加算した110を書き戻すと、片方の加算処理が上書きされて失われ、最終残高が本来の120ではなく110になってしまいます。これがLost Updateです。

![lost-update](/images/microsoft-coyote-db-race-condition/lost-update.png)

このケースをコードで記述して、「2回の加算処理後の残高が120になること」をCoyoteでテストしたところ、失敗する実行順序が検出されました。

そこで、修正版では現在の残高に対する加算を1回のアトミックなDB更新操作として実行するように変更します。

```csharp
accounts.UpdateMany("{ balance: balance + 10 }", "_id = 1");
```

これはSQLで表すと、以下の処理に相当します。

```sql
UPDATE accounts SET balance = balance + 10 WHERE _id = 1;
```

このように記述することで、各処理は「更新時点の最新残高」に対して確実に10を加算するようになります。修正後にCoyoteで再度テストを行ったところ、テストはパスするようになりました。

### Write Skew
「少なくとも1人の当直医が必要」という運用ルールのもと、現在2人の医師が当直しているケースを考えます。ここで、2人の医師が同時に退勤ボタンを押したとします。それぞれのトランザクションにおいて、「当直医が2人以上いるため、自分は退勤できる」と判断し、自身のステータスを退勤に更新してしまうと、当直医が0人になって当初の運用ルールが満たされない状態になってしまいます。このように、判断の前提となった条件が他方の更新によって崩れてしまう現象をWrite Skewと呼びます。

![write-skew](/images/microsoft-coyote-db-race-condition/write-skew.png)

このケースをコードで記述して、「処理後も必ず当直医が1人以上残ること」をCoyoteでテストしたところ、失敗する実行順序が検出されました。

そこで、修正版ではTwo-Phase Locking（2PL）の考え方に沿ってロックを制御するように変更します。2PLは、ロックを取得する「拡張フェーズ」と、ロックを解放する「縮小フェーズ」の2段階に分け、一度解放し始めたら新しいロックを取得しないことで並行処理の整合性を保つ方式です。

今回は.NETの [ReaderWriterLockSlim](https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim?view=net-9.0) を用いて、当直医の人数を数える際に読み取りロックを取得します。退勤可能な場合は、そのロックを保持したまま書き込みロックを取得して自身のステータスを退勤に更新します。これにより、修正後のコードはCoyoteのテストをパスするようになりました。

## 4. おわりに

いかがでしたか？Coyoteは本質的に難しい並行処理の問題を、開発段階で効率的に検出できる強力なツールです。

「自分やAIの書いた並行処理のコードに自信を持ちたい」という方は、ぜひCoyoteを触ってみてください！
