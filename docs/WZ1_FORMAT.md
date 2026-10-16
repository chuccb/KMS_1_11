# WZ v1（2002 Wizet 格式）規格 — 由本倉庫 binary/Data.wz 反推

> 狀態圖例：**✅ 已驗證**（以 `Data.wz` 實檔 + 反編譯碼雙重確認）、**🟡 部分**（結構已知、細節待補）、**❓ 未解**
> 現況：**`.img` 值層已完整**——全部 1,052 張 image 都能被 `tools/wzimg.py` 逐 byte 解析完（見 §4），像素也全部解得開。
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
**驗證**：本倉庫的 `tools/wz1.py` 以 1,052 張 `.img` 完整走完樹。子樹的「宣告 size」與「葉節點 size 總和」在 `Map` 差 172,999 bytes，那**不是**目錄寫錯，而是檔案尾端夾著 4 個沒有任何 entry 指向的物件（見 §4.7）。
**資料區定位**：目錄 entry 不含 offset 欄位，blob 由 `tree_end` 起照樹序串接；但要解析驗證（§4.7），`tools/wzdata.py` 才是支援的入口。

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
- 字串去重字典在 `PCOM.dll.c` `sub_1000C9A0`（寫）／`sub_1000D020`（讀）；`sub_1000CEE0` 輸入長度上限 0x2000。
  字典的 key 規則見 **§4.4**（該 key 是整個 `.img` 值層都會用到的共同基準）。
**驗證**：`Character/Accessory/01010000.img`、`Map/Back/darkCave.img`、`Sound/` 全部可讀，1,052 個檔名 100% 合理。

---

## 4. `.img` 內容 ✅（1,052/1,052 逐 byte 完整解析）

> 本節每一條規則都同時滿足兩個條件：**(a)** 全檔 1,052 張 image 用同一套規則解析時，每一個 blob 都恰好用完自己的位元組（第一個物件起點 = 0、最後一個物件終點 = 宣告 size）；**(b)** 與 `PCOM.dll.c` / `Canvas.dll.c` 的反編譯碼一致。
> 實作：`tools/wzimg.py`（值層編解碼）、`tools/wzdata.py`（定位 + 統計）；指令見附錄。

### 4.1 物件語法（marker）✅

| marker | 意義 | 後續 |
|---|---|---|
| `0x73` | 新類別名 | §3 字串（並登記進名稱表，見 §4.4） |
| `0x1B` | 類別名引用 | `u32` 名稱表 key |
| `0x23` | `"#"`（清單類別） | 無 |
| `0x41` | 物件序列結束（`'A'`） | 無 |

**證據**：`PCOM.dll.c` L16644 寫入端 `sub_1000C9A0(name, stream, 0x1B, 0x73)`（第 3 個參數＝引用標記、第 4 個＝內嵌標記，兩者不可相同）；L16702–16712 讀取端 `switch`：`case 0x23` / `case 0x1B`（用索引 1 → 引用）/ `case 0x73`（索引 0 → 內嵌），`if (b == 65) goto 結束`。

### 4.2 property list 與 entry tag ✅（**修正舊版推論**）

```
propertyList = u16 0 + compact-int count + count × entry
entry        = u8 tag + <name> + u8 type + <value>
tag = 0 ：name 為 §3 字串（緊接在後）
tag = 1 ：name 為 u32 名稱表 key（緊接在後）
```

舊版本寫「entry 沒有前導位元組」，那是**錯的**：`u16 0` 之後每個 entry 都有 1 byte tag。
全檔量測：tag 0 = 863,612 次、tag 1 = 184,001 次（tag 2 未出現；保留處理）。

**證據**：`PCOM.dll.c` L25740–25880。讀取迴圈先讀 1 byte，再用 `sub_1000D020(dst, table, tag)` 取得名字（該函式的第 3 參數就是這個 tag）；寫入端 L25770 `sub_1000C9A0(name, stream, 1, 0)`。

### 4.3 型別表（`PCOM.dll.c sub_10018800` switch + 全檔量測）✅

| type | value 大小 | 判定 | `Data.wz` 出現次數 |
|---|---|---:|---|---:|
| 0 | 0 | Null（無值） | 135 |
| 2, 11, 16, 17, 18 | 2 | **u16** | 2: 198 |
| 3, 4, 19 | 1（`0x80` → 後接 i32） | compact int | 3: 448,113／4: 100 |
| 6 | 1（`0x80` → 後接 i64） | compact int64 | 0 |
| 5, 7 | 8 | f64 | 5: 56 |
| 8 | 見下 | 字串 | 147,680 |
| 9, 13 | `u32 size` + 物件 | 物件 | 9: 451,331 |

