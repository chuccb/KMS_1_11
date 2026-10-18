# 標題／登入視窗／世界與角色選擇：strict TypeScript 整理

2026-10-19（Asia/Taipei），ADR-086。這是實作遷移增量，**不是全專案已完成 TypeScript 遷移或 CI 全綠的聲明**。

## 責任與實際接線

| 位置 | 現行責任 |
| --- | --- |
| `client/login-data.ts` | `unknown` 世界／角色清單投影、wire-width 驗證、資料複製、三槽與選擇／捲動／pending／拒絕狀態；無 DOM／I/O |
| `client/login-presentation.ts` | 原版 800×600 標題、登入 modal、世界列／gauge、角色預覽／能力及 sprite 狀態繪圖；無 DOM 查找或網路 |
| `client/login-screen.ts` | 實際標籤驗證、透明命中層、焦點／鍵盤、帳號名偏好、畫面切換與完整 listener disposal |
| `client/selection.ts` | 共用原版幾何、三槽、signed LONG 人數解讀與 gauge source clip |
| `client/main.js` | 建立 typed controller；既有 transport 把清單交給驗證邊界，角色建立／avatar clocks／cache／audio 透過具體介面注入 |

原入口 **5963 → 5356 行（淨減607行）**，移除該鏈的 title／selection 全域狀態、散落事件、繪圖與重複代理函式。
client **86 → 89 支 TS**。不是把 main 改名、加 declaration 或關 strict：三支新模組與相關測試真正納入根 TypeScript 檢查。
`target/module: ESNext`、strict／unused／erasableSyntaxOnly／skipLibCheck=false 原樣保留，沒有 allowJs／any／抑制錯誤。

body／face 預覽仍委派給原有 `sampleAvatarMotion`／`sampleAvatarFace`，不是另造固定速率動畫；實際 avatar PNG／origin／flip cache 不變。
creation dialog 仍持有建立／刪除的原有狀態及原協定請求，這輪只整理入口與阻擋條件，不自動建角或刪角。

## 原證、常數與未混入的政策

- `MapleStory.exe.c`／`.lst`：CUITitle `4D05A0`、CUILogin `4CEEC0`、標題版本字 `4D0000`；保留原背景、menu、按鈕、modal、checkbox 與版本字位置。
- 世界窗／列 `545450`、`54C7B0`、`54D480`／connect `54D9A0`；保留六列、原 `wsHeader/wsItem/wsIcon/wsGauge`、選取與送出分離。
- `54C7B0` 的 gauge 是 `clamp(trunc(20*count/3000),1,20)`，每階裁5px，原 source 為101×7。
  **3000 是此處的顯示分母，不是伺服器准入／容量設定。** 不以改 gauge 變更世界可否連接。
- `WorldEntry.unknownId` 保留既有 wire 名稱及 u32 驗證；只有選擇畫面以 signed LONG 解讀負數不可用。不把它改當世界識別碼；請求仍送清單 index。
- 原三槽與角色腳點見 `42E0D0/42E2C0`；幾何重用 `CHARACTER_UI`。不把第四筆硬塞到不存在的槽位。
- 原 WZ PNG、font、avatar composer 及 UI 論理尺寸不變。不修改物理／camera／傷害／掉落fh／網路編碼／server tick／存檔。
- 非原版帳號說明文字、可選手感／鏡頭入口維持明示重建政策；標題按鈕不擅自打開官方帳號服務。

## 資料與輸入邊界

- 角色清單完整驗證再發布：id／face／hair／item ids 為 u32，job／四能力為 u16、level 為 u8；name 為字串、items 為整數陣列。
  此為 bridge 對應的 wire widths，不另造職業／等級平衡限制。缺欄位或重複 id 明確拒絕，不以預設臉／假角色補齊損壞回覆。
- 只複製畫面實際消費的欄位；不帶入外部 animation／face clock。look／基本資料唯讀，既有 actor 本機時鐘仍可更新。
- 保留同一角色 id 在清單重排後的選取，找不到時 clamp，空清單為 -1。整份驗證失敗不發布部分新資料。
- 空清單、NaN／小數／越界索引不能變成可連接世界或 NaN 腳點。不可用世界仍可高亮，但不能送連接。
- `pending` 阻擋重送；損壞清單另有明確 block，後續 generic error 清掉 pending 也不能解鎖過期清單，直到有效清單到達。
  **這不是完整 `/ws` 深 schema 或跨 phase／epoch 驗證已完成的聲明。**
- 編輯欄位、creation modal、鏡頭／手感設定擁有自己的輸入；同時阻擋底層按鈕 click 的原生 Enter activation，而不只阻擋 keydown。
- 保留登入 modal Tab／Shift+Tab 圈、帳號 Enter 進密碼、密碼 Enter 送出、pending 時不可取消、Escape 清密碼。
  僅可選保存帳號名；拒絕 storage 不會讓畫面失效，從不保存密碼。
