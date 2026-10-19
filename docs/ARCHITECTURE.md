# 現行架構：瀏覽器客戶端＋原協定伺服器

更新：2026-10-19。這是實際程式的導覽，不再描述未建立的引擎專案或根 `core/`／`protocol/`。
方向由 ADR-065 確認；版本與升級風險見 [TOOLCHAIN](TOOLCHAIN.md)，證據規則見 [REBUILD_PRINCIPLES](REBUILD_PRINCIPLES.md)。

現行角色互動續作見[NATIVE_PLAYER_INTERACTIONS](NATIVE_PLAYER_INTERACTIONS.md)：原右鍵選單／人氣／派對事件、
輸入捕獲與modal身份；`tools/attach-web.ts` 可另開web橋接連既有本機TCP世界，不複製／重啟世界或操作save。
獨立橋接拿不到原process內的testTools／私人mobPresentation callbacks；未證實邀請身份的舊原生端亦停用invite／accept，與同程序serve有明示差異。

## 執行資料流

```text
桌面瀏覽器 client/
  Canvas 2D + DOM 輸入／命中層 + Web Audio + 純規則模組
       │ 同 origin：HTTP 靜態檔／資源 API、/ws JSON 事件
       ▼
server/src/net/webclient.ts + websocket.ts
       │ 每條 WebSocket 一個 Bun ClientSession
       ▼
server/src/client/session.ts
       │ 原版握手／cipher／CP949／二進位封包，透過 TCP
       ▼
server/src/net/loginserver.ts + game entry
       │
       ├── server/src/game/：場地、角色、道具、交易與記帳
       ├── server/src/protocol/：封包 codecs 與 schema.ts 封包索引
       ├── server/src/game/save.ts：帳號／角色 JSON 保存
       └── server/src/wz/ + game 資源 providers：唯讀 Data.wz → metadata／PNG／音訊
```

原版 TCP 客戶端與瀏覽器橋共用服務與協定能力；瀏覽器不自行實作第二份 cipher，也不直接載入 WZ。
橋上的 JSON event／API 是重建介面，**不是原封包格式的證據**。
web／login／game 是不同 port；伺服器內部可用 loopback，瀏覽器只使用對外 web origin。

## 實際責任與依賴

