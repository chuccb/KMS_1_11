# 朝向、地面怪物移動與世界／角色選擇（2026-10-17）

這一輪處理使用者指出的左右朝向相反、怪物移動不自然，以及選擇畫面仍是 HTML 卡片的問題。以下分開記錄原版證據、實際修正和尚未完成的範圍；不是全遊戲 1:1 宣告。`Data.wz` 未修改。

## 原版證據

| 項目 | 原始資料／反編譯 | 本輪實作 |
|---|---|---|
| 朝向 | `sub_4884F0` 回傳 `(a2 < 0) | 2` 等，最低位 1 代表左；WZ 人物／怪物原始圖朝左 | `facingFlip` 將 logical facing 與 PNG 鏡像旗標分開：right=0 時鏡像，left=1 時保留原圖 |
| 地面怪物速度 | `sub_537CA0` 的 `CAttrShoe` 速度乘上 `125.0`；`sub_48D080` 的 WZ speed 百分比 | 撤掉先前任選的 60 px/s 基準，使用 125 × speedPercent / 100 |
| 普通遊走決策 | `sub_53D980` 無追蹤目標時，計數 `(rand()%2000+1000)/90`，方向 `rand()%3-1` | 實際世界使用獨立的左／停／右決策；不再每隻怪固定從出生點不停地走到範圍端點再折返 |
| AI 時基 | `sub_5407F0` 累積到 90 ms 才回傳 90 | 預設 field tick 改為 90 ms；不再使用沒有原版依據的 250 ms |
| 世界視窗 | `sub_54D6A0`：`sub_545450(...,250,89,305,403,...)` | 原 WZ 背景、menu，原位控制項 |
| 世界清單 | `sub_54C7B0`／`sub_54D480`：header `(24,181)`、列 `(24,199+25*i)`；`sub_54D9A0` connect `(95,362)` | 原 wsHeader/wsItem/wsIcon/wsGauge；選取與連線分離，六列捲動、鍵盤／雙擊、pending 防重送 |
| 世界人數 | `sub_54C7B0`：負值顯示接入不可，人數 `/3000` 分成 20 格，從 gauge 右側裁切 | bridge 的 `unknownId` 依原列結構顯示人數與 gauge，負值不可連線；不再誤印成世界識別碼 |
| 角色視窗 | `sub_431080` 建立 `sub_545450(...,161,85,491,398,...)`；menu 素材本身寬 490 | 原 WZ 800×600 背景、490×398 menu，保留原視窗座標 |
| 三個角色槽 | `sub_42E0D0` hit rect `(70+140*i,178,50,70)`；`sub_42E2C0` feet `(95+140*i,238)` | 三槽人物、角色名稱、真實等級／職業／四屬性；沒有 HP／地圖卡片 |
| 選取預覽 | `sub_42E210` 切換 avatar action 2／4，`sub_4245E0` 解出 walk／stand；最低位都是 0 | 選中的角色原地行走、其餘站立；選取切換重設動畫時鐘，預覽朝右 |
| 角色按鈕 | `sub_42CFE0`：select/delete/new 在相對 `(305,290/322/354)` | 原 BtSelect/BtDelete/BtNew 的 normal/pressed/mouseOver/disabled 素材；先選角色，再確認入場 |

## 修正的移動問題

- **不改動攻擊／物理的左右語義來掩蓋繪圖錯誤。** 本地、其他玩家、NPC、怪物（含 hit/die）統一使用正確的素材鏡像轉換。
- 先前伺服器送出一條路徑時，立即把怪物座標改成幾秒後的終點。現在伺服器逐時取樣同一條路徑，出生快照／掉落／戰鬥讀到的不是未來位置。
- 怪物只沿真正相連的正面 floor 移動；`prev/next` 所連的垂直牆、背面與不連續端點不能當成可走地面，避免沿地形外框「爬牆」。
- 連續坡面與平面的接點各有自己的 timed path element，速度按**地面弧長**計算，不按水平距離穿過坡面。
- 中途加入地圖會收到怪物尚未走完的路徑，不是等下一次決策才突然開始移動。快照精度仍受 field tick／網路延遲限制。
- 閒置路徑不再因「有 motion」就播放走路。walk/stand 改變時重設怪物動畫時鐘，使用原 frame delay，不讓整個地圖共用一個動畫相位。
- 普通遊走碰到允許範圍邊界時等待剩餘決策時間，不再無條件來回反彈。確定性的 patrol 保留給 geometry/protocol 測試，實際 `FieldInstance` 使用 roam。

