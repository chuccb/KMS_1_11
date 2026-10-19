# 1:1 교환（交易房）：原生視窗、封包與瀏覽器鏈（ADR-091）

本文件是交易鏈的**原證總表**：每個座標、字串與閘門都來自 `MapleStory.exe`（PE／`.exe.c`／`.lst`）
或 `Data.wz`，並標明瀏覽器／伺服器如何對應。協定欄位本身見
[FINDINGS §4.39／§4.40](protocol/FINDINGS.md)；伺服器規則在 `server/src/game/trades.ts`（ADR-032）。

## 1. 分派與「沒有視窗時」的法則

`sub_4815E0`（s2c `0x50` 的總入口）先讀 `u8 type`，再分兩支：

| 條件 | type | 處理 |
|---|---|---|
| `this_15 != 0`（已有 CMiniRoomBaseDlg）| 3／6 | `sub_481E00`／`sub_481EB0`：加／換成員（格已佔用＝`AVCDisconnectException`）|
| | 5 | vtable+15 → `sub_4D3BD0`：訊息進 log |
| | 7 | vtable+16 → `nullsub_58`：**no-op**（`MINIROOM_RESULT_TYPE.ready`）|
| | 8 | vtable+17 → `sub_4D3D70`：結束.box（1／3／4）|
| | 其他（11/12/13）| vtable+18 → `sub_4D3360` → `sub_4D3950`／`sub_4D3B30`／`sub_4D3BB0` |
| `this_15 == 0` | 1 | `sub_481910`：邀請.box |
| | 2 | `sub_481B20`：拒絕.box |
| | 4 | `sub_481790`：進房（建視窗）|
| | 其他 | **`AVCDisconnectException`(553648131)**｜原廠即斷線 |

`sub_481790`：`this_15 != 0` → 斷線；`roomKind == 0` → 「방에 들어갈 수 없습니다.」；
`sub_481570(kind)` 只認 `kind == 1`（否則 nullptr → 斷線）；隨後 `sub_481D00` 讀
`u8 count`、`u8 myIndex`、循環 `u8 index`（`>= 0x80` 結束）＋ `sub_482340` 解成員，
計數不符＝`ZException(38)`。成員陣列在 `this+25`（8 格×8 bytes：`+0` 名字 ZString、`+4` avatar），
名字寬字串另存 `this+41+index`；`this+22/23/24` = myIndex／count／已加人數（`sub_4812D0`）。

## 2. 視窗本體：CTradingRoomDlg

- 配置 `sub_4D2DB0`：base `sub_4812D0`；`sub_461C50(this,"UI",0)` 載 `Trade/backgrnd`
  （367×295）並**置中** `((800-w)>>1, (600-h)>>1)` → **(216,152)**（同 `CShopDlg` 規則）；
  兩側各配 8 格（`0x84` bytes vector，每格 16 bytes：`[1]` item、`[2]` icon、`[3]` 庫存 slot(-1 空)）。
- 鏡像欄位：`this+65`／`this+66` = 側 0／側 1 的格子 vector；`this+67`／`this+68` = 兩側 mesos；
  `this+63` = 我自己的 lock（`sub_4D61F0` 設 1）；`this+64` = 收到的 lock（`sub_4D3BB0` 設 1）；
  `this+69` = drag icon（`sub_4FFE30`）；`this+60/61/62` = 三個 Gulim font。
- 控制項 `sub_4D3EF0`（id→座標，皆 WZ 原圖）：

| id | 控制項 | 座標／尺寸 | 備註 |
|---|---|---|---|
| 1004 | CCtrlEdit | (96,248) 176×12，黑字 | **原生沒有任何讀寫**（只建不用）|
| 1001 | BtTrade `Trade/BtTrade` | (222,267) 50×23 | → `sub_4D61F0` |
| 1002 | BtCoin `Trade/BtCoin` | (285,275) 14×14 | → `sub_4D5F50` |
| 2 | BtUIClose | (319,9) | → vtable+44(2) → `sub_4D31F0` 送 type 7 |
| 1003 | CCtrlScrollBar | (262,21) 長 216，`+44=166` | log 的捲軸；通知 300..304 只重繪 |

- `Trade/BtLock`、`Trade/BtReset` 在 `Data.wz` 存在但 `.exe.c`／`.lst` **零引用**：這版沒有鎖／重設鈕。
- 指令分派 `sub_4D46C0`：1001→`sub_4D61F0`、1002→`sub_4D5F50`、1→vtable+44(1)（不送包）、
  2→vtable+44(2)（送 type 7）。

## 3. 繪製（`sub_4D4960` → `sub_4D5730`／`sub_4D5440`）