| 位置 | 責任與界線 |
|---|---|
| `client/main.js` | 啟動、場景整合、輸入與網路狀態；仍過大，未聲稱已完整模組化 |
| `client/*.ts` | 101個實作型別化的動畫／物理／呈現／UI／音訊與共用純規則；無重複 declaration |
| `client/social-commands.ts`／`party-state.ts`／`party-invitation.ts`／`chat-entry.ts` | 原社交指令嚴格解析（`/파티*`／`/귓속말`／`/찾기`＋明示別名）、`55C5E0` 六格名冊狀態、邀請確認所有權與編輯框生命週期；`server/src/net/chat-input.ts` 與 bridge 共用同一路由，斜線行不會落到公開聊天 |
| `client/login-data.ts`／`login-presentation.ts`／`login-screen.ts` | 登入清單unknown守衛、選擇／pending純狀態、原WZ畫布與DOM／焦點／listener lifecycle；transport與creation／avatar透過具體介面注入 |
| `client/feedback-data.ts`／`feedback.ts`／`feedback-renderer.ts`／`item-metadata.ts` | strict收件投影、六列整數alpha／EXP與Notice FIFO、原UI繪製、共用metadata有界cache／重試／取消；不改遊戲獎勵或instance |
| `client/drop-presentation.ts`／`drop-renderer.ts` | unknown drop/remove守衛、連續動畫、原PNG底部貼地與固定金幣幀；不代替server選fh |
| `server/src/game/drop-landing.ts` | 所有掉落的有向真地板／下射線／虛空邊緣權威選點，原0x43格式不變 |
| `client/entity-assets.ts`／`entity-resource-validation.ts`／`avatar-look.ts` | NPC/mob metadata驗證、field ownership／取消、native action量化與local/remote look規則 |
| `client/motion-tuning.ts`／`motion-controls.ts` | 明示非原版本機5–60ms步長／插值選項與純偏好UI，不改server時鐘 |
| `client/scene-surface.ts`／`camera-lens.ts`／`lens-controls.ts` | 整數世界像素／原UI兩段合成、四視野、時間轉場、偏好／減少動態；不改物理／協定 |
| `client/display-controls.ts`／`image-cache.ts` | 視窗／DPR／canvas-overlay-cursor同步與bounded archive/avatar影像生命週期 |
| `server/src/net/client-event-json.ts` | 真bridge的純收件JSON projection，保留system-notice.type／field epoch，供合併加密TCP回歸共用 |
| `server/src/client/` | 瀏覽器 session 對原協定的轉換；不直接代替服務端權威落帳 |
| `server/src/net/` | TCP、WebSocket、HTTP、登入／遊戲連線與 capture |
| `server/src/protocol/` | bytes、cipher、字串、各系統 codec；`schema.ts` 索引已知／partial／skeleton |
| `server/src/game/` | 場地、保存、數值與物品權威；另含 WZ 資源呈現資料與重建政策 |
| `server/src/wz/` | WZ 產品 reader、值層／像素／PNG；執行時直接讀 archive |
| `server/scripts/browser-fixture.ts`／`browser-observation.ts` | 明示手動fixture admission、有界純觀測；匯入無連線／登入；7支browser runner與frame／play為strict TS；後者共用probe-field／probe-frame／probe-play |
| `tools/` | Bun TS靜態分析、工具鏈安裝、browser build、保護既有save與明示新fixture啟動 |
| `analysis/` | 既有研究輸出，不能把過時 manifest 描述當現在的解析結果 |
| `generated/` | 可重建工具／素材與不可隨意重建的玩家 save／備份並存；均忽略但重要性不同 |

**共用邏輯現況**：server 會 import `client/jobs.ts`、`characterstats.ts`、`mobmotion.ts`、
`client/social-commands.ts`、`client/party-state.ts`（`PARTY_MAX_MEMBERS` 由 `protocol/party.ts` 再匯出）等純模組，
所以不能再寫「server 絕不 import client」。這些模組不得在載入時碰 DOM／Canvas／Audio；
未來可獨立成共用目錄，但目前沒有建立 `shared/`，本輪也不搬路徑，以免破壞既有匯入與資源 URL。
不能把此債務或未來方向描述成已完成的架構。

## 普通身體動作與幾何分界

`game/avatarmotion.ts`讀body幀表與武器walk/stand → ArtProvider／HTTP metadata →
`client/avatar-motion.ts`普通倒數 → `main.js`場地／typed login-presentation／creation →既有avatar PNG compositor。
`motion.ts`保留幾何並re-export普通clock；不讓新身體時序改movement byte、傷害或attack forced override。
actor持有clock與已完成的immutable weapon profile；64座metadata cache去重／退避，滿pending不逐RAF相互驅逐。
只讀開發閱覽用獨立actor及look副本，不與selfView／inventory／save混用；見[NATIVE_AVATAR_MOTION](NATIVE_AVATAR_MOTION.md)。

## 呈現與資源

- UI／DOM保持800×600邏輯座標；世界有獨立FOV，以整數實體倍率兩段合成。五種清晰尺寸，小視窗捲動不降採樣；見[PIXEL_CAMERA](PIXEL_CAMERA.md)。
- `requestAnimationFrame` 驅動呈現；重建物理、時鐘、插值與動畫不等於完整原 CVecCtrl／CShape2D。
- Web Audio 解碼／播放原資料所對應的音訊；不重寫 DirectSound／ACM 相容層。
- `game/wzart.ts` 做 path／UOL／canvas reader 與快取；mapart／avatar／sprites 等供應渲染資料。
- PNG、metadata、音訊由既有 `/api/...` 輸出，瀏覽器資源快取與取消／identity guard 管理生命週期。
- 最終canvas以整數layout box＋inverse DPR transform呈現，避免1/64 CSS px寬高量化；stage clip隔離未縮小的layout overflow。42組完整原素材screenshot像素比較通過（ADR-085）。
- `display-controls.refresh` 接既有app frame，不新增loop／timer，處理不發resize/change的DPR-only切換；只在實體倍率變化時重配800u×600u輸出backing。
- archive1024 FIFO/UI優先（仍hard bound）、avatar256 LRU/實際blink預熱是browser policy，不是原EXE常數。
- `assets/` 離線輸出仍可供分析，但不是 runtime 必經的「先全量轉檔」階段。
- 原字型未隨專案重建；Gulim／本地合法 fallback 的 metrics 與 GDI 不保證像素相同。

