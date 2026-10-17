# 瀏覽器客戶端（`client/` ＋ `serve --web-port`）

> 這不是 2003 client 的替代品，也不是 Phase 3 的終點：它是一個**視窗**——能登入、能看到世界、
> 能說話、能走——用來在沒有 Windows、沒有 Godot binary 的環境裡，把伺服器端的東西**看得見**。
> 決策與理由在 `docs/DECISIONS.md` ADR-034。

## 怎麼跑

```sh
cd server
node src/cli.ts serve \
  --port 8496 --game-port 8497 --web-port 8495 \
  --account admin:admin,alt:alt,newbie:newbie \
  --data ../Data.wz --start-mesos 200 --ping off
```

`--web-port` 是**頁面自己**的 port（HTTP＋`/ws`），另外兩個是 2003 協定的 TCP port。上面這組把頁面
放在 `8495`、login 放 `8496`、game 放 `8497`：預覽環境給使用者的網址就是 `https://<port>-<sandbox>`，
所以頁面拿第一個號碼；換一組號碼也完全可以（三個都要給，而且 `--web-port` 少了 `--game-port` 會被
拒絕——`0x03` 回包裡的位址瀏覽器用不到，ADR-034 決策 1）。`--data` 不給的話會找工作目錄的
`./Data.wz`。

打開 `http://127.0.0.1:8495/`，用 `admin:admin` 登入，選世界、選角色。

一個**空帳號**（例如 `--account newbie:newbie`）在選角頁下方有「建立角色」：輸入名字按下去，頁面送
`0x06`（十個外觀字）再送 `0x05`，新角色就出現在清單裡——這是 2003 client 建立角色的那兩包，沒有另開
後門。名字重複時伺服器的 `0x06` 會回「已取用」，頁面照實印出來。

在同一個伺服器上再開一個分頁、用 `alt:alt` 登入，兩個角色就會在同一個地圖看到彼此。

看到藍色的菱形就是傳送門：滑鼠移上去會亮一圈、游標變成手指，**點一下**就換圖（頁面送 c2s `0x0D`，
伺服器用它自己的地圖資料查出目的地再送 `0x16`）。目的地永遠不是瀏覽器決定的，所以改頁面也指不動
別張圖；`sp` 這種沒有身體的出生點不會被當成可點的門。

聊天框認得一個指令語法（**這是頁面自己的寫法**，2003 client 用的是 `/귓속말`／`/헉추적`，指令字串
從來不上線路——它自己翻成 `0x23` 的 kind）：

| 輸入 | 做的事 | 回來的樣子 |
|---|---|---|
| `/w 名字 訊息` | c2s `0x23` kind `0x06`（密語） | 對方收到 `0x1A`/`0x12`（跟場地聊天**同一包**）；自己收到 `0x1A`/`0x0A`，頁面印成 `名字<< 訊息` |
| `/f 名字` | c2s `0x23` kind `0x05`（`/헉추적`） | `0x1A`/`0x09`：地圖 id，或 `-1`（不在線上） |

串流上面那一排按鈕是**表情**（`0x13`）：2003 client 用 F1–F7 送 1–7，瀏覽器不能用那幾顆鍵（F1 是
說明、F5 是重新整理），所以同樣的七張臉做成按鈕。0（中性眨眼）與 8 沒有對應的鍵，頁面也就沒有按鈕。

## 畫面上有什麼

