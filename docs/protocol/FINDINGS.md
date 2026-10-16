# 協定調查筆記（KMS 1.11, 2003）

> 規則：**每條都要有證據位址**。未證實者標 `HYPOTHESIS`，不得當規格使用。
> 證據優先序：原始 binary > IDA LST > Hex-Rays C > 實機擷取 > 外部資料。

**狀態（2026-10-16 更新）**：協定主幹（傳輸 → 框架 → 加密 → 分派）已全數定位，**登入鏈
（login → world → char → game）也已解到欄位層**，實作於
`server/src/protocol/{frame,cipher,session,packet,login,chardata,replies}.ts`，並由 `node --test` 覆蓋
（含 `test/loginflow.test.ts` 的完整鏈重播）。
剩下的未知：`CharacterData` 的道具區塊、211-byte 握手的 199 bytes `body`、CField 各區間欄位（§6）。

---

## 1. 傳輸層 ✅

| 項目 | 內容 | 證據 |
|---|---|---|
| 傳輸 | Winsock TCP（`WS2_32`、`recv`/`send`）| `MapleStory.exe` import table；`sub_43A410`、`sub_43A9B0`、`sub_43ADB0` |
| 事件模型 | `WSAAsyncSelect`，事件以 **自訂視窗訊息 1025（`WM_USER+1`）** 投遞到 WndProc | `sub_5576B0`（WndProc 分派；`1025` case）|
| 事件對應 | `FD_READ(1)`→`sub_43A9B0`；`FD_WRITE(2)`→`sub_43ADB0`；`FD_CONNECT(16)`→`sub_43A410`；`FD_CLOSE(32)`→`sub_43ACC0` | `sub_5576B0` |
| 非阻塞 | `recv` 回 −1 且 `WSAGetLastError() == 10035`（WSAEWOULDBLOCK）時 `Sleep(100ms)`，最多重試 100 次 | `sub_43A410`（`n100 = 100`）|
| 接收緩衝 | 每次接收緩衝 **1460** bytes（= MTU）| `sub_43C3F0(..., 1460, ...)` 於 `sub_43A410` |
| 收包模型 | 收到後包成 `ZSocketBuffer` 並串進 socket 的 buffer 鏈 | `sub_43A9B0`、`sub_43B6B0`（⚠️ 後者實為 `ZRef<T>::operator=`，非消費端）|
| 送包模型 | 送出佇列（`ZSocketBuffer` 鏈），部分送出時把剩餘 bytes 重新排隊 | `sub_43ADB0` |
| 類別 | `CClientSocket`（vftable `0x5860A8`）、`ZSocket`、`ZSocketThread`、`ZSocketBuffer`、`INetMsgHandler`、`IUIMsgHandler` | RTTI（`analysis/rtti_raw.txt`、`analysis/rtti_classes.txt`）|

## 2. 封包框架（framing）✅

**已證實**：**4 bytes 標頭（明文）+ 加密本文**，總長 = `bodyLen + 4`。

```c
// sub_4A1940（組包器）
packet = alloc();                       // 物件欄位：bytes @+8、len @+12、header @+14、bodyLen @+16、cursor @+20
if (filled >= *(u16*)(data + 2) + 4)    // 本文長度不足就繼續收
```

- `u16 @ 0`：`magic ^ HIWORD(cipherState)`——**每個封包都不同**，同時作為狀態同步自檢（§3、§3.1）。
- `u16 @ 2`：本文長度；本文 = 接下來的 `bodyLen` bytes，**加密**。
- 上限：單包不超過 **1456 bytes** 本文；超過時 `sub_4A2030` 會切成 **1460 bytes 的 socket chunk** 送出，
  **只有第一塊帶標頭**（`sub_4A2030` 內 `v11 > 1456` 分支）。
- 明文特例：**連線後第一個封包是 211 bytes 的握手**，其本文不加密（金鑰就藏在裡面）。

**已證實的 211-byte 握手**（`sub_43A410`，於 `FD_CONNECT` 後執行）：

```
u16 totalLen                     // == 211（= 0xD3），否則：
    > 211 → CxxThrowException(_TI3_AVCPatchException__)      // 需要更新（PATCH）
    < 211 → CxxThrowException(_TI3_AVCTerminateException__)  // 終止
u16 bodyLen                      // == 199
u8[bodyLen] body                 // 199 bytes
u32 clientSendSeed               // @ 4 + bodyLen = 203  → CClientSocket+120（送 state）
u32 clientRecvSeed               // @ 8 + bodyLen = 207  → CClientSocket+124（收 state）
```

