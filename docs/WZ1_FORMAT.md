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

## 4. `.img` 內容 🟡（結構已解、值細節剩小差距）

### 4.1 已完整還原：屬性名稱/型別/巢狀結構 ✅

以 `Character/Cap/01000000.img`（10,290 bytes）為例，掃描 + 逐項驗證後**還原出 186 個屬性的完整樹**，
內容與 2003 年 KMS 裝備圖完全一致（完整清單見 `analysis/sample_Cap_01000000_properties.txt`）：

```
icon(9)  origin(9)  iconRaw(9)
info(9)
    name(8) islot(8) vslot(8) reqJob(3) reqLevel(3) reqSTR(3) reqDEX(3) reqINT(3)
    reqLUK(3) incPDD(3) tuc(3) price(3) cash(3)
    default(9)   → map(9) brow(9) z(8) cap(37)
    backDefault(9) → map(9) brow(9) z(8) backCap(37)
    walk1(9)/walk2/stand1/stand2/alert/sit/jump/fly/heal/prone/proneStab
    swingO1..O3,OF / swingT1..T3,TF / swingP1..P3,PF / stabO1,O2,OF / stabT1,T2,TF
    shoot1,2,F / ladder / rope            （每組內含 0(9) 1(9) 2(9) 3(9) 影格節點）
```
**證據**：`analysis/sample_Cap_01000000_properties.txt`（每個屬性的位移、名稱、型別、下一項位移）。

### 4.2 property list / 屬性項（已量測）✅

```
propertyList = compact-int count + count × entry
entry        = string name          // §3 編碼
               u8 type
               value                // 依 type，見 §4.3
```
關鍵：**entry 沒有額外前導位元組**。以「entry_bytes == 1 + len(name) + 1 + value_size」對 186 個屬性做量測，
所有已知型別的 value_size 都得到**一致的整數值**（見 §4.3 表），即模型成立。

### 4.3 型別表（由量測 + `PCOM.dll.c` 交叉驗證）

| type | 出現次數（Cap 樣本） | 量測 value_size | 判定 |
|---|---:|---:|---|
| 0 | 10 | 0 | Null（無值）：`name` 的進階容器節點會用此型別 |
| 3 | 20 | **2** | 短整數（reqJob/reqLevel/price/tuc… 數值皆合理） |
| 37 | 3 | — | **本版特有**（`cap`/`backCap` 影格資料，0x25）待查 |
| 8 | 9 | 1 ~ 27 | 字串（`islot`/`vslot`/`z` 為 1 byte；`name` 為 27 bytes） |
| 9 | 144 | 12 ~ 675 | 物件：`u32 size` + payload（可為 property list 或 canvas 描述） |

`PCOM.dll.c` 的 15-case 型別分派位於 deserializer `sub_10018800` / serializer `sub_10012920`
（case 集合：0,2,3,4,5,6,7,8,9,11,13,16,17,18,19）。
**注意**：本版不必然與現代 WZ 的 type 數值相同 — `37` 就是現代 WZ 沒有的值，**禁止用現代 type 表硬套**。

### 4.4 Canvas 物件 ✅（描述部分）

`icon` 條目的值（18 bytes，位移 11..28）：
```
bb 02 00 00        u32 = 699         ← canvas 資料大小（像素區，見 4.5）
73                 check byte 0x73
fa                 len = 6
e9 ca c2 db cf dc  → "Canvas"        ← 物件標籤（與 "Property" 同一套字串編碼）
00 01 00 00 01 00  6 bytes 標頭       ← 寬/高/格式待對照 Canvas.dll 確認
```
`iconRaw` 則以 `0x1B` 開頭的另一種標記（見 §4.6）。

**重要發現**：`icon` 的 699 bytes **不在屬性區內**（屬性項只有 18 bytes）→ 像素資料存在 image blob 的**後段資料區**，
由 `u32` 大小 + 某種位移關聯；`icon`(699) 與 `iconRaw`(610) 的兩個大小值都在條目內出現。
（`Character/Cap/01000000.img` 總長 10,290，屬性項到 ~9,500，尾部即為像素資料區。）

### 4.5 影像標頭變體

| 變體 | 開頭 | 實例 | 已驗證 |
|---|---|---|---|
| A | `73` + `"Property"` + `u16 0` + count | `Mob/0100100.img`、`UI/Basic.img` | ✅ 逐 byte |
| B | `00 00 00` + count | `Character/Cap/01000000.img`（count = 15） | ✅ |
| C | 其他（疑似 ZLZ 壓縮） | `Etc/Tips.img` | 🟡 |

### 4.6 仍未解（**明確清單，含下一步**）

| # | 項目 | 難度 | 下一步 |
|---|---|---|---|
| 1 | entry 值是否有 1 byte 前導/尾隨（量測上等價，需以原始碼定案）| 低 | 讀 `PCOM.dll.c sub_10018800` 的 `case 3`（`sub_10015C10`）確認讀取長度 |
| 2 | type 8 字串值的格式（1~27 bytes 變動） | 低 | 同上，`case 8` 分支 |
| 3 | type 37（本版特有） | 低 | 在 `MapleStory.exe` 找 `CActionMan` 的 frame entry 讀取 |
| 4 | canvas 6-byte 標頭（寬/高/格式） | 低 | 對照 `Canvas.dll.c`（找 `*w * h`、`*4`、BGRA） |
| 5 | **像素資料 + ZLZ inflate** | 中 | `ZLZ.dll.c sub_100028E0`（740 行）；先用 `UI/Basic.img` 的 `Cursor` 驗證 |
| 6 | 標頭變體 C（`Etc/Tips.img` 等） | 低 | 檢查是否為整段 ZLZ 壓縮的 property list |

> 影響：**屬性樹（名稱/型別/巢狀）已經可以匯出**，動畫的 frame 數量、origin/delay/z 等**metadata 可先解析**；
> 只有「畫出像素」需要完成 #4/#5。

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