| 元素 | 來源 | 誠實說明 |
|---|---|---|
| 腳踏點（褐色線） | `GET /api/map/<id>` ← `MapData.footholdSegments` | 就是玩家能站的地面；**沒有**背景／物件／圖塊圖層 |
| 傳送門（藍菱形＋名字） | 同上 ← `MapData.portals` | `tm > 0` 才是會換圖的門；名字是 WZ 的 `pn`；**滑鼠移上去會亮一圈、點下去就換圖** |
| 自己（綠色）與其他玩家（金色） | `0x16`／`0x1C`／`0x22` | 身體與頭是**色塊**，不是 `Character/*` 的 sprite |
| 怪物（橘色橢圓＋模板 id） | `0x2F`／`0x33`／`0x30`／`0x31` | 位置是**伺服器**的巡邏，不是 client AI |
| NPC（綠色方塊＋模板 id） | `0x39`／`0x3A` | 站著不動（`0x3B` 的走動沒有畫） |
| HP／MP／EXP／mesos／地圖 | `0x16` 的角色紀錄 ＋ `0x0D` 的差異包 | 數字直接來自伺服器 |
| 聊天 | `0x1A` sub-op `0x12` | 場地聊天與**收到的密語**是同一包，所以畫面上長得一樣（線路上就是分不出來） |
| 表情列（七顆按鈕） | c2s `0x13` → 別人收 `0x27`；自己那一張是頁面自己套用的 | 名字用的是 client 自己的表（`EMOTION_NAMES`），臉本身還沒畫（沒有 `Character/Face`） |
| 新角色 | `0x04`（名字檢查）＋`0x05`（建立） | 外觀十個字固定，等於 `scripts/whisper_probe.mjs` 的那組 |
| 右上「日誌」 | 所有事件 | 沒實作的封包會以 `unhandled packet 0x..` 出現 |

## 操作的封包對照

| 動作 | 頁面送出的 JSON | 伺服器端送出的 2003 封包 |
|---|---|---|
| 登入 | `{t:"login",user,password}` | c2s `0x01` → s2c `0x01` |
| 選世界 | `{t:"world",index}` | c2s `0x02` → s2c `0x02` |
| 選角色 | `{t:"character",id}` | c2s `0x03` → s2c `0x03`，再連遊戲伺服器送 `0x04` |
| 建立角色 | `{t:"create",name}` | c2s `0x06` → s2c `0x04`，c2s `0x05` → s2c `0x05`（成功才帶角色紀錄） |
| 進地圖 | — | s2c `0x16`（＋ `0x2F`／`0x39`／`0x1C` 快照） |
| 說話 | `{t:"say",text}` | c2s `0x12` → s2c `0x1A`/`0x12` |
| 走一步 | `{t:"move",x,y,foothold}` | c2s `0x0E` ＋ 一個元素的 `CMovePath` → 其他人收 s2c `0x22` |
| 點傳送門換圖 | `{t:"portal",name}` | c2s `0x0D`（`kind=-1`＋門名）→ s2c `0x16` 進新圖 |
| 表情 | `{t:"emotion",value}` | c2s `0x13` → 其他人收 s2c `0x27`（送的人自己不會收到） |
| 密語 | `{t:"whisper",name,text}` | c2s `0x23` kind `0x06` → 對方收 `0x1A`/`0x12`，自己收 `0x1A`/`0x0A` |
| 找人在哪 | `{t:"find",name}` | c2s `0x23` kind `0x05` → `0x1A`/`0x09`（`u32 mapId`，`-1`＝不在線） |
| 升級特效（別人的） | — | s2c `0x29` |

## JSON 協定（我們的設計，不是證據）

伺服器 → 頁面的每一則訊息都是 `{ "t": <kind>, ... }`，`kind` 就是
`server/src/client/session.ts` 的 `ClientEvent["kind"]`：

```
field        { mapId, self, users[], mobs[], npcs[] }     ← 0x16 的快照
self         { self }                                     ← 0x0D 之後的完整狀態
user-enter   { user }        user-leave { characterId }
user-move    { characterId, x, y, action, foothold }
user-emotion { characterId, emotion }
chat         { name, text }                              ← 0x1A/0x12（場地聊天與收到的密語同一包）
whisper-answer { name, delivered }                        ← 0x1A/0x0A（送的人收到的回覆；沒有文字）
find-answer  { name, mapId }                              ← 0x1A/0x09（mapId -1 ＝ 找不到）
level-up     { characterId }
mob-enter    { mob }         mob-move { mobId, x, y }     mob-leave { mobId }
npc-enter    { npc }         npc-leave { npcId }
unknown      { opcode, bytes }                            ← 這個殼沒讀的封包
created      { ok, name, id?, reason? }                    ← 建立角色（0x05）的結果
disconnect   { reason }
error        { message }
```

