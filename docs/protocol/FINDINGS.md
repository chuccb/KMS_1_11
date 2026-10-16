# 協定調查筆記（KMS 1.11, 2003）

> 規則：**每條都要有證據位址**。未證實者標 `HYPOTHESIS`，不得當規格使用。
> 證據優先序：原始 binary > IDA LST > Hex-Rays C > 實機擷取 > 外部資料。

**狀態（2026-10-16 更新）**：協定主幹（傳輸 → 框架 → 加密 → 分派）已全數定位，**登入鏈
（login → world → char → game）已解到欄位層**，`CharacterData`（含**能力值 69 bytes ＋ 道具區塊
＋ `GW_ItemSlot`**）與 `CWvsApp` 層級的 `0x0B–0x13` 也已解出，實作於
`server/src/protocol/{frame,cipher,session,packet,login,chardata,itemslot,replies}.ts`，並由
`node --test` 覆蓋（含 `test/loginflow.test.ts` 的完整鏈重播、`test/itemslot.test.ts` 的逐 byte 佈局）。
**遊戲內第一條垂直切片也已解到欄位層**（§4.11：進地圖 `0x16`、別人進場 `0x1C`、離場 `0x1D`、
移動 `0x22`／`0x0E`、傳送門請求 `0x0D`），實作於 `server/src/protocol/{field,movepath}.ts`；
怪物／NPC／掉落物的分派也已拆到函式層（§4.12，欄位仍待讀）。
剩下的未知：211-byte 握手的 199 bytes `body`、CField 其餘區間（`0x1E–0x2C`、CMobPool／CNpcPool／
CRewardPool／對話框／messenger／miniroom）欄位（§6）。

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
> 執行 `mov [ebx+14h], esi`（`ebx = n3000`），值來自伺服器在 0x03 回包裡給的 **角色 id**
> （§4.11.3 證明它是 id，不是不透明的 ticket）
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
| 0x0D | `s32 kind` + `string name` | `sub_472590`（`CField::SendInteract`）| **點擊場地物件／傳送門**（`kind = -1`），也是 GM 的 `/헉맵 <mapId>`：見 §4.11.6、§4.13 |
| 0x0E | `u8 *(CStage+156)` + `CMovePath` | `sub_542C40`（`CVecCtrlUser`）| **本機角色自己的移動**；舊註記只寫了那個 u8，因為 `CMovePath` 的來源是後來才定位的（§4.11.6）|
| 0x0F | **已完整解出（byte-exact）**：`u8 段數\|目標數<<4`、`u32 游標物件 id`、`u8 面向<<7\|動作`、`u8 目標上限`、每目標 11 B ＋ 段數×`u16` 傷害 | `sub_512F90` | **普通攻擊**（§4.13.1）|
| 0x10／0x11 | 同形狀；`0x10` 多一個 `u16`，兩者的高 nibble 是「有第二個物件」旗標而非計數 | `sub_513C80`／`sub_514D30` | 魔法／技能攻擊（§4.13.1b，已解）|
| 0x12 | `string` | `sub_470C70` | **一般聊天**（§4.13）|
| 0x22/0x23/0x25/0x26/0x27 | 見 §4.13 | `sub_470E10`／`sub_4717D0`／`sub_471A40`／`sub_471C*` | GM 廣播／密語／交易／**組隊**／GM 數值指令 |
| 其餘 39 個 | — | 見 §4.13.2 的完整 sender 目錄 | |

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
- `op = 0`：接一個 `GW_ItemSlot`（`sub_45E6A0`）：先 `u8 種類`（= `itemId / 1000000`：`1` →
  `GW_ItemSlotEquip`，物件 0x62 bytes；其餘 → `GW_ItemSlotNonEquip`，0x26 bytes），再叫該物件的
  `Decode`（vtable slot 1）讀欄位——**欄位已全部解出，見 §4.9**。這是全協定唯一會寫種類位元組的地方
  （`CharacterData` 的道具區塊都不寫）。
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
| （連上遊戲伺服器後）| `0x04`：`u32 characterId` | — |

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
u32 characterId  // → CWvsApp+0x14；**這就是本機角色的 id**（§4.11.3：別人的進場封包會拿角色的
                 // id 和它比對來判斷「那是不是我自己」），不是不透明的通行證。伺服器必須一直用同一個 id
```

→ client 用 `sub_558BD0`（與 `0x07` 遷移同一條連線函式）連到 `ip:port`，把 id 存進
`CWvsApp+0x14`，播放 "GameIn" 音效；抵達遊戲伺服器、收完 211-byte 握手後，就用
`[0x04][characterId]` 表明身分（§2）。**這條線現在完全閉合。**

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

### 4.9 ✅ `CharacterData`（角色紀錄）在網路上的樣子（含道具區塊，已全部解出）

讀：`sub_45FCC0` = `CharacterData::Decode`（`CCharSelect` 的 `0x02` 回包、`CStage` 的 `0x16`、
`sub_54E250` 都用它）。
寫：`sub_45F610` = `CharacterData::Encode`（只從 vtable 呼叫；能力值區塊交給 `sub_45D2E0`，
每個道具交給 `sub_45E560`）。**兩支逐欄位互相對應**，這也是下面每個長度都能確定的原因。

```
u8 flags
if (flags & 0x01) <能力值區塊 69 bytes>
if (flags & 0x02) { 穿戴裝備、穿戴現金裝備、裝備欄、該欄的 8-byte 記錄 }
if (flags & 0x04) { 道具欄 2 }
if (flags & 0x08) { 道具欄 3 }
if (flags & 0x10) { 道具欄 4 }
if (flags & 0x20) { u16 count, count × {u32, u32} }
if (flags & 0x40) { u16 count, count × {string, string} }
```

**每個道具欄**（含裝備欄）的形狀是：

```
u8 capacity                     // = 客戶端 ZArray 的元素數 − 1（見下）
{ u8 slot, GW_ItemSlot }*       // slot 0 結束
u8 0
u8 n
n × 8 bytes                     // 客戶端每欄一個 8-byte 記錄陣列（this + 4*inv + 102）
```

- 兩組**穿戴格**（`this+122`、`this+242`，各 15 格、索引 1..14）沒有 capacity 欄，直接進
  `{u8 slot, item}` 迴圈（`sub_45F610`：`n14 = 1; do {...} while (n14 <= 14)`）。
- `capacity` 就是客戶端的陣列大小 − 1：解碼端 `u8 n` → `sub_4605A0(v, n+1, ...)` 調整大小，
  編碼端寫 `ZArray 元素數 − 1`。**0 是合法的**（只有 index 0 的 dummy 格），之後可以用 `0x0C`
  （§4.10）放大。
- ⚠️ **整塊道具區塊裡沒有任何「種類位元組」**：編碼端每個道具欄都呼叫
  `sub_45E560(item, packet, 0)`（= 不寫種類），種類由「哪一欄」決定——穿戴格與裝備欄是
  Equip，2/3/4 欄是 NonEquip。只有 `0x0B` op 0（§4.6）會把種類位元組寫上線。

**能力值區塊：69 bytes**（`sub_45D840` 讀、`sub_45D2E0` 寫，兩邊都是 24 個欄位）

| # | 型別 | 名稱 | 備註 |
|---|---|---|---|
| 1 | u32 | `id` | 選角 UI 用它比對要刪除／選擇的角色（`sub_432890`）|
| 2 | 13 bytes | `name` | **固定 13 bytes、NUL 補齊、沒有長度前綴**（`sub_45DD00` 直接 memcpy）|
| 3 | u8 | `gender` | |
| 4 | u32 | `appearanceA` | `sub_42E2C0` 把它交給 `sub_424590`（兩值 setter）|
| 5 | u32 | `appearanceB` | `sub_42E2C0` 把它放進 avatar 的第 0 個部位格 |
| 6 | u8 | `unknown26` | 真的是 u8，夾在第二個外觀字與頭髮之間（結構有 `#pragma pack`）|
| 7 | u32 | `hair` | |
| 8 | u8 | `level` | 以下到 `unknown93` 在**客戶端記憶體**裡是混淆的 |
| 9–19 | u16 ×11 | `job, str, dex, int, luk, hp, maxHp, mp, maxMp, ap, sp` | 寬度與順序完全吻合 |
| 20 | u32 | `exp` | 記憶體 +77/+81；`0x0D` 升級訊息讀這一對 |
| 21 | u16 | `fame` | 記憶體 +85/+87 |
| 22 | u32 | `unknown93` | 記憶體 +89/+93 |
| 23 | u32 | **`mapId`** | 記憶體 +97，**不混淆**。**已證實是地圖 id**：`0x16` 把它與 `mode` 一起交給新場地物件（§4.11.2），最終 `sub_468E00` 用它載入 `Map/Map/%09d.img`（`sub_4694F0`）|
| 24 | u8 | `unknown101` | 記憶體 +101，**不混淆** |

