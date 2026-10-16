# MapleStory 首版 Client（KMS 1.11 Beta, 2003）重寫方案評估

> 評估對象：本倉庫 `chuccb/KMS_1_11`（原始 binary + Hex-Rays C + IDA LST + `Data.wz`）
> 評估目的：**用什麼方案重寫，在「現在」與「未來」都最容易維護、最簡單**
> 產出日期：2026-10-15 ｜ 版本：v1
> 本文件所有結論都附證據；未經 binary/LST/C/WZ 證實者一律標記 `UNKNOWN`。

---

## 0. 一頁結論（TL;DR）

| 問題 | 結論 |
|---|---|
| 這是什麼？ | 不是原始碼，是**一組完整的逆向工程證據集**：1 個 exe + 8 個 Wizet DLL + 2 個第三方 DLL/ACM，共 11 個反編譯 `.c`、11 個 IDA `.lst`，加 1 個 `Data.wz` 資源包。 |
| 能重寫嗎？ | 能。而且這個版本**小到可以完整重寫**：整個 2003 首版只有 **1,052 張 .img、30 個資源目錄、約 87 MB 資源**（28 個怪物、70 個 NPC、100 張地圖）。相對現代 MapleStory 是「可完成」的規模。 |
| 建議方案 | **四層架構：離線工具（資源轉檔）＋ 引擎無關核心（C#/.NET）＋ Godot 4.x 客戶端殼層（C#）＋ 共用同一核心的伺服器**。引擎只是最後 20% 的殼；**領域模型與協定不綁引擎**。 |
| 為什麼 | 這個專案 80% 的維護成本在「資源格式、網路協定、2003 年的遊戲規則」，這些都能從 binary 萃取、都能寫成純邏輯並單元測試；把它們綁進遊戲引擎（GDScript 全域單例、Dictionary 滿天飛）是未來最大的維護債。 |
| 主要語言 | 核心／客戶端／伺服器：**C#**（同一語言、同一份協定定義、可 `dotnet test` 直測）；工具：**Python**（一次性轉檔）；**GDScript 只用在場景膠水層**；效能熱點才用 GDExtension/C++。 |
| 最大的坑 | 這個版本**沒有可用的伺服器**（2003 首發版沒有公開模擬器）→ 協定必須從 client 反推。以及 `.img` 內層值編碼 + ZLZ 解壓尚未完全解出（**樹狀結構已解出並驗證**，見 §3.4）。 |
| 禁止 | 逐行翻譯 Hex-Rays C、Fake Win32/COM/D3D8、巨型 GameManager、用現代 MapleStory 規則補 2003 行為、把 97MB 遊戲資源提交進 git。 |

---

## 1. 這個倉庫到底是什麼（已驗證的盤點）

### 1.1 檔案與規模

| 檔案 | 大小 | Hex-Rays 函式數 | IDA LST 行數 | 角色 |
|---|---:|---:|---:|---|
| `MapleStory.exe` | 1.85 MB | 6,806 | 860,397 | 遊戲主程式：UI、登入/世界/遊戲流程、網路、輸入 |
| `Sound_DX8.dll` | 266 KB | 1,094 | 129,479 | DirectSound8 包裝 + MP3/ACM 播放 |
| `NameSpace.dll` | 254 KB | 1,058 | 114,663 | WZ 命名空間讀寫（`PKG1` 解析在此） |
| `PCOM.dll` | 209 KB | 838 | 94,523 | Property COM：物件/字串序列化（WZ 字串編碼器在此） |
| `Gr2D_DX8.dll` | 221 KB | 791 | 108,272 | Direct3D8 繪圖層（Gr2D） |
| `Canvas.dll` | 201 KB | 738 | 500,234 | canvas/影像解碼，**唯一 import `ZLZ.dll`（LZ 解壓）** |
| `Shape2D.dll` | 143 KB | 640 | 65,389 | 2D 幾何/形狀 |
| `ResMan.dll` | 90 KB | 290 | 38,954 | 資源管理 |
| `ZLZ.dll` | 57 KB | 134 | 23,236 | Wizet LZ 壓縮/解壓（匯出 `ZLZCreateInflator/Deflator/CloseFilter`） |
| `ijl15.dll` | 352 KB | 410 | 115,304 | **第三方**：Intel JPEG Library 1.5（JPEG 解碼） |
| `l3codeca.acm` | 291 KB | 474 | 357,206 | **第三方**：Fraunhofer MP3 ACM codec |
| `Data.wz` | 87.2 MB | — | — | 全部遊戲資源（見 §3.4） |
| **合計** | **約 370 MB（含 .lst 約 200 MB 的純文字）** | **13,273** | **2,407,657** | |

### 1.2 執行環境（由 PE import 表實證）

`MapleStory.exe` import：`KERNEL32 / USER32 / GDI32 / ADVAPI32 / SHELL32 / ole32 / OLEAUT32 / IMM32 / WINMM / WS2_32 / ijl15 / MSVCRT`

