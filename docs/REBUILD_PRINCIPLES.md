# 引擎無關的還原原則與證據導覽

本頁承接舊移植規劃中仍有效的研究原則，不保留已撤回的引擎／語言選型。
實作方向見 [ARCHITECTURE](ARCHITECTURE.md)／ADR-065，不把 Hex-Rays C 逐行換語言當作還原。

## 證據優先序

1. **原 binary／PE**：常數、字串 bytes、imports／exports、結構與 calling convention。
2. **IDA listing／assembly**：暫存器、stack、控制流、跳表、vtable、指標位移與實際算術。
3. **Hex-Rays C**：搜尋與高階語意線索，不是原始 C++；型別／參數可能錯誤。
4. **本版 Data.wz**：實際資源樹、圖片／origin／z、動畫 delay、字串與數據。
5. **外部資料**：只供交叉確認，不覆蓋本版直接證據；不用後期版本規則填空。

數據與資源問題同時以 WZ 查證，不把此排序理解成可忽略真 archive。
衝突先回 binary／listing，不憑反編譯變數名稱、函式假簽名或 cast 下定論。
例如 `_DWORD* +5` 可能是20 bytes，Canvas vtable 某個 offset 不能跨函式憑印象命名。
C 原檔含 CP949；工具輸出的 UTF-8 不能再次當 CP949 解碼。

## 每個結論必須區分

- **原版事實**：記錄檔案、函式／位址或 WZ path、控制流／欄位與交叉來源。
- **重建政策**：server 不在原 client 裡的掉率、owner、限流等選擇，明示不是原 server 還原證據。
- **未知**：保留缺口；不捏造 quest、轉職、計程車或倉庫腳本。
- **實作**：有程式／回歸來源，仍不等於執行通過。
- **歷史驗證**：限定提交、場景與方法；不能挪到後續改動或工具鏈升級上。

JSON 橋不是原封包；byte-exact codec 不代表玩法完成。WZ template 不代表玩家持有裝備；
有資源不代表已實作動畫／施放。字型 fallback 可顯示韓文不代表原 GDI metrics。

## 不改變的保護

- 原 EXE／DLL／C／LST／Data.wz 不刪、不改、不為整齊搬動；產品不依賴舊 Win32／COM／DirectX 相容層。
- 先用函式／字串／xref／位址／WZ path 索引，避免一次讀全部大型原檔後憑印象實作。
- 解析不到資源先查 reader／UOL／shared-name／type2；不得用「Data.wz 缺素材」掩蓋 parser 漏讀。
- 不造人工平台、不偷偷採用後期動作／數值／UI、不以新視窗或假按鈕冒充原功能。
- 持有 item 的 signed instance stats 必須保留，0也不以模板救回；模板只用於明確建立新物品或 shop buy。
- 不自動修玩家／seed／回退進度。ignored save 並非 Git 備份，恢復前確認原檔存在並冷備。
- 不自動執行使用者已禁止的測試／typecheck／語法檢查／browser／VM／遊戲 probe；安裝、編譯工具與啟服不是 PASS。

## 原版檔案責任

| 原檔 | 研究範圍 |
|---|---|
| MapleStory.exe／C／LST | 登入／遊戲流程、UI、動作、協定、輸入 |
| NameSpace.dll | WZ 容器／目錄／命名空間 |
| PCOM.dll | 序列化、字串編解碼與 archive 字典 |
| Canvas.dll／ZLZ.dll | canvas、像素、壓縮與解壓 |
| Gr2D_DX8.dll／Shape2D.dll | 原繪圖層、parent-chain、幾何與時序 |
| ResMan.dll／Sound_DX8.dll | 資源載入、音訊行為 |
| ijl15.dll／l3codeca.acm | 原第三方影像／音訊元件，研究格式但不重寫相容層 |
| Data.wz／analysis/ | 本版內容與靜態研究結果；實檔與已更正 parser 優先 |

## 保留的早期證據入口

舊選型評估已刪除，下列研究入口仍有效，保留以免連同過時方案丟失可追溯資料：

| 主題 | 位置 |
|---|---|
| WZ PKG1 開檔 | NameSpace.dll.c `sub_10028F90` |
| 目錄遞迴 | NameSpace.dll.c `sub_10029350`／`sub_10029650` |
| WZ 字串 encoder／decoder | PCOM.dll.c `sub_1000CEE0`／`sub_1000D510` |
| 字串去重／archive 字典 | PCOM.dll.c `sub_1000C9A0`／`sub_1000D860` |
| LZ 入口 | ZLZ.dll exports、Canvas.dll import table |
| 類別／RTTI 索引 | `analysis/rtti_raw.txt`／`analysis/rtti_classes.txt` |
| 產品格式與協定 | [WZ1_FORMAT](WZ1_FORMAT.md)／[FINDINGS](protocol/FINDINGS.md) |

本頁是保留與整理既有研究入口，不聲稱本輪重新執行其歷史驗證。
