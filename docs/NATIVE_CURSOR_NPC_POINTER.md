# 原版游標、NPC 命中／名牌與滑鼠互動遺漏

> 現行尺寸／遠近／轉場與游標DPR政策已由ADR-084更新，見 [PIXEL_CAMERA](PIXEL_CAMERA.md)。
> 下文舊fit／native／降採樣、固定backing或CSS游標縮圖的敘述保留歷史時點，不是目前可用選項。

2026-10-18／ADR-060。**已編輯實作及回歸來源；未執行 test/check/typecheck/browser/VM/probe，沒有功能 PASS。**
本輪只閱讀原 EXE／C／listing／DLL、直接 dump WZ 素材與閱讀 diff；不以啟服取代驗證。
不 seed、不調整角色、能力、裝備、地圖或進度；沿用目前 save，停服後冷備份再重啟。

## 1. 游標：先確認是這一版，而不是套後期版本

| 來源 | 讀到的事實 | 實作 |
|---|---|---|
| `UI/Basic.img/Cursor` | 只有 `arrow`，24×23，origin=(0,0)，z=0；**沒有 hand／pressed／move 或多幀動畫** | 只使用這張箭頭；移除 Canvas 的 default/pointer/move 狀態切換 |
| EXE `553320`，listing `0055365A`／`00553751` | 載入 UI、Cursor、arrow，讀 origin，再走 `556D60`，保存於 CWvsApp+48 | `/api/canvas` 提供尺寸／熱點，`/api/png` 提供原圖；不另造 API 或手畫箭頭 |
| `Gr2D_DX8.dll` `10008430` | 建立 32×32、format21 hardware-cursor surface | 原圖放瀏覽器 cursor plane；**不是 RAF 畫在場景最上方的 sprite** |
| DLL `10008120` 與視窗訊息處理 | 安裝熱點及 surface，SetCursor(nullptr)，D3D ShowCursor(1)，mousemove 更新硬體位置 | CSS custom cursor，不攔截輸入，不因場景 FPS 或動畫載入而延遲更新位置 |

`client/cursor.mjs` 等 PNG 與 metadata 都到齊且尺寸相符後才標示 ready；失敗保留 OS 游標並記錄錯誤，不會 cursor:none。
CSS 覆蓋 `#view`、`#game-ui` 及暫行 NPC 對話面板的子控件，包含 disabled、輸入欄位、視窗拖曳區。
外部 toolbar、事件日誌與「非原版」體驗工具不換皮。對話面板換游標不表示其 HTML 版面已還原原 CScriptMan。

沿用 `viewLayout` 的 CSS scale，nearest-neighbour 只在載入／縮放時重建小 PNG，不每 mousemove／RAF 配置畫布。
DPR 不乘第二次，由瀏覽器／OS 的 cursor 處理；不修改 800×600 模擬或命中座標。
瀏覽器通常限制游標圖到 128×128：極大縮放時明確上限，並保留原 24×23 PNG、OS default 兩層 fallback。
這是 browser port，不聲稱重新建立了 D3D8 hardware surface，也不聲稱跨瀏覽器／OS 尺寸已確認一致。

## 2. NPC：命中框不是畫布框，更不是固定 72×104

- 原 `49CBF0` 的 NpcAttribute 讀 **自己的** info.name 及 dcLeft／dcTop／dcRight／dcBottom。
  listing 與 C 的預設依序是 **-22、-65、22、0**；只在原檔該欄位未指定時使用原程式的預設，不是素材缺少。
- `49A670` 回傳 NPC 座標加上這四個值，**不依 facing 鏡射**。
- `49F1F0` 逐 pool entry 用 Win32 PtInRect；left/top 包含、right/bottom 不包含；不是找距離最近者，亦不是 alpha hit-test。
- `/api/npc/<id>` 既有回應增加 name／clickBounds，瀏覽器 `npcAt` 改讀 metadata；未到齊前不猜大框。
  仍只發原有 click runtime npcId 請求，店舖／對話由 server 決定，不新增傳送或改角行為。
- `498CF0` 最後把 NPC 名稱交給 CLife `47D110`，font index=3；`527720(3)` 是 Gulim 12、ARGB **FFFFFF20**。
  NPC 現在有黃色 `#ffff20` 原名稱，與玩家共用原 A0 黑、切角、腳下 +2 的名牌，不手填中文／職稱。
