# 路線圖（完整 MMO + 跨平台）

> 最新實作（**未測試／未typecheck／未browser**）：原30ms自然HP／MP恢復、回血／回魔／繩梯被動、map recovery與0x1C→0x0D；另加明示非原版的帳號授權體驗面板（職業／AP SP／vitals／地圖／能力技能還原點），不重seed、不自動改角色。還原點僅服務記憶體、升級保護，不回溯EXP／道具／金錢。見 `RECOVERY_TEST_TOOLS.md`／ADR-049。主動施放／其他被動buff／轉職自然發點仍缺。

> 前輪實作（**未測試／未typecheck／未browser**）：原四列 CUISkill、真 WZ 技能書／前置／max、SP 單點學習 0x1D→0x0E／拒絕 release／map32 保存與已學 snapshot；成長被動共用紀錄。原 PE 職業表與 ancestry 更正，初心者空書、不改體驗進度。**主動施放、其他被動效果／buff、轉職與自然 AP/SP 尚未完成**；tooltip 是簡化版。見 `SKILLS.md`／ADR-048。

> 前輪實作（**未測試／未typecheck**）：更正4C7450的舊誤讀，PE原表自然HP／MP、逐級成長、已學被動x/y、一般穿戴INT、HP／MP AP／原六按鈕、殺怪與加點即時保存。見 `STAT_GROWTH.md`／ADR-047。**自然AP/SP發放仍未定位，不套5/3**；當時缺的技能學習／SP操作已於ADR-048接線（仍未測），Detail／完整裝備buff依賴仍缺。按使用者選擇開啟全新隔離體驗檔，非舊進度。

> 最新實作（**未測試／未typecheck**）：原武器normal動作表與逐幀WZ速度、弓弩拳套基本選彈／空射扣彈、0發207／末箭清格、0x10→0x24與原bullet／afterimage、延後命中、2型待機行走。見`BASIC_ATTACKS.md`／ADR-046。技能攻擊、原CShape2D碰撞及完整傷害公式仍未完成。

> 最新實作（**未執行任何測試／typecheck／瀏覽器**）：原CUIItem金幣按鈕、0x1F丟楓幣／非零0x0D ack、207補充double／WZ容量、price0補充列表、整組購買／出售／交易與0發物件；拾取立即保存及錢包溢出保護。見 `MESO_RECHARGE.md`／ADR-045。當時的基本射擊／扣彈缺口已於ADR-046接通（未測試）；技能容量／多發等仍未完成。

> 最新實作（**依使用者要求未測試**）：背包超過24格的原捲動／真slot命中、0x17地面丟棄與數量／4031確認、商店批量買入／部分出售、原UtilDlgEx輸入與modal隔離、shop pending／cash防線與立即存檔。見 `INVENTORY_OPERATIONS.md`。本輪未跑suite／typecheck／瀏覽器；以下570等PASS為前輪歷史，不能作為本輪驗證。

> 最新新增：背包一般拖放／雙擊穿戴、原E裝備窗與卸下、0x17→0x0B立即保存、本人／旁觀0x28外觀；校正CConfig預設座標與初始裝備分頁。完整570/570＋TS、雙頁Chromium及Stat／小地圖／DPR／portal／繩頂回歸通過，見 `EQUIPMENT_VALIDATION.md`。當時未完成的地面丟棄窗已於最新一輪實作（未測試）；卷軸、cash與完整裝備/buff總值仍未完成。目前僅隔離QA預覽，不以QA檔替代缺失的前輪/tmp正式存檔。

> 最新新增：DPR整數實體像素清晰模式（保留800×600邏輯／原尺寸／fit選項），以及原CUIMiniMap（八框／原圖1:1／裁切／四色標記／M／拖曳保存）。100圖80有miniMap、20無node不造fallback。五DPR與真小地圖／傳送／登台Chromium回歸PASS，完整564/564＋TS；見 `DISPLAY_MINIMAP_VALIDATION.md`。原素材柔邊／字型差異仍存在，不宣稱全遊戲已1:1。

> 前輪修正：原版 ↑／type3自動門、tn→CharacterData+101、地圖0及原0x0D GM地圖命令已接上；繩頂依 sub_542DF0 改為 y1−5，不再落在平台下。八條真繩×三種刷新率、Chromium 真登台／往返門／隱形門／空中自動門均 PASS，完整561/561＋TS。權限與差異見 `PORTAL_CLIMB_VALIDATION.md`。

> 本輪更新：渲染去除多餘排序／畫面外繪製、lazy PNG 與圖像生命週期；原 Stat＋四基礎能力 AP 已接真封包與保存，修正進圖 packet drain 與升級 EXP 分母。**當時尚未完成的HP/MP成長與配點現已接上（未測試），自然AP/SP發放、Detail／buff合計仍缺**，完整驗證與差異見 `SMOOTH_STAT_VALIDATION.md`。

> 本輪更新：左右朝向旗標與 WZ 鏡像已分離；世界／三槽角色選擇改為原 WZ 畫面與先選取、再確認；普通地面怪物加入原版遊走決策／90ms 時基與分段路徑。驗證與未完成分支見 `FACING_SELECTION_VALIDATION.md`。

> 2026-10-17 更新：繩索／梯子背面合成、攀爬狀態與原始 BGM／基本音效已補上；舊切片的「只有 stand1/walk1／無音訊」不再代表目前狀態。見 `CLIMB_AUDIO_VALIDATION.md`；仍不可將原素材可播放視為整個遊戲已 1:1 完成。


> 每個 Phase 都有**出口條件（exit criteria）**；未達成不進入下一階段。
> 括號內為「單人 + AI 輔助」的粗略估計。

## Phase 0 — 證據與 oracle（進行中，~4–6 週）