- ⚠️ **本節前一版寫的「75 bytes、尾巴多 u32/u16 各一」是錯的**：那版把 `sub_45D840` 的
  *記憶體* 位移（+65/+67/+71/+75…）當成線上位移。實際上線上尾巴只有 5 個欄位
  （u32 + u16 + u32 + u32 + u8 = 15 bytes），總長 32 + 22 + 15 = **69**。讀寫兩端各自加總都
  得到 69，寫錯長度會讓後面整串錯位。
- **混淆只在記憶體裡**：client 把 `rand()` 與 `value ^ rand()` 並排存（`sub_4618B0`），線上送的是純值
  （`sub_45D2E0` 在寫出前把兩半 XOR 回來）。兩邊都不需要 RNG。
- 客戶端的**記憶體**結構是 102 bytes（`sub_55BEB0` 複製 100 bytes + 一個 word；`sub_45F5C0`
  對隊友直接 memcpy 0x66 = 102 bytes）：差額就是每個混淆配對的填充半 + 對齊尾巴。
- 讀寫兩端都逐欄位讀取且越界就丟 `ZException(38)`，所以伺服器必須把 69 bytes 全部寫滿。

**`GW_ItemSlot`（單一道具）** — 這是前一版缺的那一塊，完整落在 `server/src/protocol/itemslot.ts`：

```
u32 itemId
u8  hasCash      // 讀到的旗標；寫出時由「8 bytes 是否為 0」推導（sub_45E860 用 *(u64*)(obj+0x10)）
if (hasCash) {
    u64 cashSn        // 記憶體 +0x10
    u16 unknown18     // 記憶體 +0x18
    u64 unknown1A     // 記憶體 +0x1A
}

GW_ItemSlotEquip（種類 = 1）         GW_ItemSlotNonEquip（其他種類）
u8  ruc    남은 업그레이드 횟수       u16 quantity
u8  cuc    업그레이드에 사용한 횟수
u16 ×15    str dex int luk maxHp maxMp pad mad pdd mdd acc eva craft speed jump
```

證據：

| 事實 | 位址 |
|---|---|
| 建物件＋讀種類位元組（0 → 讀 1 byte，1 → Equip，其餘 → NonEquip）| `sub_45E6A0` |
| 物件大小：Equip `0x62`、NonEquip `0x26` bytes | `sub_45E6A0`（`sub_403350(&dword_5C25F0, 0x62u)`）|
| 基底讀／寫（itemId、旗標、8/2/8 bytes）| `sub_45E9F0` / `sub_45E860` |
| Equip 讀／寫（ruc、cuc、15 × u16，順序即此）| `sub_45ED50` / `sub_45EB50` |
| NonEquip 讀／寫（quantity）| `sub_45F1B0` / `sub_45F130` |
| 15 個 u16 的**語意與順序**（每個欄位一行 tooltip）| `sub_5014C0`：STR、DEX、INT、LUK、HP、MP、공격력(PAD)、마력(MAD)、물리방어력(PDD)、마법방어력(MDD)、명중률(ACC)、회피율(EVA)、손재주(CRAFT)、이동속도(SPEED)、점프력(JUMP)、以及 `ruc` = "업그레이드 가능 횟수"、`cuc` = 名字後的 "(+n)" |
| 15 個 u16 的來源（WZ `info` +46..+74 → 物件 +38..+96，順序相同）| `sub_47A740`（+44 = ruc，cuc 寫 0）|
| 種類位元組的值 = `itemId / 1000000` | `sub_45E560`（`*(this+3) / 1000000`）|
| `cashSn != 0` ⇒ **不能丟棄**（與 WZ `info/cash` 同一個判斷式）| `sub_463BE0`（"이 아이템은 버릴 수 없습니다."）、`sub_47A420`（讀 `cash`）|

> 語意未定但不影響傳輸的欄位：`unknown18`、`unknown1A` 沒有任何讀取端（全 binary 只有編碼／解碼
> 碰它們），先保留結構名；`quantity` 在 `sub_47A740` 建新道具時寫 1。

### 4.10 ✅ `CWvsApp` 層級的 `0x0B`–`0x13`（與階段無關）

`sub_43B170` 把 `0x0A–0x14` 全部交給 `sub_55A900`，它是一個 9-way switch（`0x0A`／`0x14` 沒有 case，
直接丟棄）。以下每一個都讀「本機角色的 `CharacterData`」，也就是 `*(CWvsApp+0x24)`：`sub_463050`
取得它、`sub_465710` 取得某一格道具。

| op | 處理函式 | 內容 | 讀到的欄位 |
|---|---|---|---|
| `0x0B` | `sub_55BAB0` | 道具欄操作（**已解，見 §4.6**）| `u8 result, u8 count, count × {...}` |
| `0x0C` | `sub_55BDC0` | **道具欄格數變更** | `u8 inventory(1..4), u8 slots` → `sub_55E7C0(charData + 4*inv + 362, slots + 1, …)`（對 `sub_4605A0` 的包裝）|
| `0x0D` | `sub_55BEB0` | **能力值差異更新**（升級／配點後）| `u8 flag`（非 0 → `CWvsApp+0x18/0x1C` 重設：`= 0`、`= timeGetTime()`）、`u8 level?` + 差異欄位（`sub_45E0D0`），接著 `sub_4C5DC0(CWvsApp+0x70, packet, …)` 更新能力面板；等級變大時顯示 "레벨이 올랐습니다 (+%d)" |
| `0x0E` | `sub_55B6A0` | **`charData+382` 的 `ZMap<u32,u32>` 更新** | `u8 flag`（同上重設）、`u16 n`、`n × {u32 key, s32 value}`：`value > 0` → insert，`value <= 0` → 移除該 key（`sub_460630`）|
| `0x0F` | `sub_55C090` | **能力面板更新** | 無條件重設 `CWvsApp+0x18/0x1C`；`u8 flag`；若 flag ≠ 0 再讀 `u8 mode`，`mode == 0` → `sub_4C5DC0(CWvsApp+0x70, packet, …, 0)` |
| `0x10` | `sub_55C5E0` | **組隊（파티）系統**：見下表 | `u8 type` + 依 type 的 payload |
| `0x11` | `sub_55C130` | **獲得提示** | `u8 type`：`1` → `u32` → "메소를 획득했습니다 (+%d)"；其他非 0 → `u32 itemId`(`sub_479D30` 查名) → "아이템을 획득했습니다 (%s)" / "(%s %d개)" |
| `0x12` | `sub_55C390` | **인기도（人氣）系統** | `u8 type` + `string name`（`sub_432680`）：`0` → `u8 ok`（"'%s'님은 인기도를 …"，成功／失敗兩種訊息）、`2` = "초보자는 인기도를 올리거나 내리지 못합니다."、`3` = 等級不足、`4` … |
| `0x13` | `sub_55CDE0` | **系統訊息／公告** | `u8 type` + `string text`：`0` → "[시스템] %s"（聊天視窗）、`1` → `sub_52BBE0(text)`（畫面中央公告）|

`0x10` 的 type 對照（`sub_55C5E0` 的 switch，訊息字串就是語意）：

| type | 意義 | payload |
|---|---|---|
| `3` | 收到組隊邀請，跳 dialog；按「是」時 **client 送出 `0x26`**：`u8 2` + `u32`（邀請者的角色 id）| `u32`（`CWvsApp+0xC8+36` 非 0 才會出現）+ `string` 邀請者名 |
| `5` | 新組隊建立 | `u32` + **102-byte 角色區塊**（`sub_45F5C0` 直接 memcpy）|
| `6` | （把暫存的隊友資料歸零）| `u32`；本機 id 相同時顯示 "새로운 파티를 만들었습니다" |
| `7`, `14` | "이미 가입된 파티가 있습니다" | — |
| `8` | "초보자는 파티를 만들 수 없습니다" | — |
| `10` | 加入／退出結果 | `u32 角色id` + `u32 隊長id` + `u8`（0/1）+ `string 名字`："파티장을 그만둡니다…"、"…를 탈퇴…"、"…에서 강퇴당…" |
| `11` | "가입한 파티가 없습니다" | — |
| `13` | 新成員加入 | `u32 角色id` + `string 名字` + **102-byte 角色區塊** |