> 解讀：這是**登入/版本檢查握手**。長度必須等於 211 是這支 handler 的契約；兩個例外類別的存在意味著
> 「版本不符 → 走更新流程」。`body` 的內容語意仍為 **UNKNOWN**（§6 待辦 1）。
>
> ✅ **已證實：伺服器先送**。`sub_43A410` 由 `FD_CONNECT` 觸發，函式內以 `recv()` **兩段式**讀取
> （先 2 bytes 長度，再讀到 `總長 == u16@0`），所以它不可能是 client 的招呼封包——client 在收到這 211 bytes
> 之前不會送任何東西。重寫版 client 必須等握手；重寫版**伺服器必須先送握手**。
>
> 欄位順序（`.lst 0043A744–0043A774`）：`u32 @ 4+bodyLen` → `CClientSocket+120`（**送** state）、
> `u32 @ 8+bodyLen` → `+124`（**收** state），兩者皆原樣寫入（無 `not`、無轉換）。
>
> **client 的第一個回包**（`.lst 0043A7D4–0043A844`，`sub_43A410` 尾段）：握手解析完、且
> `CClientSocket+36 == 0` 時，client 會建一個 buffer（`sub_4A1EA0(&buf, 4, 0)` = 先塞入 byte `0x04`）、
> 再附上 `u32 *(CWvsApp+0x14)`（`mov edx, n3000` `mov esi, [edx+14h]`），走一般送出路徑送出。
> 也就是說：**握手之後 client 送的第一個封包是 `[0x04][u32 app+0x14]`**。
>
> ✅ **寫入點已找到（2026-10-16）**：`sub_432FB0`（選角成功的 0x03 回包處理）在 `.text:00433196`
> 執行 `mov [ebx+14h], esi`（`ebx = n3000`），值來自伺服器在 0x03 回包裡給的 **token**
> （見 §4.8）。所以 `[0x04][u32]` 的意義 = **「我是剛剛被導向過來的那個角色/連線」**：
> 登入伺服器在選角成功時發一組 token，client 帶著它連上遊戲伺服器、握手後立刻回報，
> 遊戲伺服器才知道這條新連線屬於哪一個角色。

## 3. 加密（cipher）✅

**已證實**：金鑰 = 狀態的**最低位元組**；狀態是 MSVC `rand()` 的 LCG。

```c
key = (u8)state;
// 收：sub_4A1B90
body[i] = swapNibbles(key ^ body[i]);
// 送：sub_4A2030
body[j] = key ^ swapNibbles(plain[j]);
// swapNibbles(x) = (x << 4) | (x >> 4)
// 每包結束後推進一次（送出/收到「之後」）：
state = state * 214013 + 2531011;      // mod 2^32
```

| 項目 | 內容 | 證據 |
|---|---|---|
| 送／收狀態 | `CClientSocket + 120`（送）、`+ 124`（收）| `sub_43AD50`（送）、`sub_43AFA0`（收：`*((_BYTE*)this + 124)` 取 key）|
| 種子來源 | 上述握手的兩個 `u32` | `sub_43A410` |
| 標頭 | **兩個方向不同**（見下）| `.lst 0043AD75`、`.lst 0043AFF9` |
| 推進時機 | **每個封包一次**（不是每個 byte）| `sub_4A2030`、`sub_4A1B90` 呼叫端 |

> 驗證自檢：因為標頭由狀態推導，**用錯種子會立刻在標頭出現不符**，不會靜默產生看似合理的亂碼。
> 實作把這點變成硬檢查（`SessionDeframer.headerOk`、`decode` 的 exit code）。

### 3.1 ⚠️ 兩個方向的標頭常數不同（實測兩處）

```
client → server : header = 0x00D3 ^ HIWORD(sendState)
server → client : header = 0xFF2C ^ HIWORD(recvState)      // 0xFF2C = ~0x00D3
```

- **送**：client 只有一條送出路徑（`sub_43AD50`，login/選角/遊戲全走它）。`.lst 0043AD75` 將 `0D3h`
  推入 `sub_4A2030`；`.lst 004A20F7–004A2113` 計算 `HIWORD(state) ^ 0xD3` 並存成封包第一個 word。
- **收**：`.lst 0043AFF9`（`sub_43AFA0`）要求 `header ^ HIWORD(recvState) == 0FF2Ch`，不符就
  `sub_43AC20` → `AVCDisconnectException`（斷線）。Hex-Rays 把這個比較顯示成 `!= -212`
  （0xFF2C 的 signed 16-bit 值），是容易誤讀的地方。`sub_43AFA0` 另外要求 `bodyLen <= 0x8000`。

