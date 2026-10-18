# 清晰尺寸、世界／UI 分層與鏡頭演出

2026-10-18，ADR-084。這是使用者要求的瀏覽器呈現擴充，不冒充原 EXE 的縮放／轉場。
相關責任先收斂成 strict TypeScript，再接遠近與效果；全案 main.js／3 支 legacy MJS 的遷移仍未完成。

## 實際操作

- 上方尺寸選單：**清晰自動、1×、2×、3×、4×**，不是只留一種尺寸。
- 上方原有十種跟隨模式與「鏡頭回中」保留；與遠近獨立組合。
- 開「**鏡頭演出 · 非原版**」選 **遠景／標準／拉近／特寫**，或按「拉遠 −／拉近 ＋」。
- 切換效果：**直接切換、淡出 → 淡入、上下開幕**。「播放淡出／淡入」可重播目前鏡頭；即使選直接切換也可單次預覽。
- 「還原標準鏡頭／直接切換」立即清掉進行中的轉場，不改其他跟隨模式、物理步長或角色。
- 面板內鍵盤操作不會同時跳躍／攻擊；Esc 關閉並回到 canvas，點面板外關閉。換場／離開遊戲也會清理。
- 開面板遮蔽角色輸入，**世界、重力、傷害照常運作，不是暫停或無敵**。關閉後效果仍依正常時鐘完成。
- 系統要求「減少動態」時改直接切換並禁用效果預覽；不覆寫保存的效果偏好，系統取消此設定後恢復可選。

預設仍標準鏡頭、直接切換、原有平滑跟隨、30ms＋平滑插值。八個 5/8/10/15/20/30/45/60ms 選項、原 ITEM／I 都不移除。
此輪不調走速、重力、碰撞、怪物時鐘、封包、能力或存檔；掉落真 fh 權威鏈維持 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。

## 清晰尺寸的確切意義

倍率是**實體像素**，不是 CSS 像素。設顯示倍率 `u`、瀏覽器 DPR `d`：

| 尺寸 | 輸出 backing | CSS 尺寸 |
| --- | --- | --- |
| 1× | 800×600 | 800/d × 600/d |
| 2× | 1600×1200 | 1600/d × 1200/d |
| 3× | 2400×1800 | 2400/d × 1800/d |
| 4× | 3200×2400 | 3200/d × 2400/d |

自動取 `clamp(floor(min(viewW/800, viewH/600) * d), 1, 4)`。
**沒有 fractional fit、拉伸或小視窗降採樣**。尺寸放不下就捲動完整畫面；canvas 和透明 DOM UI 在同一個 stage，不各自漂移。
原點與捲動對齊共同 CSS/device 格；尾端補少量空間，連瀏覽器限制的最右／最底也不落在半格。
舊 `fit`／無效保存值讀成清晰自動，舊 `native` 讀成清晰 1×；啟動不擅自寫偏好。

這也不代表把原素材半透明柔邊、TTF/GDI 字型差異「修成無鋸齒」。
Chromium DOM 尺寸會有 1/64 CSS px 量化，例如 DPR1.5 的533.333…讀回533.328125；實際 screenshot 逐像素檢查仍等寬、沒有縮放混灰。
七種 DPR 的實測不是所有任意非有理 DPR、瀏覽器或 OS cursor plane 都已逐像素驗收的承諾。

## 遠近不犧牲像素，也不放大 UI

世界像素倍率 `k` 只取正整數；世界 FOV 是 `800*u/k × 600*u/k`，相對鏡頭倍率為 `k/u`。
所有 sprite 先在世界來源 buffer 畫原圖，再用整數實體倍率合成；UI 獨立以 `u` 合成。

| 遠近 | 世界實體像素倍率 k | u=2 時世界視野 |
| --- | --- | --- |
| 遠景 | 1 | 1600×1200 |
| 標準 | u | 800×600 |
| 拉近 | 2u | 400×300 |
| 特寫 | 3u | 約266.667×200 |

**u=1 時遠景與標準相同：1 個來源像素已是 1 個實體像素，無法再拉遠而不丟細節。**
介面會明說已達清晰最遠；仍可從特寫／拉近退回標準。想使用更大的遠景視野，可選較大的清晰尺寸；視窗不足仍需捲動。
沒有為了讓「拉遠」看似有效而偷偷加入0.5×降採樣。

UI 的 800×600 座標不變：背包、商店、聊天、tooltip、小地圖、系統／復活視窗不跟世界鏡頭放大。
滑鼠先由實際 canvas rect 轉原 UI 座標；NPC／portal 再經 `screenToWorld` 做鏡頭反轉，UI 命中不套世界 zoom。
世界 culling、背景平鋪、人物、門與掉落使用實際 FOV；鏡頭換 FOV 先保留世界中心，再依目前模式／原地圖界限夾回。
原 EXE `470340` 界限與既有原證見 [PLAYER_PRESENTATION_CAMERA](PLAYER_PRESENTATION_CAMERA.md)；新增視野／轉場是政策，不是新發現的原版功能。

## 效果與生命週期

