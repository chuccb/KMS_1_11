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
| 6／7 | 未讀；本伺服器不送（🟡，FINDINGS §4.41.5）|

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
| 1002 | 捲軸 `CCtrlScrollBar` | `Create(parent,1002,1,0,179,58,218,0)` | `+44 = 172`＝log 折行寬；同 ADR-094 的交易捲軸（travel 218−2×12−12=182）|

- **log**（`sub_4E1320`）：自 `pos` 繪 16 列，x=10、y=63+13k、折行寬 172；max=rows−15、
  append 時原本釘底才 follow（`sub_4D5900` 同款法則，共用 `client/vscroll.ts`）。
- **成員欄**（`sub_4DFB50`）：腳底 y=103+98×slot、avatar 置中於 charView 欄（x=248）、
  名字白字 (202,105+98×slot)。自己坐右邊（🟡：slot 順序以伺服器 type 0 為準）。
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

**typing**（`sub_4DEAF0`／`sub_4E1E30`）：每 3000ms 檢查（`+96` timer、`+92` flag）——輸入框
非空且未送過 → type 5 送 `名字+"1"`；清空且送過 → `名字+"0"`。**沒有 `" : "` 分隔**，所以收端
切最後一個字元當旗標、按名字比對成員，只更新 typing 狀態（頭像蓋 `0x0CFFFFFF` 幽靈色＋印
typing 列），不印成聊天行。伺服器（`loginserver.ts` `sayInMessenger`）對無分隔行只重蓋前綴
（防偽造他人名字）原樣轉發。

`/q`（大寫 `/Q` 亦同，ZString 比對）＝關窗；其他 `/…` 原證只有 `/초대`——未知指令不送不印
（🟡 靜默 no-op）。

## 6. 瀏覽器／伺服器的對應決策（🟡 = 有原證但取捨處）

- **模型／繪製分離**：`messengerState()` 是純狀態機（openLocal/closeLocal/receive/say/typingLine/
  answerInvite/dismissInvite），`messengerRenderer` 只畫；與交易（ADR-091/094）同架構。
- **DOM 輸入框**：`#messenger-say` 掛在 `#game-ui`（800×600 同步縮放層），隨窗移動、Enter 送、
  Escape blur——原生 `CCtrlEdit` 的瀏覽器等價（`isEditingControl` 既有守衛擋遊戲按鍵外洩）。
- **CP949 邊界**：`ClientSession` 收 `0x4D` 先 `decodeMessengerEvent`、送 `0x24` 先
  `byteStringOf`＝`encodeCp949`（`writeAsciiString` 只吃 byte string）——與 `0x50` 交易鏈同政策。
- 🟡 typing 頭像以 globalAlpha 0.35 淡化近似 `0x0CFFFFFF` 叠加 tint。
- 🟡 瀏覽器 log 上限 128 行（原版 ring 大小未讀出）。
- 🟡 `0x4E`／`0x4F` 同一 handler、封包無法分辨 → 只送 `0x4D`；type 6/7 不送。
- 🟡 GM 的 `0x5A` messenger 指令在原版被 `app9` GM 旗標包住，玩家不可達 → 未實作。
- 🟡 按住箭頭／頁面的 auto-repeat（`sub_4523D0`）不重現——與 ADR-094 交易捲軸同政策。

## 7. 驗證

`server/test/messenger.test.ts`（codec＋registry，ADR-033）、`messenger-state.test.ts`（模型全
transition＋slash 規則＋捲軸幾何）、`native-messenger-session.test.ts`（0x4D→事件、0x24 四方法、
CP949 邊界）、`native-messenger-browser.test.ts`（Chromium：hit 矩形、40 行釘底 max=25／
thumbTop=194、捲動重繪、成員名與 typing 列像素差、邀請模態「是」→roomId 42）。