| 工作 | 狀態 | 出口條件 |
|---|---|---|
| WZ 容器/樹/字串解碼 | ✅ 完成 | `tools/wz1.py` 解析 1,056 張 `.img` |
| `.img` 屬性樹 | ✅ 結構完成 | 186 個屬性完整還原（`analysis/sample_Cap_01000000_properties.txt`）|
| `.img` 像素（canvas + ZLZ） | ✅ 完成 | `node server/src/cli.ts wz png <image> --out assets/` 把每張 canvas 寫成 PNG；三個像素格式（ARGB4444／A8R8G8B8／RGB565）都有 binary 證據（`docs/WZ1_FORMAT.md` §4.6），並已用眼睛驗過 `Mob/1210102.img`（주황버섯）與 `UI/Basic.img`（97 張 canvas）|
| 協定：framing / cipher | ✅ 完成 | 握手、雙方向標頭、LCG 金鑰全部有 binary 證據（FINDINGS §2–§3）|
| 協定：dispatch/opcode 表 | 🟢 | 分派鏈已完整定位（FINDINGS §4.1／§4.7：階段 → opcode → 子系統）；client 送出的 39 個 opcode 已建目錄，**登入鏈四個階段（§4.8／§4.9）與遊戲內第一條垂直切片（§4.11：進地圖 0x16、別人進場 0x1C、離場 0x1D、移動 0x22／0x0E、傳送門 0x0D）都已解到欄位層**。剩下的：CField 其餘區間（§6 第 3 項）與 §4.11 的三個 UNKNOWN |
| 握手 `body` 的 199 bytes | ⬜ | 語意未知；只有長度規則（§6 第 2 項）|
| **capture harness** | ✅ 完成 | `node server/src/cli.ts capture` 能錄下並即時解密原 client 的封包序列 |
| 登入鏈可重播 | ✅ 完成 | `server/test/loginflow.test.ts` 用假 client 走完 握手→登入→選世界→選角→遷移+token |
| client → server 遊戲內目錄 | 🟡 | 39 個 sender 全部列出、其中聊天／密語／組隊／交易／商城／GM 指令有語意證據（FINDINGS §4.13）；**交易那七個 sender 已全部 byte-exact**（§4.40）；**攻擊三兄弟 `0x0F`／`0x10`／`0x11` 全部 byte-exact 解出、共用一個 codec 並各有 golden 測試**（§4.13.1／§4.13.1b）；**`0x2C`（怪物動作回報）已解出頭 4 個欄位**（§4.20，尾段未解）；缺的是真實流量驗證 |
| 怪物 AI 在哪一側 | ✅ 完成（決策）| **在 client**：`sub_4862C0` 是 `CMob` 的 per-frame virtual，攻擊挑選（`sub_487D10`）與命中影格（`sub_487A30`）都在 client 裡，伺服器只收到 `0x2C` 的回報（FINDINGS §4.20、DECISIONS ADR-008）。ROADMAP 的「怪物 AI」因此列在 Phase 3/4 的 client，伺服器對應的是 `0x2C` 記帳與 `0x35` 轉播 |
| 遊戲內階段（0x16 進地圖）| 🟡 | 遊戲伺服器領到 `0x04` 後送 `0x16`（地圖由 `--map` 決定，預設 `1000000`），接著**依地圖自己的 `life` 清單送 `0x2F` 怪物進場**、讓怪物**沿腳踏點折線巡邏（每段一個 `0x33`）**，**依同一份 `life` 清單送 `0x39` 讓 NPC 進場**（`Npc/<id>.img` 不存在就不生成），再把 client 報的**傷害**記在怪物的 HP 上：命中回 `0x34`、殺死送 `0x30`、死亡動畫結束後 `0x31` 收屍、`--mob-respawn` 之後重生，最後**掉寶與拾取**（殺死時依掉落表送 `0x43`、玩家走到上面時 `0x44 kind 2`＋`0x0B`＋`0x11`；`--data` 指定 `Data.wz`，預設自動取用工作目錄的 `./Data.wz`；`--mob-speed` 調巡邏速度；FINDINGS §4.11.2b／§4.15／§4.16／§4.17／§4.18），假 client 逐欄驗證；**尚未實機驗證**，且還沒有怪物 AI |
| 登入伺服器可跑 | 🟡 | `node server/src/cli.ts serve` 已能服務 0x01/0x02/0x03/0x05/0x06（記憶體帳號）＋角色 id 交接；**待原 client 實機驗證**（含 `0x16` 進地圖）|
| 腳踏點幾何 | ✅ 完成 | `foothold/<page>/<group>/<item = life.fh>` 的 item key 就是出生點指的腳踏點，`prev/next` 串成折線；**全部 100 張地圖 30,338 個線段無重複 key、2,322 筆 `life` 全數落在自己的線段上且 y 等於 `cy`**（誤差 ≤ 1；FINDINGS §4.16.4），怪物的巡邏範圍由它決定 |
| 怪物移動 | 🟡 | `0x33` 逐 byte codec（`sub_488BC0` 的指令級證據）＋ `src/game/mobs.ts` 的巡邏（每段一個 `0x33`、`info.speed` 百分比、`PATROL_SPEED_PX_PER_SEC` 基準值可調）；**尚未實機驗證**，且沒有 AI（只有兩張測試圖有攻擊資料）（§4.16）|
| 地圖 id 與載入器 | ✅ 完成 | `CharacterData.mapId`（第 23 欄）就是地圖 id：`0x16` → `sub_468E00` → `sub_4694F0` 載入 `Map/Map/%09d.img`（FINDINGS §4.11.2b）；地圖載入器的全部 WZ 路徑已列表，`server/src/wz/paths.ts` 收錄伺服器要用的三個 |
| 場地亂數種子 | ✅ 完成（含移植）| `0x16` 的三個 u32 是客戶端自訂亂數產生器的種子（FINDINGS §4.11.2：`sub_4C7930`→`sub_48A900`，反函式 `sub_4619F0` 就是 `Random()`）；伺服器可重算客戶端回報的傷害；`src/protocol/random.ts` 已逐位元移植並有 golden 測試 |
| 遊戲內封包 codec | 🟡 | `field.ts`／`movepath.ts`／`mob.ts`／`npc.ts` 已有 0x16／0x1C／0x1D／0x22／0x0E／0x0D／**0x0F 攻擊**／**0x2F 怪物進場**／**0x33 怪物移動**／**0x30 死亡**／**0x31 收屍與重生**／**0x34 怪物 MP**／**0x35 怪物動畫**／**0x2C 怪物動作回報（頭 4 欄）**／**0x39 NPC 進場**／**0x3A／0x3B NPC 離場與走動**／**0x0D 能力值差異**／**0x4A／0x4B 商店＋0x16／0x33 商店請求與物件點擊＋空的 0x19** 的逐 byte codec（`test/field.test.ts`／`test/mob.test.ts`／`test/mobs.test.ts`／`test/npc.test.ts`／`test/stat.test.ts`／`test/shops.test.ts` golden 覆蓋）；`src/game/{map,mobs,npcs}.ts` 已能把 `life` 變成出生點、沿腳踏點巡邏、把 client 報的傷害記在怪物 HP 上、並讓 NPC 進場（§4.15／§4.16／§4.17／§4.19）|
| 協定目錄（可查詢）| ✅ 完成 | `server/src/protocol/schema.ts`（FINDINGS §4.14）：**71 列**（48 byte-exact／20 partial／3 skeleton）的 `direction`／`stage`／`status`／`evidence`／`codecs`／`fields`，opcode 一律引用既有常數；`node server/src/cli.ts schema [--json]` 可查；6 個反漂移測試（codec 名稱、唯一性、skeleton 不得有欄位、必須被 decode 認得）|
| 型別檢查（strict TS）| ✅ 完成 | `server/tsconfig.json`：`strict`＋`noImplicitOverride`＋`noFallthroughCasesInSwitch`＋`noUnusedLocals/Parameters`＋`erasableSyntaxOnly`（**只允許 Node 的 strip-types 吃得下的語法**）、`noEmit`；`cd server && npm install && npm run typecheck` 在 `src/`＋`test/` 上 0 錯誤（486 個測試同時通過）|
| 打怪的閉環 | 🟡 | 傷害照 client 的數字記帳（ADR-006）、`0x34`／`0x30`／`0x31` 三個封包與收屍／重生計時（`--mob-respawn`），`Mob/<id>.img` 的 `maxHP`／`maxMP`／die 動畫長度都從 WZ 讀（FINDINGS §4.17）；假 client 逐欄驗證、真 `Data.wz` 實跑 45 隻怪（§4.17.5）；**尚未實機驗證**，且沒有怪物 AI |
| 共享世界（多玩家）| 🟡 | **一張地圖一個 `FieldInstance`**（FINDINGS §4.24、ADR-012）：怪物／NPC／掉落物／在場玩家屬於**場地**而不是連線，`game/world.ts` 的 `FieldRegistry` 是唯一入口（`of(mapId)` 沒人用過就建立、之後留著）；進場的人拿到整張圖的快照（每個活著的怪 `0x2F`、每個 NPC 完整 `0x39`、地上每個掉落物 `0x43`、每個已在場玩家 `0x1C`），離場送其他人 `0x1D`，走路把 client 自己的路徑包成 `0x22` 轉播（不含走路的人自己），世界只有**一個時鐘**（`GameEntryServer.startClock`：原本每條連線一個 `setInterval` → 同一隻怪在兩個人螢幕上走不同的路）。廣播範圍照 client 的池子決定（§4.24.1 的表：場地池子的封包送全場，動到某人角色紀錄的只送他）；角色 id 改成**全伺服器唯一**（`nextCharacterId`）。測試：`test/world.test.ts` 18 個（假成員）＋`serve.test.ts` 的兩個真 socket 端到端＋真 `Data.wz` 兩個 client 的實跑（§4.24.8）。**尚未實機驗證**；頻道／分流還沒做（`FieldRegistry.of` 是入口）、`0x1C` 的三個欄位語意未解（送 0）；別人的升級特效**已解並實作**（§4.27／ADR-015）|
| 換地圖（傳送門）| 🟡 | `0x0D`（`s32 kind` ＝ -1 ＋ 傳送門名字）→ 空的 `0x19`（client 的互動閘門只有它解得開）＋ `0x16`（FINDINGS §4.25）：**目的地查當前地圖的 `portal.tm`**（封包裡沒有地圖 id），`tm = 0` 不換圖；順序是「目的地先建好 → 離開舊場地 `0x1D` → `0x16` → 新場地快照」；**登入的地圖是角色紀錄自己的 `mapId`**（`--map` 只是新角色與沒有 mapId 的紀錄的後備），所以下線在哪上線就在哪。實作 `net/loginserver.ts` 的 `handlePortal`／`enterMap`／`withMapId`＋`game/world.ts` 的 `portal`；真 `Data.wz` 兩張相鄰的圖（102020000 ↔ 102030000）實跑通過。⚠️ **落點是目的地的出生點**：`0x16` 沒有座標、`mode` 的語意未解，所以 `tn`（目的地那一側的傳送門）只用於日誌（§4.25.4、ADR-013）；沒有頻道、沒有等級／道具條件 |
| 死亡與復活（`0x0D` `kind = 0`）＋**被怪物打會掉血**（c2s `0x1C`）| ✅ | **兩半都做完了**（FINDINGS §4.32／**§4.33**、ADR-020／**ADR-021**）。可以實作的那一半做完了：死＝client 的動作位元組 `CUser + 180` 是 18／19（`sub_50B570`／`sub_464580` 的「죽은 후에는 할 수 없는 일입니다.」），2.2 秒後 client 自己彈出 `CUIRevive`（`sub_4E94E0`；`CField + 680` 是那個計時器，由每幀的 `sub_558CF0` 讀），按 OK／**Enter**（`sub_4E9E20`／`sub_4E9E30` 的 13 ＝ VK_RETURN）送出 **c2s `0x0D` `kind = 0`**（`sub_4E9E70` → `sub_472590(0, nullptr)`）。伺服器端：`0x19` 放行 → HP 補滿 → **`0x16` 才是復活**（它重建場地與本機角色，`sub_4C2780` → `sub_51CBF0` → `sub_511030`，紀錄就畫 HP 條）→ 目的地是 `info/returnMap`（`reviveMapId`；哨兵 `999999999`＝25 張村莊，或讀不到圖 → 重進當前圖）。`handlePortal` 因此拆成 `handleInteract`／`usePortal`／`revive`。測試：真 socket 三條連線（1/50 → `0x19`＋`0x16` 50/50 換圖 → 別人看到 `0x1D`／`0x1C` → 在新圖被第三人看到 → 村莊再復活一次）；真 `Data.wz` 的迷你 client 實跑（`whisper_probe.mjs` 最後一段：Hero 在 `1000000` 送出 `kind = 0`，回來的 `0x16` 進 `1010000`——那張圖真正的 `info/returnMap`——而在那裡的 Alt 收到 `0x1C`）。**扣血那一半**（§4.33、ADR-021）：怪物 AI 在 client，client 自己算出被打的傷害後用 **c2s `0x1C`**（`[u32 flags][s16 hpΔ][s16 mpΔ][u8 flag]`，`objdump` byte-exact）回報差值——而玩家紀錄的 HP **只有伺服器的 `0x0D` 會寫**，所以伺服器落帳（`game/vitals.ts`：夾在 `[0, max]`、**HP ＝ 0 時不接受回復**）再回 `0x0D`，血條就是這樣動的；地圖自己的回復（`sub_558950`）走同一個封包。伺服器**不驗算**傷害（原 2003 server 也只能照單全收；驗算＝把怪物 AI 搬到伺服器，列出為後續選項）。⚠️ 仍未解／未做的**只有不影響這條鏈的**：`CField + 680` 的寫入者（誰宣告死亡那個時刻；§6 第 18 項）與**死亡懲罰**（掉經驗／掉道具，沒有證據所以未實作）|
| 場地聊天（`0x12` → `0x1A`）| ✅ | client 打的那行字是 `0x12`（`sub_470C70`：一個字串），伺服器轉成 `0x1A` ＋ sub-op `0x12` ＋ **說話的人的名字** ＋ 同一串 bytes（FINDINGS §4.26）：**全場都收到，包含說話的人**（client 的輸入路徑只送不顯示，`%s>> %s` 的排版只在接收端），文字以 bytes 原樣轉送（伺服器不讀它），聽眾是場地（換圖就換聽眾）。真 `Data.wz` 三條連線實跑（同一張圖聽得到、另一張圖聽不到）|
| 密語與找人（`0x23` → `0x1A` 的 `0x09`／`0x0A`，收件者看到 `0x12`）| ✅ | `0x23` ＝ `u8 kind`（`0x05` 找人／`0x06` 密語）＋ `str name` ＋〔`str text`〕（`sub_4717D0`；kind 的 bit 在 `.text:00471859`），回包在 `0x1A` 家族（FINDINGS **§4.31**／ADR-019）：找人 `0x09`（名字＋`u32 mapId`，`0xFFFFFFFF` ＝找不到）、寄件者 `0x0A`（名字＋`u8`，文字是 client 自己保留的那份）、**收件者 `0x12`**（跟聊天同一個封包，所以收件端分不出兩者 —— 2003 年的形狀）。目標用**名字**找（掃線上 session，大小寫不敏感但回存在的那個拼法）、跨地圖送達、離線 ＝ 「找不到」；拒收（`0x22`）與氣球請求沒有驅動者，記在 §6 第 17 項。真 `Data.wz` 兩條連線跨圖實跑（`server/scripts/whisper_probe.mjs`：真登入鏈＋真 `Data.wz` 的迷你 client，兩條連線跨圖）|
| 升級特效（`0x29`）| 🟡 | **兩半**（FINDINGS §4.27）：升級的人由 `0x0D` 的等級變化讓自己的 client 播 `Effect/BasicEff.img/LevelUp`（`sub_55BEB0` 尾端）；**其他人**由 `0x29`（`u32 characterId`＋`u8 effect`，0 ＝ LevelUp，id 由 `sub_51D590` 在 `CUserPool` 裡查、查不到就丟掉）看到畫在那個人身上的同一個特效。`awardKillExp` 在 `gain.levels > 0` 時廣播（**排除升級的人**：兩條路都會播，兩者都送＝播兩次；ADR-015）。effect `1` 後面還有一個 `u32`，未解。真 `Data.wz` 兩個 client 實跑（달팽이一擊升 2 級：別人收 `[0x34,0x30,0x29]`、升級的人收 `0x0D` 且收不到 `0x29`）|
| 經驗值與升級（`0x0D`）| 🟡 | 能力值差異包**已完整解出**（§4.21）：`u8 ack` ＋ `u32 flags`（19 個 bit，`0x01`…`0x40000`，依旗標順序一個欄位）＋ `u32 panelFlags`（0 = 後面沒有東西）；⚠️ 三個欄位的**線上寬度與 `CharacterData` 不同**（`str`/`dex`/`int`/`luk` 是 1 byte、`unknown26`／`fame` 是 4 bytes）。經驗值表是**算出來的**（`sub_4C7110`：1–5 `n(n²/2+15)`、6–50 `q(q+19)`／`q=n²/3`、51–200 ×1.0548），與公開的 2003 表 **196/200 相同，四個差異是複本打字錯誤**。伺服器端 `protocol/stat.ts`（`diffStats` 只送有變的欄位）＋`game/exp.ts`（升級補滿 HP／MP），殺怪後先送 `0x0D` 再掉寶；21 個新測試，並在真 `Data.wz` 的 달팽이사냥터（地圖 40000）實跑：殺五隻 달팽이後客戶端收到 `flags=0x00010010 level=2` 的升級差異（§4.21.5）。**`panelFlags != 0` 的能力面板／buff 區塊未解**、HP／MP成長舊誤讀已於ADR-047更正並接上（未測試）；自然AP／SP發放量仍未定位、**被怪物打會掉血已完成**（§4.33／ADR-021：client 用 c2s `0x1C` 回報差值、伺服器套用後回 `0x0D`；`game/vitals.ts` 的 6 個單元測試＋1 個真 socket 測試＋probe 2 項）|
| NPC 商店（`0x4A`／`0x4B`／`0x16`／`0x33`）| 🟡 | `0x49`–`0x4C` 只有 `0x4A`／`0x4B` 有 handler（§4.22）：`0x4A` 開 `CShopDlg` 並讀 `u32 shopId`＋`u16 count`＋每列 `u32 itemId`／`u32 price`／（207 家族多 8 bytes）／`u16 maxCount`；`0x4B` 只讀一個 `u8`（0 沉默、1/4 東西不夠、2 錢不夠、3 格子不夠、>4 錯誤），而且**只有在請求在途時才合法**（否則 client 自己丟 `CDisconnectException`）；client 端 `0x33`「點擊場地物件」＋`0x16` 的四個動作（買／賣／充電／關窗）。伺服器端 `protocol/shop.ts`＋`game/shops.ts`（價格一律讀 `info/price`，庫存與收購價是我們的選擇，ADR-010；**三間店**：리나／헤네시스、로빈／달팽이사냥터、**마이／암허스트**，三間都賣 마을 귀환 주문서）＋`loginserver.ts` 的兩個 handler；真 socket 走完「點 NPC → 開窗 → 買 → 錢不夠 → 關窗」。**`0x49`／`0x4C` 沒有 handler、207 那8 bytes已由4B4AD0證實是LE double補充每發費率；補充成功／零發組已實作但未測試（MESO_RECHARGE.md）、NPC 對話／任務（`0x46`–`0x48`）仍 OPEN** |
| 使用道具（`0x18`／`0x19`）| ✅ | 兩個 c2s 封包都是 `[opcode][s16 slot][u32 itemId]`（**分頁不在線上**；`itemId/10000` 決定家族：`200/201/202` → `0x18`、`203` → `0x19`），效果**就是 client 自己的 `spec`**（FINDINGS **§4.34**／ADR-022：`hp`／`mp` 定值、`hpR`／`mpR` 上限百分比、`0203` 的 `moveTo`；`0204`／`0207` 沒有 `spec`，`0201xxxx` 的 buff 家族與 `02010006` 那個字串值都**拒絕**而不是半套用）。伺服器端 `game/items.ts`（`consumeSpecOf`／`consumeDeltas`）＋`handleUseItem`／`useMapItem`：**先驗再扣**（滿血不浪費一罐、目的地讀不到圖就不吃卷軸）、拒絕也一定回**空的 `0x0B`**（client 的閘門靠回包解開）、`moveTo = −1` 用 `reviveMapId`。`--start-mesos` 是新角色的起始錢（預設 0，2003 年的樣子）。測試 9 個＋probe 那一段（全 probe 現共 63 項；買 90 元的 헤네시스 귀환 주문서 → `0x0B`／`0x0D` → `0x19` → `0x16` 進 `100000000`）。⚠️ 效果表的 loader 未定位、buff 道具未實作（§6 第 19／20 項）|
| 道具欄的拖放（`0x17` → `0x0B`，動到穿戴格再送 s2c `0x28`）| ✅ | 四個欄位就是送出者 `sub_55ACB0` 的四個參數：`u8 tab`（1 裝備／2 消耗／3 其他／4 現金）、`s16 fromSlot`、`s16 toSlot`、`s16 count`；**負格 ＝ 已穿戴**（號碼與 itemId 的部位碼同一套）、`toSlot = 0` ＝地上、`count = -1` ＝整格（FINDINGS **§4.36**／ADR-029）。四種動作（穿戴／脫下／搬移／互換）走同一條路，回包是 `0x0B`（目的格 `put` ＋ 來源格 `clear`）、**拒絕＝空的 `0x0B`**（client 的閘門 `CWvsApp + 0x18` 只有 `0x0B` 解得開）、動到負格再送同圖其他人一個 `0x28`（`u32 characterId`＋`u32 flags`＋`u8`＋id 清單，§4.11.8；**不 echo 自己**）。伺服器端 `game/inventory.ts` 的 `applyChangeSlot` **先判後寫**、只驗結構（分頁／格數／部位表與 client 同一張 `sub_45F340`／被擠掉的放不放得回去），**不驗 `reqSTR` 那些需求**（那是 client 自己的規則）。**丟到地上**（`toSlot = 0`）走同一條路：`{kind: "drop"}` → 場地的 `0x43` `kind 2`（沒有怪物區塊、15 bytes）給全場（含丟的人），落點就是玩家站的地方，撿回來的是**同一件道具**（`ruc`／捲軸都還在）——見 ADR-029 追記；「誰能撿」多一條**「必須在這筆掉落之後動過」**（`reachable`／`lastMoveAt`）：怪物掉的東西才有時間從屍體飛出來，丟在自己腳下的東西才不會立刻被自己撿回來。**現金裝備**（`111xxxx`、部位 12／13）仍然一律拒絕（§4.36.5）；裝備的能力加成不重算（傷害在 client）。測試：`field.test.ts` golden bytes＋`inventory.test.ts` 十個純函式＋`drop.test.ts`（`dropFromPlayer`）＋`serve.test.ts` 兩個真 socket 情境（穿戴者收 `0x0B`、觀察者收 `0x28`；丟到地上 → `0x43` → 站著不動與 80 px 外都不撿 → 走回去才 `0x44`＋`0x0B`＋`0x11`）＋probe 的脫下／穿回與丟到地上／撿回來那兩段 |
| 表情（`0x13` / `0x27`）| ✅ | c2s `0x13` ＝ `[u32 emotion]`，唯一送出者是按鍵分派器 `sub_511E20` 的 case 10（`push $0x13`@`.text:00511FDF`）：F1–F7 送 `1`..`7`，而且 **client 在組封包之前就把臉套在自己身上了**（`.text:00511FD8` 的 `sub_509790` 早於 `00511FDF`）。九張臉是 `.data:0x5B20D8` 的九個 `wchar_t*`（`blink`／`hit`／`smile`／`troubled`／`cry`／`angry`／`bewildered`／`stunned`／`vomit`，與 `Character/Face/00020000.img` 的子節點一致；索引 1 `hit` 就是 client 被打時自己用的那張）。伺服器端：s2c `0x27` ＝ `[u32 characterId][u32 emotion]`（池裡沒有這個 id 就整包丟掉），只送給**同場地的其他人**（與 `0x22`／`0x29` 同一條規則，ADR-023），不記狀態、不進存檔；不合法（> 8）直接丟掉並記日誌（FINDINGS **§4.35**）。測試 2 個＋probe 3 項。⚠️ 順手定位但**未實作**：s2c `0x1F` 是氣球（5 秒、`"%s : %s"`），驅動者那個請求的第二個字串來源未定位（§6 第 17 項(b)）|
| 別人的攻擊：s2c `0x23`／`0x24`／`0x25` 轉播（c2s `0x0F`／`0x10`／`0x11` → 全場）| ✅ | **三支都已轉播**，判準是**渲染器**而不是「是不是技能」：`sub_41B630`（子彈型特效）只在 c2s `0x10`／s2c `0x24`、`sub_41B850`（魔法）只在 c2s `0x11`／s2c `0x25`，而 `0x0F` 與 `0x23` 的呼叫集合完全相同（FINDINGS **§4.11.7b**／**§4.11.7c**；ADR-026／**ADR-027**），一對一因此寫進 `ATTACK_RELAY_OPCODE`（不在表上的 opcode 不轉播）。三個 opcode 共用一個 reader（`sub_5209C0`）：開頭 `u32 characterId`（`CUserPool` 查不到就整包丟掉）＋ `u8 (hits\|筆數<<4)` ＋ `u8 技能等級` ＋〔`u32 技能 id`〕＋ `u8 面向\|動作` ＋ `u8 速度` ＋ `u8 afterimage` ＋ `u32`（只有 `0x24` 收），再每筆 `u32 mobId` ＋ `u8 動畫` ＋ `hits × u16 傷害`；記錄是 76 bytes，讀完還有一趟 CMobPool 查表會**刪掉查不到的筆數**。收端跑的是攻擊者自己也跑的同一組特效，`sub_508690` 是閘門（已在攻擊中／動作不在武器動作表 → 整包不做事）；`0x24` 另外在開頭要求那個人的武器是弓／弩／爪（`sub_4657F0 ∈ {45,46,47}`，觀察者靠已經在送的 `0x1C` 認出那個人的武器）。伺服器端 `relayAttack`（原 `relaySwing`）：只送同場地其他人、只放這場地收下的怪、`speed` 照抄攻擊者的 byte 4、`skillLevel`／`afterimage` 送 0（WZ：`Character/Afterimage/` 十張圖，每張都有子節點 `0`）；`0x24` 的第 7 格要的是**投射物的 item id**，而 c2s `0x10` 只帶**USE 分頁格號**（`sub_511630` 回格號、item id 走 `Args`），所以用伺服器自己對那一格的紀錄查（`projectileItemOf`；查不到＝0）。⚠️ 名字一起更正：`0x10` 是**射擊**（sender 只服務弓／弩／爪）、`0x11` 才是**魔法**（唯一上游是 2001005／2101005 → `sub_5195D0`；狀態不是 `0xA` 時它就是 `sub_514D30` 那一條），因此 `CLIENT_FIELD_OPCODE` 的 `magicAttack`→`shootAttack`、`skillAttack`→`magicAttack`，`FIELD_OPCODE` 的 `userMagicAttack`（`0x24`）→`userShootAttack`、`userSkillAttack`（`0x25`）→`userMagicAttack`；c2s 的第 4 byte 是**揮擊速度**（§4.13.1c，`targetCap` 已改名 `speed`）、第 2 欄那個 u32 是**技能 id**（`CSkillInfo` 單例的證據，`clickedMobId` 已改名 `skillId`，ADR-028）。測試 +3（共 **401**）／+2（共 **403**）＋probe +8（共 **47**）／+6（共 **53**）；schema 目錄 **65 個封包**（41 byte-exact／20 partial／4 skeleton）|
| 起始外觀：臉、頭髮與起始裝備（`0x06` → `CharacterData`／`0x1C`）| ✅ | **兩個欄位的身分已證**（FINDINGS **§4.8.1a**／**§4.11.3c**、ADR-024）：`0x06` 的十個 u32 順序是**臉、頭髮、上衣、褲子、鞋子、武器、骰子×4**（來源是 `CUINewChar + 496 + 8k` 與 `+420..+432`，語意由 `sub_430D00` 寫進 avatar 的部位格 0／5／6／7／11 決定），而紀錄的 `appearanceA`（`+18`）是**臉**、`appearanceB`（`+22`）是**頭髮**（`sub_42E2C0` → `sub_424590`／外觀第 0 格）。`0x1C` 的第一個 u32 因此正名為 `face`（→ `CUser+68`，就是 `sub_509070` 拿去 `sub_408400` 找情緒節點的那一格）。伺服器端：`lookOf`／`withDefaultLook`（臉 `20000`、頭髮 `30000`，缺的一律補，且**不改寫存檔**）、`createCharacter` 用 `0x06` 的前兩個 u32、`avatarItemsOf` 把頭髮放進 `0x1C` 的外觀清單；`setFieldOf`／`0x02`／`0x05` 都在送出邊界補起始值。**第 3–6 個 u32 也已落地**（FINDINGS **§4.11.3d**、ADR-025）：穿戴格的欄號與外觀格是同一套號碼（`sub_45F340` 的 part code 表、`sub_45F610`／`sub_45FCC0` 的陣列索引、`sub_42E2C0` 的 `worn[k] → look[k]` 迴圈、`sub_430D00` 的 0／5／6／7／11 —— 四條獨立證據），所以上衣／褲子／鞋子／武器分別進穿戴格 5／6／7／11：`wornOfLook`／`withWorn` 把 `0x06` 的第 3–6 個 u32 變成穿戴裝備，`0x05`／`0x02` 的回包與 `0x1C` 的 `avatarItems` 自動帶著它們。測試 +4（共 **390**）＋probe +2（共 **36**）、再 +8（共 **398**）＋probe +3（共 **39**）。骰點順序已由 newDlg 標籤／繪字座標證實為 STR／DEX／INT／LUK，總和 25，已真正寫入新角。原建立／刪除視窗、六組男女外觀、CP949 名稱檢查與持久化亦已補上（`CREATION_VALIDATION.md`）。⚠️ 裝備的初始 `ruc`／能力值（WZ `info`）仍是 0|
| 掉落與拾取 | 🟡 | 四個封包全部 byte-exact：`0x43`（掉落物出現，含「從怪物身上飛出來」的怪物區塊，只有 `kind <= 1` 有）、`0x44`（消失／被撿走，`kind 2` 帶撿的人的角色 id）、`0x0B`（道具欄異動，**沒有種類位元組**：欄位自己就是種類提示）、`0x11`（獲得提示）；`0x42`／`0x45` 在 client 裡**沒有 handler**（FINDINGS §4.18）。伺服器端 `game/drops.ts`（掉落表、落點吸附腳踏點、壽命、可撿範圍）＋`game/rewards.ts`（堆疊 200、裝備不堆疊、`MesoWallet`）；掉落率等**七個常數是伺服器的選擇**並集中成常數（ADR-007）；真 socket 測完整迴圈（殺怪→`0x43`→走過去→`0x44 kind 2`＋`0x0B`＋`0x11`）；**客戶端的錢包顯示會跟著動**（§4.22.5：`+89/+93` 就是錢，`0x0D` 的旗標 `0x40000` 送它；`MesoWallet` 已改成同一份紀錄的視圖）|
| NPC 進場 | 🟡 | `0x39`／`0x3A`／`0x3B` 三個封包 byte-exact（`sub_49F6C0`／`sub_49F810`／`sub_49F970`）：**已知 id 的 `0x39` 只有 5 bytes**（只設 `+24` 的 bit 0，即「重新整理」），新 id 才帶模板與六個欄位（共 20 bytes），**沒有**怪物 `0x2F` 的動畫旗標區塊（`Npc/%07d.img` 由 client 自己播 `stand`）；`0x3B` 的 `u8 flag` 在 `u32 npcId` **之前**。伺服器端 `game/npcs.ts`（id 從 1 起算、**永不重用**、模板查不到就不生成）＋`protocol/npc.ts`；真 `Data.wz` 實跑 헤네시스 2 個 NPC（메이플운수 중형택시／리나）與 달팽이사냥터 1 個（로빈）。**尚未實機驗證**；`0x38`／`0x41` 無 handler、第 5–7 欄語意仍 OPEN（FINDINGS §4.19）|
| NPC 走動（`0x3B`）| 🟡 | `0x3B` 的 `u8 flag` 對池裡已有的 id 就是**「你自己走這個 NPC」**（FINDINGS §4.28：`sub_499760(vecctrl, 1)` 用 vtable 第 184 槽的四個 `s16`＋方向＋foothold 開始走，並設一個 `rand()%8000+4000` ms 的重挑間隔；`0` ＝停）——所以 **client 自己走、伺服器不記任何 timer**。`game/npcs.ts` 的 `walk` 政策（`--npc-walk <none|all|id,id,...>`，預設 `none`）＋`NpcField.walking`；`enterPackets()` 讓 `0x3B` 緊跟在該 NPC 的 `0x39` 之後，所以**新進場的人也拿到**同一份狀態。真 `Data.wz`（地圖 1010000、4 個 NPC）實跑：點名的那一個拿到 `0x3B`、其他三個沒有、第二個玩家看到同一份。⚠️ **哪些** NPC 該走是原伺服器的選擇、沒有證據（§6 第 14 項）；`0x3D`（伺服器指定動作）的兩個 `s8` 已知是**動畫索引**，但尾巴的 `CMovePath` 只在一個**未定位的模板旗標**非 0 時才存在 → 不送 |
| 怪物動作回報（`0x2C`）與動畫（`0x35`）| 🟡 | `0x35`（s2c）**byte-exact**：`sub_492380` case '5' → `sub_488E10` = `sub_4C6CE0(mob+136, …)`，也就是 `0x2F` 尾巴那塊動畫區塊（同一份 codec，測試直接比對 bytes 相同）；`0x2C`（c2s）解出頭 4 欄（`u32 mobId`、旗標、動作位元組、位置），**尾段（`sub_495880`→`sub_495620`）未解、原封不動保留**；`describeClientFieldPacket`／`serve` 會把原 client 的怪物攻擊寫成一行日誌（FINDINGS §4.20）|
| 組隊（c2s `0x26` → s2c `0x10`）| ✅ | 兩個方向的號碼、五個請求（`0` 建立／`1` 退出／`2` 接受／`3` 邀請／`4` 踢人）與十個回包 type（`3` 邀請、`5` 安靜同步、`6` 建立、`7`／`14` 已在隊伍、`8` 初學者不能建立、`10` 退出／被踢／解散、`11` 沒有隊伍、`13` 新成員、`15` 滿了，其餘走 default）都從 `sub_55C5E0` 與四個送出者讀出來（FINDINGS **§4.37**／ADR-030）。**102-byte 名冊**＝`u32 角色 id[6]`＋`char 名字[6][13]`（`sub_45F5C0` 的 `qmemcpy(…, 0x66)`，讀的人是 `sub_55DB00`／`sub_55CC40`），**第 0 格是隊長**（`n3000[102] == n3000[5]`）；`type 10 flag = 0` 是「隊長退隊＝解散」（沒有名冊、沒有名字，client 自己把 party id 歸零），`flag != 0` 才是「有人退出／被踢」（`u8 kicked`＋名字＋**更新後**的名冊）。伺服器端 `protocol/party.ts`＋`game/parties.ts`（`PartyRegistry`：隊伍在**世界層**、隊長離開＝解散、下線＝退隊、一目標一格的邀請），`handlePartyRequest` 每個請求都回一個 `0x10`（拒絕也回，`type 2` 是模態對話框）。測試 `party.test.ts` 10 個（golden bytes／round-trip／registry）＋`serve.test.ts` 的真 socket 一條龍＋probe 10 項。⚠️ **跨圖邀請**：client 的 `/파티초대` 只查同圖的 `CUserPool`，但 `0x26 type 3` 只是一個 u32，原伺服器接不接受跨圖邀請看不出來（本伺服器接受）。 |
| 人氣（c2s `0x20` → s2c `0x12`）| ✅ | 角色右鍵選單的「인기도 +／-」：`[0x20][u32 目標角色 id][u8 up]`（`sub_55D7B0`；client 自己先找**同一張圖**的人並擋 5 分鐘的冷卻），回包 `0x12` 六種（`0` 成功給送出者、`1` 什麼都不顯示、`2` 初學者、`3` 今天已經給過、`4` 這個月給過同一個人、`5` 通知被給的人），第二個名字一律是 client 自己的（`0x12` 只有一個名字由伺服器給）。伺服器端 `protocol/fame.ts`＋`game/fame.ts`（`applyFame`：15 級才能給、UTC 日／月配額、夾在 `[0, 65535]`；`FameLedgers` 在世界層、**不進存檔**）＋`handleFameRequest`：成功讓被給的人收 `type 5` 與一個 `0x0D` 的 `fame`（bit `0x20000`），給的人什麼都不動。測試 `fame.test.ts` 10 則＋`serve.test.ts` 一條兩 socket（type 0／5＋`0x0D`、`4`、`2`、`1`）＋probe 2 項（FINDINGS **§4.38**／ADR-031）。⚠️ 配額重開就重新開始、「初學者的界線＝15」與「被給的人沒有等級下限」都是我們的選擇（§4.38.2）。 |
| oracle 重現 | ⬜ | 原 client 能連上我們的 listener 並完成握手（不 crash） |

