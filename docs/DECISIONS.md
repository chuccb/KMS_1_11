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
