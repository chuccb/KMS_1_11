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

看到 `MapHelper` 的傳送門動畫就是門：滑鼠移上去游標變成手指，**點一下**就換圖（頁面送 c2s `0x0D`，
伺服器用它自己的地圖資料查出目的地再送 `0x16`）。目的地永遠不是瀏覽器決定的，所以改頁面也指不動
別張圖；`sp` 這種沒有身體的出生點（`pt == 0`）不會被當成可點的門——但它的點擊框還在，方便你在
沒有動畫的圖上找到出口。

聊天框認得一個指令語法（**這是頁面自己的寫法**，2003 client 用的是 `/귓속말`／`/헉추적`，指令字串
從來不上線路——它自己翻成 `0x23` 的 kind）：

| 輸入 | 做的事 | 回來的樣子 |
|---|---|---|
| `/w 名字 訊息` | c2s `0x23` kind `0x06`（密語） | 對方收到 `0x1A`/`0x12`（跟場地聊天**同一包**）；自己收到 `0x1A`/`0x0A`，頁面印成 `名字<< 訊息` |
| `/f 名字` | c2s `0x23` kind `0x05`（`/헉추적`） | `0x1A`/`0x09`：地圖 id，或 `-1`（不在線上）；**名字是頁面自己補的**，只有當它剛好抓過那張圖（`/api/map/<id>`）時才印 |

串流上面那一排按鈕是**表情**（`0x13`）：2003 client 用 F1–F7 送 1–7，瀏覽器不能用那幾顆鍵（F1 是
說明、F5 是重新整理），所以同樣的七張臉做成按鈕。0（中性眨眼）與 8 沒有對應的鍵，頁面也就沒有按鈕。

點 NPC 就是 `0x33`（`{t:"click",objectId}`），回來的可能是**商店**（`0x4A` → 左邊的視窗）或
**一句台詞**（`0x47` → 下面的對話框）。哪一個由伺服器決定：商店是 `game/shops.ts` 的表，台詞是
`Npc/<id>.img -> info/speak`，頁面兩者都不知道。商店視窗每列有圖示、名字、價格與「買」「×10」；
**賣出還沒接**（需要選格子與數量，頁面還沒有那種介面）。對話框的「確定」是主要按鈕（下一句），
「關閉」是次要按鈕（結束）——跟 2003 client 的兩個按鈕一樣。

按 **`I`**（或右上「背包」）打開的背包是**畫在畫布上的原版視窗**，不是 HTML 面板：
`UI/UIWindow.img/Item/backgrnd`（162×315）貼在 `sub_506440(this, 0, 114, 9, 1)` 的位置，格子
（4×6、32 px、間距 35）、捲軸與下面 meso 欄都是圖上原本的；分頁標籤是 `sub_4DA440` 加到
`CCtrlTab` 的四個（장비／소비／설치／기타，依 `CharacterData.inventories` 的 equip／use／install／
etc 順序）。圖上第一格分頁是「亮起」的版本，頁面把同一張圖的亮起版（x=2）與平常版（x=36）蓋到
目前分頁上，讓選取狀態跟著換。**點分頁**切換、**點格子**選取並顯示道具說明、**雙擊消耗品**使用
（頁面送 `0x18`，203 家族的地圖卷軸送 `0x19`，跟 2003 client 的 `sub_462DC0` 同一個分流）、
**拖曳視窗**可移動（位置存在 `localStorage`，對應原版存在 registry 的版面表）。喝不喝得到藥是
**伺服器**決定的，畫面只跟著回來的 `0x0B`（少一瓶）與 `0x0D`（HP 動了）走。數量與可升級次數
（`ruc` 是 0 的新裝備不印那個 0——starter 裝每一件都是 0）畫在格子右下角。名字、描述與圖示不在
線路上：`0x0B` 只有 id 與數量，所以頁面向 `GET /api/item/<id>` 與
`GET /api/item/<id>/icon.png` 問，伺服器讀的是同一份 `Data.wz`（ADR-037）。查不到就只印 id——
不猜名字。

## 畫面上有什麼

畫面就是 2003 client 的 **800×600** 視野（`#view` 的內部尺寸固定，CSS 只把它等比放大、置中，
`image-rendering: pixelated`）。所有圖片都是伺服器直接從 `Data.wz` 解出來的 PNG，頁面不做任何
「用色塊代表角色」的替代。