0xFF2C 正好是 `~0xD3`，看起來是「同一常數在某一側被反相」。**原因不重要**：client 的檢查就是契約，
所以**伺服器必須送 0xFF2C 系列、且必須接受 0xD3 系列**。搞錯的症狀是「client 靜默斷線」。
> ✅ 這條已用「兩處獨立位址 + 兩處皆為唯一呼叫點」確認；`0D3h` 與 `0FF2Ch` 在整個 `.lst` 中各只出現一次。

## 4. 封包分派（dispatch）✅ 已完整定位（含分派鏈）

opcode 是**本文第 0 個 byte**。`sub_43B170`（由 `sub_43AFA0` 的解密後呼叫）讀取它並分派：

```c
// sub_43B170(this = CClientSocket, packet)
// packet 物件：bytes @+8、len @+12、header @+14、bodyLen @+16、cursor @+20
opcode = packet->bytes[cursor++];          // cursor 從 4 之後開始
switch (opcode) {
  case 0x07: sub_43B400(packet); break;
  case 0x08: sub_43B280(this, packet); break;
  case 0x0A..0x14: sub_55A900(n3000, opcode, packet); break;   // 只有 0x0B..0x13 真的被處理
  default:   (**(dword_5C212C + 8))(dword_5C212C + 8, opcode, packet);   // → CField 的訊息介面
}
```

`dword_5C212C` = **當前 CStage 實例**（登入階段或 CField）；由 `sub_4C3460`（= `SetStage`，內含
`_RTDynamicCast(..., &CStage, &CField, ...)` 與 `dword_5C212C = ...`）安裝。`+8` 是它的多重繼承子物件，
其 vtable `??_7CField@@6B@_1`（`.rdata:005865EC`）slot 0 = **`sub_472770`**，也就是**遊戲封包的總路由**。

### 4.1 遊戲封包路由（`sub_472770`，唯一入口）

`sub_472770(this, opcode, packet)` 依 opcode 區間轉給各子系統（`.c 121119`）：

| opcode | 子系統 / 目標 | 證據 |
|---|---|---|
| 0x15–0x17 | `sub_4C2760(this, opcode, packet)`（CField 本身）| `sub_472770` |
| 0x19 | `sub_4728B0(packet)` | 同上 |
| 0x1A | `sub_472910(this - 8, packet)` | 同上 |
| 0x1B–0x2D | **CUserPool**（`sub_51CF70(dword_5C1CEC, …)`）| 見下 |
| 0x2E–0x37 | **CMobPool**（`sub_492330(dword_5C2054, …)`）| ctor `sub_4913E0` 安裝 `??_7CMobPool@@6B@` |
| 0x38–0x41 | **CNpcPool**（`sub_49F560(dword_5C2050, …)`）| ctor `sub_49F020` 安裝 `??_7CNpcPool@@6B@` |
| 0x42–0x45 | **CRewardPool**（`sub_4A8870(this_4 = 0x5C204C, …)`）| ctor `sub_4A73A0` 安裝 `??_7CRewardPool@@6B@` + 寫入 0x5C204C |
| 0x46–0x48 | **CQuestMan**（`sub_4A58F0(dword_5C2048, …)`）| ctor `sub_4A5830` 安裝 `??_7CQuestMan@@6B@` |
| 0x49–0x4C | `sub_4B73A0(opcode, packet)` | `sub_472770` |
| 0x4D–0x4F | `sub_4E18D0(opcode, packet)` | 同上 |
| 0x50–0x52 | `sub_4815E0(opcode, packet)` | 同上 |
| 其他 | 忽略（無 else 分支）| 同上 |

第二層（`CUserPool` = `sub_51CF70`，`.c 289155`）：0x1C→`sub_51CFE0`、0x1D→`sub_51D280`、
0x1E–0x20→`sub_51D530`、0x21–0x2A→`sub_51D590`、0x2B–0x2C→`sub_51D6A0`（0x1B、0x2D 在這一層被忽略）。
`CUserPool` 的 ctor `sub_51CA30` 內含 `ZMap<ulong, ZRef<USERREMOTE_ENTRY>, ulong>`（`+0x0C`）。

> **結論**：遊戲 opcode 空間落在 **0x15–0x52**（有空洞），且每個區間屬於一個明確子系統。
> 這是產生 `protocol/schema/` 的路線圖：每個子系統 handler 的欄位讀取順序即為該區間封包的欄位。

### 4.2 已解出的三個特殊 opcode

