# 架構決策記錄（ADR）

> 本檔記錄已定案的決策、理由與後果。**未經討論不要推翻**；要改就新增一則 ADR 並標明取代關係。

---

## ADR-001：目標是「完整 MMO」，不是單機重製

**日期**：2026-10-16 ｜ **狀態**：已定案（使用者決定）

**決策**：本專案的交付物包含可運作的 **server（login / world / channel / game）與持久化**，
client 必須能與該 server 完整互動。

**後果**：
- 協定 = 一等公民：必須有單一來源（schema）與可測試的 codec，並被 client / server 共用。
- **必須先建立 oracle**：可以由「原 client ↔ 我們自寫的 server」驗證，或「重寫 client ↔ 原協定 server」；
  2003 首版沒有公開 server，因此**唯一可靠來源是原 client binary 本身**（見 ADR-004）。
- 里程碑的第一順位是「**能收下原 client 的封包並正確解析**」，而不是「畫面好看」。

---

## ADR-002：協定 schema-first + TypeScript 核心/server + Godot 4.x（GDScript）client

**日期**：2026-10-16 ｜ **狀態**：已定案（使用者對技術棧表示「都行」，由本評估擇定）

**決策**：
1. **協定以 schema 為單一來源**（`protocol/`）：由 schema 產生（或驗證）各語言的 codec。
2. **核心與 server 用 TypeScript**（Node 22，零依賴：原生 type stripping + `node --test`）。
3. **client 用 Godot 4.x + GDScript**（殼層：渲染 / 輸入 / UI / 音訊）。

**理由**：
| 考量 | 說明 |
|---|---|
| 完整 MMO 的關鍵是 **server + 協定** | 這兩者用同一套 TS 定義，單一語言即可覆蓋 80% 的邏輯面 |
| **跨平台（使用者第 3 點）** | Godot 4.x 可輸出 Windows / macOS / Linux / Android / iOS / **Web**；但 **C# 專案目前無法輸出 Web**（官方文件：C# 專案仍不能 export 到 web，GDScript 可以）→ 若要保留瀏覽器版本，client 必須是 GDScript |
| 可測試性 | TS 核心可在**不需要引擎**的情況下完整單元測試（本倉庫已可在沙箱內執行） |
| 避免語言鎖死 | 因為協定由 schema 產生，**未來若放棄 Web 想改用 C# client，只要換 binding，不動核心** |
| 簡單性 | 零依賴工具鏈（`node --test`、`python3 -m unittest`），無 build step、無框架 |

**被否決的選項與原因**：
- **C# 核心 + Godot C# client**：語言單一、型別最強，但 (a) C# 無法 export web，(b) 本沙箱無 .NET 可驗證，
  (c) 手機版 C# 仍屬實驗性。→ 若日後明確放棄瀏覽器且團隊偏好 C#，可以只換 client binding（見上「避免語言鎖死」）。
- **純 Unity**：授權與長期風險，且 2D MMORPG 用不到其優勢。
- **純 GDScript（引擎內含全部邏輯）**：server 無法共用邏輯，協定會複製兩份。

**後果**：
- 必須維護 schema → 產生/驗證 codec 的工具鏈（Phase 1 起）。
- client 端的「重邏輯」僅限於預測/插值/動畫；**數值與規則以 server 為準**。

---

## ADR-003：跨平台優先序

**日期**：2026-10-16 ｜ **狀態**：已定案（使用者：最好可以跨平台）

**決策**：優先序為 **Windows / macOS / Linux 桌面 → Web（瀏覽器）→ Android / iOS**。
以 Godot 4.x 匯出；不使用任何桌面平台專屬 API（Win32/COM/DirectX 一律不得出現在新程式碼中）。

**後果**：
- 不可使用 C#（因 Web 優先序高於「語言統一」）。
- 輸入層必須支援鍵盤 + 手把（日後觸控）；不可假設韓文 IME 永遠存在（原 client 依賴 IMM32）。
- 音訊/影像格式使用引擎原生格式（PNG/OGG），**不重寫 ijl15 / l3codeca.acm / DirectSound**。

---

## ADR-004：以「原 client 作為 oracle」，先做封包擷取

**日期**：2026-10-16 ｜ **狀態**：已定案

**決策**：在實作 gameplay 之前，先建立能**擷取並解析原 client 封包**的能力：
`server/` 提供 `capture` 模式（TCP listener，寫出 JSONL trace），並由 `docs/protocol/FINDINGS.md`
累積「已由 binary 證實」的協定事實。

