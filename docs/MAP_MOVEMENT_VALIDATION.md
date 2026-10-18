# 地圖素材與移動回歸（2026-10-17）

> 後續ADR-082：7支browser工具已真正遷成TS；本頁舊node／MJS命令及PASS保留歷史時點，不是現行操作入口。
> 現行安全命令、未執行的手動場景與最新型別整理見 [STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)。

> 後續繩索合成／移動修正與 BGM／音效的最新驗證見 `CLIMB_AUDIO_VALIDATION.md`；以下記錄的是先前素材修正階段。


## 更正：Data.wz 沒有缺少先前指稱的素材

錯誤在 reader，不在原檔；本次沒有修改 `Data.wz`。

1. 目錄 tag 2 是 entry 參照，必須繼承目標的**名字與型別**。先前漏掉 type 4，導致 `Map/Tile/{darkCave,darkWood,dryRock,grassySoil}.img` 沒有列入 image，後續累積 offset 也算錯。先前「孤兒資料／需要掃描重新定位／缺 grassySoil」的結論撤回。
2. Canvas 的舊欄位名 `pad` 實為**放大層級**。`Canvas.dll.c sub_100162B0` 以 `x >> level, y >> level` 取樣。`dryRock/back/0` 與 `midForest/back/0` 的 level 4 像素各覆蓋 16×16 顯示像素，512／128 bytes 都是完整原生 buffer；不能補零或跳過。像素解碼與 art reader 的完整性檢查均已修正。

### 可重現的原檔檢查

- 1,056 images：全部 declared，scanned=0、unlisted=0、missing=0。
- 每張 image 的原始 blob byte-sum 與目錄 checksum 相等，**1,056/1,056**；所有 blob 恰好連續填滿 `treeEnd=0x756E` 到 EOF。
- 55,446 canvases（55,381 ARGB4444、65 RGB565）：**全部原生 buffer 完整解碼**，short=0、未解碼=0。
- 全 100 張 `Map/Map/*.img` 經實際 art loader 載入，missing tiles=0、missing tile sets=[]。這是素材載入檢查，不代表逐張人工看過畫面。
- `analysis/data_wz_manifest.{txt,json}`、`analysis/map_meta.json` 已重新產生；舊說法同步從格式文件與實作註解移除。

## 移動與場景修正

- `client/motion.mjs` 接入真正的 render loop：8ms fixed step、重力、加減速、單向平台、連接斜坡、牆、跳躍、下跳、梯子／繩子；不再每次 timer 任意移動 XY。
- ordinary movement baseline 依 `sub_5378D0/sub_537CA0/sub_5382F0`：走速 125px/s、jump -555px/s、重力 2000px/s²、落速上限 670px/s。鏡頭 easing 亦改為依 elapsed time。
- 網路 snapshot 以 10Hz 發送位置／action／velocity／foothold；本地 echo 不再覆蓋本地物理。遠端玩家與怪物保留並播放每個 path element 的 duration；怪物沿 foothold polyline 走，不直接移到封包終點。
- tile：`30000*layer - 10*zM + frameZ`；object：`30000*layer + z - 17990`；角色／mob：`30000*page - 2*group + 10008`；NPC：+10009。以上均相對 tile 的共同原版 base `-1073721834`。
- drops 由 `sub_4A88A0` 證實為同 page/group 的 +10011；portals 由 `sub_4A3920` 的固定 z `-1073471724` 正規化為 250110。都加入同一 scene 排序，避免先畫完再被普通 tiles 蓋住。
- 移除人工 foothold 平台繪圖；地圖顯示原 WZ 圖層，而非替代地形。

## 已執行驗證

| 驗證 | 結果 |
|---|---|
| `cd server && npm run check` | **521/521 PASS**，其後 TypeScript typecheck 通過 |
| `python3 -m unittest discover -s tools/tests -v` | **47/47 PASS**（仍有既有未關閉檔案的 ResourceWarning） |
| `node --test server/scripts/motion_probe.mjs` | **15/15 PASS**，亦由上述 server suite 的 wrapper 執行 |
| `node server/scripts/client_probe.mjs` | SMOKE / SHOP REGRESSIONS / TITLE REGRESSIONS OK |
| `node server/scripts/frame_probe.mjs 8495` | FRAME SMOKE OK；真 HTTP art 請求、missingTiles=0、無 fallback ground，item/meso drop 均有繪製 |
| `server/scripts/browser_motion_probe.mjs 8495`，外部 Playwright + Chromium | **REAL BROWSER MOTION OK**，非 DOM shim；登入／選角／載圖／行走／上升／下落／真 foothold 落地，browser exceptions=[]，mob path duration=3000ms |

Chromium 的實際 map 截圖輸出於忽略版控的 `generated/validation/map-{before,jump,after}.png`，已檢視地形與角色畫面。重跑 browser probe 需要另外安裝 Playwright 或設定 `PLAYWRIGHT_MODULE` 與 `CHROMIUM_EXECUTABLE`；未把 browser binary、PNG 資產或額外 npm dependency 加進產品。

## 尚未聲稱完成的部分

這不是「整個遊戲 1:1 已完成」的結論。water／flight／knockback／skill 等特殊移動狀態未涵蓋；伺服器的怪物 patrol／respawn policy 仍是重建版設定（包括 baseline 60px/s），不是已證實的原版伺服器 AI。原版使用者 depth 的額外 +2 條件仍需定位。100 地圖素材檢查也不取代逐張視覺對照。