- **`IMM32`** → 韓文 IME 輸入（帳號/角色名）
- **`WS2_32`** → Winsock TCP（連線）
- **`ADVAPI32` + 字串 `SOFTWARE\Wizet\MapleStory`** → 組態與帳號資訊放在**註冊表**
- **沒有任何 `d3d8.dll` / `dsound.dll` import** → Direct3D8 / DirectSound8 是**透過 COM（`DllGetClassObject`）動態取得**；這正是 8 個 Wizet DLL 都 export `DllGetClassObject` 的原因。
- `ijl15` / `l3codeca.acm` 是**第三方**：重寫時**直接丟掉**，用現代 JPEG/MP3 解碼器取代。
- 副檔名字串：`%s\Maple%04d.jpg`（截圖）、`NexonADBallon` / `NexonADBrowser`（**遊戲內廣告元件**）、`http://club.maplestory.com/Support/NewAccount/Agree.aspx`（官網申請帳號流程）。
- 版本事實：exe timestamp `Sun Apr 27 2003`；**KMS v1.11 beta 是 MapleStory 第一個公開發行版（2003-04-29）**，即「初版」。

### 1.3 真實類別名單（RTTI 未剝離 — 極高價值的證據）

PE 內保留了 MSVC RTTI 名稱，共 **651 個型別描述子**（exe 618 個）。等同於**原作者的類別命名表**，可直接拿來當重寫的領域模型骨架：

- 流程/UI：`CStage`、`CUILogin`、`CWorldSelect`/`CUIWorldSelect`、`CUILogin`、`CUISkill`、`CUIItem`、`CUIEquip`、`CCashShop`
- 網路：`CClientSocket`、`ZSocket`/`ZSocketThread`/`ZSocketBuffer`/`ZPort`/`ZPortThread`
- 世界/地圖：`CPortalList`/`PORTAL`、`CMobPool`、`CReactorPool`(?)、`CTownState`(?)
- 角色/動作：`CActionMan` + `CHARACTERACTIONENTRY`/`CHARACTERACTIONFRAMEENTRY`/`CHARACTERIMGENTRY`、`MOBACTIONENTRY`、`NPCIMGENTRY`
- 資料表：`CItemInfo`+`EQUIPITEM`、`CSkillInfo`+`SKILLENTRY`/`SKILLROOT`、`CQuestMan`、`CSoundMan`+`SECACHEITEM`
- 資源層：`IWzCanvas`、`IWzGr2DLayer`、`IWzSoundState`、`IWzVector2D`、`IWzShape2D`、`WzSerialize`、`CWz*`
- Wizet 自製容器：`ZList/ZMap/ZRef/ZRecyclable/TSingleton/ZHeapBase`

**完整清單已輸出**：`analysis/rtti_raw.txt`（651 筆原始 descriptor）、`analysis/rtti_classes.txt`。
這代表「資料模型」不需要憑空設計——**可以照著原始命名與職責還原**。

### 1.4 證據優先序（沿用倉庫內 `GODOT_MIGRATION_PROMPT.md` 的規則）

1. 原始 binary（常數、import/export、layout）→ 2. IDA LST（control flow、跳表）→ 3. Hex-Rays C（語意線索，**不是原始碼**）→ 4. `Data.wz`（實際資源）→ 5. 外部資料（只能交叉驗證）。

---

## 2. 要重寫的「東西」其實有四個，不是一個

大部分這類專案失敗，是因為只把「client」當成專案範圍。實際上要交付的是：

| # | 交付物 | 現況 | 難度 | 備註 |
|---|---|---|---|---|
| A | **資源管線** | `Data.wz` 完整存在 | 中 | 需 WZ v1 reader + `.img` property + ZLZ + canvas→像素；**樹狀結構已解出並驗證**（§3.4） |
| B | **領域核心**（資料模型/規則/動作/碰撞/公式） | 只有反編譯碼 | 中高 | RTTI 給了類別骨架；每個系統要用 LST 驗證行為 |
| C | **客戶端呈現**（畫面/輸入/UI/音訊） | 綁死 Win32+D3D8+COM | 中 | 這層**應該整個丟掉重寫**，不是移植 |
| D | **伺服器 + 協定** | **不存在** | 高 | 2003 首發版沒有可用模擬器；協定要從 client dispatch table 反推。沒有 D，A~C 只能單機 |

> **沒有伺服器 ⇒ 這個專案的第一個「可驗收里程碑」必須是「原 client 能登入自己寫的 server」或「重寫 client 能連原協定的 server」**，否則沒有 oracle 可以驗證行為。

---

## 3. 我這次已經完成的驗證（去風險證據）

### 3.1 資源可讀：WZ v1 樹狀結構 100% 解出並自我驗證 ✅

我寫了 `tools/wz1.py`（Python，無外部相依），完整解析 `Data.wz`：

