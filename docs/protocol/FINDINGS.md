# 協定調查筆記（KMS 1.11, 2003）

> 規則：**每條都要有證據位址**。未證實者標 `HYPOTHESIS`，不得當規格使用。
> 證據優先序：原始 binary > IDA LST > Hex-Rays C > 實機擷取 > 外部資料。

**狀態（2026-10-16）**：登入路徑（傳輸 → 框架 → 加密 → 分派）已全數定位，實作於
`server/src/protocol/{frame,cipher,session}.ts`，並由 `node --test` 覆蓋。
尚待擷取確認者只剩「握手方向」與少數 handler 語意（§6）。

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
> 那個 u32 的語意仍 **UNKNOWN**（找不到寫入點；可能是 client key / 版本值），但伺服器會在第一時間收到它。

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
| byte | 1 byte 原樣 | `sub_4A1EA0(&buf, byte, 0)`（開包並塞入 opcode）或 `sub_431DE0(&buf, 1)` + 直接寫 | `sub_45DC40(&dst, ptr, avail)`（見下）|
| u16 / u32 | little-endian 原樣，無前綴 | `sub_431DE0(&buf, n)` 先保留 n bytes，呼叫端再直接寫入並自己把長度 +n | handler 內直接 `*(_DWORD*)(ptr + cursor)`（有邊界檢查，不足就丟 `ZException` code 38）|
| 字串 | **`u16 長度` + 原始 bytes（無 NUL、無長度逃逸）** | `sub_430230(&buf, zstr)` → `sub_4303C0(dst, zstr)`：`*dst = len; memcpy(dst+1, data, len); return len + 2` | `sub_418610(&zstr, ptr, len)`（`len == -1` 時用 `strlen`）|

傳送端 API（`sub_43AD50(buf)` 才是真正的送出）：

```c
sub_4A1EA0(&buf, OPCODE, 0);   // 建立送包緩衝，第一個 byte 就是 opcode
sub_430230(&buf, zstr);        // 附加字串（u16 長度 + bytes）
sub_431DE0(&buf, 4);           // 保留 4 bytes（u32），呼叫端自行寫入後把長度 +4
sub_43AD50(this, &buf);        // 加標頭（0xD3 ^ HIWORD(sendState)）→ 加密 → 排入送出佇列
sub_45DC40(&dst, ptr, avail);  // 讀 1 byte；剩 0 bytes 時丟 ZException(38)；回傳消耗的 byte 數
```

> 讀取端的常見樣式是 `cursor += sub_45DC40(...)`（每次 1 byte），多 byte 欄位則直接記憶體存取；
> 因此「handler 讀了幾個欄位、順序如何」就是該 opcode 的欄位定義。

### 4.5 client → server opcode 目錄（抽取自 `sub_4A1EA0(&buf, N, 0)` 的所有呼叫點）

共 **39 個** opcode 會被送出（同一 opcode 可能有多個呼叫點）。已解出欄位者：

| opcode | 欄位 | 來源函式 / 類別 | 意義 |
|---|---|---|---|
| 0x01 | `u16 len id` + `u16 len pw` | `sub_4D0B20`（由 `sub_4D0000`/`CTitle` 呼叫）| **登入請求**（帳號、密碼）|
| 0x02 | `u8 worldId` | `sub_54DFC0`（`CWorldSelect`）| **選世界** |
| 0x04 | `u32 *(CWvsApp+0x14)` | `sub_43A410` | **握手回覆**（見 §2）|
| 0x08 | `u32`（原封不動回傳）| `sub_43B280` | **echo/ping 回覆**（見 §4.2）|
| 0x09 | `u32`（`*(this+300)`）| `sub_5545F0` | 世界伺服器相關請求 |
| 0x0A | `u16 len str` + `u32`，送出後 `Sleep(300)×2` 並丟 `CTerminateException` | `sub_5545F0` | **要求遷移**：等伺服器切換連線（配合 §4.2 的 0x07）|
| 0x0E | `u8 *(CStage+156)` | `sub_542C40`（`CVecCtrlUser`）| 意義未定（單 byte）|

