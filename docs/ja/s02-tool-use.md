# s02: Tool Use

`s01 > [ s02 ] s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"ツールを足すなら、ハンドラーを1つ足すだけ"* -- ループは変わらない。新ツールは dispatch map に登録するだけ。
>
> **Harness 層**: ツール分配 -- モデルが届く範囲を広げる。

## 問題

`bash`だけでは、エージェントは何でもシェル経由で行う。`cat`は予測不能に切り詰め、`sed`は特殊文字で壊れ、すべてのbash呼び出しが制約のないセキュリティ面になる。`read_file`や`write_file`のような専用ツールなら、ツールレベルでパスのサンドボックス化を強制できる。

重要な点: ツールを追加してもループの変更は不要。

## 解決策

```
+--------+      +-------+      +------------------+
|  User  | ---> |  LLM  | ---> | Tool Dispatch    |
| prompt |      |       |      | {                |
+--------+      +---+---+      |   bash: run_bash |
                    ^           |   read: run_read |
                    |           |   write: run_wr  |
                    +-----------+   edit: run_edit |
                    tool_result | }                |
                                +------------------+

The dispatch map is a dict: {tool_name: handler_function}.
One lookup replaces any if/elif chain.
```

## 仕組み

1. 各ツールにハンドラ関数を定義する。パスのサンドボックス化でワークスペース外への脱出を防ぐ。

```ts
const WORKDIR = process.cwd();

function safePath(inputPath: string) {
  const resolved = path.resolve(WORKDIR, inputPath);
  if (!resolved.startsWith(WORKDIR + path.sep)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}

async function runRead(filePath: string, limit?: number) {
  const text = await fs.readFile(safePath(filePath), 'utf8');
  const lines = text.split('\n');
  const selected = limit && limit < lines.length ? lines.slice(0, limit) : lines;
  return selected.join('\n').slice(0, 50_000);
}
```

2. ディスパッチマップがツール名とハンドラを結びつける。

```ts
type ToolHandler = (input: Record<string, unknown>) => Promise<string> | string;

const toolHandlers: Record<string, ToolHandler> = {
  bash: (input) => runBash(String(input.command)),
  read_file: (input) => runRead(String(input.path), input.limit as number | undefined),
  write_file: (input) => runWrite(String(input.path), String(input.content)),
  edit_file: (input) => runEdit(
    String(input.path),
    String(input.oldText),
    String(input.newText)
  ),
};
```

3. ループ内で名前によりハンドラをルックアップする。ループ本体はs01から不変。

```ts
for (const block of response.content) {
  if (block.type !== 'tool_use') continue;

  const handler = toolHandlers[block.name];
  const output = handler
    ? await handler(block.input as Record<string, unknown>)
    : `Unknown tool: ${block.name}`;

  results.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: output,
  });
}
```

ツール追加 = ハンドラ追加 + スキーマ追加。ループは決して変わらない。

## s01からの変更点

| Component      | Before (s01)       | After (s02)                |
|----------------|--------------------|----------------------------|
| Tools          | 1 (bash only)      | 4 (bash, read, write, edit)|
| Dispatch       | Hardcoded bash call | `TOOL_HANDLERS` dict       |
| Path safety    | None               | `safe_path()` sandbox      |
| Agent loop     | Unchanged          | Unchanged                  |

