# server/ — MMO 伺服器與協定工具（TypeScript，執行時零依賴）

## 現況（誠實聲明）

| 元件 | 狀態 |
|---|---|
| `src/protocol/frame.ts` | ✅ 框架層：4-byte 標頭（`u16 header` + `u16 bodyLen`）+ 1460 上限，皆有 binary 證據；另保留舊的 u16 總長 framing 供握手用。 |
| `src/protocol/cipher.ts` | ✅ 會話加密：MSVC rand LCG、`swapNibbles`、送/收狀態；標頭 = `magic ^ HIWORD(state)`，**兩個方向常數不同**（c2s `0xD3` / s2c `0xFF2C`，見 `docs/protocol/FINDINGS.md` §3.1）。 |
| `src/protocol/session.ts` | ✅ 211-byte 握手 codec + 串流解碼器 `SessionDeframer`：吃握手取種子、逐包解密並**自檢標頭**；握手可由任一方送出（`expectHandshake`）。 |
| `src/protocol/packet.ts` | ✅ 欄位編碼：`u8`/`u16`/`u32` LE、字串 = `u16 長度` + 原始 bytes；越界丟 `PacketUnderflowError(38)`（client 丟 `ZException(38)`）。 |
| `src/protocol/login.ts` | ✅ **client → server 登入鏈封包**：0x01 登入、0x02 選世界、0x03 選角、0x04 握手回覆、0x05 建角、0x06 名檢查+外觀、0x07 刪角、0x08 echo。 |
| `src/protocol/chardata.ts` | ✅ `CharacterData`：`u8 flags` + **69-byte** 能力值區塊 + 完整道具區塊（穿戴格 ×2、四個道具欄、每欄 8-byte 記錄、`0x20`/`0x40` 兩個 map）。其中「道具區塊」的寫入順序與 `sub_45F610`（編碼器）逐項對齊。 |
| `src/protocol/itemslot.ts` | ✅ `GW_ItemSlot`：`itemId` + 現金區塊 + `GW_ItemSlotEquip`（ruc/cuc/15 個能力值）／`NonEquip`（quantity）。**種類位元組只在呼叫端給 0 時才上線**：本伺服器送出的每個封包都用「欄位本身」當提示（`CharacterData` 用欄位號、`0x0B` 用剛讀到的欄位號），所以都不帶那個位元組（§4.18.4 的修正）。 |
| `src/protocol/replies.ts` | ✅ **server → client 登入鏈回包**：0x01 結果+世界清單、0x02 角色清單、0x03 遊戲伺服器位址**+角色 id**（不是 token，§4.11.3）、0x04 名檢查、0x05 建立結果、0x06 刪除結果。 |
| `src/net/capture.ts` | ✅ **擷取伺服器**（ADR-004）：接住原 client，寫出 JSONL trace；無法解碼的 chunk 標記一次後改為原始傾印，**不丟資料**。 |
| `src/net/decode.ts` | ✅ trace 重播器：把 JSONL 解回可讀封包；種子取自握手，且**狀態以線路方向為鍵**（c2s = client 送 state）。 |
| `src/net/loginserver.ts` | ✅ **登入伺服器**：實作 §4.7–§4.9 的登入鏈（握手 → 0x01 → 0x02 → 0x03/0x05/0x06），帳號與角色為**記憶體**狀態；另含遊戲伺服器端：領到 `0x04` 的角色 id 後送 `0x16` 進地圖、再依地圖的 `life` 送 `0x2F`（§4.15），再依地圖的 `life` 送每個 NPC 一個 `0x39`（§4.19），把 client 報的攻擊（`0x0F`／`0x10`／`0x11`）套到怪物 HP 上（§4.17），並在 `tickField` 裡跑**掉落與拾取**：殺怪時送 `0x43`、玩家走到上面時送 `0x44 kind 2`＋`0x0B`＋`0x11`（§4.18），**殺怪也會給經驗值**：`awardKillExp` 用怪物自己的 `info.exp` 加進角色紀錄，升級就送 `0x0D` 能力值差異包（§4.21）；**點 NPC 會開商店**（`0x33` → 空的 `0x19` ＋ `0x4A`），商店的按鈕（`0x16`）會回 `0x4B`＋`0x0B`＋`0x0D`（§4.22，ADR-010）；**沒有商店的 NPC 會開口說話**（`0x47` 帶它自己 `info/speak` 的第一句，client 的 `0x15` 走下一句，§4.23，ADR-011）。**走過傳送門就會換地圖**（`0x0D` → 空的 `0x19` ＋ `0x16`；目的地是地圖資料的 `tm`，見下），而**進哪張圖是角色紀錄自己的事**（`stats.mapId`，`--map` 只是新角色與沒有 mapId 的紀錄的後備）。這一切都是**每張地圖一份**：連線只是 `game/world.ts` 的一個成員（`FieldInstance.join`／`leave`／`reportMove`），**一個 server-wide 時鐘**（`startClock`）走過所有場地，不是每條連線一個 `setInterval`（ADR-012）。 |
| `src/protocol/movepath.ts` | ✅ `CMovePath`：`u16 originX/Y` + `u8 count` + **14-byte** 元素（attr/x/y/vx/vy/action/foothold/duration）。這是移動的實際內容（§4.11.5）。 |
| `src/protocol/field.ts` | ✅ 遊戲內封包：0x16 進地圖、0x1C 別人進場、0x1D 離場、0x22 別人移動、0x29 升級效果；client 端的 0x0E（自己的移動）與 0x0D（點擊傳送門／物件）。另含 `0x2C`（client → server 的**怪物動作回報**，頭 4 欄＋未解的尾段；`readClientMobAttack`／`describeClientMobAttack`），以及 `describeFieldOpcode`：CField 每個子系統區間（含 `0x39`–`0x41` 的 CNpcPool）都有一行，**沒有 handler 的 opcode 會明說**；`0x0D`（能力值差異包）在 `CWvsApp` 層，由 `stat.ts` 解，`describeFieldPacket` 會把它印成一行。 |
| `src/protocol/mob.ts` | ✅ **怪物封包**：`0x2F` 進場（`u32 mobId`＋`u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16 ×2`（語意未解，送 0 走的是 client 會處理的查表失敗路徑）＋動畫旗標區塊）、`0x33` 移動（動作位元組 + `u32` + `CMovePath`）、`0x30` 開始死亡動畫（`s16 delayMs`）、`0x31` 收屍／重生（`u8 flag`＋`u32 mobId`，`flag != 0` 時再接 `templateId` 與**與 `0x2F` 逐 byte 相同**的身體）、`0x35` 怪物動畫（＝`0x2F` 尾巴那塊動畫區塊，同一份實作）、`0x34` 怪物 MP；另有 **16 筆動作索引表**（`MOB_ACTION`／`MOB_ACTION_NAMES`，證據：`CActionMan::MOBACTIONENTRY` + `.data:0x5B20FC`）；`encode`／`read`／`describe` 三件套＋`test/mob.test.ts`／`test/mobs.test.ts`（FINDINGS §4.12.1／§4.15／§4.16／§4.17）。 |
| `src/game/map.ts` | ✅ **伺服器的地圖視圖**：`WzArchive` → `MapData`（`life` 出生點分怪物／NPC、`portal`、`info`、腳踏點 `footholdSegments`）；`mapDataProvider(archive)` 快取（§4.15／§4.16）。 |
| `src/game/world.ts` | ✅ **每一張地圖的共享世界**（ADR-012）：`FieldRegistry`（`mapId → FieldInstance`，第一次有人進場才建立、之後留著）＋`FieldInstance`（`mobs`／`npcs`／`drops` ＋ 在場成員）。`join()` 把整張圖的快照送給新來的人（每個活著的怪 `0x2F`、每個 NPC 完整 `0x39`、地上每個 `0x43`、每個已在場玩家 `0x1C`）並讓其他人收到他的 `0x1C`；`leave()` 送 `0x1D`；`reportMove()` 把別人走的路包成 `0x22`；`applyDamage`／`spawnFromDeath`／`pickUp` 的結果廣播全場；`tick()` 只有在**有人在看**的時候才派 `0x33`，但屍體、重生與掉落物過期照算；`portal(name)` 是「玩家用了哪個傳送門」的查詢（名字不分大小寫，查不到就是沒有）。`0x1C`／`0x1D`／`0x22` 的 sender 只在這裡（FINDINGS §4.24／§4.25）。 |
| `src/game/mobs.ts` | ✅ **一場地的怪物**：出生點吸附腳踏點、巡邏範圍 = 腳踏點折線 ∩ `rx0/rx1`、每段一個 `0x33`（`MobField`）；`Mob/<id>.img -> info` 的 `speed`／`maxHP`／`maxMP`／`level`／`exp` 與 die 動畫長度（`dieMs`，Σ 影格 `delay`，預設 180 ms）由 `mobTemplateProvider` 快取。怪物屬於**場地**（`game/world.ts`，ADR-012）：id、位置與 HP 都是那張圖的，兩個玩家打的是同一隻。怪物是**伺服器驅動**的，而且**有 HP**：`applyDamage` → `0x34`＋（死亡時）`0x30`，`tickPackets` 收屍與重生（§4.16／§4.17）。⚠️ 原 client 的怪物 AI **在自己身上**（§4.20／ADR-008）：這裡的巡邏是我們 client 還沒有 AI 之前的替代品，不是最終架構。 |
| `src/protocol/drop.ts` | ✅ **掉落物封包**：`0x43`（出現：`kind`／`dropId`／`money`／`value`／落點，`kind <= 1` 再多一顆怪物區塊）、`0x44`（消失／被撿走，`kind 2` 帶角色 id）、`0x11`（獲得提示的三種形狀）；`0x42`／`0x45` 在 client 裡沒有 handler（FINDINGS §4.18）。 |
| `src/protocol/inventory.ts` | ✅ **道具欄異動 `0x0B`**：`result`／`count`／每筆 `{op, inventory, slot, …}`，`op 0` 接一個 `GW_ItemSlot`（**沒有種類位元組**）；`op 1`（換金鑰）在裝備欄會被 client 丟 `CTerminateException`，encoder 直接拒絕（§4.18.4）。 |
| `src/game/drops.ts` | ✅ **一場地的掉落物**（`DropField`，屬於場地：`dropId` 是那張圖的 key，`0x44 kind 2` 說出是誰撿走的）：掉落表（`MOB_JUNK_DROP`／`POTION_BY_LEVEL`／三個機率常數）、落點吸附腳踏點、壽命與「玩家站在上面」的判定；機率與壽命都是**伺服器的選擇**（ADR-007）。 |
| `src/game/rewards.ts` | ✅ **獎勵與錢包**（`grantItem`／`MesoWallet`／`pickUpDrop`）：同 id 堆疊到 200、否則第一個空格、**裝備與現金道具永不堆疊**、背包滿就留在原地；`pickUpDrop` 回傳「該送哪幾個封包」的資料；`takeItem` 是商店收購那一半。**`MesoWallet` 是角色紀錄第 22 欄（`stats.mesos`）的視圖**，不是第二本帳 —— 撿到錢時 `0x0D` 的旗標 `0x40000` 會讓 client 的錢包跟著動（§4.22.5）。 |
| `src/protocol/npc.ts` | ✅ **NPC 封包**：`0x39` 進場（`u32 npcId`；**已知 id 只有 5 bytes**，新 id 才接 `u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16`＋`s16 ×2`，共 20 bytes）、`0x3A` 離場（只有 `u32 npcId`）、`0x3B` 第二狀態（**`u8 flag` 在前**＋`u32 npcId`）；`0x3C`–`0x40` 只讀 id，只有 `0x3D` 再讀兩顆動作索引＋`CMovePath`（FINDINGS §4.19）。**沒有**怪物 `0x2F` 那個動畫旗標區塊。 |
| `src/protocol/stat.ts` | ✅ **能力值差異包 `0x0D`（s2c）**：`u8 ack` ＋ `u32 flags`（19 個 bit，`0x01`…`0x40000`，**依旗標順序**）＋ `u32 panelFlags`（0 = 後面沒有東西）。`diffStats(舊, 新)` 只回報有變的欄位；`encodeStatUpdate`／`readStatUpdate`／`describeStatUpdate`。⚠️ 三個欄位的**線上寬度與 `CharacterData` 不同**（`str`/`dex`/`int`/`luk` **1 byte**、`unknown26`／`fame` **4 bytes**），超界值直接**拒絕**而不是靜默截斷（FINDINGS §4.21）。 |
| `src/game/exp.ts` | ✅ **經驗值與升級**：`expToNextLevel` 是 client 自己的公式（`sub_4C7110`：1–5 `n(n²/2+15)`、6–50 `q(q+19)`／`q=n²/3`、51–200 ×1.0548、>200 封頂），與公開的 2003 表 196/200 相同（四個差異是複本打字錯誤）；`awardExp` 加經驗值、必要時連續升級、**升級且還活著就補滿 HP／MP**（client 就地升級 routine 的行為）。 |
| `src/game/npcs.ts` | ✅ **一場地的 NPC**（`NpcField`）：地圖 `life` 的 NPC 出生點 → 每個一個 `0x39`（id 從 1 起算，**永不重用**；`spawnAll()` 只在場地建立時跑一次 —— 每位玩家一次會給同一個出生點第二個 id）；`enterPackets()` 是給**剛進場的人**的完整 body（5-byte 的 `refreshPacket` 只有 client 已經有那個 id 時才有意義）；`setSecondState`／`remove` 是 `0x3B`／`0x3A` 的合法形狀，`npcs` 是唯讀視圖。模板來自 `npcTemplateProvider`（`Npc/<id>.img` 的 `info/name`）；模板查不到就**不生成**並記一行 log。 |
| `src/protocol/quest.ts` | ✅ **NPC 對話封包**：`0x47`（`u8 unknownA`＋`u32 npcId`＋`u8 subOp`＋body；sub-op 0 `say`／1 `confirm`／2 `askText`／3 `askNumber`／4 kind 4）與 client 的 `0x15`（`u8 subOp`＋`u8 answer`，`answer == 1` 時附帶字串或數字）。台詞是 `Npc/<id>.img -> info/speak` 的原文，牆上沒有我們編的句子（FINDINGS §4.23、ADR-011）。 |
| `src/protocol/cp949.ts` | ✅ **CP949 編碼**：封包裡的文字是 `u16 長度` + CP949 bytes（client 直接當系統 ANSI 字碼頁用）。Node 只有解碼器，所以編碼是「反轉表」在第一次用到時建出來；編不出來的字元丟例外而不是送亂碼。 |
| `src/protocol/shop.ts` | ✅ **NPC 商店封包**：`0x4A` 開窗（`u32 shopId`＋`u16 count`＋每列 `u32 itemId`／`u32 price`／（`itemId/10000 == 207` 時 8 bytes）／`u16 maxCount`）、`0x4B` 結果（`u8`；0 沉默／1・4 東西不夠／2 錢不夠／3 格子不夠／>4 錯誤）、client 的 `0x33`（點擊的物件 id）與 `0x16`（0 買／1 賣／2 充電／3 關窗），以及空的一 byte `0x19`（在 `field.ts`）。207 那 8 bytes **原封不動攜帶、拒絕自行組裝**（FINDINGS §4.22）。 |
| `src/game/dialogue.ts` | ✅ **一場對話**：`Npc/<id>.img -> info/speak` 的台詞（`info/quest` 原樣帶著）、`npcDialogueProvider` 快取、`NpcTalk`（哪隻 NPC、第幾句、`advance()`）。沒有 `info/speak` 的 NPC 就是不說話。 |
| `src/game/shops.ts` | ✅ **商店的規則**：價格一律讀 `Item/Consume/0200.img/<id>/info/price`（讀不到就不送那一列），庫存（`SHOPS`：리나／헤네시스、로빈／달팽이사냥터）、`DEFAULT_SHOP_MAX_COUNT`、`SELL_PRICE_RATIO` 是**這份 repo 的選擇**（ADR-010）；`buy`／`sell` 是完整驗證的交易（錢、格子、數量、哪一格），失敗回 `TradeFailure`→`shopResultCode`→`0x4B`。 |
| `src/wz/paths.ts` | ✅ WZ 路徑：`mapImagePath`／`mobImagePath`／`npcImagePath`／`itemImagePath`（`Item/<kind>/<前四位>.img`，四種 kind 是這份 `Data.wz` 的實際目錄；**裝備在 `Character/<type>/`，不在 `Item/`**）|
| `src/cli.ts` | ✅ `capture` / `decode` / `serve` / `schema` / `wz` 子命令 |
| 遊戲邏輯（地圖／怪物／NPC／戰鬥／掉落／商店／對話／道具欄伺服器端）| 🟡 地圖／怪物／NPC 進場／戰鬥／掉落／**NPC 商店**／**NPC 對話**都已實作（`game/map.ts`／`game/mobs.ts`／`game/npcs.ts`／`game/drops.ts`／`game/rewards.ts`／`game/shops.ts`／`game/dialogue.ts`）；**尚未實作**的是怪物 AI 與攻擊（AI 在 client，§4.20）、真正的任務流程、NPC 的走動（`0x3D`）、組隊、以及道具的「使用」與裝備欄操作。沒解的一律不猜（`decode` 仍會原封不動記錄它們）。 |
| `src/wz/img.ts` | ✅ WZ v1 `.img` 值層編解碼器：物件 marker、名稱表（blob 相對位移）、15 種型別、`Canvas`／`UOL`／`Shape2D#*` body、像素解壓（容忍缺少 adler32 trailer 的 stream）。規格與證據在 `docs/WZ1_FORMAT.md` §4，雙胞胎是 `tools/wzimg.py`。 |
| `src/wz/archive.ts` | ✅ `Data.wz`：PKG1 表頭、目錄樹、逐張「解析驗證 → 全檔掃描 size 唯一匹配」定位（922 declared + 130 scanned）、canvas 普查、`Map/Map/*.img` 的 info/foothold/portal/life。 |
| `src/wz/props.ts` | ✅ WZ 屬性樹的**共用小層**：`entriesOf`／`propertyOf`／`asNumber`／`asText`／`infoOf`（`game/map.ts`／`game/mobs.ts`／`game/npcs.ts` 都用它）。規則：**形狀不對的值不算值**，預設值由呼叫端給。 |
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
cd server && npm install && npm run typecheck   # strict TS 型別檢查（devDependency，見下）
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
（領取交接的角色 id 後送 `0x16` 進地圖、再依地圖的 `life` 清單送 `0x2F` 怪物與 `0x39` NPC、之後每個 tick 送 `0x33` 讓怪物巡邏，見下）；
**一個 port 就是一個世界**：同一個 `mapId` 的角色走同一份怪物、同一份掉落物，並互相看見（ADR-012）；角色進哪張圖由**他自己的紀錄**決定（換過圖就留在那裡），`--map` 是新角色的起始圖與沒有 mapId 的紀錄的後備（ADR-013）；走進傳送門就會換圖（見下一節）。
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
收屍、`--mob-respawn` 之後 `0x31 flag != 0` 重生。NPC 也已在同一趟 `serve` 裡進場（`0x39`，§4.19）。**怪物的 AI 不在伺服器上**（§4.20／ADR-008）：
`sub_4862C0` 是 `CMob` 的 per-frame virtual，挑攻擊（`sub_487D10`：`conMP <= MP`＋矩形／線段命中測試）、
算傷害、播動畫都在 client 裡，結束後才用 `0x2C` 回報；伺服器的對應工作是讀懂那包（已做）、
轉播 `0x35`／`0x33` 給其他 client（`0x35` 的 codec 已做）。**`0x0D`（能力值差異包）已經解出來了**（§4.21），
所以「殺怪 → 經驗值 → 升級」這一條已經打通：殺怪後伺服器先送 `0x0D`（只帶有變的欄位）再送 `0x43`，
升級時 client 會自己播 `Effect/BasicEff.img/LevelUp` 並印「레벨이 올랐습니다」（**升級是伺服器決定的**）。
還缺的是「被怪物打 → 掉血」（`0x2C` 只是 client 的回報，而且它的尾段是**移動路徑**不是傷害，
§4.20.7；所以這條路沒有現成的傷害來源）與能力面板／buff 區塊
（`panelFlags != 0` 的內容未解，伺服器一律送 0）；**商店已經做完**（`0x4A`／`0x4B`／`0x16`／`0x33`，§4.22）；
**NPC 的對話也做完了**（`0x47` 開一個對話框、client 的 `0x15` 回答案、台詞取自
`Npc/<id>.img -> info/speak`，§4.23／ADR-011）；**世界已經是多玩家的**（§4.24／ADR-012：一張地圖一份 `FieldInstance`），
而且**走過傳送門就會換地圖**（`0x0D` → `0x19` ＋ `0x16`，§4.25／ADR-013，兩節都在下面），所以
**下一個最有價值的目標**是 oracle run（ADR-004：讓原 client 連上這台 server —— 它一次就能回答
§4.11／§4.24 的所有 UNKNOWN），其次是 NPC 的走動（`0x3D`）與
「被怪物打 → 扣玩家的血」這條還沒接上的路（§4.20.7 先修正了它的前提：`0x2C` 的尾段是**移動路徑**，
不是傷害，所以連傷害數字都還沒有來源）。

