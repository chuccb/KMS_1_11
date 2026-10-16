# server/ — MMO 伺服器與協定工具（TypeScript, 零依賴）

## 現況（誠實聲明）

| 元件 | 狀態 |
|---|---|
| `src/protocol/frame.ts` | ✅ 框架層：4-byte 標頭（`u16 header` + `u16 bodyLen`）+ 1460 上限，皆有 binary 證據；另保留舊的 u16 總長 framing 供握手用。 |
| `src/protocol/cipher.ts` | ✅ 會話加密：MSVC rand LCG、`swapNibbles`、送/收狀態；標頭 = `magic ^ HIWORD(state)`，**兩個方向常數不同**（c2s `0xD3` / s2c `0xFF2C`，見 `docs/protocol/FINDINGS.md` §3.1）。 |
| `src/protocol/session.ts` | ✅ 211-byte 握手 codec + 串流解碼器 `SessionDeframer`：吃握手取種子、逐包解密並**自檢標頭**；握手可由任一方送出（`expectHandshake`）。 |
| `src/protocol/packet.ts` | ✅ 欄位編碼：`u8`/`u16`/`u32` LE、字串 = `u16 長度` + 原始 bytes；越界丟 `PacketUnderflowError(38)`（client 丟 `ZException(38)`）。 |
| `src/protocol/login.ts` | ✅ **client → server 登入鏈封包**：0x01 登入、0x02 選世界、0x03 選角、0x04 握手回覆、0x05 建角、0x06 名檢查+外觀、0x07 刪角、0x08 echo。 |
| `src/protocol/chardata.ts` | ✅ `CharacterData`：`u8 flags` + **69-byte** 能力值區塊 + 完整道具區塊（穿戴格 ×2、四個道具欄、每欄 8-byte 記錄、`0x20`/`0x40` 兩個 map）。其中「道具區塊」的寫入順序與 `sub_45F610`（編碼器）逐項對齊。 |
| `src/protocol/itemslot.ts` | ✅ `GW_ItemSlot`：`itemId` + 現金區塊 + `GW_ItemSlotEquip`（ruc/cuc/15 個能力值）／`NonEquip`（quantity），含種類位元組規則。 |
| `src/protocol/replies.ts` | ✅ **server → client 登入鏈回包**：0x01 結果+世界清單、0x02 角色清單、0x03 遊戲伺服器位址**+角色 id**（不是 token，§4.11.3）、0x04 名檢查、0x05 建立結果、0x06 刪除結果。 |
| `src/net/capture.ts` | ✅ **擷取伺服器**（ADR-004）：接住原 client，寫出 JSONL trace；無法解碼的 chunk 標記一次後改為原始傾印，**不丟資料**。 |
| `src/net/decode.ts` | ✅ trace 重播器：把 JSONL 解回可讀封包；種子取自握手，且**狀態以線路方向為鍵**（c2s = client 送 state）。 |
| `src/net/loginserver.ts` | ✅ **登入伺服器**：實作 §4.7–§4.9 的登入鏈（握手 → 0x01 → 0x02 → 0x03/0x05/0x06），帳號與角色為**記憶體**狀態；另含遊戲伺服器端的交接（只驗角色 id，還不會送遊戲內封包）。 |
| `src/protocol/movepath.ts` | ✅ `CMovePath`：`u16 originX/Y` + `u8 count` + **14-byte** 元素（attr/x/y/vx/vy/action/foothold/duration）。這是移動的實際內容（§4.11.5）。 |
| `src/protocol/field.ts` | ✅ 遊戲內封包：0x16 進地圖、0x1C 別人進場、0x1D 離場、0x22 別人移動、0x29 升級效果；client 端的 0x0E（自己的移動）與 0x0D（點擊傳送門／物件）。 |
| `src/cli.ts` | ✅ `capture` / `decode` / `serve` 子命令 |
| 遊戲邏輯（地圖／怪物／戰鬥／道具欄伺服器端）| ❌ **尚未實作**；已解出的封包有 codec（`field.ts`／`movepath.ts`），沒解的一律不猜（`decode` 仍會原封不動記錄它們） |
| 讀反編譯的工具 | ✅ `tools/hexfunc.py`（抽函式）、`tools/kstr.py`（**CP949 字串**：2003 client 沒有符號，字串就是函式的名字，見 FINDINGS §4.13）、`tools/wz1.py`；皆有 unittest（`python3 -m unittest discover -s tools/tests`）|

## 登入鏈（已解，`docs/protocol/FINDINGS.md` §4.7–§4.9）

伺服器封包不是靠一張全域表分派，而是**看 client 現在在哪個階段**：`dword_5C212C` 是當前 stage，
`sub_43B170` 把 opcode 交給它的 `OnPacket`。所以同一號碼在不同階段是不同封包，請求與回應也可能不同號。

```
server ──211-byte handshake────────▶ client             （伺服器先講話，種子寫在這裡）
client ──0x01 帳號/密碼────────────▶ server
server ──0x01 u8 result [+世界清單]─▶ client  → CWorldSelect（清單就是這個階段的參數）
client ──0x02 世界 index───────────▶ server
server ──0x02 u8 result [+角色×3]──▶ client  → CCharSelect
client ──0x03 u32 characterId──────▶ server
server ──0x03 u32 ip u16 port u32 id ▶ client → 連到遊戲伺服器，id 存進 CWvsApp+0x14
client ──0x04 u32 characterId──────▶ server   （新連線、握手之後的第一個封包）
```