> 註：`0x0D` 讀的那組「差異欄位」就是 `GW_CharacterStat::Decode`（`sub_45E0D0`）：先 `u32 flags`，
> 再依 bit 讀（`0x01` → u32@+18、`0x02` → u32@+22、`0x04` → u8@+26、`0x08` → u32@+27、
> `0x10` → u8 level、`0x20` → u16 job、`0x40`… 依 §4.9 的記憶體位移）。這是「只更新有變的欄位」的
> 版本，長度可變，所以升級／配點後伺服器只需要送變動的那幾欄。

### 4.11 ✅ CField 子系統：進地圖、角色進場／離場、移動、互動（`0x16`／`0x19`／`0x1C`／`0x1D`／`0x22`／`0x0D`／`0x0E`）

§4.7 只解到「哪個 opcode 屬於哪個子系統」。這一節把**第一個垂直切片**（進地圖 → 看見別人 →
別人移動 → 用傳送門換地圖）解到欄位層，這也是「兩個 client 走進同一張圖並互相看見」所必需的最小集合。

實作：`server/src/protocol/field.ts`（封包）、`server/src/protocol/movepath.ts`（`CMovePath`），
測試：`server/test/field.test.ts`（逐 byte golden）。

#### 4.11.1 子系統的全域名稱（證據：建構子裡的 vftable）

| 全域 | 類別 | 建構子 | 收包入口 |
|---|---|---|---|
| `dword_5C1CEC` | **CUserPool** | `sub_51CA30` | `sub_51CF70`（0x1B–0x2D）|
| `dword_5C2054` | **CMobPool** | `sub_4913E0` | `sub_492330`（0x2E–0x37）|
| `dword_5C2050` | **CNpcPool** | `sub_49F020` | `sub_49F560`（0x38–0x41）|
| `dword_5C204C` | **CRewardPool** | `sub_4A73A0` | `sub_4A8870`（0x42–0x45，只有 0x43／0x44 有分支）|
| `dword_5C2048` | **CQuestMan** | `sub_4A5830` | `sub_4A58F0`（0x46–0x48）|
| `this_8` | **CUIMessenger** | `sub_4DDAF0` | `sub_4E18D0`（0x4D–0x4F）|
| `this_15` = `dword_5C2040` | **CUniqueModeless**（開著的商店／交易視窗）| `sub_4B7640`、`sub_4812D0` | `sub_4B73A0`（0x49–0x4C；0x4A 開 `CShopDlg`）|
| — | **CMiniRoomBaseDlg** | —（`_RTDynamicCast`）| `sub_4815E0`（0x50–0x52）|

`CUserPool` 的第二層（`sub_51CF70`）：0x1C→`sub_51CFE0`、0x1D→`sub_51D280`、0x1E–0x20→`sub_51D530`、
0x21–0x2A→`sub_51D590`、0x2B–0x2C→`sub_51D6A0`；**0x1B 與 0x2D 在這一層沒有分支**。

#### 4.11.2 `0x16` = 進地圖（由 CStage 基底 `sub_4C2760` → `sub_4C2780`）

```
u8  mode                      // 交給新場地物件建構子的第一個參數（= 出生方式／portal）
u8  hasData
hasData != 0:
    u32 ×3                    // ＝場地的亂數種子（見下），不是三個不明數字
    CharacterData             // 與 §4.9 同一個讀取器（sub_45FCC0）
hasData == 0:
    u32 → obj+97              // obj 由 sub_463050 取得；decompiler 掉了查表用的來源
    u8  → obj+101
    u16 → obj+53              // 以 sub_4618B0 的隨機遮罩寫入（同 §4.9 的記憶體格式）
```

之後 `sub_4C2780` 會：建立 `CField` 物件 → `sub_4C3460`（= `SetStage`）→ `sub_51CBF0(CUserPool, charData, mode)`
（配置 0x1C4 bytes = 本機角色 `CUserLocal`）；`hasData != 0` 時還多傳一個
`sub_4C3460(field, &{mode, character.unknown97})`，所以**場地／出生點參數＝`mode` ＋ `CharacterData` 的 `unknown97`**。

> ✅ **三個 u32 已經確定是場地的亂數種子**（不再是三個不明數字）：`sub_4C2780` 把三個值一起交給
> `sub_4C7930(CWvsApp+632, a, b, c)`，它對 `CWvsApp+632` 與 `+652` 各呼叫一次
> `sub_48A900`——`sub_48A900` 是「把三個部分打亂後存起來」的函式，而且它與
> `sub_4619F0`（同一個結構的反函式）正是這支 client 的**自訂亂數產生器**：
>
> - 全域的 `dword_5D2C20` 在第一次使用時以 `rand()` 取三個部分初始化
>   （`sub_461930(&dword_5D2C20, a, b, c)`，見第 105600 行附近），
> - 同一支函式就是 `Random(lo, hi)`：`return lo + sub_4619F0(&dword_5D2C20) % (hi - lo)`，
> - 攻擊路徑的 `sub_4C7960(CWvsApp+632, …)` 就是**用這個種子產生傷害數字**。
>
> 對伺服器的意義：`0x16` 送出的種子決定客戶端接下來所有「隨機」結果（傷害數字、掉落、怪物行為），
> 所以客戶端在 `0x0F` 裡回報的傷害是**可以由種子重算出來**的，不是黑箱——這是伺服器端驗證傷害的基礎。
>
> ✅ 這支產生器已經逐位元移植到 `server/src/protocol/random.ts`（`seedState`／`nextRandom`／
> `randomRange`／`class ClientRandom`），`test/random.test.ts` 用手算的序列釘住（同一組公式、
> 五個輸出值、狀態演進都在測試裡），所以「伺服器重算客戶端傷害」現在是程式碼而不是想法。
> 剩下的 UNKNOWN 只有 `mode` 的具體值，以及 `hasData == 0` 分支怎麼找到角色物件。

#### 4.11.2b ✅ 地圖是怎麼被指定的：`CharacterData.mapId` → `Map/Map/%09d.img`

上一節留下的「`mode` ＋ `CharacterData` 的 `unknown97`」這一對，這輪追完了整條鏈：

```
sub_4C2780                        // 0x16 的處理函式
  k_7 = CharacterData 本體（sub_45FCC0 解出來的）
  v48 = *(u32 *)((char *)k_7 + 97)   // ← CharacterData 的第 23 個欄位 = mapId
  LOBYTE(v49) = 封包的 mode byte
  sub_4C3460(newCField, &{mapId, mode})   // 安裝成當前場地，並呼叫它的 vtable slot 1
     └─ sub_468E00(CField, init)
          *(CField + 152) = init[0]            // mapId
          *(CField + 156) = init[1]（u8）      // mode
          sub_4694F0(mapId)                    // 載入 Map/Map/%09d.img
          sub_403190(CField + 36, 載入的節點)
          sub_469980(CField)                   // 解 foothold／ladderRope／portal／…
          sub_4C3440(1); sub_4C2AE0(CField)    // 收尾（CStage::Init 系列）
```

所以 **`CharacterData` 的第 23 欄就是地圖 id**（原本叫 `unknown97`，現在定名 `mapId`），而
**伺服器要讓客戶端進哪張地圖，就是把那個 id 塞進 `0x16` 的 `CharacterData`**——不需要別的封包。

地圖檔名由 `sub_4694F0` 以 `L"Map/Map/%09d.img"`（`sub_4389B0` 格式化）產生，例如 `1000000` →
`Map/Map/001000000.img`。同一個字串區塊把整支 **地圖載入器** 的位置全都標了出來（全部以 WZ 路徑定位，
不是猜的）：