| 元素 | 來源 | 誠實說明 |
|---|---|---|
| 背景（Back） | `GET /api/map/<id>/art` 的 `backs[]` ＋ `/api/png/<path>` | 依 WZ 的 `bS/no/x/y/rx/ry/type/cx/cy/a` 畫；`type` 1／3／4／6 橫向鋪、2／3／5／7 縱向鋪，`rx/ry` 是視差百分比，`cx/cy` 覆寫鋪貼間距 |
| 圖塊與物件（Tile／Obj） | 同上 `sprites[]` | 每一筆都有 `layer`（0–7）、`z`、`flip` 與動畫 `frames[]`；角色畫在 layer 0–2 之後、layer 3 之前（`CHARACTER_LAYER`） |
| 傳送門 | `MapHelper.img/portal/game/pv` 的動畫 | 只畫 `pt == 2` 的可見傳送門（`pt == 0` 是出生點、`pt == 1` 是隱藏通道，原版都不畫） |
| 選角畫面 | `/api/avatar.png?face&hair&items&stance=stand1&frame=0` | 每個角色列都放上他自己的站立幀（`0x02` 的角色清單已帶 face／hair／worn ids），不是文字佔位 |
| 一張圖的尺寸與原點 | `/api/canvas/<archive path>` | 沒有 frame 表的圖（掉落的金幣堆 `Item/Special/0900.img/0900000X/iconRaw/N`）需要 `width/height/ox/oy`，PNG 本身帶不了 |
| 自己與其他玩家 | `/api/avatar.png?face&hair&items&stance&frame&flip` | 伺服器用 `Character/*` 的 canvas 依**身體的錨點**（`navel`／`neck`／`hand`／`brow`）組出一張 PNG，回傳的 `x-frame-dx`／`x-frame-dy` 是它相對腳底的位置 |
| 怪物 | `/api/mob/<id>` ＋ `/api/png/<path>` | `move`／`stand`／`hit` 動作表，延遲是 WZ 的 `delay`；朝向來自 `0x2F`／`0x30`（`facing` 0＝右、1＝左） |
| NPC | `/api/npc/<id>` ＋ `/api/png/<path>` | 站著不動（`0x3B` 的走動沒有畫）；朝向是地圖 `life/f` |
| 名字與表情 | `0x16`／`0x1C`／`0x27` | 名字是白字黑邊；表情就是**臉**——`0x27` 的值換成 `Face/<id>.img` 的九個表情資料夾之一（`/api/avatar.png?...&emotion=smile`），跟 2003 client 一樣按下去先換自己的臉再送封包 |
| 狀態列（HP／MP／EXP） | `UI/StatusBar.img` 的 `base/0`／`base/1`／`base/2` 與 `gauge/hp|mp|exp`（`/api/png`） | 完全是 2003 client 的版面：`CUIStatusBar` 是 (0,392) 的 800×208 視窗，左邊 243×208 面板、下面 446×27 聊天列、右邊 111×136 鍵盤圖；儀表是 1 px 條帶拉到 `163 × value / max`（`sub_4FA5E0`）。等級／職業／名字依 `sub_4FA170` 的 (54,116)／右對齊 136／(153,111) 畫。數字本身來自伺服器的 `self` 事件（`hp/maxHp/mp/maxMp/exp/expToNext`） |
| 聊天 | `0x1A` sub-op `0x12` | 場地聊天與**收到的密語**是同一包，所以畫面上長得一樣（線路上就是分不出來）；輸入框是 `base/1` 的白框上的一個透明 `<input>`，靠 `#game-ui` 跟畫布一起縮放 |
| 商店視窗（點 NPC） | `0x4A` 的列（價格來自 `info/price`）＋`/api/item/<id>` 的名字與圖示 | 買成功時是 `0x4B`＋`0x0B`＋`0x0D`；賣出沒有控制項 |
| NPC 對話框 | `0x47` 的 `say` 台詞（`info/speak` 原文） | 「確定」送 `0x15` answer 1（下一句），「關閉」送 0（結束） |
| 背包視窗（`I`） | `UI/UIWindow.img/Item/backgrnd` ＋ `activeIcon` ＋ 每個 `0x0B` | 視窗、格子、分頁與 meso 欄都是原版圖；分頁用同一張圖的亮起／平常版本蓋上去，標籤依 `sub_4DA440` 的表。數量是線路的；名字／描述／圖示是 `/api/item/<id>` 從 `Data.wz` 讀的（ADR-037） |
| 右上「日誌」 | 所有事件 | 沒實作的封包會以 `unhandled packet 0x..` 出現 |

### 畫圖用到的端點