`0x16`（進地圖）的三個 u32 現在已知是**場地的亂數種子**（FINDINGS §4.11.2）：客戶端的
傷害數字、掉落與怪物行為都由它決定，所以伺服器送出種子後就能重算客戶端回報的傷害——
`field.ts` 的 `SetField.randomSeedA/B/C` 因此不再是三個不明欄位，`encodeSetField` 可以照填。
整支產生器已移植成 `src/protocol/random.ts`（`ClientRandom`，golden 序列在 `test/random.test.ts`）。

**而「進哪張地圖」就在同一個 `CharacterData` 裡**：`CharacterData.mapId`（第 23 欄）由 `0x16` 帶到
客戶端，`sub_468E00` 用它載入 `Map/Map/%09d.img`（FINDINGS §4.11.2b）。所以伺服器要送一個玩家進地圖，
就是把地圖 id 放進那個欄位——`src/wz/paths.ts` 的 `mapImagePath()` 是同一個檔名格式，
`field.ts` 的 `SetField.character.mapId` 就是它。

`serve --game-port` 的遊戲伺服器現在會**把角色送進地圖並讓怪物出現**：領到 `0x04` 的角色 id 之後送
`0x16`（`u8 mode, u8 full, u32 亂數種子 ×3, CharacterData`），**地圖取自角色紀錄自己的 `mapId`**
（`--map`（預設 `1000000`）只是新角色與沒有 mapId 的紀錄的後備；§4.25／ADR-013），
接著對地圖 `life` 清單裡的每隻怪物送 `0x2F`（`src/game/map.ts`；`--data off` 可關掉），
客戶端接著回報的移動（`0x0E`）與攻擊（`0x0F`）都會被 `decode` 的解讀器寫進日誌
（FINDINGS §4.11.2b；`test/serve.test.ts` 用假 client 逐欄驗證）。

