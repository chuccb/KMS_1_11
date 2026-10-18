# 清晰縮放與原版小地圖驗證（2026-10-17）

> 本頁以下保留當時量測；現行入口為 `browser_display_probe.ts`（Bun／唯讀／明示目標）。DPR監測已改由既有app frame的typed refresh補足未發事件情況，實際新驗證見 [BROWSER_TOOL_CLEANUP](BROWSER_TOOL_CLEANUP.md)。

## 1. 畫面「糊」的實測，而非猜測

舊版保持 800×600 backing，但 CSS 自動填滿。在 1000×800 視窗得到 1000×750，DPR 1／1.25／2 的實體倍率為 **1.25／1.5625／2.5**。
即使 `imageSmoothingEnabled=false`、CSS `pixelated`，一個來源像素仍會分到不同數量的實體像素。
Chromium 黑白單像素條紋診斷只得到 0／255，沒有混灰，**實測的是寬度不均，不是證實雙線性模糊**。
原素材的柔邊、文字抗鋸齒與目前非原 Dotum 的韓文字型差異仍須分開看。

`client/display.mjs` 新增三種可保存的呈現模式：

| 模式 | 規則 |
|---|---|
| 清晰整數像素（預設） | `floor(min(viewW/800,viewH/600)*DPR)/DPR`；每個原像素占整數實體像素 |
| 原尺寸 800×600 | 最多 1 CSS 倍，視窗不足時縮小；不保證分數 DPR 下實體整數 |
| 填滿視窗（非整數） | 保留原先等比 fit；可能出現不等寬像素 |

- backing、遊戲座標、物理與 hit test 仍為 800×600，不放大 backing 再重取樣素材。
- canvas 與 `#game-ui` 共用大小／原點／倍率，輸入框與滑鼠不漂移。resize／DPR 切換不重新清空 backing。
- 原點同時對齊 CSS 與 device 格：DPR1.25 為 4 CSS px、1.5 為2、2為1。
  僅對齊 device 格仍不夠：初版在 DPR2／1001×801 取100.5 CSS px，Chromium 的 canvas paint snapping 會偏一列。
- 監聽 resize 與 resolution media query，支援跨螢幕／瀏覽器縮放改變 DPR；保存 `kms111.displayMode`。
- 太小視窗連1實體倍率也容不下時，必須降採樣，不宣稱仍能像素完美；任意非有理 DPR 也不保證雙格精確對齊。

### 真 Chromium 診斷結果

在 1001×801，逐張 screenshot 解碼查每一條黑白欄：

| DPR | canvas CSS 尺寸 | 原點 CSS | 每原像素實體寬 | 灰階 |
|---|---|---|---|---|
| 1 | 800×600 | 100,100 | 1 | 只有0/255 |
| 1.25 | 640×480 | 180,160 | 1 | 只有0/255 |
| 1.5 | 約533.333×400 | 232,200 | 1 | 只有0/255 |
| 2 | 800×600 | 100,100 | 2 | 只有0/255 |
| 3 | 800×600 | 100,100 | 3 | 只有0/255 |

DPR1.5 的 canvas DOM width 因 CSS layout 量化讀到533.328125；實際每欄仍一致1實體像素。
另測模式切換、不清空 backing、重新載入偏好保存、viewport resize、同頁 DPR1→1.25、DOM overlay 對齊，page errors=[]。
這不是所有瀏覽器／所有素材都已逐像素驗證的宣稱。

## 2. CUIMiniMap 原版證據

來源為 `MapleStory.exe.c`，抽取工具 `tools/hexfunc.py`（文字檔以 latin1 讀取）。

| 函式 | 確證內容 |
|---|---|
| `sub_4E52C0` | map miniMap 的 canvas／width／height／centerX／centerY／mag；NPC 取 life.type=n 原始x/y |
| `sub_4E5C70` | crop、ARGB 背景與標記、bitmap 1:1 blit、content clip、每4次update重畫 |
| `sub_4E6430` | UI/UIWindow.img/MiniMap 八片原框、尺寸與貼圖座標 |
| `sub_4E7030` | 顯示切換；按鍵 dispatch scan0x32（M） |
| `sub_43D750` | window type4 預設 x8/y8/shown1 |
| `sub_553F40` → `sub_549660` | 已註冊 UI updates 的30ms節拍 |

### 幾何與原框

- canvasWidth ≥280 時內容寬 **210**，否則原寬；canvasHeight ≥150 時內容高 **112**，否則原高。
  不把整張大地圖縮成現代小縮圖，也沒有自創的標題列／縮放按鈕。
- unit=`2**mag`；left=`trunc(selfX)-trunc(contentW*unit/2)`，先 clamp 低 `-centerX`，再高
  `worldW-centerX-contentW*unit`；cropX=`floor((centerX+left)/unit)`。Y 同理。
- point=`floor((center+trunc(worldPoint))/unit)-crop`；負數必須 floor 而非 truncate。
- window W+6／H+13，內容在3,3；nw/ne 在0,0／W+2,0；sw/se 在0,H+2／W+2,H+2。
  sw 本身45×11，含 MINIMAP 字，不另用字型畫替代。
- n/s：x4、y0／H+3，拉伸 W−2×3；w/e：x0／W+3、y4，拉伸3×H−2。
  **map bitmap 不縮放**；邊條拉伸是 native 的框組法。

### 原標記與時序

先白底覆 `0xA0000000`，再原 bitmap，標記亦受內容 clip：