| 函式 | WZ 路徑／節點 | 內容 |
|---|---|---|
| `sub_4694F0` | `Map/Map/%09d.img` | 開檔（回傳 map 根節點）|
| `sub_469980` | `foothold`、`ladderRope`、`portal` | 碰撞／傳送點 |
| `sub_469CC0` | `Map/Tile/`（`tile`、`z`、`zM`、`y`、`x`、`%s/%d`、`u`、`no`）| 背景圖磚 |
| `sub_46A9F0` | `Map/Obj/%s.img/%s/%s/%s`（`obj`、`oS`、`l0`、`l1`、`l2`）| 場地物件 |
| `sub_46BDA0` | `Map/Back/`、`back`、`back/%d`、`bS`、`BA`（`a`、`cy`、`cx`、`type`、`ry`、`rx`）| 背景層 |
| `sub_46DA30` | `MapHelper.img/mark/`、`mapName`、`streetName` | 小地圖標記與地名 |
| `sub_46E7C0` | `Map/MapHelper.img`（`weather`、`rain`、`snow`、`cloud`、`VR`）| 天氣／VR |
| `sub_4A4430` | `portal` | 傳送門清單（NPC／場地物件側）|

伺服器端需要的正是前三個（`foothold`／`ladderRope`／`portal`）：角色落點、可走範圍與傳送點都在那裡；
它們的路徑已收在 `server/src/wz/paths.ts`（`mapImagePath`、`MAP_NODES`、`MAP_HELPER_PATH`，
golden 測試 `test/paths.test.ts`）。

> ✅ **伺服器已經會送這個封包**：`GameEntryServer`（`server/src/net/loginserver.ts`）領到 `0x04` 的角色 id
> 之後就送 `0x16`（`mode = 0`、`full = 1`、三個亂數種子、把 `CharacterData.mapId` 換成要進的地圖），
> 地圖由 `--map` 決定（預設 `1000000`，`Map/Map/001000000.img` 存在於 Data.wz）。
> `test/serve.test.ts` 用假 client 逐欄驗證：領取 → `0x16` → `character.stats.mapId`、角色 id、名字都對，
> 而且換一個連線不會沿用上一條的狀態。這是原 client 實機驗證之前能做的最完整一步。

#### 4.11.3 `0x1C` = 別人進場（`sub_51CFE0` → `CUserRemote::Init` = `sub_520680`）

```
u32  characterId        // 等於 CWvsApp+0x14（＝自己的角色 id）時整個封包被忽略
string name             // → CUser+60
u8   unknown64          // → CUser+64
u32  avatarKey          // → CUser+68（sub_508260 = CUser::SetAvatar 的「外觀有變嗎」比較鍵）
u32  unknownA           // 讀了就丟
u32  unknownB           // 讀了就丟
u32  itemId…            // 外觀清單，**以 u32 0 結尾**（sub_45F340）
s16  x
s16  y
u8   action             // → CUser+180，也是 vecctrl 初始化的第 6 個參數
u16  foothold           // → sub_485400(場地, id) 的 foothold 查表
```

- 外觀清單**不是** `GW_ItemSlot`：`sub_45F340` 只讀 u32 道具 id，並依 `itemId / 1000 / 10`
  （100→1、101→2 … 3xxxx→0）自己歸類到外觀格，所以「只給 id 就能畫出角色」。
- 清單之後 `sub_507A20` 只做 UI（名牌／血條），不再讀封包。
- 讀完 `x/y/action/foothold` 後，客戶端用 vtable slot 46（`+184`）呼叫
  `(vecctrl, 0, x, y, 0, 0, action, foothold)` 來建立 `CVecCtrlUser` —— 這條呼叫順序是下面
  §4.11.5 判讀移動元素欄位的關鍵證據。

#### 4.11.4 `0x1D` = 別人離場（`sub_51D280`）

```
u32 characterId
```

只讀一個 id：查 `CUserPool` 的 `ZMap` → 取得 `USERREMOTE_ENTRY` → 用 `sub_51EE80` 兩次把前後節點接起來
（雙向鏈結串列的移除）。沒有任何其他欄位。

#### 4.11.5 `0x22` = 別人的移動：`u32 characterId` + `CMovePath`

`CMovePath` 的線路格式（**每個元素 14 bytes**）：

```
u16 originX
u16 originY
u8  count                     // 元素數（≤ 255）
count × {
  u8  attr                    // 元素種類；本 build 沒有表，只有「路徑過期時補的那個元素」用 1
  s16 x
  s16 y
  s16 vx
  s16 vy
  u8  action                  // 動作／姿勢位元組，直接餵給 vecctrl
  u16 foothold
  u16 duration                // 毫秒；客戶端會加總成 CMovePath+68
}
```

| 角色 | 函式 | 證據 |
|---|---|---|
| 解碼（收 0x22）| `sub_4953A0` | 讀 2×u16 → `CMovePath+4/+6`、u8 count，再逐元素配置 16-byte 結構 |
| 編碼（送 0x0E）| `sub_495620` | `CVecCtrlUser::SendMove` = `sub_542C40` 呼叫；逐元素 append `1+2+2+2+2+1+2+2` = **14 bytes**（沒有記憶體裡的兩個洞）|
| 記憶體結構 | 16 bytes／元素 | 解碼器的位移是**結構**位移：`+0 attr`、`+2 x`、`+4 y`、`+6 vx`、`+8 vy`、`+10 action`、`+12 foothold`、`+14 duration`，洞在 +1／+11 |
| 播放 | `sub_485330`、`sub_499760` | 讀 `vecctrl+250/252/254/256/258/260`（= `CMovePath+32` 的當前元素 `+2/+4/+6/+8/+10/+12`）丟進 vtable slot 46 |
| 值不值得送 | `sub_495880` | 比對「當前元素」與活體狀態：`+2`↔x、`+4`↔y、`+6`／`+8` 必須為 0、`+10`↔action、`+12`↔foothold |
| 時間上限 | `sub_4967C0` | 把每個元素的 `+14` 加進 `CMovePath+68`，再和 1000／1100 ms 比較 |

> `originX/originY` 會在送出路徑後被覆寫成「當前元素的 x／y」（`sub_495880` 尾端），所以它們是路徑的
> 起點，不是角色的即時座標；真正的位置由第一個元素的 `x/y` 決定。

#### 4.11.6 client → server 的兩個 field 封包

| opcode | 內容 | 送出的函式 | 說明 |
|---|---|---|---|
| `0x0E` | `u8 *(CStage+0x9C)` + `CMovePath` | `sub_542C40`（`CVecCtrlUser::SendMove`）| **本機角色自己的移動**。`§4.5` 舊註記只寫了那個 u8，因為那時還沒定位 `sub_495620`：路徑是接在後面的 |
| `0x0D` | `s32 kind` + `string name` | `sub_472590`（`CField::SendInteract`）| 點擊場地物件；`sub_5124C0`／`sub_512510` 在滑鼠下是傳送門時送 `kind = -1` 並播 `Portal` 音效 → **換地圖的請求**（伺服器以 `0x16` 回應）|

- `sub_472590` 內建節流：`n3000[6] != 0` 或距上次 `< 500 ms` 就拒送；送出後設 `n3000[6] = 1`。
- **`0x19` 是這個節流的解除鈕**：`sub_4728B0`（0x19 的處理函式）只做 `n3000[6] = 0; n3000[7] = timeGetTime();`
  →「客戶端送 `0x0D` 後，伺服器必須回一個空封包 `0x19`」，否則客戶端再也送不出互動封包。
- 順帶解答 §6 第 6 項：`0x0E` 在**兩個方向是兩件不同的事** —— client 送的是自己的移動，
  server 送的（`sub_55B6A0`，§4.10）是 `u16 n, n×{u32 key, s32 value}` 的 key/value 表。同號不同義。
- `0x1A`（server → client）是**密語／找人結果**家族：`sub_472910` 先讀 u8 再 `switch (值 - 9)`，
  目前看到的 case 有 9／10／18／34；字串已解出：`'%s'님을 찾지 못했습니다`（找不到人）、
  `'%s'님의 현재 위치는 '%s'입니다`（回報位置）、`'%s'님께 귓속말을 전달했습니다.`（密語已送達）、
  `'%s'님은 현재 귓속말이 거부되어 있습니다.`（對方拒收密語）、`/헉맵 %d`。

#### 4.11.7 `CUserPool` 其餘分支的現況（尚未解完）

| opcode | 分支 | 目前已知 |
|---|---|---|
| 0x1E／0x20 | `sub_51D530` | 只讀 u32 查表，**沒有** payload 處理（0x1F 才有：`sub_50B320`）|
| 0x21／0x2A | `sub_51D590` | 讀 u32 查表後 `default` → 沒有分支 |
| 0x23／0x24／0x25 | `sub_5209C0` → `sub_520F20`／`sub_521400`／`sub_521AD0` | 技能／效果家族（夾帶 76-byte 的 buff／怪物查表），欄位未讀 |
| 0x26 | `nullsub_13` | 空函式 |
| 0x27 | `sub_509790` | u32 → 動作／姿勢切換（內部依 `user+180 >> 1` 選 weapon 動作）|
| 0x28 | `sub_5221A0` | 旗標式：u32 flags，bit 0／bit 4 之後各再讀欄位 |
| 0x29 | `sub_522300` | u8；0 = 播放 `Effect/BasicEff.img/LevelUp` + `LevelUp` 音效（升級）|