**掉落與拾取也已接上**（FINDINGS §4.18）：怪物死掉時伺服器依掉落表送 `0x43`（錢或道具，附「從哪隻怪
飛出來」的怪物區塊），掉落物 5 分鐘後過期（`0x44 kind 0`）；玩家**走到上面**就會被撿走 —— `0x44 kind 2`
（帶角色 id，client 才會播撿取音效與飛行動畫）＋`0x0B`（道具放進哪一格）＋`0x11`（聊天視窗那行字）。
掉落表、機率、壽命、擴散範圍與可撿範圍全部是**伺服器的選擇**，集中成常數（`src/game/drops.ts`，ADR-007）；
要換一份掉落表只需傳一個 `policy` 進去（`DropField` 的選項），不用動網路層。
client 自己的錢包顯示**會**跟著變：`+89/+93`（紀錄第 22 欄）就是錢，`0x0D` 的旗標 `0x40000` 送它（§4.22.5）。

**NPC 也已經進場**（FINDINGS §4.19）：同一個 `life` 清單裡 `type = "n"` 的出生點會各拿到一個 `0x39`
（`u32 npcId`＋`u32 templateId`＋座標＋面向），**緊接在怪物的 `0x2F` 之後、同一個 TCP 串流**；
`src/game/npcs.ts` 的 id 從 1 起算且**永不重用**（`remove()` 只把項目標成不在場），因為 client 的池裡
也留著那個 id。NPC 的圖由 client 自己從 `Npc/%07d.img` 播 `stand`，所以**進場包裡沒有動畫區塊**
（這是與怪物 `0x2F` 最大的差別）。目前只有「進場」：`0x3B`（第二狀態）與 `0x3D`（會走動的 NPC，
兩個動作索引＋`CMovePath`）的 codec 已在 `protocol/npc.ts`，但沒有證據說明 client 看到它們會做什麼，
所以 `serve` 不送 —— NPC 站在那裡是對的，走動要等 oracle run（ADR-004）。
**對話則已經接上**：點一個沒有商店的 NPC 會送 `0x47`（台詞是它自己的 `info/speak`，§4.23／ADR-011）。