頁面 → 伺服器只有十種：`login`／`world`／`character`／`create`／`say`／`move`／`portal`／`emotion`／
`whisper`／`find`（上表）。

## 文字編碼（CP949，不是 UTF-8）

2003 client 的每一個字串都是 **CP949** 位元組（`protocol/cp949.ts`）：它把 bytes 直接交給 Windows
的 ANSI renderer，沒有碼頁轉換。所以這一條線上的中文（繁中）**送不出去**——`encodeCp949` 會拋
`U+XXXX is not a CP949 character`，橋把它當 `error` 回給頁面，頁面在聊天框印出來（遊戲中 `#status`
是藏起來的，錯誤另外進聊天框）。韓文與 ASCII 都正常。

收到的字也要用 CP949 解。這一刀之前 `ClientSession` 用 UTF-8 解 `0x1A` 的文字：ASCII 看起來沒問題，
韓文會變成一個替換字元——現在用的是 `decodeCp949`，測試裡有一句真的韓文密語釘住它。

## 刻意沒有的東西

- **傷害與怪物 AI**：2003 client 自己算（FINDINGS §4.20／ADR-008），這個殼不算，所以打不到怪。
- **密語的「對方是不是在密你」**：線路上分不出來——送達的密語就是 `0x1A` 的 `0x12`，跟場地聊天同一包
  （FINDINGS 4.31）。頁面照實顯示，不假裝知道。
- **背包、商店、交易、組隊、郵件**：伺服器都有（`0x0B`／`0x4A`／`0x25`／`0x26`／`0x24`），頁面沒有
  介面；它們的封包測試在 `test/shops.test.ts`、`test/miniroom.test.ts`、`test/party.test.ts`、
  `test/messenger.test.ts`。
- **WZ 圖層與 sprite**：`Map/Map/*.img` 的 Back／Obj／Tile 與 `Character/*` 都還沒有畫；那是下一個
  切片（也是 Phase 1 資產管線的出口）。
- **實體碰撞**：走過去不會撞牆、不會掉下去，位置由瀏覽器自己算。傳送門是**用點的**（見下），
  不是走上去觸發——那正好是 2003 client 自己的 `0x0D` 觸發方式（ADR-035）。

## 測試

```sh
cd server
node --test test/websocket.test.ts test/webclient.test.ts
```

`websocket.test.ts`（8 則）釘住 RFC 6455 的三件事：`Sec-WebSocket-Accept` 的官方向量、client 訊框
一定要遮罩、server 訊框一定不遮罩。`webclient.test.ts`（7 則）用 Node 內建的 `WebSocket` 當瀏覽器，
對**真的** `LoginServer`／`GameEntryServer` 走完登入→選角→進圖→說話→走路，外加靜態檔、
`/api/map/<id>` 與 `..` 的拒絕、一個空帳號用 `0x06`＋`0x05` 建立第一個角色再進去玩，以及點一扇門
換到另一張圖再走回來，以及一張臉、一通韓文密語（CP949 來回）、一次找不到人的密語與兩種 `/f` 答案。

頁面的**繪圖**沒有自動測試——它需要眼睛。這一頁就是那個「眼睛」的說明書。

## 預覽環境

`serve` 的三個 port 都是參數，但只有 `--web-port` 那個會出現在預覽網址裡，所以本專案的預覽跑法固定是
**頁面 8495、login 8496、game 8497**；`https://8495-<sandbox>.e2b.app/` 就是頁面。把 login 放在
8495 的話，預覽只會拿到一段 2003 的位元組（瀏覽器把它當成壞掉的 HTTP），看起來就是「Sandbox not
found」之外的另一種空白。

**已實測**（2026-10-17，真的瀏覽器，不是 Node 的 `WebSocket`）：預覽 proxy 會轉發 `wss` 的 upgrade。
同一個分頁裡走完 登入（`admin`）→ 建立角色（`chui`，`0x06`＋`0x05`）→ 選角（`Hero`）→ 進地圖
（헤네시스 `100000000`）→ 送出一句聊天，伺服器日誌逐包對得上。所以「代理不轉發 upgrade」的備案
（HTTP 輪詢）**不需要**。
