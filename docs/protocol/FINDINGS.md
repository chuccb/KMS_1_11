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
- `op = 0`：接一個 `GW_ItemSlot`（`sub_45E6A0`），叫該物件的 `Decode`（vtable slot 1）讀欄位——
  **欄位已全部解出，見 §4.9**。⚠️ **修正（見 §4.18.2）**：這裡的第三個參數是**剛剛讀到的
  `inventory` 值本身**（`pExceptionObject_1 = (char)n570425348`，`.c` 352412 附近的 case 0），
  不是 0；而 `sub_45E6A0` **只在參數為 0 時才從 stream 讀一個種類位元組**（`.c` 102334：
  `if (pExceptionObject == 0) { … LOBYTE(pExceptionObject) = *(_BYTE *)(…) … }`）。所以
  `0x0B` op 0 **沒有**種類位元組：種類由欄位本身決定（`inventory 1` → 旗標 1 → `GW_ItemSlotEquip`，
  2/3/4 → `NonEquip`）。原本「這裡會讀種類位元組」的推論來自把 `sub_45E6A0` 的 0 分支當成了
  這裡的呼叫；全 `.c` 只有 `sub_4D3950`（本伺服器尚未送出的子系統）是以 0 呼叫它。
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
| `0x0B` | `sub_55BAB0` | 道具欄操作（**已解到欄位層，見 §4.6 與 §4.18.2**）| `u8 result, u8 count, count × {u8 op, u8 inv, s16 slot, …}` |
| `0x0C` | `sub_55BDC0` | **道具欄格數變更** | `u8 inventory(1..4), u8 slots` → `sub_55E7C0(charData + 4*inv + 362, slots + 1, …)`（對 `sub_4605A0` 的包裝）|
| `0x0D` | `sub_55BEB0` | **能力值差異更新**（升級／配點／HP 變化）**已完整解出 → §4.21** | `u8 ack`（非 0 → `CWvsApp+0x18/0x1C` 重設）、`u32 flags` + 差異欄位（`sub_45E0D0`，19 個 bit）、`u32 panelFlags`（0 = 後面沒有東西）；等級變大時顯示 "레벨이 올랐습니다 (+%d)" |
| `0x0E` | `sub_55B6A0` | **`charData+382` 的 `ZMap<u32,u32>` 更新** | `u8 flag`（同上重設）、`u16 n`、`n × {u32 key, s32 value}`：`value > 0` → insert，`value <= 0` → 移除該 key（`sub_460630`）|
| `0x0F` | `sub_55C090` | **能力面板更新** | 無條件重設 `CWvsApp+0x18/0x1C`；`u8 flag`；若 flag ≠ 0 再讀 `u8 mode`，`mode == 0` → `sub_4C5DC0(CWvsApp+0x70, packet, …, 0)` |
| `0x10` | `sub_55C5E0` | **組隊（파티）系統**：見下表 | `u8 type` + 依 type 的 payload |
| `0x11` | `sub_55C130` | **獲得提示**（**已解，見 §4.18.3**）| `u8 type`：`1` → `u32` → "메소를 획득했습니다 (+%d)"；`0` → `u32 itemId`(`sub_479D30` 查名)`+ u32 count` → "아이템을 획득했습니다 (%s)"（count ≤ 1 時不印數量）；**其他值 → 2 bytes 的 "아이템을 더 이상 가질 수 없습니다"** |
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

> 註：`0x0D` 讀的那組「差異欄位」是 `sub_45E0D0`（**已完整解出 → §4.21**）：先 `u32 flags`，
> 再依 bit 由 `0x01` 往上讀，只送有變的欄位。⚠️ 它的**線上的寬度不等於 `CharacterData`
> 的寬度**（`str`/`dex`/`int`/`luk` 是 1 byte、`unknown26` 與 `fame` 是 4 bytes），§4.21.1 有完整對照表。

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

### 4.12 🟡 CMobPool／CNpcPool／CRewardPool：分派已拆到函式（`0x2F` → §4.15、NPC `0x39`–`0x3B` → §4.19）

§4.11 把「哪個子系統」解到欄位層；這一節把同一條路線再往下一層拆成「哪個函式處理哪個 opcode」。
**未標「已證實」的欄位都還不能當規格用**（這一節的目的是讓下一個回合不必重讀反編譯）。

#### CMobPool（`sub_492330(dword_5C2054, opcode, packet)`）

| opcode | 分支 | 目前已知（讀取順序）|
|---|---|---|
| 0x2E | — | 沒有分支 |
| 0x2F | `sub_4924A0` | **怪物進場（✅ 已實作，§4.15）**：`u32 mobId`；池中已有 → `[mob+112] = 1` 後返回；沒有 → `u32 templateId`（`sub_48CFA0`→`sub_4848E0` 載模板）→ 建池項 → `sub_484ED0(newMob, mobId, packet)` = `CMob::Init` 讀剩下的欄位（下一段）|
| 0x30 | `sub_4926B0` | `u32 mobId` + `s16 delayMs`：`>= 0` → 塞進池的定時佇列（`sub_492100` 到期時回首），`< 0` → 立刻移除（§4.16.3）|
| 0x31 | `sub_4927B0` | `u8 flag` + `u32 mobId`（**不是移動，也沒有 `CMovePath`；移動是 0x33，見 §4.16.1**）；`flag != 0` → `sub_491630`：查到怪 → 有指標在跑就什麼都不做、否則 `sub_485330(mob, 1)` 推進一步；查不到 → `u32 templateId` + `CMob::Init` 建立；`flag == 0` → `sub_491830`（移除，`mob+112` 非 0 時放棄）|
| 0x32–0x36 | `sub_492380` | `u32 mobId` 查表，然後 **0x33→`sub_488BC0`（移動，✅ 已實作 §4.16）**、0x34→`sub_488D90`（`u16`→`mob+132`）、0x35→`sub_488E10`（動畫區塊 `sub_4C6CE0`）（0x32／0x36 沒有分支）|
| 0x37 | — | 沒有分支 |

> 移動本身**就是 §4.11.5 的 `CMovePath`**：`sub_485330` 是「取移動路徑的下一個元素並移動 vecctrl」，
> 和玩家的 `sub_499760`（`CVecCtrlUser`）是同一組程式碼。`sub_491830`／`sub_485520` 是「有沒有下一個元素」。

#### CNpcPool（`sub_49F560(dword_5C2050, opcode, packet)`）

| opcode | 分支 | 目前已知 |
|---|---|---|
| 0x38／0x41 | — | 沒有分支（`0x38` 到現在仍無法解釋）|
| 0x39 | `sub_49F6C0` | **NPC 進場 ✅ 已實作 → §4.19**：`u32 npcId`；池中已有 → `+24 \|= 1` 後返回；沒有才讀 `u32 templateId`（`sub_49CB30` 快取模板 → `sub_498A20` 建物件）並進 `sub_498CF0` 讀剩下的欄位 |
| 0x3A | `sub_49F810` | **NPC 離場 ✅ → §4.19**：`u32 npcId`；清 `+24` 的 bit 0，歸零才解除鏈結 |
| 0x3B | `sub_49F970` | **NPC 第二狀態 ✅ → §4.19**：`u8 flag` + `u32 npcId`（**順序是 flag 在前**）；`flag != 0` → `sub_49F260(npcId, packet)`、`flag == 0` → `sub_49F380(npcId)`（**與怪物 0x31 同型**）|
| 0x3C–0x40 | `sub_49F5B0` | `sub_49F610` 查表後**只有 0x3D** 才呼叫 `sub_49A280(opcode, packet)`；`0x3C`／`0x3E`／`0x3F`／`0x40` 讀完 `u32 npcId` 就結束 |

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
| `0x2C` | `sub_4885D0`（**已解，見 §4.20**：怪物的動作回報，`u32 mobId`＋旗標＋動作位元組＋位置＋尾段）｜ `0x2F` `sub_49A3C0` ｜ `0x33` `sub_55AF20`（`sub_55AF20` 帶一個 `u32`，且有 `this+6/+7` 的一次性節流；唯一呼叫點 177038 是滑鼠點擊物件的處理）|

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
目前共 **49 列**：login c2s 8、login s2c 6、field c2s 12、field s2c 23；狀態分佈`byte-exact` **26**／`partial` **19**／`skeleton` 4（§4.17 把 `0x30`／`0x31`／`0x34` 從 `partial` 推到 byte-exact，§4.19／§4.20／§4.21 再把 NPC、`0x35`、`0x0D` 補上）。

### 4.15 ✅ 怪物進場到產品：地圖 `life` → `0x2F`

§4.12.1 只給欄位表；這一節記的是**把它做成產品的那一步**，以及驗證它、以及還不能宣稱的部分。
實作：`server/src/game/map.ts`（地圖視圖）＋`server/src/protocol/mob.ts`（codec）＋
`GameEntryServer.spawnMobs`（送包時機）。

#### 出生點來自地圖檔自己：`life`

`0x16` 讓 client 自己載入 `Map/Map/%09d.img`（§4.11.2b），伺服器讀**同一張** image 的 `life`
（`sub_469980` 讀的五個節點之一）——所以兩邊看到的怪物必然一致，沒有第二份資料要同步：

| 欄位 | 型別 | 內容 |
|---|---|---|
| `type` | string | `"m"` = 怪物、`"n"` = NPC |
| `id` | 7 位數字**字串** | 模板 id：`"0120100"` → `120100` = `Mob/0120100.img`（`sub_48CFA0` 查的就是它）|
| `x`／`y` | u16 | 出生座標（`0x2F` 的 `s16 x,y`）|
| `fh` | u16 | 腳踏點索引；`sub_485DA0` 之後用它把怪物綁到 foothold，伺服器目前只帶著 |
| `f` | u8 | 地圖自己的翻轉位元（**只有部分地圖有**），直接當 `0x2F` 的 `facing`；沒有就 0 = 面向右 |
| `cy`／`rx0`／`rx1`／`info` | — | 巡邏範圍，AI 之後才要 |

100 張地圖共 2,322 筆 `life`：**2,256 隻怪物、66 個 NPC**，61 張地圖有怪物。實際數字
（`server/test/map.test.ts` 釘住）：

| 地圖 | 名稱 | 怪物 | NPC |
|---|---|---|---|
| `1000000`（`DEFAULT_MAP_ID`）| 암허스트서쪽필드 | **45**（第一隻是 `120100`）| 0 |
| `100000000` | 헤네시스 | 0 | 2（Heena `1012000`、Roger `1010100`）|
| `40000` | 달팽이사냥터 | 63（`100100` 蝸牛）| 1（`2003`）|

#### 送出的內容與時機

`GameEntryServer` 領到 `0x04` 的角色 id → 送 `0x16`（§4.11.2b）→ **緊接著每一筆 `type == "m"`
送一個 `0x2F`**，欄位照 §4.12.1（`mobId`、`templateId`、`x`、`y`、`facing`）。

- `mobId` 由伺服器從 1 開始配：client 只用它在 `CMobPool` 查表（`sub_492C00`），
  池裡沒有這個 id 才會去讀 `templateId`；玩家在 `CUserPool`、怪物在 `CMobPool`，
  目前找不到兩者會撞 id 的路徑——但這條也還沒實機驗證。
- 兩個語意未解的 `u16` 送 **0**：`sub_489800` 查表失敗時 client 自己會替代一筆零記錄
  （§4.12.1），所以 0 是合法包，不是猜值。
- 動畫旗標送 **0**：不代表任何通道（`sub_4C6CE0` 對沒設定的 bit 就是把通道歸零）。
- NPC（`type == "n"`）**不送**：`0x39`（`sub_49F6C0`）尚未解到欄位層。
- 時機假設：`0x2F` 與 `0x16` 在同一個 TCP 流、且緊接在後。`0x16` 的處理器是**同步**載入地圖檔
  （`sub_4C2780` → `sub_4694F0`），所以 client 應該在讀下一個封包前就把場地建好；
  但這是推論，**只有原 client 能證實**（§6 第 2 項／ADR-004）。

#### 已被測試釘住的行為