**出口條件**：能回答「這個封包是什麼意思」，且每個答案都有 binary 或擷取證據。

## Phase 1 — 資源管線與協定 schema（~3 週）

- NPC 走動（`0x3B`，FINDINGS §4.28／ADR-016）：`game/npcs.ts` 的 `walk` 政策 → `NpcField.enterPackets()`
  在 `0x39` 之後補一個 `0x3B`；client 自己走（4–12 秒重挑一次），伺服器沒有 timer；
  `--npc-walk <none|all|id,id,...>`（預設 `none`）
- NPC 對話（`0x47`／`0x15`，FINDINGS §4.23）：`protocol/quest.ts`（五種 body 的 codec、
  `askText` 的字串上限）＋ `game/dialogue.ts`（`Npc/<id>.img -> info/speak` 的台詞、`NpcTalk` 的逐句推進）
  ＋ `protocol/cp949.ts`（送出前的字碼頁），伺服器端把「點 NPC → 第一句 → `0x15` → 下一句」接起來。
  **仍然是純文字對話**：`info/quest` 的腳本名原樣帶著，沒有任務狀態機（client 也沒有任務 UI）。
  測試：`test/quest.test.ts` 23 個（codec golden／CP949／台詞／一場對話）＋ `serve.test.ts` 的
  `0x33`→`0x19`＋`0x47`、`0x15` 逐句與結束的端到端，共 24 個。