**理由**：2003 KMS 1.11 沒有任何公開 server 或文件；所有協定知識只能來自：
1. 反編譯碼（dispatch / 讀寫欄位順序）→ 2. 實機擷取（原 client 指向我們的 listener）→ 3. 交叉驗證。

**後果**：
- 第一個「可對外展示」的成果不是遊戲畫面，而是**原 client 的握手封包被正確解析**。
- 任何未被上述兩者證實的協定欄位，一律標記 `HYPOTHESIS`，不得寫成既定規格。

---

## ADR-005：WZ／資產管線只實作一次，用 TypeScript（`server/src/wz/`）

**日期**：2026-10-16 ｜ **狀態**：已定案

**決策**：`Data.wz` 的讀取與資產輸出（目錄樹、值層、像素、PNG）以 **TypeScript 實作於
`server/src/wz/`**，作為產品端唯一一份；Python 的 `tools/wz1.py`／`wzimg.py`／`wzdata.py`
**降級為反編譯與驗證用的參考實作**（兩邊的黃金值必須一致，見 `server/test/wzimg.test.ts`
與 `tools/tests/test_wzimg.py`），不再新增 Python 端資產工具，原路線圖的
`tools/wz2assets.py` 取消。

**理由**：
1. 遊戲程式是 TypeScript（ADR-002）：伺服器要地圖／怪物資料，Godot 客戶端要 PNG／動畫。
   若資產管線另寫一份 Python，同一份 WZ 語意就會有**兩份會各自漂移的實作**。
2. 反編譯 dump 是 CP949 的 C，Python 在「快速試錯、和 binary 對照」上更順手，所以探索階段
   留在 `tools/`；一旦語意確定（`docs/WZ1_FORMAT.md` §4 全部 ✅）就只留一份產品實作。
3. 兩份實作對同一組黃金值（1,052 張 image、922 declared + 130 scanned、55,379 張 canvas、
   696,774 次名稱表查詢、第一張 canvas 像素的 sha256）互相驗證，比任何註解都可靠。

**後果**：
- 資產輸出（PNG）由 `server/src/wz/png.ts` 產生，指令是 `node server/src/cli.ts wz png`。
- `tools/` 只做「讀 .c／驗 WZ 語意」；新增 WZ 功能一律加到 `server/src/wz/`。
- 兩邊不一致時以 `docs/WZ1_FORMAT.md` 的證據為準，並同時修正兩份實作與測試。

---

## ADR-006：怪物傷害先「照 client 說的記帳」，把驗證留給之後的同一條迴圈

**日期**：2026-10-16 ｜ **狀態**：已定案（可再評估）

**決策**：伺服器對 `0x0F`／`0x10`／`0x11` 帶進來的傷害值**先照單全收**：扣怪物的 HP、
回應 `0x34`／死亡時 `0x30`／收屍與重生用 `0x31`（FINDINGS §4.17）。
**不重算傷害**，也**不先做客端驗證**，但把「重算」的兩個前提寫下來，讓它之後可以補上。

**理由**：
1. **這是 2003 client 的實際分工**：傷害由攻擊方的 client 算完、畫完才寫進封包
   （`sub_512F90` 呼叫 `sub_4882F0` 把 `CMob::DAMAGEINFO` 排進怪物自己身上，見 §4.13.1／§4.17），
   伺服器在原始設計裡就是記帳的一方。我們的目標是「先讓原 client 能玩完一個迴圈」。
2. **重算需要兩塊我們還沒有的東西**：client 的傷害公式（散在 `sub_512F90` 一族與技能表裡，尚未 RE）
   與「哪一顆亂數」（`0x16` 的三個 `u32` 是 client 自訂 RNG 的種子，`src/protocol/random.ts`
   已是逐位元移植）。有了這兩塊，重算就是同一個 RNG 的第二次抽樣，而不需要新機制。
3. **現在就驗證會把還沒解出的知識硬編碼成規則**，違反 `GODOT_MIGRATION_PROMPT.md` 的證據優先順序。

**後果**：
- 目前任何人都能送假的傷害值 —— 這是**已知且刻意**的缺口，不是疏漏；在 Phase 2 的
  「共享世界」之前，`MobField` 還是每個連線一份，這個缺口不會外溢到別的玩家。
- 之後要補驗證時，落點是同一個函式（`GameEntryServer.applyAttack` → `MobField.applyDamage`）：
  在那裡用 `ClientRandom` 重抽一次並比對，就變成「一次改動、一個測試」。