| 測試 | 內容 |
|---|---|
| `server/test/mob.test.ts` | 逐 byte 的欄位順序（不是只有 round-trip）、`i` 號通道 ⇔ 旗標 bit `1 << i`、未設定的通道在讀回來時仍是洞、bit 7 以上被丟掉（client 沒有那些通道）、`unknownA/B` 與旗標預設 0、**任何長度的截斷都會丟 `PacketUnderflowError`**、`describeFieldPacket` 認得 `0x2F` |
| `server/test/map.test.ts` | `life` → 出生點（`"0120100"` → `120100`、沒有 `id` 的紀錄被丟掉、`f` 缺席時預設 0）、`portal` 保留 `tm`/`tn`、`DEFAULT_MAP_ID` 真的有怪且座標放得進 `s16`、헤네시스 0 怪 2 NPC、달팽이사냥터 63 怪、未知地圖回 `undefined`（不是空 map）、`mapDataProvider` 只讀一次 |
| `server/test/serve.test.ts` | 真 socket：`0x16` 之後逐隻 `0x2F`、id 由 1 遞增、負座標與面向位元活著回來、每個包的標頭都通過驗證、地圖不在地圖檔裡時**不送任何怪物**（而不是送一隻在 (0,0)） |

#### 還不能宣稱的部分

1. 兩個只被查表的 `u16` 語意未解（§4.12.1）——目前送 0 走的是 client 會處理的失敗路徑。
2. 受傷／死亡（`0x30`／`0x31`／`0x34`–`0x36`）未實作：**怪物不會被打死**（但會走動，
   見 §4.16）。離場的欄位已解到形狀，只是還沒有東西會殺死怪物。
3. 沒有 AI（不追人、不攻擊玩家）、沒有重生。`fh` 綁定是 client 的 `sub_485DA0`，
   伺服器這邊用腳踏點折線決定「站哪裡、走哪裡」（§4.16.4）。
4. 送的時機與 id 的無碰撞都還是推論，待原 client 實測（`serve --game-port --data Data.wz`）。
5. **每個連線各自一份怪物**：還沒有共享世界（ADR-001 的 Phase 2），所以兩個玩家在同一張地圖上
   會各看到一份怪物、彼此的 id 也不一致。要變成「一個世界」需要**以場地為單位的註冊表**（擁有 id
   與血量），這是下一階段的伺服器工作，不是這個 codec 的事。

### 4.16 ✅ 怪物移動（`0x33`）與腳踏點：地圖的幾何就是怪物走路的地方

§4.15 把怪物放到畫面上了，這一節讓它們**動起來**，並且把「怪物站在什麼上面」變成規格。
兩個關鍵發現：**0x31 不是移動**（舊註記錯了，見 §4.12 的更正），移動是 **`0x33`**；
而**腳踏點的 item key 就是 `life.fh`**——這一條用全部 100 張地圖驗證過。

#### 4.16.1 `0x33` = 怪物移動（`sub_492380` → `sub_488BC0`）

`sub_492330`（CMobPool 分派，§4.12）把 `case '3'` 交給 `sub_492380`：先讀 `u32 mobId` 查池
（`sub_492400`），再呼叫 `sub_488BC0(mob, packet)`。`sub_488BC0` 的完整順序**逐指令核對過**
（`MapleStory.exe.lst` 的 `.text:00488BC0`，不是只看 Hex-Rays）：

```
cmp  dword ptr [esi+74h], 1        ; mob+116 == 1 → 直接 return（連封包都不讀！）
u8   byte1                         ; 只影響結尾的狀態：mob+116 = byte1 ? -3 : -2
u8   byte2                         ; test dl, dl; jl → bit 7 = 「保持目前動畫」
u32  value                         ; 一定有，而且在分支之前讀
if byte2 >= 0:
  facing = byte2 & 1 ; action = byte2 >> 1
  if !(mob+276（舊 action）∈ 10..12 且 action ∈ 7..9):
    mob+272 = (mob+272 & ~1) | facing ; mob+276 = action ; sub_485DA0(mob)   ← 重新綁定腳踏點
  if action ∈ 10..12 → sub_488E30(mob, action, facing, value)      ← 攻擊動作才用到 value
  else if action ∈ 7..9 → mob+280 = now + sub_486180(mob, action)  ← 受擊動作抓動畫長度
CMovePath（sub_4967C0 → sub_4953A0，與 0x22／0x0E 同一支解碼器）
mob+116 = byte1 ? -3 : -2
```

| # | 寬度 | 欄位 | 說明 |
|---|---|---|---|
| 1 | `u32` | **mobId** | 池查表（`sub_492400`）|
| 2 | `u8` | **動作位元組** | bit 7 = 保持目前動畫；bit 0 = 面向；bit 1..6 = **動作索引** |
| 3 | `u32` | value | 語意未解；只有攻擊動作（10..12）會把它傳進 `sub_488E30`，走路／站立時沒人讀 → **走路送 0** |
| 4 | `CMovePath` | 路徑 | §4.11.5 的格式（`u16 originX/Y` + `u8 count` + 每個元素 14 bytes）|

`readMobMove` 也讀得回來（`readMobMove`／`encodeMobMove`／`describeMobMove`，`src/protocol/mob.ts`）。

#### 4.16.2 動作索引：client 自己的 16 個名字

`sub_485400(mob, index)` 用 `index` 查怪物自己的動作表（`__ROR4__(key,5) % size` 的 ZMap 樣式），
而填表的是 `sub_40B530`——它在 `+0x156` 配置一個 **`CActionMan::MOBACTIONENTRY`**（RTTI 名稱就在
反編譯碼裡），並用 `(&off_5B20FC)[index]` 取名字。`.data:0x5B20FC` 就是這張 16 筆的表
（`MapleStory.exe.lst` 行 773757 起，到 `0x5B2138` 的 `"dieF"`）：

| 索引 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 名字 | move | stand | jump | magic | throw | ball1 | ball2 | hit1 | hit2 | hitF | attack1 | attack2 | attackF | die1 | die2 | dieF |

三個獨立的地方都對上這張表：`sub_488BC0` 對 7..9（受擊）與 10..12（攻擊）特別處理；
`sub_485530`（`sub_491AB0` 的另一條路，見下）挑 `13 + rand() % template+116`＝die1/die2/dieF；
`MOB/0120100.img` 的動畫名稱正好是 `move, stand, hit1, die1`。

#### 4.16.3 `0x30`／`0x31`：怪物怎麼離場（順便把 `0x31` 的舊錯誤改掉）

| opcode | 函式 | 內容 | 語意（有證據的部分）|
|---|---|---|---|
| `0x30` | `sub_4926B0` | `u32 mobId` + `s16 delayMs` | `delayMs >= 0` → 把 (mobId, now+delayMs) 塞進**池的定時佇列**，到期就開始死亡動畫（§4.17.2）；`delayMs < 0` → 立刻 `sub_491AB0(pool, mobId, 0)`（sprite 還在播就放棄）|
| `0x31` | `sub_4927B0` | `u8 flag` + `u32 mobId`（**沒有 CMovePath**）| `flag != 0` → `sub_491630`：池裡沒有這個 id 時才讀 `u32 templateId` + `CMob::Init` 的欄位並建立、最後 `sub_485330(mob, 1)` 打開**閃光**；`flag == 0` → `sub_491830`（收屍，§4.17.3）|

- 定時佇列的消費者是**池自己的更新函式** `sub_492100`：`endTime - now <= 0` 就
  `sub_491AB0(pool, mobId, 1)`。`a3 != 0` 的分支會 `sub_485530(mob)`（拆掉並重建怪物的元件清單，
  然後挑一個 die 動作），兩條分支最後都會把怪物從池的雜湊鏈上移除。
- `0x2F` 會把 **`mob+112` 設 1**，而 `sub_491AB0(a3 == 0)`（移除）遇到 `mob+112 != 0` 就直接放棄。
  這個「留在池裡」的旗標語意仍未完全確定（§4.15 的第 1 項、§4.17.6 第 3 項），但欄位與流向是清楚的。
- `0x32`／`0x36`：`sub_492380` 對它們**沒有分支**（只讀了 `u32 mobId`），等於空包。
- `0x34`：`u16 → mob+132`，然後跑 `mob+116` 的狀態機（1→5、2→4、3→5，其餘 `sub_485330(mob, 1)`）。
  `mob+132` 的唯一讀者把它拿去比攻擊的 `conMP`，所以**它是怪物的 MP**；狀態機則讓 client 進
  「可以被重設成受擊動作」的 4／5（§4.17.1）——這一條是打怪有沒有「打到彈一下」的關鍵。
- `0x35`：`sub_488E10` → `sub_4C6CE0`，就是 `0x2F` 尾巴那個**動畫狀態區塊**（`u32` 旗標 + 每個
  設定的 bit 各 2 個 `u16`），差別是這裡的物件是 `mob+136`（同一組通道位移）。

> **更正**：§4.12 的表與舊註記把 `0x31` 寫成「移動」。`0x31` **不帶 `CMovePath`**，
> 它只是「這個 id 還在／不在了」；移動是 `0x33`。

#### 4.16.4 腳踏點：`foothold/<page>/<group>/<item>` 的 item key 就是 `life.fh`

`life` 的每個出生點都帶 `x`、`cy`、`fh`。`fh` 對應到的不是 group，而是**最內層 item 的 key**：

```
foothold / <page> / <group> / <item = fh>  →  { x1, y1, x2, y2, prev, next }
```

`prev`／`next` 把同一條地面上的線段串成**折線**（`footholdChain`），所以怪物走路的地方就是這條
折線。驗證方式是把「出生點站在它的腳踏點上」對**全部** `life` 檢查：

| 檢查 | 結果 |
|---|---|
| 100 張地圖的 foothold item key 有沒有重複 | **0 個重複**（共 30,338 個線段）|
| 2,322 筆 `life` 的 `fh` 是否都存在 | **全部命中** |
| `x` 是否落在該線段的 x 範圍內 | **全部命中**（0 筆在外）|
| 線段上內插出來的 y 是否等於 `cy` | **2,322 / 2,322（誤差 ≤ 1）** |

所以地圖檔的 `cy` 就是「腳踏點在 `x` 的 y」，`y` 則是出生點左上角。另外 `life.rx0/rx1`
幾乎等於該折線的 x 範圍（例：`000040000` 的 `fh 33` 折線是 −309..2919，出生點寫 −289..2899），
這也解釋了伺服器為什麼可以只靠地圖檔決定巡邏範圍。

#### 4.16.5 巡邏：一個 `0x33` 走一段（`src/game/mobs.ts`）

沒有「怪物移動」的 client → server 封包（§4.5 的 39 個 sender 裡沒有），所以**怪物是伺服器驅動的**：
位置是伺服器決定的，client 只負責播放收到的路徑。實作在 `src/game/mobs.ts` 的 `MobField`：

1. 出生點來自 `life`，座標吸附到它的腳踏點（`footholdYAt`）；`fh` 找不到線段就站著不動。
2. 巡邏範圍 = 該折線的 x 範圍 ∩ `life.rx0/rx1`（範圍只有一個點 → 不走路）。
3. 每一段（leg）送一個 `0x33`：`originX/Y` = 現在位置，一個元素 `(x, y, foothold, duration)`
   = 這一段的終點與時間，`action` = move（0）＋面向。**duration 就是視覺速度**，因為 client
   只是照著播；元素一律 `vx = vy = 0`（`sub_495880` 認為路徑元素是位置快照）。
4. 走到範圍端點就折返（下一段換方向）；一段最長 3 秒（長距離拆成小步，順便把封包量壓低）。
5. 速度 = `PATROL_SPEED_PX_PER_SEC`（**60 px/s，伺服器自己的選擇**）× 怪物的 `info.speed` 百分比。
   `info.speed` 是**相對值**：`sub_48D080` 讀 WZ 的 `speed` 後算 `clamp(0, speed + 100, 130)`
   （스포아 −30 → 70%、스텀프 −70 → 30%、주황버섯 0 → 100%）。**基準值沒有 binary 證據**
   （原伺服器自己選的），所以它是一個有名字、可調的常數（`--mob-speed`），不是散落的魔術數字。

| 測試 | 內容 |
|---|---|
| `server/test/mobs.test.ts` | 腳踏點語意（item key、折線、內插、範圍外回 `undefined`）、巡邏（一個 tick 一段、到端點折返、`rx0/rx1` 裁切、速度換算、`vx/vy = 0`）、不動的怪（沒有腳踏點／`speedPercent 0`／範圍一個點）、出生點吸附到地面、`0x33` 逐 byte 形狀與截斷、動作表 |
| `server/test/serve.test.ts` | 真 socket：`0x2F` 之後真的會來 `0x33`（`mobTickMs = 20`），欄位與腳踏點一致，標頭全數通過 |
| `server/test/map.test.ts` | `life` → 出生點（`rx0/rx1/cy` 的預設值）、`footholdSegments` 數量等於 foothold 數 |