- Header：`PKG1` + `u64 shellSize`(=檔案大小−60) + `u32 dataOffset`(=0x3C) + `"Package file v1.0 Copyright 2002 Wizet, ZMS"`
- `u16` WZ 版本欄位 = **95**；樹區間 `0x3E..0x756E`（30,062 bytes）；之後是 **86,967,311 bytes** 的 image 資料區
- **30 個目錄 / 1,052 張 `.img`**，並通過一致性驗證：**10 個子樹中有 9 個「節點宣告 size == 子節點 size 總和」完全相等**（Character 16,864,260 bytes 完全吻合），唯一差異在 `Map`（172,999 bytes，待查，佔 0.2%）
- **字串編碼已完全解出**（見 §3.3），所以路徑名可讀、可 diff

產出：`analysis/data_wz_manifest.txt`（人類可讀樹 + 完整清單）、`analysis/data_wz_manifest.json`（機器可讀）

### 3.2 內容盤點（整個 2003 首版的遊戲內容）

| 子樹 | `.img` 數 | 資料量 | 內容 |
|---|---:|---:|---|
| `Map` | 142 | 40.36 MB | Back/Obj/Tile/Map（`Map/Map/*.img` = **100 張地圖**） |
| `Sound` | 10 | 26.69 MB | 音效/BGM 容器 |
| `Character` | 765 | 16.86 MB | Cap 143、Clothes 304、Weapon 103、Hair 91、Shoes 38、Glove 32、Shield 18、Accessory 13、Face 11、Afterimage 10、body/base 影像 |
| `UI` | 8 | 1.25 MB | 介面（`UI/Basic.img`、`UI/Login.img`…） |
| `Mob` | 28 | 521 KB | **28 種怪物** |
| `Npc` | 70 | 496 KB | **70 個 NPC** |
| `Skill` | 7 | 293 KB | 技能表 |
| `Item` | 14 | 182 KB | Book/Consume/Etc/Install/Special |
| `Etc` | 4 | 14 KB | Tips/Curse/ForbiddenName/MakeCharInfo |
| `Effect` | 2 | 299 KB | BasicEff/Tomb |
| 根目錄 | 2 | 4 KB | `smap.img`, `zmap.img` |

**這是專案可行性最關鍵的一個數字：初版只有 28 隻怪物、70 個 NPC、100 張地圖、765 個角色造型圖。**
換句話說——**這是一個「可以做完」的遊戲**（現代 MapleStory 則不可能）。

### 3.3 WZ v1 格式規格（由本 repo 證據反推，非網路猜測）

| 項目 | 規格 | 證據 |
|---|---|---|
| 字串（ASCII） | `out[i] = in[i] ^ ((i - 86) & 0xFF)`，遮罩從 `0xAA` 起每 byte +1 | `PCOM.dll.c:1000CEE0`（encoder）、`PCOM.dll.c:1000D510`（decoder）|
| 字串（UTF-16） | `word[i] ^= (i - 21846) & 0xFFFF`（遮罩從 `0xAAAA` 起每 word +1）| 同上（`n128_3 < n128` 分支）|
| ASCII 長度前綴 | `len < 128` → 單 byte `(256 - len)`；`len >= 128` → `0x80` + `int32 len` | `sub_1000CEE0` |
| UTF-16 長度前綴 | `len < 127` → 單 byte `len`；`len >= 127` → `0x7F` + `int32 len` | `sub_1000CEE0` |
| 目錄區塊 | `compact-int 子節點數` + N 筆 entry | `NameSpace.dll:sub_10028F90`（`PKG1` 開檔）、`sub_10029350`/`sub_10029650`（遞迴）|
| entry | `u8 tag` + name + `compact-int size` + `compact-int checksum` + `u32 key` | 由 1,052 筆 parse 一致性驗證 |
| `compact-int` | 單 byte（signed）；若該 byte == `0x80` → 後接 `int32` | `sub_10029350`（`< -127 \|\| > 127` 分支寫 `0x80` + 4 bytes）|
| tag | `3` = 目錄、`4` = image、**`2` = 名稱去重引用** + `u32`（= 被引用 entry 的 tag 位移 − 0x3C）| 實測 4 處：`/Map/Tile/{darkCave,darkWood,dryRock,grassySoil}.img` 引用 `/Map/Back` 的同名 entry（`0x585E + 0x3C = 0x589A` ✅）|
| image 檔頭 | `0x73`（或 `0x1B`）+ 字串 `"Property"` + `u16 0` + count；另一變體為 `00 00 00` + count | `Mob/0100100.img` 開頭解出 `"Property"`；`Character/Cap/01000000.img` 為 `00 00 00 0F` |
| property 項 | `u8 0x00` + string name + `u8 type` + value（共 15 種 type）| `Cap/01000000.img` 逐 byte 驗證 `icon`(699B)、`iconRaw`(610B) 兩張 canvas 偏移完全自洽 |
| 型別表 | 15 種（0/2/3/4/5/6/7/8/9/11/13/16/17/18/19）| `PCOM.dll.c` `sub_10018800`（read）/`sub_10012920`（write）|
| canvas 像素 | 以 check byte `0x73`/`0x1B` 開頭，經 **ZLZ LZ 壓縮** | `Canvas.dll` 為唯一 import `ZLZ.dll` 者（`?ZLZCreateInflator@@…`）|

