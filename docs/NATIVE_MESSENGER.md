# 메신저（三人對話房）：原生視窗、封包與瀏覽器鏈（ADR-095）

本文件是メ신저鏈的**原證總表**：每個座標、字串與閘門都來自 `MapleStory.exe`（PE／`.exe.c`／`.lst`）
或 `Data.wz`，並標明瀏覽器／伺服器如何對應。協定欄位本身見
[FINDINGS §4.41](protocol/FINDINGS.md)（c2s `0x24`、s2c `0x4D`–`0x4F`，ADR-033 伺服器半邊）；
本文件的視窗半邊是 ADR-095 讀出的 `CUIMessenger`。瀏覽器模型在 `client/messenger-state.ts`、
繪製與 hit 在 `client/messenger-window.ts`、捲軸共用 `client/vscroll.ts`（ADR-094 自交易抽出）。

## 1. 分派與開窗的兩條路

`sub_4E18D0`（s2c `0x4D`／`0x4E`／`0x4F` 的共同入口）先讀 `u8 type`：

| type | 處理 |
|---|---|
| 0 | `sub_4DF1D0`：填一格成員（`u8 slot`＋`sub_4DF3E0` 讀紀錄），`announce` 加印入場行 |
| 1 | 進房失敗：印 `- 초청 받은 대화방에 참가하지 못했습니다` |
| 2 | `sub_4DF8B0`：清一格（名字取自該格，先印退場行再清）|
| 3 | `sub_4E1BB0`：邀請——**視窗開著只印一行；關著才彈模態**（見 §4）|
| 4 | `sub_4E19A0`：邀請結果（`str name`＋`u8 ok`；ok=1 送達、0 查無此人）|
| 5 | `sub_4E1E30`：聊天行——**無 `" : "` 分隔＝typing 旗標行**，不印（見 §5）|
| 6 | `sub_4E2170`：原位更新一格（見 §5b）——只有 `slot < 3` 且**該格已有人**才套用 |
| 7 | `sub_4E2280`：整份名冊，**固定三格**、每格一個 marker byte（見 §5b）|

視窗**關著**時（`sub_4E18D0` 的 gate）：只有 type 3（邀請）照樣處理，0/1/2/4/5/6/7 全丟棄；
未知 type 忽略。

開窗只有兩條路，都落到 `sub_4DDF10(roomId)`：

1. **狀態列 BtChat**：`sub_4F6B70` 建 `CCtrlButton(parent, 1004, 2, 65, 91, 38, 17, "UI/StatusBar.img/BtChat")`
   （狀態列原點 y=392 → 頁面 (65,483)、38×17）；`sub_4F88C0` case 1004 → `sub_4DDF10(0)`＝開新房。
2. **邀請模態的「是」**：`sub_4DDF10(roomId)`，roomId 是 `0x4D type 3` 帶來的 u32。

`sub_4DDF10` → `sub_4DDAF0` 建 `CUIMessenger`：`this_8 == nullptr` 才 HeapAlloc（已開著＝no-op，
BtChat 連點不會開兩扇）。建窗即印五行說明（`sub_4DDFE0` 在送 `0x24 type 0` **之前**印），
之後才送 enter 包、由 type 0 回包逐格填人。關窗（`sub_4DE280`）送 `0x24 type 2` leave。

## 2. 視窗本體：CUIMessenger 幾何

窗 297×335，home (500,50)（`sub_43D750` 的 uiWndX5/uiWndY5）。底圖
`UI/UIWindow.img/Messenger/backgrnd`＋`charView`（(200,13)、97×322，成員欄背景）。
`sub_4E0FF0` 的控制項（窗內座標）：