#### 還不能宣稱的部分

1. `0x33` 的 `value`（`u32`）語意未解；走路送 0（沒有讀者）。
2. `0x31` flag != 0 路徑上的 `mob+112`「留在池裡」語意未解（§4.17.6 第 3 項）；
   `0x34` 的 1/2/3 → 4/5 狀態機語意已解（§4.17.1：那 4／5 就是受擊動作的前提）。
3. 怪物**已經會受傷／死亡／重生**（§4.17）：`0x30`／`0x31`／`0x34` 三個封包都有編碼器與測試。
4. 元素 `attr` 沒有任何讀者（client 播放路徑時不讀，`sub_485330` 只讀 x/y/vx/vy/action/foothold/duration），
   所以走路送 0；client 自己在「路徑過期」時補的元素用 1。
5. 巡邏的 **60 px/s 基準**是伺服器的選擇（`--mob-speed` 可調）：原伺服器的值無從得知，
   要靠原 client 實測（ADR-004）才會知道「看起來對」的速度。
6. 還是**每個連線各自一份怪物**（§4.15 第 5 項），所以兩個玩家看到的怪物位置不會一致。

### 4.17 ✅ 打怪的閉環：傷害是 client 算的，伺服器只送三個封包

§4.13.1 解出「client 怎麼報告一刀」，§4.15／§4.16 解出「怪物怎麼出現、怎麼走」；這一節補上中間那一段：
**怪物怎麼掉血、怎麼死、怎麼重生**。整個迴圈的形狀與後期楓之谷不同：2003 年的 client **自己算傷害、
自己畫數字**，伺服器只記帳，並在關鍵時刻送三個「這隻怪的狀態變了」的封包。

| 角色 | 做什麼 | 證據 |
|---|---|---|
| 攻擊者的 client | 算出每個目標的傷害 → `sub_4882F0`（143029-143151）把 `CMob::DAMAGEINFO` 排進**怪物自己**的佇列 → 怪物更新時由 `sub_487A30`（142584-142731）畫出數字 → 整刀寫成 `0x0F` | `sub_512F90`（278611-279361；§4.13.1）|
| 伺服器 | 記帳（HP）、`0x34`（怪的 MP，兼「讓 client 進受擊狀態」）、`0x30`（開始死亡動畫）、`0x31`（收屍／重生）| `src/game/mobs.ts`、`src/protocol/mob.ts` |

#### 4.17.1 `0x34`：`u16` 是**怪物的 MP**，而且它是「怪物會被打到彈一下」的前提

`sub_488D90`（143664-143694）把 `u16` 存進 **`mob+132`**，而 `mob+132` 全 client 只有一個讀者：怪物的
攻擊挑選器 `sub_487D10`（142738-142932）裡的 `if (v9[4] > *(this + 33)) skip`（`.text:0x487D81`）。
被比較的 `v9` 是 `*(mob+124)` 這顆**怪物模板**攻擊清單裡的一筆，清單的來源也解出來了：`sub_48E360`
（149342-150064）用 `L"attack"` ＋ `itow(n2 + 1)`（`n2 == 2` 時是 `L"F"`）拼出 `Mob/<id>.img` 的
`attack1`／`attack2`／`attackF`，再把 `info` 的欄位依序寫進那筆記錄 —— 其中 `[3] = type`（149654）、
**`[4] = conMP`**（149678）。所以 `mob+132` 是**怪物的 MP**，`0x34` 就是「這隻怪還有多少 MP」的通知。

同一支處理器還會動 `mob+116`（怪物狀態）：

| 進 `0x34` 前的 `mob+116` | 之後 | 誰設的（§4.16.1）|
|---|---|---|
| 1（非攻擊動作做完）| 5 | `sub_4885D0` 的尾巴 |
| 2（攻擊動作，`n30a == 0`）| 4 | 同上 |
| 3（攻擊動作，`n30a == 1`）| 5 | 同上 |
| 其它（-1／-2／-3，例如剛被 `0x33` 設過）| `sub_485330(mob, 1)` → 4，並打開**閃光** | `CMob::Init` 設 -1、`0x33` 一律設 -3 |

為什麼這件事重要：傷害數字顯示器 `sub_487A30` 只有在 `mob+116 ∈ {-2, 4, 5}` 時才會把動作重設成
**受擊動作**：

```
if (ArgList > 0 && ArgList >= *(template + 72)     // 傷害 ≥ info.pushed
    && mob+280 == 0 && a2 == now)                  // 沒有受擊動畫在跑、且是「現在」要顯示的
  if (mob+116 ∈ {-2, 4, 5}) sub_4885D0(mob, hitAnim, facing, 0, …)      // 播 hit1
```

而 `mob+116` 的其他來源都不會停在 4／5：`CMob::Init` 設 -1、`0x33` 的尾巴一律設 -3、動作設定器
`sub_4885D0` 只設 1／2／3。**所以不送 `0x34` 的話，怪物只會跳數字、不會被打到彈一下。**

> `sub_485330(mob, 1)` 就是把模板的 `+250/+252/+254/+256`（`s16 ×4`）與 `+258`（`u8`）交給 sprite 的
> `vtbl+184`，也就是「閃光／受擊覆蓋層」；`0x31 flag != 0`（新怪出現）走的是同一支函式。

#### 4.17.2 `0x30`：開始死亡動畫（屍體不會自己消失）

形狀見 §4.16.3。`delayMs >= 0` → 排進 `sub_492100`（153646-153793）的定時佇列；到期時呼叫
`sub_491AB0(pool, mobId, 1)`（153127-153366），也就是 **`sub_485530`**（140481-140687）：

1. 先把怪物身上還沒顯示的傷害記錄清單（`mob+340`，`sub_4882F0` 排的、上限 15 筆）全部送進 `sub_487A30`；
2. `if (*(template + 116) > 0) mob+276 = 13 + rand() % *(template + 116)` → 挑一個 die 動作（13=die1／14=die2／15=dieF）；
3. `sub_485DA0`（140931-141075）播它；die 動作是**不循環**的（`sub_485DA0` 對 13..15 在影格用完時 `break`）。

`template+116` 是「這張圖有幾個 die 動作」。本 `Data.wz` 的 **28 張 `Mob/*.img` 全部只有 `die1`**（實測），
所以動作一定是 13。`delayMs < 0` 走 `sub_491AB0(..., 0)`：立刻移除，但**只要 sprite 還有影格在跑
（`sub_485520`）就放棄**，所以死亡動畫不會被切掉。

**`0x30` 不會把怪物從池裡移除**（那要 `0x31`）：屍體留在 client 上，直到 `0x31 flag = 0`。
死亡動畫長度＝Σ 每個影格的 `delay`；沒有 `delay` 的影格用 **180 ms**（`sub_40B530` 19949 的
`lVal = 180`），`UOL` 影格也算一格（`Mob/5130100.img/die1` 的最後一格就是 `UOL`）：

| 怪物 | `info.maxHP` | `info.maxMP` | `info.pushed` | `die1` 影格 | 死亡動畫 |
|---|---|---|---|---|---|
| 0100100 파란달팽이 | 8 | 0 | 1 | 9 × 180 | 1620 ms |
| 0120100 스포아 | 20 | 0 | 1 | 4 × 180 | 720 ms |
| 1210102 주황버섯 | 80 | 0 | 1 | 3 × 180 | 540 ms |
| 5130100 와일드보어 | 2500 | 200 | 1 | 8 × 180 | 1440 ms |

#### 4.17.3 `0x31`：收屍（flag = 0）與重生（flag != 0）

- `flag == 0` → `sub_491830`（152889-153124）：池裡查不到這個 id 就**直接返回**（所以對已經消失的怪再送
  一次是安全的）；查到的話，sprite 還在動就先 `sub_485330(mob, 0)` 關掉閃光，`mob+112 == 0` 才把池項
  從侵入式鏈結串列上拆掉。
- `flag != 0` → `sub_491630`（152770-152885）：池裡**已知**這個 id → 只刷新一下（封包後面沒有欄位）；
  池裡**沒有** → 讀 `u32 templateId`，其餘**就是 `0x2F` 的身體**（兩條路都經過 `CMob::Init`），
  建好之後 `sub_485330(mob, 1)`（**閃光**）。

所以「重生」用 `0x31 flag != 0` 比 `0x2F` 更貼：client 會把新出現的怪物閃一下，也就是「怪物在你面前冒出來」。
（`0x2F` 保留給「進地圖時本來就在的怪物」，那批不該全部閃。）

#### 4.17.4 產品化：`src/game/mobs.ts` 與 `GameEntryServer.applyAttack`

1. **扣血**：`MobField.applyDamage(mobId, damage, now)`。攻擊包裡每個目標記錄的傷害是 `hits` 個 `u16`
   加起來（§4.13.1），直接從 `hp` 扣、夾在 0。**伺服器不重算傷害**（理由與之後要補的驗證見 **ADR-006**）：
   2003 的 client 自己算、自己畫，伺服器重算只會與 client 不一致；它管的是「哪幾隻怪存在、各有多少 HP」。
2. **命中**（HP > 0）：送 **`0x34`**，值是 `info.maxMP`（§4.17.1：這是讓 client 進 4／5 狀態、也就是
   讓怪物彈一下的唯一方法）。傷害數字不用送 —— client 已經畫完了。
3. **殺死**（HP == 0）：先送 `0x34`（讓閃光進狀態），再送 **`0x30`（`delayMs = 0`）**：死亡動畫立刻開始，
   屍體留在畫面上。`dieMs` 來自 `Mob/<id>.img` 的 die 影格（§4.17.2 的表）。
4. **收屍與重生**：`dieMs` 之後送 `0x31 flag = 0`；再過 `MOB_RESPAWN_MS`（**5000 ms，伺服器自己的選擇**，
   `--mob-respawn` 可調）送 `0x31 flag != 0`（`templateId` + `0x2F` 身體），怪物回到地圖檔給的出生點、
   HP 回滿。死掉的怪**不再收到 `0x33`**（不然 client 會把屍體搬走）。
5. `MobField.tickPackets(now)` 是同一個 timer 的出口：先巡邏的 `0x33`，再收屍／重生，順序固定。

#### 4.17.5 測試

| 檔案 | 內容 |
|---|---|
| `server/test/mob.test.ts` | `0x30`（含負延遲）、`0x31` 的兩個 flag、`0x34`、`0x31 flag != 0` 的尾巴與 `0x2F` **逐 byte 相同**、`decode` 的解讀器 |
| `server/test/mobs.test.ts` | 扣血／`0x34` 的值／殺死時送 `0x34`＋`0x30`、死掉後不再有 `0x33`、`dieMs` 之後收屍、`respawnMs` 之後重生（回到出生點、HP 回滿）、`tickPackets` 的順序、沒有 image 的怪不能被打、真 `Data.wz` 的 `dieMs`／`maxMP` |
| `server/test/serve.test.ts` | 真 socket：一刀 10 點 → `0x34` → `0x30` →（40 ms 的假 `dieMs` 之後）`0x31 flag = 0`；打不存在的 id → 完全不回封包，只寫 log |

#### 4.17.6 還不能宣稱的部分

1. **`0x34` 是「命中通知」還是單純「MP 更新」**：`mob+132` 的讀者只證明它被當 MP 用（拿來比 `conMP`），
   不能排除原伺服器在怪物攻擊時扣 MP 後再送一次。本伺服器**每次命中都送 `info.maxMP`**（怪物不消耗 MP），
   並在這裡註明「進 4／5 狀態」是實作目的之一。
2. **屍體是 client 自己收還是等 `0x31`**：`sub_485530` 只設死亡動作，沒有把怪物拆出池子；`sub_492100`
   到期時也只呼叫 `sub_491AB0(..., 1)`（=開始死亡）。本伺服器假設**要送 `0x31`**；若原 client 會自己收屍，
   多送一個 `0x31 flag = 0` 也只是查不到 id 的空操作（`sub_491830` 的 early return）。