| opcode | 內容 | 證據 |
|---|---|---|
| 0x07 | **伺服器遷移/斷線**：`[u8 flag][u32 addr][u16 port]`。`flag == 0` → 直接丟 `AVCDisconnectException`（斷線）；否則把 addr/port 組成 `sockaddr_in`（port 經 `htons`）交給 `sub_558BD0` 連線。 | `sub_43B400`（`.c 67092`）|
| 0x08 | **echo/ping**：讀 1 個 `u32`，把 `[0x08][u32]` 送回對端（走一般送出路徑 `sub_43AD50`）。 | `sub_43B280`（`.c 67002`）＋ `sub_4A1EA0`/`sub_4A1F20`（逐 byte append 的緩衝）|
| 0x0B–0x13 | 登入/選角階段的九個處理函式（0x0B→`sub_55BAB0`、0x0C→`sub_55BDC0`、0x0D→`sub_55BEB0`、0x0E→`sub_55B6A0`、0x0F→`sub_55C090`、0x10→`sub_55C5E0`、0x11→`sub_55C130`、0x12→`sub_55C390`、0x13→`sub_55CDE0`）。**0x0A 與 0x14 會被忽略**（switch 沒有 case）。 | `sub_55A900`（`.c 351269`）|

### 4.3 已排除的錯誤線索（勿重試）

- ❌ 沒有大型靜態 jump table 分派器：最大的 `jpt_56FB8B`（46 目標）屬於 `sub_56FA9D`（韓文 Hangul
  0x4003–0x400D 的 COM/BSTR 轉換）。`sub_4F9AD0` 是 UI tooltip。
- ❌ `sub_43B6B0` 是 `ZRef<T>::operator=`（refcount），不是收包佇列的消費端。
- ❌ `sub_449F30`（含 `jpt_449F68`、cases 112–123）是**UI 事件路由**，不是封包分派。

### 4.4 封包欄位編碼（已解，寫／讀兩端都有證據）

| 型別 | 線上格式 | 寫入端 | 讀取端 |
|---|---|---|---|
| byte | 1 byte 原樣 | `sub_4A1EA0(&buf, byte, 0)`（開包並塞入 opcode）或 `sub_431DE0(&buf, 1)` + 直接寫 | `sub_45DC40(&dst, ptr, avail)`：讀 1 byte，回傳 1；不足丟 `ZException(38)` |
| u16 | little-endian 原樣，無前綴 | `sub_431DE0(&buf, 2)` + 直接寫 | `sub_45DC80(&dst, ptr, avail)`：讀 2 bytes，回傳 2；不足丟 `ZException(38)` |
| u32 | little-endian 原樣，無前綴 | `sub_431DE0(&buf, 4)` + 直接寫 | handler 內直接 `*(_DWORD*)(ptr + cursor)`（自己做邊界檢查）|
| 字串 | **`u16 長度` + 原始 bytes（無 NUL、無長度逃逸）** | `sub_430230(&buf, zstr)` → `sub_4303C0(dst, zstr)`：`*dst = len; memcpy(dst+1, data, len); return len + 2` | `sub_418610(&zstr, ptr, len)`（`len == -1` 時用 `strlen`）|

> 讀取端一律是「先檢查剩餘長度、不足就丟 `ZException` code 38」。`server/src/protocol/packet.ts`
> 以 `PacketUnderflowError(code = 38)` 對應這個行為：**寧可爆掉也不要回 undefined**，否則欄位解析錯了會靜默產生垃圾。

傳送端 API（`sub_43AD50(buf)` 才是真正的送出）：

```c
sub_4A1EA0(&buf, OPCODE, 0);   // 建立送包緩衝，第一個 byte 就是 opcode
sub_430230(&buf, zstr);        // 附加字串（u16 長度 + bytes）
sub_431DE0(&buf, 4);           // 保留 4 bytes（u32），呼叫端自行寫入後把長度 +4
sub_43AD50(this, &buf);        // 加標頭（0xD3 ^ HIWORD(sendState)）→ 加密 → 排入送出佇列
sub_45DC40(&dst, ptr, avail);  // 讀 1 byte；回傳消耗的 byte 數
sub_45DC80(&dst, ptr, avail);  // 讀 2 bytes（u16）
```

> 讀取端的常見樣式是 `cursor += sub_45DC40(...)`（每次 1 byte），多 byte 欄位則直接記憶體存取；
> 因此「handler 讀了幾個欄位、順序如何」就是該 opcode 的欄位定義。

### 4.5 client → server opcode 目錄（抽取自 `sub_4A1EA0(&buf, N, 0)` 的所有呼叫點）

共 **39 個** opcode 會被送出（同一 opcode 可能有多個呼叫點）。已解出欄位者：