- 直接 dump `Npc/0002003.img`：info.name=`로빈`，沒有 dc*，其 speak 是原韓文提示，支持使用原程式的預設矩形。

### Linked 素材

`40C020` 的 NPC 圖像 loader 對 info.link 載入目標，複製非 info 子節點；保留原 info 與原圖獨有的動作。
`npcArtOf` 現在合併 linked action frame tables，重名由 linked 覆蓋，原 name／dc* 不被 linked info 替換。
只合併回傳資料、不修改 WZ namespace／reader cache，並對循環、斷鏈與超過 16 hops 明確返回 undefined。
這是壞鏈防護，不把真素材當成缺少。Mob 既有 linked art／contact 邏輯沒有在這輪改動。

**界線**：pool 重疊時用瀏覽器目前 runtime Map 的順序；未聲稱完整還原原 linked-list 插入／重排。
NPC 4–12 秒隨機表情／自言自語、0x3B 自行走路的完整 CVecCtrl 尚未移植；現在仍以 stand 畫動作，
讀出其他動作不代表它們都已依原 AI 播放。名牌仍隨 actor 分組，不冒稱全 Gr2D 子層穿插完成。

## 3. 提示框：原色、切角、內框與螢幕邊界

原 `500F50` 的簡單文字使用 font172（Gulim 12，白），文字 (4,3)，量測寬 +8／字高 +6。
StatusBar `4F9AD0` 給指標 +20,+20；`502CE0` 以 **799／599** 上限收回畫面，底色 **A0000040**。
listing `00502ECB push 0A0000040h` 再調 Canvas vtable+156，與 C 相符；四角各寫 00FFFFFF。
a5 非零時，另在 (1,2)、(w-2,2)、(2,1)、(2,h-2) 畫透明內 keyline；不是之前自製灰藍描邊。

新 `client/tooltip.mjs` 共用此 frame，以 path 留透明切角／keyline，而非 clearRect 擦掉下面的遊戲畫面。
HP／MP／EXP 提示改成原 font、frame 與位置；既有 compact item／skill 提示也接原 frame，
技能不再是自製白底框；描述支援原文字換行，過長的行換行並限制整體在畫面內。

**界線**：item／skill 仍是 compact 文字內容，**不是完整 5014C0／502780／5029A0**：
尚未補齊原每類固定寬高、圖示、品質色、requirements 分區、原道具比較與各呼叫端定位（例如快捷格向上 128）。
長描述的安全 wrap／高度 clipping、item 的 270px 上限是 browser policy；不把它寫成原版的全類型排版。
現有道具事實與能力資料保留，沒有因這輪改成虛構 tooltip；Gulim 缺席時使用既有 KMSCJK fallback，非原 GDI metrics。

## 4. 按鈕、拖曳與中斷

- `444CE0`／`444D70`：進入真正 CCtrlButton 才發 BtMouseOver，不每 mousemove 播放，不為 NPC／傳送點／道具格亂播按鈕音效。
  補 Canvas StatusBar、商店 Buy／Sell／Recharge、商店／背包 CLOSE；disabled recharge 不播新 hover 音效。
  DOM 控件保留其原有音效接線，不讓新 Canvas handler 重複播一次。
- `445310`／`445330` 的 pressed／mouseOver／normal 對應原 sprite states；背包 CLOSE 不再永遠 normal，商店 CLOSE 補獨立狀態圖。
  事前載入小型 button states，StatusBar pressed 必須仍 hover 在本按鈕上才畫；不聲稱所有 UI 按鈕動畫時鐘已完成。
- 一張 HTML canvas 對瀏覽器只是一個 target。新增 logical-button down/up latch，避免在 A 按下、B 放開卻因 DOM click target 相同而執行 B。
  這是 browser 防誤觸 policy，不宣稱完整移植 CWndMan 的 capture/focus 路由。
- `finishWindowPress` 原同時掛 canvas mouseup 與 window mouseup，同一事件會執行兩次；而且無條件把剛設好的 shopSuppressClick 清掉。
  改為單一 window release，保留當次拖窗／拉 scrollbar 的 click suppression；畫面外放開不吞下一次真正點擊。
