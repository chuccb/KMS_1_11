# 路線圖（完整 MMO + 跨平台）

> 每個 Phase 都有**出口條件（exit criteria）**；未達成不進入下一階段。
> 括號內為「單人 + AI 輔助」的粗略估計。

## Phase 0 — 證據與 oracle（進行中，~4–6 週）

| 工作 | 狀態 | 出口條件 |
|---|---|---|
| WZ 容器/樹/字串解碼 | ✅ 完成 | `tools/wz1.py` 解析 1,052 張 `.img` |
| `.img` 屬性樹 | ✅ 結構完成 | 186 個屬性完整還原（`analysis/sample_Cap_01000000_properties.txt`）|
| `.img` 像素（canvas + ZLZ） | ✅ 完成 | `node server/src/cli.ts wz png <image> --out assets/` 把每張 canvas 寫成 PNG；三個像素格式（ARGB4444／A8R8G8B8／RGB565）都有 binary 證據（`docs/WZ1_FORMAT.md` §4.6），並已用眼睛驗過 `Mob/1210102.img`（주황버섯）與 `UI/Basic.img`（97 張 canvas）|
| 協定：framing / cipher | ✅ 完成 | 握手、雙方向標頭、LCG 金鑰全部有 binary 證據（FINDINGS §2–§3）|
| 協定：dispatch/opcode 表 | 🟢 | 分派鏈已完整定位（FINDINGS §4.1／§4.7：階段 → opcode → 子系統）；client 送出的 39 個 opcode 已建目錄，**登入鏈四個階段（§4.8／§4.9）與遊戲內第一條垂直切片（§4.11：進地圖 0x16、別人進場 0x1C、離場 0x1D、移動 0x22／0x0E、傳送門 0x0D）都已解到欄位層**。剩下的：CField 其餘區間（§6 第 3 項）與 §4.11 的三個 UNKNOWN |
| 握手 `body` 的 199 bytes | ⬜ | 語意未知；只有長度規則（§6 第 2 項）|
| **capture harness** | ✅ 完成 | `node server/src/cli.ts capture` 能錄下並即時解密原 client 的封包序列 |
| 登入鏈可重播 | ✅ 完成 | `server/test/loginflow.test.ts` 用假 client 走完 握手→登入→選世界→選角→遷移+token |
| client → server 遊戲內目錄 | 🟡 | 39 個 sender 全部列出、其中聊天／密語／組隊／交易／商城／GM 指令有語意證據（FINDINGS §4.13）；**攻擊三兄弟 `0x0F`／`0x10`／`0x11` 全部 byte-exact 解出、共用一個 codec 並各有 golden 測試**（§4.13.1／§4.13.1b）；缺的是真實流量驗證 |
| 遊戲內階段（0x16 進地圖）| 🟡 | 遊戲伺服器領到 `0x04` 後送 `0x16`（地圖由 `--map` 決定，預設 `1000000`），接著**依地圖自己的 `life` 清單送 `0x2F` 怪物進場**、讓怪物**沿腳踏點折線巡邏（每段一個 `0x33`）**，再把 client 報的**傷害**記在怪物的 HP 上：命中回 `0x34`、殺死送 `0x30`、死亡動畫結束後 `0x31` 收屍、`--mob-respawn` 之後重生（`--data` 指定 `Data.wz`，預設自動取用工作目錄的 `./Data.wz`；`--mob-speed` 調巡邏速度；FINDINGS §4.11.2b／§4.15／§4.16／§4.17），假 client 逐欄驗證；**尚未實機驗證**，且還沒有掉落物與怪物 AI |
| 登入伺服器可跑 | 🟡 | `node server/src/cli.ts serve` 已能服務 0x01/0x02/0x03/0x05/0x06（記憶體帳號）＋角色 id 交接；**待原 client 實機驗證**（含 `0x16` 進地圖）|
| 腳踏點幾何 | ✅ 完成 | `foothold/<page>/<group>/<item = life.fh>` 的 item key 就是出生點指的腳踏點，`prev/next` 串成折線；**全部 100 張地圖 30,338 個線段無重複 key、2,322 筆 `life` 全數落在自己的線段上且 y 等於 `cy`**（誤差 ≤ 1；FINDINGS §4.16.4），怪物的巡邏範圍由它決定 |
| 怪物移動 | 🟡 | `0x33` 逐 byte codec（`sub_488BC0` 的指令級證據）＋ `src/game/mobs.ts` 的巡邏（每段一個 `0x33`、`info.speed` 百分比、`PATROL_SPEED_PX_PER_SEC` 基準值可調）；**尚未實機驗證**，且沒有 AI（只有兩張測試圖有攻擊資料）（§4.16）|
| 地圖 id 與載入器 | ✅ 完成 | `CharacterData.mapId`（第 23 欄）就是地圖 id：`0x16` → `sub_468E00` → `sub_4694F0` 載入 `Map/Map/%09d.img`（FINDINGS §4.11.2b）；地圖載入器的全部 WZ 路徑已列表，`server/src/wz/paths.ts` 收錄伺服器要用的三個 |
| 場地亂數種子 | ✅ 完成（含移植）| `0x16` 的三個 u32 是客戶端自訂亂數產生器的種子（FINDINGS §4.11.2：`sub_4C7930`→`sub_48A900`，反函式 `sub_4619F0` 就是 `Random()`）；伺服器可重算客戶端回報的傷害；`src/protocol/random.ts` 已逐位元移植並有 golden 測試 |
| 遊戲內封包 codec | 🟡 | `field.ts`／`movepath.ts`／`mob.ts` 已有 0x16／0x1C／0x1D／0x22／0x0E／0x0D／**0x0F 攻擊**／**0x2F 怪物進場**／**0x33 怪物移動**／**0x30 死亡**／**0x31 收屍與重生**／**0x34 怪物 MP** 的逐 byte codec（`test/field.test.ts`／`test/mob.test.ts`／`test/mobs.test.ts` golden 覆蓋）；`src/game/{map,mobs}.ts` 已能把 `life` 變成出生點、沿腳踏點巡邏、並把 client 報的傷害記在怪物 HP 上（§4.15／§4.16／§4.17）|
| 協定目錄（可查詢）| ✅ 完成 | `server/src/protocol/schema.ts`（FINDINGS §4.14）：38 列的 `direction`／`stage`／`status`／`evidence`／`codecs`／`fields`，opcode 一律引用既有常數；`node server/src/cli.ts schema [--json]` 可查；6 個反漂移測試（codec 名稱、唯一性、skeleton 不得有欄位、必須被 decode 認得）|
| 打怪的閉環 | 🟡 | 傷害照 client 的數字記帳（ADR-006）、`0x34`／`0x30`／`0x31` 三個封包與收屍／重生計時（`--mob-respawn`），`Mob/<id>.img` 的 `maxHP`／`maxMP`／die 動畫長度都從 WZ 讀（FINDINGS §4.17）；假 client 逐欄驗證、真 `Data.wz` 實跑 45 隻怪（§4.17.5）；**尚未實機驗證**，且沒有掉落物與怪物 AI |
| oracle 重現 | ⬜ | 原 client 能連上我們的 listener 並完成握手（不 crash） |