| 端點 | 回什麼 |
|---|---|
| `GET /api/map/<id>/art` | `{ backs[], sprites[], bounds, portalFrames[], missingTiles, missingTileSets[] }`。`backs[]` 是 `{path,ox,oy,x,y,rx,ry,type,cx,cy,a,front,flip}`；`sprites[]` 是 `{kind,x,y,z,layer,flip,frames[{path,delay,ox,oy}]}`，已照 `30000*layer - 10*zM + z` 排好；`bounds` 是相機可以顯示的矩形 |
| `GET /api/png/<path>` | 一張 WZ canvas 的 PNG。`<path>` 是 `Map/…`、`Character/…`、`Mob/…`、`Npc/…`、`Effect/…`、`Item/…`、`UI/…` 其中之一，整個路徑 URL-encode 成一段；`..` 與其他檔案一律 404 |
| `GET /api/avatar.png?face&hair&items&stance&frame&flip&emotion` | 組好的一張角色 PNG；`x-frame-dx`／`x-frame-dy` 標頭是它左上角相對腳底的位置（頁面只加這兩個值） |
| `GET /api/npc/<id>`、`GET /api/mob/<id>` | `{templateId, actions}`，`actions` 是 `move`／`stand`／`hit` 各自的 `frames[]`；WZ 沒有的模板是 404 |

`missingTiles` 是「這張圖放了、但這份 `Data.wz` 裡沒有的圖塊」數量：這個 repo 的 `Data.wz` 是
**子集**，`Map/Tile` 只有 9 組（`brownBrick`／`coalMine`／`deepCave`／`dirtMine`／`holeBrick`／
`logMarble`／`wetWood`／`whiteMarble`／`woodMarble`），所以用 `grassySoil`／`dryRock`／`darkWood`
鋪地的圖（例如 암허스트서쪽필드 `1000000`）沒有地面 canvas 可畫。頁面在這種圖上改畫**腳踏點**的土
 platform（沒有「乾脆不畫」的選項——畫天空比畫土更誤導），並在日誌印一行缺哪幾組；`backs` 與
`obj` 照常畫。

這些端點都只**讀** `Data.wz`；`--data` 沒給就沒有圖，頁面記一行 `no art` 並只畫幾何（`/api/map/<id>`
仍然可用）。

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
| 點 NPC | `{t:"click",objectId}` | c2s `0x33` → 先 `0x19`，再 `0x4A`（商店）或 `0x47`（台詞） |
| 買東西 | `{t:"shop",action:"buy",row,itemId,count}` | c2s `0x16` → `0x4B`（結果）＋`0x0B`（格子）＋`0x0D`（mesos） |
| 關商店 | `{t:"shop",action:"close"}` | c2s `0x16` 的 close → **不回包**（2003 client 的 close 不 arm flag） |
| 回答對話 | `{t:"talk",answer}` | c2s `0x15`（answer 1＝下一句、0＝結束） |
| 用消耗品（雙擊） | `{t:"use",slot,itemId}` | c2s `0x18`（203 家族 `0x19`）→ s2c `0x0B`（少一瓶）＋`0x0D`（HP／MP 動了）；被拒絕時是空 `0x0B` |
| 揮擊（Ctrl） | `{t:"attack",mobId,facingLeft}` | c2s `0x1B` → s2c `0x34`（怪的 stat）／`0x30`（倒下動畫）／`0x31`（屍體消失），傷害數字在送的人自己的封包裡 |
| 升級特效（別人的） | — | s2c `0x29` |

## JSON 協定（我們的設計，不是證據）

伺服器 → 頁面的每一則訊息都是 `{ "t": <kind>, ... }`，`kind` 就是
`server/src/client/session.ts` 的 `ClientEvent["kind"]`：

```
field        { mapId, self, users[], mobs[], npcs[] }     ← 0x16 的快照
self         { self }                                     ← 0x0D 之後的完整狀態
inventory    { worn[], wornCash[], tabs[4] }              ← 0x16 之後一則，此後每個 0x0B 一則
shop-open    { shop: { shopId, items[] } }                ← 0x4A（價格與 maxCount 都是伺服器的）
shop-result  { code, message }                            ← 0x4B（0＝silent，成功）
npc-say      { npcId, message }                           ← 0x47 的 say（台詞來自 info/speak）
user-enter   { user }        user-leave { characterId }
user-move    { characterId, x, y, action, foothold }
user-emotion { characterId, emotion }
chat         { name, text }                              ← 0x1A/0x12（場地聊天與收到的密語同一包）
whisper-answer { name, delivered }                        ← 0x1A/0x0A（送的人收到的回覆；沒有文字）
find-answer  { name, mapId }                              ← 0x1A/0x09（mapId -1 ＝ 找不到）
level-up     { characterId }
mob-enter    { mob }         mob-move { mobId, x, y }
mob-die      { mobId }                                   ← 0x30 的正延遲：屍體演動畫，0x31 才移除
mob-leave    { mobId }
user-attack  { characterId, facingLeft, targets[] }       ← 0x23（別人的揮擊，含他們骰的數字）
drop-enter   { drop }                                    ← 0x43（money/value/x/y/mobId）
drop-leave   { dropId, reason, characterId? }             ← 0x44（taken 時 page 把圖示飛向那個人）
hit          { mobId, damage }                            ← 橋自己回的：這一下的數字（線路上沒有）
npc-enter    { npc }         npc-leave { npcId }
unknown      { opcode, bytes }                            ← 這個殼沒讀的封包
created      { ok, name, id?, reason? }                    ← 建立角色（0x05）的結果
disconnect   { reason }
error        { message }
```