仍未完成（**唯一剩下的資源環節**）：canvas 標頭 → BGRA 像素、ZLZ inflate 實作、部分型別的精確 C 型別。
難度評估：**低–中**（`ZLZ.dll` 只有 134 個函式且只匯出 3 個 inflate/deflate API，inflate 主體疑為 `sub_100028E0`；`Canvas.dll` 是唯一使用者，可直接對照）。
完整規格與證據位址見 **`docs/WZ1_FORMAT.md`**。

### 3.4 其他已確認事實

- `PCOM.dll` 匯出 9 個 API：`PcCreateObject / PcFreeUnusedLibraries / PcInitModule / PcRootNameSpace / PcSerializeObject / PcSerializeString / PcTermModule / DllGetClassObject / DllCanUnloadNow` → 客戶端的資源系統是一套**自製 COM**（Wizet 的「Property COM」）。
- 其他 Wizet DLL 都只匯出 2 個（`DllGetClassObject`、`DllCanUnloadNow`）→ 全部是**同一個 COM 外掛家族**，用 `CoCreateInstance` 依 CLSID 取得（這也是 `ole32/OLEAUT32` 的用途）。
- RTTI 內含 **29 個 `TSingleton<...>`**，等於一份「原始管理器清單」（可直接當子系統盤點）：

  `CWvsApp`（應用/主迴圈）、`CWvsContext`（全域遊戲狀態）、`CWvsPhysicalSpace2D`（物理空間）、
  `CClientSocket`、`CSecurityThread`、
  `CActionMan`、`CAnimationDisplayer`、
  `CMobPool`、`CNpcPool`、`CUserPool`、`CUserLocal`、`CRewardPool`、`CPortalList`、
  `CItemInfo`、`CSkillInfo`、`CQuestMan`、`CSoundMan`、`CConfig`、
  `CWndMan`、`CUniqueModeless`、`CUIMessenger`、`CUIMiniMap`、`CUIStat`、`CUIStatusBar`、
  `CUIScreenMsg`、`CUISkill`、`CUIItem`、`CUIEquip`、`CUIRevive`

  → 這些就是「重寫時要有的子系統」，但**不要照抄成 29 個全域單例**（這正是維護債來源）；
  應改為明確 owner + 依賴注入（例如 `MapInstance` 擁有 `MobPool/NpcPool/RewardPool/PortalList`）。

---

## 4. 維護性／簡易性的評估準則（先定義，再比較）

| 準則 | 為什麼重要 |
|---|---|
| C1 變更成本 | 改一個系統要同時動幾層？（引擎、核心、資源、協定） |
| C2 可測試性 | **不開視窗就能驗證**邏輯（協定 codec、公式、碰撞）——這是長期維護的第一生產力 |
| C3 可替換性 | 引擎版本升級、換渲染、換平台、核心複用（client/server 共用） |
| C4 單一資料來源 | 協定/資源/數值只定義一次，不重複實作 |
| C5 生態與人才 | 找得到人、找得到範例、LLM/AI 輔助友善度 |
| C6 十年後還能 build | 依賴鏈是否可凍結、是否有單一廠商風險 |
| C7 迭代速度 | 熱重載、錯誤訊息、啟動時間 |
| C8 執行期風險 | 2003 遊戲的 sprites/UI 量、GC 抖動、記憶體 |
| C9 授權 | 開源授權 vs 商業引擎條款 |
| C10 熱點可 native 化 | 大量解碼/路徑搜尋能否換 C++/SIMD |

---

## 5. 方案矩陣

### 方案 A：原 client + localhost patch + 現代 server（相容層路線）
- 做法：改 IP/移除保護，配一套自寫 server；client 本體跑在 Windows/Wine + dgVoodoo2（D3D8 wrapper）。
- ✅ 最快「可玩」（1–2 週）；✅ 100% 行為正確（它本尊）；✅ **對重寫專案極有價值的 oracle**。
- ❌ 2003 binary 無法維護、無法改、Win32/D3D8/IME/保護層全部是定時炸彈；❌ 32-bit、安全性、現代 OS 相容性持續劣化；❌ 不是「重寫」。
- **定位：只做為驗證 oracle 與協定來源。不當最終產品。**

### 方案 B：Godot 4.x + **GDScript 全重寫**（倉庫內 prompt 的預設方向）
- ✅ 引擎能力足夠（2D sprite/Control UI/TileMap/Animation/多平台輸出/開源）；✅ 迭代快；✅ 與既有 prompt 一致。
- ❌ 全部邏輯寫在引擎裡 → 換引擎/升版本/寫 server 都要重來；❌ 型別與重構能力弱（大型狀態機/協定碼容易失控）；❌ **沒有引擎外的單元測試**（GUT 需要 Godot 執行環境，慢、難整合 CI）；❌ client 與 server 無法共用協定碼（勢必複製）。
- **定位：可以work，但把 80% 的邏輯放進引擎是長期維護債。**