```
type 8：u8 flag ；flag == 0 → §3 字串緊接在後
                  flag == 1 → u32 名稱表 key
```
（全檔 flag 分佈：0 = 134,432、1 = 68,611。）

- 只有 **3/4/19** 是 1-byte compact；**2/11/16/17/18 是 u16** — 舊版把這幾列寫反了。
- 舊版提到的 **type 37 不存在**：那是把 entry tag 誤當型別讀的產物。
- 出現次數為 0 的型別只由反編譯碼支持（15 個 case：0,2,3,4,5,6,7,8,9,11,13,16,17,18,19）；本版不得用現代 WZ 的型別數值硬套。

### 4.4 名稱表（string cache）✅ — 全文共用的一把尺

- **key = 該字串「長度位元組」在『本 image 之內』的位移**；不是 archive 絕對位移，也不是索引。
- 四種引用形式共用同一個 key 空間：`0x1B`（類別名）、entry tag 1（屬性名）、type 8 flag 1（字串值）、`UOL` kind 1（連結目標）。
- 命中時只花 4 bytes，後面**不會**再出現字串；未命中時讀取器 seek 到該位移把字串讀出來、再回到原本位置（`Data.wz` 從未用到此路徑）。
- 全檔量測：**696,774 次引用全部命中**（650,567 次 marker/tag/值 + 46,207 次 UOL in-link）。

> **教訓（本倉庫曾經踩到的坑）**：把 key 當成 archive 絕對位移時，只有前幾張 image 能解析，其餘 1,046 張失敗（`IndexError`、type 246 等症狀）——因為 `.img` 子檔當初是獨立寫出來的，key 的基準是子檔開頭。修正後 1,052/1,052 全過。

### 4.5 類別 body ✅

| 類別 | body 內容 |
|---|---|
| `Property` / `#` / `""` / 其他 `Shape2D#*` | property list（§4.2） |
| `Shape2D#Vector2D` | compact x、compact y |
| `Shape2D#Convex2D` | compact count + count 個「無 size」物件 |
| `UOL` | `u8 flag`、`u8 kind`：0 = 路徑字串（`../../swingPF/0/body`）、1 = u32 名稱表 key（指向已登記的路徑） |
| `Canvas` | §4.6 |
| 其他 | 原始位元組直到物件結尾 |

全檔類別出現次數：`Property` 235,189、`Shape2D#Vector2D` 109,511、`Canvas` 55,379、`UOL` 54,298、`Shape2D#Convex2D` 747、`Sound_DX8` 92。
UOL 之中 8,091 個是 kind 0（自帶路徑字串）、46,207 個是 kind 1（in-link，重用別人已寫好的路徑）。

`Sound_DX8` 只出現在 `Sound/`（10 張 image）：每個節點（`SleepyWood`、`FloralLife`…）的 body 就是整段音訊原始位元組（1.4–2.6 MB），格式由 `Sound_DX8.dll` 定義，本 reader 不解析。

### 4.6 Canvas 物件 ✅（含像素）

```
u8 flag            （必須為 0，否則 ZException(1392)）
u8 hasProps        （1 → 先讀一個 property list）
compact width
compact height     （>= 0x10000 → ZException(1392)）
compact fmt        （只允許 1、2、513，其他 → ZException(1392)）
compact pad
compact ×4         （每一個都必須為 0，否則 ZException(1392)）
u32 pixelLen
pixelLen bytes     ← 像素區
```

**證據**：`Canvas.dll.c` L28980–29100（讀取端：`sub_1001E740` 讀 flag、`sub_1001F340` 連續讀 4 個 compact、四連零檢查、`u32` 長度、`if (len) sub_1001DE50(...)`）；L28820–28920 為寫入端。表面建立參數是 `(width, height, fmt, pad)`（L29084 的 vtable+60）。

- **像素格式與 bpp**（三種，`Canvas.dll.c` L14101–14150 依「來源格式 × 目的格式」挑 blitter，證明每個格式的 layout）：

