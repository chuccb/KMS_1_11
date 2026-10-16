# server/ — MMO 伺服器與協定工具（TypeScript, 零依賴）

## 現況（誠實聲明）

| 元件 | 狀態 |
|---|---|
| `src/protocol/frame.ts` | ✅ 可用的網路框架層。u16 LE 長度前綴 + 1460 上限有 binary 證據；「長度是否含自身」為可切換選項（預設依證據 = 含）。 |
| `src/net/capture.ts` | ✅ 可用的**擷取伺服器**（ADR-004）：接住原 client，寫出 JSONL trace；框架不符時改為原始傾印，**不丟資料**。 |
| `src/cli.ts` | ✅ `capture` 子命令 |
| login/world/game 邏輯 | ❌ **尚未實作**，且**不會在協定被擷取證實之前實作**（避免憑空發明封包） |

## 為什麼先做擷取？

2003 KMS 1.11 沒有任何公開 server 或協定文件。與其猜，不如讓**原 client 自己說話**：

```bash
# 1) 啟動擷取伺服器
node server/src/cli.ts capture --port 8484 --out traces/login.jsonl

# 2) 讓原 client 連到它
#    - 原 client 需先被導向 127.0.0.1:8484（login server 位址）
#    - 或用 hosts/DNS 導向；這屬 Phase 0 的 oracle 工作
# 3) 檢視 trace
head -5 traces/login.jsonl
```

輸出格式（每行一個 JSON）：

```json
{"t":120,"seq":1,"conn":1,"dir":"c2s","kind":"connect","len":0,"hex":"","note":"127.0.0.1:52344"}
{"t":131,"seq":2,"conn":1,"dir":"c2s","kind":"frame","len":211,"hex":"d300...","opcodeCandidate":211}
```

## 指令

```bash
node --test server/test          # 全部測試（不需要 npm install）
node server/src/cli.ts help      # 用法
node server/src/cli.ts capture --port 8484 [--mode framed|raw] [--out trace.jsonl] [--quiet]
```

> 零依賴：Node 22 原生支援 TypeScript type stripping 與內建測試框架，
> 因此**沒有 build step、沒有 node_modules**。

## 規則

1. 任何未經 `docs/protocol/FINDINGS.md` 證實的欄位，一律以 `HYPOTHESIS` 標註並有測試可改。
2. 不得在 `server/` 出現 Godot 型別；不得把 Hex-Rays C 逐行翻譯。
3. 新增協定知識時，**同時**更新 `docs/protocol/FINDINGS.md` 與測試向量。