其餘 32 個（僅列 opcode 與 builder，欄位待解）：

```
0x03,0x06,0x07 → sub_431620（通用送包 helper，CUINewChar 呼叫）   0x05 → sub_42FD30（CUINewChar）
0x0D → sub_472590                    0x0F..0x11 → sub_512F90/sub_513C80/sub_514D30
0x12 → sub_470C70                    0x13,0x26 → sub_511E20 / sub_55C5E0 ...
0x14 → sub_512700                    0x15 → sub_4A5A80/sub_4A5D00/sub_4A5F40/sub_4A6320/sub_4A65C0
0x16 → sub_4B3C80/sub_4B6B40/sub_4B6E90/sub_4B7130   0x17..0x20 → sub_55ACB0..sub_55D7B0（登入階段區）
0x22,0x27 → sub_470E10               0x23 → sub_4717D0 / sub_472910
0x24 → sub_4DDFE0/sub_4DE280/sub_4DE490(CUIMessenger)/sub_4DEAF0/sub_4E24B0
0x25 → sub_471A40/sub_481910/sub_4820E0/sub_4D31F0(CTradingRoomDlg)/sub_4D5C80/sub_4D5F50/sub_4D61F0
0x26 → sub_471CD0/sub_471E90/sub_472050/sub_4722E0   0x2C → sub_4885D0
0x2F → sub_49A3C0                    0x33 → sub_55AF20
```

> ⚠️ 兩方向的 opcode **沒有全域分區**（同一空間共用；例如 0x15/0x16/0x24–0x27 兩邊都出現）。
> 但**登入階段**看起來是成對編號：client 送 `0x01/0x02/0x03/0x05/0x06/0x07/0x09/0x0A`，
> 而 client 在該階段唯一會處理的是 `0x0B–0x13`（§4.2）。🟡 成對關係（哪個請求配哪個回應）**未證實**，
> 必須靠真實伺服器或補丁過的 client 才會知道——不可當規格使用。

## 5. 字元編碼

- 遊戲內字串（WZ）用 **ASCII / UTF-16LE + 位置遮罩**（見 `docs/WZ1_FORMAT.md` §3）。
- 網路訊息（封包）中的字串編碼**已解**：`u16 長度` + 原始 bytes，見 §4.4。
  ⚠️ 注意與 WZ 檔內的字串編碼（位置遮罩）**完全不同**，不要混用。

## 6. 待辦（依重要性）

1. **211-byte 握手的 `body`（199 bytes）要放什麼**：client 端只把它交給 `sub_418610` 存成物件，語意未定。
   已知的是「長度必須是 199、總長必須是 211」，而**我們（伺服器）先送**，所以可以用 `capture --handshake-body`
   餵不同內容、觀察原 client 的反應——這是目前最快的解法。
2. 逐區間解出欄位：先做 **0x0B–0x13（登入/選角）**——這是客戶端一連線就會走的路徑，且只有九個函式；
   再依 §4.1 的區間表往下做。每個 handler 讀取的欄位順序 = 該 opcode 的欄位定義。
3. 由 §4.1／§4.2 的對照表產生 `protocol/schema/`（opcode 常數＋欄位），並用 `capture` 對照真實流量驗證。
4. 補測試向量：把 §4.4 的欄位編碼（byte / u16 / u32 / 字串）做成 `server/src/protocol/` 的
   reader/writer 並加上單元測試——這是 schema 產生的前置工作。
5. 逐 opcode 解欄位（§4.5 目錄 + §4.1 區間表）；每個 opcode 都以「handler 讀了哪些欄位」為準。
5. `sub_43AFA0` 的 `-212` 檢查已解（= §3.1 的接收端標頭檢查），不再列為未知。

## 7. 擷取工作流（ADR-004）

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