`serve` 的已知限制（誠實聲明）：沒有持久化（重啟即忘；角色只活在記憶體裡，換圖也只是改紀錄的 `mapId`）、**沒有頻道／分流**（一個 port 一個世界；世界現在有多張圖，但都在同一個 process 裡）、**傳送門沒有條件**（不分等級／道具／任務，`pt` 的種類也沒有語意證據）、**沒有怪物 AI／技能**
（怪物會出現、會巡邏、會被打死、會重生、也會掉東西，但不會追人、不會攻擊；只有 `Mob/9999997.img`／
`Mob/9999999.img` 兩張測試圖帶攻擊資料，見 FINDINGS §4.17.6 與 §6 第 5 項）、
建立的角色的道具欄是空的（`CharacterData` 的 `flags = 1`，client 接受；`chardata.ts` 已經能寫完整道具區塊，
缺的是「外觀 10 個 u32 → `CharacterData` 欄位」的對應，見 FINDINGS §4.8 的註記）、
NPC 會出現、**有商店的可以交易**（點下去開窗，買賣送 `0x4B`＋`0x0B`＋`0x0D`）、
**沒有商店的會講話**（`0x47` 一句一句，台詞是 `info/speak`，`0x15` 走下一句），但**不會走動**
（`0x3D` 還沒有實作），也**沒有真正的任務流程**（`info/quest` 的腳本名讀得到，但這個 client 沒有任務 UI），
還有道具的「使用」與裝備欄操作。
怪物會巡邏、被打、掉東西，但**不會主動攻擊**：原 client 的 AI 會自己做（那是它自己的行為，
伺服器不需要送任何東西就會發生），而且**被怪物打不會讓玩家的 HP 下降**——`0x0D` 雖然已解出並用於
經驗值／升級（§4.21），但「收到 `0x2C` → 扣玩家的血 → 送 `0x0D`」這條路徑還沒接上，
而且 §4.20.7 的修正說明了為什麼更難：`0x2C` 的尾段是**移動路徑**，不是 client 算出來的傷害，
所以伺服器手上沒有「玩家該掉多少血」的數字。
（`0x0B` 的 `op 1`–`op 3` 已有 codec，但還沒有誰去用它們。）