| id | 控制項 | 矩形 | art／行為 |
|---|---|---|---|
| 1000 | 關閉鈕 | (152,9,26,26) | `UI/UIWindow.img/BtUIClose` 三態；按下→`sub_4DE280` |
| 1001 | 輸入框 `CCtrlEdit` | (11,286,176,12) | 上限 256 字；Enter→`sub_4DE490` |
| 1002 | 捲軸 `CCtrlScrollBar` | `Create(parent,1002,1,0,179,58,218,0)` | `+44 = 172`（列內容寬提示；**append 折行實際用 170**，見下）；同 ADR-094 的交易捲軸（travel 218−2×12−12=182）|

- **log 繪製**（`sub_4E1320`）：自 `pos` 繪 16 列，x=10、y=63+13k（굴림）。
- **log append**（`sub_4DEE50`，本輪完整讀出）：文字經 `sub_439A70` 以**寬 170**（`n170 = 170`）
  折成多行逐行 push 進 `this[20]` 的 ZList；**接續行前置 `"    "` 四空白**（`asc_5BC328`）。
  ZList **沒有上限**——只增不刪（瀏覽器舊的 128 行 ring 已移除）。append 後：
  follow 條件＝`pos >= count−16`（unsigned 比較，count<16 時恆 false）**或** append 後 count==16，
  然後 `sub_452130(scrollbar, count−15)`＝SetMax；follow 成立才 `sub_452110(scrollbar, max−1)`
  ＝SetPos 釘底——與交易 log（`sub_4D5900`）同款法則，共用 `client/vscroll.ts`。
- **成員欄**（`sub_4DFB50`）：腳底 y=103+98×slot、avatar 置中於 charView 欄（x=248）、
  名字白字 (202,105+98×slot)。自己坐右邊（🟡：slot 順序以伺服器 type 0 為準）。
  **頭像是活的 Shape2D 子窗**：紀錄 `v9[1]` 經 `sub_434120`＋`"Shape2D#Vector2D"` 建立、
  `sub_424410/424590` 移到格位、`sub_4245E0` 顯示，`sub_4DEAF0`（OnTimer，vftable[0]）每 30ms
  tick 它——**原版메신저頭像會播站立動畫**（`v9[3]` 的 sprite COM 才是 tint 目標）。瀏覽器以
  `member.since` 各自的時鐘驅動 `avatarMotionCatalog` 的 stand frames 還原；交易窗頭像**不動**
  （004Dxxxx 全範圍沒有一個 `sub_421E00`/`sub_4739B0` caller，`sub_482340` 只解析線格式）。
- **typing 列**（`sub_4E14E0`）：(11,316)，`名字[,名字…] 님이 입력중입니다`（色 #336699 近似原證）。

## 3. PE 內逐字讀出的字串

自二進位 `.data`（VA→檔案偏移）直接读出、cp949 解碼（listing 的 db 偽行不可靠）：

| 字串 | PE 位置 | 用途 |
|---|---|---|
| `[ Maple Messenger 도움말 ]`＋分隔線＋`초대 : /초대 캐릭터이름`＋`종료 : /q`＋分隔線 | help 區塊 | 開窗即印的五行 |
| `- '%s'님이 입장하셨습니다` | aSI_0 | type 0 announce |
| `- '%s'님이 퇴장하셨습니다` | 字串區 | type 2 |
| `- 초청 받은 대화방에 참가하지 못했습니다` | 字串區 | type 1 |
| `- '%s'님에게 초청 메시지를 보냈습니다`／`- '%s'님을 찾지 못했습니다` | 字串區 | type 4 ok=1／0 |
| `- 다른 캐릭터의 이름을 입력하세요.` | 字串區 | `/초대` 名字空／邀自己 |
| `- '%s'님께서 대화방 초청 메시지를 보냈습니다` | @5BC87C（`sub_4E1BB0` push aS_8/aSE_0，004E1C44／004E1CCE）| 邀請到達、視窗**已開**：只印一行 |
| `'%s'님께서 대화방\r\n 초청 메시지를 보냈습니다\r\n초청에 응하시겠습니까?` | @5BC834 | 邀請到達、視窗**已關**：模態 |
| ` 님이 입력중입니다` | aI_13 | typing 列後綴 |