### 方案 C（**建議**）：**引擎無關核心 + Godot 4.x 殼層（C#）**
```
tools/   Python          WZ → PNG/JSON/OGG + manifest + atlas + 字型（離線、可重跑、可 diff）
core/    C# (.NET 類別庫) 協定 codec、領域模型、世界狀態、動作/碰撞/公式、資源索引  ← 無 Godot 相依
client/  Godot 4.x (C#)   渲染、輸入、UI、音訊、場景組裝（GDScript 只做膠水）
server/  C# (.NET)        login/world/game，直接引用 core 的協定定義
tests/   xUnit（core）+ Godot headless 煙霧測試 + 與原 client 的差異測試
docs/    evidence/ protocol/ architecture/
```
- ✅ **協定與領域邏輯單一定義**：client/server 共用同一份 C# 型別，不可能不同步。
- ✅ **可測試性最高**：`dotnet test` 直接驗證 WZ reader、封包 codec、公式（不需要開遊戲）。
- ✅ **可替換性**：若 Godot 在 2030 年出問題，核心與資源管線原封不動搬到 MonoGame/Unity/自製 renderer。
- ✅ **語言與生態**：C# 在 Godot 是一級公民（.NET 8/9/10 皆可）；LLM/範例/人力供給遠優於 GDScript-only 架構。
- ✅ 熱點可下沉：ZLZ 解壓、大量 sprite 計算 → GDExtension/NativeAOT。
- ⚠️ 需要自律的架構紀律（不把 Godot 型別漏進 `core/`）；⚠️ Godot C# 的 **Web 匯出**支援度不如 GDScript（若「瀏覽器版」是硬需求，見 §7 決策 3）。
- ⚠️ 需要先做一件事：把 WZ→現代資源的**轉檔管線**建立起來（方案 C 的前置成本，但任何方案都要付）。

### 方案 D：自研 C++（SDL3 + bgfx/自製 2D 引擎）
- ✅ 最貼近原始思維、效能與控制力最好。
- ❌ UI/動畫/資源/輸入/音訊/發佈全部自建 → **維護成本最高的選項**，與「最簡單」目標相反。
- **定位：不建議**（除非目標是「重現 2003 的技術」，而不是「維護得起的遊戲」）。

### 方案 E：Web（TypeScript + WebGL/PixiJS 或 Three.js）
- ✅ 分享/展示/回歸測試極方便（URL 即玩）；✅ TS 型別與工具鏈成熟；✅ CI 友善。
- ❌ 97 MB 資源與大量 sprite 的載入/記憶體/音訊策略要自己處理；❌ 韓文字型/IME 在瀏覽器的坑；❌ 之後想做原生桌面/手機要多一套打包；❌ 與 WZ 資源轉換仍需完整做一次。
- **定位：可作為「方案 C 的第二個前端」**（核心邏輯可編到 WASM），不宜當唯一路線。

### 方案 F：Rust（Bevy / wgpu 自製）
- ✅ 效能/壽命/型別安全最佳；✅ 無 GC；✅ 可編 WASM 共用核心。
- ❌ 開發速度最慢（尤其 2D 遊戲 UI 生態弱）；❌ 團隊/人才/範例最少；❌ 對「用 AI 加速開發」最不利。
- **定位：不建議做為主要方案。**

### 綜合評分（5 = 最好）

| 準則 | A 相容層 | B Godot/GDScript | **C 核心+Godot C#** | D C++ 自研 | E Web/TS | F Rust |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| C1 變更成本 | 5 | 3 | **4** | 2 | 3 | 2 |
| C2 可測試性 | 1 | 2 | **5** | 3 | 4 | 4 |
| C3 可替換性 | 1 | 2 | **5** | 3 | 3 | 3 |
| C4 單一資料來源 | 1 | 2 | **5** | 3 | 3 | 4 |
| C5 生態/AI/人才 | 2 | 4 | **5** | 3 | 4 | 2 |
| C6 十年可 build | 1 | 4 | **4** | 3 | 4 | 4 |
| C7 迭代速度 | 5 | 5 | 4 | 2 | 5 | 2 |
| C8 執行期風險 | 4 | 4 | 4 | 5 | 3 | 5 |
| C9 授權 | 1 | 5 | **5** | 5 | 5 | 5 |
| C10 熱點 native | 1 | 3 | **4** | 5 | 3 | 5 |
| **合計** | 22 | 34 | **45** | 34 | 37 | 36 |

> 註：E 的總分不低，因為它在「測試/分享」面向很強；但「必須重做資源管線 + 大檔案/音訊 + 字型/IME」讓它不適合作為主線。

