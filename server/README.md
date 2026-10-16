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
| `src/net/online.ts` | ✅ **誰在線上**：`OnlineAccounts`（`account → 活著的 session`，一個帳號一個座位）＋ `SeatKeeper`（一條連線的座位與心跳一起拿、一起還）；座位由登入伺服器（`0x01` 成功）與遊戲伺服器（角色進場）**各拿一次**，兩半共用同一份（ADR-018）|
| `src/net/heartbeat.ts` | ✅ **心跳**：對安靜的 session 送 `0x08`，client 的 `sub_43B280` 無條件回聲（任何階段都有效，FINDINGS §4.2／§4.30）；安靜超過三個間隔就 `destroy()`，於是座位歸還、`0x1D`、存檔都照既有的 close 路徑走。間隔與逾時是我們的選擇（預設 30 s／90 s，`--ping <ms\|off>`）|
| `src/net/loginserver.ts` | ✅ **登入伺服器**：實作 §4.7–§4.9 的登入鏈（握手 → 0x01 → 0x02 → 0x03/0x05/0x06），帳號與角色的**唯一真相是一份記憶體表**（`LoginServerOptions.accounts`），寫進檔案由 `persist` 回呼負責（`src/game/save.ts`，ADR-017）：建立角色、刪除角色與 **session 結束**時各存一次；另含遊戲伺服器端：領到 `0x04` 的角色 id 後送 `0x16` 進地圖、再依地圖的 `life` 送 `0x2F`（§4.15），再依地圖的 `life` 送每個 NPC 一個 `0x39`（§4.19），把 client 報的攻擊（`0x0F`／`0x10`／`0x11`）套到怪物 HP 上（§4.17），並在 `tickField` 裡跑**掉落與拾取**：殺怪時送 `0x43`、玩家走到上面時送 `0x44 kind 2`＋`0x0B`＋`0x11`（§4.18），**殺怪也會給經驗值**：`awardKillExp` 用怪物自己的 `info.exp` 加進角色紀錄，升級就送 `0x0D` 能力值差異包（§4.21）；**點 NPC 會開商店**（`0x33` → 空的 `0x19` ＋ `0x4A`），商店的按鈕（`0x16`）會回 `0x4B`＋`0x0B`＋`0x0D`（§4.22，ADR-010）；**沒有商店的 NPC 會開口說話**（`0x47` 帶它自己 `info/speak` 的第一句，client 的 `0x15` 走下一句，§4.23，ADR-011）。**密語與找人**也會在這裡落地（`handleUserRequest` → `sessionNamed` 掃線上 session，跨圖用 `target.send`，§4.31）；**走過傳送門就會換地圖**（`0x0D` → 空的 `0x19` ＋ `0x16`；目的地是地圖資料的 `tm`，見下），而**進哪張圖是角色紀錄自己的事**（`stats.mapId`，`--map` 只是新角色與沒有 mapId 的紀錄的後備）。這一切都是**每張地圖一份**：連線只是 `game/world.ts` 的一個成員（`FieldInstance.join`／`leave`／`reportMove`），**一個 server-wide 時鐘**（`startClock`）走過所有場地，不是每條連線一個 `setInterval`（ADR-012）。 |
| `src/protocol/movepath.ts` | ✅ `CMovePath`：`u16 originX/Y` + `u8 count` + **14-byte** 元素（attr/x/y/vx/vy/action/foothold/duration）。這是移動的實際內容（§4.11.5）。 |
| `src/protocol/field.ts` | ✅ 遊戲內封包：0x16 進地圖、0x1C 別人進場（**第一個 u32 ＝ 臉**，`face`）、0x1D 離場、0x22 別人移動、**0x29 升級特效**（`u32 characterId`＋`u8 effect`，0 ＝ LevelUp）、**0x27 表情**（`u32 characterId`＋`u32 emotion`，0..8 ＝ `EMOTION_NAMES`）；client 端的 0x0E（自己的移動）、**0x13 表情**與 0x0D（點擊傳送門／物件），以及 **0x1C 玩家自己的 HP／MP 變動回報**
（`[u32 flags][s16 hpΔ][s16 mpΔ][u8 flag]`，旗標與 `0x0D` 共用 `statDiffFlag`；`readClientStatReport`／
`encodeClientStatReport`，§4.33）。另含 `0x2C`（client → server 的**怪物動作回報**，頭 4 欄＋未解的尾段；`readClientMobAttack`／`describeClientMobAttack`），以及 `describeFieldOpcode`：CField 每個子系統區間（含 `0x39`–`0x41` 的 CNpcPool）都有一行，**沒有 handler 的 opcode 會明說**；`0x0D`（能力值差異包）在 `CWvsApp` 層，由 `stat.ts` 解，`describeFieldPacket` 會把它印成一行；以及 **聊天**（client 的 `0x12` 說一句 → `0x1A` ＋ sub-op `0x12` ＋ 名字 ＋ 同一串 bytes，`readClientChat`／`encodeUserChat`／`readUserChat`）與 **密語／找人**（client 的 `0x23`（`u8 kind`＋名字＋〔訊息〕）→ `0x1A` sub-op `0x09`（名字＋地圖 id）／`0x0A`（名字＋成功旗標），`readClientUserRequest`／`encodeUserFindAnswer`／`encodeUserWhisperAnswer`，§4.31）。 |
| `src/protocol/mob.ts` | ✅ **怪物封包**：`0x2F` 進場（`u32 mobId`＋`u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16 ×2`（語意未解，送 0 走的是 client 會處理的查表失敗路徑）＋動畫旗標區塊）、`0x33` 移動（動作位元組 + `u32` + `CMovePath`）、`0x30` 開始死亡動畫（`s16 delayMs`）、`0x31` 收屍／重生（`u8 flag`＋`u32 mobId`，`flag != 0` 時再接 `templateId` 與**與 `0x2F` 逐 byte 相同**的身體）、`0x35` 怪物動畫（＝`0x2F` 尾巴那塊動畫區塊，同一份實作）、`0x34` 怪物 MP；另有 **16 筆動作索引表**（`MOB_ACTION`／`MOB_ACTION_NAMES`，證據：`CActionMan::MOBACTIONENTRY` + `.data:0x5B20FC`）；`encode`／`read`／`describe` 三件套＋`test/mob.test.ts`／`test/mobs.test.ts`（FINDINGS §4.12.1／§4.15／§4.16／§4.17）。 |
| `src/game/map.ts` | ✅ **伺服器的地圖視圖**：`WzArchive` → `MapData`（`life` 出生點分怪物／NPC、`portal`、`info`、腳踏點 `footholdSegments`）；`mapDataProvider(archive)` 快取（§4.15／§4.16）。 |
| `src/game/world.ts` | ✅ **每一張地圖的共享世界**（ADR-012）：`FieldRegistry`（`mapId → FieldInstance`，第一次有人進場才建立、之後留著）＋`FieldInstance`（`mobs`／`npcs`／`drops` ＋ 在場成員）。`join()` 把整張圖的快照送給新來的人（每個活著的怪 `0x2F`、每個 NPC 完整 `0x39`、地上每個 `0x43`、每個已在場玩家 `0x1C`）並讓其他人收到他的 `0x1C`；`leave()` 送 `0x1D`；`reportMove()` 把別人走的路包成 `0x22`；`applyDamage`／`spawnFromDeath`／`pickUp` 的結果廣播全場；`tick()` 只有在**有人在看**的時候才派 `0x33`，但屍體、重生與掉落物過期照算；`portal(name)` 是「玩家用了哪個傳送門」的查詢（名字不分大小寫，查不到就是沒有）。`0x1C`／`0x1D`／`0x22` 的 sender 只在這裡（FINDINGS §4.24／§4.25）。 |
| `src/game/mobs.ts` | ✅ **一場地的怪物**：出生點吸附腳踏點、巡邏範圍 = 腳踏點折線 ∩ `rx0/rx1`、每段一個 `0x33`（`MobField`）；`Mob/<id>.img -> info` 的 `speed`／`maxHP`／`maxMP`／`level`／`exp` 與 die 動畫長度（`dieMs`，Σ 影格 `delay`，預設 180 ms）由 `mobTemplateProvider` 快取。怪物屬於**場地**（`game/world.ts`，ADR-012）：id、位置與 HP 都是那張圖的，兩個玩家打的是同一隻。怪物是**伺服器驅動**的，而且**有 HP**：`applyDamage` → `0x34`＋（死亡時）`0x30`，`tickPackets` 收屍與重生（§4.16／§4.17）。⚠️ 原 client 的怪物 AI **在自己身上**（§4.20／ADR-008）：這裡的巡邏是我們 client 還沒有 AI 之前的替代品，不是最終架構。 |
| `src/protocol/drop.ts` | ✅ **掉落物封包**：`0x43`（出現：`kind`／`dropId`／`money`／`value`／落點，`kind <= 1` 再多一顆怪物區塊）、`0x44`（消失／被撿走，`kind 2` 帶角色 id）、`0x11`（獲得提示的三種形狀）；`0x42`／`0x45` 在 client 裡沒有 handler（FINDINGS §4.18）。 |
| `src/protocol/inventory.ts` | ✅ **道具欄異動 `0x0B`**：`result`／`count`／每筆 `{op, inventory, slot, …}`，`op 0` 接一個 `GW_ItemSlot`（**沒有種類位元組**）；`op 1`（換金鑰）在裝備欄會被 client 丟 `CTerminateException`，encoder 直接拒絕（§4.18.4）。 |
| `src/game/drops.ts` | ✅ **一場地的掉落物**（`DropField`，屬於場地：`dropId` 是那張圖的 key，`0x44 kind 2` 說出是誰撿走的）：掉落表（`MOB_JUNK_DROP`／`POTION_BY_LEVEL`／三個機率常數）、落點吸附腳踏點、壽命與「玩家站在上面」的判定；機率與壽命都是**伺服器的選擇**（ADR-007）。 |
| `src/game/rewards.ts` | ✅ **獎勵與錢包**（`grantItem`／`MesoWallet`／`pickUpDrop`）：同 id 堆疊到 200、否則第一個空格、**裝備與現金道具永不堆疊**、背包滿就留在原地；`pickUpDrop` 回傳「該送哪幾個封包」的資料；`takeItem` 是商店收購那一半。**`MesoWallet` 是角色紀錄第 22 欄（`stats.mesos`）的視圖**，不是第二本帳 —— 撿到錢時 `0x0D` 的旗標 `0x40000` 會讓 client 的錢包跟著動（§4.22.5）。 |
| `src/protocol/npc.ts` | ✅ **NPC 封包**：`0x39` 進場（`u32 npcId`；**已知 id 只有 5 bytes**，新 id 才接 `u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16`＋`s16 ×2`，共 20 bytes）、`0x3A` 離場（只有 `u32 npcId`）、`0x3B` **走動**（**`u8 flag` 在前**＋`u32 npcId`；flag 1 ＝「你自己走」，FINDINGS §4.28）；`0x3C`–`0x40` 只讀 id，只有 `0x3D` 再讀兩顆**動畫**索引＋（模板旗標非 0 時才有的）`CMovePath`（FINDINGS §4.19）。**沒有**怪物 `0x2F` 那個動畫旗標區塊。 |
| `src/protocol/stat.ts` | ✅ **能力值差異包 `0x0D`（s2c）**：`u8 ack` ＋ `u32 flags`（19 個 bit，`0x01`…`0x40000`，**依旗標順序**）＋ `u32 panelFlags`（0 = 後面沒有東西）。`diffStats(舊, 新)` 只回報有變的欄位；`encodeStatUpdate`／`readStatUpdate`／`describeStatUpdate`。⚠️ 三個欄位的**線上寬度與 `CharacterData` 不同**（`str`/`dex`/`int`/`luk` **1 byte**、`unknown26`／`fame` **4 bytes**），超界值直接**拒絕**而不是靜默截斷（FINDINGS §4.21）。 |
| `src/game/exp.ts` | ✅ **經驗值與升級**：`expToNextLevel` 是 client 自己的公式（`sub_4C7110`：1–5 `n(n²/2+15)`、6–50 `q(q+19)`／`q=n²/3`、51–200 ×1.0548、>200 封頂），與公開的 2003 表 196/200 相同（四個差異是複本打字錯誤）；`awardExp` 加經驗值、必要時連續升級、**升級且還活著就補滿 HP／MP**（client 就地升級 routine 的行為）。 |
| `src/game/vitals.ts` | ✅ **玩家 HP／MP 的伺服器規則**（ADR-021、FINDINGS §4.33）：`applyVitalReport(紀錄, 差值)` 就地套用 c2s `0x1C` 的回報，回傳**只有真的動了的欄位**的 `StatDiff`（沒動就不送包）；夾在 `[0, max]`，且 **HP ＝ 0 時不接受正向 HP 差值**（client 的回復不擋死亡，補滿是復活那條路；MP 不受此限）。伺服器不驗算傷害（原 2003 server 也一樣）。 |
| `src/game/npcs.ts` | ✅ **一場地的 NPC**（`NpcField`）：地圖 `life` 的 NPC 出生點 → 每個一個 `0x39`（id 從 1 起算，**永不重用**；`spawnAll()` 只在場地建立時跑一次 —— 每位玩家一次會給同一個出生點第二個 id）；`enterPackets()` 是給**剛進場的人**的完整 body（5-byte 的 `refreshPacket` 只有 client 已經有那個 id 時才有意義）；`setWalking`／`remove` 是 `0x3B`／`0x3A` 的合法形狀（`0x3B` flag 1 ＝
**「你自己走這個 NPC」**，§4.28 —— client 自己走、自己在 4–12 秒後重挑目標，所以伺服器不記 timer），
`npcWalkPolicy("none"|"all"|"id,id,...")` 把 `--npc-walk` 變成一個「這個模板要走嗎」的函式，`npcs` 是唯讀視圖。模板來自 `npcTemplateProvider`（`Npc/<id>.img` 的 `info/name`）；模板查不到就**不生成**並記一行 log。 |
| `src/protocol/quest.ts` | ✅ **NPC 對話封包**：`0x47`（`u8 unknownA`＋`u32 npcId`＋`u8 subOp`＋body；sub-op 0 `say`／1 `confirm`／2 `askText`／3 `askNumber`／4 kind 4）與 client 的 `0x15`（`u8 subOp`＋`u8 answer`，`answer == 1` 時附帶字串或數字）。台詞是 `Npc/<id>.img -> info/speak` 的原文，牆上沒有我們編的句子（FINDINGS §4.23、ADR-011）。 |
| `src/protocol/cp949.ts` | ✅ **CP949 編碼**：封包裡的文字是 `u16 長度` + CP949 bytes（client 直接當系統 ANSI 字碼頁用）。Node 只有解碼器，所以編碼是「反轉表」在第一次用到時建出來；編不出來的字元丟例外而不是送亂碼。 |
| `src/protocol/shop.ts` | ✅ **NPC 商店封包**：`0x4A` 開窗（`u32 shopId`＋`u16 count`＋每列 `u32 itemId`／`u32 price`／（`itemId/10000 == 207` 時 8 bytes）／`u16 maxCount`）、`0x4B` 結果（`u8`；0 沉默／1・4 東西不夠／2 錢不夠／3 格子不夠／>4 錯誤）、client 的 `0x33`（點擊的物件 id）與 `0x16`（0 買／1 賣／2 充電／3 關窗），以及空的一 byte `0x19`（在 `field.ts`）。207 那 8 bytes **原封不動攜帶、拒絕自行組裝**（FINDINGS §4.22）。 |
| `src/game/dialogue.ts` | ✅ **一場對話**：`Npc/<id>.img -> info/speak` 的台詞（`info/quest` 原樣帶著）、`npcDialogueProvider` 快取、`NpcTalk`（哪隻 NPC、第幾句、`advance()`）。沒有 `info/speak` 的 NPC 就是不說話。 |
| `src/game/save.ts` | ✅ **角色存檔**（ADR-017）：`SaveStore` 介面（`FileSaveStore` 原子寫入／`MemorySaveStore` 給測試）＋ JSON 格式（版本、帳號、角色、道具；`bigint` 的現金序號用十進位字串）、`loadAccounts`（**檔案勝過 `--account` 種子**）、`readSave` 的拒絕清單（版本不合／不是 JSON／缺 `id` 或 `name`／兩個角色同一個 id／紀錄送不出去）。`flags` **不入檔**（它是內容的函式，載入時由 `characterDataOf` 推導），載入時再用 `writeCharacterData` 驗一次「client 收得下」。FINDINGS §4.29 說明為什麼這整件事是我們的設計：**沒有任何 c2s 封包帶角色資料**。 |
| `src/game/shops.ts` | ✅ **商店的規則**：價格一律讀 `Item/Consume/0XXX.img/<id>/info/price`（讀不到就不送那一列），庫存（`SHOPS`：리나／헤네시스、로빈／달팽이사냥터、**마이／암허스트**）、`DEFAULT_SHOP_MAX_COUNT`、`SELL_PRICE_RATIO` 是**這份 repo 的選擇**（ADR-010）；`buy`／`sell` 是完整驗證的交易（錢、格子、數量、哪一格），失敗回 `TradeFailure`→`shopResultCode`→`0x4B`。 |
| `src/game/items.ts` | ✅ **用掉道具的規則**（ADR-022、FINDINGS §4.34）：`consumeSpecOf` 讀 `Item/Consume/0XXX.img/<id>/spec`（**client 自己的效果表**，不是描述文字），`healsVitals`／`consumeDeltas` 把它換成 `0x0D` 要的差值（`hp`／`mp` 定值、`hpR`／`mpR` 是上限的百分比並**向下取整**）；沒定位的欄位收進 `ConsumeSpec.unapplied`（buff 家族 → 這次使用被拒絕，道具留在袋子裡）。 |
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
失敗訊息表在三個 handler 共用（訊息原文與每個值的意義見 FINDINGS §4.8 —— 2026-10-16 修正過：`2`／`3`
是「帳號已被刪除或連線被中止」、`5` 是「沒有這個帳號」、`7` 是「已在線上」），只有 `result = 0` 會繼續
解析 payload；**唯一的例外是 `0x05` 建立角色**：那裡 `0` 是失敗，非 0 才是「成功，後面接新角色的
`CharacterData`」（`sub_4329A0`）。

