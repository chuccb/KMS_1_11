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
| client → server 遊戲內目錄 | 🟡 | 39 個 sender 全部列出、其中聊天／密語／組隊／交易／商城／GM 指令有語意證據（FINDINGS §4.13）；**攻擊三兄弟 `0x0F`／`0x10`／`0x11` 全部 byte-exact 解出、共用一個 codec 並各有 golden 測試**（§4.13.1／§4.13.1b）；**`0x2C`（怪物動作回報）已解出頭 4 個欄位**（§4.20，尾段未解）；缺的是真實流量驗證 |
| 怪物 AI 在哪一側 | ✅ 完成（決策）| **在 client**：`sub_4862C0` 是 `CMob` 的 per-frame virtual，攻擊挑選（`sub_487D10`）與命中影格（`sub_487A30`）都在 client 裡，伺服器只收到 `0x2C` 的回報（FINDINGS §4.20、DECISIONS ADR-008）。ROADMAP 的「怪物 AI」因此列在 Phase 3/4 的 client，伺服器對應的是 `0x2C` 記帳與 `0x35` 轉播 |
| 遊戲內階段（0x16 進地圖）| 🟡 | 遊戲伺服器領到 `0x04` 後送 `0x16`（地圖由 `--map` 決定，預設 `1000000`），接著**依地圖自己的 `life` 清單送 `0x2F` 怪物進場**、讓怪物**沿腳踏點折線巡邏（每段一個 `0x33`）**，**依同一份 `life` 清單送 `0x39` 讓 NPC 進場**（`Npc/<id>.img` 不存在就不生成），再把 client 報的**傷害**記在怪物的 HP 上：命中回 `0x34`、殺死送 `0x30`、死亡動畫結束後 `0x31` 收屍、`--mob-respawn` 之後重生，最後**掉寶與拾取**（殺死時依掉落表送 `0x43`、玩家走到上面時 `0x44 kind 2`＋`0x0B`＋`0x11`；`--data` 指定 `Data.wz`，預設自動取用工作目錄的 `./Data.wz`；`--mob-speed` 調巡邏速度；FINDINGS §4.11.2b／§4.15／§4.16／§4.17／§4.18），假 client 逐欄驗證；**尚未實機驗證**，且還沒有怪物 AI |
| 登入伺服器可跑 | 🟡 | `node server/src/cli.ts serve` 已能服務 0x01/0x02/0x03/0x05/0x06（記憶體帳號）＋角色 id 交接；**待原 client 實機驗證**（含 `0x16` 進地圖）|
| 腳踏點幾何 | ✅ 完成 | `foothold/<page>/<group>/<item = life.fh>` 的 item key 就是出生點指的腳踏點，`prev/next` 串成折線；**全部 100 張地圖 30,338 個線段無重複 key、2,322 筆 `life` 全數落在自己的線段上且 y 等於 `cy`**（誤差 ≤ 1；FINDINGS §4.16.4），怪物的巡邏範圍由它決定 |
| 怪物移動 | 🟡 | `0x33` 逐 byte codec（`sub_488BC0` 的指令級證據）＋ `src/game/mobs.ts` 的巡邏（每段一個 `0x33`、`info.speed` 百分比、`PATROL_SPEED_PX_PER_SEC` 基準值可調）；**尚未實機驗證**，且沒有 AI（只有兩張測試圖有攻擊資料）（§4.16）|
| 地圖 id 與載入器 | ✅ 完成 | `CharacterData.mapId`（第 23 欄）就是地圖 id：`0x16` → `sub_468E00` → `sub_4694F0` 載入 `Map/Map/%09d.img`（FINDINGS §4.11.2b）；地圖載入器的全部 WZ 路徑已列表，`server/src/wz/paths.ts` 收錄伺服器要用的三個 |
| 場地亂數種子 | ✅ 完成（含移植）| `0x16` 的三個 u32 是客戶端自訂亂數產生器的種子（FINDINGS §4.11.2：`sub_4C7930`→`sub_48A900`，反函式 `sub_4619F0` 就是 `Random()`）；伺服器可重算客戶端回報的傷害；`src/protocol/random.ts` 已逐位元移植並有 golden 測試 |
| 遊戲內封包 codec | 🟡 | `field.ts`／`movepath.ts`／`mob.ts`／`npc.ts` 已有 0x16／0x1C／0x1D／0x22／0x0E／0x0D／**0x0F 攻擊**／**0x2F 怪物進場**／**0x33 怪物移動**／**0x30 死亡**／**0x31 收屍與重生**／**0x34 怪物 MP**／**0x35 怪物動畫**／**0x2C 怪物動作回報（頭 4 欄）**／**0x39 NPC 進場**／**0x3A／0x3B NPC 離場與第二狀態**／**0x0D 能力值差異**／**0x4A／0x4B 商店＋0x16／0x33 商店請求與物件點擊＋空的 0x19** 的逐 byte codec（`test/field.test.ts`／`test/mob.test.ts`／`test/mobs.test.ts`／`test/npc.test.ts`／`test/stat.test.ts`／`test/shops.test.ts` golden 覆蓋）；`src/game/{map,mobs,npcs}.ts` 已能把 `life` 變成出生點、沿腳踏點巡邏、把 client 報的傷害記在怪物 HP 上、並讓 NPC 進場（§4.15／§4.16／§4.17／§4.19）|
| 協定目錄（可查詢）| ✅ 完成 | `server/src/protocol/schema.ts`（FINDINGS §4.14）：54 列的 `direction`／`stage`／`status`／`evidence`／`codecs`／`fields`，opcode 一律引用既有常數；`node server/src/cli.ts schema [--json]` 可查；6 個反漂移測試（codec 名稱、唯一性、skeleton 不得有欄位、必須被 decode 認得）|
| 型別檢查（strict TS）| ✅ 完成 | `server/tsconfig.json`：`strict`＋`noImplicitOverride`＋`noFallthroughCasesInSwitch`＋`noUnusedLocals/Parameters`＋`erasableSyntaxOnly`（**只允許 Node 的 strip-types 吃得下的語法**）、`noEmit`；`cd server && npm install && npm run typecheck` 在 `src/`＋`test/` 上 0 錯誤（272 個測試同時通過）|
| 打怪的閉環 | 🟡 | 傷害照 client 的數字記帳（ADR-006）、`0x34`／`0x30`／`0x31` 三個封包與收屍／重生計時（`--mob-respawn`），`Mob/<id>.img` 的 `maxHP`／`maxMP`／die 動畫長度都從 WZ 讀（FINDINGS §4.17）；假 client 逐欄驗證、真 `Data.wz` 實跑 45 隻怪（§4.17.5）；**尚未實機驗證**，且沒有怪物 AI |
| 經驗值與升級（`0x0D`）| 🟡 | 能力值差異包**已完整解出**（§4.21）：`u8 ack` ＋ `u32 flags`（19 個 bit，`0x01`…`0x40000`，依旗標順序一個欄位）＋ `u32 panelFlags`（0 = 後面沒有東西）；⚠️ 三個欄位的**線上寬度與 `CharacterData` 不同**（`str`/`dex`/`int`/`luk` 是 1 byte、`unknown26`／`fame` 是 4 bytes）。經驗值表是**算出來的**（`sub_4C7110`：1–5 `n(n²/2+15)`、6–50 `q(q+19)`／`q=n²/3`、51–200 ×1.0548），與公開的 2003 表 **196/200 相同，四個差異是複本打字錯誤**。伺服器端 `protocol/stat.ts`（`diffStats` 只送有變的欄位）＋`game/exp.ts`（升級補滿 HP／MP），殺怪後先送 `0x0D` 再掉寶；21 個新測試，並在真 `Data.wz` 的 달팽이사냥터（地圖 40000）實跑：殺五隻 달팽이後客戶端收到 `flags=0x00010010 level=2` 的升級差異（§4.21.5）。**`panelFlags != 0` 的能力面板／buff 區塊未解**、升級的 `maxHp`／`ap`／`sp` 成長量是原伺服器的數字（目前不送）、被怪物打不會掉血 |
| NPC 商店（`0x4A`／`0x4B`／`0x16`／`0x33`）| 🟡 | `0x49`–`0x4C` 只有 `0x4A`／`0x4B` 有 handler（§4.22）：`0x4A` 開 `CShopDlg` 並讀 `u32 shopId`＋`u16 count`＋每列 `u32 itemId`／`u32 price`／（207 家族多 8 bytes）／`u16 maxCount`；`0x4B` 只讀一個 `u8`（0 沉默、1/4 東西不夠、2 錢不夠、3 格子不夠、>4 錯誤），而且**只有在請求在途時才合法**（否則 client 自己丟 `CDisconnectException`）；client 端 `0x33`「點擊場地物件」＋`0x16` 的四個動作（買／賣／充電／關窗）。伺服器端 `protocol/shop.ts`＋`game/shops.ts`（價格一律讀 `info/price`，庫存與收購價是我們的選擇，ADR-010）＋`loginserver.ts` 的兩個 handler；真 socket 走完「點 NPC → 開窗 → 買 → 錢不夠 → 關窗」。**`0x49`／`0x4C` 沒有 handler、207 那 8 bytes 的內容未知（只攜帶不產生）、充電未實作、NPC 對話／任務（`0x46`–`0x48`）仍 OPEN** |
| 掉落與拾取 | 🟡 | 四個封包全部 byte-exact：`0x43`（掉落物出現，含「從怪物身上飛出來」的怪物區塊，只有 `kind <= 1` 有）、`0x44`（消失／被撿走，`kind 2` 帶撿的人的角色 id）、`0x0B`（道具欄異動，**沒有種類位元組**：欄位自己就是種類提示）、`0x11`（獲得提示）；`0x42`／`0x45` 在 client 裡**沒有 handler**（FINDINGS §4.18）。伺服器端 `game/drops.ts`（掉落表、落點吸附腳踏點、壽命、可撿範圍）＋`game/rewards.ts`（堆疊 200、裝備不堆疊、`MesoWallet`）；掉落率等**七個常數是伺服器的選擇**並集中成常數（ADR-007）；真 socket 測完整迴圈（殺怪→`0x43`→走過去→`0x44 kind 2`＋`0x0B`＋`0x11`）；**客戶端的錢包顯示會跟著動**（§4.22.5：`+89/+93` 就是錢，`0x0D` 的旗標 `0x40000` 送它；`MesoWallet` 已改成同一份紀錄的視圖）|
| NPC 進場 | 🟡 | `0x39`／`0x3A`／`0x3B` 三個封包 byte-exact（`sub_49F6C0`／`sub_49F810`／`sub_49F970`）：**已知 id 的 `0x39` 只有 5 bytes**（只設 `+24` 的 bit 0，即「重新整理」），新 id 才帶模板與六個欄位（共 20 bytes），**沒有**怪物 `0x2F` 的動畫旗標區塊（`Npc/%07d.img` 由 client 自己播 `stand`）；`0x3B` 的 `u8 flag` 在 `u32 npcId` **之前**。伺服器端 `game/npcs.ts`（id 從 1 起算、**永不重用**、模板查不到就不生成）＋`protocol/npc.ts`；真 `Data.wz` 實跑 헤네시스 2 個 NPC（메이플운수 중형택시／리나）與 달팽이사냥터 1 個（로빈）。**尚未實機驗證**；`0x38`／`0x41` 無 handler、`0x3D`（會走動的 NPC）與第 5–7 欄語意仍 OPEN（FINDINGS §4.19）|
| 怪物動作回報（`0x2C`）與動畫（`0x35`）| 🟡 | `0x35`（s2c）**byte-exact**：`sub_492380` case '5' → `sub_488E10` = `sub_4C6CE0(mob+136, …)`，也就是 `0x2F` 尾巴那塊動畫區塊（同一份 codec，測試直接比對 bytes 相同）；`0x2C`（c2s）解出頭 4 欄（`u32 mobId`、旗標、動作位元組、位置），**尾段（`sub_495880`→`sub_495620`）未解、原封不動保留**；`describeClientFieldPacket`／`serve` 會把原 client 的怪物攻擊寫成一行日誌（FINDINGS §4.20）|
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
- `0x2C` 的記帳（誰被哪隻怪打了）與 `0x35` 的轉播（其他 client 看到同一隻怪的動作）；
  玩家 HP 的可見變化用 `0x0D`（能力值差異包，§4.21 已解出）驅動——**被怪物打的扣血路徑還沒接上**
- 出口條件：2 個 client 可各自登入、選角、進入同一張地圖並互相看見移動

## Phase 3 — 客戶端殼層（~8–12 週）

- 地圖繪製（Back/Obj/Tile 分層 + z-order）、角色/怪物動畫、UI（Login/CharSelect/HUD/Item/Skill）、音訊
- 輸入：鍵盤 + 手把；韓文輸入以平台層 fallback（不重寫 IMM32）
- 出口條件：能在 Windows / macOS / Linux 上開發與遊玩；**同一份專案可 export web 並能登入**

## Phase 4 — 遊戲系統（~8–12 週）

- 移動/跳躍/繩梯/傳送門、戰鬥與傷害公式、**怪物 AI 與重生（在 client，照 ADR-008）**、掉落/拾取、
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