> `0x15`／`0x17`（CStage 基底）沒有分支；`0x18`、`0x19`、`0x1A` 由 `sub_472770` 自己處理（0x19 見上）。

### 4.12 🟡 CMobPool／CNpcPool／CRewardPool：分派已拆到函式，欄位只到骨架

§4.11 把「哪個子系統」解到欄位層；這一節把同一條路線再往下一層拆成「哪個函式處理哪個 opcode」。
**未標「已證實」的欄位都還不能當規格用**（這一節的目的是讓下一個回合不必重讀反編譯）。

#### CMobPool（`sub_492330(dword_5C2054, opcode, packet)`）

| opcode | 分支 | 目前已知（讀取順序）|
|---|---|---|
| 0x2E | — | 沒有分支 |
| 0x2F | `sub_4924A0` | **怪物進場**：`u32 mobId`；池中已有 → `[mob+112] = 1` 後返回；沒有 → `u32 templateId`（`sub_48CFA0`→`sub_4848E0` 載模板）→ 建池項 → `sub_484ED0(newMob, mobId, packet)` = `CMob::Init` 讀剩下的欄位（下一段）|
| 0x30 | `sub_4926B0` | `u32 mobId` + `s16`，再依 `CWvsApp+0x14`（自己的角色 id）分支 |
| 0x31 | `sub_4927B0` | `u8 flag` + `u32 mobId`；`flag != 0` → `sub_491630`：查到怪 → `sub_485330(mob, 1)` 推進移動；查不到 → `u32 templateId` + `CMob::Init` + 推進；`flag == 0` → `sub_491830` |
| 0x32–0x36 | `sub_492380` | `u32 mobId` 查表，然後 0x33→`sub_488BC0`、0x34→`sub_488D90`、0x35→`sub_488E10`（0x32／0x36 沒有分支）|
| 0x37 | — | 沒有分支 |

> 移動本身**就是 §4.11.5 的 `CMovePath`**：`sub_485330` 是「取移動路徑的下一個元素並移動 vecctrl」，
> 和玩家的 `sub_499760`（`CVecCtrlUser`）是同一組程式碼。`sub_491830`／`sub_485520` 是「有沒有下一個元素」。

#### CNpcPool（`sub_49F560(dword_5C2050, opcode, packet)`）

| opcode | 分支 | 目前已知 |
|---|---|---|
| 0x38／0x41 | — | 沒有分支 |
| 0x39 | `sub_49F6C0` | **NPC 進場**（`sub_4A1720` 取 NPC 模板）|
| 0x3A | `sub_49F810` | 未讀 |
| 0x3B | `sub_49F970` | `u8 flag` + `u32 npcId`；`flag != 0` → `sub_49F260(npcId, packet)`、`flag == 0` → `sub_49F380(npcId)`（**與怪物 0x31 同型**）|
| 0x3C–0x40 | `sub_49F5B0` | `sub_49F610` 查表後 → `sub_49A280(opcode, packet)` |

#### 其餘區間（只有入口，尚未拆）

| opcode | 入口 | 已知 |
|---|---|---|
| 0x42–0x45 | `sub_4A8870`（`dword_5C204C`）| 只有 0x43→`sub_4A88A0`、0x44→`sub_4A95B0` 兩個分支 |
| 0x46–0x48 | `sub_4A58F0`（`dword_5C2048`）| CQuestMan（任務）|
| 0x49–0x4C | `sub_4B73A0` | 對話框／商店（0x4A 開 `CShopDlg`；`this_15 = dword_5C2040` = `CUniqueModeless`）|
| 0x4D–0x4F | `sub_4E18D0` | CUIMessenger，內部再 switch 0–7（`sub_4DF1D0`／`sub_4DF620`／`sub_4DF8B0`／`sub_4E19A0`／`sub_4E1E30`／`sub_4E2170`／`sub_4E2280`）|
| 0x50–0x52 | `sub_4815E0` | CMiniRoomBaseDlg（交易／小房間），switch 3／5／6／7／8 → vtable slot 15–18 |

#### 落掉的鉤子（本回合未做完，留給下一個回合）

- `0x1E`／`0x20`／`0x21`／`0x2A` 在 CUserPool 內是「讀 u32 查表後什麼都不做」；`0x26` 是 `nullsub`。
  這些很可能是**空實作或已停用**，但要先確認不是 Hex-Rays 掉的呼叫再下結論。
- `sub_5209C0`（0x23／0x24／0x25）內有 76-byte 的 buff／怪物查表迴圈，還沒讀欄位。

#### 4.12.1 `CMob::Init`（`sub_484ED0`）讀的前半段：怪物進場包 `0x2F` 的身體

`0x2F` 的分派本體 `sub_4924A0` 先讀 `u32 mobId`（`*(this + 30) = mobId` → 就是 **mob + 120**，
跟 `0x0F` 攻擊包裡的怪物 id 同一欄），池中沒有這個 id 時再讀 `u32 templateId`，
經 `sub_48CFA0`（模板查表）→ `sub_4848E0`（建物件）後進 `CMob::Init(this, mobId, packet)`。

`CMob::Init` 接著照這個順序讀（`sub_45DC40` = `u8`、`sub_45DC80` = `u16`，兩者都在長度不足時
丟 `ZException(38)`——與 `server/src/protocol/packet.ts` 的 `PacketReader` 同一個契約）：

| # | 寬度 | 寫入目標 | 語意 |
|---|---|---|---|
| 1 | `s16` | `mob + 368`、同時複製到 `mob + 360` | **x**（`sub_485AA0` 的命中框把它當位移加在矩形上，所以它就是怪物座標）|
| 2 | `s16` | `mob + 372`、同時複製到 `mob + 364` | **y** |
| 3 | `u8` | `mob + 272` | **面向**（`sub_485AA0` 用 `mob + 272 & 1` 在 `+292`／`+308` 兩個矩形之間選一個）|
| 4 | `u16` | 只拿去查表 | 以 `sub_489800(this_7 + 25, &值, &out)` 查一次（全域 ZMap，`n2 = 0`）|
| 5 | `u16` | 同上（`n2 = 1`）| 查到的 `+32` 欄位與 `*(template + 24)` 一起傳進 `sub_53D310`（音效／特效解析）；語意待續 |
| 6 | — | `mob + 136` | `sub_4C6CE0`：**動畫狀態區塊**（見下）|

`sub_4C6CE0(obj, packet, time)` 是共用的**動畫狀態解碼器**（只有兩個呼叫端，都在 CMob 的
`Init`／重生路徑：`sub_484ED0`、`sub_4885D0`）。它的完整形狀已經讀出來：

| 步驟 | 寬度 | 內容 |
|---|---|---|
| 旗標 | **`u32`** | `v8 = *(u32 *)&packet[pos]`（長度不足 4 → `ZException 38`）|
| 每個被設定的 bit | `u16` × 2 | `(動畫索引, 時間索引)`；第二個乘 100 加上 `timeGetTime()` 寫進「結束時間」 |

七個通道（bit `1`／`2`／`4`／`8`／`0x10`／`0x20`／`0x40`）分別寫進物件 `+10`、`+13`、`+16`、`+19`、
`+22`、`+25`、`+28`（每個通道 2 個 dword：索引與結束時間；bit `1` 是 `4 * (25 * idx)`、
bit `2` 是 `20 * (5 * idx)`，兩者都是 **100 ms 的倍數**，即「動畫延遲」）。沒設定的 bit 會把該通道歸零。
以 `CMob::Init` 傳進來的 `obj = mob + 136` 換算，索引欄落在 mob `+176`、`+188`、`+200`、`+212`、
`+224`、`+236`、`+248`。

