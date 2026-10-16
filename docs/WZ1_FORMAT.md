# WZ v1（2002 Wizet 格式）規格 — 由本倉庫 binary/Data.wz 反推

> 狀態圖例：**✅ 已驗證**（以 `Data.wz` 實檔 + 反編譯碼雙重確認）、**🟡 部分**（結構已知、細節待補）、**❓ 未解**
> 所有位址皆指本倉庫內的檔案。

---

## 1. 檔案容器（`Data.wz`）✅

```
offset 0x00  char[4]  "PKG1"
offset 0x04  u64      shellSize = 檔案大小 - 60      （Data.wz: 87,170,312）
offset 0x0C  u32      dataOffset                     （Data.wz: 0x3C = 60）
offset 0x10  char[]   NUL 結尾描述字串 "Package file v1.0 Copyright 2002 Wizet, ZMS"
offset 0x3C  u16      WZ 版本欄位                    （Data.wz: 95；KMS 1.11 = v1.11 → 95）
offset 0x3E  ...      WzDirectory 樹（見 §2）
...
              ...      image 資料區（所有 .img blob 串接，見 §4）
```

**證據**：`NameSpace.dll.c` `sub_10028F90`（開啟時比對 `"PKG1"` 與 `0x3C`，並以路徑字串雜湊算「單 byte 金鑰」`v11 = h ^ h>>8 ^ h>>16 ^ h>>24`，雜湊公式 `h = 32*h + ch + 1`；`NameSpace.dll.lst:83264` 可見 `push offset aPkg1`）。
**驗證**：本倉庫的 `tools/wz1.py` 以 1,052 張 `.img` 完整走完樹，且 10 個子樹中 9 個的「宣告 size == 子節點 size 總和」完全相等（唯一差異在 `Map`，172,999 bytes，待查）。

---

## 2. 目錄樹 ✅

```
WzDirectory = compact-int childCount + childCount × Entry
Entry       = u8 tag
              name   （見 §3）
              compact-int size
              compact-int checksum
              u32 cacheKey
```

- **樹為前序（prefix）**：所有 Entry 先寫完，子目錄的 block 才依序接在後面（與現代 WZ 的 inline 不同）。
- `tag`：**3 = 目錄**、**4 = image**、**2 = 名稱去重引用**（後接 `u32`，見下）

### 名稱去重（tag 2）✅
```
stored_u32 = (被引用 Entry 的 tag 檔內位移) - 0x3C        // 0x3C = dataOffset
```
即「該名稱第一次出現的 Entry 其 tag 相對於資料區起點的位移」。解碼時以 `stored_u32` 回查先前解出的名字即可。

**實證**（`Data.wz` 中僅 4 處）：
| tag 位置 | stored | 指向 | 名字 |
|---|---|---|---|
| 0x0678B | 0x00585E | 0x589A | `Map/Back/darkCave.img` 的 `darkCave.img`（用於 `Map/Tile/darkCave.img`） |
| 0x0679E | 0x00587A | 0x58B6 | `darkWood.img`（用於 `Map/Tile/darkWood.img`） |
| 0x067E9 | 0x005896 | 0x58D2 | `dryRock.img` |
| 0x067FC | 0x0058B1 | 0x58ED | `grassySoil.img` |

驗證：`0x585E + 0x3C = 0x589A` 正是 `Map/Back/darkCave.img` 的 tag 位置。以本規則實作後，
`tools/wz1.py` 可完整 parse 全部 1,052 張 image（先前未解此規則時會在 `Map/Tile` 中斷）。

**`compact-int` 編碼** ✅（證據：`NameSpace.dll.c sub_10029350`，寫入時若 `v < -127 || v > 127` 則先寫 `0x80` 再寫 `int32`）
```
byte b = read_u8()
if b == 0x80:  value = read_i32()
else:          value = (b >= 0x80) ? b - 256 : b      // signed byte
```

---

## 3. 字串編碼 ✅（完全解出）

