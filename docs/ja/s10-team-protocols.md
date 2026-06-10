# s10: Team Protocols

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > [ s10 ] s11 > s12`

> *"チームメイト間には統一の通信ルールが必要"* -- 1つの request-response パターンが全交渉を駆動。
>
> **Harness 層**: プロトコル -- モデル間の構造化されたハンドシェイク。

## 問題

s09ではチームメイトが作業し通信するが、構造化された協調がない:

**シャットダウン**: スレッドを強制終了するとファイルが中途半端に書かれ、config.jsonが不正な状態になる。ハンドシェイクが必要 -- リーダーが要求し、チームメイトが承認(完了して退出)か拒否(作業継続)する。

**プラン承認**: リーダーが「認証モジュールをリファクタリングして」と言うと、チームメイトは即座に開始する。リスクの高い変更では、実行前にリーダーが計画をレビューすべきだ。

両方とも同じ構造: 一方がユニークIDを持つリクエストを送り、他方がそのIDで応答する。

## 解決策

```
Shutdown Protocol            Plan Approval Protocol
==================           ======================

Lead             Teammate    Teammate           Lead
  |                 |           |                 |
  |--shutdown_req-->|           |--plan_req------>|
  | {requestId:"abc"}  |           | {requestId:"xyz"}  |
  |                 |           |                 |
  |<--shutdown_resp-|           |<--plan_resp-----|
  | {requestId:"abc",  |           | {requestId:"xyz",  |
  |  approve:true}  |           |  approve:true}  |

Shared FSM:
  [pending] --approve--> [approved]
  [pending] --reject---> [rejected]

Trackers:
  const shutdownRequests = new Map(requestId, { target, status })
  const planRequests     = new Map(requestId, { from, plan, status })
```

## 仕組み

1. リーダーがrequestIdを生成し、インボックス経由でシャットダウンを開始する。

```ts
const shutdownRequests = new Map<string, { target: string; status: 'pending' | 'approved' | 'rejected' }>();

async function handleShutdownRequest(teammate: string) {
  const requestId = crypto.randomUUID().slice(0, 8);
  shutdownRequests.set(requestId, { target: teammate, status: 'pending' });
  await bus.send('lead', teammate, 'Please shut down gracefully.', 'shutdown_request', {
    requestId,
  });
  return `Shutdown request ${requestId} sent (status: pending)`;
}
```

2. チームメイトがリクエストを受信し、承認または拒否で応答する。

```ts
if (toolName === 'shutdown_response') {
  const requestId = String(args.requestId);
  const approve = Boolean(args.approve);
  const request = shutdownRequests.get(requestId);
  if (request) request.status = approve ? 'approved' : 'rejected';

  await bus.send(sender, 'lead', String(args.reason ?? ''), 'shutdown_response', {
    requestId,
    approve,
  });
}
```

3. プラン承認も同一パターン。チームメイトがプランを提出(requestIdを生成)、リーダーがレビュー(同じrequestIdを参照)。

```ts
const planRequests = new Map<string, { from: string; status: 'pending' | 'approved' | 'rejected' }>();

async function handlePlanReview(requestId: string, approve: boolean, feedback = '') {
  const request = planRequests.get(requestId);
  if (!request) return 'Unknown plan request';

  request.status = approve ? 'approved' : 'rejected';
  await bus.send('lead', request.from, feedback, 'plan_approval_response', {
    requestId,
    approve,
  });
}
```

1つのFSM、2つの応用。同じ`pending -> approved | rejected`状態機械が、あらゆるリクエスト-レスポンスプロトコルに適用できる。

## s09からの変更点

| Component      | Before (s09)     | After (s10)                  |
|----------------|------------------|------------------------------|
| Tools          | 9                | 12 (+shutdown_req/resp +plan)|
| Shutdown       | Natural exit only| Request-response handshake   |
| Plan gating    | None             | Submit/review with approval  |
| Correlation    | None             | requestId per request       |
| FSM            | None             | pending -> approved/rejected |