3. **`mob+112`（§4.15 第 1 項）**：`0x31 flag = 0` 遇到 `mob+112 != 0` 就放棄，語意仍未解，本伺服器不設它。
4. **重生 5000 ms 與巡邏 60 px/s 一樣是伺服器自己的選擇**：binary 裡沒有這兩個值。
5. **沒有實機驗證**：`0x34`／`0x30`／`0x31` 送出去之後畫面長什麼樣（閃光、彈一下、倒下、重生）目前只由
   反編譯碼推導；ADR-004 的實機 run 才能確認。

### 4.18 ✅ 掉落與拾取：`0x43`／`0x44`（`CRewardPool`）＋ `0x0B`／`0x11`（`CWvsApp`）

§4.13.2 記過一件事：v1.11 的 client **沒有**「撿東西」這個請求 —— 所有送出的地方都是寫死的
opcode，最大只到 `0x33`。所以掉落是**伺服器單方面決定**的：誰掉、掉什麼、誰撿到、什麼時候消失，
全部由伺服器送封包宣告，client 只負責演動畫。這一節把四個相關封包解到欄位層，並修正 §4.6 的一個
錯誤（`0x0B` 的種類位元組）。

| opcode | 方向 | 角色 | 處理函式 | 證據 |
|---|---|---|---|---|
| `0x43` | s2c | 地上出現一個掉落物 | `sub_4A88A0`（177841-178372）| `.c` 177828（`sub_4A8870` 只有這一條與 `0x44` 的分支）|
| `0x44` | s2c | 掉落物消失（過期／被撿走）| `sub_4A95B0`（178480-178748）| 同上 |
| `0x0B` | s2c | 道具欄異動（撿到道具、換位、清格）| `sub_55BAB0`（352319-352477）| §4.6、本節 §4.18.4 |
| `0x11` | s2c | 聊天視窗的「獲得了 …」訊息 | `sub_55C130`（352678-352811）| §4.10、本節 §4.18.5 |

#### 4.18.1 分派：`0x42`／`0x45` 沒有任何處理函式

`sub_472770`（121118-121200）把 `0x42`–`0x45` 全部交給 `sub_4A8870(this_4 = &dword_5C204C, opcode,
packet)`（`dword_5C204C` 是 `CRewardPool` 全域，建構子在 `sub_4A73A0`，176634-176762）。而
`sub_4A8870`（177828-177838）**只有兩條分支**：

```c
if ( opcode == 67 )      sub_4A88A0(this, packet);   // 0x43
else if ( opcode == 68 ) sub_4A95B0(this, packet);   // 0x44
return opcode - 68;                                  // 0x42 / 0x45 落到這裡，什麼都不做
```

所以 `0x42`／`0x45` 是「有 opcode 但沒有 handler」。`schema.ts` 與 `describeFieldOpcode` 現在就照這個寫：
`0x42 CRewardPool(no handler)`、`0x43 CRewardPool(drop appear)`、`0x44 CRewardPool(drop gone)`、
`0x45 CRewardPool(no handler)`。

#### 4.18.2 `0x43`：掉落物出現（`sub_4A88A0`）

| 欄位 | 型別 | 讀取 | 意義與證據 |
|---|---|---|---|
| `kind` | u8 | `sub_45DC40` | 唯一的讀者是「`kind <= 1` 才多讀一顆怪物區塊」，見下 |
| `dropId` | u32 | `sub_45DCC0` | ZMap 的鍵（`__ROR4__(key,5) % this[3]`）。**同一個 id 還在場上時只會更新那一筆**，不會多一筆 |
| `money` | u8 | `sub_45DC40` | **分支而非旗標**：`!= 0` → 下一個 u32 是**金額**；`== 0` → 下一個 u32 是**道具 id** |
| `value` | u32 | `sub_45DCC0` | 金額或道具 id（見上）。道具走 `sub_479B10(id, 0)`（128587-128697）→ `sub_47CE40` 讀 `Item/<種類>/<id>.img/<id>/info` 的 `icon`／`iconRaw`；金額走 `sub_4A9C40`（178763-178932）|
| `x`, `y` | s16 ×2 | `sub_45DC80` | 掉落物**落點**（`v92[9]`/`v92[10]`），同時也是「目前位置」的初值（`v92[7]`/`v92[8]`）|
| ↓ 只有 `kind <= 1` 才讀 | | | |
| `mobId` | u32 | `sub_45DCC0` | 怪物 id：`sub_492C00`（154413-154433）拿它在 `CMobPool` 裡查；**查到就把「目前位置」覆寫成 `mob+360`/`mob+364`** —— 這就是「東西從怪物身上飛出來」的來源 |
| `mobX`, `mobY` | s16 ×2 | `sub_45DC80` | 上面那個查詢**失敗**時的替代位置（失敗是正常路徑，不會丟例外）|
| `unknown` | s16 | `sub_45DC80` | 無條件讀取（`.lst` 004A8C4A）之後只出現在一個指標加法（`v92[11] = ptr + 它`，178350）；沒有任何繪圖路徑把它當座標，**本伺服器寫 0** |

- 金額圖示：`sub_4A9C10`（178753-178760）決定用哪一張錢堆圖：
  `a < 50 → 0`、`a < 100 → 1`、`a < 1000 → 2`、其餘 `3`，圖示名 = `%08d` of `9000000 + 那個值`，
  在 `Item/Special/0900.img`（四張錢堆）。
- client 建出來的紀錄是 **88 bytes**（`sub_4ABB80`，180160-180207：一次配 1476 bytes / 15 筆）：
  `+4 = kind`、`+5 = (kind == 1 || kind == 2)`、`+8 = dropId`、`+12 = money`、`+16 = value`。
  `+5` 的角色未解，本伺服器只送 `kind = 0`。
- 畫圖前對兩個 y 各做一次 `-= 16`，所以**封包裡的 y 是地面線**，圖示畫在地面線上 16 px。
- 線路長度：`kind 0/1` = 1 + 4 + 1 + 4 + 2 + 2 + (4 + 2 + 2 + 2) = **22 bytes**；`kind 2` = **15 bytes**（含 opcode）。

#### 4.18.3 `0x44`：掉落物消失（`sub_4A95B0`）

| 欄位 | 型別 | 意義 |
|---|---|---|
| `kind` | u8 | `0` = 當場拆掉圖示（過期）、`1` = 安靜移除 + 一個效果分支、`2` = **被某個角色撿走** |
| `dropId` | u32 | ZMap 查詢；**查不到就安靜結束**（不丟例外、不回封包）|
| ↓ 只有 `kind == 2` 才讀 | | |
| `characterId` | u32 | 寫進紀錄 `+60`；**等於自己的角色 id 時**，client 播 `PickUpItem`（100 ms）並用 `sub_41BAC0` 把圖示飛向那個人 —— 別人的 client 也會飛，只是不播音 |

紀錄本身由 `sub_4A8620`（177607-177825）移除。線路長度：**6 bytes**，`kind 2` 時 **10 bytes**。

#### 4.18.4 `0x0B`：道具欄異動（`sub_55BAB0`），順便修正 §4.6

```text
u8  result        // != 0 時把 CWvsApp+24/+28 歸零並記時間 = 解除 client 自己的送包節流
u8  count
count × {
  u8  op          // 0 = 放入、1 = 重設該格的加密金鑰、2 = 兩格互換、3 = 清格
  u8  inventory   // 1..4（1 裝備、2 消耗、3 其他、4 現金；其他值丟棄該條目）
  s16 slot        // 格子；裝備欄可用 -1..-14 指向已穿戴的格子
  <op 專屬欄位>
}
```

- **⚠️ 修正**：`op = 0` 後面**沒有種類位元組**。`sub_55BAB0` 的 case 0 是
  `sub_45E6A0(&obj, packet, pExceptionObject_1)`（352412 附近），而 `pExceptionObject_1 = (char)n570425348`
  **就是剛剛讀到的 `inventory` 值**；`sub_45E6A0`（102334）只在第三個參數為 **0** 時才從 stream 讀一個
  位元組（`if (pExceptionObject == 0) { … LOBYTE(pExceptionObject) = *(_BYTE *)(…) … }`）。所以種類由
  **欄位本身**決定：`inventory 1` → 參數 1 → `GW_ItemSlotEquip`，2/3/4 → `NonEquip`。全 `.c` 只有
  `sub_4D3950`（218459）是以 0 呼叫它 —— 那是本伺服器還沒實作的子系統。§4.6 原本的說法是把它當成了
  這裡的呼叫，已改正。
- 已驗證的 byte 向量（`test/drop.test.ts`）：放一顆 `4000019`（달팽이의 껍질）到「其他」欄第 1 格 →
  `0b 01 01 00 03 01 00 | 19 09 3d 00 | 00 | 01 00`
  = opcode、result、count、op、tab、slot(2)、itemId(4)、現金旗標(1)、數量(2)，共 14 bytes。中間沒有種類位元組。
- `op = 1` 再讀 `u16 key`：`inventory == 1`（裝備欄）會被 client 直接丟 `CTerminateException`，伺服器不可送。
  `op = 2` 再讀 `u16 slot2`（互換）。`op = 3` 清格。收尾 `sub_55EB00` 回傳非 0 → `AVCDisconnectException`。

#### 4.18.5 `0x11`：獲得提示（`sub_55C130`，352678-352811）

| `u8` 種類 | 後續 | client 顯示 |
|---|---|---|
| `1` | `u32 金額` | `메소를 획득했습니다 (+%d)` |
| `0` | `u32 道具id` + `u32 數量` | `아이템을 획득했습니다 (%s)`；**數量 ≤ 1 時不印數量**，否則 `(%s %d개)`。名字由 `sub_479D30`（128701-128829）查，查不到（或空字串）→ **一行都不印** |
| 其他 | 無（總長 2 bytes）| `아이템을 더 이상 가질 수 없습니다`（背包滿了）|

`0x0B`–`0x13` 全部由 `sub_55A900`（351269-351303）分派，**case 號碼就是 opcode**（`0x0A`／`0x14` 沒有 case，直接丟棄）。

#### 4.18.6 伺服器這一側：`game/drops.ts` 與 `game/rewards.ts`

client 不會請求，所以**整條迴圈都在伺服器的判斷裡**（`src/net/loginserver.ts` 的 `tickField`／`pickUp`）：

1. **誰掉什麼**：`defaultDropPolicy(source, random)` —— 三個各自獨立的 roll（`random.range(0, 1000)`）：
   600‰ 掉錢（`1 + range(0, level * 3)`）、300‰ 掉這隻怪自己的雜物（`MOB_JUNK_DROP`，配對來自
   `Item/Etc/0400.img` 的**道具名字**：달팽이 → 달팽이의 껍질…）、50‰ 掉藥水（`POTION_BY_LEVEL` 四個等級帶）。
   三者的機率、金額公式與藥水等級帶**都是伺服器自己的選擇**（ADR-007；binary 裡沒有這些數字）。
2. **掉在哪**：`x` 在怪物 ±`DROP_SPREAD_PX`（24 px）內、`y` 取怪物腳下腳踏點的高度（`footholdYAt`），
   腳踏點查不到才用怪物自己的 y。
3. **存在多久**：`DROP_LIFETIME_MS`（300000 ms）之後 `0x44 kind 0`。
4. **誰撿到**：每個 field tick 檢查「玩家在自己的 `0x0E` 移動包裡報的位置」與每一筆掉落的距離
   （`PICKUP_RANGE_PX` 40 / 上下 `PICKUP_RANGE_Y_PX` 60）。**站在上面就是全部的觸發條件**，沒有請求、
   沒有按鍵；一次 tick 只撿一筆（這樣 client 的飛行動畫才一筆一筆演）。
5. **撿到的三個封包（順序固定）**：`0x44 kind 2`（含角色 id）→ 道具才有的 `0x0B op 0`（放進哪一格）→
   `0x11`（訊息）。錢只送 `0x44` + `0x11`。
6. **放哪一格**：`grantItem` —— 同 id、未滿 `MAX_ITEM_STACK`（200）的堆疊優先；否則第一個空格；
   裝備與現金道具**永不堆疊**（兩件同 id 的裝備 = 兩格）。背包滿 → **不撿**，掉落留在原地（第三種
   `0x11` 存在，但每 tick 對站在上面的人印一次會變噪音）。

#### 4.18.7 測試