頁面 → 伺服器只有十五種：`login`／`world`／`character`／`create`／`say`／`move`／`portal`／`emotion`／
`whisper`／`find`／`use`／`click`／`shop`／`talk`／`attack`（上表）。

## 文字編碼（CP949，不是 UTF-8）

2003 client 的每一個字串都是 **CP949** 位元組（`protocol/cp949.ts`）：它把 bytes 直接交給 Windows
的 ANSI renderer，沒有碼頁轉換。所以這一條線上的中文（繁中）**送不出去**——`encodeCp949` 會拋
`U+XXXX is not a CP949 character`，橋把它當 `error` 回給頁面，頁面在聊天框印出來（遊戲中 `#status`
是藏起來的，錯誤另外進聊天框）。韓文與 ASCII 都正常。

收到的字也要用 CP949 解。這一刀之前 `ClientSession` 用 UTF-8 解 `0x1A` 的文字：ASCII 看起來沒問題，
`안녕`（CP949 `be c8 b3 e7`）卻會變成 `�ȳ�` 這種亂碼（`U+FFFD U+0233 U+FFFD`）——現在用的是
`decodeCp949`，測試裡有一句真的韓文密語釘住它。

## 刻意沒有的東西

- **怪物 AI 與怪物打你**：2003 client 自己跑怪的 AI（FINDINGS §4.20／ADR-008），頁面只畫伺服器
  送來的 `0x30`／`0x31`，怪不會主動攻擊、玩家不會掉血。衝擊（`0x1C`）與死亡／復活是伺服器側
  已有的路徑（ADR-021），頁面沒有接。
- **技能的傷害公式**：`0x1B` 的數字是頁面骰的（ADR-040）：`(主屬*4+副屬)*watk/100`、下限十分之一，
  mastery／防禦／暴擊都不建模。這是選擇，不是證據。
- **密語的「對方是不是在密你」**：線路上分不出來——送達的密語就是 `0x1A` 的 `0x12`，跟場地聊天同一包
  （FINDINGS 4.31）。頁面照實顯示，不假裝知道。
- **賣出／交易／組隊／郵件**：伺服器都有（`0x16` 的 sell、`0x25`／`0x26`／`0x24`），頁面沒有介面；
  它們的封包測試在 `test/shops.test.ts`、`test/miniroom.test.ts`、`test/party.test.ts`、
  `test/messenger.test.ts`。商店**買**已經有了，賣只差一個「從哪一格、幾個」的控制項。
- **背包的拖放與裝備**：面板只**看**背包（與雙擊用消耗品）。拖放是 `0x17`、穿戴是它的負 slot
  目的地，頁面還沒接——所以 worn 欄只會在伺服器送負 slot 時才有東西。
- **卷軸（204）**：`0x1A` 需要點一件裝備當目標，面板沒有拖放就沒有目標，頁面不送它。
- **小地圖／天氣／霧**：`Map/MapHelper.img` 的 `mark`、`weather` 讀得到，但頁面還沒有小地圖與天氣層。
- **角色動作**：`stand1`／`walk1` 之外多了 `swingO1..3`（Ctrl 揮擊，缺圖退回 `stand1`）；跳躍、繩索
  與坐下還沒有——移動是直線步進，沒有物理。
- **這份 `Data.wz` 沒有的圖塊組**：`Map/Tile` 只有 9 組，`grassySoil`／`dryRock`／`darkWood` 不在裡面；
  用到它們的地圖沒有地面，頁面改畫腳踏點的土 platform（見上面 `missingTiles`）。這是資料的缺口，
  不是繪圖的近似。