| 標記 | ARGB | 形狀（projected point 的相對位置） |
|---|---|---|
| portal，僅pt2 | CC8090FF | (+1,−2)4×6 與 (0,−1)6×4；tick%128<64 |
| NPC 原x/y | AA20FF20 | (+2,−2)2×6 與 (+1,−1)4×5；tick%80<40 |
| 其他玩家 | AAFF2020 | 同NPC形狀，不閃 |
| 自己（最後畫） | DDFFFF00 | 同NPC形狀，不閃 |

不畫怪物／隱藏門／sp／auto門的假標記。每30ms累計tick、每4tick更新離屏快取；隱藏但有圖時仍計時。
不以 RAF frame 次數當 native update，也不宣稱重建與原 Windows client 的絕對初始相位相同。

### 真 WZ 普查

100張圖：**80張有miniMap原canvas、20張沒有node**，mag全4；沒有node就不顯示，不拿人工foothold縮圖代替。
有node但讀不到canvas／geometry非法時直接報錯，不能用fallback掩蓋reader問題。

| mapId | 原canvas | 顯示內容 | 視窗 |
|---|---|---|---|
| 1000000 | 251×100 | 251×100 | 257×113 |
| 100000000 | 437×86 | 210×86 | 216×99 |
| 101000000 | 179×321 | 179×112 | 185×125 |
| 20001 | 無node | 不造圖 | 隱藏 |

1000000：world4027×1612、center530/878；100000000兩NPC取原(158,273)、(3924,120)，不是動畫後的cy。
metadata讀canvas尺寸時保留lazy PNG getter，不強制encode。

## 3. 接通與真瀏覽器測試

- `server/src/game/minimap.ts` → mapart → `/api/map/:id/art` 的可選 `miniMap`，不改原協定封包。
- `client/minimap.mjs` 接實際 self／remote users／portal；進圖、失敗、登出斷線清舊圖。
- M 切換（聊天輸入時不攔截）、拖曳、blur放開、位置clamp0..784／0..584；瀏覽器保存
  `kms111.minimap={x,y,shown}`。這是 localStorage 便利實作，不冒稱 native 的 per-character 設定協定已還原。
- 小地圖在背包／商店下方，對應canvas UI遮住的區域關閉DOM拖曳hitarea，避免吞上層操作。

Chromium 隔離 `travel` 帳號，真登入／按鍵／命令，沒有注入遊戲座標或物理狀態：

1. Amherst黃色標記實際走路後 x29→37，M開關通過。
2. 拖曳(+80,+40)，localStorage保存 `{x:88,y:48,shown:true}`；背包覆蓋區 pointerEvents=none。
3. 上表三種真地圖尺寸、無node20001、不丟失跨圖拖曳位置全部通過。
4. 捕捉84次原bitmap drawImage，每次source/destination寬高相等（1:1）；HTTP及JS錯誤皆空。
5. 截圖（生成檔不進Git）：`generated/validation/minimap-native-{amherst,henesys}.png`。

## 4. 回歸與重現

- `cd server && npm run check`：**564/564，strict TypeScript通過**。
- display／miniMap純函式與WZ測試10項通過；純前端probes亦接入標準suite的browser-motion wrapper。
- `client_probe.mjs`：原登入／選角／建刪角／Stat/AP／商店等VM回歸通過。
- 再跑隔離 Chromium `browser_portal_probe.mjs 8595`：真↑往返／type1／tn／map0／命令／缺圖恢復通過。
- 再跑 `BROWSER_ACCOUNT=climb BROWSER_PASSWORD=climb ... browser_motion_probe.mjs 8595 --climb`：
  真登台持續↑及放開穩定 **x718,y95,fh277,vy0**；移動／跳躍／繩索與音效通過，errors=[]。
  type3 auto本輪未再初始化fixture重跑，其前輪真瀏覽器與本輪標準suite回歸仍保留。

```sh
# Chromium與Playwright為外部測試工具，不是產品runtime dependencies。
# 在隔離8595/8596/8597服務，建立travel/climb fixture，並授權 --map-command climb,travel；勿使用真存檔。
export PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs
export CHROMIUM_EXECUTABLE=/absolute/path/to/chromium
node server/scripts/browser_display_probe.mjs 8595
node server/scripts/browser_minimap_probe.mjs 8595
```

本機logs：`/tmp/browser-display-grid-final.log`、`/tmp/browser-minimap-native.log`、
`/tmp/display-{portal,climb}-regression.log`、`/tmp/display-minimap-full-check.log`；暫存不作必需fixture。

## 5. 邊界

這是原反編譯／WZ證據＋重建Chromium驗證，不是已啟動原Windows client作完整動態oracle比對。
字型仍非原Dotum；天氣／霧、自然升級AP/SP與HPMP成長、HPMP配點、Detail／buff合計等仍有缺口。
Data.wz不修改，正式角色不作測試。清晰模式不會把本來柔和的原圖「銳化」，也不修改素材像素。

## 6. 預覽部署

8495／8496／8497 已重啟載入本輪server與前端；沿用最新 `/tmp/kms111-save.json`，不回滾至前輪測試基線。
停止前確認場內玩家已離線。以**此次部署前**的save SHA256核對，重啟及唯讀HTTP檢查後一致；
Data.wz SHA256仍為 `286abe74f4335ebfde3164fa8f55e195e926a6cf5165646796b3c2fba3962d0f`。
healthz、頁面、main／display／minimap模組、map catalog／geometry、三種miniMap metadata與PNG皆HTTP200；
20001正確不提供miniMap。未登入正式角色進行檢查，隔離QA已停止。