| 檔案 | 內容 |
|---|---|
| `server/test/drop.test.ts` | `0x43` 的兩種長度與欄位、`0x44` 的三個 kind、`0x11` 的三種形狀、`0x0B` 的 byte 向量與「裝備欄不可換鑰」、掉落的落點／過期／可撿範圍、`MOB_JUNK_DROP` 與等級帶、`grantItem` 的堆疊與「裝備不堆疊」 |
| `server/test/serve.test.ts` | 真 socket 的整條迴圈：一刀殺怪 → `0x34`＋`0x30`＋`0x43` → 走到錢上 → `0x44 kind 2`＋`0x11` → 走到道具上 → `0x44`＋`0x0B`＋`0x11`；再站一次不會重複撿 |
| `server/test/schema.test.ts` | 新增的四筆目錄列（`0x43`／`0x44`／`0x0B`／`0x11`）都要能被 `decode` 的描述器認出來 |

#### 4.18.8 還不能宣稱的部分

1. **`kind` 的三個值**：`0x43` 只有「`kind <= 1` 多讀怪物區塊」與「`+5 = kind == 1 || kind == 2`」兩個
   線索，沒有字串或分支替它們命名；本伺服器只送 `kind = 0`。`0x44` 的 `kind 1`（「安靜移除 + 效果」）
   與 `kind 2` 的飛行動畫細節（`sub_41BAC0`）也沒有實機看過。
2. **client 的錢包不會動**：§4.21 解出 `0x0D` 之後可以確定**這不是漏送** —— `0x0D` 的 19 個 bit
   裡沒有任何一個是錢（`mesos` 在 client 的 `CWvsApp+36` 紀錄裡另外存，不在 `CharacterData`
   的欄位遮罩表上）。所以 `MesoWallet` 目前只是**伺服器端的帳**，撿到錢時畫面上唯一會變的仍然是
   `0x11` 那行字。要讓錢包真的跳，得先知道錢在紀錄裡的位移。
3. **機率、壽命、擴散、可撿範圍全是伺服器的選擇**（ADR-007）：binary 裡一個都沒有，
   「看起來對」要等 ADR-004 的實機 run 量。
4. **`0x43` kind <= 1 的 `unknown` s16** 仍未解（本伺服器寫 0）。
5. **沒有實機驗證**：`0x43` 的飛行、`0x44 kind 2` 的撿取音效、`0x0B` 放進格子的畫面，全部只由反編譯碼推導。

### 4.19 ✅ NPC：`0x39`／`0x3A`／`0x3B`（`CNpcPool`）

NPC 是 `0x2F` 的**簡化版**：同樣是「池中已有這個 id 就只改變狀態」，但進場包**沒有** `u32 動畫旗標`
＋七個通道那一塊（§4.12.1）——NPC 的動畫由 client 自己從 `Npc/%07d.img` 的 `stand` 播，
所以 `0x39` 不必送。`0x2F` 的教訓（欄位要一一對到讀取端）在這條路上一樣適用：以下每一列都對應
`sub_49F6C0`／`sub_498CF0` 裡的某一次 `sub_45DC40`／`sub_45DC80`／`sub_45DCC0`。

#### 4.19.1 分派（`sub_49F560`，168299-168317）

`sub_472770` 把 `0x38`–`0x41` 送進 `sub_49F560(dword_5C2050, opcode, packet)`（`0x5C2050` 的建構子
是 `sub_49F020`）：

| opcode | 分支 | 位址（`.c` 行號）|
|---|---|---|
| 0x39 | `sub_49F6C0` | 168400-168475 |
| 0x3A | `sub_49F810` | 168478-168595 |
| 0x3B | `sub_49F970` | 168598-168631 |
| 0x3C–0x40 | `sub_49F5B0` | 168320-168340 |
| 0x38／0x41 | 沒有 case | — |

#### 4.19.2 `0x39`：NPC 進場（已知 id **5 bytes**／新 id **20 bytes**）

| # | 條件 | 寬度 | 寫入目標 | 語意 |
|---|---|---|---|---|
| 0 | 一定讀 | `u32` | 池的 key | `npcId`。查表用 `__ROR4__(id,5) % this[3]`（與 §4.12 的 CMobPool 同一個 ZMap）|
| — | **查到了** | — | `entry + 24 \|= 1` | 就是全部：**只設 bit 0（refresh）**，之後不再讀任何欄位 → 封包總長 **5 bytes** |
| 1 | 只有查不到 | `u32` | —（立刻拿去查模板）| `templateId`；`sub_49CB30`（165481-165518）是**有快取**的模板查詢，模板由 `sub_411E50` 的 `Npc/%07d.img`（`.c:20269`）建立，`sub_498A20` 再把它變成 NPC 物件 |
| 2 | 只有查不到 | `s16` | `npc+32` 與 `npc+30` | **x**（兩個欄位都存，`sub_498CF0` 161467-161990）|
| 3 | 只有查不到 | `s16` | `npc+33` 與 `npc+31` | **y** |
| 4 | 只有查不到 | `u8` | `npc+20` | **面向**（＝地圖 `life` 的 `f`）|
| 5 | 只有查不到 | `u16` | 只拿去查表 | `sub_489800(pool + 25, &key, &out)`：查到的 `+32` 欄位會進 vecctrl 的建立流程；**查不到是正常路徑** |
| 6 | 只有查不到 | `s16` | `npc+16` | 成對的兩個值，一起交給 `sub_540400`（vecctrl 建立）；**沒有任何字串替它們命名** |
| 7 | 只有查不到 | `s16` | `npc+17` | 同上 |

新 id 讀完後 `sub_49F6C0` 把 `+24` 設成 `1`、把項目鏈進池，再交給 `sub_498CF0` 讀第 2–7 欄；
**之後封包就結束了**（沒有動畫區塊、沒有 `CMovePath`）。

- `sub_498CF0` 的讀取序列是 2×`sub_45DC80`(`u16`)、`sub_45DC40`(`u8`)、`sub_45DC80`、2×`sub_45DC80`
  —— 精確對上第 2–7 欄（兩個 `s16` 由 `sub_45DC80` 讀，`u8` 由 `sub_45DC40` 讀，三個 `u16` 由
  `sub_45DC80` 讀）。讀不完 → `ZException(38)`（與 §4.4 的契約相同）。
- **已知 id 的 `0x39` 是「叫 client 重新整理這個 NPC」**，不是無意義的重複：`0x31`／`0x3B` 都動 bit 1，
  bit 0 只有 `0x39` 會設，而 `0x3A` 只清 bit 0。
- 沒有「目的地 id」這種東西：**`npcId` 由伺服器自己選**，與地圖 `life` 的順序無關（本伺服器從 1 開始編，
  與怪物池各自獨立）。

#### 4.19.3 `0x3A`：NPC 離場（**5 bytes**）

`sub_49F810`（168478-168595）：`u32 npcId` → 查池 → 清 `+24` 的 bit 0；**只有 `+24` 變成 0 時**
才解除鏈結（也就是 `0x3B` 打開的第二狀態會讓離場「記著」）。
查不到這個 id → 安安靜靜地什麼都不做。

#### 4.19.4 `0x3B`：NPC 第二狀態（**6 bytes**）

`sub_49F970`（168598-168631）：**`u8 flag` 先讀，`u32 npcId` 後讀，兩個都無條件讀**
（這點和怪物 `0x31` 的「`u8 flag` + `u32 mobId`」同型，也和 §4.12 的舊猜測相反）。

| flag | 分支 | 動作 |
|---|---|---|
| `!= 0` | `sub_49F260`（168057-168116）| 設 `+24` 的 bit 1，再 `sub_499760(npc+16, 1)` —— **已知 id** 就到此為止；**未知 id** 會再讀完整個 `0x39` 尾段並用 `sub_49F260` 直接建一個「已經是第二狀態」的 NPC |
| `== 0` | `sub_49F380`（168119-168228）| 清 bit 1，再 `sub_499760(npc+16, 0)` |

`sub_499760` 是 `CVecCtrlUser` 的同一組程式碼（§4.11.5 的移動路徑），`npc+16` 是 4.19.2 第 6 欄那個
「沒有名字」的值。**所以第二狀態與 NPC 的移動路徑共用同一個欄位**，這是目前對第 6 欄最強的線索，
但仍不足以命名它。

⚠️ 本伺服器**只用已知 id 的形狀**（`u8 flag` + `u32 npcId`）：未知 id 的那條路會讓 client 在讀封包時
就建立 NPC，`+24` 直接是 2，與「先 `0x39` 再 `0x3B`」在位元上的結果相同但順序不同，沒有實機證據前
不送。

#### 4.19.5 `0x3C`–`0x40`：只有 id，**只有 `0x3D` 讀更多**

`sub_49F5B0`（168320-168340）讀一個 `u32 npcId` 查表，**所有 case 都只有這 4 bytes**，唯一的分支是
`0x3D` → `sub_49A280(npc, packet)`（162629-162717）：

```
s8 first      // 負值／非負值走不同分支
s8 second     // 上面那個模板裡有兩組陣列（npc+19 的 +32／+36）
<CMovePath>   // 兩個索引都命中時才由 sub_4967C0 讀（= §4.11.5 的移動路徑讀取器）
```

也就是說 **NPC 也可以是會走路的**，只是要走的路徑（以及那兩組陣列到底是表情還是動作）還沒有觀測到。
`0x3C`／`0x3E`／`0x3F`／`0x40` 讀完 id 就結束；`0x38` 與 `0x41` 在 `sub_49F560` 裡**沒有 case**，
`0x38` 至今無法解釋（§6 已記錄）。

#### 4.19.6 資料面：`Npc/%07d.img` 與地圖的 `life`

- 路徑格式來自 `sub_411E50`（`.c:20269` 的 `Npc/%07d.img`），`server/src/wz/paths.ts` 的
  `npcImagePath(id)` 就是它。`analysis/data_wz_manifest.json` 這次以正確的形狀（**`images` 是扁平清單**）
  讀出來：1052 張圖裡 **70 張 `Npc/*.img`、28 張 `Mob/*.img`**。
- 地圖的 `life` 區塊同時裝怪物與 NPC（`type` 為 `"m"`／`"n"`），`game/map.ts` 早就把兩者分開；
  NPC 進場用的是同一個 `{x, y, foothold, facing}`（`rx0`／`rx1`／`cy` 對 NPC 沒用）。
- 已核對的現實資料：`헤네시스`（100000000）2 個 NPC／0 隻怪、`달팽이사냥터`（40000）1 個 NPC（2003）
  ／63 隻怪、`암허스트서쪽필드`（1000000）0 個 NPC／45 隻怪。
- 樣本裡**沒有** `Npc/<id>.img` 的地圖（例如自製的 `STUB_MAP` 若指向不存在的 id）→ 這個 NPC 直接
  不生成、並記一行 log。這與怪物不同：`applyDamage` 對不存在模板回 `undefined`，NPC 這條路則是
  **進場前**就查模板，因為 `Npc/%07d.img` 不存在時 client 也畫不出東西。

#### 4.19.7 伺服器這一側：`protocol/npc.ts` 與 `game/npcs.ts`

| 位置 | 內容 |
|---|---|
| `protocol/npc.ts` | `NPC_OPCODE`（`enterField 0x39`／`leaveField 0x3A`／`stateToggle 0x3B`／`update 0x3D`）、`encodeNpcEnterField`／`readNpcEnterField`／`describeNpcEnterField`、`encodeNpcLeaveField`／`readNpcId`、`encodeNpcState`／`readNpcState` |
| `game/npcs.ts` | `NpcTemplate`（`templateId`／`name`／`description?`／`func?`）、`npcTemplateProvider(WzArchive)`（讀 `info/name`）、`NpcField`（`spawnPackets`／`refreshPacket`／`byId`／`present`／`setSecondState`／`remove`）|
| `wz/props.ts` | 新的共用層：`entriesOf`／`propertyOf`／`asNumber`／`asText`／`infoOf`，`game/mobs.ts` 與 `game/map.ts` 也改成用它（同一個規則：**形狀不對的值不算值**，預設值由呼叫端給）|
| `net/loginserver.ts` | `npcTemplate?` 選項、`FieldSession.npcs`、`spawnNpcs`：NPC 的 `0x39` 緊接在怪物的 `0x2F` 之後、**在同一個 TCP 串流、同一組加密狀態**（`0x16` → 每個怪一個 `0x2F` → 每個 NPC 一個 `0x39`）|
| `wz/paths.ts` | `npcImagePath(id)` |
| `cli.ts serve` | 有 `Data.wz` 時同時建立 `npcTemplateProvider(archive)` |