- 世界／角色列採父節點事件委派，不在每次捲動重建列時新增 AbortSignal subscriptions；dispose 一次移除靜態與全域 listeners。
  pointerup／cancel／blur／原 interrupt 路徑清除按下與 hover，避免卡住 sprite。

## 驗證與證據

- 六項 npm registry `latest` 重新查證，2026-10-19台北日期（UTC `2026-10-18T16:09:10Z`）：
  Bun1.4.3、TypeScript7.0.2、@types/bun1.4.3、Prettier3.9.10、Playwright Core1.64.1、Chromium153.0.0；與 exact pins 相同，無虛構升版。
- strict／format／browser build 通過。focused **45 pass / 0 fail，7 files**，含15項新資料／狀態測試及真瀏覽器整條 UI component 測試。
- component 使用原 index.html、production CSS/display controls、真 Chromium Canvas、真 Data.wz UI 與 avatar PNG。
  callback 只記錄本機意圖，沒有建立 game transport／帳號／LoginServer／GameEntryServer／save；HTTP GET-only 並攔截所有 WS，實際0次 WS。
- 覆蓋真 WZ 背景像素、原座標與版本字、modal／remember／拒絕storage、焦點與 Tab 圈、pending、六列／不可用世界、三角色原 PNG、共用 body／face 委派、modal／lab input、拒絕損壞清單、dispose。
- 額外 ignored before/after audit 直接從 **1520ac9 的舊 renderers** 取參考：同一 real DOM language／字型 ready 條件、原 WZ 素材與相同注入 clocks，
  **21組完整800×600邏輯畫布的RGBA通道差異全部0**（12標題／modal／remember／pointer、6世界捲動／高亮、3角色選取），0 WS。
  這不是本輪所有DPR最終screenshot已重驗21次的聲明；既有放大screenshot回歸仍在完整suite內。
- 30個工具／元件 imports 在禁止 network／browser launch 的獨立程序通過，0 I/O attempts；同步更新計數的呼叫測試，不只跑 helper。
- 完整 **1054 pass / 44 fail，1098 tests／122 files，285.07s**。對1520ac9的44個failure multiset（含重複標題）**新增0／移除0**；新增16項測試，未skip／縮小範圍，CI仍不綠。
- LIVE 保留 PID4942，同一8515/8516/8517；只讀實際87個module全部200、標題120幀／errors[]／0 WS，沒有自動登入、角色／save操作或 restart。
  標題 CPU median0.2ms／p950.3ms、frame median/p9516.7ms 只是當次 sandbox 抽樣，不是遊戲手感或所有設備的保證。

本機證據位於 ignored `generated/login-cleanup/`：`registry.json`、`focused-final.log`、`imports.json`、
`render-equivalence.json`、`full-final.log`、`comparison.json`、`typecheck.log`、`format.log`、`build.log`、`live-modules.json`、`live-title.log`。
不把 generated／dist／瀏覽器截圖或存檔加入 Git。

```sh
bun run typecheck
bun run format:check
bun run build
bun test --timeout 30000 ./server/test/login-data.test.ts ./server/test/presentation-selection.test.ts \
  ./server/test/login-screen-browser.test.ts ./server/test/browser-startup.test.ts \
  ./server/test/native-avatar-motion.test.ts ./server/test/native-faces.test.ts ./server/test/probe-session.test.ts
bun run test
```

## 仍未完成

`client/main.js` **5356行**、`server/scripts/client_probe.mjs`709行、`frame_probe.mjs`195行、`play_probe.mjs`72行仍是實際遷移債務。
三個 MJS 沒有在這輪執行；後兩個含歷史 implicit account／自動角色操作，**不可對正在玩的 LIVE 執行**。
舊 fake-DOM／VM `client-ui` 測試仍列在完整suite中，不以新 component 測試偷偷取代／刪掉它或宣稱其商店／背包情境都已驗收。
全 `/ws` 深 schema、其餘整合入口與既有44個失敗仍須繼續實作；新圖形與鍵盤驗證不能替代玩家場地／商店／戰鬥的整體驗收。

相關：[BUN_MIGRATION](BUN_MIGRATION.md)、[TOOLCHAIN](TOOLCHAIN.md)、[ARCHITECTURE](ARCHITECTURE.md)、
[FACING_SELECTION_VALIDATION](FACING_SELECTION_VALIDATION.md)、[NATIVE_AVATAR_MOTION](NATIVE_AVATAR_MOTION.md)、[PIXEL_CAMERA](PIXEL_CAMERA.md)。