| opcode | 欄位 | 來源函式 / 類別 | 意義 |
|---|---|---|---|
| 0x01 | `u16 len id` + `u16 len pw` | `sub_4D0B20`（由 `sub_4D0000`/`CTitle` 呼叫）| **登入請求**（帳號、密碼）|
| 0x02 | `u8 worldIndex` | `sub_54DFC0`（`CWorldSelect`）| **選世界**（index 對應 0x01 回包裡的世界清單，§4.8）|
| 0x03 | `u32 characterId` | `sub_431620(1000)`（`CUICharSelect`）| **選角進入遊戲**（§4.8）|
| 0x04 | `u32 *(CWvsApp+0x14)` | `sub_43A410` | **握手回覆**（見 §2）|
| 0x05 | `u16 len name` | `sub_42FD30`（`CUINewChar` 的「確定」）| **建立角色**（只送名字，外觀由 0x06 先送，§4.8）|
| 0x06 | `u16 len name` + `u32 ×10` | `sub_431620(1002)` | **角色名檢查 + 外觀**（回應是 0x04，§4.8）|
| 0x07 | `u32 characterId` | `sub_431620(1001)` | **刪除角色**（回應是 0x06，§4.8）|
| 0x08 | `u32`（原封不動回傳）| `sub_43B280` | **echo/ping 回覆**（見 §4.2）|
| 0x09 | `u32`（`*(this+300)`）| `sub_5545F0` | 世界伺服器相關請求 |
| 0x0A | `u16 len str` + `u32`，送出後 `Sleep(300)×2` 並丟 `CTerminateException` | `sub_5545F0` | **要求遷移**：等伺服器切換連線（配合 §4.2 的 0x07）|
| 0x0E | `u8 *(CStage+156)` | `sub_542C40`（`CVecCtrlUser`）| 意義未定（單 byte）|

### 4.6 ⚠️ 修正：`0x0B` 不是登入封包，它是「道具欄操作」

§4.6 舊版把 `0x0B` 記成「client 在登入畫面等的那個封包」。**這是錯的**：`0x0B–0x13` 是
`CWvsApp` 層級的通用處理函式（在**任何**階段都會被呼叫，不只登入），而 `0x0B` 的內容是
**角色的道具欄異動**。登入流程與它無關，走的是 §4.7 的階段分派。

`0x0B`（`sub_55BAB0`，`this = CWvsApp`；道具在 `*(CWvsApp+0x24)`，也就是本機角色的
`CharacterData`，欄位見 §4.9）：

```
u8  result                       // 非 0 時：*(CWvsApp+24) = 0，*(CWvsApp+28) = timeGetTime()
u8  count                        // 後續條目數
count × {
  u8  op                         // 0 = 放入道具、1 = 重設道具加密金鑰、2 = 兩格互換、3 = 清空格子
  u8  inventory                  // 1..4（1 = 裝備欄、2 = 消耗、3 = 其他、4 = 現金）；其他值丟棄該條目
  u16 slot                       // 格子編號；裝備欄（inventory = 1）可用負值 -1..-14 = 已穿戴的格子
  <op 專屬欄位>
}
```

- 容器：`*(u32*)(charData + 4*inventory + 362)`（寫入端 `sub_55E8F0`，要求 `inventory ∈ 1..4`）。
  裝備欄另有兩組 inline 格：`charData+122` 與 `charData+242`（各 15 格，8 bytes/ZRef）。
- `op = 0`：接一個 `GW_ItemSlot`（`sub_45E6A0`）：先 `u8 flag`（1 → `GW_ItemSlotEquip`，0x62 bytes；
  否則 `GW_ItemSlotNonEquip`，0x26 bytes），再叫該物件的 `Decode`（vtable slot 1）讀它的欄位（🟡 未解）。
- `op = 1`：再讀 `u16 key`，用 `sub_55E780` 把那把金鑰寫進「道具 + 34」的隨機加密區；
  **`inventory == 1`（裝備欄）會被 client 直接丟 `CTerminateException`**，伺服器不可對裝備欄送這個 op。
- `op = 2`：再讀 `u16 slot2`，兩格互換。`op = 3`：清空該格。
- 收尾 `sub_55EB00` 回傳非 0 就丟 `AVCDisconnectException`（它檢查的是 `charData` 的穿戴格）。

> 這一節的價值不只是「解了一個 opcode」：它證明「同一號碼在登入階段成對」的舊假設是錯的，
> 分派其實是**兩層：當前階段 → opcode**（§4.7）。

### 4.7 ✅ 伺服器封包的真正分派：以「當前階段」為準

`sub_43B170` 只對 `0x07` / `0x08` / `0x0A–0x14` 有硬編碼分支，其餘全部交給 `dword_5C212C`
（當前 stage 實例）的 `INetMsgHandler` 子物件（`stage+8`）的 slot 0。每個 stage 類別各有自己的
`OnPacket`，而「進入這個階段時要拿上一階段的資料」則由 vtable slot 1 負責
（`sub_4C3460` = `SetStage`：安裝 `dword_5C212C`、呼叫新 stage 的 slot 1 傳入參數）。

