# 解析度、原像素 HUD 與鏡頭演出

**現行政策：ADR-170（2026-10-24）。** 固定 4:3 解析度由下拉選單選擇，預設 **800×600**；較大解析度只增加世界可視範圍，不縮放角色、地圖或固定 HUD 素材。早期 ADR-084／085 記錄的是現已取代的整數裝置像素倍率選單與 UI 合成架構，不應當成目前選單行為。

## 解析度選項與呈現

| 選單 | 世界 viewport（原像素 1×） | Canvas backing | DPR `d` 下 CSS footprint |
| --- | ---: | ---: | ---: |
| **800 × 600（預設）** | 800 × 600 | 800 × 600 | 800/`d` × 600/`d` |
| 1024 × 768 | 1024 × 768 | 1024 × 768 | 1024/`d` × 768/`d` |
| 1280 × 960 | 1280 × 960 | 1280 × 960 | 1280/`d` × 960/`d` |
| 1600 × 1200 | 1600 × 1200 | 1600 × 1200 | 1600/`d` × 1200/`d` |

- 選單值透過 `kms111.resolution` 保存；無偏好、無效值或不可讀 storage 一律使用 **800×600**。不讀取舊倍率偏好，避免啟動後覆蓋新的預設。
- Canvas backing 精確等於所選解析度。DPR 只透過 `scale(1/DPR)` 改變 CSS footprint；沒有把素材乘上選單倍率、fractional fit 或對整張畫面重採樣。
- 可用瀏覽器區域不足時，完整畫面可捲動，絕不為了塞進視窗縮小或模糊。標題列佔用的固定列會從垂直置中空間扣除；原點及 scroll tail 對齊 CSS/device grid。
- 場景 buffer 依當前世界 FOV 繪製，預設 `pixelScale = 1`；因此 1024×768 比 800×600 多顯示 224×168 個世界像素，但同一角色／地圖 PNG 的來源像素尺寸相同。

## 固定尺寸 HUD 與錨點

UI 仍以原始尺寸及像素繪製，不隨 canvas 解析度拉伸：

- 小地圖：左上角，沿用其可拖曳位置；可移動範圍依新解析度調整。
- 地圖標題及暫時狀態圖示：右上角。
- 原版 800×208 狀態列、快捷欄與聊天列：左下角；高度差用於把整個狀態列貼齊新底邊。
- DOM 聊天輸入框與聊天記錄跟隨狀態列，仍與底板及點擊座標對齊。

`viewPoint()` 把 CSS pointer 座標轉成所選 backing 的實體像素座標。世界互動再依目前 lens viewport 反投影；狀態列按鈕、快捷欄、血量提示及聊天室控制會扣回其 HUD anchor offset 後命中。HUD 不會因 pointer 的世界投影或 camera zoom 被放大。

## 獨立鏡頭倍率（非原版實驗功能）

解析度選單只負責世界 FOV。頂端「鏡頭演出 · 非原版」是獨立的可選倍率：

| 鏡頭 | 世界 source pixelScale | 1600×1200 選項下的世界 viewport |
| --- | ---: | ---: |
| 標準 | 1× | 1600 × 1200 |
| 拉近 | 2× | 800 × 600 |
| 特寫 | 3× | 約 533.33 × 400 |

只有明確選擇此鏡頭倍率才會放大世界素材；HUD 和輸入仍維持原尺寸／解析度座標。相機演出可以直接切換、淡出淡入或上下開幕；它不改碰撞、角色能力、伺服器權威或物理步長。舊保存的 `wide` 鏡頭值會遷移為標準 1×。

## 實作責任

| 模組 | 責任 |
| --- | --- |
| `client/display.ts` | 四種固定解析度、1:1 physical backing、DPR/origin-grid/scroll layout |
| `client/display-controls.ts` | 選單、`kms111.resolution`、canvas／DOM overlay／stage 對齊、resize 與 dispose |
| `client/scene-surface.ts` | 有界 world/UI buffers、固定尺寸 UI 1:1 合成、world/screen 互逆投影 |
| `client/camera-lens.ts` | 原像素標準、2×／3×離散鏡頭與轉場狀態機 |
| `client/lens-controls.ts` | 鏡頭面板、偏好、鍵盤隔離、減少動態與事件生命週期 |
| `client/hud.ts` | 狀態列底邊 offset、動態地圖標題錨點、狀態列 hit regions |
| `client/minimap.ts` | 依所選解析度限制拖曳位置，維持原 minimap 素材尺寸 |
| `client/temporarystats.ts` | 暫時狀態圖示右上錨定 |

最大解析度 backing 為 1600×1200；共用 buffer 只擴至所需上限並保留，不在每幀重配。沒有新增 sharpen、模糊 filter、AI/xBRZ 超解析、人工替代素材或物理／封包變更。

## 驗證

- 單元回歸鎖定預設、四種 4:3 尺寸、不同 viewport/DPR 下 backing 固定、1× 原像素、scroll/header grid、狀態列底邊偏移與命中測試。
- `display-ui-surface.test.ts` 以真 Chromium／原 WZ PNG 和實際 screenshot 驗證 **4 解析度 × 3 DPR × 3 鏡頭（36 組）**；HUD/source 像素不放大，截圖對 backing **0 pixel difference**。
- `zoom-display-browser.test.ts` 以真 Chromium／原背景、tile、avatar 驗證 **4 解析度 × 5 DPR × 3 鏡頭（60 組）**；screenshot 對 backing **0 channel difference**，所有鏡頭下角色原圖尺寸及像素一致。
- camera-lens browser／unit regression、resolution/display control、HUD anchor 與游標回歸均通過。完整檢查結果記在 ADR-170 的驗證段。

## 歷史範圍

ADR-084／085、display milestone 的早期 screenshot 數據，測的是先前 800×600 backing 的 1×／2×／3×／4×實體倍率與放大的 UI layer；它們作為當時歷史證據保留，但不再描述目前固定解析度選單。此政策沒有宣稱每個 live 地圖／瀏覽器／OS 顯示路徑都已人工驗收；本輪未登入、不操作角色、不讀寫存檔。
