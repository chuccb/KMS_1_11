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
| `src/net/loginserver.ts` | ✅ **登入伺服器**：實作 §4.7–§4.9 的登入鏈（握手 → 0x01 → 0x02 → 0x03/0x05/0x06），帳號與角色為**記憶體**狀態；另含遊戲伺服器端：領到 `0x04` 的角色 id 後送 `0x16` 進地圖、再依地圖的 `life` 送 `0x2F`（§4.15），並把 client 報的攻擊（`0x0F`／`0x10`／`0x11`）套到怪物 HP 上（§4.17）。 |
| `src/protocol/movepath.ts` | ✅ `CMovePath`：`u16 originX/Y` + `u8 count` + **14-byte** 元素（attr/x/y/vx/vy/action/foothold/duration）。這是移動的實際內容（§4.11.5）。 |
| `src/protocol/field.ts` | ✅ 遊戲內封包：0x16 進地圖、0x1C 別人進場、0x1D 離場、0x22 別人移動、0x29 升級效果；client 端的 0x0E（自己的移動）與 0x0D（點擊傳送門／物件）。 |
| `src/protocol/mob.ts` | ✅ **怪物封包**：`0x2F` 進場（`u32 mobId`＋`u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16 ×2`（語意未解，送 0 走的是 client 會處理的查表失敗路徑）＋動畫旗標區塊）、`0x33` 移動（動作位元組 + `u32` + `CMovePath`）、`0x30` 開始死亡動畫（`s16 delayMs`）、`0x31` 收屍／重生（`u8 flag`＋`u32 mobId`，`flag != 0` 時再接 `templateId` 與**與 `0x2F` 逐 byte 相同**的身體）、`0x34` 怪物 MP；另有 **16 筆動作索引表**（`MOB_ACTION`／`MOB_ACTION_NAMES`，證據：`CActionMan::MOBACTIONENTRY` + `.data:0x5B20FC`）；`encode`／`read`／`describe` 三件套＋`test/mob.test.ts`／`test/mobs.test.ts`（FINDINGS §4.12.1／§4.15／§4.16／§4.17）。 |
| `src/game/map.ts` | ✅ **伺服器的地圖視圖**：`WzArchive` → `MapData`（`life` 出生點分怪物／NPC、`portal`、`info`、腳踏點 `footholdSegments`）；`mapDataProvider(archive)` 快取（§4.15／§4.16）。 |
| `src/game/mobs.ts` | ✅ **一場地的怪物**：出生點吸附腳踏點、巡邏範圍 = 腳踏點折線 ∩ `rx0/rx1`、每段一個 `0x33`（`MobField`）；`Mob/<id>.img -> info` 的 `speed`／`maxHP`／`maxMP`／`level`／`exp` 與 die 動畫長度（`dieMs`，Σ 影格 `delay`，預設 180 ms）由 `mobTemplateProvider` 快取。怪物是**伺服器驅動**的，而且**有 HP**：`applyDamage` → `0x34`＋（死亡時）`0x30`，`tickPackets` 收屍與重生（§4.16／§4.17）。 |
| `src/cli.ts` | ✅ `capture` / `decode` / `serve` / `schema` / `wz` 子命令 |
| 遊戲邏輯（地圖／怪物／戰鬥／道具欄伺服器端）| ❌ **尚未實作**；已解出的封包有 codec（`field.ts`／`movepath.ts`），沒解的一律不猜（`decode` 仍會原封不動記錄它們） |
| `src/wz/img.ts` | ✅ WZ v1 `.img` 值層編解碼器：物件 marker、名稱表（blob 相對位移）、15 種型別、`Canvas`／`UOL`／`Shape2D#*` body、像素解壓（容忍缺少 adler32 trailer 的 stream）。規格與證據在 `docs/WZ1_FORMAT.md` §4，雙胞胎是 `tools/wzimg.py`。 |
| `src/wz/archive.ts` | ✅ `Data.wz`：PKG1 表頭、目錄樹、逐張「解析驗證 → 全檔掃描 size 唯一匹配」定位（922 declared + 130 scanned）、canvas 普查、`Map/Map/*.img` 的 info/foothold/portal/life。 |
| `src/wz/png.ts` | ✅ 零依賴 PNG 寫入器（8-bit RGBA、filter 0），把解出的像素變成看得見的檔案。 |
| `src/wz/cli.ts` | ✅ `wz images`／`census`／`maps`／`dump`／`png`：唯一一份 WZ 讀取器（ADR-005）。 |
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
node server/src/cli.ts wz census                  # 55,379 張 canvas、55,377 完整解碼
node server/src/cli.ts wz maps                    # 100 張地圖的 info/foothold/portal/life
node server/src/cli.ts wz dump <image path>       # 單張 image 的屬性樹（--json 為結構化視圖）
node server/src/cli.ts wz png <image path> --out assets/   # 每張 canvas → PNG

# 登入伺服器：把原 client（或重寫的 client）導到這個 port，就能走到選角畫面
node server/src/cli.ts serve --port 8484 --game-port 8485 --account admin:admin \
     --world Scania[,Bera] --game-ip 127.0.0.1 [--map 1000000] [--data Data.wz|off]