---

## 6. 建議架構（詳細）

### 6.1 分層與依賴方向（單向，禁止反向）

```
        ┌──────────────── Client (Godot 4.x, C#) ───────────────┐
        │  scenes/  render/  input/  ui/  audio/  adapters/      │
        └───────────────┬───────────────────────────────────────┘
                        │ 只用 core 的公開 API（不得直接讀檔案格式）
        ┌───────────────▼───────────────┐   ┌──────────── Server (C#, .NET) ─────────┐
        │        core  (無引擎相依)      │◄──┤ login / world / channel / game loop     │
        │ protocol/ domain/ sim/ assetdb │   └─────────────────────────────────────────┘
        └───────────────▲───────────────┘
                        │ 讀取「已轉檔」的資料（JSON/PNG/OGG）
        ┌───────────────┴───────────────┐
        │  tools (Python，離線執行)       │  WZ v1 → PNG/JSON/OGG + manifest + atlas
        └───────────────▲───────────────┘
                        │
                   Data.wz（只讀，不修改、不提交衍生大檔）
```

### 6.2 為什麼「核心不綁引擎」是這個專案最關鍵的決定

1. 這個遊戲的邏輯本質是**狀態機 + 資料表 + 協定**，幾乎不依賴渲染。
2. 2003 的 client 有 `CClientSocket`、`CActionMan`、`CMobPool`、`CQuestMan`… 這些在 RTTI 裡都叫得出來 → 可以直接還原成純 C# 類別。
3. 只有引擎外的核心才能：
   - 用 `dotnet test` 對**協定/公式/動作時序**做回歸測試（未來改任何東西都有安全網）；
   - 讓 **server 與 client 共用同一份封包定義**（這個版本沒有 server，我們必須自己寫，共用能省下最多重工）；
   - 做**差異測試**：同一份輸入分別餵給「原 client（Wine + oracle harness）」與「重寫核心」，比對輸出。

### 6.3 資源策略：**Offline-first（先轉檔，runtime 不碰 WZ）**

- `tools/wz2assets.py`：`Data.wz` → `assets/`（PNG + `.json` 動畫/屬性 + OGG/MP3 + bitmap font + atlas）
- `assets/` **不進 git**（`.gitignore`），只提交 `manifest.json` 與**轉檔腳本**；任何人都能用原始 `Data.wz` 重建同樣的 `assets/`（可重現、可 diff）。
- 好處：runtime 不需要 WZ 解碼器（少一個大子系統）；美術/動畫可視化驗證；轉檔結果可進 CI 做雜湊比對；日後要換引擎不必再寫一次 WZ reader。
- 例外：若要做「WZ 編輯器/HaRepacker 類工具」才需要在 runtime 讀 WZ——那不是本專案目標。

### 6.4 實作紀律（避免未來的維護地獄）

| 禁止 | 改用 |
|---|---|
| 逐行翻譯 `sub_XXXXXXXX()` | 依 §3 的證據重建**行為**，用真實類別名（RTTI 已給） |
| Fake Win32 / Fake COM / Fake D3D8 相容層 | 直接用引擎/平台原生 API（`ZSocket` → TCP socket 服務；`IWzCanvas` → Texture2D） |
| 巨型 `GameManager`/`Singleton` | 明確的 owner：`LoginSession`、`WorldSession`、`MapInstance`、`Character`, 依賴注入 |
| 到處 `Dictionary<string, Variant>` | 強型別 record/class + `JsonSerializer` 契約 |
| 把 2003 未實作的東西用現代 MapleStory 補上 | 標記 `UNKNOWN`，回 LST 查證；查不到就**不做** |
| 把 97 MB 資源與轉檔產物 commit 進 git | `.gitignore` + 腳本可重建 |
| 把 Godot 型別漏進 `core/` | 以 CI/analyser 檢查 `core` 專案不得 reference Godot |

---

## 7. 需要你拍板的三個決策（會影響後續所有工作）

### 決策 1：目標形態
| 選項 | 影響 |
|---|---|
| **(a) 單機／離線可玩重製**（本地 server in-process） | 最快看到成果；協定可以先用「合理設計」；但 2003 的線上行為（多人同步/頻道/交易）無法驗證 |
| **(b) 完整 MMO（自建 server + 帳號 + DB）** | 最忠實；但協定 RE 與後端工作量最大，且沒有原始 server 可對照 |
| (c) 研究／保存（以 oracle 重現行為與資料，不求可玩） | 學術/保存價值最高，但不產生遊戲 |

> 我的建議：**(a) 先做，架構保留 (b)**——把 server 寫成獨立行程、用同一份 core 協定庫，一開始只跑 localhost。這樣 (a)→(b) 不需要重構。