所以 `0x2F` 在兩個 `u16` 之後是：**`u32 動畫旗標` ＋ 每個設定的 bit 各 2 個 `u16`**，
之後是 `CMob::Init` 尾端的本地初始化（`sub_4861F0`、`sub_485DA0`）——**封包到這裡結束**。
`0x2F` 唯一還沒命名的是第 4/5 欄那兩個 `u16`：它們只被拿去查 `this_7 + 25` 這個雜湊表
（`sub_489800` ＝ `ZMap`-style find：`__ROR4__(key,5) % size` 再走鏈），第二個查到的 `+32` 欄位
與 `*(template + 24)` 一起傳進 `sub_53D310`，值本身**不會**存進怪物（所以不是 foothold／座標這類狀態），
語意待續。

`CMob::Init` 尾端還有 `sub_4861F0(this)`、`sub_485DA0(this)`（＝建立怪物狀態／站上 foothold），
最後把 `mob + 116`（dword 29）設 `-1`、`+128`／`+132`／`+52`／`+280` 歸零。

### 4.13 🟡 client → server 遊戲內封包的語意（證據：`/` 指令表 + CP949 字串 + 與 CMob 同區的呼叫）

§4.5 的目錄只給號碼與 sender。這一節把其中幾個變成**有語意的封包**，方法是讀 `sub_470E10`
＝聊天輸入框的「`/` 開頭」分支（`sub_4F8CB0`：Enter、非空、第一個字元是 `/` 才走到它）：
它是一整張指令表，每一條指令就是「這個 opcode 該怎麼送」的現成範例。
2003 年的 client 沒有符號，指令字串＝函式唯一的名字，而 `.c` 是 CP949——
`grep` 只會看到亂碼，用本回合新增的 `tools/kstr.py` 讀：

```bash
python3 tools/kstr.py MapleStory.exe.c sub_470E10
# /헉맵 /헉위치 [현재위치] Map : %09d  X : %d  Y : %d /헉추적 /헉경고 /헉공지 /헉창조 /헉소멸 /헉경험치
# /귓속말 /찾기 /교환 /파티정보 /파티만들기 /파티탈퇴 /파티초대 /파티강퇴
```

| opcode | 指令 | sender | 已讀出的欄位 |
|---|---|---|---|
| `0x0D` | `/헉맵 <mapId>`（`atoi`）| `sub_472590(kind, name)` | `s32 kind` + `string name`；**name 為 null 時寫空字串**（`sub_430230` 收到 nullptr 會用全域空字串），所以 0x0D 永遠是「s32 + 字串」；節流 500 ms（`n3000[6]/[7]`，`0x19` 解除）|
| `0x12` | 一般聊天（非 `/`、且沒有密語對象）| `sub_470C70` | `string`（`sub_430230`）|
| `0x22` | `/헉공지 <msg>`／`/헉경고 <msg>` | `sub_470E10` 內嵌 | `u8 0`（公告）／`u8 1`（警告）+ `string` |
| `0x23` | `/귓속말 <name> <msg>`、`/헉추적 <name>` | `sub_4717D0` | 兩個 `string`；sender 自己會擋「다른 요청을 처리 중입니다」（一次只允許一個請求）|
| `0x25` | `/교환 <name>` | `sub_471A40` | 未讀（交易與找人的 sender 是同一個）|
| `0x26` | `/파티만들기`、`/파티탈퇴`、`/파티초대 <name>`、`/파티강퇴 <name>` | `sub_471CD0`／`sub_471E90`／`sub_472050`／`sub_4722E0`，以及 `sub_55C5E0`（§4.10 `0x10` type 3 按「是」）| 各自的 sub-code；§4.10 已證實「邀請回覆」＝`u8 2` + `u32 邀請者 id` |
| `0x27` | `/헉창조 <id>`／`/헉소멸 <n>`／`/헉경험치 <n>` | `sub_470E10` 內嵌 | `u8 0` + `u32`；`u8 1` + `u8`；`u8 2` + `u32` |
| `0x16` | 商店購買 | `sub_4B6B40` | 未讀；字串「정말로 사시겠습니까?」「몇 개를 사시겠습니까?」「현금이 부족합니다」|
| `0x20` | 找人 | `sub_55D7B0` | 未讀；字串「캐릭터를 찾을 수 없습니다」「잠시 후 다시 시도해 보세요」|
| `0x14` | 社群選單（개인정보／인기도 +／인기도 -／귓속말／교환신청／파티초대）| `sub_512570` | 未讀；送出前用 `sub_51D7D0(CUserPool, name)` 找玩家 |
| `0x24` | messenger（쪽지）| `sub_4DDFE0`／`sub_4DE280`／`sub_4DE490`／`sub_4DEAF0`（CUIMessenger）| 未讀 |

`/헉*`（GM）系列全被 `if ((*(CWvsApp+9) & 1) != 0)` 包住——那就是 §4.8 `0x01` 回包的 `app9`；
玩家指令（`/귓속말`、`/찾기`、`/교환`、`/파티*`）在這層之外。

#### 4.13.1 `0x0F` 普通攻擊：**已完整解出（byte-exact）**

`sub_512F90`（751 行）是近戰普通攻擊。它跟前兩個 sender 最大差別是：**傷害是 client 自己算的**——
送包前 client 已經把每個目標的傷害算好、寫進自己的記錄陣列、套用到怪物身上（`sub_4882F0`），
再照實回報。所以 2003 年的伺服器只能照收（現代伺服器要重算後比對，這是通膨防線的第一道）。

##### 送包容器的組裝順序（＝線上順序，`ZArray` append＋`sub_43AD50` 送出）

`sub_4A1EA0(&v111, 15, nullptr)` 先開好 `opcode = 0x0F` 的包，接著對 `count_1` 這個 `ZArray`
依序 append（每次 append 前都有 `if (v113 + n > size) sub_433B50(...)` 的擴容，`v113` 是已寫入長度）：

| # | 寬度 | 寫入的運算式 | 解出的語意 |
|---|---|---|---|
| 1 | `u8` | `LOBYTE(rcSrc1.top) \| (16 * i_1)` | 低 4 bits = **每隻怪的傷害段數**（`*(right[18] + 120*n30 - 40)`，夾在 1..15）；高 4 bits = **目標數** `i_1`（`sub_491E90` 例項查詢的結果，上限 6）|
| 2 | `u32` | `*right`（`right == nullptr` 時 0）| **滑鼠游標下的物件 id**：`sub_4BDD20(dword_5C2038, x, y, &right)` 從場地物件清單查到的那一個（`right[0]` 是 id、`right[3]` 是種類）|
| 3 | `u8` | `v70 = (LOBYTE(rcSrc1.left) << 7) \| (n5 & 0x7F)` | **bit 7 = 面向左**（`*(this + 45) & 1`，同一 bit 也把揮擊矩形鏡射）；低 7 bits = **動作 id** `n5 = sub_427F60(*(this + 37), right)` |
| 4 | `u8` | `rcSrc1.bottom` | `sub_4BE8B0(*(this + 38), targetId, app[86] ^ app[87])` 的結果，**夾在 0..6** ＝「這一擊還能再打幾隻」（目標上限；`targetId == 4001334` 時少 1）|
| 5.. | per target | 見下表 | 每隻被判定命中的怪一段記錄 |

每隻目標的記錄（**固定 11 bytes ＋ `段數 × 2 bytes`**）：

| # | 寬度 | 寫入的運算式 | 解出的語意 |
|---|---|---|---|
| a | `u32` | `*(_DWORD *)(*(_DWORD *)v75 + 120)` | **怪物物件 id**（`mob + 120`，與 server → client 封包同一欄）|
| b | `u8`（`_BYTE`）| `v80 = v75[4]` | 記錄 `+4` 的**低位 byte**＝**受擊動畫**（`*(*(mob + 124) + 112) <= 0` → `-1`，否則 `rand() % 該值 + 7`）；以 `s8` 解讀 |
| c | `u16`（`_WORD`）| `*(_WORD *)(mob + 360)` | 怪物 **x**（記憶體中是 `int`，線上取低 16 bits）|
| d | `u16` | `*(_WORD *)(mob + 364)` | 怪物 **y** |
| e | `u16` | `v123 = *(this + 49) - *(this + 50)[last]` | 一擊一值的**序號／計數差值**，同包所有目標相同；也餵進本地命中處理與送包後的 `sub_515790(this, …, v123 + last/3)`。語意未定 → 保留欄位，不猜 |
| f | `u16 × 段數` | `v91 = (__int16 *)(v75 + 8); v91 += 2` | **傷害值**：記錄 `+8, +12, +16 …`（`int`，步幅 4）各取低 16 bits |