## 字型

實際 Chromium 截圖另外發現 Linux 環境沒有韓文字型，動態職業文字變成方框。加入 2.4 MiB 的 OFL Noto Sans CJK KR 子集作**本地 fallback**，含 CP949 字集與現有 UI 文字，沒有外部 font CDN 依賴。仍優先使用使用者系統的 Dotum／돋움／Malgun Gothic。來源與授權在 `client/fonts/README.md`、`OFL.txt`。

這解決缺字，不代表 Noto 的字寬、hinting、抗鋸齒已等同 Windows 原版 bitmap font。

## 驗證

- `cd server && npm run check`：**536/536，0 fail/skip，TypeScript 通過**。
- `client_probe.mjs`：SMOKE、SHOP、TITLE、**SELECTION REGRESSIONS OK**。包含點擊只選取、不立即入場；離線世界禁用；pending 重送保護；原 WZ menu／控制項座標。
- `browser_selection_probe.mjs`：真 Chromium、真 WebSocket／地圖。使用 **alt/QAAlt** 和空的 newbie 帳號；沒有改寫角色／地圖／怪物位置。只加繪圖與模組狀態的唯讀觀察。
  - 實際登入 → 世界列選取 → Connect → 角色選取 → Select → 入場。
  - 朝右 `action=0,vx=125`，實際繪出的 avatar URL `flip=1`；朝左 `action=1,vx=-125`，URL `flip=0`。
  - 依 template、WZ origin、camera、當下座標比對可見怪物的**實際 Canvas matrix**；左右朝向都吻合，含走路與站立。
  - 收到閒置和移動路徑；JS errors `[]`，PNG/avatar HTTP errors `[]`；本地韓文字型確認 loaded。
  - 空帳號沒有角色可進入、建立鈕可用、開啟／取消建立表單正常，不建立測試角色。
- `browser_motion_probe.mjs --climb`：實走／跳過真實牆面、抓住 x=718 繩索、停止不滑落、跳離；**REAL BROWSER MOTION OK**。停住範例 `{x:718,y:198,foothold:0,action:75,vx:0,vy:0}`。原 BGM／Jump 等 decode、AudioContext 實際播放仍通過。
- `frame_probe.mjs 8495`：**FRAME SMOKE OK**。
- 兩方向、世界、角色、空槽的截圖已實際檢視，位於 ignored `generated/validation/`：`world-select-native.png`、`character-select-native.png`、`character-select-empty.png`、`facing-right.png`、`facing-left.png`。
- `Data.wz` SHA256 仍為 `286abe74f4335ebfde3164fa8f55e195e926a6cf5165646796b3c2fba3962d0f`。

## 尚未等同原版的範圍

1. 上述是**普通地面遊走**；完整追擊／仇恨目標、跳怪、飛行、水中、擊退及其所有 AI／物理分支未完成。怪物路徑目前以等速地面段表示，沒有逐一重現原 CVecCtrl 的加速／摩擦積分。不能將本輪改善稱為完整怪物 AI 1:1。
2. **後續進展**：原版 newDlg、男女六組外觀、預覽、骰點、Check 名稱與 YesNo 刪除確認現已補上，並接通真登入封包與存檔；詳見 `CREATION_VALIDATION.md`。本文件的 536 項測試與前一輪選角證據仍只對應當時版本。
3. 字型／字距與部分焦點細節未逐像素對照原 Win32 執行畫面；真實文字顯示不等於字型完全還原。
4. 世界／角色選擇主畫面不再使用 HTML 卡片，但這不代表所有登入／註冊／帳密查詢 UI 已還原。

完整重現依然要持續按分支對照原始程式，不能用通過這批測試替代整個遊戲的逐項驗收。