## 一張地圖上的所有人（ADR-012）

世界階層是 `game/world.ts` 的 `FieldRegistry`（`mapId → FieldInstance`）：一個 mapId 一份場地，
裡面有那張圖的怪物（含 HP）、NPC、地上的掉落物，以及**在場的成員**。連線不是世界，只是成員之一 ——
socket 關掉等於 `leave()`，不是「這場遊戲結束」。

| 事件 | 送什麼 | 給誰 |
|---|---|---|
| 有人進場 | 新來的：每個活著的怪 `0x2F`、每個 NPC 完整 `0x39`、地上每個 `0x43`、每個已在場玩家 `0x1C` | 新來的 |
| 有人進場 | 他的 `0x1C`（id／名字／外觀／座標／腳踏點）| 已經在場的人（**不含**他自己：`sub_51CFE0` 會忽略自己的 id）|
| 有人離線 | `0x1D` | 其他所有人 |
| 有人走路 | `0x22`（把 client 自己的 `0x0E` 路徑前面加上角色 id）| 其他所有人（**不含**走路的人）|
| 怪物被打／死／重生 | `0x34`／`0x30`／`0x31`（＋`0x33` 每一段巡邏）| 全場 |
| 怪物掉東西 | `0x43`；被撿走 `0x44 kind 2` | 全場 |
| 撿到什麼 | `0x0B`（哪一格）／`0x0D`（錢）／`0x11`（訊息）| **只有撿的人**（那是他的角色紀錄）|
| 殺怪的經驗值 | `0x0D` 差異包 | **只有攻擊的人** |
| 有人用了傳送門 | `0x19`（解鎖）＋ `0x16`（新地圖）＋ 新場地的整份快照 | **只有他**（他離開的那張圖收到他的 `0x1D`）|