- `server/src/wz/`（ADR-005）：`Data.wz` → `assets/`（PNG + 動畫 JSON + OGG + bitmap font + manifest）；
  目錄樹／值層／定位／PNG 已完成，剩下的動畫 JSON 與 OGG 是包裝層
- `protocol/schema/`：從 Phase 0 的 opcode 表建立 schema；產生 TypeScript codec 與 **golden 測試向量**
- 出口條件：`node --test` 通過 schema 產生的所有 golden bytes 測試；`assets/` 可用工具重建且雜湊一致

## Phase 2 — 伺服器骨架（~6–8 週）

- login（帳號/版本/世界列表）→ world（頻道/角色列表）→ channel/game（進入地圖）
- 世界階層（ADR-012，**已完成第一版**）：`game/world.ts` 的 `FieldRegistry`／`FieldInstance` 讓「一張地圖」
  變成所有連線共用的一份狀態（怪物 HP、掉落物 id、在場玩家），廣播與個人封包的界線照 client 的池子決定（§4.24）
- 世界**不只一張圖**（ADR-013，已完成）：傳送門請求（`0x0D` → `0x19` ＋ `0x16`）把玩家在兩張場地之間搬過去，
  目的地與落點都由地圖資料決定（§4.25）；「登入在哪張圖」是角色紀錄的 `mapId`