- bag／quickslot 的 mouseup 拒絕 secondary-button release，右鍵不會提交移動／丟棄；遊戲 surface 不彈瀏覽器 context menu。
- `releaseOnInterrupt` 統一 blur、pointercancel、hidden visibility：背包、裝備、Stat、Skill、小地圖、聊天捲軸、系統視窗、數量窗、復活窗取消拖曳／pressed。
  不假送 click、不接受 dialog、不發 inventory/drop 封包；保留視窗位置及尚未按 OK 的 modal。
  同時清 hover／tooltip、移動鍵與 cold-action ticket；從 Canvas 移到 DOM 控件前先清 Canvas 舊命中，避免提示或狀態停留在舊位置。

仍未實作完整原 UI z-order/focus、所有 scrollbar 音效／動畫或原 NPC 對話版面。此輪沒有把既有技能缺口、魔法、
全 CShape2D、怪物 aggro/fly、卷軸、cash/pet、交易／Messenger／Party UI 或自然 AP/SP／轉職聲稱完成。

## 5. 方便操作與保存

不需重建帳號：沿用目前 LIVE 的 `preview/preview` 或 `demo/demo` 與現有角色。
游標在標題／選角／遊戲視窗即會使用；`I` 的 CLOSE、商店按鈕、HP/MP/EXP、`K` 描述可直接看到本輪變動。
NPC 使用原名稱與框，不必先打新指令；現有 `/map <id>`、體驗工具仍可選地圖，但不自動替使用者跳圖。

新增 `server/test/native-cursor-npc-tooltip.test.ts` 是**未執行的回歸來源**，包含 cursor scale／hotspot、dc 預設與邊界、
linked table／循環、tooltip frame／wrap、真 WZ arrow／Robin 的資料斷言及 source wiring。
`webclient.test.ts` 另補**未執行**的 HTTP 回歸來源，特別釘住既有 NPC JSON serializer 不可丟掉新 name／clickBounds；
沿用 canvas/png API 的資料與狀態斷言也只寫成來源，沒有送 HTTP 請求。
沒有執行測試、typecheck、語法檢查、HTTP probe、browser 或 VM；沒有要求使用者每修一處就測一次。

停服／冷備份／LIVE 識別與實際推送紀錄於本節後追加；啟服只代表程序已啟動，不代表上述功能通過。

### 本輪實際保存／啟服

1. 停止舊 LIVE `kms-1-11-e91048bf`；使用者已自行遊玩至 map40000，這不是本輪執行的測試。
   保留停服當下最新 save，不拿前輪備份覆寫；沒有重新建立或修復角色。
2. 冷備份：`generated/backups/preview-death-before-native-cursor-npc-20261018-085010.json`。
   原 save 與備份 SHA256 相同：`6ea6e76395a4a2f0ae4d447800749e597d28c9bed1ffdbf688c7dbcbdebbab94`。
   備份遵循既有 generated 忽略規則，不納入 Git；後續使用者遊玩會正常更新主 save。
3. 新 LIVE：`kms-1-11-npc-bc9e4f76`／PID12802；web8515、login8516、game8517，綁定0.0.0.0。
   啟動訊息讀到2帳號1角色，沿用同 save／權限；無 preview 警告。未 HTTP 訪問／登入／操作驗證。
4. 啟動命令：
   ```sh
   node server/src/cli.ts serve --host 0.0.0.0 --port 8516 --game-port 8517 --web-port 8515 \
     --data Data.wz --save generated/preview-death-20261018.json \
     --account preview:preview,demo:demo --map-command preview,demo --test-tools preview,demo --ping off
   ```
5. 工作分支固定為 `arena/593e75b0-kms-1-11`；提交使用 `[skip ci]`，僅非 force push 此分支。
   Commit／push 結果以交付訊息及 Git 紀錄為準；此段不預先聲稱尚未執行的操作成功。

### 後續 ADR-064（2026-10-18，未測試）

此頁原 compact item/skill tooltip 註記屬當時狀態；已由 [NATIVE_RICH_TOOLTIPS](NATIVE_RICH_TOOLTIPS.md)
的三類原版 plan／painter 取代。保留此頁歷史啟服紀錄，不把舊程序識別或舊結果當成本輪驗證。