- 怪物 HP 是伺服器的權威資料：即使傷害值不檢查，**誰能被打、還剩多少 HP、什麼時候重生**
  都由伺服器決定（client 報的 `mobId` 必須存在於自己的場地，否則只寫 log）。

---

## ADR-007：掉落與金錢的「伺服器自訂參數」先集中成常數，並記下它們不是證據

**日期**：2026-10-16 ｜ **狀態**：已定案（可再評估）

**決策**：掉落與拾取的行為（`0x43`／`0x44`／`0x0B`／`0x11` 的收送時機，FINDINGS §4.18）已實作成
`server/src/game/drops.ts` 與 `server/src/game/rewards.ts`，其中**binary 沒有、由本專案選擇**的數字
全部集中在這兩個檔案的常數，並在註解裡明說「這是伺服器的選擇」：

| 常數 | 值 | 為什麼是選擇 |
|---|---|---|
| `MESO_DROP_CHANCE_PER_MILLE` / `MOB_JUNK_CHANCE_PER_MILLE` / `MOB_POTION_CHANCE_PER_MILLE` | 600 / 300 / 50 | 原伺服器的掉寶率在 client 裡不存在（掉落是 `0x43` 單向宣告）|
| `MESO_PER_LEVEL` | 3 | 金額公式 `1 + range(0, level * 3)` 的上界 |
| `POTION_BY_LEVEL` | 4 個等級帶 | 四個藥水id 有 WZ 名字與價格，**哪個等級帶給哪一瓶**是選擇（`test/drop.test.ts` 釘住）|
| `DROP_LIFETIME_MS` | 300000 | 掉落物多久消失（`0x44 kind 0`）|
| `DROP_SPREAD_PX` | 24 | 掉落物離怪物的水平擴散 |
| `PICKUP_RANGE_PX` / `PICKUP_RANGE_Y_PX` | 40 / 60 | 「站在上面」的判定範圍 |
| `MOB_RESPAWN_MS`（§4.17）| 5000 | 怪物重生時間 |

**理由**：
1. **原值不可得，但行為必须可玩**：完整 MMO（ADR-001）需要掉落與經濟迴圈才能玩下去；把這些
   參數散在程式各處，之後就算量到真值也不知道要改哪裡、改完對不對。
2. **每一項都能被單獨量測**：ADR-004 的實機 run 只要抓一份真實流量，就能對照「掉落率／壽命／
   擴散距離／可撿範圍」四個常數，改成量到的值、跑同一組測試（`drop.test.ts` 的機率斷言用注入的
   亂數源，不依賴真隨機）。
3. **`DropPolicy` 是注入的**：`DropField` 接受 `policy`／`random`／`lifetimeMs`／`spreadPx`／
   `pickupRangePx`，所以「換一份掉落表」不需要動 `DropField` 或網路層，測試也不必碰真隨機。

**後果**：
- 任何時候看到這些數字，都應該假設「這是我們選的，不是解出來的」；`FINDINGS §4.18.8` 與
  `server/README.md` 都這樣寫。
- client 的 메소 顯示**不會**跟著變（`MesoWallet` 是伺服器端帳）：能力值區塊裡沒有已證實的錢欄位，
  而 `0x0D` 的 19 個 bit 裡也確實沒有錢（§4.21 解出後可以確定「不是漏送」）。這是已知缺口，不是 bug。
- 掉落物目前是**每個連線一份**（跟 `MobField` 一樣，ADR-001 的共享世界還沒做）：
  兩個玩家會各看到自己的掉落物。共享世界的 Phase 2 要把 `DropField` 跟 `MobField` 一起搬到
   per-field registry。

---

## ADR-008：怪物 AI 屬於 client（照 2003 年的分工），伺服器只轉播與記帳

**日期**：2026-10-16 ｜ **狀態**：已定案（可再評估）

**決策**：重寫的 client **要自己實作怪物的 AI**——per-mob 的狀態機（`sub_4862C0` 的角色）、
攻擊挑選（`sub_487D10`：`conMP <= MP`、矩形／線段命中測試、從命中清單隨機挑一個）與命中影格
（`sub_487A30`）。伺服器**不模擬怪物 AI**：它把 `0x33`／`0x35` 轉播給其他 client、接受
client 用 `0x2C` 回報的怪物動作（FINDINGS §4.20）。`0x0D` 解出之後（§4.21／ADR-009），
伺服器**只**用它送經驗值與升級補血；「被怪物打 → 掉血」仍然沒有驅動者。