| stage | `OnPacket`（`??_7<類別>@@6B@_1` slot 0）| 處理的 opcode | 收到 SetStage 參數的 slot 1 |
|---|---|---|---|
| `CStage`（基底）| `sub_4C2760` | `0x16` → `sub_4C2780` | — |
| `CLogo` | 繼承 `sub_4C2760` | — | `sub_47FAF0` 系列 |
| `CTitle`（登入畫面）| **`sub_4D0D70`** | **`0x01`** → `sub_4D0DB0` | `sub_4D0000` |
| `CWorldSelect` | **`sub_54E210`** | **`0x02`** → `sub_54E250` | `sub_54D6A0`（收**世界清單**）|
| `CCharSelect` | **`sub_431EE0`** | **`0x03`** → `sub_432FB0`、**`0x04`** → `sub_432430`、**`0x05`** → `sub_4329A0`、**`0x06`** → `sub_432890` | `sub_431080`（收 **3 個角色紀錄**）|
| `CField`（遊戲內）| `sub_472770` | `0x15–0x52`（§4.1）| `sub_4728D0` |

- 這些 vtable 位址都在 `.rdata`，且都能在 `.lst` 直接讀出（`??_7CTitle@@6B@_1` @`.rdata:00586F50`
  = `sub_4D0D70`、`??_7CWorldSelect@@6B@_1` @`00587E8C` = `sub_54E210`、`??_7CCharSelect@@6B@_1`
  @`00585F10` = `sub_431EE0`、`??_7CField@@6B@_1` @`005865EC` = `sub_472770`）。
- 每個 stage 的 `OnPacket` 都只是個 `switch`：不認得的 opcode 直接丟掉（不會斷線）。
- **同一個 opcode 在不同階段可以是完全不同的封包**，而**請求與回應也不必然同號**
  （刪角色：請求 `0x07`、回應 `0x06`）。舊 §4.7 的「+0x0A 成對」表因此作廢。

### 4.8 ✅ 登入鏈：login → world → char → game（全部已解到欄位層）

四個階段的封包如下。所有 `result` 值用同一組訊息字串（`sub_4D0DB0`／`sub_54E250`／`sub_432FB0`
共用），`0` = 成功並繼續解析 payload。

| 階段 | client → server | server → client |
|---|---|---|
| `CTitle` | `0x01`：`string 帳號` + `string 密碼`（`sub_4D0B20`）| `0x01`：`u8 result`，成功時見下 |
| `CWorldSelect` | `0x02`：`u8 worldIndex`（`sub_54DFC0`）| `0x02`：`u8 result`，成功時 = 角色清單 |
| `CCharSelect` | `0x03`：`u32 characterId`（`sub_431620(1000)`）| `0x03`：`u8 result`，成功時 = 遊戲伺服器位址 |
| `CCharSelect` | `0x06`：`string 名字` + `u32 ×10`（外觀）| `0x04`：`string 名字` + `s8 result`（0 = 可用）|
| `CCharSelect` | `0x05`：`string 名字`（建立）| `0x05`：`u8 result`，成功時 = 新角色的 `CharacterData` |
| `CCharSelect` | `0x07`：`u32 characterId`（刪除）| `0x06`：`u32 characterId` + `u8 flag`（0 → client 丟 `CTerminateException 570425350`）|
| （連上遊戲伺服器後）| `0x04`：`u32 token` | — |

**`0x01` 成功 payload**（`sub_4D0DB0`）：

```
u32 app4      → CWvsApp+0x04（語意未定）
u8  app8      → CWvsApp+0x08（語意未定）
u8  app9      → CWvsApp+0x09（`CUINewChar` 用 `~app9 & 1`，所以它帶帳號的性別位元）
u8  worldCount
worldCount × { string 世界名; u32 未定欄位 }
```

→ client 把整份世界清單交給 `CWorldSelect`（`sub_4C3460`）。

**`0x02` 成功 payload**（`sub_54E250`）：

```
u8 charCount
charCount × CharacterData          // 見 §4.9；client 固定填 3 格，超過 charCount 的格子自己清零
```

**`0x03` 成功 payload**（`sub_432FB0`，`.lst 0043310F–00433196`）：

```
u32 ip        // 網路位元組序！讀出後「原封不動」存進 sockaddr_in.sin_addr（沒有 htonl）
u16 port      // host order，client 自己 htons
u32 token     // → CWvsApp+0x14
```