- 會話生命週期、**持久化（角色存檔，ADR-017 完成第一版：`--save`、原子寫入、讀不懂就拒絕啟動）**、結構化日誌、可重播的封包 trace
- 商店與**用掉買來的東西**（§4.22／**§4.34**：`0x18` 回血、`0x19` 換圖，效果表讀 client 自己的 `spec`）、
  **裝備欄的拖放**（§4.36／ADR-029：`0x17` → `0x0B`，換裝再讓別人看到 `0x28`）
- `0x2C` 的記帳（誰被哪隻怪打了）與 `0x35` 的轉播（其他 client 看到同一隻怪的動作）；
  玩家 HP 的可見變化用 `0x0D`（能力值差異包，§4.21 已解出）驅動，**被怪物打的扣血路徑已接上**
  （FINDINGS **§4.33**、ADR-021：client 用 c2s `0x1C` 回報差值 → 伺服器套用 → `0x0D` 回覆）；
  **死亡與復活**已解出並實作（FINDINGS §4.32、ADR-020：c2s `0x0D` `kind = 0` → `0x19` ＋ HP 補滿 ＋ `0x16` 進 `info/returnMap`）
  —— 這一格現在**完整**（被打 → 掉血 → `hp = 0` → 2.2 秒 → 復活）
- 出口條件：2 個 client 可各自登入、選角、進入同一張地圖並互相看見移動
  → **假 client 已達成**（`serve.test.ts` 的兩條真 socket、`test/world.test.ts`、真 `Data.wz` 的兩 client 實跑，§4.24.8）；
  原 client 的實機驗證仍待 oracle run（ADR-004）