| fmt | bpp | 像素 layout | 證據 |
|---|---|---|---|
| `1` | 2 | **ARGB4444**：word 低位元組在前，bits 15-12 = A、11-8 = R、7-4 = G、3-0 = B | L14505 `sub_1000DBD0`（16→32bpp 展開器）把 4 個 nibble 分別寫到 dword 的 B、G、R、A 位元組；資料面：`Mob/1210102.img`（주황버섯）解出來是橘色 |
| `2` | 4 | **A8R8G8B8**，記憶體順序 B、G、R、A | 同一個展開器的**輸出**就是 fmt 2 的緩衝區；本檔 0 張，屬 🟡 |
| `513` | 2 | **RGB565、無 alpha**：bits 15-11 = R5、10-5 = G6、4-0 = B5 | L15664 `sub_1000F370`（16→16bpp blitter）對全部 65,536 個輸入值等價於標準 4444→565（`R5=R4<<1|R3`、`G6=G4<<2|G2`、`B5=B4<<1|B3`），逐值驗證 0 個不符 |

  `pixel_bpp()` 的 `fmt & 0xFF == 2` 因此有了正確的解讀：低位元組是「深度」（1 = 16bpp、2 = 32bpp），**bit 8 是「有無 alpha」**（0x201 = 16bpp 但改成 565、顏色不走 alpha）。
- **像素區**：`u8 flag`（非 0 → ZException(1392)，`Canvas.dll.c` L29190）+ zlib stream；解壓目標大小 = `width * height * bpp`。
- **本版寫入器省略 zlib 的 4-byte adler32 trailer**：一次性 `zlib.decompress()` 會拒絕（`.eof` 永遠不為真），必須用 `decompressobj().decompress(body, width*height*bpp)`——客戶端就是這樣 inflate 進預先清零的緩衝區。
- 全檔統計（`--census`）：**55,379 個 canvas**（fmt 1 = 55,314、fmt 513 = 65），**55,377 個完整解碼、2 個「短流」**：`Map/Back/dryRock.img`（256×256，只寫了 512 B）與 `Map/Back/midForest.img`（128×128，只寫了 128 B），兩者 `pad = 4`，其餘 55,377 個 `pad = 0`。短流以「其餘像素為 0」處理並以 `Canvas.partial` 標記。
- **`pad` 欄位**（`compact`，緊接在 `fmt` 之後）：全檔 55,377 個 canvas 是 0，**只有那 2 張短流是 4**。除了「都是 fmt 513 的背景圖」之外沒有其他相關性，語意**仍未解**（不猜）。
- **那 2 張短流是「被截斷的 zlib stream」**：`decompressobj().eof` 為 False、`unconsumed_tail` 為空，只吐出一個重複的 16-bit 值（`dryRock` 512 B、`midForest` 128 B）——寫入端那一塊資料本身就不完整。客戶端是 inflate 進**預先清零**的 `width*height*bpp` 緩衝區，所以它畫出來的其餘部分是 0（透明／黑），重寫版照做，並用 `Canvas.partial` 標記。
- **看得到的效果**：`node server/src/cli.ts wz png <image> --out <dir>` 把每張 canvas 寫成 PNG（`server/src/wz/png.ts`，零依賴、filter 0）；`Mob/1210102.img` 與 `UI/Basic.img` 都已用眼睛驗過是正常 sprite。

### 4.7 image 在 `Data.wz` 裡的位置 ✅（取代舊版「標頭變體」清單）

- 目錄 entry **沒有 offset 欄位**（只有 `size`、`checksum`、一個看起來像雜湊的 `u32`；`smap.img` 的該欄位是 `0x3E805BEB`，不是位移）：blob 從目錄樹結尾（`tree_end = 0x756E`）起、照樹序串接。
- 這個規則對前 **922/1,052** 張成立，之後開始出現「多出來的物件」：尾端夾著 **4 個沒有任何 entry 指向**的完整 `Property` 物件（合計 172,999 bytes，正好是舊版 `total - sum(sizes)` 的差值），而且它們**插在圖片之間**（例如 `brownBrick`（45,263）+ `coalMine`（70,611）之後是兩個大小 35,413／28,607 的孤兒物件，接著才是 `deepCave`（30,659））。
- 也就是說尾段這 130 張的**實體順序與目錄順序不一致**（看起來像被重新打包過，但目錄沒有記位移可用來修正）。本倉庫**不推測**成因，只做可驗證的事：`tools/wzdata.py` 逐一驗證「解析到底 + 根物件是 `Property`」，失敗就掃描全檔、用 size 唯一匹配定位，並在 `--manifest` 標記 `declared`／`scanned`。
- 定位必須「解析驗證」而非信任位移：`Mob/0210100.img` 的宣告位移上是一段 22,122 bytes 的雜訊，它**剛好**能解析成一個未知類別物件、長度也剛好等於宣告 size。因此驗證條件除了「解析到底」還要「根物件是 `Property`」；`tools/wzdata.py` 之後用掃描找到真正的史萊姆（`info.name = 슬라임`、`level = 6`）。
- 舊版的「標頭變體 A/B/C」不再是問題：A/B 只是「`0x73` 內嵌類別名」與「`0x1B` 引用類別名」的差別，C（`Etc/Tips.img`）也已被同一套規則解開。
- 結果：`tools/wzdata.py` → **1052/1052**（922 declared + 130 scanned、0 missing）。