→ client 用 `sub_558BD0`（與 `0x07` 遷移同一條連線函式）連到 `ip:port`，把 token 存進
`CWvsApp+0x14`，播放 "GameIn" 音效；抵達遊戲伺服器、收完 211-byte 握手後，就用
`[0x04][token]` 表明身分（§2）。**這條線現在完全閉合。**

**`result` 值表**（`sub_4D0DB0`／`sub_54E250`／`sub_432FB0` 三個 handler 的 switch 完全相同）：

| result | client 訊息（原字串符號）| 意義 |
|---|---|---|
| `0`（以及 `1`、`>= 10`）| — | **成功**，解析 payload |
| `2`, `3` | `aAi` | 帳號或密碼錯誤 |
| `4` | `asc_5B3610` | 密碼錯誤 |
| `5` | `aAi_0` | 不能連線的帳號 |
| `6`, `8`, `9`, `0xFF` | `aO_2` | 帳號被限制 |
| `7` | `aAiI_0` | 帳號停權或 IP 被封鎖 |

> 證據：`sub_4D0DB0` 被編譯成 `switch (result + 1)`，`sub_54E250` 直接 `switch (result)`；兩者
> 的 case 群完全對應（`0xFF↔0`、`6↔7`、`8↔9`、`9↔10`），jump table `jpt_433024` 的註解也把
> default 標成 `cases 0,1`。**`result = 1` 會走成功分支**這件事很不直覺，但兩個 handler 都是這樣。

> 建立角色的外觀：`0x05` 只送名字，外觀在**前一個** `0x06` 裡（`sub_431620(1002)`：名字 + 10 個
> `u32`，其中 6 個來自被選取角色的部位、4 個來自新角色對話框自己的選擇）。所以伺服器必須把
> `0x06` 收到的那組外觀記在這條連線的狀態裡，等 `0x05` 來時才建角色。

### 4.9 ✅ `CharacterData`（角色紀錄）在網路上的樣子

`sub_45FCC0` = `CharacterData::Decode`（選角畫面與世界清單都用它）：

```
u8 flags
if (flags & 1) <75-byte 能力值區塊，見下>      // sub_45D840
if (flags & 2) <30 個裝備格 + 4 個道具欄 …>    // 🟡 尚未逐欄解出（見 §6）
```

75-byte 能力值區塊（`sub_45D840` 的讀取順序，就是欄位順序）：

| 位移 | 型別 | 名稱 | 備註 |
|---|---|---|---|
| +0 | u32 | `id` | 選角 UI 用它比對要刪除／選擇的角色（`sub_432890`）|
| +4 | 13 bytes | `name` | **固定 13 bytes、NUL 補齊、沒有長度前綴**（`sub_45DD00` 直接 memcpy）|
| +17 | u8 | `gender` | |
| +18 | u32 | 外觀 A | `sub_42E2C0` 把它交給 `sub_424590`（兩值 setter）|
| +22 | u32 | 外觀 B | `sub_42E2C0` 把它放進 avatar 的第 0 個部位格 |
| +26 | u8 | 🟡 未定 | 真的是 u8，夾在 `face`/`hair` 之間（結構有 `#pragma pack`）|
| +27 | u32 | `hair` | |
| +31 | u8 | `level` | 以下到 `unknown93` 在**客戶端記憶體**裡是混淆的 |
| +33 | u16 ×11 | `job, str, dex, int, luk, hp, maxHp, mp, maxMp, ap, sp` | 寬度與順序完全吻合 |
| +55 | u32 | `exp` | |
| +59 | u16 | `fame` | |
| +61 | u32 | 🟡 未定 | |
| +65 | u16 | 🟡 未定 | |
| +67 | u32 | 🟡 未定 | |
| +71 | u32 | 🟡 未定 | 這兩欄（+71、+75）在客戶端裡**沒有**被混淆 |
| +75 | u8 | 🟡 未定 | |

- **混淆只在記憶體裡**：client 把 `rand()` 與 `value ^ rand()` 並排存（`sub_4618B0`），但**送到線上的
  是純值**——client 自己的編碼器（`sub_45D740`/`sub_45D640` 呼叫點附近，約 `.c:101309`）在寫出前
  把兩半 XOR 回來。兩邊都不需要 RNG。
- ⚠️ **線上是 75 bytes，不是 102**：選角 UI 每個格子複製 `CharacterData[0..101]`（`sub_42E2C0`：
  `qmemcpy(..., 0x64)` + 尾端 word），多出來的 27 bytes 是客戶端自己的狀態、不在封包裡。
  寫錯長度會讓下一筆紀錄整串錯位。
- 讀寫兩端都**逐欄位**讀取且越界就丟 `ZException(38)`，所以伺服器必須把 75 bytes 全部寫滿。

## 5. 字元編碼

