# server/ — MMO 伺服器與協定工具（TypeScript, 零依賴）

## 現況（誠實聲明）

| 元件 | 狀態 |
|---|---|
| `src/protocol/frame.ts` | ✅ 框架層：4-byte 標頭（`u16 header` + `u16 bodyLen`）+ 1460 上限，皆有 binary 證據；另保留舊的 u16 總長 framing 供握手用。 |
| `src/protocol/cipher.ts` | ✅ 會話加密：MSVC rand LCG、`swapNibbles`、送/收狀態、標頭 `0xD3 ^ HIWORD(state)`（`sub_4A1B90`/`sub_4A2030`）。 |
| `src/protocol/session.ts` | ✅ 211-byte 握手 codec + 串流解碼器 `SessionDeframer`：先吃握手取種子，之後逐包解密並**自檢標頭**。 |
| `src/net/capture.ts` | ✅ **擷取伺服器**（ADR-004）：接住原 client，寫出 JSONL trace；無法解碼的 chunk 標記一次後改為原始傾印，**不丟資料**。 |
| `src/net/decode.ts` | ✅ trace 重播器：把 JSONL 解回可讀封包，種子可自動取自握手。 |
| `src/cli.ts` | ✅ `capture` / `decode` 子命令 |
| login/world/game 邏輯 | ❌ **尚未實作**，且**不會在協定被擷取證實之前實作**（避免憑空發明封包） |

## 為什麼先做擷取？

2003 KMS 1.11 沒有任何公開 server 或協定文件。與其猜，不如讓**原 client 自己說話**：

```bash
# 1) 啟動擷取伺服器（預設 session 模式 = 真實連線模型）
node server/src/cli.ts capture --port 8484 --out traces/login.jsonl

# 2) 讓原 client 連到它
#    - 原 client 需先被導向 127.0.0.1:8484（login server 位址）
#    - 或用 hosts/DNS 導向；這屬 Phase 0 的 oracle 工作
# 3) 檢視 trace
head -5 traces/login.jsonl

# 4) 重播成可讀封包（種子自動取自 211-byte 握手；也可手動給）
node server/src/cli.ts decode traces/login.jsonl
node server/src/cli.ts decode traces/login.jsonl --recv-seed 0x11223344 --json
```

輸出格式（每行一個 JSON）；注意 `hex` 是**線上的原始 bytes**（證據），`plainHex` 才是解密的本文：

```json
{"t":120,"seq":1,"conn":1,"dir":"c2s","kind":"connect","len":0,"hex":"","note":"127.0.0.1:52344"}
{"t":131,"seq":2,"conn":1,"dir":"c2s","kind":"handshake","len":211,"hex":"d300c700...","bodyLength":199,"seeds":{"sendSeed":2864434397,"recvSeed":287454020},"note":"seeds adopted: ..."}
{"t":139,"seq":3,"conn":1,"dir":"c2s","kind":"frame","len":7,"hex":"c2f103000a0102","header":49649,"bodyLength":3,"opcode":10,"plainHex":"0a0102","headerOk":true}
```

`decode` 的輸出（逐包檢查標頭；不符時 exit code 非 0）：

```
6 records, 3 packets decoded, 0 header mismatches
handshake seeds: sendSeed=0xaabbccdd recvSeed=0x11223344
conn=1 c2s len=  211 body=  199
    // handshake: 211 bytes, seeds adopted (sendSeed/recvSeed)
conn=1 c2s len=    7 body=    3 op=0x0a
    0a0102
```

## 指令

```bash
node --test "**/*.test.ts"       # 全部測試（不需要 npm install）
node server/src/cli.ts help      # 用法
node server/src/cli.ts capture --port 8484 [--mode session|framed|raw] [--out trace.jsonl] [--quiet]
node server/src/cli.ts decode trace.jsonl [--recv-seed <n>] [--send-seed <n>] [--json]
```

`capture` 的模式：

| 模式 | 用途 |
|---|---|
| `session`（預設）| 真實連線模型：211-byte 握手取種子 → 之後逐包解密並驗證標頭 |
| `framed` | 相同的 4-byte 標頭但**沒有握手**（已知種子、或第一個封包不是握手時用）|
| `raw` | 每次 `recv()` 傾印一行，完全不解讀 |

> 零依賴：Node 22 原生支援 TypeScript type stripping 與內建測試框架，
> 因此**沒有 build step、沒有 node_modules**。
> 限制：strip-only 模式**不接受**需要程式碼生成的語法（parameter property、`enum`、`namespace`）——
> `test/source-hygiene.test.ts` 會先擋下來，免得只在載入時才爆 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。

## 規則

1. 任何未經 `docs/protocol/FINDINGS.md` 證實的欄位，一律以 `HYPOTHESIS` 標註並有測試可改。
2. 不得在 `server/` 出現 Godot 型別；不得把 Hex-Rays C 逐行翻譯。
3. 新增協定知識時，**同時**更新 `docs/protocol/FINDINGS.md` 與測試向量。
4. 解密**必須**做標頭自檢（`0xD3 ^ HIWORD(state)`）：用錯種子的「假成功」比當機更貴。