界線不是猜的：上表「全場」那一組的封包在 client 裡都掛在**場地自己的池子**上（`CUserPool`／`CMobPool`／
`CNpcPool`／`CRewardPool`），「只有他」那一組動的是那個人的角色紀錄（FINDINGS §4.24.1）。

### 換地圖（傳送門，ADR-013／FINDINGS §4.25）

client 用 `0x0D` 說「我按了滑鼠下這個東西」（`kind = -1` ＋ 它的名字，傳送門就是它的 `pn`）；伺服器**先回一個空的 `0x19`**
（client 送完 `0x0D` 就把互動閘門鎖上，只有 `0x19` 解得開 —— 不回，玩家之後再也按不了任何東西），然後才是 `0x16`。

**去哪裡是地圖資料說的**：拿那個名字在**當前地圖**的 `portal` 清單裡找，用它自己的 `tm`；封包裡沒有地圖 id，所以
「從封包讀目的地」就是發明。`tm = 0`（出貨資料裡「沒有目的地」的寫法）⇒ 不換圖，只記一行日誌。順序是：
目的地先建好（建不出來就留在原地）→ 離開舊場地（還在的人收到 `0x1D`）→ `0x16` → 新場地的快照（怪物、NPC、
掉落物、已經在那裡的人）。商店與對話跟著換圖清掉（那些視窗屬於舊圖的 NPC）。