- 出口條件：**重啟之後世界還在** → **已達成第一版**（ADR-017：`--save`，建立／刪除角色與下線各存一次，
  `serve.test.ts` 的「重啟後同一個角色還在、種子輸掉」＋真 CLI 實跑）

## Phase 3 — 客戶端殼層（~8–12 週）

- **第一刀（2026-10-17，ADR-034）：瀏覽器殼 `client/` ＋ `serve --web-port`** ✅
  - 為什麼不是 Godot：Godot 的 release 檔在 `objects.githubusercontent.com`，這個環境不放行
    （下載停在 0 byte）——沒有引擎就無法驗證「能 export web 並登入」，所以先做一個**現在就能跑**
    的殼。Godot 專案仍然是 Phase 3 的主線，這一片不取代它。
  - 內容：`client/index.html`＋`style.css`＋`main.js`（零建置、零依賴）＋ `src/client/session.ts`
    （Node 端的客戶端一半）＋ `src/net/websocket.ts`（RFC 6455）＋ `src/net/webclient.ts`
    （`/ws`、`/api/map/<id>`、靜態檔）。
  - 做到的：登入→選世界→選角→進地圖、別人的進出場與移動、聊天、HP/MP/EXP/mesos 的即時顯示、
    怪物與 NPC 的位置（伺服器驅動）、腳踏點與傳送門的地形圖、走一步（`0x0E` 一個元素的
    `CMovePath`）、**點傳送門換圖**（`0x0D`，ADR-035——用的是 2003 client 自己的點擊觸發，不是碰撞）、
    **表情**（`0x13`，頁面一排按鈕；送的人自己先套用，跟 2003 一樣）與**密語／找人在哪**（`0x23` 的
    kind `0x06`／`0x05`，回覆是 `0x1A` 的 `0x0A`／`0x09`；ADR-036）、**背包**（`0x0B` 的鏡子：四
    個 tab、worn 欄、數量／可升級次數，雙擊消耗品送 `0x18`／`0x19`；名字與圖示由
    `/api/item/<id>` 讀同一份 `Data.wz`——ADR-037）、**NPC 商店與對話**（點 NPC 送 `0x33`：`0x4A`
    的商店視窗可以買（`0x16`，價格與 `maxCount` 都是伺服器的），`0x47` 的台詞用「確定／關閉」走
    `0x15`；賣出還沒有控制項——ADR-038）。順帶修掉一個真 bug：`0x1A` 的文字是 CP949，先前的
    UTF-8 解碼會把韓文變成替換字元。
  - **實測（同日，真的瀏覽器）**：預覽 proxy 會轉發 `wss` 的 upgrade，`https://8495-<sandbox>/`
    上完成登入→空白帳號建立角色（`0x06`＋`0x05`）→選角→進地圖（헤네시스）→聊天。所以「代理可能不
    轉發 upgrade」的風險不成立，HTTP 輪詢的備案不用做。
  - **第二刀（同日，ADR-039）：WZ 圖層與 sprite——畫面 1:1** ✅
    - 伺服器把 WZ 的 canvas 解成 PNG：`game/raster.ts`（RGBA compositor）、`game/wzart.ts`（UOL 解析
      ＋ canvas 快取）、`game/mapart.ts`（`backs`／`sprites`／`bounds`／`portalFrames`）、
      `game/sprites.ts`（NPC／mob 動作表）、`game/avatar.ts`（用身體錨點合成角色）、`game/art.ts`
      （process 級的 provider）。
    - 新端點：`/api/map/<id>/art`、`/api/png/<path>`、`/api/avatar.png`、`/api/npc/<id>`、`/api/mob/<id>`。
    - 頁面：`#view` 固定 800×600（CSS 等比縮放、`pixelated`）；背景依 `rx/ry` 視差與 `type` 鋪貼、
      layer 0–2 → 角色（依腳底 y 排序）→ layer 3–7 → `front` 背景；傳送門換成 `MapHelper` 的動畫；
      相機夾在 `bounds` 裡；NPC 點擊框依 sprite 放大。
    - 驗證：`render_map`／`render_view`／`render_scene` 三個離線 renderer（用和 `main.js` 同一套規則）
      對真 `Data.wz` 目視比對；`test/art.test.ts` 17 則＋`webclient.test.ts` 的 art 端點一則。
  - **第一刀的歷史缺口（非現況）**：小地圖、攀爬／跳躍動作、BGM／音效、普通怪遊走與Ctrl攻擊
    現已接通各自的驗證範圍；天氣、交易／組隊頁面、完整技能／怪物攻擊AI仍有缺口。細節與「有與沒有」
    的清單在 `docs/CLIENT.md`。