### 決策 2：技術棧
| 選項 | 說明 |
|---|---|
| **(a) 建議：Godot 4.x（stable）+ C#，核心為引擎無關 .NET 類別庫** | 維護性/可測試性/可替換性最佳 |
| (b) Godot + 純 GDScript（依現有 prompt） | 迭代最快、最簡單起步；但核心邏輯與協定會綁死在引擎內 |
| (c) 其他（Unity / Web-TS / Bevy-Rust / 自研 C++） | 見 §5 評分 |

### 決策 3：平台優先序
- Windows 桌面優先？（原 client 的世界）
- 要不要 **瀏覽器版**？（若是，GDScript 路線或「core 編 WASM + Web 前端」會比 Godot C# 更順）
- 手機（Android/iOS）是否在計畫內？（影響 UI 縮放與輸入架構）

---

## 8. 分階段路線圖（含驗收標準與風險）

### Phase 0 — 證據化與工具（**部分已完成**）
| 工作 | 狀態 | 驗收標準 |
|---|---|---|
| WZ v1 reader + manifest | ✅ 完成（`tools/wz1.py`） | 1,052 張 `.img` 清單，size 與子樹總和一致 |
| RTTI/類別清單 | ✅ 完成（`analysis/rtti_*.txt`） | 651 個 descriptor 可用於命名 |
| `.img` property + canvas + ZLZ 解碼 | ⬜ 待做（1–2 週） | **能把 `UI/Basic.img` 還原成看得懂的 PNG** |
| 協定 opcode 表（從 exe dispatch 跳表萃取） | ⬜（2–3 週） | 產出 `docs/protocol/opcodes.md`：opcode ↔ handler ↔ 欄位 |
| Oracle harness（原 client 跑在 Windows/Wine + 封包錄製） | ⬜（1–2 週） | 能錄下「登入→選角→進圖」的完整封包序列 |

**Phase 0 出口條件**：能回答「這張圖長什麼樣、這個封包是什麼」，且都有證據檔案。

### Phase 1 — 資源管線（2–3 週）
`Data.wz` → `assets/`：PNG（含 alpha/正確像素格式）、動畫 JSON（frame/delay/origin/z）、音訊、bitmap font（韓文）、atlas + `manifest.json`。
驗收：隨機抽 20 張 `.img`（角色/怪物/地圖/UI）與原 client 畫面**目視比對一致**。

### Phase 2 — 核心（6–10 週）
協定 codec、登入/選角流程、`MapInstance`/`Foothold`/`Portal`、`CActionMan` 動作系統、資料表（Item/Skill/Mob/Npc）、碰撞與移動。
驗收：`dotnet test` 覆蓋率與**差異測試**（核心 vs 原 client 的行為比對）。

### Phase 3 — 客戶端殼層（8–12 週）
地圖繪製（Back/Obj/Tile 分層 + z-order）、角色動畫、UI 框架（Login/CharSelect/HUD/Item/Skill/Quest）、輸入（含韓文 IME 例外處理）、音訊。
驗收：**能登入自寫 server、選角、進地圖、走跳、打怪、撿物、換頻**。

### Phase 4 — 伺服器（4–6 週，可與 Phase 3 並行）
login/world/channel/game loop、角色持久化、地圖實例管理。
驗收：2 個 client 同場可見彼此移動與攻擊。

### Phase 5 — 內容與驗收（持續）
逐系統 1:1 驗證（任務/商店/強化/降級/掉落/傳送門/組隊）。
驗收：與 oracle 的差異清單歸零（或每一項都被記錄為「已知偏差」）。

**粗略總量（單人 + AI 輔助）**：到「可玩雛形」約 **6–9 個月**；到「1.11 內容忠實完成」再加 **6 個月以上**。
若走方案 A（相容層）「能玩」只要 1–2 週，但它沒有未來。

---

## 9. 風險清單與緩解

| 風險 | 等級 | 緩解 |
|---|---|---|
| `.img`/canvas/ZLZ 未完全解出 | **中→低**（樹/字串/屬性項已解，只剩 canvas 像素 + ZLZ） | 依 `docs/WZ1_FORMAT.md` §4.4 的三步 spike（先解 `UI/Basic.img` 的 `Cursor` canvas）|
| 協定/加密未知 | 中 | 由 exe 的 dispatch 跳表 + `CClientSocket`/`ZSocket` 反推；oracle 錄包驗證 |
| 沒有原始 server 可對照 | 高 | 自建 localhost server 當第一里程碑；用差異測試取代「參考實作」 |
| 2003 行為細節被現代規則污染 | 中 | 每個系統寫 `docs/evidence/*`：結論 + 證據位址 + confidence；查不到就標 UNKNOWN |
| Godot 版本升級破壞 API | 低 | 綁 stable、不綁 dev；核心不依賴引擎，升級影響被限制在殼層 |
| C# / Web 匯出限制 | 低–中 | 先確定平台優先序（決策 3） |
| 韓文 bitmap font / IME | 低–中 | WZ 內有字型；IME 走平台層 fallback，別重寫 IMM32 |
| 32-bit 原始 client 的長期不可用 | 高（對方案 A） | 只用於 Phase 0 oracle，不當產品 |
| **版權/法律** | 中 | 只做研究/私人重寫；**不要把遊戲資源與原始 binary 公開散布**；倉庫內既有檔案保持原狀，衍生資產不 commit |
| 範圍爆炸（想一次做全部） | 高 | 嚴守 Phase 出口條件；先「登入→進圖→走跳→打怪」垂直切片 |