**人落在哪裡**：`0x16` 裡沒有座標，落點由 client 自己決定，而 `mode`（`0x16` 的第一個 byte）的語意**沒有解出來**，
所以 `mode` 一律送 `0`，伺服器記的位置就是**目的地的出生點**（`sp` 傳送門 → 第一個 `pt = 0` → 第一個傳送門，再取腳踏點）。
⚠️ 地圖資料裡的 `tn`（目的地那一側的傳送門名字）因此**只用於日誌**：真 `Data.wz` 上它指向的傳送門是真的存在的
（102020000 的 `west00` 帶 `tn = "east00"`，而 102030000 真的有一個 `east00`），但沒有 `mode` 就不知道怎麼請 client
站在那裡 —— 要改只有 `spawnPointOf` 一個地方。

**進哪張圖是紀錄的事**：`0x16` 的地圖 id 來自 `CharacterData`（`stats.mapId`），所以登入時用的就是**這份紀錄自己的地圖**
（換圖會改寫它 ⇒ 下線在哪、上線就在哪）；紀錄沒有地圖（`0`）才用 `--map`。`--map` 因此是「新角色的起始圖 ＋
沒有 mapId 的紀錄的後備」，`cli.ts` 把它同時交給 `LoginServer.startMapId` 與 `GameEntryServer.mapId`。