**理由**：
1. **這是 binary 的分工，不是我們的偏好**：`sub_4862C0` 是 `CMob` 的 per-frame virtual，
   它在自己的程序裡挑攻擊、算傷害、把效果打在 `*(mob+108)` 這個使用者物件上，然後才送 `0x2C`。
   2003 年的伺服器看到的是「結果」，不是「決策」。把 AI 搬到伺服器等於**發明**一套協議，
   與 `GODOT_MIGRATION_PROMPT.md` 的證據優先順序衝突。
2. **與 ADR-006 一致**：傷害已經由攻擊方的 client 算（怪物→玩家是另一條同樣的迴路），
   伺服器的責任是記帳與權威狀態（誰在場、還剩多少 HP、什麼時候重生），不是重算。
3. **重寫的 client 本來就要有這套程式**：`CMob::Update` 同等物屬於 Phase 3/4 的 client 工作
   （ROADMAP），它需要的資料（`Mob/<id>.img` 的 `attack<i>/info`、`info.speed`、動作表）已經在
   `game/mobs.ts` 與 `protocol/mob.ts` 裡有讀取器。

**後果**：
- `serve --game-port` 目前自己送 `0x33` 讓怪物巡邏：那是**我們 client 還沒有 AI 之前的替代品**，
  不是最終架構。它與原 client 放在一起會有兩個驅動者（原 client 自己也會走），
  所以 oracle run（ADR-004）時要記得這件事，不要把它當成協定錯誤。
- 怪物攻擊玩家的**可見**部分（怪物播攻擊動畫、玩家的 HP 條下降）需要 `0x0D`（能力值差異包）
  才完整 —— `0x0D` 現在已解出並用於經驗值／升級（§4.21），但**扣血那條路徑仍然只有 client 的
  回報**：`serve` 收到 `0x2C` 只寫日誌，不會改玩家的 HP（§4.20.6 第 5 項）。
- ROADMAP 的「怪物 AI 與重生」從「伺服器工作」改列為 **client 工作**；伺服器那一側的對應項目是
  「`0x2C` 的記帳與 `0x35` 的轉播」。

---

## ADR-009：經驗值／升級用 client 自己的表；升級的成長量先不送（缺口要看得見）

**日期**：2026-10-16 ｜ **狀態**：已定案（可再評估）

**決策**：`0x0D`（能力值差異包）解出之後（FINDINGS §4.21），伺服器驅動「殺怪 → 經驗值 → 升級」這一條迴圈，
規則如下：

1. **門檻是 client 自己的公式**：`server/src/game/exp.ts` 的 `expToNextLevel` 逐行照抄 `sub_4C7110`
   （1–5 `n(n²/2+15)`、6–50 `q(q+19)`／`q=n²/3`、51–200 ×1.0548、`>200` 封頂 `0x7FFFFFFF`），
   不是我們挑的曲線。與公開的 2003 表比對 **196/200 相同**，四個差異是複本打字錯誤
   （用我們的值，前一級與後一級都能推回表上的數字）。這張表**只在 client 啟動時算出來**，
   `.data` 裡沒有靜態複本，所以它以公式而不是資料的形式存在。
2. **經驗值量是怪物自己的 `info.exp`**（`Mob/<id>.img`，已經在 `mobTemplateProvider` 裡），
   不是伺服器決定的係數。
3. **升級的成長量（`maxHp`／`maxMp`／`ap`／`sp` 加多少）先不送**：原伺服器的職業／等級成長表
   不在 client 裡（`sub_4C71C0` 這支「就地升級」routine 只扣經驗值、等級 +1、補血、重算傷害範圍，
   沒有任何成長量）。**發明一組數字比留著缺口更糟**（`GODOT_MIGRATION_PROMPT.md` 禁止發明規則），
   所以 `awardExp` 只送真的有變的欄位（`exp`／`level`／滿血的 `hp`／`mp`），角色的最大值維持不變，
   並在 FINDINGS §4.21.6 與 ROADMAP 標明這是**已知缺口**。
4. **升級要補滿 HP／MP**：這是 client 自己那支 routine 的行為（`sub_4C71C0`：還活著才補），
   伺服器照著做，否則玩家的經驗條會跳、血條不會動。

**理由**：
1. **單一來源**：門檻、升級行為、補血都在 `game/exp.ts`；以後無論是實機量到成長表、或是換一份
   職業成長表，都只動這一個檔案（`net/loginserver.ts` 只呼叫 `awardKillExp`）。
2. **可測**：公式是純函式（`test/exp.test.ts` 用公開表與邊界值釘住），升級／補血用假的角色紀錄測，
   殺怪 → `0x0D` 的那一段用真 socket 測（`test/serve.test.ts`）。