```
byte len = read_u8()
if len == 0x00:            ""（空字串）
if len & 0x80:
    if len == 0x80:        n = read_i32()
    else:                  n = 256 - len               // 單 byte 負數長度
    → ASCII：n bytes，明文字元 = byte[i] ^ ((i - 86) & 0xFF)     // 遮罩自 0xAA 起，每 byte +1
else:
    if len == 0x7F:        n = read_i32()
    else:                  n = len
    → UTF-16LE：2n bytes，每個 u16 ^= ((i - 21846) & 0xFFFF)     // 遮罩自 0xAAAA 起，每 word +1
```

**證據**：
- encoder `PCOM.dll.c` `sub_1000CEE0`：`*dst = *src ^ (i - 86)`（ASCII）與 `*(WORD*)dst ^= (WORD)i - 21846`（UTF-16）；長度前綴規則同 §3。
- decoder `PCOM.dll.c` `sub_1000D510`：UTF-16 分支由後往前寫 `v26 = (BYTE)v25 ^ (i - 86)`；ASCII 分支 `*v11++ ^= (_WORD)i - 21846`。
- 字串去重字典（archive string cache）在 `PCOM.dll.c` `sub_1000C9A0` / `sub_1000D860`；`sub_1000CEE0` 輸入長度上限 0x2000。
**驗證**：`Character/Accessory/01010000.img`、`Map/Back/darkCave.img`、`Sound/` 全部可讀，1,052 個檔名 100% 合理。

---

## 4. `.img` 內容 🟡（結構已解，值細節待補）

### 4.1 檔案頭 — 有兩種以上變體

| 變體 | 開頭位元組 | 實例 |
|---|---|---|
| **A** | `73` + 字串 `"Property"` + `u16 0x0000` | `Mob/0100100.img`、`UI/Basic.img` |
| **B** | `00 00 00` + `compact-int count` | `Character/Cap/01000000.img`（count = 15） |
| **C** | 其他/疑似壓縮 | `Etc/Tips.img`（開頭 `b7 5c c9 cb …`，但其中仍有明文屬性名） |

變體 A 逐 byte（`Mob/0100100.img`）：
```
73                    check byte（= 已知的 WZ image check byte 0x73）
f8 fa d9 c3 dd cb dd c4 c8   len=0xF8→8、再 8 bytes → 解碼 = "Property" ✅
00 00                 u16 = 0
05                    property 數量（compact-int）
00 fc c3 c5 ca c2     prefix 0x00 + len 0xFC→4 + "info" ✅
09                    type = 9（object/canvas）
```
另一種 check byte 為 **`0x1B`**（實測：`Character/Cap/01000000.img` 的 `iconRaw` 物件 payload 以 `1b` 開頭；`icon` 以 `73` 開頭）。

### 4.2 property list 與屬性項 ✅（前幾項已逐步驗證）

```
propertyList = compact-int count
               之後 count 次：
                 u8 0x00            // 固定前導（每項都有；Cap 實例 offset 4/714/1338 皆為 0x00）
                 string name        // §3 編碼
                 u8 type
                 value
```

`Character/Cap/01000000.img` 的實際 decode（已驗證三項）：
```
offset   3  count = 15
offset   4  00                    prefix
offset   5  fc → 4 bytes → "icon"       name
offset  10  09                    type 9（object）
offset  11  bb 02 00 00 = 699     子物件 size
offset  15  73 …                  canvas payload（以 check byte 0x73 開頭）
offset 714  00 / 715 f9(→7) / 716.. "iconRaw" / 723 09 / 724 62 02 00 00 = 610 / 728 1b …
```
→ 兩張 canvas（`icon` 699 bytes、`iconRaw` 610 bytes）**大小與偏移完全自洽**（699 = 714−15、610 = 1338−728）。

### 4.3 型別表（15 種）✅（來源：`PCOM.dll.c`）

deserializer `PCOM.dll.c` `sub_10018800`（`switch` 於 299/424 行的 15 個 case）、serializer `sub_10012920`。