- **一個時鐘**：`GameEntryServer.startClock()` 只有一個 interval，走過所有場地 → 兩個人在同一張圖看到的是
  同一條腿、同一次重生。沒人看的場地不派 `0x33`（沒有觀眾的承諾），但屍體／重生與掉落物過期照算 ——
  世界比連線長壽。
- **角色 id 全伺服器唯一**（`nextCharacterId(accounts)`）：`CUserPool` 以 id 為 key，兩個帳號各自從 1 起算會撞 id，
  而 client 的自我排除會**安靜地**吃掉那筆進場紀錄（不是崩潰，是「看不到某個人」）。
- **還沒有**：頻道／分流（`FieldRegistry.of` 的 key 要加上 channel）、傳送門換圖（client 的傳送門請求目前只被記錄）、
  別人的升級特效（`0x29` 未解）、`0x1C` 的三個欄位（`unknown64`／`avatarKey`／`action` 送 0，語意未解）。

`schema` 會印出協定目錄（`--json` 給工具用）：只列有證據的封包，每列帶 `status`
（`byte-exact`／`partial`／`skeleton`）、證據出處與對應的 codec 函式名稱。

`capture` 的模式：

| 模式 | 用途 |
|---|---|
| `session`（預設）| 真實連線模型：**先送** 211-byte 握手（`--handshake`）→ 之後逐包解密並驗證標頭 |
| `framed` | 相同的 4-byte 標頭但**沒有握手**（已知種子、或第一個封包不是握手時用）|
| `raw` | 每次 `recv()` 傾印一行，完全不解讀 |

> **執行時**零依賴：Node 22 原生支援 TypeScript type stripping 與內建測試框架，
> 因此跑伺服器與測試**沒有 build step、沒有 node_modules**。
> 限制：strip-only 模式**不接受**需要程式碼生成的語法（parameter property、`enum`、`namespace`）——
> `test/source-hygiene.test.ts` 會先擋下來，免得只在載入時才爆 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
>
> 型別檢查是另一件事：strip-only 只砍掉型別、**不做任何檢查**。`server/tsconfig.json` 把 `src/` 加 `test/`
> 放進 `strict`（外加 `noImplicitOverride`、`noFallthroughCasesInSwitch`、`noUnusedLocals/Parameters`，
> 以及 `erasableSyntaxOnly`：讓編譯器自己擋下 strip-only 吃不下的語法）；`typescript` 與 `@types/node`
> 是唯二的 **devDependency**：`cd server && npm install && npm run typecheck`。新增檔案要讓它維持 0 錯誤。

## 規則

1. 任何未經 `docs/protocol/FINDINGS.md` 證實的欄位，一律以 `HYPOTHESIS` 標註並有測試可改。
2. 不得在 `server/` 出現 Godot 型別；不得把 Hex-Rays C 逐行翻譯。
3. 新增協定知識時，**同時**更新 `docs/protocol/FINDINGS.md` 與測試向量。
4. 解密**必須**做標頭自檢（`magic ^ HIWORD(state)`）：用錯種子的「假成功」比當機更貴。
   這條規則已經實際抓到一個 bug（兩個方向用同一顆種子解碼）。
5. 標頭常數是**方向相依**的：送給 client 的封包必須用 `0xFF2C`，接受 client 的封包必須用 `0xD3`。