> 記錄本身（本機用，不上線）是 **76 bytes / 隻**，`memset(buf, 0, 0x4C)`，`buf += 19`（`_DWORD*`）：
> `+0` 物件指標、`+4` 受擊動畫、`+8..+67` 最多 15 個 `int` 傷害（4 + 4 + 15×4 + 8 = **76** 剛好塞滿）、
> `+68`/`+72` x/y（由 `sub_485B80(mob, &v125[4], rc)` 寫入，送包時在第 a/b 欄之後被讀出）。

##### 目標是怎麼挑的（空間查詢，不是清單）

- 揮擊矩形 `rc`：以 `sub_50DAA0`／`sub_407780` 展開，面向左時 `SetRect(&rc, -right, top, -left, bottom)` 鏡射，
  再 `OffsetRect(&rc, *(this + 100), *(this + 101))` 平移到角色位置。
- `sub_491E90(dword_5C2054, &rc, p_left, n6)`：走 **CMobPool** 的場地物件鏈（`+10`、`next = *(node - 12) + 16`），
  對每隻怪算命中框 `sub_485AA0(mob, &tmp, 1)` 後 `IntersectRect`，命中的寫進 `p_left`，回傳數量。
  先用 `n6 = 1` 探測（游標下的那一隻），命中則 `n6 = 6` 做完整查詢（最多 6 隻）。
- `sub_485AA0` 就是怪物命中框：`+292`／`+308` 兩個矩形由 `+272` 的 bit 0（面向）選一個，
  `OffsetRect(&rc, *(mob + 360), *(mob + 364))` 移到怪物位置；`a3 != 0` 時再多聯集一個
  `+(+368, +372)` 偏移的框（＝武器框）。這解釋了為什麼封包裡的 c/d 欄是怪的座標。
- 動作 id：`sub_427F60(attackKey 1..7, right)`——`right[3] == 3` 時 `v3 = 2*n5 - 1`，否則 `2*n5 - 2`；
  再從 `dword_5B2144[6*v3]` 取**這一式有幾個動作**，`dword_5B2144[6*v3 + 1 + rand() % n]` 取一個
  → **`dword_5B2144` 是一張「攻擊動作 id」靜態表**（`{count, id…}` 每組 6 個 `int`）。
- 收尾 `sub_508690(this, n5, rcSrc1.bottom)`（＝送出一次攻擊狀態）、`sub_5095A0`／`sub_50D7F0`
  （以 `n5` 與當前武器動作 `sub_513C60/70` 產生本地特效），最後 `sub_43AD50(this_13, &v111)` 送出。

##### 記錄陣列的排序（送包**之前**，決定誰先寫進封包）

`rcSrc1.right = (rcSrc1.left == 0)` 先存下「面向右」這個布林，接著是泡沫排序：比較
`*(_DWORD *)v42`（前一筆的 `+68`）與 `src[17]`（本筆的 `+68`，即 x），
**面向右時用 `<=`、面向左時用 `<`** → 兩邊都是把 x 由小到大排（左面時等值不交換），
即「由左而右」的穩定順序。目標順序因此與 `p_left` 的列舉順序無關，是可重現的。

> 所以 `0x0F` 的三個 sender 關係是：`0x0F` 近戰（已解）、`0x10`／`0x11` 同形狀（魔法／技能），
> 差別只在「段數／目標數的打包方式」與是否多帶 `u32 targetId`（§4.5）。家族入口仍是 `sub_511E20`（opcode `0x13`）。


##### 4.13.1b `0x10`／`0x11`：同一家族、同一種目標記錄（本回合讀完）

三支 sender 的尾端寫入順序逐一比對後，**表頭順序與目標記錄完全相同**，只有兩處差異：

| | `0x0F` `sub_512F90` | `0x10` `sub_513C80` | `0x11` `sub_514D30` |
|---|---|---|---|
| byte 1 | `u8 段數 \| 目標數<<4`（`i_1` ≤ 6）| `u8 段數 \| (16 * (v129 != nullptr))` | `u8 段數 \| (16 * (v95 != nullptr))` |
| byte 2..5 | `u32 *right` | `u32 *right` | `u32 *a2` |
| byte 6 | `u8 面向<<7 \| 動作` | `u8 (left<<7) \| (n5 & 0x7F)` | `u8 (left<<7) \| (n8 & 0x7F)` |
| byte 7（表頭最後一個）| `u8 目標上限`（`sub_4BE8B0`）| `u8 n6` | `u8 n6`（`v49[v93++] = n6`）|
| 目標記錄之前 | — | 多一個 `u16 v138` | — |
| 目標記錄 | `u32 mobId, u8 動畫, u16 x, u16 y, u16 序號, u16 × 段數` | 同左（`if (v55 != nullptr)` 內）| 同左（`if (v36 != nullptr)` 內）|
| 送出 | `sub_43AD50` | `sub_43AD50` | `sub_43AD50` |

- 座標欄仍然是 `*(_WORD *)(mob + 360)`／`*(_WORD *)(mob + 364)`（`v55 + 180`／`v55 + 182` 是同一個位置，
  以 `_WORD *` 索引），所以 §4.13.1 的 x／y 命名對三支都成立。
- **所以「目標數」這個 nibble 對 `0x10`／`0x11` 其實是「有沒有第二個物件」的旗標**（只會是 0 或 1），
  而 `0x0F` 才是真的計數——server 端要按 opcode 分別解讀，不能一套套到底。
- `server/src/protocol/field.ts` 因此寫成**一個** `readClientAttack(reader, opcode)`／
  `encodeClientAttack(attack, opcode)`，差異用 `ATTACK_SHAPE` 一張表描述（`0x10` 多讀一個 `u16`），
  三個 opcode 共用同一段程式碼；`test/field.test.ts` 各有一組 golden bytes。
- 尚未有真實流量驗證（§6 第 2 項）：`0x10` 的 `u16 v138` 與 `0x10`／`0x11` 的 nibble 只有 0/1 這點，
  都應該在第一次 `capture` 到的攻擊包上核對。

#### 4.13.2 §4.5 那 39 個 opcode 的完整 sender 目錄

抽取方式：`grep -n "sub_4A1EA0("` 後取第二個參數（＝要送的 opcode），再用「往上找最近的函式標頭」
決定 sender。**這張表是為了不必再跑一次抽取**（同一 opcode 可能有多個 sender）。

| opcode | sender（`@`＝程式碼行號，方便回頭查）|
|---|---|
| `0x01` | `sub_4D0B20` ｜ `0x02` `sub_54DFC0` ｜ `0x03`／`0x06`／`0x07` `sub_431620` ｜ `0x04` `sub_43A410` |
| `0x05` | `sub_42FD30` ｜ `0x08` `sub_43B280` ｜ `0x09`／`0x0A` `sub_5545A0`（舊文件寫 `sub_5545F0`，已更正）|
| `0x0D` | `sub_472590` ｜ `0x0E` `sub_542C40` ｜ `0x0F` `sub_512F90` ｜ `0x10` `sub_513C80` ｜ `0x11` `sub_514D30` |
| `0x12` | `sub_470C70` ｜ `0x13` `sub_511E20` ｜ `0x14` `sub_512570` |
| `0x15` | `sub_4A5A80`／`sub_4A5D00`／`sub_4A5F40`／`sub_4A6320`／`sub_4A65C0`（CQuestMan）|
| `0x16` | `sub_4B3C80`／`sub_4B6B40`／`sub_4B6E90`／`sub_4B7130`（對話框／商店）|
| `0x17`–`0x1A` | `sub_55ACB0`／`sub_55B2C0`／`sub_55B4B0`／`sub_55B0E0`（CWvsApp 層；`sub_55B0E0` 的簽章是兩個 `s16`）|
| `0x1B`–`0x20` | `sub_55CF60`／`sub_55B870`／`sub_55D140`／`sub_55D320`／`sub_55D5F0`／`sub_55D7B0`（CWvsApp 層）|
| `0x22`／`0x27` | `sub_470E10`（0x27 出現 3 次）｜ `0x23` `sub_4717D0`／`sub_472910` ｜ `0x25` `sub_471A40`／`sub_481910`／`sub_4820E0`／`sub_4D31F0`／`sub_4D5C80` |
| `0x24` | `sub_4DDFE0`／`sub_4DE280`／`sub_4DE490`／`sub_4DEAF0`×2 ｜ `0x26` `sub_471CD0`／`sub_471E90`／`sub_472050`／`sub_4722E0`／`sub_55C5E0` |
| `0x2C` | `sub_4885D0` ｜ `0x2F` `sub_49A3C0` ｜ `0x33` `sub_55AF20`（`sub_55AF20` 帶一個 `u32`，且有 `this+6/+7` 的一次性節流）|