`u32 ip` 是**網路位元組序**（client 原封不動塞進 `sockaddr_in.sin_addr`），其餘整數都是 little-endian。
最後那個 `u32` **就是角色 id**：client 之後會拿每個進場玩家的 id 和它比對來分辨「這是我自己」
（`sub_51CFE0`，§4.11.3），所以伺服器不能送亂數 ticket。
失敗訊息表在三個 handler 共用，只有 `result = 0` 會繼續解析 payload。

`server/test/loginflow.test.ts` 會用假 client 走完整條鏈（含真實加密與框架），所以「編碼器」與
「client 的讀取順序」一旦漂移就會紅燈。

## 為什麼先做擷取？

2003 KMS 1.11 沒有任何公開 server 或協定文件。與其猜，不如讓**原 client 自己說話**：

```bash
# 1) 啟動擷取伺服器（預設 session 模式 = 真實連線模型）
node server/src/cli.ts capture --port 8484 --out traces/login.jsonl

#    原 client 在收到 211-byte 握手前不會送任何東西，所以 session 模式「先送握手」
#    （種子由我們選並寫進 trace；body 的 199 bytes 語意仍未知，可用參數試）
node server/src/cli.ts capture --port 8484 --handshake 0x11223344:0x55667788 \
     --handshake-body 0000... --out traces/login.jsonl
node server/src/cli.ts capture --port 8484 --handshake off --out traces/login.jsonl  # 改等 client 先送

# 2) 讓原 client 連到它
#    - 原 client 需先被導向 127.0.0.1:8484（login server 位址）
#    - 或用 hosts/DNS 導向；這屬 Phase 0 的 oracle 工作
# 3) 檢視 trace
head -5 traces/login.jsonl

# 4) 重播成可讀封包（種子自動取自 211-byte 握手；沒有握手時手動給）
node server/src/cli.ts decode traces/login.jsonl
node server/src/cli.ts decode traces/login.jsonl --c2s-seed 0x11223344 --json
```

輸出格式（每行一個 JSON）；注意 `hex` 是**線上的原始 bytes**（證據），`plainHex` 才是解密的本文：

```json
{"t":120,"seq":1,"conn":1,"dir":"c2s","kind":"connect","len":0,"hex":"","note":"127.0.0.1:52344"}
{"t":131,"seq":2,"conn":1,"dir":"c2s","kind":"handshake","len":211,"hex":"d300c700...","bodyLength":199,"seeds":{"sendSeed":2864434397,"recvSeed":287454020},"note":"seeds adopted: ..."}
{"t":139,"seq":3,"conn":1,"dir":"c2s","kind":"frame","len":7,"hex":"c2f103000a0102","header":49649,"bodyLength":3,"opcode":10,"plainHex":"0a0102","headerOk":true}
```

`decode` 的輸出（逐包檢查標頭；不符時 exit code 非 0）：

```
5 records, 2 packets decoded, 0 header mismatches
handshake: clientSendSeed=0x11223344 clientRecvSeed=0x55667788
conn=1 s2c len=  211 body=  199
    0000...  // handshake sent by s2c: receiver (client) seeded
conn=1 c2s len=    8 body=    4 op=0x1a
    1a010203
```

## 指令

```bash
node --test "**/*.test.ts"       # 全部測試（不需要 npm install）
node server/src/cli.ts help      # 用法
node server/src/cli.ts capture --port 8484 [--mode session|framed|raw] [--handshake auto|off|S:R]
                              [--handshake-body <hex>] [--out trace.jsonl] [--quiet]
node server/src/cli.ts decode trace.jsonl [--c2s-seed <n>] [--s2c-seed <n>] [--json]

# 登入伺服器：把原 client（或重寫的 client）導到這個 port，就能走到選角畫面
node server/src/cli.ts serve --port 8484 --game-port 8485 --account admin:admin \
     --world Scania[,Bera] --game-ip 127.0.0.1
```

`serve` 的行為：記憶體帳號（`--account user:pass,...`）、`--game-port` 會同時開遊戲伺服器端
（只領取 token 並記錄「哪個角色到了」，因為遊戲內封包還沒解），角色建立後外觀取自**帳號第一個角色**
或全零（0x06 的 10 個外觀 u32 目前只記在日誌裡 —— 它們對應到 `CharacterData` 哪幾個欄位尚未證實）。

**下一個最有價值的目標**是 client 的攻擊封包（`0x0F`／`0x10`／`0x11`，FINDINGS §4.13.1）：
前 5 bytes（`u8` + `u32 目標 id`）已解，讀完它們加上怪物進場（§4.12）就能形成「打怪 → 回傷害」的迴圈。

`serve` 的已知限制（誠實聲明）：沒有持久化（重啟即忘）、沒有遊戲內階段（只到「角色被交給遊戲伺服器」，
遊戲伺服器只記錄誰到了，不會送 0x16 進地圖）、建立的角色的道具欄是空的（`CharacterData` 的 `flags = 1`，
client 接受；`chardata.ts` 已經能寫完整道具區塊，缺的是「外觀 10 個 u32 → `CharacterData` 欄位」的對應，
見 FINDINGS §4.8 的註記）。

`capture` 的模式：

| 模式 | 用途 |
|---|---|
| `session`（預設）| 真實連線模型：**先送** 211-byte 握手（`--handshake`）→ 之後逐包解密並驗證標頭 |
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
4. 解密**必須**做標頭自檢（`magic ^ HIWORD(state)`）：用錯種子的「假成功」比當機更貴。
   這條規則已經實際抓到一個 bug（兩個方向用同一顆種子解碼）。
5. 標頭常數是**方向相依**的：送給 client 的封包必須用 `0xFF2C`，接受 client 的封包必須用 `0xD3`。