### 4.8 仍未解（精簡清單）

| # | 項目 | 下一步 |
|---|---|---|
| 1 | `pad` 欄位的語意（見 §4.6；只有 2 張 `pad = 4`） | 找一個 `pad != 0` 且像素完整的樣本，或追寫入端 |
| 2 | 2 張「短流」canvas 的繪圖語意（截斷的 stream；客戶端是否只畫到拿到的部分） | 追 `Gr2D_DX8` 的 blit；重寫時先用「其餘為 0」近似 |
| 3 | type 6/7/11/13/16/17/18/19 未在 `Data.wz` 出現 | 只依 `PCOM` switch 支援，遇到再驗 |
| 4 | `Sound_DX8` body 的音訊格式 | `Sound_DX8.dll.c` |

## 5. 對重寫專案的意義

1. **`.img` 值層已經沒有未知項**：屬性樹、字串、名稱表、Canvas 像素全部可程式化取得；重寫版可以直接以「WZ 樹 → 遊戲資料」的方式載入，不需要任何自製壓縮或猜測。
2. 伺服器／工具端（`server/src/wz/`）有四件事：**目錄樹**（§2）、**值層編解碼**（§4.1–§4.6）、**定位**（§4.7）、**像素 → PNG**（§4.6）。Python 端的 `tools/wz1.py` / `tools/wzimg.py` / `tools/wzdata.py` 是參考實作與驗收基準；TypeScript 端（`server/src/wz/`）是**產品實作**，`server/test/wzimg.test.ts` 對同一組黃金值（1,052 / 922+130 / 55,379 / 696,774 refs / 29×30 第一張 canvas 的 sha256）比對，兩邊必須一致。
   資產管線因此只有一份實作：不放 `tools/wz2assets.py`，PNG 由 `server/src/wz/png.ts` 產生（見 `DECISIONS.md` ADR-005）。
3. 仍需注意的三個近似：`pad` 欄位（§4.8 #1）、2 張短流 canvas（#2）、`Sound_DX8` 音訊（#4）。三個都只影響繪圖/播放，不影響資料模型。
4. 本規格的所有邊界條件（長度前綴上限 0x2000、compact int 的 `0x80` 逃逸、`0x41` 結束、四個零、`fmt` 白名單）都應寫成單元測試。

## 附錄：驗證用指令

```bash
node --test "server/**/*.test.ts"                   # TypeScript：149 個測試（含 WZ 值層/像素/PNG）
node server/src/cli.ts wz census                    # canvas 普查（與 --census 同數字）
node server/src/cli.ts wz maps                      # 100 張地圖的 info/foothold/portal/life
node server/src/cli.ts wz dump <image path>         # 單張 image 的屬性樹（--json 為 plain() 視圖）
node server/src/cli.ts wz png <image path> --out assets/   # 每張 canvas → PNG（用眼睛驗）
python3 -m unittest discover -s tools/tests -v      # 47 個測試：合成 fixture + 對真檔的黃金值
python3 tools/wz1.py Data.wz                       # 目錄樹、image 數、資料區大小
python3 tools/wzdata.py Data.wz --census           # 值層普查（canvas/像素/定位統計）
python3 tools/wzdata.py Data.wz --manifest analysis/data_wz_manifest   # .txt + .json 清單（含真實 offset）
python3 tools/wzdata.py Data.wz --maps analysis/map_meta.json          # Map/Map/*.img 的 info/foothold/portal/life
python3 tools/wzdata.py Data.wz --dump Character/Cap/01000000.img      # 單張 image 的屬性樹
python3 tools/wzdata.py Data.wz --dump Character/Cap/01000000.img > analysis/sample_Cap_01000000_properties.txt
```

`--census` 目前的輸出：
```
images=1052 resolved={'declared': 922, 'scanned': 130} unlisted=4/172,999B
  canvases                           55379
  fmt 1                              55314
  fmt 513                            65
  pixels exact                       55377
  pixels short (zero padded)         2
```