## 4. 邀請與 CConfig 閘門

`sub_4E1BB0` 唯一讀 `CConfig+28`（goMessenger，SystemMenu 第三格「메신저 초대」）的地方：
開著才顯示邀請（模態或印行）。模態只有「是」——**沒有拒絕封包**；不理它，伺服器的
`MESSENGER_INVITE_TTL_MS = 60s` 自然過期（FINDINGS §4.41.4）。「是」→ `sub_4DDF10(roomId)`。

## 5. 送出側：`0x24` 的四個 type

| type | 原函數 | 內容 |
|---|---|---|
| 0 | `sub_4DDFE0` | `u32 roomId`（0＝開新房；邀請的「是」＝回送帶來的那個 id）|
| 2 | `sub_4DE280` | 無 body（關窗／`/q`）|
| 3 | `sub_4E24B0` | `str name`——`/초대 <名字>` 只送名字；空名或自己＝印 otherName 列不送 |
| 5 | `sub_4DE490` | `str line`——**client 自己組好** `自己名字 + " : " + 文字`，先印在自己 log 才送 |

**typing**（`sub_4DEAF0`／`sub_4E1E30`）：每 3000ms 檢查（`+96` countdown −30/tick、reset 3000；
`+92` sent flag）——輸入框非空且未送過 → type 5 送 `名字+"1"`；清空且送過 → `名字+"0"`。
**沒有 `" : "` 分隔**，所以收端切最後一個字元當旗標：`flag = (right(line,1) != "0")`
（`sub_416B00` 比對——**任何非 `"0"` 字元都算 typing**），按名字比對成員後
`vtable+232(avatar COM, flag ? 0xCFFFFFFF : 0)`＋重畫＋印 typing 列，不印成聊天行。
**含 `" : "` 的聊天行也會清掉發言者的 tint**：同一個成員迴圈以 flag=0 先跑
（`vtable+232(avatar, 0)`）才 `sub_4DEE50` append。伺服器（`loginserver.ts` `sayInMessenger`）
對無分隔行只重蓋前綴（防偽造他人名字）原樣轉發。

**`vtable+232` ＝ ARGB modulate，alpha=0 是 identity**：建構時 `sub_427BB0` 餵的就是
`0x00FFFFFF` 而頭像正常顯示（alpha 0＝不影響）；CharSelect（`sub_42E210`）交叉證明 alpha byte
就是不透明度——選中 `0xFFFFFFFF`、未選中 `0x80FFFFFF`（可見 50% 變暗）。所以 typing 的
`0xCFFFFFFF`＝RGB 不變、**alpha 0xCC＝204/255≈80% 不透明**；實作本體在 Gr2D DLL
（EXE 內無 slot-232 vtable，前輪已掃描證明）。瀏覽器 `ctx.globalAlpha = 204/255`
（舊的 0.35 是未解碼前的近似，已按原證更正）。

## 5b. type 6／7：本輪讀出的原位更新與整份名冊

| type | 原函數 | 線格式 | 行為 |
|---|---|---|---|
| 6 | `sub_4E2170` | `u8 slot`＋`u8 level`＋`u32 face`＋0 結尾 `u32` look 清單（**無名字、無 announce**）| `slot<3` 且該格已有人（name≠0）才套用：level/face/look 原位覆蓋、名字與 typing 旗標不動、不印任何行，`this[22]==1` 時重畫該格 |
| 7 | `sub_4E2280` | **固定三格**（`do…while (slot<3)`），每格 `u8 marker`：`0`＝清格；`1`＝原格不動；**其他**＝讀 `u8 level`＋`u32 face`＋look 清單＋`str name` 填入（announce=0，不印入場行）| 每格獨立套用；fill/clear 都把該格 typing 旗標放掉；全程靜默 |