**出口條件**：能回答「這個封包是什麼意思」，且每個答案都有 binary 或擷取證據。

## Phase 1 — 資源管線與協定 schema（~3 週）

- `server/src/wz/`（ADR-005）：`Data.wz` → `assets/`（PNG + 動畫 JSON + OGG + bitmap font + manifest）；
  目錄樹／值層／定位／PNG 已完成，剩下的動畫 JSON 與 OGG 是包裝層
- `protocol/schema/`：從 Phase 0 的 opcode 表建立 schema；產生 TypeScript codec 與 **golden 測試向量**
- 出口條件：`node --test` 通過 schema 產生的所有 golden bytes 測試；`assets/` 可用工具重建且雜湊一致

## Phase 2 — 伺服器骨架（~6–8 週）

- login（帳號/版本/世界列表）→ world（頻道/角色列表）→ channel/game（進入地圖）
- 會話生命週期、持久化（角色存檔）、結構化日誌、可重播的封包 trace
- 出口條件：2 個 client 可各自登入、選角、進入同一張地圖並互相看見移動

## Phase 3 — 客戶端殼層（~8–12 週）

- 地圖繪製（Back/Obj/Tile 分層 + z-order）、角色/怪物動畫、UI（Login/CharSelect/HUD/Item/Skill）、音訊
- 輸入：鍵盤 + 手把；韓文輸入以平台層 fallback（不重寫 IMM32）
- 出口條件：能在 Windows / macOS / Linux 上開發與遊玩；**同一份專案可 export web 並能登入**

## Phase 4 — 遊戲系統（~8–12 週）

- 移動/跳躍/繩梯/傳送門、戰鬥與傷害公式、怪物 AI 與重生、掉落/拾取、
  經驗/升級/能力點、裝備/背包/商店、頻道切換、組隊/好友（若有證據支持）
- 出口條件：每個系統都有「與 oracle 的差異清單」，且清單為空或每項都有紀錄

## Phase 5 — 內容與驗收（持續）

- 逐系統 1:1 比對 2003 行為；建立回歸測試（golden packets + 模擬 client）
- 出口條件：可從零開始完成「登入→選角→練功→交易」不中斷的長時間測試

## 風險與對策（現行）

| 風險 | 對策 |
|---|---|
| 協定 dispatch 未定位 | 先做 capture（不依賴反編譯）；兩條路並行 |
| 2 張背景 canvas 的 stream 被截斷、`pad` 語意未解 | 只影響 `Map/Back/dryRock.img`／`midForest.img`，已標記 `partial`（其餘像素為 0），列在 `docs/WZ1_FORMAT.md` §4.8 |
| 「現代 MapleStory 規則」污染 2003 行為 | 每系統一頁 evidence（結論/證據/confidence），查不到就標 UNKNOWN 並不做 |
| 範圍爆炸 | 嚴守 Phase 出口條件；先垂直切片（登入→進圖→走跳→打怪） |
| 版權 | 僅研究/私人用途；`assets/` 與衍生資料不進 git、不公開發布 |