### 4.14 ✅ 協定目錄：`server/src/protocol/schema.ts`（可查詢的單一來源）

§4.1–§4.13 的知識散在三個 module 的註解與本文件裡，要回答「這個封包我們到底解到什麼程度」
本來得同時讀三支檔案。`schema.ts` 把這些收成一張**機器可讀的目錄**，而且**不重複定義任何數字**：
`opcode` 一律引用 `login.CLIENT_OPCODE`／`replies.LOGIN_OPCODE`／`field.FIELD_OPCODE`／
`field.CLIENT_FIELD_OPCODE`。

每一列有：`direction`／`stage`／`name`／`status`／`evidence`／`codecs`／`fields`，
其中 `status` 只有三種值：

| status | 意思 |
|---|---|
| `byte-exact` | codec 與 client 自己的讀／寫逐欄一致，且 `test/` 有 golden bytes |
| `partial` | 列出的欄位有證據，但後面還有尚未定位的東西 |
| `skeleton` | 只知道 opcode 與 handler；**`fields` 必須是空的**（不准發明欄位）|

反漂移由 `test/schema.test.ts` 保證（6 個測試）：

- 每個 `codecs` 名稱都必須在 `src/protocol/**` 找到真的 export（`resolveCodec`），改名不會漏掉目錄；
- 同一個 `(direction, stage, opcode)` 只能有一列（`0x05`／`0x22` 這種**兩個方向都用到**是合法的，
  測試特別釘住這兩對）；
- `skeleton` 列的 `fields` 必須是空的；
- 有 codec 的列必須真的被 `decode` 的解讀器認得（`describeClientFieldPacket`／`describeFieldPacket`／
  `describeClientPacket` 不能回 `undefined`）。

查詢方式：`node server/src/cli.ts schema`（人看的表格）或 `schema --json`（工具用）。
目前共 **31 列**：login c2s 8、login s2c 6、field c2s 11、field s2c 6。

## 5. 字元編碼

- 遊戲內字串（WZ）用 **ASCII / UTF-16LE + 位置遮罩**（見 `docs/WZ1_FORMAT.md` §3）。
- 網路訊息（封包）中的字串編碼**已解**：`u16 長度` + 原始 bytes，見 §4.4。
  ⚠️ 注意與 WZ 檔內的字串編碼（位置遮罩）**完全不同**，不要混用。

## 6. 待辦（依重要性）

1. **211-byte 握手的 `body`（199 bytes）**：長度規則已知（§2），內容語意仍未知；最快的解法是用
   `capture --handshake-body <hex>` 餵不同內容觀察原 client 的反應（同一支 client 對不同 body
   的反應就是唯一的量測工具）。
2. **實機驗證 §4.11 的三個 UNKNOWN**（有真實流量就能一次解決）：
   `0x16` 的 `mode`（三個 u32 已解＝場地亂數種子，地圖 id 已解＝`CharacterData.mapId`，§4.11.2／
   §4.11.2b）；`0x1C` 的 `unknown64`／`avatarKey`／`unknownA/B`；`0x0D` 的 `kind` 其他取值。
3. **攻擊家族已全部解出**（`0x0F`／`0x10`／`0x11`，§4.13.1＋§4.13.1b），三支共用一個 codec。
   還缺的是**真實流量驗證**（§6 第 2 項）與 `0x10` 的 `u16 v138`。
   另一邊 `CMob::Init`（§4.12.1）已解到 x／y／面向＋動畫區塊；補完它就與攻擊包合起來是完整的打怪迴圈。
4. **CField 其餘區間**（分派已拆到函式，見 §4.12）：`0x1A` 的 sub-opcode 表（目前只有 9／10／18／34）、
   CUserPool 的 `0x1E–0x29` 分支、`0x2F`–`0x36` 的欄位（怪物進場 `CMob::Init`、移動、受傷／死亡）、
   `0x39`–`0x40`（CNpcPool）、`0x42–0x45`（CRewardPool：掉落物）、`0x49–0x4C`（對話框／商店）、
   `0x4D–0x52`（messenger／miniroom）。怪物進場（`sub_484ED0`）與第 3 項是同一條迴圈的兩半。
5. **進地圖之後還缺的東西**：伺服器已能送 `0x16`（§4.11.2b），但接下來 client 會回報移動（`0x0E`）
   並期待怪物（`0x2F`）。要讓畫面真的動起來，需要 `0x2F` 剩下那兩個只被查表的 `u16`（§4.12.1）
   與 `CMob::Init` 尾端的 foothold 綁定（`sub_485DA0`）；在那之前伺服器只送 `0x16`，不編造怪物。
6. **`0x12`／`0x11` 的少數分支**：`0x11` 的 type ≠ 0/1 分支、`0x12` 的 type 4 之後，
   以及 `0x0F` 的 `sub_4C5DC0` 到底讀了哪些欄位（能力面板的第二種更新格式）。
7. **握手方向的實機確認**：`serve` 目前一定送 211-byte 握手（§2 的契約），但「原 client 是否
   在某些情況下先送」還沒有實機證據；有真實流量就能一次確認。
8. ~~由 §4.1／§4.5／§4.7–§4.13 的對照表產生 `protocol/schema/`~~ → 已做成
   `server/src/protocol/schema.ts`（§4.14，`cli.ts schema`，6 個反漂移測試）。
   剩下的只有**用 `capture` 對照真實流量**（與第 2 項同一件事）。
9. ~~`unknown97`~~ → **已證實是 `mapId`**（§4.11.2b：`sub_468E00` 用它載入 `Map/Map/%09d.img`）。
   剩下的：**`unknown18`／`unknown1A`**（`GW_ItemSlot` 現金區塊）與 `unknown26`／`unknown93`／`unknown101`
   （能力值區塊），傳輸上已完整，語意待找讀取端。
10. **組隊的 102-byte 角色區塊**（§4.10 `0x10` type 13）與 §4.11.3 的進場紀錄是不是同一種
   格式：兩者都帶角色資料但長度不同，值得並排比一次。

## 7. 擷取工作流（ADR-004）

> ✅ 除了被動擷取，現在也可以**主動走完登入鏈**：
> `node server/src/cli.ts serve --port 8484 --game-port 8485 --account admin:admin`
> （實作 §4.8；原 client 導向該 port 即可走到選角畫面。遊戲內階段尚未實作，因此進地圖後會停在
> `GameEntryServer` 的角色記錄上。）

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

## 8. 工具

| 工具 | 用途 |
|---|---|
| `tools/hexfunc.py <dump.c> <name> [--list\|--calls\|--globals]` | 從反編譯輸出抽出單一函式（或其呼叫／全域引用），是這一整份文件的證據來源 |
| `tools/kstr.py <dump.c> <function> [--list\|--names]` | 把函式引用的字串以 **CP949** 解出來。`.c` 直接 `grep` 會看到亂碼，而 2003 年的 client 只有這些字串能替函式命名（§4.13）|
| `server/src/protocol/random.ts` | 客戶端自訂亂數產生器的逐位元移植（種子遮罩 `sub_48A900`／步進 `sub_4619F0`）；golden 序列在 `server/test/random.test.ts`，伺服器用它重算客戶端回報的傷害（§4.11.2）|
| `tools/wzimg.py` | `.img` 值層編解碼器：物件語法、名稱表、15 種型別、`Canvas`／`UOL`／`Shape2D#*` body、zlib 像素解碼。全檔 1,052 張 image 逐 byte 驗證（規格見 `docs/WZ1_FORMAT.md` §4） |
| `tools/wzdata.py <Data.wz> [--census\|--manifest STEM\|--maps OUT\|--dump PATH]` | 讀 `Data.wz` 的**唯一支援入口**：解析樹、驗證／掃描定位每張 image、統計 canvas 與像素、輸出 manifest／地圖 metadata／單張屬性樹 |
| `server/src/wz/paths.ts` | 客戶端自己的 WZ 路徑（`Map/Map/%09d.img` ＝ `mapImagePath`、`foothold`／`ladderRope`／`portal`、`MapHelper.img`）；地圖載入器的函式表在 §4.11.2b，golden 測試在 `server/test/paths.test.ts` |