- **實體碰撞**：走過去不會撞牆、不會掉下去，位置由瀏覽器自己算。傳送門是**用點的**（見下），
  不是走上去觸發——那正好是 2003 client 自己的 `0x0D` 觸發方式（ADR-035）。

## 測試

```sh
cd server
node --test test/websocket.test.ts test/webclient.test.ts
```

`websocket.test.ts`（9 則）釘住 RFC 6455 的三件事：`Sec-WebSocket-Accept` 的官方向量、client 訊框
一定要遮罩、server 訊框一定不遮罩。（第 9 則是「半關閉」：升級後的 socket 是 `allowHalfOpen`，瀏覽器被硬關只會送 FIN，
所以 `end` 也必須當成關閉，否則帳號的座位永遠不會放掉。）
`webclient.test.ts`（12 則）用 Node 內建的 `WebSocket` 當瀏覽器，
對**真的** `LoginServer`／`GameEntryServer` 走完登入→選角→進圖→說話→走路，外加靜態檔、
`/api/map/<id>` 與 `..` 的拒絕、一個空帳號用 `0x06`＋`0x05` 建立第一個角色再進去玩，以及點一扇門
換到另一張圖再走回來，一張臉、一通韓文密語（CP949 來回）、一次找不到人的密語與兩種 `/f` 答案，
背包（`inventory` 事件的形狀、`/api/item` 的三種答案、一次雙擊把 3 瓶喝成 2 瓶且 HP 20→50），
以及商店（點 NPC → `0x4A`、買 2 個 → `0x4B`＋`0x0B`＋`0x0D`、close 不回包）與 NPC 對話（`0x47` 的
兩句台詞用 `0x15` 走完）。

另外還有一支**對真的伺服器**跑的畫面探針：`node server/scripts/frame_probe.mjs 8495`。它把
`client/main.js` 放進一個 DOM shim（元素、會算次數的 2D context、會 `onload` 的 `Image`、Node 的
`WebSocket`）裡真的登入、選角、進圖，再跑真的 `requestAnimationFrame`；它斷言背景、圖塊／物件、
NPC 與角色的 avatar 都在**同一幀**被畫出來（헤네시스：3 幀 4118 次 `drawImage`、152 個不同來源）。
它不取代眼睛，但它釘住「資料到得了畫面」這一段；同一支探針還會把兩筆 `0x43`（一件道具、
一堆金幣）注入頁面，確認掉落的 `iconRaw`／`Item/Special/0900.img` 真的被畫出來。

還有一支**不用瀏覽器**的實機走查：`node server/scripts/play_probe.mjs 8495`——直接走瀏覽器協定
登入、從 헤네시스 過 `west00` 進獵場、Ctrl 式揮擊打到怪死、走到掉落物上等撿起，把每一步收到的
訊息（`hit`／`mob-die`／`drop-enter`／`drop-leave` taken／`loot`／`inventory`）印出來。

頁面的**繪圖**本身仍然只有眼睛能驗，但把它切開的那幾層有測試：`test/art.test.ts`（17 則）釘住
compositor 的原點／鏡射／alpha、UOL 解析與快取、`30000*layer-10*zM` 的深度、背景的 origin 與
「缺 canvas 就跳過」、`Character/*` 的槽位對應、avatar 的錨點合成（用真的 `Data.wz` 驗尺寸與
`dx/dy`），以及 NPC／mob 的圖檔名與 frame 表；`test/webclient.test.ts` 另外對**真的** HTTP 伺服器
驗 `/api/map/<id>/art`、`/api/png`（含 `..` 的拒絕）、`/api/avatar.png` 的標頭、`/api/npc`、`/api/mob`。

## 預覽環境

`serve` 的三個 port 都是參數，但只有 `--web-port` 那個會出現在預覽網址裡，所以本專案的預覽跑法固定是
**頁面 8495、login 8496、game 8497**；`https://8495-<sandbox>.e2b.app/` 就是頁面。把 login 放在
8495 的話，預覽只會拿到一段 2003 的位元組（瀏覽器把它當成壞掉的 HTTP），看起來就是「Sandbox not
found」之外的另一種空白。

**已實測**（2026-10-17，真的瀏覽器，不是 Node 的 `WebSocket`）：預覽 proxy 會轉發 `wss` 的 upgrade。
同一個分頁裡走完 登入（`admin`）→ 建立角色（`chui`，`0x06`＋`0x05`）→ 選角（`Hero`）→ 進地圖
（헤네시스 `100000000`）→ 送出一句聊天，伺服器日誌逐包對得上。所以「代理不轉發 upgrade」的備案
（HTTP 輪詢）**不需要**。