```

`serve` 的行為：記憶體帳號（`--account user:pass,...`）、`--game-port` 會同時開遊戲伺服器端
（領取交接的角色 id 後送 `0x16` 進地圖、再依地圖的 `life` 清單送 `0x2F` 怪物、之後每個 tick 送 `0x33` 讓它們巡邏，見下）；
`--data <Data.wz|off>` 指定地圖資料來源（預設：工作目錄有 `./Data.wz` 就用它，`off` = 完全不讀檔）、
`--mob-speed <px/s>` 調巡邏速度（預設 60 px/s，再乘上怪物自己的 `info.speed` 百分比）、
`--mob-respawn <ms>` 調怪物重生延遲（預設 5000 ms），角色建立後外觀取自**帳號第一個角色**
或全零（0x06 的 10 個外觀 u32 目前只記在日誌裡 —— 它們對應到 `CharacterData` 哪幾個欄位尚未證實）。

client 的**攻擊三兄弟 `0x0F`／`0x10`／`0x11` 都已完整解出**（FINDINGS §4.13.1／§4.13.1b）：`field.ts` 的
`readClientAttack`／`encodeClientAttack` 三個 opcode 共用一段程式碼（差異用 `ATTACK_SHAPE` 描述），
golden 測試逐 byte 對齊 client 自己的寫入順序，`decode` 也會把擷取到的攻擊翻成可讀的一行。
怪物進場（`CMob::Init`，§4.12.1）**已經進到產品**（§4.15）、**會走動**（§4.16），而且**打怪的閉環也接上了**（§4.17）：
`serve --game-port` 依地圖的 `life` 清單送 `0x2F`，再沿著地圖自己的腳踏點折線一段一段送 `0x33`
（`src/game/mobs.ts`；速度 = `--mob-speed` × 怪物 `info.speed` 百分比）；client 的 `0x0F`／`0x10`／`0x11`
落地時，傷害直接從怪物的 `info.maxHP` 扣（**傷害是 client 算的**，伺服器不重算），命中回 `0x34`
（怪物的 MP，同時讓 client 進受擊狀態）、殺死送 `0x30`（死亡動畫立刻開始）、動畫結束後 `0x31 flag = 0`
收屍、`--mob-respawn` 之後 `0x31 flag != 0` 重生。**下一個最有價值的目標**是掉落物
（CRewardPool `0x42`–`0x45`）與 NPC（`0x39`–`0x40`）。

`0x16`（進地圖）的三個 u32 現在已知是**場地的亂數種子**（FINDINGS §4.11.2）：客戶端的
傷害數字、掉落與怪物行為都由它決定，所以伺服器送出種子後就能重算客戶端回報的傷害——
`field.ts` 的 `SetField.randomSeedA/B/C` 因此不再是三個不明欄位，`encodeSetField` 可以照填。
整支產生器已移植成 `src/protocol/random.ts`（`ClientRandom`，golden 序列在 `test/random.test.ts`）。

**而「進哪張地圖」就在同一個 `CharacterData` 裡**：`CharacterData.mapId`（第 23 欄）由 `0x16` 帶到
客戶端，`sub_468E00` 用它載入 `Map/Map/%09d.img`（FINDINGS §4.11.2b）。所以伺服器要送一個玩家進地圖，
就是把地圖 id 放進那個欄位——`src/wz/paths.ts` 的 `mapImagePath()` 是同一個檔名格式，
`field.ts` 的 `SetField.character.mapId` 就是它。

`serve --game-port` 的遊戲伺服器現在會**把角色送進地圖並讓怪物出現**：領到 `0x04` 的角色 id 之後送
`0x16`（`u8 mode, u8 full, u32 亂數種子 ×3, CharacterData`），地圖由 `--map`（預設 `1000000`）決定，
接著對地圖 `life` 清單裡的每隻怪物送 `0x2F`（`src/game/map.ts`；`--data off` 可關掉），
客戶端接著回報的移動（`0x0E`）與攻擊（`0x0F`）都會被 `decode` 的解讀器寫進日誌
（FINDINGS §4.11.2b；`test/serve.test.ts` 用假 client 逐欄驗證）。

`serve` 的已知限制（誠實聲明）：沒有持久化（重啟即忘）、**沒有怪物 AI／掉落／技能**
（怪物會出現、會巡邏、會被打死也會重生，但不會追人、不會攻擊，也沒有掉落物；只有 `Mob/9999997.img`／
`Mob/9999999.img` 兩張測試圖帶攻擊資料，見 FINDINGS §4.17.6 與 §6 第 5 項）、建立的角色的道具欄是空的（`CharacterData` 的 `flags = 1`，
client 接受；`chardata.ts` 已經能寫完整道具區塊，缺的是「外觀 10 個 u32 → `CharacterData` 欄位」的對應，
見 FINDINGS §4.8 的註記）。

`schema` 會印出協定目錄（`--json` 給工具用）：只列有證據的封包，每列帶 `status`
（`byte-exact`／`partial`／`skeleton`）、證據出處與對應的 codec 函式名稱。

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