- 地圖繪製（Back/Obj/Tile 分層 + z-order）✅、角色／怪物動畫 🟡（stand1／walk1／move／stand）、
  UI（Login/CharSelect/HUD/Item/Skill）、音訊
- 輸入：鍵盤 + 手把；韓文輸入以平台層 fallback（不重寫 IMM32）
- 出口條件：能在 Windows / macOS / Linux 上開發與遊玩；**同一份專案可 export web 並能登入**

## Phase 4 — 遊戲系統（~8–12 週）

- 移動/跳躍/繩梯/傳送門、戰鬥與傷害公式、**怪物 AI 與重生（在 client，照 ADR-008）**、掉落/拾取、
  **表情（§4.35，已完成）**、
  經驗/升級/能力點、裝備/背包/商店、**使用道具（§4.34／ADR-022）**、**裝備欄拖放（§4.36／ADR-029）**、
  **組隊（§4.37／ADR-030，已完成）**、**人氣（§4.38／ADR-031，已完成）**、**交易（§4.40／ADR-032，已完成：邀請 → 進房 → 放道具／錢 → 兩邊確認 → 原子交換；`0x25` 七個 type 與 `0x50` 十一種回包）**、**메신저（§4.41／ADR-033，已完成：三人房、邀請、"name : text" 聊天行、離開；`0x24` 四個 type 與 `0x4D` 六種回包）**、頻道切換、好友（若有證據支持）
- 出口條件：每個系統都有「與 oracle 的差異清單」，且清單為空或每項都有紀錄

## Phase 5 — 內容與驗收（持續）

- 逐系統 1:1 比對 2003 行為；建立回歸測試（golden packets + 模擬 client）
- 出口條件：可從零開始完成「登入→選角→練功→交易」不中斷的長時間測試

## 風險與對策（現行）

| 風險 | 對策 |
|---|---|
| 協定 dispatch 未定位 | 先做 capture（不依賴反編譯）；兩條路並行 |
| WZ reader 錯誤被誤當素材缺漏 | shared-name/type2 已修；全1056 images checksum、100 maps missingTiles=0、55446 canvases 無 short；不用人工 fallback 掩蓋 parser 問題 |
| 「現代 MapleStory 規則」污染 2003 行為 | 每系統一頁 evidence（結論/證據/confidence），查不到就標 UNKNOWN 並不做 |
| 範圍爆炸 | 嚴守 Phase 出口條件；先垂直切片（登入→進圖→走跳→打怪） |
| 版權 | 僅研究/私人用途；`assets/` 與衍生資料不進 git、不公開發布 |
