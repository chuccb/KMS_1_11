# 瀏覽器客戶端（`client/` ＋ `serve --web-port`）

> 這不是 2003 client 的替代品，也不是 Phase 3 的終點：它是一個**視窗**——能登入、能看到世界、
> 能說話、能走——用來在沒有 Windows、沒有 Godot binary 的環境裡，把伺服器端的東西**看得見**。
> 決策與理由在 `docs/DECISIONS.md` ADR-034。

## 怎麼跑

```sh
cd server
node src/cli.ts serve \
  --port 8495 --game-port 8496 --web-port 8500 \
  --account admin:admin,alt:alt \
  --data ../Data.wz --start-mesos 200 --ping off
```

（`--data` 不給的話會找工作目錄的 `./Data.wz`；`--web-port` 少了 `--game-port` 會被拒絕，因為
`0x03` 回包裡的位址瀏覽器用不到——ADR-034 決策 1。）

打開 `http://127.0.0.1:8500/`，用 `admin:admin` 登入，選世界、選角色。

在同一個伺服器上再開一個分頁、用 `alt:alt` 登入，兩個角色就會在同一個地圖看到彼此。

## 畫面上有什麼

| 元素 | 來源 | 誠實說明 |
|---|---|---|
| 腳踏點（褐色線） | `GET /api/map/<id>` ← `MapData.footholdSegments` | 就是玩家能站的地面；**沒有**背景／物件／圖塊圖層 |
| 傳送門（藍菱形＋名字） | 同上 ← `MapData.portals` | `tm > 0` 才是會換圖的門；名字是 WZ 的 `pn` |
| 自己（綠色）與其他玩家（金色） | `0x16`／`0x1C`／`0x22` | 身體與頭是**色塊**，不是 `Character/*` 的 sprite |
| 怪物（橘色橢圓＋模板 id） | `0x2F`／`0x33`／`0x30`／`0x31` | 位置是**伺服器**的巡邏，不是 client AI |
| NPC（綠色方塊＋模板 id） | `0x39`／`0x3A` | 站著不動（`0x3B` 的走動沒有畫） |
| HP／MP／EXP／mesos／地圖 | `0x16` 的角色紀錄 ＋ `0x0D` 的差異包 | 數字直接來自伺服器 |
| 聊天 | `0x1A` sub-op `0x12` | 只顯示場地聊天；密語沒有接 |
| 右上「日誌」 | 所有事件 | 沒實作的封包會以 `unhandled packet 0x..` 出現 |

## 操作的封包對照

| 動作 | 頁面送出的 JSON | 伺服器端送出的 2003 封包 |
|---|---|---|
| 登入 | `{t:"login",user,password}` | c2s `0x01` → s2c `0x01` |
| 選世界 | `{t:"world",index}` | c2s `0x02` → s2c `0x02` |
| 選角色 | `{t:"character",id}` | c2s `0x03` → s2c `0x03`，再連遊戲伺服器送 `0x04` |
| 進地圖 | — | s2c `0x16`（＋ `0x2F`／`0x39`／`0x1C` 快照） |
| 說話 | `{t:"say",text}` | c2s `0x12` → s2c `0x1A`/`0x12` |
| 走一步 | `{t:"move",x,y,foothold}` | c2s `0x0E` ＋ 一個元素的 `CMovePath` → 其他人收 s2c `0x22` |
| 表情（別人的） | — | s2c `0x27` |
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
chat         { name, text }
level-up     { characterId }
mob-enter    { mob }         mob-move { mobId, x, y }     mob-leave { mobId }
npc-enter    { npc }         npc-leave { npcId }
unknown      { opcode, bytes }                            ← 這個殼沒讀的封包
disconnect   { reason }
error        { message }
```

頁面 → 伺服器只有五種：`login`／`world`／`character`／`say`／`move`（上表）。

## 刻意沒有的東西

- **傷害與怪物 AI**：2003 client 自己算（FINDINGS §4.20／ADR-008），這個殼不算，所以打不到怪。
- **背包、商店、交易、組隊、郵件**：伺服器都有（`0x0B`／`0x4A`／`0x25`／`0x26`／`0x24`），頁面沒有
  介面；它們的封包測試在 `test/shops.test.ts`、`test/miniroom.test.ts`、`test/party.test.ts`、
  `test/messenger.test.ts`。
- **WZ 圖層與 sprite**：`Map/Map/*.img` 的 Back／Obj／Tile 與 `Character/*` 都還沒有畫；那是下一個
  切片（也是 Phase 1 資產管線的出口）。
- **實體碰撞**：走過去不會撞牆、不會踩到傳送門，位置由瀏覽器自己算。

## 測試

```sh
cd server
node --test test/websocket.test.ts test/webclient.test.ts
```

`websocket.test.ts`（8 則）釘住 RFC 6455 的三件事：`Sec-WebSocket-Accept` 的官方向量、client 訊框
一定要遮罩、server 訊框一定不遮罩。`webclient.test.ts`（4 則）用 Node 內建的 `WebSocket` 當瀏覽器，
對**真的** `LoginServer`／`GameEntryServer` 走完登入→選角→進圖→說話→走路，外加靜態檔、
`/api/map/<id>` 與 `..` 的拒絕。

頁面的**繪圖**沒有自動測試——它需要眼睛。這一頁就是那個「眼睛」的說明書。