3. **差異包是「有變才送」**：`diffStats` 比較送出前後的紀錄，所以升級只多送 `level`／`exp`／`hp`／`mp`
   四個欄位，不會把整份 47-byte 身體塞進封包——這也是 `0x0D` 存在的理由（§4.21.1）。

**後果**：
- 升級後角色的 `maxHp`／`maxMp` 不變：**打同一隻怪會越打越慢**，這是預期行為，不是 bug。
- ADR-008 的「伺服器不改玩家的 HP」只對了一半：HP **現在會**由伺服器改（升級補滿），
  但「被怪物打 → 扣血」仍然沒有驅動者（`0x2C` 只是 client 的回報）。
- 能力面板的 buff 區塊（`panelFlags != 0`）仍然沒送，伺服器一律送 0。

---

## ADR-010：商店的價格來自資料、庫存來自我們；mesos 只有一份（角色紀錄）

**日期**：2026-10-16 ｜ **狀態**：已定案（可再評估）

**決策**：`0x4A`／`0x4B`／`0x16`／`0x33` 解出之後（FINDINGS §4.22），NPC 商店的行為如下：

1. **mesos 只有一份**：`CharacterData` 的第 22 欄（`stats.mesos`，記憶體 `+89/+93`）就是錢。
   `game/rewards.ts` 的 `MesoWallet` 是**那份紀錄的視圖**（`new MesoWallet(character.stats)`），
   不是第二本帳；任何改動都用 `0x0D`（旗標 `0x40000`）送給 client。
2. **價格是資料**：每一列的 `u32 price` 來自該道具自己的 `info/price`
   （`Item/Consume/0200.img/<id>/info/price`，`game/shops.ts` 的 `itemPrice`）。
   讀不到價格的道具**不會被放進商店**（列不會被送），而不是送一個 0 讓 client 印出來。
3. **庫存是我們的選擇**：2003 年的商店是伺服器上的腳本，`Data.wz` 裡沒有任何商店資料，
   所以「哪個 NPC 賣什麼」（`SHOPS`）、一次能買多少（`DEFAULT_SHOP_MAX_COUNT`）、
   賣回給商店拿多少（`SELL_PRICE_RATIO`）都是這份 repo 的決定，集中在 `game/shops.ts`，
   並由 `test/shops.test.ts` 釘住。兩個商店掛在**地圖 `life` 裡真的存在**的 NPC 上
   （`1010100` 리나／헤네시스、`2003` 로빈／달팽이사냥터）。
4. **回覆契約照 client 的規則**：買／賣／充電**一定**回一個 `0x4B`（`dlg+184` 是 client 的鎖，
   只有 `0x4B` 解得開）；關窗**不回**（那時 `dlg+184 == 0`，回下去 client 會自己丟
   `CDisconnectException`，FINDINGS §4.22.3）。
5. **207 家族不賣**：那 8 bytes 的長度確定、內容未知，codec 只攜帶不產生（§4.22.2）。

**理由**：
1. **能算的不要抄**：`info/price` 是檔案裡的事實，抄一份到程式碼就會漂移；庫存反過來是
   檔案裡不存在的東西，只能寫下來並標成選擇 —— 兩者分開，未來才分得清「這行是證據」
   還是「這行是我們決定的」（與 ADR-007 同一條原則）。
2. **金額只有一處**：舊設計的 `MesoWallet` 自己記帳、紀錄裡另有一份，兩者靠呼叫端同步；
   改成視圖之後，「client 顯示的錢」與「伺服器的錢」在型別上就是同一個物件。
3. **client 的兩條例外是契約，不是細節**：不回的 `0x4B` 會讓玩家的視窗卡死、多回的 `0x4B`
   會讓 client 斷線 —— 兩件事都寫在 `handleShopRequest` 的註解與測試裡。

**後果**：
- 商店的**內容**要改，改 `game/shops.ts`；要換一份價格來源，改 `itemPrice`。網路層不變。
- 撿到錢、買東西、賣東西三條路徑現在都會送 `0x0D` 的 `0x40000`，畫面上的錢包會跟著動。
- 裝備還不能賣（這一版 `Item/` 底下沒有裝備圖，`Character/<type>/<id>.img` 的價格外加規則
  沒有證據）；`0x16` 的充電（op 2）沒有實作，一律回「東西不夠」。
- NPC 的對話／任務（`0x46`–`0x48` 與 client 的 `0x15`）仍然 OPEN：商店是第一個可互動的 NPC
  行為，不是全部。