**`0x01` 也會拒絕「已經在線上」的帳號**（回 `7`，就是 client 自己那句話）：一個帳號一條活著的
session，座位由登入／遊戲兩半各拿一次、共用同一份表，心跳負責把無聲消失的連線清掉（FINDINGS §4.30、
ADR-018）。`0x08` 在本伺服器是**雙向**的：client 送來的回聲只證明它還活著（沒有東西要回），伺服器
只在對方安靜時才主動問。

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
     --world Scania[,Bera] --game-ip 127.0.0.1 [--map 1000000] [--start-mesos <n>] \
     [--data Data.wz|off] [--save <path|off>]
```

`serve` 的行為：帳號來自**存檔**（`--save`，預設 `./kms111-save.json`；檔案不存在時才用 `--account user:pass,...` 這種子）、`--game-port` 會同時開遊戲伺服器端
（領取交接的角色 id 後送 `0x16` 進地圖、再依地圖的 `life` 清單送 `0x2F` 怪物與 `0x39` NPC、之後每個 tick 送 `0x33` 讓怪物巡邏，見下）；
**一個 port 就是一個世界**：同一個 `mapId` 的角色走同一份怪物、同一份掉落物，並互相看見（ADR-012）；角色進哪張圖由**他自己的紀錄**決定（換過圖就留在那裡），`--map` 是新角色的起始圖與沒有 mapId 的紀錄的後備（ADR-013）；走進傳送門就會換圖（見下一節）。
`--data <Data.wz|off>` 指定地圖資料來源（預設：工作目錄有 `./Data.wz` 就用它，`off` = 完全不讀檔）、
`--mob-speed <px/s>` 調巡邏速度（預設 60 px/s，再乘上怪物自己的 `info.speed` 百分比）、
`--mob-respawn <ms>` 調怪物重生延遲（預設 5000 ms）、
`--npc-walk <none|all|id,id,...>` 決定**哪些 NPC 由 client 自己走**（`0x3B`，FINDINGS §4.28；預設 `none`，
裸的 `--npc-walk` 等於 `all`），角色建立後外觀取自**帳號第一個角色**
或全零（0x06 的 10 個外觀 u32 目前只記在日誌裡 —— 它們的**順序**對應到哪些欄位尚未證實；
client 自己那 12 個部位格已經解出來了，見 FINDINGS §4.11.3b 與 §6 第 16 項）。
`--ping <ms|off>` 決定**心跳間隔**（ADR-018；預設 30000，`off` ＝不裝心跳）：安靜超過一個間隔的
session 會被伺服器用 `0x08` 問一次，安靜超過三個間隔（＝ 3 × `--ping`）就當它斷線 ——
那會歸還它佔的帳號、角色與座位。`off` 只該在「相信 TCP」的實驗裡用：無聲消失的連線會把帳號
佔到 OS 發現為止。
`--save <path|off>` 決定**角色存到哪裡**（ADR-017；預設 `./kms111-save.json`，`off` ＝只活在記憶體，也就是這個
伺服器以前的樣子）：整張帳號表在建立角色、刪除角色與 session 結束時重寫一次，寫入是 `tmp` ＋ rename（崩潰
不會留半個檔），而**讀不懂的檔案會讓伺服器起不來**（版本不合、不是 JSON、缺 `id`／`name`、兩個角色同一個 id、
紀錄送不出去）—— 起成空的再把空的寫回去才是真正會弄丟角色的做法。
`--start-mesos <n>` 決定**新角色**的起始錢（ADR-022；預設 `0` ＝ 2003 年的新角色身上一毛都沒有，
連 25 元的 빨간 포션 都買不起 —— 那是設計，不是缺口）：它只影響這個旗標設定**之後建立**的角色，
存檔裡已經有的人不受影響。要用商店買東西（例如 `--start-mesos 200`）就得靠它或去撿掉落物。

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
升級時 client 會自己播 `Effect/BasicEff.img/LevelUp` 並印「레벨이 올랐습니다」（**升級是伺服器決定的**，
而**別人**看到的那份是 `0x29`，§4.27／ADR-015）。
還缺的是「被怪物打 → 掉血」（`0x2C` 只是 client 的回報，而且它的尾段是**移動路徑**不是傷害，
§4.20.7；所以這條路沒有現成的傷害來源）與能力面板／buff 區塊
（`panelFlags != 0` 的內容未解，伺服器一律送 0）；**商店已經做完**（`0x4A`／`0x4B`／`0x16`／`0x33`，§4.22）；
**NPC 的對話也做完了**（`0x47` 開一個對話框、client 的 `0x15` 回答案、台詞取自
`Npc/<id>.img -> info/speak`，§4.23／ADR-011）；**世界已經是多玩家的**（§4.24／ADR-012：一張地圖一份 `FieldInstance`），
而且**走過傳送門就會換地圖**（`0x0D` → `0x19` ＋ `0x16`，§4.25／ADR-013，兩節都在下面），所以
**下一個最有價值的目標**是 oracle run（ADR-004：讓原 client 連上這台 server —— 它一次就能回答
§4.11／§4.24／§4.28 的所有 UNKNOWN），其次是 `0x3D`（伺服器指定 NPC 動作：索引已解、長度還缺一個
模板旗標的來源）與
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
（這是與怪物 `0x2F` 最大的差別）。**走動則是 `0x3B`**（FINDINGS §4.28）：`flag = 1` 的意思是「**你自己走**」
—— client 的 vecctrl 在 NPC 自己的範圍裡移動、每 4–12 秒自己重挑一個目標（`sub_499760`），所以伺服器送
**一個**封包、之後不記任何 timer；`flag = 0` 停下來。`game/npcs.ts` 的 `walk` 政策決定哪些 NPC 這樣走
（`--npc-walk`），預設 **沒人走**：機制（client 自己走）有證據，**哪些** NPC 該走沒有 —— 那是原伺服器的
選擇，等 oracle run（ADR-004）。`0x3D`（伺服器指定動作）讀的兩個 `s8` 現在已知是**動畫索引**
（`sub_499C00` ＝ 播一個動畫），但尾巴的 `CMovePath` 只在**模板的一個旗標非 0** 時才讀，而那個旗標來自
哪個 WZ 標籤未定位 —— 長度猜錯會讓 client 把後面的位元組當路徑解，所以還是不送。
**對話則已經接上**：點一個沒有商店的 NPC 會送 `0x47`（台詞是它自己的 `info/speak`，§4.23／ADR-011）。

`serve` 的已知限制（誠實聲明）：**有角色存檔但仍有限**（ADR-017：建立／刪除角色與下線時各存一次，所以**當掉的那場 session 的最後幾分鐘會不見**；
**已在線上會被拒絕**（`result 7` ＋ `0x08` 心跳，ADR-018／FINDINGS §4.30）：一個帳號一條活著的 session、
一個角色一條連線，無聲消失的連線最多 3 × `--ping`（預設 90 s）後被清掉）、**沒有頻道／分流**（一個 port 一個世界；世界現在有多張圖，但都在同一個 process 裡）、**傳送門沒有條件**（不分等級／道具／任務，`pt` 的種類也沒有語意證據）、**沒有密語／找人／GM 指令**（`0x1A` 家族只實作了聊天那一個 sub-op）、**沒有怪物 AI／技能**
（怪物會出現、會巡邏、會被打死、會重生、也會掉東西，但不會追人、不會攻擊；只有 `Mob/9999997.img`／
`Mob/9999999.img` 兩張測試圖帶攻擊資料，見 FINDINGS §4.17.6 與 §6 第 5 項）、
建立的角色的道具欄是空的（`CharacterData` 的 `flags = 1`，client 接受；`chardata.ts` 已經能寫完整道具區塊，
缺的是「外觀 10 個 u32 → `CharacterData` 欄位」的**順序**對應（client 的 12 個部位格已解，
見 FINDINGS §4.11.3b；缺的是那 10 個 u32 的順序，§6 第 16 項））、
NPC 會出現、**有商店的可以交易**（點下去開窗，買賣送 `0x4B`＋`0x0B`＋`0x0D`）、
**沒有商店的會講話**（`0x47` 一句一句，台詞是 `info/speak`，`0x15` 走下一句），
而且**可以走動**（`0x3B`：被點名的 NPC 由 client 自己走 —— `--npc-walk`，預設沒人走，§4.28），
但**沒有真正的任務流程**（`info/quest` 的腳本名讀得到，但這個 client 沒有任務 UI），
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
| 有人升級 | `0x29`（`u32 characterId` ＋ `u8 0` ＝ LevelUp 特效；FINDINGS §4.27）| **其他所有人**（升級的人自己的 `0x0D` 就會讓他的 client 播同一個特效，見下）|
| 有人說話 | `0x1A` ＋ sub-op `0x12`（`u8 sub-op`、`string 名字`、`string 內容`；FINDINGS §4.26）| **全場，包含說話的人**（client 只會顯示它收到的，見下）|
| 一個 NPC 要走動 | `0x3B`（`u8 flag` ＋ `u32 npcId`，flag 1；FINDINGS §4.28）| 全場，而且**之後進場的人也拿到**（它在場地快照裡，跟著那個 NPC 的 `0x39` 走）|
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

### 死亡與復活（ADR-020／FINDINGS §4.32）

**復活請求跟傳送門是同一個封包**：`0x0D`，差別只在 `kind`。client 端那顆 OK 鈕（以及 **Enter**，`sub_4E9E30`
的 `13` ＝ VK_RETURN）走的是 `sub_4E9E70` → `sub_472590(0, nullptr)`，也就是 `kind = 0` ＋**空字串**名稱；
`kind = -1` 是「滑鼠下那個東西」、map id 是 GM 的 `/헉맵`（這個伺服器沒有 GM 指令，所以只記日誌）。
`0x19` 放行閘門照送（`sub_472590` 設的是同一個閘門）。

**哪裡叫「安全的村莊」是伺服器的答案**：client **完全不讀** `returnMap`（執行檔裡沒有這個字串），它只在
`CUIRevive` 視窗上寫「부활을 하시면 안전한 마을로 이동됩니다」。所以伺服器讀 `Map/Map/*.img/info/returnMap`
（`game/map.ts` 的 `reviveMapId`）：正整數且不是哨兵就用它，**哨兵 `999999999`**（25 張圖，全部是村莊，
例如 `1010000` 암허스트）或讀不到圖就**重進當前這張圖**。

**真正讓人活過來的是 `0x16`**：它會重建 client 的場地與**本機角色**（`sub_4C2780` → `sub_51CBF0` → `sub_511030`），
而死掉的那個動作位元組（`CUser + 180` ＝ 18／19）與屍體屬於被換掉的那一份；同一包裡的 `CharacterData`
就是 client 畫 HP 條的那份紀錄（§4.21），所以伺服器**先把 HP 補成 `maxHp` 再送 `0x16`**，不需要第二條 HP 封包。

**被打掉血是另一半，而它現在也完成了**（FINDINGS **§4.33**、ADR-021）：怪物 AI 在 client，傷害也是 client 自己
算的（`sub_511C60` → `sub_4C8ED0` → `sub_5114A0`），它用 **c2s `0x1C`** 回報**差值**；而玩家紀錄的 HP 只有伺服器的
`0x0D` 會寫，所以伺服器落帳後回 `0x0D`，那就是血條動的原因。伺服器不驗算傷害（原 2003 server 也只能照單全收）。
仍未解／未做的只剩不影響這條鏈的兩件事：**誰寫入 `CField + 680`**（誰宣告死亡那個時刻）與**死亡懲罰**
（掉經驗／掉道具，沒有證據所以未實作）。

**測試**：`map.test.ts` 釘住 `reviveMapId` 的三種資料形狀與真 `Data.wz` 的 `001000000` → `1010000`；
`serve.test.ts`「a revive restores HP and re-enters a field」用三條真 socket 跑「1/50 → `0x19` ＋ `0x16`（50/50、換圖）
→ 別人看到 `0x1D`／`0x1C` → 在新圖被第三人看到 → 在村莊再復活一次（讀不到 `returnMap` ⇒ 重進）」。

### 用掉道具（ADR-022／FINDINGS §4.34）

c2s `0x18`（`200/201/202` 家族，藥水與食物）與 `0x19`（`203`， 귀환 주문서）是同一個形狀：
`[opcode][s16 slot][u32 itemId]` —— **分頁不在線上**（兩個 opcode 只可能來自 USE 分頁），而 `itemId` 是
client **宣稱**那個欄位裡有什麼，所以伺服器一定拿自己的紀錄再對一次。兩個送出者（道具欄的「使用」
`sub_462DC0`、快捷鍵 `sub_512570`）都先過 client 自己的三道閘門：沒有在途的請求、**HP > 0**、以及
節流（0x18 ＝ 200 ms、0x19 ＝ 500 ms）。

**道具做什麼是 `Item/Consume/0XXX.img/<id>/spec`**（不是 `info/desc`：빨간 포션 的 desc 說「약 50」而
`spec/hp` 正好是 50，엘릭서 的 desc 說「약 50%」而 `hpR`／`mpR` 是 50，파워 엘릭서 的 desc 說「모두 회복」而
兩個都是 **100**）：

| 家族 | `spec` | 用哪個 opcode |
|---|---|---|
| `02000000`–`02000006` | `hp` 50／150／300、`mp` 100／300、`hpR`／`mpR` 50 或 100 | `0x18` |
| `0201xxxx` 食物 | `hp`／`mp`／`hpR`／`mpR`（`02010006` 的 `"50"` 是**字串**，形狀不對＝沒有值）| `0x18` |
| `0202xxxx` 高階藥水 | `hp` 200–1000、`mp` 200／800 | `0x18` |
| `0203xxxx` | `moveTo`：`−1` ＝最近的城市、`100000000` ＝헤네시스、… | `0x19` |
| `02002000`+／`02012000`+／`02022002` | `time` ＋ `pad`／`mad`／`pdd`／`eva`／`acc`／`speed`／`pda` | —（**拒絕**：伺服器沒有 buff 狀態）|
| `0204xxxx`（強化卷軸）／`0207xxxx`（標槍）| **沒有 `spec`** | —（兩個 opcode 都不是）|

`0x19` 的 `moveTo = −1` 用**復活那條路同一個答案**（`reviveMapId`：地圖的 `info/returnMap`，村莊的哨兵
`999999999` ＝ 重進這一張），伺服器**先確認目的地有圖才扣道具** —— 卷軸不會消失在一個讀不到的圖上。
滿血喝藥水同理：**先驗「真的會動」再扣**，所以不會白白浪費一罐。

**每一個使用請求都有回包**（client 的閘門由回包解開）：允許 → `0x0B`（`put` 剩下的數量／沒有了就是
`clear`）＋ 藥水的 `0x0D` 或卷軸的 `0x16`；**拒絕 → 空的 `0x0B`**（`result` 非 0，語意正是「什麼都沒變」）。
沉默會讓玩家連下一罐都喝不了，所以拒絕也是答案。

**三間店、兩種卷軸**（ADR-010 的商店表延伸）：`1010100` 리나（헤네시스）、`2003` 로빈（달팽이사냥터）、
`12100` 마이（**암허스트**，`--map` 的新角色與復活都會到的那個村）；三間都賣 마을 귀환 주문서（75），
마이 還賣**指名一張圖**的 헤네시스 귀환 주문서（90）—— 後者讓「用道具換圖」是可以觀察、可以測試的。

### 表情（ADR-023／FINDINGS §4.35）

按 **F1–F7** 會讓角色做一張臉，而**只有別人看得到伺服器的那一半**：c2s `0x13` 是
`[0x13][u32 emotion]`，送出者 client 在組封包**之前**就把那張臉套在自己身上了
（`sub_511E20` case 10：`.text:00511FD8` 的 `sub_509790` 早於 `.text:00511FDF` 的 `push $0x13`），
所以伺服器的全部工作是把它廣播出去 —— s2c `0x27` ＝ `[u32 characterId][u32 emotion]`，
只給**同場地的其他人**（與 `0x22` 自己的移動路徑、`0x29` 自己的升級特效同一條規則）。

九張臉就是 client 自己的那九個臉圖節點名（`.data:0x5B20D8` 的九個 `wchar_t*`）：

| 索引 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 節點 | `blink` | `hit` | `smile` | `troubled` | `cry` | `angry` | `bewildered` | `stunned` | `vomit` |
| 誰用 | 平常 | **client 被打時自己用** | F2 | F3 | F4 | F5 | F6 | F7 | 沒有按鍵 |

F1..F7 送 `1`..`7`（`key - 111`），F8 以上什麼都不送。**索引 1 兩邊對得上**：client 被打時給自己
`sub_509790(this, 1, 1500)`，而表上第 1 個就是 `hit`。

⚠️ 名稱只有這九個節點名（client 的字面字串），**沒有韓文對應** —— `Data.wz` 與 `.exe` 裡都找不到
（按鍵設定不在資料檔裡），所以程式與文件都用它們。

伺服器**不記狀態**：臉是「現在的樣子」，不進存檔、換圖不重送（新進場的人從 `0x1C` 的紀錄開始畫）；
不合法（> 8）的索引直接丟掉並記日誌，因為 client 自己送不出這種值（`sub_509790` 兩處都擋著），
而表情沒有像點擊或道具那樣的「在途請求閘門」，所以沒有回包義務。

### 誰在線上（ADR-018／FINDINGS §4.30）

| 事件 | 做什麼 |
|---|---|
| `0x01` 成功 | 拿這個帳號的座位；已經有人佔 → 回 `7`（「현재 접속중인 아이디이거나…」）並在日誌寫出是誰在佔、佔了多久 |
| 登入 socket 關閉 | 歸還座位（玩家去了選角畫面或遊戲伺服器，兩邊各自再拿一次）|
| 角色進場（`0x04`）| 拿座位（用**帳號**），並記住「這個角色 id 在這個 session 裡」|
| 同一個角色 id 的第二條連線 | 直接關掉（第一條不受影響）。擋的是「舊的連線還活著、卻沒有人看得見它、而兩條連線寫同一份角色紀錄」，不是重複的 id 本身 |
| 任何收到的封包 | 算活著的證明（`Heartbeat.note`）|
| 安靜 1 個間隔 | 伺服器送 `0x08`＋一個計數器；client 的 `sub_43B280` 無條件回聲 |
| 安靜 3 個間隔 | `socket.destroy()`：座位歸還、`0x1D` 廣播、存檔 —— 跟玩家自己關掉視窗同一條路 |

**座位是「帳號」的，不是「角色」的**：拒絕發生在 `0x01`（訊息講的是帳號），而「這個角色在不在圖裡」
是遊戲伺服器自己的事。`--ping off` 關掉心跳就退回「相信 TCP」：無聲消失的連線會把帳號佔住，
而訊息會一直說「你已經在線上」。

### 聊天（ADR-014／FINDINGS §4.26）

client 打字送 `0x12`（一個字串）；伺服器把它轉成 `0x1A` ＋ sub-op `0x12` ＋ **說話的人的名字** ＋
同一串 bytes，送給**同一張圖的每個人**。三件值得記住的事：

- **說話的人也會收到**。client 的輸入路徑只**送**（`sub_470C70` 組完封包就結束），`名字>> 內容` 這個排版
  只存在於接收端（`sub_472910` 的 case 0x12）。所以「玩家要看到自己說的話」是伺服器的責任 ——
  不回音，玩家的話就永遠不會出現在他自己的聊天視窗裡。
- **文字原樣轉送 bytes**（`UserChat.text` 是 `Uint8Array`）：伺服器是轉播者、不需要讀那行字，
  而「解碼再編碼」正是唯一會弄丟字元的一步（`cp949.ts` 對編不出來的字元丟例外）。
  名字則是伺服器自己的事實（`session.name`）：封包裡**沒有角色 id**，名字是接收端唯一的身分。
- **範圍是場地**：`0x1A` 是 `CField` 自己的 opcode，聽眾就是那張圖的成員（換圖就換聽眾）。

⚠️ **沒有的**：文字沒有任何過濾、也沒有 GM 指令（`0x22` 廣播只有 GM 客戶端做得到）；密語與「找人」在下一節。

- **一個時鐘**：`GameEntryServer.startClock()` 只有一個 interval，走過所有場地 → 兩個人在同一張圖看到的是
  同一條腿、同一次重生。沒人看的場地不派 `0x33`（沒有觀眾的承諾），但屍體／重生與掉落物過期照算 ——
  世界比連線長壽。
- **角色 id 全伺服器唯一**（`nextCharacterId(accounts)`）：`CUserPool` 以 id 為 key，兩個帳號各自從 1 起算會撞 id，
  而 client 的自我排除會**安靜地**吃掉那筆進場紀錄（不是崩潰，是「看不到某個人」）。
- **升級特效的兩半**（§4.27／ADR-015）：升級的人收到 `0x0D`，他的 client 從等級變高自己播
  `Effect/BasicEff.img/LevelUp`（`sub_55BEB0` 的尾端）；其他人收到 `0x29`（`u32 characterId` ＋
  `u8 0`），同一組特效畫在那個人身上。⚠️「不送給升級的人自己」是推論（兩條路都會播，兩者都送會播兩次）。
- **還沒有**：頻道／分流（`FieldRegistry.of` 的 key 要加上 channel）、`0x1C` 的三個欄位
  （`unknown64`／第二與第三個 u32／`action` 送 0，語意未解；第一個 u32 是**臉**，已解，見下一節）、
  `0x29` 的 effect `1`（後面還有一個 `u32`，未解）。

### 起始外觀：臉與頭髮（ADR-024／FINDINGS §4.8.1a、§4.11.3c）

client 畫一個角色的頭只需要兩個數字，而它們在網路上的位置以前是錯的（或根本沒送）：

| 值 | `CharacterData` | `0x1C`（別人進場）| 送到 `CUser` 的哪裡 |
|---|---|---|---|
| **臉**（`Character/Face/000xxxxx.img`）| `appearanceA`（`+18`）| 第一個 u32（欄位名 `face`）| `+68`（`sub_508260`）|
| **頭髮**（`Character/Hair/0003xxxx.img`）| `appearanceB`（`+22`）| 外觀清單裡的那一格 | 外觀第 0 格（`sub_508290`）|
| 臉部裝飾（`101xxxx`）| 穿戴裝備 | 外觀清單（`sub_45F340` 會把它挑出來）| `+72` |

三條獨立的路都指向同一組：`0x1C` 的第一個 u32（`sub_520680` → `sub_507A20` → `sub_508260`）、
紀錄的 `appearanceA`／`appearanceB`（`sub_42E2C0` → `sub_424590`／外觀第 0 格）、以及 `0x28` 的 flag bit 0
（`sub_5221A0` 寫 `this[17]`）。`+68` 之所以確定是**臉**而不是「外觀版本鍵」，是因為表情播放器
`sub_509070` 拿它去 `sub_408400` 找 `Character/Face/*.img` 的情緒節點（`"0"`..`"8"`）—— 別的圖沒有那些節點。
`0x06`（建立角色）的十個 u32 也因此全部歸位：**臉、頭髮、上衣、褲子、鞋子、武器，然後四顆骰子**
（`sub_431620` 依 `CUINewChar + 496 + 8k` 的順序送；`sub_430D00` 顯示這六格寫進 avatar 的部位 0／5／6／7／11）。

伺服器端的規則：

- **有就照用**：`createCharacter` 把 `0x06` 的第 1／2 個 u32 寫進紀錄的 `appearanceA`／`appearanceB`；
  `0x1C` 送角色的臉，外觀清單是**頭髮 ＋ 穿戴中的裝備 id**（`sub_45F340` 靠 id 前綴歸位，清單唯一的
  規則是不得含 0）。
- **缺就補起始值，但只在送出邊界補**：`lookOf`（臉 `20000`、頭髮 `30000` —— `Data.wz` 裡
  `Character/Face/00020000.img` 與 `Character/Hair/00030000.img`）＋`withDefaultLook`（`0x16` 與
  `0x02`／`0x05` 的回包）。**存檔不改寫**：0 仍然讀作「還沒設定」，所以以後真的證明「沒設定」與
  「起始值」在 client 端不同時，資料還在。
- **衣服與骰子只記日誌**：衣服要變成穿戴裝備，得先證明「穿戴格欄號 ↔ 部位格」是同一套號碼
  （`sub_42E2C0` 的線性迴圈是唯一線索）；骰子哪一顆是 STR／DEX／INT／LUK 沒有文字證據
  （`.exe` 裡沒有那四個韓文字串）。兩者都留在 FINDINGS §6 第 16 項。

### 密語與找人（ADR-019／FINDINGS §4.31）

client 用同一個封包問兩種問題：`0x23` ＝ `u8 kind` ＋ `str name` ＋（有的話）`str text`，`kind 0x05` 是「這個人在哪」、`kind 0x06` 是「把這句話給他」（`kind 0x22` 是 client 自己在聊天視窗關著時送的氣球請求，見下）。回包都在 `0x1A` 家族裡：

| 事件 | 做什麼 |
|---|---|
| 找人（`0x05`）| 找得到 → `0x1A` sub-op `0x09`（`name` ＋ `u32 mapId`，client 自己用地圖 id 查地名）；找不到 → 同一個封包帶 `0xFFFFFFFF`（client 顯示「找不到 'x'」）|
| 密語（`0x06`）| 送達 → **收件者**收到 `0x1A` sub-op `0x12`（跟聊天同一個封包：`sender` ＋ `text`），**寄件者**收到 sub-op `0x0A`（`name` ＋ `u8 flag`，client 用自己保留的那份文字顯示 `name<< text`）|
| 密語給不在線上的人 | `0x0A` 帶 flag 0（同一句「找不到 'x'」）|
| 氣球請求（`kind 0x22`）| 只記一行日誌。畫氣球的那個 s2c **已定位**（`0x1F` → `sub_50B320`：`[u32 characterId][string text]`，5 秒，畫面是「名字 : 文字」，FINDINGS §4.35.5），但請求裡的第二個字串來源還沒定位 —— 那格是 `CWvsApp + 36` 的字串欄位（`sub_4732C0(sub_4337A0())`），不是剛收到的訊息，所以先不實作 |

- **目標是名字，不是 id**：封包裡只有名字（`sub_4717D0` 的第三個參數，`sub_524A00` 驗證過的字串），  所以這是第一個**用名字找人**的路徑，也是第一個**離開寄件者所在場地**的封包（`target.send`，  不經 `FieldInstance.broadcast`）。
- **只有線上算數**：查找掃 `sessionsByCharacter`（線上 session 的唯一真相，ADR-018），沒有 session 的角色  沒有「現在的位置」，`0x09` 回 `0xFFFFFFFF`、`0x0A` 回 flag 0。**不回存檔裡的地圖**：那是「上次下線的地方」。
- **大小寫**：比對忽略大小寫（跟建立角色時的 `nameTaken` 一致），但回覆一律用**紀錄裡的拼法**，  所以打 `alt` 會找到 `Alt`、畫面也顯示 `Alt`。
- **收件者的 client 分不出聊天與密語**（兩者都是 `0x12`）：這是 2003 年 client 的形狀 —— 密語是  「有對象的聊天」，不是私訊視窗。
- **拒收沒有實作**：`0x1A` sub-op `0x22`（`'name'님은 현재 귓속말이 거부되어 있습니다.`）的形狀已知，  但 client 端沒有任何輸入會設定「我拒收密語」（開關的封包還沒找到），沒有驅動者的 codec 是死碼。
- **密語不進存檔**：沒有離線訊息，`--save` 的格式不動。

`scripts/whisper_probe.mjs` 是這幾節（密語／死亡與復活／表情／用掉道具）的**實機煙霧測試**：一個迷你 2003 client（真的走
`0x01`→`0x02`→`0x03`→`0x04` 登入鏈，字元不存在就自己建），用**真 `Data.wz`** 的兩條連線跑完
「跨圖密語／找人／找不到／氣球不回應／被打掉血／復活／**別人的臉與頭髮**／**表情**／**買卷軸並用掉**」**36 個檢查** —— 其中兩條連線**真的在不同地圖上**：
`0x16` 進 `1000000` 之後，它用 `0x0D` 走過那張圖的 `east00` 傳送門到 `1010000`，再驗證找人的回覆
報的是**對方**的地圖 id、密語也照樣送達（第二次跑同一份存檔會跳過那一步：角色的紀錄已經記得 `1010000`）；
在復活之前它先送兩次 c2s `0x1C`（`sub_55B870(-damage, 0, 0)` 的位元組：`-30` 兩次），驗證第一次回來的
`0x0D` 是 `hp = 20`、第二次是 `hp = 0`（夾住，不會到負的）；最後它送一次 `0x0D` `kind = 0`（復活），
驗證回來的 `0x16` 進的是 `1000000` 真正的 `info/returnMap`（`1010000` 암허스트 村莊）、HP 補回 `50/50`，
而且站在那裡的另一個人看到 `0x1C` —— 那個 `0x1C` 也順便被檢查：它的第一個 u32 是 Hero 的臉、
外觀清單裡有他的頭髮（兩者都是伺服器在新角色身上填的起始外觀，因為這支探針的 `0x06` 送十個 0）。
同一張圖上的表情那一項也一樣：Hero 送一個 `0x13`（臉 6，
「bewildered」），Alt 收到 `0x27` 帶著 Hero 的角色 id 與 `6`，而 Hero **自己什麼都沒收到**
（他的 client 已經套用過了）。最後一段用的是**同一份真資料**：Hero 認出村莊 `0x39` 裡 마이（12100）的池 id、
點它開窗（`0x4A` 的四列裡 헤네시스 귀환 주문서 ＝ 90）、買下來（`0x4B silent`＋`0x0B put`＋錢包 `200 → 110`），
再用 `0x19` 把它用掉 —— 回來的 `0x16` 進的是 `Item/Consume/0203.img/02030004/spec/moveTo` 寫的 `100000000`
（헤네시스），不是伺服器挑的圖。這一段需要 `--start-mesos`（新角色才有錢）：

```bash
node server/src/cli.ts serve --port 8495 --game-port 8496 \
     --account admin:admin,alt:alt --save /tmp/whisper.json --data Data.wz --ping off --start-mesos 200
node server/scripts/whisper_probe.mjs 8495 8496        # 應該印出 PROBE PASS（36 個檢查）
```

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