- **id 不重用**：`NpcField.remove()` 只把項目的 `present` 設成 false，id 留在池裡。理由與怪物池相同
  ——client 也在自己的池裡留著那個 id，重用會讓 `0x3A`／`0x3B` 打到錯的對象。池是**單調遞增**的。
- `encodeNpcEnterField` 送 `0` 給第 5–7 欄（`lookupKey`／`pointX`／`pointY`）。第 5 欄的查表失敗是
  client 自己就會處理的路徑（和 §4.12.1 的 `0x2F` 那兩個 `u16` 一樣），後兩欄**沒有證據**，所以不猜。
- `describeNpcEnterField` 對已知 id 的形狀會直接說出「refresh only」；`describeFieldPacket(0x39)` 的 5-byte
  情況則兩種讀法都印（refresh／被截斷），因為**光看長度分不出來**，只有讀取器會不會丟 `ZException(38)` 知道。

#### 4.19.8 測試

| 檔案 | 內容 |
|---|---|
| `server/test/npc.test.ts` | `0x39` 的 20-byte 形狀與常數 hex、已知 id 的 5-byte 形狀、負座標的 `s16`、`0x3A`／`0x3B` 的 5／6 bytes 與欄位順序、描述器對 refresh／截斷的兩種說法、`NpcField` 的 id 從 1 起算、模板不存在就跳過（並記 log）、沒有模板來源時仍然生成、`setSecondState`／`remove` 的合法性（重複 remove 不發封包、id 不重用）、`npcImagePath` 的補零與錯誤輸入 |
| `server/test/field.test.ts` | `describeFieldOpcode` 的 `0x38`（無 handler）／`0x39`–`0x41` 各一列 |
| `server/test/schema.test.ts` | 新的 5 筆目錄列（`0x39`／`0x3A`／`0x3B`／`0x3C`／`0x3D`）都要能被描述器認出來 |
| `server/test/serve.test.ts` | 真 socket：`0x16` → 兩個 `0x2F` → 一個 `0x39`（`templateId 2003`、`x 69`、`y 275`）的順序與欄位；既有的打怪／掉寶測試把 spawn 爆量從 3 改成 4 |

#### 4.19.9 還不能宣稱的部分

1. **第 5–7 欄的語意**（`lookupKey`／`pointX`／`pointY`）：只知道 `sub_489800` 的查表與
   `sub_540400` 的 vecctrl 建立，**沒有名字**。目前送 0。
2. **`0x3D` 的兩組索引**：`sub_49A280` 的兩個 `s8` 指向模板裡的兩組陣列，陣列內容（表情？動作？）
   未讀；`CMovePath` 是否真的會被走出來也沒有實機證據。
3. **`0x38` 與 `0x41` 沒有 case**：`0x38` 夾在 `0x37`（CMobPool 最後一個）與 `0x39` 之間，
   很可能是某個已停用的 NPC 封包；`0x41` 同理。沒有字串或呼叫點能定位。
4. **NPC 的生成是伺服器決定的**：`life` 裡有 2 個 NPC 的地圖就會有 2 個，沒有「NPC 重生」這種事
   （`0x2F`／`0x30` 那一套不存在）。這一點符合 `sub_49F260` 的設計，但沒有實機驗證。
5. **第二狀態在做什麼**：`sub_499760(npc+16, flag)` 與移動路徑共用欄位，所以它很可能是
   「NPC 開始／停止走動」或「表情切換」——**兩種都說得通**，證據不足。
6. **沒有實機驗證**：`0x39` 之後 client 畫出來的 NPC 站在哪、面向哪，全部只由反編譯碼推導；
   需要 ADR-004 的 oracle run。

### 4.20 ✅ 怪物的 AI 在 client 裡：`0x2C`（回報）與 `0x35`（動畫）

這一節回答「怪物為什麼不會打人」。答案不是「還沒實作」，而是**2003 年的怪物 AI 根本不在伺服器上**：
每一隻怪在自己的 client 裡跑一個 per-frame 的狀態機（`sub_4862C0`），它自己挑攻擊、自己算傷害、
自己打在玩家身上，然後用 `0x2C` 把「我剛剛做了什麼」回報給伺服器。伺服器的角色是**記帳與轉播**
（`0x33`／`0x35` 給其他 client）。這對重寫的意義很大：AI 屬於 client（DECISIONS ADR-008），
伺服器不需要、也不該憑空發明一套自己的。

#### 4.20.1 攻擊決策鏈（全部在 client）

| 步驟 | 函式（`.c` 行號）| 內容 |
|---|---|---|
| 每幀更新 | `sub_4862C0`（141156-142547，`HRESULT __fastcall`、**沒有直接呼叫點** ⇒ virtual）| 怪物的狀態機。攻擊的閘門在 141460：`mob+276 <= -1`（目前沒有動作在跑）且（`*(mob+124 + 24) == 3` 或 `*(mob+104 + 112) != 0`）且 `*(mob+108 + 24) != 0` 且 `*(mob+108 + 296) != 0` 且 **`mob+116 == 5`**（狀態）|
| 挑攻擊 | `sub_487D10`（142738-142932）| `*(mob+124 + 108) <= 0` ⇒ 這隻怪沒有攻擊資料，回 0。否則對第 `i` 個攻擊（`sub_4880E0` 是**惰性解析**，`sub_48E360` 才真的讀 `attack<i>`）：**`entry[4] > mob+132`（＝`conMP` 大於怪物的 MP）就跳過**；`entry[3] == 0` 用兩個互為鏡像的矩形對玩家的矩形（`sub_5085E0(&this_6->x, &rc, 0)`）做 `IntersectRect`，否則用 `sub_488220(x, x ± w, y, 4, ...)` 做線段測試；命中的記下 `(攻擊索引, 面向, 位置)`|
| 選擇 | 同上尾端 | 用 client 自己的亂數產生器（`dword_5D2C20`，`sub_4619F0`）從命中清單挑一個：`*action = 索引 + 10`、`*facing`、`*value = 位置（`x \| y << 16`，沒有原點的攻擊型別寫 0）`。**`+ 10` 就是動作表裡的 `attack1`**（§4.16 的 `MOB_ACTION`），與 `.data:0x5B20FC` 完全一致|
| 執行 | `sub_4885D0`（143230-143557）| 播效果（`sub_53D3F0(v47, n, ±130, 0)`、`sub_53D390(v47, a5)`、`sub_5374F0`）、送 `0x2C`、把 `mob+116` 設成 `(n30a != 0) + 2`（＝2 或 3）或 `1`|

`v47 = *(mob+108)` 是**被打的那個使用者物件**：它的 `+216` 區塊會被接進封包（`sub_495880`），
而且攻擊的音效／特效都打在它身上。`mob+104` 是另一個指標（`+112` 被當條件讀），
**兩者的身份沒有定位**，只知道其中一個是使用者。

#### 4.20.2 `0x2C`：client → server 的「怪物動作」回報

送出的地方有三個（同一支 `sub_4885D0`）：

| 呼叫點 | 時機 | `a5` |
|---|---|---|
| 141468（在 `sub_4862C0` 裡）| AI 決定要攻擊，`sub_487D10` 回非 0 | 1 |
| 142636（在 `sub_487A30` 裡）| 動作播到**命中影格**（`ArgList >= *(mob+124 + 72)`）、狀態 ∈ {-2, 4, 5} | `a10` |
| 141581（在 `sub_4862C0` 的 `LABEL_55`）| 收尾：`sub_5398B0(...) == -1` 且狀態 ∈ {4,5} | 0 |

欄位（`sub_4A1EA0(&packet, 44, 0)` 之後的寫入順序）：

| # | 寬度 | 值 | 語意 |
|---|---|---|---|
| 1 | `u32` | `mob[30]` | **怪物 id**（＝`mob+120`，與 `0x0F` 目標、所有 s2c 怪物封包同一欄）|
| 2 | `u8` | `n30a \| (16 * a5)` | **bit 0** = `sub_4619F0(&dword_5D2C20) % 0x65 <= 0x46`（71/101，client 自己的產生器，**伺服器無法重算**）；**高 nibble** = `a5`（1 = AI 的攻擊、0 = 命中影格／收尾）。除此之外整個 byte 沒有其他線索 |
| 3 | `u8` | `n13 >= 0 ? (2*n13) \| (facing & 1) : n13` | **動作位元組**，就是 `0x33` 的編碼（`(action << 1) \| facing`）；`n13 = -1` 時直接寫 `0xFF` ＝**收尾** |
| 4 | `u32` | `value`（`sub_487D10` 的第 4 個輸出）| 攻擊型別 `entry[3] != 0` 時的**原點位置**（`x \| y << 16`），否則 0 |
| 5 | 尾段 | `if (*(mob+124 + 24) != 0) sub_495880(user + 216, packet, *(mob+124 + 24) == 3, …)` | 由 `sub_495880` → `sub_495620` 附加：`u16`、`u16`、`u8`，然後逐筆 `u8`、`u16`、`u16`…。**沒有解出**（`sub_495620` 讀的是使用者 `+216` 的傷害／數字區塊），本伺服器**原封不動保留** |

寫完之後 `mob+116 = a5 != 0 ? (n30a != 0) + 2 : 1`。

#### 4.20.3 `0x35`：server → client 的「這隻怪在播哪個動作」

`sub_492380`（153831）讀 `u32 mobId`（長度不足 4 → `ZException(38)`），查池（`sub_492400`），
**查不到就什麼都不讀**；查到才 `switch`：

```
case '3' (0x33) -> sub_488BC0   移動（§4.16）
case '4' (0x34) -> sub_488D90   怪物 MP（§4.17）
case '5' (0x35) -> sub_488E10   動畫
```

`sub_488E10` 只有三行：`timeGetTime(); return sub_4C6CE0(this + 34, packet, Time);` ——
`this + 34`（dword）＝**`mob+136`**，正是 `CMob::Init` 傳給同一個解碼器的那個物件（§4.12.1）。
所以 `0x35` 的身體**就是 `0x2F` 尾巴那塊動畫區塊**：`u32 旗標` ＋ 每個設定的 bit 各
`s16 索引`、`s16 延遲`（延遲單位 100 ms，寫成 `timeGetTime() + 100 * 延遲` 的結束時間）。

- 這才是「讓某隻怪播攻擊動作」的封包：自己操控的 client 走 `0x2C` 那條路，**其他 client 只會收到
  這個**。
- 旗標為 0 是合法的：七個通道全部歸零（`sub_4C6CE0` 會把沒設定的 bit 對應的通道清掉）。
- 動作索引在這裡是**原樣的數字**（客戶端存 `(索引, 延遲)` 兩顆，不經過 `0x33` 的 `<<1` 編碼）。

#### 4.20.4 怪物狀態 `mob+116`（已定位的轉移，命名是我們的）

| 來源 | 效果 |
|---|---|
| `sub_488BC0`（`0x33`）| 進入時 `== 1` 就整包不讀直接返回；離開時設 `-2`（`byte1 == 0`）或 `-3` |
| `sub_488D90`（`0x34`）| `1 → 5`、`2 → 4`、`3 → 5`，其他值 → `sub_485330(mob, 1)`（閃光）並且 `= 4` |
| `sub_4885D0`（`0x2C` 的產生者）| `= (n30a != 0) + 2`（2 或 3），或 `a5 == 0` 時 `= 1` |
| `sub_487A30`（動作的影格處理）| 狀態 ∈ {-2, 4, 5} 時在命中影格呼叫 `sub_4885D0` |

⇒ 「1 = 站著、2/3 = 攻擊（miss/hit）、4/5 = 攻擊動畫的命中階段、-2/-3 = 走動」是**讀出來的合理命名**，
不是 binary 裡的字串。這一節只主張轉移，不主張名字。

#### 4.20.5 伺服器這一側：這一回合只做「讀得懂」

- `protocol/mob.ts` 新增 `MOB_OPCODE.anim`（`0x35`）、`encodeMobAnim`／`readMobAnim`／`describeMobAnim`；
  動畫區塊的讀寫抽成 `writeMobChannels`／`readMobChannels`，與 `0x2F` 的尾巴**共用同一份實作**
  （測試直接比對兩者的 bytes 相同）。