## 權威、保存與安全界線

server 控制角色／物品／金錢／共享場地的落帳；原 client 回報傷害或路徑與現行接受政策須分開記錄。
「server 有權威狀態」不代表反作弊、所有回報驗證、分散式交易或原 server 規則已完成。

JSON save 先寫暫存檔再改名；這不是資料庫交易、全機斷電保證或跨程序協調方案。
目前並非正式多節點 MMO 架構。帳號安全、TLS、備份恢復、營運監控與容量仍需另行評估。

存檔用明確 `--save` 路徑；找不到舊檔不可自動 seed 來冒充恢復。
停服後冷備當下最新檔，再以同一路徑啟動。ignored／沙箱暫存不等於永久備份。
根目錄原 EXE／DLL／C／LST／Data.wz 是唯讀證據，保留位置，不作 runtime 相容層。

## 工具鏈與驗證狀態

根 `.bun-version`／`package.json`／`bun.lock`／`tsconfig.json` 是唯一工具鏈；Bun1.4.3／TS7.0.2，
ESNext／strict／unused／erasableSyntaxOnly／skipLibCheck=false。CI的checkout/setup-bun固定SHA，不另裝Node/Python。
`node:`標準庫由Bun相容實作，不是另一個runtime；產物JS不等於authored JS已遷移。

main.js與client_probe.mjs仍未完成型別化；frame／play已刪舊MJS並遷為真正strict TS，見 [工具續作](STRICT_FRAME_PLAY_TOOLS.md)；已typed whisper還有未按當前admission重建的歷史情境。
最新frame／play增量：strict／format／build、focused25/0；完整1064/44（1108tests／124files，267.35s），對本輪前基準failure multiset新增0／移除0。
前輪完整1054/44（1098tests／122files，285.07s），對1520ac9既有44個failure multiset未增減，CI仍不綠。strict／format／build通過不代表全遊戲驗收。
前輪login UI另有真HTML／WZ component、21組原renderer完整邏輯畫布RGBA相等與30純imports／0 I/O；LIVE同PID4942、87modules與唯讀標題120幀，0WS，不登入或操作玩家。既有七DPR×五尺寸／游標與world/UI／zoom screenshot回歸保留。
歷史PID4942／入口已不在當前沙箱；本輪不宣稱恢復其程序或ignored save。本輪已依既有授權開全新隔離入口：8515與ignored generated/preview-20261019-tool-cleanup.json，preview／observer新level1進度，非恢復；title-only驗證0WS且save hash不變，不覆蓋既有save。
掉落的全100張原WZ地圖／379422組驗證及呈現政策見 [DROP_FOOTHOLD_LANDING](DROP_FOOTHOLD_LANDING.md)。
標題／登入／世界與選角責任、原證及驗證見 [STRICT_LOGIN_UI](STRICT_LOGIN_UI.md)。
鏡頭／合成／清晰尺寸見 [PIXEL_CAMERA](PIXEL_CAMERA.md)。詳 [BUN_MIGRATION](BUN_MIGRATION.md)／[BROWSER_TOOL_CLEANUP](BROWSER_TOOL_CLEANUP.md)／[MOTION_EXPERIMENTS](MOTION_EXPERIMENTS.md)／[STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)。