- 控制器只插值遮蔽 opacity，不插值 bitmap 幾何：180ms 淡出、240ms 淡入，smoothstep `t²(3−2t)`。
- 這些時間是瀏覽器演出政策，不是反編譯常數。動畫用 monotonic absolute time，沒有額外 RAF loop／timer。
- 到遮蔽峰值才切換離散鏡頭；實際 RAF 若跳過精確峰值，compositor 仍把第一張新 FOV 畫格完全遮住。
- 暫停分頁跳過整段效果後直接呈現已完成狀態，不補播陳舊黑畫面。快速改選延續目前遮蔽程度，最新目標生效。
- fade 與 shutter 只蓋世界，HUD／DOM 保持可見；shutter 邊界按整數實體列移動，不用模糊濾鏡。
- 新地圖 art 只在原 map/generation guard 通過後揭幕，過期 fetch 不得觸發效果。離開遊戲取消陳舊過場。
- lens、display、camera 各自保存 browser localStorage；拒絕讀寫仍可本次使用，沒有遊戲 request/save side effect。
- display／lens／camera 都有 idempotent listener dispose；source import 不碰 DOM、不連線、不開服務或瀏覽器。

## strict TS 責任

| 模組 | 責任 |
| --- | --- |
| `client/display.ts` | 五種清晰尺寸、舊值遷移、DPR／共同格／捲動尾端幾何 |
| `client/display-controls.ts` | canvas／DOM／stage、實體 backing、DPR-only refresh、偏好與事件生命週期 |
| `client/scene-surface.ts` | 穩定繪圖 context、兩段合成、有限 buffer、遮蔽、world/screen 互逆 |
| `client/camera-lens.ts` | 四種整數像素視野與純時間轉場狀態機 |
| `client/lens-controls.ts` | 真 DOM、鍵盤隔離、偏好／還原、減少動態與清理 |
| `client/camera.ts`／`camera-controls.ts` | 既有十模式、FOV reframe、回中、listener dispose |
| `client/drop-renderer.ts` | 掉落按實際世界視野 cull，而非誤用至少800寬的共用 buffer |
| `client/cursor.ts` | unknown metadata 守衛、原24×23 arrow、整數實體 bitmap＋image-set DPR 密度 |

游標若先取整小數 CSS bitmap，再讓 OS 乘 DPR，仍可能丟原圖像素；現在直接製作整數實體 bitmap，明示 image-set density。
共同 DPR／UI 倍率由 typed layout callback 一次傳入，DPR-only 也更新 density；128px budget 只以整數因子限制，不降採樣。
它仍是原圖的瀏覽器 cursor plane，不畫 RAF 指標、不改事件座標。實測涵蓋 CSS density 與 PNG 像素塊，不宣稱已擷取 OS 硬體指標畫面。

最大可見 backing 為3200×2400；世界 buffer 最少800×600、最多3200×2400，不每幀重配，也不為12×特寫配置9600×7200。
兩個 RGBA surface 的上限合計約58.6MiB，另有既存資源快取／瀏覽器成本；4×不保證在所有裝置最快。
沒有關 strict、skipLibCheck、allowJs、no-check、加入 production any 或假的 declaration 代替實作型別。
client 現86支 TS，**main.js、3支legacy MJS、深層 runtime schemas 仍是未完債務**。

## 實際驗證（本輪）

- 六個 npm registry latest 再查均與 exact pins 一致：Bun1.4.3／TS7.0.2／@types/bun1.4.3／Prettier3.9.10／Playwright1.64.1／Chromium153.0.0。
- strict、全 TS format check、HTML/CSS 格式與 browser build、diff whitespace 通過。
- focused **58 pass / 0 fail，8 files，7.00s**；新增14案例，既有控制器／輸入／掉落／camera測試同步沿實際委派鏈更新。
- 完整 **1037 pass / 44 fail，1081 tests / 119 files，216.80s**；對2eaa5f2的1023/44逐項 failure multiset 比對，含重複標題新增0／移除0。
  **CI仍不綠**，不skip／縮範圍／修改原admission。初次45fail的舊cursor callback source assertion 已沿新layout參數修正並重跑完整suite。
- 真 Chromium：DPR **1／1.1／1.25／1.5／1.75／2／3 × 五尺寸**，35張實際 screenshot，各取樣32個來源欄，逐欄等寬與0/255無混灰；同頁DPR-only、保存、微小視窗、捲動中段／最底最右、canvas/DOM對齊通過。
- 同一35組檢查原游標 bitmap 的所有整數像素塊、實體尺寸與 image-set density，並非只檢查 CSS 字串存在。
- 真原 WZ 掉落 PNG：四種 UI 倍率 × 四種 lens，整張原圖的輸出像素、來源 alpha 底部貼地、無穿地；UI獨立、不被兩種轉場遮住。
  真 HTML 面板的按鈕／Space／Esc、快速選擇、保存重載／storage拒絕、減少動態、dispose皆通過。
  黑白欄與綠HUD是**隔離fixture診斷**，不是遊戲場地／原素材的替代物，也未注入LIVE世界。
- 四lens × 十跟隨政策的 simulation／collision／movement journal 與不使用鏡頭基線一致；含負座標互逆、窄圖夾限、懸停、連續切換與跳過峰值。
- 子行程 **27 imports／0 I/O attempts**，禁網路、服務、WS與Chromium啟動仍可純匯入。
- LIVE同一PID4942：proxy Host首頁200、**84 modules** HTTP/MIME/JS parser通過；另唯讀標題120幀、page errors=[]、0WS。
  沒有登入、操作角色、讀寫／恢復玩家save或重啟服務；全域save hash不是活躍玩家存在時的有效不變量。

本機可重跑 strict／format／build 與根 `bun run test`。七DPR唯讀診斷使用：

```sh
bun server/scripts/browser_display_probe.ts <明示web-port或http(s)://origin>
```

診斷只改它自己標題頁的測試條紋，不連遊戲或登入。不要把隔離 component／標題頁 PASS 宣稱為已替使用者進場遊玩驗收。
完整log／registry／比較結果在 ignored `generated/pixel-camera/`，不把PNG、生成bundle或玩家資料加進Git。