---

## 10. 立即可以動的下一步（建議順序）

1. **`.img` → PNG 的垂直切片**：補齊 property 值型別 + ZLZ inflate，把 `UI/Basic.img`、`Character/Cap/01000000.img` 還原成圖。（這是整個資源管線的最後一個未知）
2. **協定表**：從 `MapleStory.exe` 找 packet dispatch 跳表（LST 的 jump table 證據），產出 opcode 清單。
3. **建立 `Godot/` + `core/` 骨架**：`core` 先放 C# 版 WZ reader（與 `tools/wz1.py` 互相驗證），並用 xUnit 驗證 manifest 與 Python 版一致。
4. **Oracle harness**：把原 client 跑起來（Wine 或 Windows VM），錄「登入→選角→進圖」封包。
5. 建立 `docs/evidence/`：每個子系統一頁（結論/證據/confidence），讓後續任一個開發者或 AI 都能接手。

---

## 附錄 A：本次新增檔案

| 檔案 | 內容 |
|---|---|
| `docs/REBUILD_EVALUATION.md` | 本文件（方案評估與路線圖） |
| `tools/wz1.py` | WZ v1（`PKG1` 2002 格式）reader：header/目錄樹/字串 cipher/back-reference；可輸出 manifest |
| `analysis/data_wz_manifest.txt` | `Data.wz` 人類可讀清單（30 目錄 / 1,052 `.img` + 大小 + 檔案 offset） |
| `analysis/data_wz_manifest.json` | 同上，機器可讀（供後續工具/C# 讀取） |
| `analysis/rtti_raw.txt` | 651 個原始 RTTI type descriptor（依 binary 分類） |
| `analysis/rtti_classes.txt` | 去重複後的類別名清單（領域模型命名的依據） |
| `docs/WZ1_FORMAT.md` | WZ v1 完整規格（容器/樹/字串/屬性項/型別表/canvas）＋每項的證據位址與驗證方式 |

## 附錄 B：關鍵證據位址（重寫時直接查這裡，不要重新摸索）

| 主題 | 位置 |
|---|---|
| WZ 開檔 / `PKG1` / 路徑 hash / 目錄 | `NameSpace.dll.c` `sub_10028F90`（`NameSpace.dll.lst:83264` 有 `push offset aPkg1`） |
| 目錄遞迴序列化 | `NameSpace.dll.c` `sub_10029350`、`sub_10029650` |
| WZ 字串 encoder | `PCOM.dll.c` `sub_1000CEE0`（`^ (i - 86)` / `^ ((WORD)i - 21846)`） |
| WZ 字串 decoder | `PCOM.dll.c` `sub_1000D510` |
| 字串去重 / archive 字典 | `PCOM.dll.c` `sub_1000C9A0`、`sub_1000D860` |
| PCOM 對外 API | `PCOM.dll` export table（9 個） |
| LZ 解壓 | `ZLZ.dll` exports `?ZLZCreateInflator@@…`、`Canvas.dll` import 表 |
| 類別清單 | `analysis/rtti_raw.txt` / `analysis/rtti_classes.txt` |
| 原始規格書（證據優先序、禁止事項、Godot 對應表） | `GODOT_MIGRATION_PROMPT.md` |

## 附錄 C：與 `GODOT_MIGRATION_PROMPT.md` 的關係

現有 prompt 是一份**很好的「語意與紀律」規格**，本評估**同意其中大部分**（證據優先序、禁止逐行翻譯、禁止 Fake Win32/COM/D3D、禁止現代版本倒灌、evidence/confidence 一等公民）。

本評估補充（prompt 未涵蓋或著墨不足）的三件事：

1. **專案層級架構**：prompt 只規定「Godot 內部怎麼寫」，沒有規定「核心要不要跟引擎分離」。依據本評估 §4/§6，**分離**是長期維護的關鍵。
2. **缺少 server**：prompt 把範圍限定在 client；但沒有 server，協定與線上行為無法驗證、專案無法「玩」。必須把「自建 server + 共用協定庫」納入架構。
3. **資源策略**：prompt 讓 Godot 直接吃 WZ；本評估建議 **offline 轉檔**（runtime 不碰 WZ），理由是降低 runtime 複雜度、可視化驗證、可 diff、換引擎不用重寫。

**若你決定採用「純 Godot/GDScript」路線**，本評估的 Phase 0/1/8/9 節仍然完全適用（那是最花時間、最需要證據的部分）；差別只在 Phase 2/3 的程式碼放在哪裡、以及未來換引擎的成本。