- 遊戲內字串（WZ）用 **ASCII / UTF-16LE + 位置遮罩**（見 `docs/WZ1_FORMAT.md` §3）。
- 網路訊息（封包）中的字串編碼**已解**：`u16 長度` + 原始 bytes，見 §4.4。
  ⚠️ 注意與 WZ 檔內的字串編碼（位置遮罩）**完全不同**，不要混用。

## 6. 待辦（依重要性）

1. **`CharacterData` 的道具區塊（`flags & 2`）**：`sub_45FCC0` 的形狀已大致看得出來——
   `15 × {u8 格子, GW_ItemSlot}`（第一組穿戴格）、同樣再一組、四個道具欄各一段
   `u8 格子數`（`sub_4605A0` 調整 ZArray 大小）+ `{u8 格子, GW_ItemSlot}*`，最後還有一小段
   `u8 n` + `n × 8 bytes`。真正缺的是 **`GW_ItemSlotEquip`/`NonEquip` 的欄位**（`sub_45E6A0` 建立物件後
   呼叫 vtable slot 1 = `Decode`）。這同時是 §4.6 的道具欄 opcode 缺的那一塊。
2. **211-byte 握手的 `body`（199 bytes）**：長度規則已知（§2），內容語意仍未知；最快的解法是用
   `capture --handshake-body <hex>` 餵不同內容觀察原 client 的反應。
3. **各 stage 的剩餘 opcode**：`0x07`／`0x08` 已解（§4.2），`0x0A–0x14` 是 `CWvsApp` 層級
   （`sub_55A900`）——`0x0B` 已解（§4.6），其餘 `0x0C–0x13` 是同一族的角色/道具狀態封包，
   值得一次讀完（`sub_55BDC0` 已看出是「道具欄格子數調整」）。`0x15–0x52` 依 §4.1 區間表往下解。
4. **`0x04` 的請求方**：`0x04` 只出現在 client 的握手回覆（`sub_43A410`）與伺服器的名檢查回覆
   （`sub_432430`）；本版 client 沒有任何地方送出「名檢查請求」（0x06 才是）。真實流量要確認
   伺服器是不是在收到 `0x06` 時回 `0x04`。
5. 由 §4.1／§4.5／§4.7–§4.9 的對照表產生 `protocol/schema/`，並用 `capture` 對照真實流量驗證。
6. 抓到真實流量後回頭確認：`0x0E` 在兩個方向都出現（`CVecCtrlUser` 送出、`sub_55B6A0` 接收），
   確認它是同一件事還是兩個不同階段的同號封包。

## 7. 擷取工作流（ADR-004）

> ✅ 除了被動擷取，現在也可以**主動走完登入鏈**：
> `node server/src/cli.ts serve --port 8484 --game-port 8485 --account admin:admin`
> （實作 §4.8；原 client 導向該 port 即可走到選角畫面。遊戲內階段尚未實作，因此進地圖後會停在
> `GameEntryServer` 的 token 記錄上。）

```bash
# 1. 接住原 client。session 模式會「先送」211-byte 握手（種子由我們選、寫進 trace），
#    再即時解密 client 回送的封包。
node server/src/cli.ts capture --port 8484 --out traces/login.jsonl

#    想要可重現的實驗就固定種子；想試握手 body 內容就餵它（body 語意仍未知，看 client 反應）
node server/src/cli.ts capture --port 8484 --handshake 0x11223344:0x55667788 \
     --handshake-body 0001020304... --out traces/login.jsonl

#    若手上是「client 先送握手」的流量（例如重播），改用 --handshake off
node server/src/cli.ts capture --port 8484 --handshake off --out traces/login.jsonl

# 2. 把 JSONL 重播成可讀封包（種子由 trace 內的握手自動決定；沒有握手時手動給）
node server/src/cli.ts decode traces/login.jsonl
node server/src/cli.ts decode traces/login.jsonl --c2s-seed 0x11223344 --json
```

- trace 的 `hex` 一律是**線上的原始 bytes**（證據），`plainHex` 才是解密的本文。
- 任何無法解碼的 chunk 只會被標記一次，之後該連線改為 raw dump——外部探測（如 sandbox 的 HTTP probe）
  不會汙染 trace。
- `decode` 會逐包檢查標頭並以非零 exit code 回報不符：**用錯種子的假成功會被抓出來**。
  （此機制已抓到一個真實 bug：早期版本用同一個種子解兩個方向，client 的封包會解成「看似合理的亂碼」。）
- 方向與種子的對應：**c2s 用 client 的送 state、s2c 用 client 的收 state**；握手由其**接收方**取得
  `sendSeed`（送）與 `recvSeed`（收）。伺服器先送握手時，「接收方」就是 client。