- `protocol/field.ts` 新增 `CLIENT_FIELD_OPCODE.mobAttack`（`0x2C`）、`readClientMobAttack`／
  `encodeClientMobAttack`（`ClientMobAttackBody` 只收「真的寫進封包」的四個欄位，`action`／`facing`／
  `hasPosition` 由 `actionByte` 與位置自己導出）；`describeClientFieldPacket` 會印出
  `0x2c mob attack: mobId=… attack1,left flags=0x11 at (x,y) tail=nB`，所以 `serve`／`decode` 的日誌
  從這一版起就看得懂原 client 的怪物攻擊。
- **不做**：伺服器不模擬怪物 AI、不重算傷害、**不改玩家的 HP**（`0x0D` 能力值差異包雖然已解出並用於
  經驗值／升級，§4.21，但「被怪物打 → 掉血」還沒接上：`0x2C` 只是 client 的報告，`applyAttack` 只處理
  我們自己角色的攻擊）。`serve --game-port` 目前仍舊自己送 `0x33` 讓怪物巡邏——那是**我們 client 還沒
  有 AI 之前的替代品**，與本節的結論並存但不同層（ADR-008 有寫明）。

#### 4.20.6 還不能宣稱的部分

1. **`0x2C` 的尾段**（`sub_495620` 附加的 `u16`／`u16`／`u8` ＋清單）：只知道它是使用者 `+216`
   區塊的內容（傷害數字？HP？），**沒有解出**。本伺服器不解析、不回應。
2. **旗標 byte 的兩個部分**：bit 0 的 71/101 roll 與高 nibble 的 `a5`。`a5` 只有「1 = AI 攻擊、
   0 = 命中影格／收尾」這個觀察，它是不是「這一擊是否真的命中」**沒有證據**。
3. **`mob+124 + 24` 與 `+72`**：前者是 `0x2C` 尾段的開關、後者是命中影格，都是怪物圖片解析後的欄位，
   沒有名字。
4. **`mob+104` / `mob+108` 的身份**：只知道 `+108` 會被打、它的 `+216` 進封包。
5. **`0x2C` 之後伺服器該做什麼**：2003 年的伺服器（`d3d8`／`sub_55...` 那一側）不在手邊，
   「扣怪物的 MP 後回 `0x34`」只是合理推測，**沒有證據**，所以本伺服器不做。
6. **沒有實機驗證**：`0x35` 送出去之後 client 播什麼、`0x2C` 的時序（一次攻擊到底送幾包），
   都要等 ADR-004 的 oracle run。

### 4.21 ✅ `0x0D` 能力值差異包（`sub_55BEB0`）＋經驗值表（`sub_4C7110`）

這是**唯一已解出、會改動玩家自己那份角色紀錄的 server → client 封包**：狀態列的 HP／MP 條與
經驗條畫的都是 client 自己的 `CharacterData`（§4.9），而這一包就寫在那份紀錄上。這也是
「殺怪 → 經驗值 → 升級」與「怪物打我 → HP 下降」兩個閉環缺的最後一塊。

#### 4.21.1 身體：`u8 ack` ＋ `u32 旗標` ＋ 差異欄位 ＋ `u32 panelFlags`（byte-exact）

分派：`sub_55A900` 的 case 13，也就是 **`CWvsApp` 層**（`0x0A`–`0x14`，`sub_43B170`），不是 CField
的分派表。所以**同一個位元組在另一個方向是別的封包**（c2s 的 `0x0D` 是 `CField::SendInteract`，
`[u32 kind][string name]`，§4.13.2／`CLIENT_FIELD_OPCODE.interact`），跟 `0x0B`／`0x0F` 同一個道理。

```
u8  ack            // != 0 → CWvsApp+24 = 0、CWvsApp+28 = timeGetTime()
u32 flags          // 19 個 bit（最高到 0x40000），由 0x01 往上依序處理
                   // 每個 set bit 就讀一個欄位（沒 set 的不在線上）
u32 panelFlags     // 能力面板／buff 區塊的旗標；0 = 後面沒有東西（見 §4.21.2）
```

`sub_45E0D0` 是差異讀取器（`.c:101985-102257`），讀到的每一個欄位都寫進 client 的角色紀錄
（`sub_463050` 交出來的就是 `CWvsApp+36` 那份）；紀錄裡的每個值都是「遮罩對」中的一半，
**線上送的是純值**，所以伺服器端不需要任何 RNG。

| flag | 欄位 | **這一包的寬度** | `CharacterData` 的寬度 | 讀取端 |
|---|---|---|---|---|
| `0x00001` | `appearanceA` | u32 | u32 | `sub_45DCC0` |
| `0x00002` | `appearanceB` | u32 | u32 | `sub_45DCC0` |
| `0x00004` | `unknown26` | **u32** | u8 | `sub_45DCC0`（讀 4 byte，只留 1 byte：`mov [edi+1Ah], al`）|
| `0x00008` | `hair` | u32 | u32 | `sub_45DCC0` |
| `0x00010` | `level` | u8 | u8 | `sub_45DC40` |
| `0x00020` | `job` | u16 | u16 | `sub_45DC80` |
| `0x00040` | `str` | **u8** | u16 | `sub_45DC40` + `movzx bp, byte` |
| `0x00080` | `dex` | **u8** | u16 | 同上 |
| `0x00100` | `int` | **u8** | u16 | 同上 |
| `0x00200` | `luk` | **u8** | u16 | 同上 |
| `0x00400` | `hp` | u16 | u16 | `sub_45DC80` |
| `0x00800` | `maxHp` | u16 | u16 | `sub_45DC80` |
| `0x01000` | `mp` | u16 | u16 | `sub_45DC80` |
| `0x02000` | `maxMp` | u16 | u16 | `sub_45DC80` |
| `0x04000` | `ap` | u16 | u16 | `sub_45DC80` |
| `0x08000` | `sp` | **s16** | u16 | `sub_45DD80`（有號）|
| `0x10000` | `exp` | u32 | u32 | `sub_45DDC0` |
| `0x20000` | `fame` | **u32** | u16 | `sub_45DDC0`（讀 4 byte，只留 2 byte：`mov [edi+55h], ax`）|
| `0x40000` | `unknown93` | u32 | u32 | `sub_45DDC0` |

- ⚠️ **這是全表最重要的細節：差異包的寬度不等於 `CharacterData` 的寬度**。`sub_45D840`
  （§4.9 的 69-byte 區塊）把 `unknown26` 讀 1 byte、`fame` 讀 2 bytes、`str`/`dex`/`int`/`luk`
  讀 2 bytes；而 `sub_45E0D0` 讀 4／4／1 bytes。三處都在 `.lst` 的組語裡逐 byte 確認過
  （Hex-Rays 對前兩處只寫 `u8`／`u16`，會讓人以為兩邊一樣）。
- **`str`/`dex`/`int`/`luk` 送 u8 的後果**：讀進來的是零擴展的一個 byte，存進紀錄時上半部被遮罩成 0，
  所以 client 看到的數值 = `value & 0xff`。**超過 255 的能力值送這一包會被 client 自己砍掉**
  （`protocol/stat.ts` 因此直接拒絕 >255 的值，而不是靜默截斷）。
- `mapId` 與 `unknown101` **不在這 19 個 bit 裡**：它們只在 `CharacterData`（`0x16`／`0x02`）裡旅行。
- 19 個 bit 用完就沒了：旗標字最大是 `0x7FFFF`。

**client 收到之後做什麼**（`sub_55BEB0` 在解碼之後的分支）：

1. 等級**沒變**而 `exp` 變大 → 顯示 `"경험치가 상승했습니다 (+%d)"`（`.c:352580`，`%d` 是新舊差）。
2. 等級**變大** → 播 `Effect/BasicEff.img/LevelUp` 並顯示 `"레벨이 올랐습니다 (+%d)"`。
   也就是**升級是伺服器決定的，client 只負責慶祝**。（client 自己也有一支「就地升級」routine
   `sub_4C71C0`：扣掉 `dword_5C2138[level]`、等級 +1、還活著就把 HP／MP 補滿、再重算傷害範圍。
   這支在 .c 裡找不到呼叫端，而 `0x0D` 的升級分支才是伺服器驅動的那條路；它的**表**才是重點，見 §4.21.3。）
3. `sub_55AA80` 重畫地圖／UI 單例，條列才會跟著動。它與 `0x0D` 的 panel 區塊（§4.21.2）都會碰到
   client 的另一顆亂數 `dword_5D2C20`：**只有第一次**（`byte_5D2C04` 這個 MSVC 延遲初始化守衛）
   才用真的 `rand()` 播種（`.c:351390`、`.c:206013`），之後只是抽號碼。`0x2C` 的 bit 0 用的是同一顆
   —— 所以「client 算出來的傷害」並不只由 `0x16` 的三個場地種子決定。

**`ack` 這個 byte 的意思**：非 0 會把 client 的「有一個場地請求還沒被回」閘門清掉（`CWvsApp+24 = 0`）
並重打時間戳（`+28`）。那是 `CField::SendInteract` 送出前自己設起來的同一個欄位
（`n3000[6] = 1; n3000[7] = timeGetTime()`），也是 `0x0B` 的 `result` 與 `0x11` 的同一個慣用法。
只有「零／非零」被比較。本伺服器送 0（這一包不是任何請求的回覆）。

#### 4.21.2 `panelFlags`：能力面板／buff 區塊（**未解，伺服器一律送 0**）

`sub_55BEB0` 讀完差異後無條件呼叫 `sub_4C5DC0(CWvsApp+112, packet, *(u32*)(n3000_0+80), 紀錄副本)`，
所以 `u32 panelFlags` **一定在線上**（沒有「長度不足就跳過」這回事 —— 少送會讓 client 丟
`ZException(38)`）。`sub_4C5DC0` 的前幾行就是全部的關鍵：

```
u32 panelFlags            // sub_45DCC0；== 0 → 立刻 return 0（不再讀任何 byte）
u32 unknownId             // 呼叫端的第 4 個參數指向紀錄副本，這個 u32 寫進副本的 +0（= id 欄位）
// 每個 set bit（0x01…0x800，共 12 個）各一個 u16（sub_45DC80，有號讀取）
//   每筆 u16 存成兩對「(rand, value ^ rand)」：第一對是值，第二對是 stamp = a3 + panelFlags
// bit 0x800 另外動到 client 的全域傷害亂數 dword_5D2C20（第一次進來時用 rand() 播種，
//   然後存一個 Random() 取樣）—— 與 0x2C 的 bit 0 是同一顆（§4.20）
return a3 + panelFlags     // 非 0 時呼叫端會再讀一筆 buff（sub_4CBBD0：u8 + u32，buff 圖示與時間）
```

- `panelFlags == 0` 就是「這裡沒有東西」：`sub_4C5DC0` **立刻 return 0**，`sub_55BEB0` 也因為回傳值
  是 0 而跳過 buff 區塊 —— 所以伺服器只要送一個 `u32 0`，封包就到這裡為止。
- 12 個 bit 的**語意**（哪個 bit 是哪一項、那第二對 stamp 要 client 拿來幹嘛）沒有字串、沒有
  呼叫端證據；`a3` 是呼叫端給的一個 stamp（`*(u32*)(n3000_0+80)`，身份未定）。
  **沒有欄位語意就不送**（非 0 會逼我們發明 12 個 u16 的內容），所以 `stat.ts` 只寫 0，
  `readStatUpdate` 遇到非 0 直接拒絕而不是猜。
- `0x0F`（`sub_55C090`）走的是**同一支** `sub_4C5DC0`（`u8 flag`；`flag != 0` 再讀 `u8 mode`，
  `mode == 0` 時才呼叫它）——所以 §6 第 6 項（能力面板第二種更新格式）仍然 OPEN。

#### 4.21.3 經驗值表是**算出來的**，不是資料（`sub_4C7110`／`sub_4C7190`）

2003 client 沒有經驗值表檔：它在啟動時用公式填出 `dword_5C2138[]`（`.data` 裡是 `dd ?`，
所以**在檔案裡掃 15/34/57/92… 一定掃不到**；`sub_4C7100` 這支 thunk 掛在 `.data:005AD228`
的函式指標表上）：

```
n = 1..5      f(n) = n * (n * n / 2 + 15)          // 整數除法
n = 6..50     f(n) = q * (q + 19)，q = n * n / 3    // 整數除法
n = 51..200   f(n) = trunc(f(n - 1) * 1.0548)      // fild / fmul 1.0548 / _ftol
```