早期筆記「type 7 是 0 結尾、讀到一半」是**錯的**——迴圈固定三次，`0` 是 clear marker。
codec（`server/src/protocol/messenger.ts`）本輪補上 `encodeMessengerCellUpdate`／
`encodeMessengerRoster`（`MESSENGER_ROSTER_MARKER` 0/1/2）與解碼器；伺服器遊戲邏輯目前沒有
發送來源（換裝廣播／重同步尚未接，🟡），但 client 端模型與 codec 已完整。

`/q`（大寫 `/Q` 亦同，ZString 比對）＝關窗；其他 `/…` 原證只有 `/초대`——未知指令不送不印
（🟡 靜默 no-op）。

## 6. 瀏覽器／伺服器的對應決策（🟡 = 有原證但取捨處）

- **模型／繪製分離**：`messengerState()` 是純狀態機（openLocal/closeLocal/receive/say/typingLine/
  answerInvite/dismissInvite），`messengerRenderer` 只畫；與交易（ADR-091/094）同架構。
- **DOM 輸入框**：`#messenger-say` 掛在 `#game-ui`（800×600 同步縮放層），隨窗移動、Enter 送、
  Escape blur——原生 `CCtrlEdit` 的瀏覽器等價（`isEditingControl` 既有守衛擋遊戲按鍵外洩）。
- **CP949 邊界**：`ClientSession` 收 `0x4D` 先 `decodeMessengerEvent`、送 `0x24` 先
  `byteStringOf`＝`encodeCp949`（`writeAsciiString` 只吃 byte string）——與 `0x50` 交易鏈同政策。
- **typing tint**：globalAlpha `204/255`（`0xCFFFFFFF` 的 ARGB modulate 語意，見 §5；舊 0.35 近似已廢）。
- **log 無上限**：`sub_4DEE50` 的 ZList 只增不刪——瀏覽器 128 行 cap 已移除；折行寬 **170**＋
  接續行四空白縮排（舊 172/無縮排是未讀 append 函數前的近似）。
- **頭像動畫**：`member.since` 各格時鐘＋`avatarMotionCatalog` stand frames（Shape2D 子窗每 30ms
  tick 的等價）；交易窗頭像靜止（原證：無 COM caller）。
- **捲軸 auto-repeat**：`client/vscroll.ts` 的 `tick()` 完整重現 `sub_4523D0`/`sub_4524C0`
  （50ms gate、同 zone 才續、thumb 永不重複）；`end()` 不補 page——原版 release 的 page 分支拿
  **press 時的 GetTickCount**（+60）跟 zone 比，`cmp [esi+3Ch], eax` 實際永不成立＝**原版死代碼**
  （`sub_4522B0` @0045230A 組譯確認）。交易／메신저／技能三窗共用。
- 🟡 `0x4E`／`0x4F` 同一 handler、封包無法分辨 → 只送 `0x4D`；type 6/7 codec 已完成但伺服器
  尚無發送來源（換裝廣播／名冊重同步未接）。
- 🟡 GM 的 `0x5A` messenger 指令在原版被 `app9` GM 旗標包住，玩家不可達 → 未實作。

## 7. 驗證

`server/test/messenger.test.ts`（codec＋registry，ADR-033；本輪加 type 6/7 round-trip＋hex＋
describe）、`messenger-state.test.ts`（模型全 transition＋slash 規則＋捲軸幾何；本輪加 flag≠"0"、
聊天行清發言者 tint、type 6 空格忽略／占格原位、type 7 三格靜默、無上限 log、since 時鐘）、
`vscroll.test.ts`（50ms gate、離開 zone 停、page 連翻、thumb 不重複、release 無動作、max≤1 inert）、
`native-messenger-session.test.ts`（0x4D→事件、0x24 四方法、CP949 邊界）、
`native-messenger-browser.test.ts`（Chromium：hit 矩形、40 行釘底 max=25／thumbTop=194、捲動重繪、
成員名與 typing 列像素差、**typing 頭像 204/255 像素差**、邀請模態「是」→roomId 42）。