| 物件 | 位置（視窗座標）| 證據 |
|---|---|---|
| log 底色 | fill (92,21,182,217) `0x80000000`（50% 黑）| vtable+156 的 (x,y,w,h,argb) |
| 我的名字 | 置中 x=327, y=110 | `327 - width/2` |
| 對方名字 | 置中 x=44, y=110 | `44 - width/2`（`sub_4D52E0(1-myIndex)`）|
| 我的 mesos | 右齊 x=366, y=277（`"%d"` of `this[67]`）| |
| 對方 mesos | 右齊 x=84, y=277（`this[68]`）| |
| avatar | 我 (330,103) 鏡向中間；對方 (36,103) | `sub_4D33A0`／`sub_4D3730` |
| 格子 | 我 x=292/327、對方 x=11/46；列 y=129/164/199/234；32×32、pitch 35 | `sub_4D63C0` + backgrnd 像素 |
| 數量字 | 左齊錨點 (35c+291, 35r+148)＝格左上 (-1,+19)；逐位數、x 依位寬＋間距前進；裝備（`id/1000000==1`）不畫 | `sub_4D5440`＋`sub_525AE0` |
| lock wash | 我 (286,124,76,144)；對方 (4,124,76,144)，`0x80FFFFFF`（50% 白）| `this+63`／`this+64` |
| log 文字 | `for (y=26; y<234; y+=13)` 於 x=94、font=`this+61`、首列＝scrollbar 位置 `*(this[58]+48)` → 恰 **16 列** | `sub_4D5730` |
| scrollbar | `UI/Basic.img/VScr` 12×12 cells：prev@(262,21)、base 每 12px 舖滿 y=33..215、next@(262,225)、thumb@(262, 21+thumbTop)；按下／拖拉換 `prev1`/`next1`/`thumb1`；disabled（max≤1）用 `disabled/{prev,next,base}` | `sub_4D3EF0` id=1003 ＋ skills 視窗同款 |

顏色格式為 **ARGB**（對照 `0xffeaeff2` → `#eaeff2`，見 `client/utildialog.ts`）。
`sub_4D5900`（type 5）把文字以 4 個空格前綴、166 px 寬換行塞進 log（`asc_5BC328` = `"    "`）。
log 的 CCtrlScrollBar 全鏈已實作（`tradeLogScroller`，`client/trade-state.ts`）：`sub_4D5900` 的
follow-if-at-bottom（wasBottom＝`pos ≥ 舊max−1`，append 前判定）、`sub_452150` 的 clamp、
`sub_452500` 的五個 hit zone（thumbTop＝`12 + floor(pos×180/(max−1))`）、`sub_4525B0` 箭頭±1、
`sub_452600` 頁面±`max(floor(max/16),16)`、`sub_452670`/`sub_4526A0` thumb 拖拉
（`pos = startPos + (double)max×dy/180`，C 的 double→int 截斷＝`Math.trunc`，再 clamp）、
`sub_452340` 滾輪（自己 rect 內每格 ±1）。原生按住箭頭／頁面的 auto-repeat（`sub_4523D0`
OnTimer＋`sub_4524C0` 50ms gate、游標仍在同一 zone 才續、thumb／zone 100 排除）已於 ADR-096
以 `vscroll.tick()` 重現，draw loop 每幀餵游標；release（`sub_4522B0`）不補 page——原版該分支
拿 press 時的 GetTickCount（+60）跟 release zone 比（`cmp [esi+3Ch], eax` @0045230A），永不成立
＝**原版死代碼**，忠實不重現。

## 4. 玩家動作與原廠閘門

| 動作 | 函數 | 閘門（失敗＝靜默，除非另註）| 送包 |
|---|---|---|---|
| `/교환 <name>` | `sub_471A40` | GM → 「관리용 아이디는 1:1교환을 할 수 없습니다」；`this_15 != 0` → 「다른 작업중에는 1:1교환을 할 수 없습니다」；`sub_51D7D0` 同圖池找不到 → 「캐릭터를 찾을 수 없습니다」（三者都印在 chat）| `0x25 [0][1][u32 id]` |
| 選單交換신청 | `sub_5128B0` case 4 | 同上（直接呼叫 `sub_471A40`）| 同 |
| 受邀.box 的「예」| `sub_481910` | `CConfig goExchange != 0` 且非 GM（`(*(n3000+9)&1)==0`）才**顯示**；否＝整包忽略 | `0x25 [3][u32 inviterId]` |
| 受邀.box 的「아니오」| 同上 | — | **不送包**（原廠沒有拒絕包）|
| 拖道具進格 | `sub_4D5C80` | `this+63==0`、`this+24>1`、`n3000[6]==0`、local XOR>0、`timeGetTime()-n3000[7] >= 500`、`sub_4D63C0>0`（只能我自己的空格）| `0x25 [11][tab][u16 slot]([u16 count] if tab!=1)[u8 roomSlot]` |
| BtCoin | `sub_4D5F50` | 同上（無格條件）；輸入.box 「얼마를 올리시겠습니까?」初值／上限＝我的 mesos | `0x25 [12][u32]` |
| BtTrade | `sub_4D61F0` | 「정말로 교환하시겠습니까?」Yes → `this+63=1`、兩鈕 disable | `0x25 [13]` |
| 關窗 | `sub_4D31F0(2)` | — | `0x25 [7]` |