`sub_4C7190(n)` 是存取器：`n > 200` 回 `0x7FFFFFFF`，`n < 1` 夾到 1（`sub_4C71C0` 自己也是這樣夾）。

**`f(n)` 就是「從 `n` 升到 `n + 1` 所需經驗值」**——這句話的依據是 `sub_4C71C0`（`.c:206798`，client 自己的
「就地升級」routine，**全 binary 唯一的定義、沒有任何呼叫端 ⇒ 這一版的 client 不會自己升級**）：

```c
if (level >= 200) { level = 200; exp = min(exp, dword_5C2458 - 1); return 0; }
if (exp < dword_5C2138[level]) return 0;
exp -= dword_5C2138[level];
level += 1;
if (exp >= dword_5C2138[level]) exp = dword_5C2138[level] - 1;   // 卡在「差一點升級」
sub_4C7450(record, slot, 0x2800, 1);          // 重算傷害範圍（武器 atk 表 dword_5BB344）
if (hp > 0) { hp = maxHp; mp = maxMp; }       // 活著才補滿
return 1;                                     // 一次一級
```

**它沒有動 `maxHp`／`maxMp`／`ap`／`sp`**：呼叫的 `sub_4C7450` 是傷害範圍計算（讀
`record+386` 那個裝備 map 裡的武器 `1000001`，配 `dword_5BB344` 的熟練度表與 `rand()`），不是成長表。
所以「升級加多少」在原伺服器上，**binary 裡沒有答案**（§4.21.6 第 3 項）。

**這些數字就是真正的 2003 表**：`f(1..20)` = 15, 34, 57, 92, 135, 372, 560, 840, 1242, 1716, 2360,
3216, 4200, 5460, 7050, 8840, 11040, 13716, 16680, 20216，與公開的 2003 經驗值表相同；把 200 個值
全部與 fan site 的複本比對，**196 個完全相同**，四個不同的（59／144／162／198）都是單筆打字錯誤，
而且**前後兩級都跟我們的值一致**（例：198 用我們的 1906588648 才會乘出表上的 199 = 2011069705）。
社群反推的高等級公式 `49269.68724 * e^(0.053351115 * level)` 也給了同一個倍率
（`e^0.053351115` = 1.05480）。

#### 4.21.4 伺服器這一側：`protocol/stat.ts` 與 `game/exp.ts`

- `protocol/stat.ts`：`STAT_OPCODE`、`STAT_DIFF_FIELDS`（19 筆，旗標＝`1 << 索引`）、
  `encodeStatUpdate`／`readStatUpdate`／`describeStatUpdate`，以及 `diffStats(舊紀錄, 新紀錄)`
  —— 伺服器只要留著送出去的紀錄，改動之後就能得到「最小的一包」。
- `game/exp.ts`：`expToNextLevel`（照 §4.21.3 的公式，含 51 級以上的倍率鏈）與
  `awardExp(紀錄, 量)`：加經驗值、必要時連續升級、**升級且還活著就把 HP／MP 補滿**（這是 client
  自己那支 routine 的行為，不是我們的猜測），並回報「有沒有變／升了幾級」。
- `net/loginserver.ts`：`applyAttack` 確認怪物死亡後，先 `awardKillExp`（送 `0x0D`），再
  `spawnDrops`。經驗值量是**怪物自己的 `info.exp`**（`MobTemplate.exp`），門檻是 client 自己的表。

#### 4.21.5 測試

- `test/stat.test.ts`（10）：手寫的 golden bytes 逐 byte 對齊三個「不一致寬度」、19 個 bit 的順序、
  拒絕超界值（含 `str = 256` 與 `sp = 0x8000`）、`panelFlags != 0` 直接拒絕、
  `diffStats` 只回報有變的欄位、以及「差異包的欄位集合 = `CharacterStats` 減掉 5 個」的反漂移檢查。
- `test/exp.test.ts`（10）：公開表的 golden 值（1–30／50／51／52／100／150／190–200）、單調遞增、
  `n > 200` → `0x7FFFFFFF`、一次多級、補血與「死掉不補」、`maxLevel` 上限。
- `test/serve.test.ts`：殺怪 → `take(1)` 收到 `0x0D`（純 exp 的形狀），以及「hp 20/50、mp 5/30、
  20 exp 的怪」→ `{ level: 2, exp: 15, hp: 50, mp: 30 }` 的完整差異。
- **真 `Data.wz` 實跑**（`GameEntryServer` + `mapDataProvider` + `mobTemplateProvider`，地圖
  `40000` 달팽이사냥터，假 client 從真 socket 送 `0x0F`）：進場 65 包（`0x16` ＋ 63 隻怪 ＋ 1 個 NPC）
  標頭全對；殺五隻 달팽이（`100100`，`info.exp` = 3）後收到的差異包依序是

  ```
  kill 1..4:  0d 00 | 00 00 01 00 | 03 00 00 00 | 00 00 00 00      // ack=0, flags=0x10000, exp=3/6/9/12
  kill 5:     0d 00 | 10 00 01 00 | 02 | 00 00 00 00 | 00 00 00 00 // flags=0x00010010: level=2 (u8) + exp=0
  ```

  也就是**第十五點經驗值讓 client 自己看到升級**（`f(1)` = 15，§4.21.3），HP／MP 沒有出現在差異裡
  （本來就是滿的 50/50，所以升級補血不改變任何欄位 —— `diffStats` 只送真的有變的）。

#### 4.21.6 還不能宣稱的部分

1. **`panelFlags != 0` 的區塊**（12 個 bit，每個一個 u16 ＋ 那個 stamp ＋ buff）沒有欄位語意，
   本伺服器一律送 0（§4.21.2）。也就是**能力面板（S 鍵那個視窗）與 buff 圖示還不會被伺服器驅動**。
2. **client 的 메소（錢）不在這 19 個 bit 裡**：所以撿到錢時畫面上唯一會動的仍然是 `0x11` 那行字
   （§4.18.8 第 2 項的結論不變，但現在可以確定「不是這一包漏送」）。
3. **升級的 `maxHp`／`maxMp`／`ap`／`sp` 成長量不在 binary 裡**：那是原伺服器的數字。目前升級只送
   `level`／`exp`／（滿血）`hp`／`mp`，角色的最大值維持不變 —— 這是**已知且刻意的缺口**。
4. **沒有實機驗證**（ADR-004）：HP 條／經驗條會不會照著動、升級特效會不會播，全部由反編譯碼推導。
5. `fame`／`unknown26` 這種「線上 4 byte、記憶體 1–2 byte」的欄位，只知道寬度不知道用途；本伺服器
   不會主動送它們。

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
3. **攻擊家族已全部解出**（`0x0F`／`0x10`／`0x11`，§4.13.1＋§4.13.1b），三支共用一個 codec，並且已經接上
   怪物的 HP（§4.17：`0x34`／`0x30`／`0x31`，伺服器把 client 報的傷害記在帳上）。
   還缺的是**真實流量驗證**（§6 第 2 項）與 `0x10` 的 `u16 v138`。
4. **CField 其餘區間**（分派已拆到函式，見 §4.12）：`0x1A` 的 sub-opcode 表（目前只有 9／10／18／34）、
   CUserPool 的 `0x1E–0x29` 分支、`0x35`（動畫區塊）的用途（`0x2F` 進場、`0x33` 移動、`0x30`／`0x31`／
   `0x34` 的離場／收屍／受擊都已完成，§4.15／§4.16／§4.17）、
   `0x49–0x4C`（對話框／商店）、`0x4D–0x52`（messenger／miniroom）。
   （CRewardPool 的 `0x42–0x45` **已完成**：只有 `0x43`／`0x44` 有 handler，見 §4.18；
   CNpcPool 的 `0x39`／`0x3A`／`0x3B` **已完成**，`0x38`／`0x41` 與 `0x3D` 的欄位仍 OPEN，見 §4.19；
   `CWvsApp` 層的 `0x0D` 能力值差異包 **已完成**，見 §4.21。）
5. **進地圖之後還缺的東西** ✅ 進場、移動、打怪與掉寶的閉環都已完成：`0x16` → `0x2F`（§4.15）→
   每段一個 `0x33`（§4.16，含腳踏點幾何）→ 命中／死亡／重生（§4.17：`0x34`／`0x30`／`0x31`，
   含 `dieMs` 與重生計時）→ 掉落物與拾取（§4.18：`0x43`／`0x44`／`0x0B`／`0x11`）。
   **經驗值與升級也接上了**（§4.21：殺怪送 `0x0D` 能力值差異包，門檻是 client 自己的公式）。
   剩下的是 NPC 的 `0x3D`（會走動的 NPC）與對話框／商店。
   怪物 AI **不在伺服器上**（§4.20：它在 client 裡，伺服器只收到 `0x2C` 的回報），
   所以 ROADMAP 的「怪物 AI」屬於 Phase 3/4 的 client，而不是伺服器。
   `0x2F` 那兩個只被查表的 `u16`（§4.12.1）仍是 OPEN，但目前送 0 走的是 client 自己會處理的
   「查表失敗」路徑，所以不擋這條路。
6. **`0x12`／`0x11` 的少數分支**：`0x11` 的 type ≠ 0/1 分支（已解＝背包滿的訊息，§4.18.5）、
   `0x12` 的 type 4 之後，
   以及 `0x0F`／`0x0D` 的 `sub_4C5DC0` 到底讀了哪些欄位（能力面板／buff 區塊的第二種更新格式；
   `panelFlags = 0` 時它直接 return，所以本伺服器送 0 就安全 —— 見 §4.21.2）。
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
11. **`0x0D` 解出之後剩下的三個洞**（§4.21.6）：`panelFlags != 0` 的能力面板／buff 區塊（沒有欄位
   語意，伺服器一律送 0）、**升級的成長量**（`maxHp`／`maxMp`／`ap`／`sp` 加多少是原伺服器的表，
   client 裡沒有，所以目前不送 —— ADR-009）、以及**「被怪物打 → 扣玩家的血」還沒有驅動者**
   （`0x2C` 只是 client 的回報，伺服器只讀不回應）。
12. **`mesos` 在 client 角色紀錄裡的位移**：§4.21 證明 `0x0D` 的 19 個 bit 裡沒有錢，所以撿到錢時
   畫面上的錢包不會動。要找的是 `CWvsApp+36` 那份紀錄裡錢的欄位（`CharacterData` 的旗標表是起點）。

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
| `node server/src/cli.ts wz <images|census|maps|dump|png>` | WZ 的產品端入口（ADR-005）：目錄樹、值層、canvas 普查、地圖 metadata、單張 dump、像素→PNG；與上面兩個 Python 工具對同一組黃金值 |
| `server/src/protocol/mob.ts` | 怪物封包 codec：`0x2F` 進場（`u32 mobId`＋`u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16 ×2`＋動畫旗標區塊，§4.12.1）、`0x33` 移動（§4.16.1）、`0x30` 死亡計時／`0x31` 收屍與重生／`0x34` 怪物 MP（§4.17）；`encode`／`read`／`describe` 三件套，golden 測試在 `server/test/mob.test.ts`，`decode` 與 `cli.ts schema` 共用同一份 |
| `server/src/game/mobs.ts` | 一場地的怪物：出生點從 `life`、腳踏點折線決定巡邏範圍、每段一個 `0x33`；`Mob/<id>.img` 的 `info`（`speed`／`maxHP`／`maxMP`／`level`／`exp`）與 die 動畫長度（`dieMs`）由 `mobTemplateProvider` 快取。**怪物是伺服器驅動的**，並且有 HP：`applyDamage` → `0x34`／`0x30`，`tickPackets` 收屍與重生（§4.16／§4.17；golden 測試在 `server/test/mobs.test.ts`）|
| `server/src/game/map.ts` | 伺服器端的地圖視圖：`WzArchive.mapMetadata()` → `life`（怪物／NPC 出生點）、`portal`、`info`、腳踏點（`footholdSegments`）；`mapDataProvider(archive)` 做快取，`GameEntryServer` 用它送 `0x2F` 並驅動巡邏（§4.15／§4.16）|
| `server/src/wz/paths.ts` | 客戶端自己的 WZ 路徑（`Map/Map/%09d.img` ＝ `mapImagePath`、`foothold`／`ladderRope`／`portal`、`MapHelper.img`）；地圖載入器的函式表在 §4.11.2b，golden 測試在 `server/test/paths.test.ts` |