| type | 值大小/型態（由 case 分支推得） | 備註 |
|---|---|---|
| 0 | 無值 | `goto LABEL_109`（僅寫 type） |
| 2 / 11 / 18 | 2 bytes（走 `sub_10019FE0`） | 短整數系 |
| 3 / 4 / 19 | 4 bytes（`sub_10015F30` / `sub_10015C10`） | 32-bit 系 |
| 5 / 7 / 6 | 8 bytes（`sub_10016060` / `sub_10015FE0`） | 浮點/雙精度系 |
| 8 | 字串（走 §3 編碼器 `sub_1000C9A0`） | 另有 4-byte 長度前綴變體（`v1[2] & 0x10` 旗標） |
| 9 / 13 | 物件：`u32 size` + payload（payload 可為 property list 或 canvas） | case 9/13 為「有 size 的子串流」 |
| 16 / 17 | 2 bytes（`sub_10010540(…, 2)`） | 與 2/11/18 共用讀取器 |
| default | 錯誤 −2147352568 | |

> ❓ 仍待補：**每個 type 的精確 C 型別**（short/ushort/int/float/double 的對應）與 `sub_10019FE0` 的內部編碼。
> 建議做法：對 `PCOM.dll.lst` 的 `sub_10018800` 逐 case 對照 register 讀取大小（`movsx`/`mov`），並用實檔比對數值合理性。

### 4.4 canvas payload ❓（唯一還需要 RE 的部分）

已知：
- payload 以 check byte `0x73` 或 `0x1B` 開頭（實測）。
- `Canvas.dll` 是唯一 import `ZLZ.dll` 的模組 → 像素解壓走 **ZLZ**（Wizet 自製 LZ）。
- `ZLZ.dll` 匯出僅 3 個：`?ZLZCreateInflator@@YAPAUZIStream@@PAU1@I@Z`、`?ZLZCreateDeflator@@YAPAUZIStream@@PAU1@H@Z`、`?ZLZCloseFilter@@YAXPAUZIStream@@@Z`；inflate 主體疑為 `sub_100028E0`（740 行）、deflate 為 `sub_100036A0`（447 行）、`sub_100049F0` / `sub_10004EC0` 為可疑的濾波器核心。
- canvas 通常含 width/height/format/mag + 解壓後 BGRA；`Gr2D_DX8.dll` 內有 `>> 7` 反覆出現（整數 alpha 混合，非格式相關）。

**下一步（預估 1–2 週）**：
1. 讀 `Canvas.dll.c` 找 canvas 物件建構子（會出現寬高相乘 `*w * h`、`*4`、BGRA 常量）。
2. 讀 `ZLZ.dll.c` `sub_100028E0` 還原 inflate（它只被少數地方使用，規模小）。
3. 用 `UI/Basic.img` 的 `Cursor` canvas 當第一個解碼目標（小、易目視驗證）。

---

## 5. 對重寫專案的意義

1. **資源樹、字串、屬性結構都已經是可程式化的了** → §4.4 未解之前，可以先建 `assets/` 的 **骨架與 metadata**（路徑、動畫幀數、origin/delay 若在屬性中）。
2. 建議實作順序：`WzV1Reader`（樹 + 字串 + 屬性 walker）→ 抽 `info/origin/delay/z` 等屬性 → 最後才接 canvas 像素。
3. **C# 版 reader 必須與 `tools/wz1.py` 對同一份 manifest 產生位元級相同的輸出**（互為驗證，見 `docs/REBUILD_EVALUATION.md` §6.3 的 offline 轉檔策略）。
4. 本規格的所有長度前綴上限（0x2000 = 8192）與 `compact-int` 規則都應寫成單元測試的邊界條件。

---

## 附錄：本次驗證用指令

```bash
python3 tools/wz1.py Data.wz        # 印出樹、image 數、資料區大小
```
輸出（節錄）：
```
Data.wz: v95 shell=87,170,312 treeEnd=0x756e dataStart=0x31935
root children: ['smap.img', 'zmap.img', 'Character', 'Effect', 'Etc', 'Item', 'Map', 'Mob', 'Npc', 'Skill', 'Sound', 'UI']
images: 1052   data: 86,967,311 bytes
```