`sub_4D4550`（從交易格拖出）只啟動 drag／tooltip：**原廠沒有「取回」封包**，
東西只能靠取消或成交離開格子。

## 5. CConfig 的六個 go\* 開關（`sub_43D360`，`HKLM\SOFTWARE\Wizet\MapleStory`）

| dword（byte）| 登錄值 | 預設 | 這版的消費者 |
|---|---|---|---|
| +5 (0x14) | `goMiniMap` | 1 | 小地圖鈕（`sub_4E7030`／`sub_4E70A0` 切換）|
| +6 (0x18) | `goWhisper` | 1 | `sub_472910` case 9：為 0 時**不回顯**、改送 `0x23 [1][34][sender][me]` 自動回絕 |
| +7 (0x1C) | `goMessenger` | 1 | messenger 收包閘門 |
| +8 (0x20) | `goExchange` | 1 | `sub_481910` 邀請.box 閘門 |
| +9 (0x24) | `goParty` | 1 | party s2c case 3（邀請）閘門 |
| +10 (0x28) | `goGame` | 1 | **零引用** |

瀏覽器以 `client/gameoptions.ts` 保存同一族（`kms111.gameSettings`）；`exchange`（ADR-091）與
`party`（ADR-092：case 3 邀請**整包靜默忽略**、不回包，與原生同語意）都是真實消費者，
`whisper` 既有消費者不變。選項 UI 因此只停用 `messenger`（瀏覽器無 messenger 視窗）與
`game`（原版亦零引用）兩格。GM 位元（`(*(n3000+9)&1)`）瀏覽器沒有對應物（2003 login 未解出
admin byte），故該閘門在瀏覽器不可達、字串保留。

## 6. 瀏覽器／伺服器的對應決策（🟡 = 有原證但取捨處）

1. **我的半邊永遠在右**：avatar 規則（`sub_4D33A0`）與 drop 規則（`sub_4D5C80`）都如此；
   原生 `sub_4D4960`／`sub_4D5440` 把 packet index 0 硬畫在右，對 accepter(myIndex=1) 會鏡像錯位——
   瀏覽器兩席都依 avatar 規則（🟡，見 ADR-091）。
2. **lock 即時送達**：每次 confirm 都對**對方**送 `type 13`（含第二次），對方立刻亮 wash；
   成交時不再補送（`sub_4D3BB0` 語意）。
3. **500 ms throttle 與 lock/alone 閘門在 `ClientSession` 重做**（`client/trade-state.ts` 共用模型），
   瀏覽器等於原生「靜默不送」。
4. `/교환` 的名字由 session 的 field user pool 解析（同 `sub_51D7D0` 語意）；找不到＝原字串 feedback。
5. 能力旗標：bridge 的 field projection 帶 `trade: true`；舊 bridge 沒有 → 選單列與指令停用（fail-closed）。
   附接 LIVE 的舊原生 server 起於 2026-10-19 00:18，晚於交易路由（`f5d7924`, 10-17），故**可用**。
6. type 5 的 log、type 8 的三種.box、type 2 的兩種.box 都照原文；`ready`(7) 讀出但 no-op。
7. **type ≥6（🟡 不可達）**：`sub_4815E0` 把 ≥6 交給 `sub_481EB0`——那個位元組是**房間槽索引**：
   槽非空 → `AVCDisconnect(0x21000003)`；槽空 → 釋放舊指標、清槽、`sub_482340(idx, reader)`＋
   vtable+0x38（「開另一種房間」的入口，本版本的交易以外的房間）。本伺服器從不送 type 6，
   瀏覽器 codec 對未知 type 丟 `RangeError`——行為差異不可達。
8. **log scrollbar（ADR-094）**：paint 用 `UI/Basic.img/VScr` cells（EXE 的 paint 函數未能定位，
   vtable3 已倒；cell 名與幾何由 Create 鏈 `sub_451240` 的 COM art-height get 證明 arrowLen=12、
   `sub_4D3EF0` 證明 (262,21) len=216）；互動算式全部出自 `sub_452500`/`sub_4525B0`/`sub_452600`/
   `sub_452670`/`sub_4526A0`/`sub_4D5900` 的位元組證據；auto-repeat（`sub_4523D0`）ADR-096 補上。
