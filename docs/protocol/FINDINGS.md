# 協定調查筆記（KMS 1.11, 2003）

> 規則：**每條都要有證據位址**。未證實者標 `HYPOTHESIS`，不得當規格使用。
> 證據優先序：原始 binary > IDA LST > Hex-Rays C > 實機擷取 > 外部資料。

**狀態（2026-10-24 更新）**：協定主幹（傳輸 → 框架 → 加密 → 分派）已全數定位，**登入鏈
（login → world → char → game）已解到欄位層**，`CharacterData`（含**能力值 69 bytes ＋ 道具區塊
＋ `GW_ItemSlot`**）與 `CWvsApp` 層級的 `0x0B–0x13` 也已解出，實作於
`server/src/protocol/{frame,cipher,session,packet,login,chardata,itemslot,replies}.ts`，並由
`node --test` 覆蓋（含 `test/loginflow.test.ts` 的完整鏈重播、`test/itemslot.test.ts` 的逐 byte 佈局）。
**遊戲內第一條垂直切片也已解到欄位層**（§4.11：進地圖 `0x16`、別人進場 `0x1C`、離場 `0x1D`、
移動 `0x22`／`0x0E`、傳送門請求 `0x0D`），實作於 `server/src/protocol/{field,movepath}.ts`；
怪物／NPC／掉落物的分派也已拆到函式層（§4.12，欄位仍待讀）。
**社交面也開始有實作了**：場地聊天（§4.26）之外，**密語與找人**（`0x23` → `0x1A` 的 `0x09`／`0x0A`
＋收件者看到的 `0x12`）在 **§4.31**，兩者都是「場地的」封包（第一條跨地圖送達的路徑）。
Greeting parser 的欄位順序、長度計數方式與變長 seed offsets 已由 `sub_43A410` 的 C/listing 交叉確認並實作；仍未捕獲原 server 實際選用的 counted bytes／尾端資料或固定 greeting 長度（14 bytes 只是空字串時的 parser-valid 最小形式）。其餘未知為 CField 區間（`0x1E–0x2C`、CMobPool／CNpcPool／CRewardPool／對話框／messenger／miniroom）欄位（§6）。

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
- 明文 greeting：`sub_43A410` 先收 2-byte little-endian length prefix；此值計算**接在 prefix 後面的 payload bytes**，不含 prefix 自己。payload 為 `u16 version=0x00D3`、`u16 countedLength`、`countedLength` bytes、兩個 u32 seeds，可能留有未被 client parser 消費的尾端資料。`211` 是 version 數值，不是 wire length。

**C 與 listing 的交叉讀法**：倉庫 `MapleStory.exe` SHA-256 為 `f67eb6901ddd509933f78959714d16bbf9b0cbaa7870977a442bbc5896261f58`，`.lst` header 的 Input SHA256 相同。`0043A5DF` 的第一次 `recv()` 取 2 bytes；`0043A645` 把該 u16 當後續 payload 接收數量並檢查不超過 1460；關鍵的 `0043A661 mov esi, edi` 將目的指標重設至 buffer 起點，第二階段從 socket 目前位置接收該數量並覆寫 prefix。接收完成後 `0043A6C8` 才從 payload offset 0 讀 version，`0043A6F2` 從 payload offset 2 讀 counted-string 長度，`0043A717` 複製 offset 4 起的 bytes；`0043A744`／`0043A772` 依序取兩個 u32 seeds。先前只看單一 buffer offset 而把同一個 u16 認作 version 的解讀已撤回（ADR-167）。

第一個 seed 寫到 `CClientSocket+120`，作 client send state；第二個寫到 `+124`，作 client receive state。線上 seed offsets 隨 counted string 長度 `N` 變動：wire offset `6+N` 與 `10+N`。解析最小 payload 需要 12 bytes；空 counted string 時最小 wire 形式是 14 bytes。這是 parser 能接受的下限，不是原 server 固定發送 14 bytes 的證據。`sub_418610` 接受零長度並複製字串，但程式未再讀字串內容；目前不知道 server 端實際用來表示甚麼，也沒有原 server raw greeting 可確認尾端選擇。`session.ts`／`capture`／login 與 game listeners 已遷移至此 parser format；capture/default server 的空字串只是最小合成值。

**握手後的 c2s frame 另行分析**（倉庫 listing `0043A7D4–0043A844`，`sub_43A410` 尾段）：該路徑在 `CClientSocket+36 == 0` 時建 body，先寫 byte `0x04`，再附 `u32 *(CWvsApp+0x14)`，經一般 session sender 送出；就這份 EXE 的路徑而言是 **5-byte body + 4-byte session header = 9 bytes**。此證據描述 c2s frame，不是 s2c greeting 長度，也不解釋 bad-header 的根因。

**使用者先後提供的兩筆 live log**（詳 ADR-165）都收到 header `0x00D3`、body 5／wire 9 bytes：`clientSendSeed=0xc6b926dd` 時預期 `0xc66a`，`clientSendSeed=0xb8544265` 時預期 `0xb887`；兩者各自等於 `HIWORD(seed) XOR 0x00d3`。不同 expected 下實收值仍是裸 `0x00d3`；body hex 未提供，所以只確認尺寸，不能宣稱 opcode 是 `0x04` 或斷定 client state。兩筆均由 `conn:` 的 LoginServer listener 收到，第二筆明示 `stage=login`（GameEntryServer 前綴為 `game:`）。這是舊 211-byte harness 下重複出現的 state/stage mismatch；新 greeting codec 不以這兩筆舊日誌作證，且它們也不是視窗延遲根因的證據。

`sub_432FB0`（選角成功的 0x03 回包處理）在 `.text:00433196` 執行 `mov [ebx+14h], esi`，值來自伺服器在 0x03 回包裡給的角色 id（§4.11.3），所以 `[0x04][u32]` 的意義是識別剛被導向遊戲伺服器的角色，不是不透明 ticket（見 §4.8）。

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
| 種子來源 | greeting counted bytes 後的兩個 `u32`：第一個寫到 `CClientSocket+120`（send），第二個寫到 `+124`（receive） | `sub_43A410`；`sub_43AD50`／`sub_43AFA0` |
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
| 0x05 | `u16 len name` | `sub_42FD30`，由 `sub_430CD0` 的 `BtCheckId` 控制項 1001 呼叫 | **角色名檢查**（回應是 s2c 0x04；本地先經 `sub_524A00` 驗名）|
| 0x06 | `u16 len name` + `u32 ×10` | `sub_431620(1002)`，CUINewChar 的 OK 返回 1 後送出 | **建立角色**（名字 + 六項外觀 + 四顆骰子；回應是 s2c 0x05，§4.8）|
| 0x07 | `u32 characterId` | `sub_431620(1001)` | **刪除角色**（回應是 0x06，§4.8）|
| 0x08 | `u32`（原封不動回傳）| `sub_43B280` | **echo/ping 回覆**（見 §4.2）|
| 0x09 | `u32`（`*(this+300)`）| `sub_5545F0` | 世界伺服器相關請求 |
| 0x0A | `u16 len str` + `u32`，送出後 `Sleep(300)×2` 並丟 `CTerminateException` | `sub_5545F0` | **要求遷移**：等伺服器切換連線（配合 §4.2 的 0x07）|
| 0x0D | `s32 kind` + `string name` | `sub_472590`（`CField::SendInteract`）| **點擊場地物件／傳送門**（`kind = -1`），也是 GM 的 `/헉맵 <mapId>`：見 §4.11.6、§4.13 |
| 0x0E | `u8 *(CStage+156)` + `CMovePath` | `sub_542C40`（`CVecCtrlUser`）| **本機角色自己的移動**；舊註記只寫了那個 u8，因為 `CMovePath` 的來源是後來才定位的（§4.11.6）|
| 0x0F | **已完整解出（byte-exact）**：`u8 段數\|目標數<<4`、`u32 技能 id`（0 ＝ 沒有技能）、`u8 面向<<7\|動作`、`u8 速度`、每目標 11 B ＋ 段數×`u16` 傷害 | `sub_512F90` | **普通攻擊**（§4.13.1）|
| 0x10／0x11 | 同形狀；`0x10` 多一個 `u16`，兩者的高 nibble 是「有第二個物件」旗標而非計數 | `sub_513C80`／`sub_514D30` | 魔法／技能攻擊（§4.13.1b，已解）|
| 0x12 | `string` | `sub_470C70` | **一般聊天**（§4.13；顯示端與伺服器那一半見 **§4.26**）|
| 0x13 | `u32 emotion` | `sub_511E20`（case 10）| **表情**（F1..F7 → 1..7；送出前 client 已經自己套用了，見 **§4.35**）|
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

四個階段的封包如下。`CTitle`／`CWorldSelect`／選角的進場結果 `0x03` 共用 `0` = 成功並繼續解析 payload；
但 s2c `0x05` 是建立角色結果，`0` = **失敗**、非 0 才接新角色的 `CharacterData`（`sub_4329A0`）。
注意同號封包按方向分開：c2s `0x05` 是**名檢查**，s2c `0x05` 是**建立結果**。

| 階段 | client → server | server → client |
|---|---|---|
| `CTitle` | `0x01`：`string 帳號` + `string 密碼`（`sub_4D0B20`）| `0x01`：`u8 result`，成功時見下 |
| `CWorldSelect` | `0x02`：`u8 worldIndex`（`sub_54DFC0`）| `0x02`：`u8 result`，成功時 = 角色清單 |
| `CCharSelect` | `0x03`：`u32 characterId`（`sub_431620(1000)`）| `0x03`：`u8 result`，成功時 = 遊戲伺服器位址 |
| `CCharSelect` | `0x05`：`string 名字`（Check 按鈕，`sub_42FD30`）| `0x04`：`string 名字` + `s8 result`（0 = 可用）|
| `CCharSelect` | `0x06`：`string 名字` + `u32 ×10`（OK 建立，`sub_431620(1002)`）| `0x05`：`u8 result`（**0 = 失敗、非 0 = 成功**，成功時後面接新角色的 `CharacterData`）|
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
`CWvsApp+0x14`，播放 "GameIn" 音效；抵達遊戲伺服器、完成目標短 greeting 後，就用
`[0x04][characterId]` 表明身分（§2）。**導向與 c2s 身分 frame 已閉合；目標 greeting byte layout 仍待對齊。**

**`result` 值表**（`sub_4D0DB0`／`sub_54E250`／`sub_432FB0` 三個 handler 的 switch 完全相同）；
訊息欄是**從 `.rdata` 讀出來的原文**（CP949），`aAi`／`aO_2`／`aAiI_0` 只是 Hex-Rays 給字串常數取的名字：

| result | client 訊息（原文）| 意義 |
|---|---|---|
| `0`（以及 `1`、`>= 10`）| — | **成功**，解析 payload |
| `2`, `3` | 지워지거나 접속 중지된 아이디입니다. | 帳號**已被刪除**，或它的連線被中止 |
| `4` | 잘못된 패스워드입니다. | 密碼錯誤 |
| `5` | 등록되지 않은 아이디입니다. | **沒有這個帳號** |
| `6`, `8`, `9`, `0xFF` | 시스템 오류로 접속 할 수 없습니다. | 系統錯誤（client 的通用失敗訊息）|
| `7` | 현재 접속중인 아이디이거나,\r\n현재 서버점검중입니다. | **已在線上**，或伺服器維修中 |

> ⚠️ **這張表在 2026-10-16 修正過（三個意義是錯的）**：前一版只有符號名（`aAi`／`aAi_0`／`aO_2`／
> `aAiI_0`），語意是**從名字猜的** —— 於是 `2`／`3` 被記成「帳號或密碼錯誤」、`5` 被記成
> 「不能連線的帳號」、`7` 被記成「帳號停權或 IP 被封鎖」。字串一直都在 `.rdata`（常數表在
> `sub_576D6F` 附近），只是 `MapleStory.exe.c` 是 **CP949**：拿 UTF-8 的韓文去 `grep` 它一個字都
> 找不到，而「找不到」看起來就像「不存在」。用 `python3 tools/kstr.py MapleStory.exe.c <func>`，
> 或先把檔案以 CP949 decode 再搜。
>
> 修正的直接後果：**同一帳號的第二次登入要回 `7`**，而不是 `2`（`2` 說的是「這個帳號被刪了」）。
> `LoginServer` 現在對「沒有這個帳號」回 `5`、對「密碼錯」回 `4`（以前兩者都回 `2`）。
> `7` 的實作（誰在線上）列在 §6 第 15 項。

> 證據：`sub_4D0DB0` 被編譯成 `switch (result + 1)`，`sub_54E250` 直接 `switch (result)`；兩者
> 的 case 群完全對應（`0xFF↔0`、`6↔7`、`8↔9`、`9↔10`），jump table `jpt_433024` 的註解也把
> default 標成 `cases 0,1`。**`result = 1` 會走成功分支**這件事很不直覺，但兩個 handler 都是這樣。

> 建立流程的兩個方向不可混淆：c2s `0x05` 只送名字並請求可用性檢查；按下 CUINewChar 的 OK 後，
> c2s `0x06` 才送名字與十個 u32 外觀／骰子。其順序與來源**已解出**（§4.8.1a）：
> **臉、頭髮、上衣、褲子、鞋子、武器，然後四顆骰子**。伺服器把前兩個寫進新角色紀錄的
> `appearanceA`／`appearanceB`（就是 client 畫的臉與頭髮，§4.9），第 3–6 個變成**穿戴裝備**
> （§4.11.3d 的格號表），四顆骰子依序落為 STR／DEX／INT／LUK（原 newDlg 標籤與繪字座標交叉證明）。

#### 4.8.1a `0x06` 的十個 u32：順序、來源，以及伺服器能用哪幾個

送包的是 char-select 視窗的按鈕分派 `sub_431620`（`.c:57280`，case 是控制項 id）。`1002`
這條（「新角色」）會在建立 `CUINewChar` 之後組 `0x06`（`.c:57451`）：

```
sub_4A1EA0(buf, 6, nullptr)                    // opcode 6
name = 名字輸入框（CUINewChar + 476）
for (k = 0; k < 6; k++) writeU32(sub_430E40(*(CUINewChar + 496 + 8*k)))   // 六個下拉選單
for (i = 420; i < 436; i += 4) writeU32(*(CUINewChar + i))                // 四顆骰子
```

那六格**是哪六個部位**，由對話框自己的預覽刷新 `sub_430D00`（`.c:56799`）決定：控制項 id
`1002..1007` 的事件碼 600（選單變更）都走 `sub_430C90` → `sub_430D00`，而它把 `+496 + 8k` 的六個值
寫進 avatar 的**部位格**，寫的格號用 §4.11.3b 的表就讀得出語意：

| `0x06` 第 n 個 u32 | 來源 | `sub_430D00` 寫進的格 | 部位 |
|---|---|---|---|
| 1 | `+496` | `sub_424590(avatar, v, 0)` 的第 2 個參數（avatar `+8`）| **臉**（＝紀錄 `appearanceA`）|
| 2 | `+504` | `src[0]` | **頭髮**（＝紀錄 `appearanceB`）|
| 3 | `+512` | `src[5]` | 上衣／套裝（`104xxxx`／`105xxxx`）|
| 4 | `+520` | `src[6]` | 褲子（`106xxxx`）|
| 5 | `+528` | `src[7]` | 鞋子（`107xxxx`）|
| 6 | `+536` | `src[11]` | 武器（`13xxxxx`／`14xxxxx`）|
| 7–10 | `+420`..`+432` | 不進 avatar | 四顆骰子的點數 |

- **「第 1 個是臉」有第二條獨立證據**：`sub_424590`（`.c:45274`）與 `CUser` 的 `sub_508260`
  （`.c:269241`）**同形** —— 都是「兩個欄位有變才寫入，寫完把情緒歸零」（`this[2]`/`this[3]` ↔
  `this[17]`/`this[18]`，`sub_4245C0` ↔ `sub_509790`），而 `sub_508260` 的第 2 個參數就是
  `CUser+68`：情緒／動畫播放器 `sub_509070` 拿它去 `sub_408400` 找情緒節點的那個「臉」
  （§4.11.3c）。同一條路上紀錄的 `appearanceA`（`+18`）也是餵 `sub_424590`（`sub_42E2C0`）。
- **更正先前骰子順序未知的結論**：`UI/Login.img/CharSelect/newDlg` 畫布已印好
  **STR／DEX／INT／LUK**，不是要在 `.exe` 找韓文標籤字串。`sub_430690` 把 `+420`..`+432`
  依序畫在相對 y=293／313／333／353，正好對應這四行。`sub_430630` 從四個 4 開始做九次
  `rand()%4` 加一，所以總和 **25**、單顆 **4..13**；`sub_430BE0` 用 12 個更新步驅動骰動畫。
- **衣服那四個（第 3–6 個）在真機上會變成穿戴裝備**：`sub_42E2C0` 顯示「穿在身上的第 k 格 ↔ 外觀第 k 格」
  是同一套格號（§4.11.3d 的四條證據），所以上衣該進穿戴格 5、褲子 6、鞋子 7、武器 11 —— 這也是
  `sub_45F340` 從 itemId 的 part code 推出來的那組號碼。**已實作**：`wornOfLook`（`chardata.ts`）把
  `0x06` 的第 3–6 個 u32 變成穿戴裝備（每個都是 `equipSlot(itemId)`，`ruc` 0 —— WZ `info` 還沒讀），
  `createCharacter` 用 `withWorn` 併進新角色的穿戴群組，於是 `0x05`／`0x02` 的回包與 `0x1C` 的清單
  自動帶著它們（`avatarItemsOf` 讀的就是同一個穿戴 Map）。
- **骰子已落地**：第 7–10 個 u32 寫入新角色 STR／DEX／INT／LUK，拒絕總和不為 25
  或單項小於 4 的請求；不再複製帳號首位角色的 level／job／exp／map。
  HP／MP 50、起始金錢及初始地圖仍是重建伺服器政策，不能因此宣稱官方伺服器初始值已證。
- 伺服器端的落地：`createCharacter`（`server/src/net/loginserver.ts`）把第 1／2 個 u32 寫進
  `appearanceA`／`appearanceB`（兩個都是 0 時用 `lookOf` 的起始外觀：臉 `20000`、頭髮 `30000`），
  第 3–6 個進穿戴群組。

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
| 6 | u8 | `unknown26` | 不透明的 u8，夾在 `appearanceB` 與下一個 dword 間；語意未解，完整流向見下文 |
| 7 | u32 | `hair` | |
| 8 | u8 | `level` | 以下到 `unknown93` 在**客戶端記憶體**裡是混淆的 |
| 9–19 | u16 ×11 | `job, str, dex, int, luk, hp, maxHp, mp, maxMp, ap, sp` | 寬度與順序完全吻合 |
| 20 | u32 | `exp` | 記憶體 +77/+81；`0x0D` 升級訊息讀這一對 |
| 21 | u16 | `fame` | 記憶體 +85/+87 |
| 22 | u32 | `mesos` | 記憶體 +89/+93；**這一欄是錢**（§4.22.5 的三個讀取端）|
| 23 | u32 | **`mapId`** | 記憶體 +97，**不混淆**。**已證實是地圖 id**：`0x16` 把它與 `mode` 一起交給新場地物件（§4.11.2），最終 `sub_468E00` 用它載入 `Map/Map/%09d.img`（`sub_4694F0`）|
| 24 | u8 | `spawnPortalIndex` | 記憶體 +101，**一般傳送門陣列索引**（`sub_511820`，§4.43）。舊檔名 `unknown101` 仍會被讀（見下） |

- ⚠️ **本節前一版寫的「75 bytes、尾巴多 u32/u16 各一」是錯的**：那版把 `sub_45D840` 的
  *記憶體* 位移（+65/+67/+71/+75…）當成線上位移。實際上線上尾巴只有 5 個欄位
  （u32 + u16 + u32 + u32 + u8 = 15 bytes），總長 32 + 22 + 15 = **69**。讀寫兩端各自加總都
  得到 69，寫錯長度會讓後面整串錯位。
- **混淆只在記憶體裡**：client 把 `rand()` 與 `value ^ rand()` 並排存（`sub_4618B0`），線上送的是純值
  （`sub_45D2E0` 在寫出前把兩半 XOR 回來）。兩邊都不需要 RNG。
- 客戶端的**記憶體**結構是 102 bytes（`sub_55BEB0` 複製 100 bytes + 一個 word；`sub_45F5C0`
  對隊友直接 memcpy 0x66 = 102 bytes）：差額就是每個混淆配對的填充半 + 對齊尾巴。
- 讀寫兩端都逐欄位讀取且越界就丟 `ZException(38)`，所以伺服器必須把 69 bytes 全部寫滿。
- **`unknown26` 的鏈已完整釘住，但語意仍不能命名**（ADR-153）：在 `CharacterData`，`sub_45D840`
  用 `sub_45DC40` 讀 1 byte 存到 `+26`（`.lst:0045D943`），`sub_45D2E0` 從 `+26` 取 1 byte 寫回
  （`.lst:0045D37C`）；前後正是 `appearanceB @+22` 與下一個 dword `@+27`。在 `0x0D` 的 `0x04` flag，
  `sub_45E0D0` 用 `sub_45DCC0` 讀 4-byte u32，卻只把 `AL` 寫到 `+26`（`.lst:0045E187`／
  `0045E19B`）；配對的 serializer `sub_45DE00` 也只載入那個 byte，再輸出 u32（`.lst:0045DE70`）。
  **listing 沒有它的直接 call xref**，所以這一點只補充序列化器本身的欄位形狀；實際 client 接收寬度
  以有真實呼叫鏈的 `sub_45E0D0` 為準。
  所以可逆範圍只有 `0..255`；`encodeStatUpdate` 現在會拒絕會被 client 截掉的高位。整份 listing
  對 `[reg+1Ah]` 的掃描只有這四個純量讀／寫；另外四個 `lea [reg+1Ah]` 是 `GW_ItemSlot` 現金區塊
  的位址計算，不是角色欄位。外觀重建 `sub_4C5020` 讀 gender (`src+17`) 和 level (`src+31`)，不讀
  `src+26`；目前看不到把這個 byte 當作外觀、能力或規則輸入的消費端。`0x06` 新角色封包也沒有
  這個欄位；本伺服器新紀錄用 `0` 是**重建政策**，現有角色則保留其值。沒有原 server／資料樣本
  能證明它是不是 skin 或其他語意，故維持 `unknown26`，不猜名。

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
| `0x0D` | `sub_55BEB0` | **能力值差異更新**（升級／配點／HP 變化）**已完整解出 → §4.21** | `u8 ack`（非 0 → `CWvsApp+0x18/0x1C` 重設）、`u32 flags` + 差異欄位（`sub_45E0D0`，19 個 bit）、`u32 durationMs`（0 = 後面沒有東西，非0見§4.21.2）；等級變大時顯示 "레벨이 올랐습니다 (+%d)" |
| `0x0E` | `sub_55B6A0` | **`charData+382` 的 `ZMap<u32,u32>` 更新** | `u8 flag`（同上重設）、`u16 n`、`n × {u32 key, s32 value}`：`value > 0` → insert，`value <= 0` → 移除該 key（`sub_460630`）|
| `0x0F` | `sub_55C090` | **能力面板更新** | 無條件重設 `CWvsApp+0x18/0x1C`；`u8 flag`；若 flag ≠ 0 再讀 `u8 mode`，`mode == 0` → `sub_4C5DC0(CWvsApp+0x70, packet, …, 0)` |
| `0x10` | `sub_55C5E0` | **組隊（파티）系統**：見下表 | `u8 type` + 依 type 的 payload |
| `0x11` | `sub_55C130` | **獲得提示**（**已解，見 §4.18.3**）| `u8 type`：`1` → `u32` → "메소를 획득했습니다 (+%d)"；`0` → `u32 itemId`(`sub_479D30` 查名)`+ u32 count` → "아이템을 획득했습니다 (%s)"（count ≤ 1 時不印數量）；**其他值 → 2 bytes 的 "아이템을 더 이상 가질 수 없습니다"** |
| `0x12` | `sub_55C390` | **인기도（人氣）系統** | `u8 type` + `string name`（`sub_432680`）：`0` → `u8 ok`（"'%s'님은 인기도를 …"，成功／失敗兩種訊息）、`2` = "초보자는 인기도를 올리거나 내리지 못합니다."、`3` = 等級不足、`4` … |
| `0x13` | `sub_55CDE0` | **系統訊息／公告** | `u8 type` + `string text`：`0` → "[공지사항] %s"（StatusBar font5）、`1` → `sub_52BBE0(text)`（CUtilDlg1000單OK modal）；其他type仍先讀string再忽略|

`0x10` 的 type 對照（`sub_55C5E0` 的 switch，訊息字串就是語意）：

| type | 意義 | payload |
|---|---|---|
| `3` | 收到組隊邀請，跳 dialog；按「是」時 **client 送出 `0x26`**：`u8 2` + `u32`（邀請者的角色 id）| `u32`（`*(CWvsApp+36) != 0` 才會讀）+ `string` 邀請者名（§4.37.1）|
| `5` | 安靜的整份同步（沒有任何訊息）| `u32 partyId` + **102-byte 名冊**（`sub_45F5C0` 直接 memcpy，§4.37.4）|
| `6` | **建立成功**（client 自己清空名冊、把自己寫進第 0 格）| `u32 partyId`；顯示 "새로운 파티를 만들었습니다" |
| `7`, `14` | "이미 가입된 파티가 있습니다" | — |
| `8` | "초보자는 파티를 만들 수 없습니다" | — |
| `10` | 退出／被踢／解散（**兩種形狀**，§4.37.2）| `u32 partyId` + `u32 角色id` + `u8 flag`；`flag = 0`＝隊長退隊、隊伍解散（後面沒有東西）；`flag != 0` 再 `u8 kicked` + `string 名字` + 102-byte 名冊 |
| `11` | "가입한 파티가 없습니다" | — |
| `13` | 新成員加入（給全體，含加入者）| `u32 partyId` + `string 加入者名` + **102-byte 名冊**（`name` 是自己時 client 印「파티에 가입되었습니다.」）|
| `15` | "가입하려는 파티에 이미 최대 인원 수만큼의 파티원이 가입했습니다" | — |

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
u32  face               // → CUser+68：client 畫的**臉**（sub_508260 的第 2 個參數）
u32  unknownA           // 讀了就丟
u32  unknownB           // 讀了就丟
u32  itemId…            // 外觀清單，**以 u32 0 結尾**（sub_45F340，見 §4.11.3b）
s16  x
s16  y
u8   action             // → CUser+180，也是 vecctrl 初始化的第 6 個參數
u16  foothold           // → sub_485400(場地, id) 的 foothold 查表
```

- 外觀清單**不是** `GW_ItemSlot`：`sub_45F340` 只讀 u32 道具 id，並依 `itemId / 1000 / 10`
  自己歸類到外觀格（12 格的完整對照表見下面 §4.11.3b），所以「只給 id 就能畫出角色」。
- 清單讀完之後，`sub_520680` 把「第一個 u32」「外觀清單裡被 `sub_45F340` 挑出來的 `101xxxx`」
  與整條清單交給 `sub_507A20(user, 臉, 臉部裝飾, 15 格清單)` —— 它**不再讀封包**，做的是把外觀裝到
  這個 user 身上（`sub_508260`／`sub_508290`）加上名牌／血條（§4.11.3c）。
- 讀完 `x/y/action/foothold` 後，客戶端用 vtable slot 46（`+184`）呼叫
  `(vecctrl, 0, x, y, 0, 0, action, foothold)` 來建立 `CVecCtrlUser` —— 這條呼叫順序是下面
  §4.11.5 判讀移動元素欄位的關鍵證據。
- 讀到的三個 u32 不是都留著：**第一個是臉**，另外兩個讀完就丟（§4.11.3c）。

##### 4.11.3b 外觀清單怎麼變成身上的部位（`sub_45F340`）

`0x1C`（上面）與 `0x16` 的角色紀錄都會經過 `sub_45F340`：它把清單裡的每個 id 歸到**一個 15 格的
u32 陣列**（`memset(…, 0, 0x3C)` ＝ 60 bytes，只有 0–11 會被填），清單以 `u32 0` 結尾。
**歸類只看 id，不看欄位順序**（`id / 1000 / 10` 就是 7 位數 id 的 3 位前綴），所以同一個部位送幾次都一樣 ——
最後一個贏：

| 格 | id 範圍 | 部位名（照出貨 `Data.wz` 的目錄）| 對應的目錄 |
|---|---|---|---|
| 0 | `3xxxx`（5 位數）| **頭髮** | `Character/Hair/00030000.img` |
| 1 | `100xxxx` | **帽子** | `Character/Cap/01000000.img` |
| 2 | `101xxxx` | **臉部裝飾** → 被拿出來給呼叫者（見下）| `Character/Accessory/01010000.img` |
| 3 | `102xxxx` | 眼睛裝飾 | `Character/Accessory/01022000.img` |
| 4 | `103xxxx` | 耳環 | `Character/Accessory/01032000.img` |
| 5 | `104xxxx`／`105xxxx` | **上衣／套裝，同一格**（兩者只會穿一件）| `Character/Clothes/01040000.img` |
| 6 | `106xxxx` | **褲子** | `Character/Clothes/0106xxxx.img` |
| 7 | `107xxxx` | **鞋子** | `Character/Shoes/01071000.img` |
| 8 | `108xxxx` | **手套** | `Character/Glove/01082000.img` |
| 9 | `110xxxx` | （這份 Data.wz 裡沒有 `0110xxxx.img`，所以只有 id 前綴是證據）| — |
| 10 | `109xxxx` | **盾** | `Character/Shield/01092000.img` |
| 11 | `13xxxxx`／`14xxxxx`（前綴 `13x`／`14x`）| **武器** | `Character/Weapon/01302000.img` |
| — | `111xxxx` | **直接丟掉**（`case 'o'` 只 break）| — |
| — | `2xxxx`（**臉**）與其他 | **不會進這個陣列**（見下）| `Character/Face/00020000.img` |

- ⚠️ **臉（`2xxxx`）不在外觀清單的語意裡**：`2xxxx / 10000` 是 2、`2xxxx / 1000 / 10` 也是 2，
  落到 `default` 就被丟掉。所以臉是從角色紀錄的**另一組欄位**設的，不經過這張表。
- **第 2 格會被拿走**：`sub_45F340` 的第三個參數不是 null 時，`*a3 = 陣列[2]` 並把那一格清成 0
  —— 呼叫者要的是「頭上的臉部裝飾」，不是留在陣列裡給人畫。
- **三個飾品共用一個目錄**：`101xxxx`（5 張）／`102xxxx`（5 張）／`103xxxx`（3 張）全部在
  `Character/Accessory/` 底下，靠檔名開頭的 id 前綴分辨 —— 這也是為什麼「哪一格是哪個部位」
  只能從 `sub_45F340` 的 switch 讀，不能從檔案目錄推。
- **格號不是語意順序**：`109xxxx`（盾）在格 10、`110xxxx` 在格 9，兩個都比 `108xxxx`（手套）大 ——
  這是一個**畫圖用的順序**，不是「裝備欄的欄號」。所以「108 是手套」是目錄說的（
  `Character/Glove/`），「第 8 格」是這個函式說的。
- 這張表也是 §4.8 那個註記缺的工具：client 自己的部位格現在是**已知的 12 個**，而 `0x06` 那 10 個
  u32 的順序與來源也已經解出（§4.8.1a：`sub_430D00` 把對話框的六個下拉選單寫進 0／5／6／7／11 格與
  臉的那一格，`0x06` 就照同一組控制項的順序送）。

##### 4.11.3c 別人的臉與頭髮從哪裡來（`sub_507A20` → `sub_508260`／`sub_508290`）

`0x1C` 的第一個 u32、它的外觀清單，與 `CharacterData` 的 `appearanceA`／`appearanceB` 是同一件事的兩個
入口 —— 兩邊最後都寫進 `CUser` 的同幾個欄位：

| 寫入 | 值 | 從哪裡來 |
|---|---|---|
| `CUser+68` | **臉** | `0x1C` 的第一個 u32（`sub_507A20` → `sub_508260`）；`CharacterData.appearanceA`（`sub_42E2C0` → `sub_424590`）；`0x28` 的 flag bit 0（`sub_5221A0`：`this[17] = u32`）|
| `CUser+72` | 臉部裝飾（`101xxxx`）| `0x1C` 外觀清單裡被 `sub_45F340` 挑出來的那一格（同一個 `sub_508260`）|
| `CUser+76` 起 15 格 | 外觀清單（第 0 格＝頭髮）| `0x1C` 的清單（`sub_508290`）；`CharacterData.appearanceB` 進第 0 格（`sub_42E2C0`）|

證據鏈（每一段都是呼叫，不是命名猜測）：

1. `sub_520680`（`CUserRemote::Init`）讀完 `u8`（→`+64`）之後連讀**三個** u32，只留第一個，最後
   `return sub_507A20(this, 第一個 u32, 清單挑出來的 101xxxx, 15 格清單)`（`.c:293205`）。
2. `sub_507A20`（`.c:268901`）→ `sub_508260(this, 臉, 臉部裝飾)`（`.c:269148`）＋ `sub_508290(this, 清單)`。
3. `sub_508260`（`.c:269241`）：只有 `this[17]`／`this[18]` 有變才寫入，寫完 `this[43] = -1` 再
   `sub_509790(this, 0, -1)`（把表情歸零＝剛進場的靜止臉）。
4. `sub_509070`（`.c:269876`，表情／動作播放）建 avatar 時用的是
   `sub_408400(renderer, this[17], this[43], this[18], …)`，而 `sub_408400` 會拿第二個參數去
   `(a2 + 16 * (n8 + 4))` 找**情緒節點**（`sub_45D500` 讀 `"0"`..`"8"`）—— 只有 `Character/Face/*.img`
   有那些節點，所以 `+68` 是**臉 id**，不是「外觀版本鍵」。
5. 紀錄那一邊：`sub_42E2C0`（char-select 視窗的 avatar，`.c:54826`）把紀錄複製到 `v3 + 108` 之後做
   `sub_424590(avatar, *(v3 + 126), 挑出來的 101xxxx)`、`srca[0] = *(v3 + 130)`、
   `sub_424410(avatar, srca)` —— `v3+126` ＝ 紀錄 `+18` ＝ `appearanceA`（**臉**）、`v3+130` ＝ `+22`
   ＝ `appearanceB`（外觀第 0 格 ＝ **頭髮**，§4.11.3b）。`sub_424590` 與 `sub_508260` 同形（見 §4.8.1a）。
6. `0x28`（`sub_5221A0`，欄位見 §4.35.4 隔壁那一段）在 flag bit 0 時寫的是同一個 `this[17]`，所以
   「換臉」這條路徑也指著 `+68`。

伺服器端的落地：`0x1C` 的第一個 u32 ＝ 角色的 `appearanceA`，外觀清單 ＝ **頭髮（`appearanceB`）＋
穿戴中的裝備 id**（`avatarItemsOf`），兩者都由 `lookOf` 補上起始外觀（臉 `20000`、頭髮 `30000`）——
0 在那裡等於「沒有這個部位」，client 會把整顆頭畫空。`0x16` 的紀錄同理（`withDefaultLook`），
`0x0C`／`0x0D` 換外觀時也走 `sub_508260`／`sub_508290`。

#### 4.11.3d 穿戴格與外觀格是**同一套號碼**：`sub_45F340` 的 part code 表

一個角色「穿什麼」在 client 裡有兩個入口 —— `CharacterData` 的穿戴群組（`{u8 格號, 道具}`）與 `0x1C`
的 id 清單 —— 而它們用的是同一套格號，來源是 itemId 的 **part code**（`itemId / 10000`）：

| part code | 格 | 部位 | 例子 |
|---|---|---|---|
| `3xxxx`（30000–39999）| 0 | **頭髮**（只是外觀字，從來不是穿戴道具）| `30000` |
| `100` | 1 | 帽子 | `1000000` |
| `101` | 2 | 臉部裝飾 | `1010000` |
| `102` | 3 | 眼睛裝飾 | `1020000` |
| `103` | 4 | 耳環 | `1030000` |
| `104`、`105` | 5 | 上衣／套裝（**兩碼共用同一格**）| `1040001`、`1050000` |
| `106` | 6 | 褲子 | `1060001` |
| `107` | 7 | 鞋子 | `1071000` |
| `108` | 8 | 手套 | `1080000` |
| `110` | 9 | 披風 | `1100000` |
| `109` | 10 | 盾 | `1090000` |
| `13xxxxx`、`14xxxxx` | 11 | 武器（走兩條 fallback 分支，不是 switch 的 case）| `1302000` |
| `111` | — | 空的（switch 的 `case 'o'` 直接 break）| — |

四條路都指向同一組號碼：

1. `sub_45F340`（`.c:103133`）＝**唯一**讀 part code 的函式：把一列 u32 id 寫進 15 格的 avatar 陣列，
   格號就是上表（`v6 / 10000 == 3` → 格 0；`switch (v6 / 10000)` 的 `case 100`..`110`；`default` 再看
   `v6 / 100000` 是否 13／14 → 格 11）。`0x1C` 的清單就是餵它。
2. `sub_45F610`（`CharacterData::Encode`，`.c:103389`）把穿戴群組寫成 `{u8 格號, GW_ItemSlot}`，格號是
   **陣列索引 1..14**（`n14 = 1; … while (n14 <= 14)`）；`sub_45FCC0`（`Decode`，`.c:103872`）反向寫回
   `this + 8 * 格號 + 122`。兩支逐格對應，所以線路上的格號就是陣列索引。
3. `sub_42E2C0`（char-select 的 avatar，`.c:54840`）解完紀錄後用**一個線性迴圈**把兩邊接起來：
   `srca[1 + k] = worn[k].itemId`（k = 1..14：`v6` 從 `v91 + 12` 起、每圈 +8，也就是第 k 筆的指標），
   `srca[0]` ＝ 紀錄的頭髮，最後 `sub_424410(avatar, srca)`。也就是 **穿戴格 k ↔ 外觀格 k**。
4. `sub_430D00`（建立角色對話框的預覽，`.c:56827`）把六個下拉選單寫進外觀格 0／5／6／7／11
   （頭髮／上衣／褲子／鞋子／武器），而那六個 u32 就是 `0x06` 送出的順序（§4.8.1a）。

⇒ 伺服器要知道「上衣放第 5 格」不必猜：**那就是 client 自己會放的那一格**。

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
- `0x1A`（server → client）是**使用者訊息**家族：`sub_472910` 先讀 u8 再 `switch (值 - 9)`（跳表，
  範圍 9..34，只有四個 case）；字串已解出：`'%s'님을 찾지 못했습니다`（找不到人）、
  `'%s'님의 현재 위치는 '%s'입니다`（回報位置）、`'%s'님께 귓속말을 전달했습니다.`（密語已送達）、
  `'%s'님은 현재 귓속말이 거부되어 있습니다.`（對方拒收密語）、`/헉맵 %d`。
  **四個 case 的讀取形狀與「哪一個是聊天」見 §4.26** —— 其中 sub-op `0x12` 是**一般聊天**，
  也就是玩家說的話怎麼傳給同一張圖的其他人。

#### 4.11.7 `CUserPool` 其餘分支的現況（尚未解完）

| opcode | 分支 | 目前已知 |
|---|---|---|
| 0x1E／0x20 | `sub_51D530` | 只讀 u32 查表，**沒有** payload 處理（0x1F 才有：`sub_50B320`＝**公開聊天log＋氣泡**，ADR-059已接、未測試，見§4.35.5）|
| 0x21／0x2A | `sub_51D590` | 讀 u32 查表後 `default` → 沒有分支 |
| 0x23／0x24／0x25 | `sub_5209C0` → `sub_520F20`／`sub_521400`／`sub_521AD0` | **已解（本回合），見 §4.11.7b**：`sub_51D590` 先讀 `u32 characterId` 並在 `CUserPool` 查（查不到整包丟掉），本體＝`u8 (hits\|筆數<<4)`＋`u8 技能等級`＋〔`u32 技能 id`〕＋`u8 面向\|動作`＋`u8 速度`＋`u8 afterimage`＋`u32`，然後每筆 `u32 mobId`＋`u8 動畫`＋`hits × u16 傷害`——**別人的攻擊**（**三支都已實作轉播**，一對一見 §4.11.7c）|
| 0x26 | `nullsub_13` | 空函式 |
| 0x27 | `sub_509790` | **已解，見 §4.35**：`u32 characterId` ＋ `u32 emotion`（0..8）→ `CUser::SetFace`；同一格就是 c2s `0x13` 的送出端|
| 0x28 | `sub_5221A0` | **已解，見 §4.11.8**：`u32 flags` →〔bit 0：`u32`（存起來當第一格）〕〔bit 4：`u32`（跳過）〕〔bit 8：`u32`（跳過）〕→ `u8`：非 0 就 `sub_45F340(packet, src[15])` 讀 **id 清單**成 15 格，0 就 `src = *(this + 19)`（這個人自己那一份）→ `sub_508260(this, …)` → **`sub_508290(this, src)`**（＝安裝 look 區，也就是 §4.11.7c 說的那條「觀察者怎麼知道那個人的武器」的路）|
| 0x29 | `sub_522300` | **已解，見 §4.27**：`u32 characterId`（由 `sub_51D590` 讀並在池裡查）＋ `u8 effect`；0 = 在那個人身上播 `Effect/BasicEff.img/LevelUp` + `LevelUp` 音效（升級），1 後面還有一個 `u32`（未解）|

> `0x15`／`0x17`（CStage 基底）沒有分支；`0x18`、`0x19`、`0x1A` 由 `sub_472770` 自己處理（0x19 見上）。

#### 4.11.7b ✅ s2c `0x23`／`0x24`／`0x25` ＝**別人的一次攻擊**（`sub_5209C0` 讀完）

`sub_51D590` 對這三個 opcode 是同一個 case（`'#'`／`'$'`／`'%'`，`sub_519xxx` 之前先做掉開頭那個 `u32`）：

- 開頭 `u32 characterId`，用 `sub_51CD30` 在 `CUserPool` 查（雜湊：桶陣列在 `this+4`、桶數 `this+5`、
  `__ROR4__(id, 5) % 桶數`、鏈結在 `+1`、鍵在 `+2`、回傳 `*(entry[4] + 16)`）。**查不到就整包丟掉**——
  這也是這個家族可以安全廣播的原因（跟 `0x27`／`0x29` 同一條規則）。
- 找到人之後交給 `sub_5209C0(user, opcode, packet)`，再由 opcode 選套用函式：
  `0x23`→`sub_520F20`、`0x24`→`sub_521400`、`0x25`→`sub_521AD0`。

**本體**（`sub_5209C0`，線上順序＝讀取順序；`sub_45DC40` = `u8`、`sub_45DCC0` = `u32`）：

| # | 寬度 | 欄位 | 證據 |
|---|---|---|---|
| 1 | `u8` | 低 4 bits `hits`（每隻怪幾個傷害數字）／高 4 bits 目標筆數 | 與 c2s `0x0F` 同一個打包；`for (j = i; j; --j)` 每筆讀 `hits` 個 `u16` |
| 2 | `u8` | 技能等級；**非 0 才有欄位 3** | 查到節點後這個值被夾在 `1..節點子節點數`（`*(right[18]-4)`），`sub_50C460` 再拿 `*node == 1001003` 比 |
| 3 | `u32` | 技能 id（只有欄位 2 非 0 時讀） | 同上。`dword_5C2038` 那池是引擎的資料池，`Skill/` 的檔名就是 skill id（WZ 只有 `Skill/100.img`…`Skill/400.img`）|
| 4 | `u8` | bit 7 面向左、低 7 bits 動作 id | `sub_508690(user, 動作, …)` 拿它在**那個人的**動作表（`user+37`）查動作 |
| 5 | `u8` | `speed`：**跟 c2s `0x0F` 的第 4 byte 同一個值** | 收端也交給 `sub_508690` → `sub_508700`（`(n+5)/8` 乘進每格延遲，夾 0..6）；送端是 `sub_4BE8B0(*(this+38), …)`（§4.13.1c）|
| 6 | `u8` | `afterimage`：`Character/Afterimage/<武器的 info/afterImage>` 的第幾個子節點 | `sub_50DAA0` 用 `_itow(值)` 接進路徑；`user+39` 是武器那條 afterImage 字串（`sub_508290` 從武器節點填）|
| 7 | `u32` | 讀了但不給 `0x23`／`0x25` 的 handler，**只有 `0x24` 收** | `sub_521400(this, i, right, n, 動作, 面向, Valuea, bottom, 記錄陣列)` 比另外兩支多一個參數 |
| 8… | 每筆 | `u32 mobId`（**0 代表空位**，後面兩個欄位都不在）＋`u8`（動畫）＋`hits × u16`（傷害） | 本機記錄是 76 bytes（`memset(buf, 0, 0x4C)`、`buf += 19` dword）：`+0` 物件指標、`+4` 動畫、`+8..` 傷害（`int`，取低 16 bits 上線）、`+68`／`+72` x／y |

- 讀完之後還有一趟**壓縮**：每筆的第一個 `u32` 拿去 `sub_492C00(dword_5C2054 + 1, …)`（**CMobPool**）查，
  查到就把記錄那格換成池裡的物件（`out[1]`），查不到就 `memmove` 整筆刪掉（筆數 `-1`）。
  **所以「送幾筆」與「client 留下幾筆」不一定相等**，讀／寫兩端都不能假設筆數守恆。
- **收端會做什麼**（`sub_520F20`，`0x23`）：對每筆、每個傷害索引跑 `sub_513C70(user)`（當前武器的普攻動作）
  ＋`sub_50D7F0(…, 動作)` 播揮擊，再用 `sub_4882F0(monster, 動作, 基準時間 + sub_515CA0(now, 280), 記錄+4,
  面向, 傷害[i], i, 記錄+68, 記錄+72)` 把傷害數字排到那隻怪身上——**跟攻擊者自己的 client 送包前跑的是同一組函式**
  （§4.13.1）。`sub_50DAA0` 先用 `this+39`（武器節點給的攻擊範圍）與 `afterimage` 組特效路徑，
  `sub_40EDA0` 解析不到就整段跳過（連傷害數字都不會出現）。
- `sub_508690(user, 動作, speed)` 是**閘門**：`user+46 > -1`（這個人已經在攻擊中）或 `user+37` 的動作表查不到
  這個動作 → 回 0，**整包不做事**（不丟例外）。所以「送錯動作」的結果是安靜地什麼都不播。
- 三支的差異：`0x24`（`sub_521400`）用 `sub_514BA0`／`sub_4892A0`／`sub_489580`／`sub_514D00`／`sub_515C70`
  這一組（子彈型特效）並且多收欄位 7；`0x25`（`sub_521AD0`）同組但不收欄位 7。
  ⇒ 與 c2s 的 `0x0F`／`0x10`／`0x11` 一對一，**但名字是普攻／射擊／魔法**（原本寫的「魔法／技能」是錯的）：
  哪一支對哪一支、以及 `0x24` 的欄位 7 是什麼，見 **§4.11.7c**。
- **WZ 這一側**（寫實作時要用）：`Character/Afterimage/` 只有 10 張圖（`axe`／`crossBow`／`hit`／`mace`／
  `poleArm`／`spear`／`swordOL`／`swordOS`／`swordTL`／`swordTS`），武器自己的
  `Character/Weapon/0<id>.img → info/afterImage` 指名用哪一張（`01302000.img`＝검 → `swordOL`、
  `01402000.img`＝양손검 → `swordTS`、`01372000.img`＝페어리 완드 → `mace`）；每張圖都有 `0`…`10` 十一個子節點
  （`hit.img` 例外：子節點是 `sword1`／`sword2`／`mace1`／`mace2`／`maceF`／`swordF`），每個子節點底下才是
  `swingO1`／`stabO1`／`proneStab`… 的動畫。**選子節點編號的是 client 的 `sub_4BE270`（已定位，
  ADR-107 讀完，見下方 bullet）**，但 `0` 每一張都有，所以轉播送 0。
- **`sub_4BE270`＝mastery被動選擇器（ADR-107讀完，`.c:198214`）**：第一層switch只收
  `a2/100000 ∈ {13,14}`（武器道具id）的 `a2/10000%100` ∈ {30,31,32,33,37,38,40..47}；第二層：
  30/40（`n2==0`，n2＝射擊模式）→ `4BDD20(1100000)` 不中再 `4BDD20(1200000)`（**有序fallback**）、
  31/41→1100001、32/42→1200001、33→`4BE730(4200000)`、43→1300000、44→1300001、
  45（`n2==1`）→3100000、46→3200000、47→`4BE730(4100000)`；**37/38過了第一層但第二層沒有case→0**。
  我們的 `weaponMasterySkills`（client/attack-presentation.ts）與這張表逐case相符。
- **`sub_4BDD20`＝「WZ資料表先於learned紀錄」（ADR-107讀完，`.c:197928`；§4.21.6那行OPEN的loader
  機制部分結案）**：`sub_4BAC80(CSkillInfo單例, skillId)` 解析／載入該技能的WZ資料表並cache進
  global slot（`dword_5C2108`＝3100000、`5C2120`＝1100000…）——**表不在就直接回0，根本不走
  character +386 的learned hash（ROR(id,5)%nbuckets鏈）**；表在才查learned level並回
  `min(learned, maxLevel)`。mastery值＝表列（120-byte stride）的 `120*level−32`、x值＝`−28`；
  `4BDDC0`（主動技能付代價）另讀 `−48`（MP扣）、`−52`（HP扣）、`−56`/`−60`（需求道具id/數量，
  經 `sub_465710` 庫存tab計數）、`skillId/1000%10==0` 的被動直接拒付。**本Data.wz的Skill書只有
  100/110/120/130/200/300/400 七本（manifest確認）——310/320/410/420不存在**，所以弓/弩/爪的
  mastery在原版client也永遠是0：fabricated learned紀錄（3100000:20）不能無中生有。
  native-attack-effects.test 已按此改釘（公式側/表現側同為0、mode閘門改由selection表釘）。
- **伺服器端（本回合實作）**：`net/loginserver.ts` 的 `relayAttack`（原 `relaySwing`）把一次 c2s 攻擊轉播出去
  （`0x0F`→`0x23`；另外兩對見 §4.11.7c）：
  只給**同場地的其他人**（攻擊者自己的 client 在送包前已經播過同一組特效，跟 `0x27`／`0x29` 同一個理由）、
  目標只放**這場地真的收下的怪**（`applyDamage` 有回傳的），欄位 5 直接**照抄**攻擊者自己的第 4 byte。
  沒有來源的三格送中性值：`skillLevel`／`skillId` ＝ 0（沒有技能節點）、`afterimage` ＝ 0（每張圖都有 `0`）、
  欄位 7 ＝ 0（只有 `0x24` 會收）。次序是「揮擊 → 怪物反應 → 獎勵」（`applyAttack` 先收集再送）。
- **驗證**：`test/field.test.ts` 三組（golden bytes、技能 id、拒絕 `mobId 0`），`test/serve.test.ts` 的同場地
  測試多驗「先 `0x23`、再 `0x34`／`0x30`，而且攻擊者自己沒有收到」；`whisper_probe.mjs` 用真 `Data.wz` 揮一刀
  （8 個檢查：有怪可打、Alt 收到、id／動作／hits／speed／目標／中性三格、揮擊先於怪物反應、攻擊者沒有回音）。

#### 4.11.7c ✅ 三支攻擊的一對一（`0x23`↔`0x0F`、`0x24`↔`0x10`、`0x25`↔`0x11`）與 `0x24` 的投射物

§4.11.7b 把「有哪些欄位」讀完，**哪一支對哪一支**是這一節定的：把六支函式（三個 c2s sender、三個 s2c 套用函式）
各自呼叫的特效 helper 抓出來比，其中兩支是互斥的：

| | `sub_50DAA0` | `sub_5095A0` | `sub_41B630` | `sub_41B850` | `sub_514BA0` | `sub_514D00` | `sub_515C70` | `sub_4892A0` | `sub_489580` | `sub_50D7F0` | `sub_4882F0` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| c2s `0x0F` `sub_512F90` | ✓ | ✓ | | | | | | | | ✓ | ✓ |
| c2s `0x10` `sub_513C80` | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| c2s `0x11` `sub_514D30` | | ✓ | | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| s2c `0x23` `sub_520F20` | ✓ | ✓ | | | | | | | | ✓ | ✓ |
| s2c `0x24` `sub_521400` | | | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s2c `0x25` `sub_521AD0` | | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- `sub_41B630`（子彈型特效）只出現在 c2s `0x10` 與 s2c `0x24`；`sub_41B850`（魔法特效）只出現在 c2s `0x11` 與
  s2c `0x25`；`0x23` 與 `0x0F` 的呼叫集合**完全相同**。三對一因此是資料上的事實。
- **命名更正**：`0x10` 不是「魔法」而是**射擊**——它的 sender 只服務弓／弩／爪
  （`sub_4657F0(武器 id)`：`id/100000` 必須是 13／14，再回 `id/10000 %100`，只認 30–33、37、38、40–47；
  射擊家族是其中的 45／46／47），`sub_511630` 也開頭就擋掉其他武器。`0x11` 才是**魔法**：唯一的上游是
  `sub_518BF0` 對技能 `2001005`／`2101005` 走 `LABEL_53 → sub_5195D0`，而 `sub_5195D0` 就是
  `if ((*(this + 45) & 0xFFFFFFFE) != 0xA) return sub_514D30(this, right, n30);`（狀態不是那個值就走 `0x11`，
  是的話改跑 `sub_512F90` 並回 0）。⇒ `CLIENT_FIELD_OPCODE` 的 `magicAttack`（`0x10`）改名 `shootAttack`、
  `skillAttack`（`0x11`）改名 `magicAttack`；`FIELD_OPCODE` 的 `userMagicAttack`（`0x24`）改名 `userShootAttack`、
  `userSkillAttack`（`0x25`）改名 `userMagicAttack`。

**c2s `0x10` 表頭那個 `u16` ＝ 投射物的 USE 分頁格號**（`sub_511630(this, right, n30, Args)`）：

- 回傳值就是**格號**（1-based；它走分頁陣列的第 `v9` 格，`sub_465710(tab, …, 2, v9)`），**item id 走 out-param
  `Args`**——所以「把封包抄進 `0x24` 的欄位 7」是錯的：`0x24` 的收端要的是 id（見下）。找不到 pile 就回 0，
  而 caller 用 `if (… == 0) return` 表達「不要送這個包」。
- 挑 pile 的條件：`v11/1000 - 2060`（箭，`2060xxx`）、`v11/1000 - 2061`（弩箭，`2061xxx`）、
  `v11/10000 - 207`（飛鏢，`207xxxx`）三者之一必須為 0（依武器種類），而且那個 pile 的一個 `u16`
  （`+34`／`+36` 兩 byte 互 xor 解出來；「數量」是最合理的讀法）必須 ≥ `n30`（目標自己那一格蓋寫後的值）。
- c2s `0x11` 的表頭第 4 byte 是 `*(this + 38)` 原值，**沒有** `sub_4BE8B0` 的抖動（§4.13.1c 的兩個 sender 都有）。

**s2c `0x24` 的欄位 7（那個 `u32`）＝投射物的 item id（推論，見最後一點）**：

- `sub_521400(this, i, right, n, 動作, 面向, afterimage, bottom, 記錄陣列)` 多收的就是它，用處兩個：
  `v96 = bottom / 10000 != 207 ? 0 : 0x78`（飛鏢家族才把每一排往下挪 120 px），以及當 `sub_41B630` 的最後一個參數。
- **閘門不同**：`0x24` 開頭就要求 `sub_4657F0(*(this+34)) ∈ {45,46,47}`（觀察者手上這個人的武器不是弓／弩／爪就整包
  不做事），`0x25` 沒有這個檢查。⇒ 射擊轉播要在別人的畫面上動起來，**觀察者必須已經知道那個人的武器**；那條路是
  `0x1C` 的 id 清單（`sub_45F340` 歸格）→ `sub_507A20` → `sub_508290`，它把 `*(this+34) = src[11]`、`+38` 與 `+39`
  換成武器 `info` 的那兩格（速度與 afterImage 字串）——也就是這個 server 已經在送的 `0x1C`。
- `0x24` 內部的 `right[18] + 120*Value`、`sub_514BA0`、`sub_485AA0`、`sub_4892A0` 都是特效自己的事，轉播不必知道：
  欄位對，收端自己會算。欄位錯的代價很小——`sub_508690` 是閘門（動作不在那個人的動作表就整包不做事），
  而 `sub_50DAA0` 只用 `afterimage` 組路徑（每張 `Character/Afterimage/*.img` 都有子節點 `0`）。
- ⚠️ **這一格是推論**：收端把 `bottom` 當 item id 用（`/10000 == 207` 的判斷與 `sub_41B630` 的最後一個參數）
  是硬證據，但「原伺服器送的是 id，不是格號」沒有直接證據（沒有真實流量）。轉播時用 id 的理由是收端的
  判斷形狀（`207xxxx`）；送格號永遠不會命中那個分支，等於送 0。

**伺服器端（本回合實作）**：`ATTACK_RELAY_OPCODE` 一張表（`0x0F`→`0x23`、`0x10`→`0x24`、`0x11`→`0x25`；
不在表上的 opcode 不轉播）＋ `relayAttack`（原 `relaySwing`）。`0x10` 的欄位 7 用**我們自己對那個分頁格的紀錄**
查 item id（`projectileItemOf`；查不到＝0——原伺服器能回答這個問題，我們沒有那本帳時就送中性值），
其餘與 §4.11.7b 相同（只給其他人、只放這場地收下的怪、`speed` 照抄、`skillLevel`／`skillId`／`afterimage` 送 0）。

**驗證**：`test/field.test.ts`（`ATTACK_RELAY_OPCODE` 的三對＋`0x24`／`0x25` 的 golden bytes 與 `describe`）、
`test/serve.test.ts`（同場地兩人：`0x10`→觀察者收到 `0x24` 且欄位 7 ＝ 2060000、`0x11`→`0x25` 欄位 7 ＝ 0、
兩者攻擊者都沒有回音）、`whisper_probe.mjs`（真 `Data.wz`，射擊與魔法各一段）。

#### 4.11.8 ✅ s2c `0x28` ＝**某個人的外觀換了**（`sub_5221A0` 讀完）

§4.11.7 的分支表把 `0x28` 記成「flags ＋ 可選欄位 ＋ id 清單」；§4.36 的裝備路徑就是它的送出者，這一節把
每個欄位的寬度與「哪一個 bit 帶哪一個字」釘住（`sub_5221A0`，.c:294622；範圍分派器 `sub_51D590` 先讀
`u32 characterId` 並在 `CUserPool` 查，**查不到整包丟掉**，所以對一個不在場的角色送它是安全的）：

```text
u32  flags        // 每一個 bit 代表後面多一個 u32（先讀 flags，再依 bit 讀欄位）
  0x1  -> u32  臉        （→ CUser+68，`sub_508260`；與 0x1C 的第一個 u32、appearanceA 同一格，§4.11.3c）
  0x4  -> u32  （讀了丟掉，不存）
  0x8  -> u32  （讀了丟掉，不存）
u8   hasAvatar    // 非 0 ⇒ 後面是 id 清單（u32 一串、0 結尾）；0 ⇒ 不動外觀
  非 0：{ u32 itemId }* u32 0     // `sub_45F340` 依 id 前綴歸進 15 格（§4.11.3b/3d）
  0   ：memcpy(src, this + 19, 60) // 保留客戶端手上那一份 look
尾段：sub_508260(this, face, faceAccessory) ＋ sub_508290(this, src)
```

四個要點：

- **`0x28` 就是 `0x1C` 的「更新版」**：收尾那兩個呼叫與 `0x1C`（`sub_520680` → `sub_507A20`）相同，寫進的也是同幾格
  （`CUser+68` 臉、`+72` 臉部裝飾、`+76` 起的 15 格外觀），所以「別人換裝備時我看到什麼」與「我剛進場時看到他
  什麼」是同一條路（§4.11.3c）。清單裡被 `sub_45F340` 挑走的第 2 格（`101xxxx`）就是 `CUser+72`。
- **沒帶的臉不變**：`face` 的初值是 `*(this + 17)`（客戶端手上那一格），bit 0 沒設就只是把原值寫回去。⇒ 只換裝備
  的包不必帶臉，也不必知道對方的臉（本伺服器就是這樣送的）。
- **`hasAvatar = 0` 是「不要動」而不是「脫光」**：那條路是 `memcpy` 自己那一份 60 bytes。⇒ 只想換臉的包可以只帶
  `flags = 1` ＋ 一個 `u32`。
- ⚠️ **`0x4`／`0x8` 兩格本伺服器不送**：不知道內容就不編值（和 `0x1C` 的兩個 unknown 同一條規矩）。codec 讀得出來、
  也寫得出來（真封包有就照抄），但沒有呼叫者會用到它們。

**伺服器端的用法（§4.36）**：換裝備時 `flags = 0`（臉沒動）、`hasAvatar = 1`、清單 ＝ `avatarItemsOf(record)`
（頭髮＋穿戴中的裝備；`sub_45F340` 只依 id 前綴歸格，所以清單裡的順序無意義）。清單裡沒有臉部裝飾
⇒ 客戶端把 `CUser+72` 寫成 0 ＝「頭上沒有那件裝飾」，正是實際狀態；`flags = 0` 則讓它保留現在這張臉。

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
| 0x3B | `sub_49F970` | **NPC 走動 ✅ → §4.19＋§4.28**：`u8 flag` + `u32 npcId`（**順序是 flag 在前**）；`flag != 0` → `sub_49F260(npcId, packet)`（設 bit 1 後 `sub_499760(vecctrl, 1)` ＝ 開始走）、`flag == 0` → `sub_49F380(npcId)`（停）（**與怪物 0x31 同型**）|
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
  （`0x1F` 不在這一批：它是 `sub_50B320` 的氣球，形狀已定位，見 §4.35.5；`0x27` 是表情，**已實作**，
  見 §4.35。）
- ~~`sub_5209C0`（0x23／0x24／0x25）內有 76-byte 的 buff／怪物查表迴圈，還沒讀欄位。~~
  **已讀完（§4.11.7b）**：那不是 buff 查表，是「別人的攻擊」——76-byte 是每隻被打到的怪的記錄，
  中途那趟查表是 CMobPool。`0x23`（普攻）已實作成轉播；`0x24`／`0x25` 的套用函式只讀到結構。

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
| 4 | `u16`（用時 **sign-extend**）| 只拿去查表 | `movsx` 後以 `sub_489800(this_7 + 0x64, &值, &out)` 查一次；見下面「第 4／5 欄」|
| 5 | `u16`（用時 **sign-extend**）| 同上 | 同上；見下面「第 4／5 欄」|

**第 4／5 欄（ADR-149，`native-mob-sound-slots.test.ts` 10 測試／13 突變全數釘死）：**
這兩個 `u16` 是**音效組 id**，查的是**同一張全域 ZMap**（`this_7 + 0x64`，`this_7` 是音訊單例）。
全部證據取自 `.lst` 原始反組譯，因為 `.c` 在這裡有兩個會誤導的地方：

1. **那兩個 `n2 = 0`／`n2 = 1` 不是參數。** 它是 SEH 的 try-level（`var_4`），IDA 把它提成變數
   後印得像被傳進去了。`sub_489800` 是 `__thiscall`，只有 **2 個 push** ＋ `ecx`。
2. **兩個欄位都是 `u16` 讀進來、`movsx` 當 `s16` 用**（`00484FFB`／`0048506E`），
   所以 `0xFFFF` 是 **−1 不是 65535**。`.c` 一處型別成 `__int16`、另一處 `unsigned __int16`。

真正的順序也不是「讀一個用一個」：**封包先連續讀兩個 `u16`（`00484FCD`／`00484FF3`），
然後才把 A 查完、再處理 B** —— 所以壞掉的封包會在**第二次讀取**就炸，不是第一次使用時。

- `sub_489800` 回 bucket 節點，呼叫端取 `[節點 + 4]` ＝值指標；查不到時值是 **0**（不是錯誤），
  程式照走（`ebp` 在這裡是 0）。
- **只有第二個**的 `+0x20`（`[ebp+20h]`）會被取出（`v18`），而且它**同時餵給兩個** `sub_53D310`。
- `sub_53D310(obj, mob, *(template+24), v18)` 把 `*(template+24)` 存 `+72`、`v18` 存 `+73`。
- 兩支發聲器掛在 **mob + 26（`[edi+68h]`）與 mob + 27（`[edi+6Ch]`）**，由 `sub_53D290()` 建、
  `sub_48AA50` 裝上（QueryInterface 固定 IID → 放掉舊的 → 存新的）。
- 同一家族的 `sub_53D390` 有 **`rand() % 60000 + 180000`** 的 3–5 分鐘隨機 idle 計時。
- `sub_537230` 把 `this_7 + 4` 的 16 位元組複製進發聲器的 `+33` ⇒ **`this_7` 就是收聽者**；
  `sub_537260` 還把 x／y 夾在 `+132/+140` 與 `+136/+144`（視口）。
- **仍未證實的是這兩個 id「叫什麼」**：那張 ZMap 在 `.text` 裡**只有兩處讀取、沒有任何寫入**，
  所以鍵空間無法從這支 binary 還原。只說「音效組 id」，不編名字。
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
| `0x12` | 一般聊天（非 `/`、且沒有密語對象）| `sub_470C70` | `string`（`sub_430230`）；**已實作，見 §4.26** |
| `0x22` | `/헉공지 <msg>`／`/헉경고 <msg>` | `sub_470E10` 內嵌 | `u8 0`（公告）／`u8 1`（警告）+ `string` |
| `0x23` | `/귓속말 <name> <msg>`（玩家）、`/찾기 <name>`（玩家，PE `005B5FB8`）| `sub_4717D0` | 兩個 `string`；sender 自己會擋「다른 요청을 처리 중입니다」（一次只允許一個請求）。**更正**：`/헉추적` 在 `sub_470E10` 的 GM 闸門 `(*(CWvsApp+9) & 1)` 之內，不是玩家指令；`/귓속말` 用 `sub_526370` 拆兩段且兩段都非空，送出前還要求 `sub_524A00(&name, null, null) != 0`（見 §4.31 名字規則），`/찾기` 沒有這道闸門 |
| `0x25` | `/교환 <name>` | `sub_471A40` | `[u8 0][u8 1][u32 目標角色 id]`；`0x25` 是**視窗共用的請求**（七個送出者），見 §4.39／§4.40 |
| `0x26` | `/파티만들기`、`/파티탈퇴`、`/파티초대 <name>`、`/파티강퇴 <name>` | `sub_471CD0`／`sub_471E90`／`sub_472050`／`sub_4722E0`，以及 `sub_55C5E0`（§4.10 `0x10` type 3 按「是」）| 各自的 sub-code；§4.10 已證實「邀請回覆」＝`u8 2` + `u32 邀請者 id` |
| `0x27` | `/헉창조 <id>`／`/헉소멸 <n>`／`/헉경험치 <n>` | `sub_470E10` 內嵌 | `u8 0` + `u32`；`u8 1` + `u8`；`u8 2` + `u32` |
| `0x16` | 商店購買 | `sub_4B6B40` | ✅ 已讀通：row=`this[44]`∈[0,count)（列基 `this[37]`、48B/列；`this[46]`≠0 跳過）；EQUIP→1、否則「몇 개를 사시겠습니까?」上限=row[8]；itemId/10000==207→「정말로 사시겠습니까?」強制1；total=count×row[4]（i64）、現金=`(CUserLocal+89)^(+93)`（`sub_463050`），不足→「현금이 부족합니다」**不送包**；wire=`[u8 0][u16 pos=this+176][u32 itemId][u16 count]`，送後設 `+46=1`；尾巴：`this[31][11]`≠大類−1→`sub_459160(大類−1)` 翻回頁籤 |
| `0x20` | **人氣**（인기도 +／−）| `sub_55D7B0` | `u32 目標角色 id` + `u8 up`；字串「캐릭터를 찾을 수 없습니다」「잠시 후 다시 시도해 보세요」是 client 自己的前置（§4.38）|
| `0x14` | **개인정보＝雙擊玩家** | `sub_512700` | ✅ 已解（ADR-097）：`sub_4697A0` 滑鼠訊息 **515=WM_LBUTTONDBLCLK**→`sub_5122D0`→cursor `sub_49F1F0(dword_5C2050 IGObj registry)` 命中（無類型過濾）→`[u32 obj+72]`；**本版 s2c `0x14` 無消費者**（`sub_55A900` switch 只有 case 11..19）＝原版靜默；右鍵選單「개인정보」是另一個死項（n2=0，§4.39 第3塊）；舊列誤標 `sub_512570`＝實為快捷鍵 |
| `0x24` | messenger（쪽지）| `sub_4DDFE0`／`sub_4DE280`／`sub_4DE490`／`sub_4DEAF0`（CUIMessenger）| ✅ §4.41（伺服器）＋§4.41.6（視窗／瀏覽器全鏈，ADR-095）；s2c `0x4D` 同節 |

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
| 2 | `u32` | `*right`（`right == nullptr` 時 0）| **技能 id**（0 ＝ 這一擊沒有技能）：`right` 是 `sub_4BDD20(dword_5C2038, …)` 從 `CSkillInfo` 查到的 `SKILLENTRY`，而 `dword_5C2038` 就是 `CSkillInfo` 單例（`sub_4BA4B0`：`ZMap<long,ZRef<SKILLROOT>>` ＋ `ZMap<long,ZRef<SKILLENTRY>>`，`.c:194709`）；呼叫者把 `right` 交給 sender，sender 寫 `*right`（`.c:279079`）。舊名 `clickedMobId`（「游標下的物件」）沒有任何證據支持——被打的怪在目標記錄裡 |
| 3 | `u8` | `v70 = (LOBYTE(rcSrc1.left) << 7) \| (n5 & 0x7F)` | **bit 7 = 面向左**（`*(this + 45) & 1`，同一 bit 也把揮擊矩形鏡射）；低 7 bits = **動作 id** `n5 = sub_427F60(*(this + 37), right)` |
| 4 | `u8` | `rcSrc1.bottom` | `sub_4BE8B0(*(this + 38), targetId, app[86] ^ app[87])` 的結果，**夾在 0..6** ＝**揮擊速度**（§4.13.1c：同一個值下面又交給 `sub_508690`；`targetId == 4001334` 時少 1）|
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
> 差別只在「段數／目標數的打包方式」與是否多帶 `u32 targetId`（§4.5）。
> ⚠️ 舊註記寫「家族入口仍是 `sub_511E20`（opcode `0x13`）」不夠精確：`sub_511E20` 是**按鍵分派器**，
> 它在**別的 case 裡呼叫**這三支 sender，而它**自己**送出的封包是 `0x13`＝**表情**（case 10，§4.35.1）。


##### 4.13.1b `0x10`／`0x11`：同一家族、同一種目標記錄（本回合讀完）

三支 sender 的尾端寫入順序逐一比對後，**表頭順序與目標記錄完全相同**，只有兩處差異：

| | `0x0F` `sub_512F90` | `0x10` `sub_513C80` | `0x11` `sub_514D30` |
|---|---|---|---|
| byte 1 | `u8 段數 \| 目標數<<4`（`i_1` ≤ 6）| `u8 段數 \| (16 * (v129 != nullptr))` | `u8 段數 \| (16 * (v95 != nullptr))` |
| byte 2..5 | `u32 *right`（技能 id）| `u32 *right`（技能 id）| `u32 *a2`（技能 id）|
| byte 6 | `u8 面向<<7 \| 動作` | `u8 (left<<7) \| (n5 & 0x7F)` | `u8 (left<<7) \| (n8 & 0x7F)` |
| byte 7（表頭最後一個）| `u8 speed`（`sub_4BE8B0`，§4.13.1c）| `u8 speed`（`n6`）| `u8 speed`（`n6`；`v49[v93++] = n6`）|
| 目標記錄之前 | — | 多一個 `u16`：投射物的 USE 分頁**格號**（`sub_511630` 的回傳值，item id 走 `Args`；§4.11.7c）| — |
| 目標記錄 | `u32 mobId, u8 動畫, s16 x, s16 y, s16 序號, s16 × 段數` | 同左（`if (v55 != nullptr)` 內）| 同左（`if (v36 != nullptr)` 內）|
| 送出 | `sub_43AD50` | `sub_43AD50` | `sub_43AD50` |

- 座標欄仍然是 `*(_WORD *)(mob + 360)`／`*(_WORD *)(mob + 364)`（`v55 + 180`／`v55 + 182` 是同一個位置，
  以 `_WORD *` 索引），所以 §4.13.1 的 x／y 命名對三支都成立。
- **符號性（ADR-106 更正：這四個欄是 s16，不是 u16）**：`sub_514D30` 的記錄 writer 把它們全部經過
  `__int16` 區域變數（x ← `*((_WORD *)mob + 180)`、y ← `+182`、序號 ← 兩個來源之和、傷害 ← `__int16 *`
  陣列逐格，`.c` ~280766-280850）——反編譯器只在 movsx（符號擴展）時給 `__int16`，所以原生語意就是有號；
  與 `0x16` 掉落／`0x2F` 出生座標的 s16 同一慣例。讀成 u16 會把負座標地圖上的怪物變成 ~65000，
  打中判定（位置容差）永遠失敗。`readClientAttack` 因此以 `toS16` 讀這四欄。
- **所以「目標數」這個 nibble 對 `0x10`／`0x11` 其實是「有沒有第二個物件」的旗標**（只會是 0 或 1），
  而 `0x0F` 才是真的計數——server 端要按 opcode 分別解讀，不能一套套到底。
- `server/src/protocol/field.ts` 因此寫成**一個** `readClientAttack(reader, opcode)`／
  `encodeClientAttack(attack, opcode)`，差異用 `ATTACK_SHAPE` 一張表描述（`0x10` 多讀一個 `u16`），
  三個 opcode 共用同一段程式碼；`test/field.test.ts` 各有一組 golden bytes。
- `0x0F`／`0x10` 的第 4 byte 都是 `sub_4BE8B0(*(this+38), …)` 的產物，`0x11` 是 `*(this+38)` 原值（無抖動）；
  它與 `0x10` 的格號都已定位（§4.13.1c／§4.11.7c），但仍然**沒有真實流量**（§6 第 2 項）：
  `0x10`／`0x11` 的 nibble 只有 0/1 這點，應該在第一次 `capture` 到的攻擊包上核對。

##### 4.13.1c ⚠️ 更正：表頭第 4 個 byte（`sub_4BE8B0` 那個值）是**揮擊速度**，不是「還能再打幾隻」

`sub_512F90` 把 `rcSrc1.bottom = sub_4BE8B0(*(this + 38), 被點的物件 id, n3000_1[86] ^ n3000_1[87])`
寫進表頭第 4 byte（`.c:279131`），**同一個值下面幾行又交給 `sub_508690(this, 動作, 該值)`**；
而 s2c `0x23` 的收端把封包裡的同一格也交給 `sub_508690`（§4.11.7b），最後進 `sub_508700`：
`n6` 夾在 0..6，乘進每一格的延遲 `(n6 + 5) / 8`（`sub_508700` 的迴圈，`.c:269589`）。

⇒ **只有「速度」說得通**：0..6 的夾範圍正是 `sub_508700` 的上限；`*(this + 38)` 是**武器資料區**的一格，
`sub_508290` 從武器節點填進去（`*(this + 38) = src_3[8]`），而 WZ 那一側的 `info/attackSpeed` 就是這種小整數
（검 `01302000`＝2、양손검 `01402000`＝3、참마도 `01402005`＝4、위젯 비밀가방 `01322013`＝1、페어리 완드 `01372000`＝3），
「數字越小＝越快」也與 `(n+5)/8` 的方向一致。舊名 `targetCap`（把 0..6 讀成「這一擊還能再打幾隻」）
沒有任何證據支持，已在 `protocol/field.ts` 改名為 `speed`，`0x10`／`0x11` 與 s2c `0x23` 沿用同一欄位。

> 未證：`sub_4BE8B0` 的第三個參數（`app[86] ^ app[87]`）是什麼抖動，以及 `*(this+38)` 到底對應
> `info` 的哪一格（`attackSpeed` 是最合理的候選，但沒有把 `CItemInfo` 的 loader 讀完就只是推論）。
> 轉播端因此**照抄攻擊者自己的值**，不自己算。

#### 4.13.2 §4.5 那 39 個 opcode 的完整 sender 目錄

抽取方式：`grep -n "sub_4A1EA0("` 後取第二個參數（＝要送的 opcode），再用「往上找最近的函式標頭」
決定 sender。**這張表是為了不必再跑一次抽取**（同一 opcode 可能有多個 sender）。

| opcode | sender（`@`＝程式碼行號，方便回頭查）|
|---|---|
| `0x01` | `sub_4D0B20` ｜ `0x02` `sub_54DFC0` ｜ `0x03`／`0x06`／`0x07` `sub_431620` ｜ `0x04` `sub_43A410` |
| `0x05` | `sub_42FD30` ｜ `0x08` `sub_43B280` ｜ `0x09`／`0x0A` `sub_5545A0`（舊文件寫 `sub_5545F0`，已更正）|
| `0x0D` | `sub_472590` ｜ `0x0E` `sub_542C40` ｜ `0x0F` `sub_512F90` ｜ `0x10` `sub_513C80` ｜ `0x11` `sub_514D30` |
| `0x12` | `sub_470C70` ｜ `0x13` `sub_511E20` ｜ `0x14` `sub_512700`（雙擊玩家；舊誤標 `sub_512570`＝快捷鍵）|
| `0x15` | `sub_4A5A80`／`sub_4A5D00`／`sub_4A5F40`／`sub_4A6320`／`sub_4A65C0`（CQuestMan）|
| `0x16` | `sub_4B3C80`／`sub_4B6B40`／`sub_4B6E90`／`sub_4B7130`（對話框／商店）|
| `0x17`–`0x1A` | `0x17` `sub_55ACB0`（**已解，見 §4.36**：道具欄的拖放／裝備／卸下／丟棄）｜ `0x18` `sub_55B2C0(this, s16, int)`（`.text:0055B311`）｜ `0x19` `sub_55B4B0(this, s16, int)`（`.text:0055B501`）｜ `0x1A` `sub_55B0E0(this, s16, s16)`（`.text:0055B130`）—— 三支都在 CWvsApp 層，`0x18`／`0x19` 的第二個參數是 out-param（item id）|
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
目前共 **54 列**：login c2s 8、login s2c 6、field c2s 14、field s2c 26；狀態分佈`byte-exact` **31**／`partial` **19**／`skeleton` 4（§4.17 把 `0x30`／`0x31`／`0x34` 從 `partial` 推到 byte-exact，
§4.19／§4.20／§4.21 再把 NPC、`0x35`、`0x0D` 補上，§4.22 加上商店的四個封包與空的 `0x19`）。
`requestRelease`（`0x19`）是唯一一列 `byte-exact` 而**沒有欄位**的封包 —— 它的身體本來就是空的
（`test/schema.test.ts` 因此特別放行這一列）。

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
| 2 | `u8` | **stateByte** | `sub_488BC0` 結尾設 `mob+116 = -2`（0）或 `-3`（非 0）；原服送哪個值未有封包證據 |
| 3 | `u8` | **動作位元組** | bit 7 = 保持目前動畫；bit 0 = 面向；bit 1..6 = **動作索引** |
| 4 | `u32` | value | 語意未解；只有攻擊動作（10..12）會把它傳進 `sub_488E30`，走路／站立時沒人讀 → **走路送 0** |
| 5 | `CMovePath` | 路徑 | §4.11.5 的格式（`u16 originX/Y` + `u8 count` + 每個元素 14 bytes）|

**復核更正（2026-10-24）**：舊表與舊 codec 漏了 native 明確讀取的第一個 `u8 byte1`；因舊 encoder/decoder 彼此 round-trip，原本的 codec 測試沒有抓到。`sub_492380` 讀完 `mobId` 後把同一個 reader 傳給 `sub_488BC0`，後者依序讀 `byte1`、`byte2`、`u32 value`、`CMovePath`（見上方逐指令證據）。現在 `MobMove.stateByte` 在動作位元組前送出；伺服器重建採 `0`，即 client 的 `mob+116 = -2`。這個 `0` 是 server policy，並非宣稱已知原服實際值。

`readMobMove` 也讀得回來，並有獨立的 native 欄位順序 golden test（`readMobMove`／`encodeMobMove`／`describeMobMove`，`src/protocol/mob.ts`／`test/mobs.test.ts`）。

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
- `mob+112`（`mob[28]`）是**場地怪物的別針**（ADR-152）：`CMob` 建構子（`sub_484950`）先寫 `0`，
  `0x2F`（`sub_4924A0`）在**兩條分支都寫 `1`**（舊 id 重用時 `*(v9+112)=1`，新配置時 `v12[28]=1`）；
  `0x31` 的新建路徑（`sub_491630`）**不碰它**，所以那種暫時怪留 `0`。
  離場時兩條路對它**不對稱**：
  `0x30` 立刻移除（`sub_491AB0` 的 `a3==0`）會先 `v8[28]=0` 再看 controller（還在播就 `return`，所以
  別針被拔掉但怪物還留著）；`0x30` 定時（`a3!=0`，`sub_492100` 到期）**不看別針**，直接 `sub_485530` 後
  兩條分支都從池移除；`0x31` 收屍（`sub_491830`）會先 `sub_485330(mob,0)` 停掉，再 **`v6[28]==0` 才拆鏈**。
  所以別針＝「這隻是 `0x2F` 進來的場地怪，`0x31` 別想直接收走」。它的**動機**（原伺服器為何要別）仍是
  推論，需要 oracle 流量；但欄位、初值、兩條寫入與兩條讀出的順序都已釘住（`native-mob-pin.test.ts`）。
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
   只是照著播；元素一律 `vx = vy = 0`（`sub_495880` 認為路徑元素是位置快照；比對表見 §4.11.5
   的 `+6`/`+8` 必須為 0）。**ADR-107 修掉實作 bug**：walk/air 元素建構原本把 `vx:0, vy:0` 寫在
   `...point` spread 之前，被 planner 的內部取樣速度蓋掉（0x33 wire 上漏出 vx=100）；zeros 已移到
   spread 之後，`motion.points` 內部仍保留 vx/vy 供伺服器取樣，兩條路（walk＋air）一致。
4. 走到範圍端點就折返（下一段換方向）；一段最長 3 秒（長距離拆成小步，順便把封包量壓低）。
5. 速度 = `PATROL_SPEED_PX_PER_SEC`（**60 px/s，伺服器自己的選擇**）× 怪物的 `info.speed` 百分比。
   `info.speed` 是**相對值**：`sub_48D080` 讀 WZ 的 `speed` 後算 `clamp(0, speed + 100, 130)`
   （스포아 −30 → 70%、스텀프 −70 → 30%、주황버섯 0 → 100%）。**基準值沒有 binary 證據**
   （原伺服器自己選的），所以它是一個有名字、可調的常數（`--mob-speed`），不是散落的魔術數字。
6. 初始動作時間在 `FieldInstance.join` 送第一份快照前以 `Date.now()` 錨定，再加 `index*250ms`；
   不能直接拿相對時間 `0, 250, ...` 跟 epoch 時鐘比，否則第一個 tick 會把整批怪都當成逾期。

| 測試 | 內容 |
|---|---|
| `server/test/mobs.test.ts` | 腳踏點語意（item key、折線、內插、範圍外回 `undefined`）、巡邏（一個 tick 一段、到端點折返、`rx0/rx1` 裁切、速度換算、`vx/vy = 0`）、不動的怪（沒有腳踏點／`speedPercent 0`／範圍一個點）、出生點吸附到地面、`0x33` native 欄位逐 byte 與截斷、epoch 時鐘下初始 `index*250ms` stagger、動作表 |
| `server/test/serve.test.ts` | 真 socket：`0x2F` 之後真的會來 `0x33`（`mobTickMs = 20`），並驗證 `stateByte` 在 `actionByte` 前，欄位與腳踏點一致，標頭全數通過 |
| `server/test/map.test.ts` | `life` → 出生點（`rx0/rx1/cy` 的預設值）、`footholdSegments` 數量等於 foothold 數 |

#### 還不能宣稱的部分

1. `0x33` 的 `value`（`u32`）語意未解；走路送 0（沒有讀者）。
2. `mob+112` 的**動機**仍是推論（為何 `0x2F` 的場地怪要別起來不讓 `0x31` 收走，見 ADR-152），
   但欄位與流向已解：初值 0、兩條寫入（`0x2F` 的兩分支都 `1`，`0x30` 立刻的 `0`）、兩條讀出
   （`0x30` 立刻先清再看 controller，`0x31` 先停再 `==0` 才拆）。`0x34` 的 1/2/3 → 4/5 已解。
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
| 其它（-1／-2／-3，例如剛被 `0x33` 設過）| `sub_485330(mob, 1)` → 4，並打開**閃光** | `CMob::Init` 設 -1、`0x33` 由 byte1 選 -2／-3 |

為什麼這件事重要：傷害數字顯示器 `sub_487A30` 只有在 `mob+116 ∈ {-2, 4, 5}` 時才會把動作重設成
**受擊動作**：

```
if (ArgList > 0 && ArgList >= *(template + 72)     // 傷害 ≥ info.pushed
    && mob+280 == 0 && a2 == now)                  // 沒有受擊動畫在跑、且是「現在」要顯示的
  if (mob+116 ∈ {-2, 4, 5}) sub_4885D0(mob, hitAnim, facing, 0, …)      // 播 hit1
```

而 `mob+116` 的其他來源都不會停在 4／5：`CMob::Init` 設 -1、`0x33` 的尾巴依 byte1 設 -2／-3、動作設定器
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
2. **命中**（HP > 0）：送 **`0x34`**，值是怪物的**目前 MP**，不是固定的 `info.maxMP`：新怪從
   `maxMP` 開始，每次選中的怪物攻擊扣掉該筆 `conMP`；此後玩家打它只重送目前值，不會補回 MP。
   `0x34` 同時走 client 的狀態／閃光副作用，讓有待顯示傷害的怪物能彈一下（§4.17.1）。傷害數字不用送 ——
   client 已經畫完了。
3. **殺死**（HP == 0）：先送目前 MP 的 `0x34`（讓閃光進狀態），再送 **`0x30`（`delayMs = 0`）**：死亡動畫立刻開始，
   屍體留在畫面上。`dieMs` 來自 `Mob/<id>.img` 的 die 影格（§4.17.2 的表）。
4. **收屍與重生**：`dieMs` 之後送 `0x31 flag = 0`；再過 `MOB_RESPAWN_MS`（**5000 ms，伺服器自己的選擇**，
   `--mob-respawn` 可調）送 `0x31 flag != 0`（`templateId` + `0x2F` 身體），怪物回到地圖檔給的出生點、
   HP 回滿。死掉的怪**不再收到 `0x33`**（不然 client 會把屍體搬走）。
5. `MobField.tickPackets(now)` 是同一個 timer 的出口：先巡邏的 `0x33`，再收屍／重生，順序固定。

#### 4.17.5 測試

| 檔案 | 內容 |
|---|---|
| `server/test/mob.test.ts` | `0x30`（含負延遲）、`0x31` 的兩個 flag、`0x34`、`0x31 flag != 0` 的尾巴與 `0x2F` **逐 byte 相同**、`decode` 的解讀器 |
| `server/test/mobs.test.ts` | 扣血／初始 `0x34` 值／殺死時送 `0x34`＋`0x30`、死掉後不再有 `0x33`、`dieMs` 之後收屍、`respawnMs` 之後重生（回到出生點、HP／MP 回滿）、`tickPackets` 的順序、沒有 image 的怪不能被打、真 `Data.wz` 的 `dieMs`／`maxMP` |
| `server/test/native-mob-attacks.test.ts` | 怪物選招依 `conMP` 消耗 MP 並送 post-debit `0x34`；之後玩家命中仍送目前 MP（不補滿），只有重生補回 `maxMP` |
| `server/test/serve.test.ts` | 真 socket：一刀 10 點 → `0x34` → `0x30` →（40 ms 的假 `dieMs` 之後）`0x31 flag = 0`；打不存在的 id → 完全不回封包，只寫 log |

#### 4.17.6 還不能宣稱的部分

1. **「命中通知」與「MP 更新」不是二選一**：client binary 已證明 `0x34` 的 u16 存入 `mob+132`
   並與 `conMP` 比較，且同一 handler 會切 `mob+116`／打開 flash，供受擊動畫使用；所以它同時更新
   MP 並驅動狀態副作用。binary **不能**回答原 server 在怪物攻擊後是否扣 `conMP`、是否廣播那次 MP 變化、
   或攻擊者打怪時伺服器當時送的是哪個值。本伺服器的明確重建政策是：新怪以 `info.maxMP` 起始，選招後
   扣 `conMP` 並送攻擊後 MP；玩家命中只送目前 MP，不補回。`native-mob-attacks.test.ts` 釘住「用盡 MP 後再
   被打仍送 0；重生才補回容量」。原 server 的精確發包政策仍需 oracle，不能把本伺服器策略冒充原版。
2. **屍體是 client 自己收還是等 `0x31`**：`sub_485530` 只設死亡動作，沒有把怪物拆出池子；`sub_492100`
   到期時也只呼叫 `sub_491AB0(..., 1)`（=開始死亡）。本伺服器假設**要送 `0x31`**；若原 client 會自己收屍，
   多送一個 `0x31 flag = 0` 也只是查不到 id 的空操作（`sub_491830` 的 early return）。
3. **`mob+112`（§4.15 第 1 項）**：已定位為場地怪物的別針（ADR-152）——初值 0、`0x2F` 兩分支 `1`、
   `0x30` 立刻 `0`、`0x31` 要 `0` 才拆。`0x31` 建的暫時怪本來就 `0`，所以能被 `0x31` 收走；
   `0x2F` 的場地怪要先被 `0x30` 立刻清過一次（或走定時那條不看別針的路）才放手。本伺服器不主動設也不清，
   因為場地怪的生死走 `0x30` 定時那條，不靠別針。
4. **重生 5000 ms 與巡邏 60 px/s 一樣是伺服器自己的選擇**：binary 裡沒有這兩個值。
5. **沒有實機驗證**：`0x34`／`0x30`／`0x31` 送出去之後畫面長什麼樣（閃光、彈一下、倒下、重生）目前只由
   反編譯碼推導；ADR-004 的實機 run 才能確認。

### 4.18 ✅ 掉落與拾取：`0x43`／`0x44`（`CRewardPool`）＋ `0x0B`／`0x11`（`CWvsApp`）

§4.13.2 記過一件事：v1.11 的 client **沒有 ground-pickup 請求，也沒有選擇怪物戰利品的請求**。
但玩家主動丟棄並非單向：`0x17 toSlot = 0` 會把道具丟到地上，c2s `0x1F` 會丟楓幣
（§4.36／§4.18 supplement）。因此本節區分輸入與權威：client 可提出自己的 item/meso throw；server 決定
怪物掉落、掉落物場地狀態、誰能撿與何時移除，`0x43`／`0x44` 再通知 clients 呈現。此處把四個相關封包解到欄位層，
並修正 §4.6 的一個錯誤（`0x0B` 的種類位元組）。

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
| `animationStartOffset` | s16 | `sub_45DC80`（`MapleStory.exe.lst:004A8C4A`）| signed 毫秒偏移：`sub_4A88A0` 設 `entry+44 = client app clock + offset`（178063-178372）；`sub_4A7A00` 等到該時刻才推進怪物掉落動畫。kind 0 也以它為基準做 3000 ms 本機清理 guard。它不是落點、地面壽命或未使用欄位 |

- 金額圖示：`sub_4A9C10`（178753-178760）決定用哪一張錢堆圖：
  `a < 50 → 0`、`a < 100 → 1`、`a < 1000 → 2`、其餘 `3`，圖示名 = `%08d` of `9000000 + 那個值`，
  在 `Item/Special/0900.img`（四張錢堆）。
- client 建出來的紀錄是 **88 bytes**（`sub_4ABB80`，180160-180207：一次配 1476 bytes / 15 筆）：
  `+4 = kind`、`+5 = (kind == 1 || kind == 2)`、`+8 = dropId`、`+12 = money`、`+16 = value`。
  `+5` 是實際 cleanup flag，不再標成未解：kind 0 為 0，kind 1/2 為 1。`sub_4A7A00` 的 kind-0
  branch 會在動畫 state 3 或 `clientClock - entry+44 > 3000` 時本機移除；kind 1 走同一怪物動畫，
  但這個 flag 阻止上述本機 cleanup，留到 server 的 `0x44`；kind 2 建立時直接從 state 3 開始。
  kind 1 還有 `"DropItem"` 音效分支（`sub_4A7A00`，177060-177270）。因此本伺服器把 kind 1
  用於持久怪物掉落、kind 2 用於玩家丟棄；這是符合 client lifecycle 的**本專案 packet policy**，
  不是原 server 的選擇證據。
- `entry+44` 的初值是建立時的 client app clock 加 trailing signed s16；state 0 只有在目前 clock 大於
  `entry+44` 後才開始動畫（`sub_4A88A0`／`sub_4A7A00`）。故偏移正負都必須保留並套用到動畫起始時間。
  kind 0 的 3000 ms 是 client 的 transient-record fallback guard，不是 ground drop lifetime。
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

client 沒有 ground-pickup 請求；`0x17 toSlot = 0` 道具丟棄與 c2s `0x1F` 楓幣丟棄則是 client input，
經各自驗證後建立 placed entry。**怪物 loot、ground state、pickup eligibility／ownership 與 expiry** 由伺服器
權威處理（`src/net/loginserver.ts` 的 `tickField`／`pickUp`）：

1. **誰掉什麼**：`defaultDropPolicy(source, random)` —— 三個各自獨立的 repository-policy roll
   （`random.range(0, 1000)`）：600‰ 掉錢（`1 + range(0, level * 3)`）、300‰ 嘗試從
   `MOB_JUNK_ITEM_BY_TEMPLATE_ID` 取本專案指定的候選道具、50‰ 掉藥水（`POTION_BY_LEVEL` 四個等級帶）。
   名稱與 item id 在 WZ 中可解析，但 monster-to-item 配對、三種機率、金額公式與藥水等級帶**都不是
   WZ 或 EXE 恢復出的原 server 規則**（ADR-007；原 server 沒有隨 repo 提供）。
   可重跑的唯讀 archive audit 是 `bun run tools/audit-drop-evidence.ts`；它以**每張 image 獨立的
   `WeakSet`** 遍歷 1056 張 image、1,048,039 個 property entry，找到 28 張 Mob image、0 個 Mob `info`
   drop-like 欄位，且唯一符合關鍵字 `drop|loot|meso|money|expire|lifetime|chance` 的 property path
   是 sound 資源 `Sound/Game.img[0]/DropItem`；沒有相符的 string value。21 個本專案候選配對的
   Mob/item name 都能在 WZ 找到，另有 7 個 Mob template 不配對。這些結果只證明 archive 資料存在與
   關鍵字搜尋範圍內沒有表，不會把 item 名稱變成怪物掉落證據；固定測試在 `server/test/drop-wz.test.ts`。
   **玩家主動丟棄**是另外兩種 client input，不套用 monster roll：`0x17 toSlot = 0` 道具（§4.36）由
   `FieldInstance.dropItem` → `DropField.dropFromPlayer` 建成 `kind = DROP_KIND.placed`，保存 item instance；
   c2s `0x1F` 楓幣（§4.18 supplement）由 `dropMesosFromPlayer` 建成同樣無 monster block 的 kind 2。
   兩種都是放置在玩家當下位置的場地 entry，再由 server pickup policy 統一處理。
2. **掉在哪**：`x` 在怪物 ±`DROP_SPREAD_PX`（24 px）內，`y` 由 `DropLandingIndex` 依實際有向 foothold
   求地面點；這是本專案的選點政策，不是原 server 證據。
3. **存在多久**：`DROP_LIFETIME_MS`（300000 ms，本專案地面壽命政策）後 server 送 `0x44 kind 0`
   （`gone`）——怪物掉的與玩家丟的同一條路。這和 `0x43 kind 0` 的 client 本機動畫清理完全不同：
   後者在動畫 state 3 或其 3000 ms fallback 時間清理 transient entry，不能解讀成地面物品只活 3 秒。
4. **browser 呈現**：`client/drop-presentation.ts` 將 `animationStartOffset` 加到封包到達時的本機時間，
   以它起算動畫。kind 0 在 browser 的 hop 結束（或 native 3000 ms guard）後回傳 `undefined`，
   `client/main.js` 刪除記錄；kind 1 飛完後留在地上等 `0x44`；kind 2 立即放置。browser 的 420 ms hop
   是呈現政策，不是量出的原版動畫時長。
5. **誰撿到**：每個 field tick 檢查「玩家在自己的 `0x0E` 移動包裡報的位置」與每一筆掉落的距離
   （`PICKUP_RANGE_PX` 40 / 上下 `PICKUP_RANGE_Y_PX` 60）。**站在上面就是全部的觸發條件**，沒有請求、
   沒有按鍵；一次 tick 只撿一筆（這樣 client 的飛行動畫才一筆一筆演）。
   另外，只有**比這個人最後一次移動更早**就躺在那裡的掉落才撿得起來（`reachable` 的第三個參數；
   `FieldMember.lastMoveAt`，進場本身算一次移動）。兩個理由各自都足以要求這一條：怪物掉落的**落點就在
   殺牠的人腳下**（擴散 ≤ 24 px），沒有它下一 tick 就會被同一個人吸走、客戶端看不到「從屍體飛出來」；
   而玩家丟的東西**一定在自己腳下**，沒有它就會立刻被自己撿回來（等於丟不掉）。
   這是伺服器自己的選擇（ADR-007）：binary 這一半在 client，沒有流量能證明原伺服器怎麼做。
6. **撿到的三個封包（順序固定）**：`0x44 kind 2`（含角色 id）→ 道具才有的 `0x0B op 0`（放進哪一格）→
   `0x11`（訊息）；三者都送給**全場**（`0x44` 是「東西是誰拿走的」，別人的 client 要靠它收掉那張圖）。
   錢只送 `0x44` + `0x0D`（錢包是紀錄的一部分）+ `0x11`。
7. **放哪一格**：`grantItem` —— 同 id、未滿 `MAX_ITEM_STACK`（200）的堆疊優先；否則第一個空格；
   裝備與現金道具**永不堆疊**（兩件同 id 的裝備 = 兩格）。背包滿 → **不撿**，掉落留在原地（第三種
   `0x11` 存在，但每 tick 對站在上面的人印一次會變噪音）。
   建新格時如果**地面知道那件道具本身**（玩家丟的，`DropEntry.slot`），就用它當模板（`freshSlot`）：
   捲軸加過的武器撿回來還是同一件，不會變成全新的。

#### 4.18.7 測試

| 檔案 | 內容 |
|---|---|
| `server/test/drop.test.ts` | kind 0/1/2 的線路長度、persistent kind 1、signed s16 offset round-trip／範圍、server offset policy、`0x44`／`0x11`／`0x0B` codecs、落點／過期／pickup、candidate-item／等級帶政策、inventory 與玩家丟棄 |
| `server/test/drop-presentation.test.ts` | kind 0 本機 cleanup、kind 1 落地持續、kind 2 立即放置；正負 offset 的延遲／提前、邊界驗證與 pickup 動畫 |
| `server/test/drop-browser.test.ts` | 隔離 Chromium component：kind 0 animation-end cleanup 與 offset-aware native guard、kind 1 落地持續、真 WZ PNG／fh 與 pickup 呈現 |
| `server/test/drop-wz.test.ts` | `auditDropWzEvidence` per-image WZ regression（image/property counts、keyword paths、21 個可解析的政策候選、7 個未映射 Mob），以及原有 100 張地圖的 landing／PNG 回歸 |
| `server/test/serve.test.ts` | 真 socket：注入的 server RNG 經 `GameEntryServer` 到 loot policy；monster loot 發 `0x43 kind 1` 與非零 signed offset；另測完整拾取與玩家丟棄迴圈 |
| `server/test/schema.test.ts` | `0x43`／`0x44`／`0x0B`／`0x11` 目錄列都能被 `decode` 描述器認出來 |

#### 4.18.8 還不能宣稱的部分

1. **client lifecycle 已解，原 server kind policy 仍未知**：`sub_4A88A0`／`sub_4A7A00` 證明 kind 0 會在
   state 3／3000 ms fallback 本機清理、kind 1 的 client cleanup flag 使 entry 留到 `0x44`、kind 2 一開始
   就放置。這解釋了本 server 為持久怪物掉落選 kind 1；但沒有原 server 或流量，不能聲稱它當年也送 1。
   `0x44 kind 1` 的其他效果與 `kind 2` 的實際拾取動畫仍沒有原 client 執行驗證。
2. ~~client 的錢包不會動~~ → **已解決**（§4.22.5）：`+89/+93`（`CharacterData` 第 22 欄）就是錢，
   `0x0D` 的旗標 `0x40000` 就是它。拾取現在同時送 `0x11`（那行字）與 `0x0D`（錢包數字），
   `MesoWallet` 也改成同一份紀錄的視圖，不再是另一本帳。
3. **掉落表、對應、機率、金額公式、壽命、擴散與 pickup bounds 都仍是本專案政策**（ADR-007）：
   per-image WZ audit 的關鍵字搜尋沒有找到怪物掉落表；道具名稱只證明 item asset，不證明哪隻怪會掉它。
   server loot 使用獨立、可注入的 RNG；它不使用 `0x16` client seeds，也不代表原 server 的 RNG。
4. **兩種 3000/300000 時間不可混為一談**：`0x43` kind 0 的 3000 ms 是 client transient entry cleanup guard；
   本 server `DROP_LIFETIME_MS = 300000` 是 server-owned ground item policy，逾時發 `0x44 kind 0`。
   signed trailing s16 已解為 client animation-start offset（`entry+44 = appClock + offset`），不是上述地面壽命。
5. **沒有原 client 的實機執行驗證**：飛行的視覺外觀、`0x44 kind 2` 音效、`0x0B` 背包畫面仍依反編譯
   control flow、WZ 資產與 browser component tests；browser 420 ms hop 不是 native measured timing。
6. **拾取分配／隊伍歸屬仍未知**：本 server 對 kill session 執行現行 pickup policy，不代表已恢復原隊伍分配公式。

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

#### 4.19.4 `0x3B`：NPC 控制指定（已知id **6 bytes**；語意見 §4.28）

`sub_49F970`（168598-168631）：**`u8 flag` 先讀，`u32 npcId` 後讀，兩個都無條件讀**
（這點和怪物 `0x31` 的「`u8 flag` + `u32 mobId`」同型，也和 §4.12 的舊猜測相反）。

| flag | 分支 | 動作 |
|---|---|---|
| `!= 0` | `sub_49F260`（168057-168116）| 設 `+24` 的 bit 1，再 `sub_499760(vecctrl, 1)`＝**啟用控制**（§4.28.1）—— **已知 id** 就到此為止；**未知 id** 會再讀完整個 `0x39` 尾段並用 `sub_49F260` 直接建一個「控制bit已設」的 NPC |
| `== 0` | `sub_49F380`（168119-168228）| 清 bit 1，再 `sub_499760(vecctrl, 0)`＝**關閉控制**（§4.28.1）|

⚠️ **一則更正**：`sub_49F260`／`sub_49F380` 交給 `sub_499760` 的是 `*(npc + 16)` —— byte 定址，也就是
**byte 16** 那個 DWORD（一個指標）；而 4.19.2 第 6 欄（`pointX`）在 `sub_498CF0` 裡是 DWORD 索引的
`*(this + 16)` ＝ **byte 64**。兩者位址不同，早期把「byte 16 的指標」當成第 6 欄的說法**作廢**。
那個指標指向什麼（vecctrl 是最合理的讀法：它的 `+13`／`+14`／`+25` 才有 `sub_499760` 讀的欄位）仍未命名，
`+250..+260` 那組 `s16` 的來源同樣未定位（§4.28.1、§6 第 14 項）。

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
  讀出來：1056 張圖裡 **70 張 `Npc/*.img`、28 張 `Mob/*.img`**。
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
| `game/npcs.ts` | `NpcTemplate`（`templateId`／`name`／`description?`／`func?`）、`npcTemplateProvider(WzArchive)`（讀 `info/name`）、`NpcField`（`spawnAll`／`spawnPackets`／`enterPackets`／`refreshPacket`／`byId`／`present`／`walking`／`setWalking`／`remove`）、`npcWalkPolicy`（`--npc-walk` → 一個「這個模板要走嗎」的函式，§4.28.4）；一個場地只 spawn 一次，`enterPackets()` 是給**新進場玩家**的完整 body（§4.24.2）|
| `wz/props.ts` | 新的共用層：`entriesOf`／`propertyOf`／`asNumber`／`asText`／`infoOf`，`game/mobs.ts` 與 `game/map.ts` 也改成用它（同一個規則：**形狀不對的值不算值**，預設值由呼叫端給）|
| `net/loginserver.ts` | `npcTemplate?` 選項；NPC 的 `0x39` 由場地送（`FieldInstance.join`），緊接在怪物的 `0x2F` 之後、**在同一個 TCP 串流、同一組加密狀態**（`0x16` → 每個怪一個 `0x2F` → 每個 NPC 一個 `0x39` → 玩家 `0x1C`，§4.24.2）|
| `wz/paths.ts` | `npcImagePath(id)` |
| `cli.ts serve` | 有 `Data.wz` 時同時建立 `npcTemplateProvider(archive)`；`--npc-walk <none|all|id,id,...>`（裸的＝`all`，預設 `none`）|

- **id 不重用**：`NpcField.remove()` 只把項目的 `present` 設成 false，id 留在池裡。理由與怪物池相同
  ——client 也在自己的池裡留著那個 id，重用會讓 `0x3A`／`0x3B` 打到錯的對象。池是**單調遞增**的。
- `encodeNpcEnterField` 送 `0` 給第 5–7 欄（`lookupKey`／`pointX`／`pointY`）。第 5 欄的查表失敗是
  client 自己就會處理的路徑（和 §4.12.1 的 `0x2F` 那兩個 `u16` 一樣），後兩欄**沒有證據**，所以不猜。
- `describeNpcEnterField` 對已知 id 的形狀會直接說出「refresh only」；`describeFieldPacket(0x39)` 的 5-byte
  情況則兩種讀法都印（refresh／被截斷），因為**光看長度分不出來**，只有讀取器會不會丟 `ZException(38)` 知道。

#### 4.19.8 測試

| 檔案 | 內容 |
|---|---|
| `server/test/npc.test.ts` | `0x39` 的 20-byte 形狀與常數 hex、已知 id 的 5-byte 形狀、負座標的 `s16`、`0x3A`／`0x3B` 的 5／6 bytes 與欄位順序、描述器對 refresh／截斷的兩種說法、`NpcField` 的 id 從 1 起算、模板不存在就跳過（並記 log）、沒有模板來源時仍然生成、`setWalking`／`remove` 的合法性（重複 remove 不發封包、id 不重用）、`npcWalkPolicy` 的三種寫法與錯誤輸入、要走 NPC 的快照順序（§4.28.4）、`npcImagePath` 的補零與錯誤輸入 |
| `server/test/field.test.ts` | `describeFieldOpcode` 的 `0x38`（無 handler）／`0x39`–`0x41` 各一列 |
| `server/test/schema.test.ts` | 新的 5 筆目錄列（`0x39`／`0x3A`／`0x3B`／`0x3C`／`0x3D`）都要能被描述器認出來 |
| `server/test/serve.test.ts` | 真 socket：`0x16` → 兩個 `0x2F` → 一個 `0x39`（`templateId 2003`、`x 69`、`y 275`）的順序與欄位；既有的打怪／掉寶測試把 spawn 爆量從 3 改成 4；`--npc-walk` 的那一個則看 `0x39` 後面多一個 `0x3B`（§4.28.4）|

#### 4.19.9 還不能宣稱的部分

> ADR-062已更正下列歷史第2／5點：499C00是氣泡、template+8是move屬性存在、3B是controller。
> signed codecs與透明relay已接；server索引重寫與原挑controller政策仍未知，不能宣稱原NPC全還原。詳§4.28及NATIVE_NPC_BEHAVIOR。

1. **第 5–7 欄的語意**（`lookupKey`／`pointX`／`pointY`）：只知道 `sub_489800` 的查表與
   `sub_540400` 的 vecctrl 建立，**沒有名字**。目前送 0。
2. **`0x3D` 的索引差異**：ADR-062已定位info.speak、extra有序表、forced action與move旗標，並補codec／relay。
   但sender+2與receiver raw guard／speech仍不一致，原server是否重寫未知；透明轉送不是原server證據，詳§4.28。
3. **`0x38` 與 `0x41` 沒有 case**：`0x38` 夾在 `0x37`（CMobPool 最後一個）與 `0x39` 之間，
   很可能是某個已停用的 NPC 封包；`0x41` 同理。沒有字串或呼叫點能定位。
4. **NPC 的生成是伺服器決定的**：`life` 裡有 2 個 NPC 的地圖就會有 2 個，沒有「NPC 重生」這種事
   （`0x2F`／`0x30` 那一套不存在）。這一點符合 `sub_49F260` 的設計，但沒有實機驗證。
5. **第二狀態是controller**（ADR-062更正「走路開關」）：499760啟用控制與timer，靜止NPC也需它進行idle／speech。
   原server如何挑選controller仍未知；目前一NPC一控制者、離場交接是明示重建政策。
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
而且攻擊的音效／特效都打在它身上。`v47 + 216` 依 §4.11.5 的佈局正是**使用者的 vecctrl 內嵌 `CMovePath`**，
所以尾段是「我打到他的時候，他在哪裡」（§4.20.7）。`mob+104` 是另一個指標（`+112` 被當條件讀），
**兩者的身份沒有定位**，只知道其中一個是使用者（`+216` 那條路徑的就是它）。

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
| 5 | 尾段 | `if (*(mob+124 + 24) != 0) sub_495880(v47 + 216, packet, *(mob+124 + 24) == 3, v50 + 216)` | ✅ **是移動路徑區塊，不是傷害清單**（見 §4.20.7 的修正）：`sub_495620` 是 `CMovePath` 的寫出器（讀 `+4`／`+6`／`+16`／`+20`，元素 14 bytes、`s16` 延遲在 `+14`），寫出來的形狀就是 `0x0E`／`0x33` 那個路徑。本伺服器仍**原封不動保留**（不解析、不行動）|

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

#### 4.20.5 伺服器：`0x2C` 仍只有 codec；獨立出招模型是重建政策

- `protocol/mob.ts` 新增 `MOB_OPCODE.anim`（`0x35`）、`encodeMobAnim`／`readMobAnim`／`describeMobAnim`；
  動畫區塊的讀寫抽成 `writeMobChannels`／`readMobChannels`，與 `0x2F` 的尾巴**共用同一份實作**
  （測試直接比對兩者的 bytes 相同）。
- `protocol/field.ts` 新增 `CLIENT_FIELD_OPCODE.mobAttack`（`0x2C`）、`readClientMobAttack`／
  `encodeClientMobAttack`（`ClientMobAttackBody` 只收「真的寫進封包」的四個欄位，`action`／`facing`／
  `hasPosition` 由 `actionByte` 與位置自己導出）；`describeClientFieldPacket` 會印出
  `0x2c mob attack: mobId=… attack1,left flags=0x11 at (x,y) tail=nB`，所以 `serve`／`decode` 的日誌
  從這一版起就看得懂原 client 的怪物攻擊。
- **`0x2C` 仍沒有 gameplay handler**：`readClientMobAttack` 目前供 codec／decode 使用，`ClientSession`／
  `FieldInstance` 不用這個 client 報告去扣玩家 HP 或更新怪物 MP。原版怪物 AI 與「client 回報後 server
  應如何落帳」仍然是兩個不同問題；原 server 不在本 repo。
- **另有一個明示的重建出招政策**（ADR-076、`docs/NATIVE_MOB_ATTACKS.md`）：`MobField.attackPackets`
  只對已 engaged 且仍在場的玩家挑選 WZ attack，按 `conMP` 扣怪物目前 MP，再廣播 `0x33`／`0x34`；
  它不處理 `0x2C`，也不代表完整還原原 server AI。客戶端仍有自己的原版 AI；server 的巡邏／出招是本產品
  的場地模型，**不由此 ticker 對玩家 HP 做怪物攻擊傷害計算**。另一條 body-contact 路徑是獨立實作，不能
  拿來推斷原 server 對 `0x2C` 的處理。

#### 4.20.6 還不能宣稱的部分

1. **`0x2C` 的尾段**：形狀**已解**（＝`CMovePath`，`sub_495620` 是它的寫出器，來源是
   `user + 216`；見 §4.20.7），但**沒有實機對照**：手上那唯一一筆真實 `0x2C` 的尾段只有 3 bytes，
   比一個路徑區塊的最小值（`u16`＋`u16`＋`u8` = 5）還短，所以「哪一種情況下附加哪一條路徑」還沒被量到。
   本伺服器仍然不解析、不回應。
2. **旗標 byte 的兩個部分**：bit 0 的 71/101 roll 與高 nibble 的 `a5`。`a5` 只有「1 = AI 攻擊、
   0 = 命中影格／收尾」這個觀察，它是不是「這一擊是否真的命中」**沒有證據**。
3. **`mob+124 + 24` 與 `+72`**：前者是 `0x2C` 尾段的開關、後者是命中影格，都是怪物圖片解析後的欄位，
   沒有名字。
4. **`mob+104` / `mob+108` 的身份**：只知道 `+108` 會被打、它的 `+216` 進封包。
5. **原 server 的 `0x2C`／怪物 MP 政策仍需 oracle**：2003 年的 server（`d3d8`／`sub_55...` 那一側）
   不在手邊，所以不知道它是否消費 `conMP`、何時回 `0x34`、或如何處理 `0x2C`。本 checkout 對 `0x2C`
   只有 codec；另有 ADR-076 的明示重建政策：自己的 engaged-target ticker 扣 `conMP` 並送目前 MP，但不把
   這個政策說成原版，也不由 `0x2C` 觸發。
6. **沒有實機驗證**：`0x35` 送出去之後 client 播什麼、`0x2C` 的時序（一次攻擊到底送幾包），
   都要等 ADR-004 的 oracle run。

#### 4.20.7 修正：`0x2C` 的尾段是一條 `CMovePath`，不是傷害清單

本節前一版把尾段寫成「使用者 `+216` 的傷害／數字區塊」，那是**錯的**。重讀 `sub_495880`
（143230-143557 內的那次呼叫）與 `sub_495620`（157452-157631）後可以確定：

- `sub_495620(this, packet)` 依序寫：`u16`（`this+4`）、`u16`（`this+6`）、`u8`（`this+16`），
  然後走 `this+20` 的鏈結串列逐筆寫元素（每個元素 14 bytes，`s16` 延遲在 `+14`）——
  **這正是 §4.11.5 的 `CMovePath`**（`originX`、`originY`、`count`、元素），與 `movepath.ts` 的欄位一致。
- `sub_495880(path, packet, a3, other)` 是它的呼叫者（唯一一個），作用是把一條路徑（或 `other` 那條，
  由 `a3` 決定）接進封包；`a3` 來自 `*(mob+124 + 24) == 3`。
- 來源是 `v47 + 216`，而 `v47 = *(mob+108)` 是**被打的使用者物件**（§4.20.1），
  `+216` 就是使用者 vecctrl 內嵌的路徑（§4.11.5 的 `user[13] + 216`）。

所以尾段是**「這一擊打中時，對方（玩家）在哪裡」**，不是傷害數字。這也解釋了它為什麼只在
`*(mob+124 + 24) != 0` 時出現。**還沒有**解出的是「`a3 == 1` 與 `a3 == 0` 分別挑哪一條路徑」，
以及 `*(mob+124 + 24)` 的語意（§4.20.6 第 3 項）。

### 4.21 ✅ `0x0D` 能力值差異包（`sub_55BEB0`）＋經驗值表（`sub_4C7110`）

這是**唯一已解出、會改動玩家自己那份角色紀錄的 server → client 封包**：狀態列的 HP／MP 條與
經驗條畫的都是 client 自己的 `CharacterData`（§4.9），而這一包就寫在那份紀錄上。這也是
「殺怪 → 經驗值 → 升級」與「怪物打我 → HP 下降」兩個閉環缺的最後一塊。

#### 4.21.1 身體：`u8 ack` ＋ `u32 旗標` ＋ 差異欄位 ＋ `u32 durationMs`（byte-exact）

分派：`sub_55A900` 的 case 13，也就是 **`CWvsApp` 層**（`0x0A`–`0x14`，`sub_43B170`），不是 CField
的分派表。所以**同一個位元組在另一個方向是別的封包**（c2s 的 `0x0D` 是 `CField::SendInteract`，
`[u32 kind][string name]`，§4.13.2／`CLIENT_FIELD_OPCODE.interact`），跟 `0x0B`／`0x0F` 同一個道理。

```
u8  ack            // != 0 → CWvsApp+24 = 0、CWvsApp+28 = timeGetTime()
u32 flags          // 19 個 bit（最高到 0x40000），由 0x01 往上依序處理
                   // 每個 set bit 就讀一個欄位（沒 set 的不在線上）
u32 durationMs     // 暫時能力持續時間；0 = 後面沒有東西，非0接mask/values/source（見 §4.21.2）
```

`sub_45E0D0` 是差異讀取器（`.c:101985-102257`），讀到的每一個欄位都寫進 client 的角色紀錄
（`sub_463050` 交出來的就是 `CWvsApp+36` 那份）；紀錄裡的每個值都是「遮罩對」中的一半，
**線上送的是純值**，所以伺服器端不需要任何 RNG。

| flag | 欄位 | **這一包的寬度** | `CharacterData` 的寬度 | 讀取端 |
|---|---|---|---|---|
| `0x00001` | `appearanceA` | u32 | u32 | `sub_45DCC0` |
| `0x00002` | `appearanceB` | u32 | u32 | `sub_45DCC0` |
| `0x00004` | `unknown26` | **u32** | u8 | `sub_45DCC0` 讀 4 byte、只留低 byte（`.lst:0045E19B`）；配對 serializer `sub_45DE00` 的函式本體把 byte 零擴展成 u32（無 direct call xref，§4.9） |
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
| `0x40000` | `mesos`（原 `unknown93`）| u32 | u32 | `sub_45DDC0`（§4.22.5：這一欄是錢）|

- ⚠️ **這是全表最重要的細節：差異包的寬度不等於 `CharacterData` 的寬度**。`sub_45D840`
  （§4.9 的 69-byte 區塊）把 `unknown26` 讀 1 byte、`fame` 讀 2 bytes、`str`/`dex`/`int`/`luk`
  讀 2 bytes；而 `sub_45E0D0` 讀 4／4／1 bytes。三處都在 `.lst` 的組語裡逐 byte 確認過
  （Hex-Rays 對前兩處只寫 `u8`／`u16`，會讓人以為兩邊一樣）。
- **窄欄位的保留寬度**：`unknown26` 雖在 diff 上佔 u32，client 只保留低 byte；`fame` 佔 u32、只保留
  低 word；`str`/`dex`/`int`/`luk` 每個都只讀 u8，存入記憶體時上半部為 0。因此 `encodeStatUpdate`
  現在按 client 實際保留寬度檢查：`unknown26 <= 255`、`fame <= 65535`、四個能力值各 `<= 255`，
  拒絕會被靜默截掉的值（`protocol/stat.ts`；`server/test/stat.test.ts`）。
- `mapId` 與 `spawnPortalIndex` **不在這 19 個 bit 裡**：它們只在 `CharacterData`（`0x16`／`0x02`）裡旅行。
- 19 個 bit 用完就沒了：旗標字最大是 `0x7FFFF`。

**client 收到之後做什麼**（`sub_55BEB0` 在解碼之後的分支）：

1. 等級**沒變**而 `exp` 變大 → 顯示 `"경험치가 상승했습니다 (+%d)"`（`.c:352580`，`%d` 是新舊差）。
2. 等級**變大** → 播 `Effect/BasicEff.img/LevelUp` 並顯示 `"레벨이 올랐습니다 (+%d)"`。
   也就是**升級是伺服器決定的，client 只負責慶祝**。（client 自己也有一支「就地升級」routine
   `sub_4C71C0`：扣掉 `dword_5C2138[level]`、等級 +1、依 `sub_4C7450` 增加 HP／MP 最大值，再於活著時補滿（舊「傷害範圍」判讀已更正）。
   這支在 .c 裡找不到呼叫端，而 `0x0D` 的升級分支才是伺服器驅動的那條路；它的**表**才是重點，見 §4.21.3。）
3. `sub_55AA80` 重畫地圖／UI 單例，條列才會跟著動。它與 `0x0D` 的 panel 區塊（§4.21.2）都會碰到
   client 的另一顆亂數 `dword_5D2C20`：**只有第一次**（`byte_5D2C04` 這個 MSVC 延遲初始化守衛）
   才用真的 `rand()` 播種（`.c:351390`、`.c:206013`），之後只是抽號碼。`0x2C` 的 bit 0 用的是同一顆
   —— 所以「client 算出來的傷害」並不只由 `0x16` 的三個場地種子決定。

**`ack` 這個 byte 的意思**：非 0 會把 client 的「有一個場地請求還沒被回」閘門清掉（`CWvsApp+24 = 0`）
並重打時間戳（`+28`）。那是 `CField::SendInteract` 送出前自己設起來的同一個欄位
（`n3000[6] = 1; n3000[7] = timeGetTime()`），也是 `0x0B` 的 `result` 與 `0x11` 的同一個慣用法。
只有「零／非零」被比較。本伺服器送 0（這一包不是任何請求的回覆）。

#### 4.21.2 暫時能力：`durationMs`／`temporaryMask`（更正舊 `panelFlags` 誤讀）

**2026-10-17 重新交叉 PE／lst 後更正**：第一 u32 是持續時間，不是 flags；
第二 u32 才是12-bit效果 mask，不是角色 id。舊文把反編譯中被第二次 read 覆寫的 a3 當成舊值，
因而錯把第一字命名為 panelFlags；不能沿舊命名編碼。

```
u32 durationMs            // 0: return 0，不再讀尾段
if durationMs != 0:
  u32 temporaryMask
  s16 values[set bits]    // mask bits 0x001..0x800，由小到大
  u8 sourceIsSkill        // 0=item iconRaw；非0=skill icon
  u32 sourceId            // 整筆只有一個來源pair，非每個bit一份
```

`4C5DE1` read duration；`4C5E11` 加呼叫者clock到EBP；`4C5E1E` read mask；
`4C5E36..4C5E3A` 複製 mask 到out；`4C5E3C` test **第二字** 的bit1。
`4C6310` 反向encoder同樣先a3／再a4並按a4逐欄寫。
`55BEB0` 呼叫 `4C5DC0(this+28,packet,*(u32*)(n3000_0+20),out)`，
回傳 expiry 非零才 `4CBBD0(this+94,packet,expiry,out[0])`。

- value遮罩對DWORD起點2,8,14,20,26,32,38,44,50,54,58,62；expiry在value起點+2。
- 前九bit：PAD／PDD／MAD／MDD／ACC／EVA／hands／speed／jump；最後三bit仍用中性欄名，
  不借後期buff表猜施放規則。`0x800` 使用全域RNG保護值不代表收到後就抽傷害。
- `4CBBD0` 清除舊圖示重疊bits、保留舊來源其他欄，再append新來源；不是效果相加。
- `4C65A0` clock−expiry>0清值，`4CC2D0` 移除過期圖示；`4CC560` 32px槽、右界797、y45、alpha210，
  舊來源在右；`479B10(...,0)` 是道具iconRaw。
- `0x0F` 的 `55C090` 仍共用decoder但沒有 `4CBBD0` 圖示來源讀取。
  ~~本輪不發明其餘mode/cancel語意。~~ → **已定位（ADR-147，`native-tempstat-0f.test.ts`
  8 測試／8 突變，全部以原始 .lst 反組譯為證，因為 .c 在這裡把 `pExceptionObject`／`v7`／`a3`
  三種量混用，光讀反編譯會被誤導）**：
  1. **`0x0F` 只呼叫三樣東西**：`timeGetTime`、`sub_4C5DC0`、`_CxxThrowException`。
     沒有 `sub_45DC40`（變長 ack）、沒有 `sub_45E0D0`（100 位元組能力差異）、
     沒有 `sub_4CBBD0`（圖示來源）、也沒有 `sub_55AA80`（重畫）。
  2. **表頭是兩個位元組，不是一個**：`u8 A`；`A != 0` 才讀 `u8 B`；**只有 `A != 0 && B == 0`
     才讀暫時能力區塊**（`sub_4C5DC0` 是 `test al,al / jnz` 的 fall-through）。
     ⇒ `B` 是 mode 選擇器，**本版只有 0 有實作**；其他值被讀掉後丟棄
     （分派端 `sub_55A900` 連回傳值都不看）。
  3. **`0x0F` 傳 `nullptr` 給 `sub_4C5DC0` 的第 4 參數**（asm `push 0`），
     所以拿不回 mask，也因此**結構上永遠不可能走 `sub_4CBBD0`** ⇒ **`0x0F` 能改能力值，
     但永遠不可能顯示 buff 圖示**。`0x0D` 傳的是真的堆疊緩衝區（`lea ecx,[esp+98h+var_78]`）。
  4. **`+0x18`／`+0x1C` 戳記對**：`0x0F` 是**無條件**重設（asm 在任何分支之前）；
     `0x0D` 是**條件式**（`ack != 0` 才重設，`jz` 在 `mov` 之前）。
  5. **沒有「取消」opcode**。結束只有兩條路：`sub_4C65A0`（每幀，來自 listing 349669）
     清掉任何 `now > expiry` 的槽（判活是 `*(this+2) != *(this+3)`，到期是
     `thisa - (*(this+4) ^ *(this+5)) > 0`，清除是把值對寫成同一個 `sub_4618B0(0,0)`），
     有變化才 `sub_4CC2D0`(this+94) 丟圖示 ＋ `sub_55AA80` 重畫；以及
     `sub_4C5DC0` 在 `durationMs == 0` 時**直接 return 0、什麼都不讀**。

**已實作、未測試**：`protocol/temporarystat.ts`＋0x0D tail、client timed state／原raw圖示、
`2002001` speed8/time180000ms及實際移動；一般穿戴speed/jump也按原兩階段clamp套用。
戰鬥buff欄位其後已全部接通（PAD／MAD／ACC／EVA／PDD，`pda`＝02022002的PAD別名，ADR-106）；
只剩 `mdd`／未知欄位的道具仍整筆拒絕，不能因wire已解就燒掉無實際效果的藥水。
完整來源、生命週期政策及方便操作入口見 [TEMPORARY_STATS](../TEMPORARY_STATS.md)。

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
sub_4C7450(record, slot, 0x2800, 1);          // HP/MP 自然成長，表 VA 005BB344（本輪更正）
if (hp > 0) { hp = maxHp; mp = maxMp; }       // 活著才補滿
return 1;                                     // 一次一級
```

**2026-10-17 更正先前誤讀**：它透過 `sub_4C7450` **會增加 maxHp／maxMp**。`dword_5BB344`
是十行六欄的 HP／MP 成長表，不是熟練度；`record+386` 是技能 map 的 bucket pointer，不是裝備，
1000001／2000001 是 HP／MP 成長被動。自然／AP 分別取技能 WZ x／y，MP 另加 `trunc(INT*coefficient/200)`。
完整原表、上限、WZ level10 說明文字不符數值的例外與實作見 [STAT_GROWTH](../STAT_GROWTH.md)。
**AP／SP 自然發放仍沒有在這支函式找到**，不可把 HP／MP 的新證據延伸為已證實 5 AP／3 SP。
本次伺服器接上 HP／MP 自然成長、六種 AP 與立即保存，未改 AP／SP 發放。

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

> 以下 §4.21.5 為早期歷史輸出，當時尚未接 HP／MP 成長；不可當本輪封包或測試結果。

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

1. **原 `panelFlags` 誤讀已更正**（§4.21.2）：duration／mask／s16 values／source tail已接線，
   加速藥水與原raw圖示／實際移動已實作（未測）；其他戰鬥buff欄位也已接通（§6-20，ADR-106），
   剩 `mdd`／未知欄位仍拒絕；不代表Detail總值完成。
2. ~~client 的 메소（錢）不在這 19 個 bit 裡~~ → **已解決**：`0x40000` 就是錢（§4.22.5），
   伺服器送它就等於推動畫面上的錢包。
3. **HP／MP 成長的舊缺口已更正並實作（未測試）**：`sub_4C7450`／VA 005BB344 有原表，
   目前 `0x0D` 會帶成長後 maxima 與活人 refill。**自然 AP／SP 發放仍未定位**，不自行補數字。
   [STAT_GROWTH](../STAT_GROWTH.md) 說明證據與原 server 未取得的界線。
4. **沒有實機驗證**（ADR-004）：HP 條／經驗條會不會照著動、升級特效會不會播，全部由反編譯碼推導。
5. `fame`／`unknown26` 都是「差異包 u32、記憶體較窄」：`fame` 保留 u16，`unknown26` 保留 u8
   （§4.9／§4.21.1）。`unknown26` 的**語意仍未解**，但其傳輸鏈已結案；伺服器不會自行改變這些值，
   若明確提供差異，`encodeStatUpdate` 只接受 client 能完整保留的範圍。
6. **誰能改 client 的 HP**：把整份 binary 裡「寫紀錄 `+53`／`+55`（hp 遮罩對）」的程式碼掃過一次，
   總共只有四個地方，**沒有任何一個是「怪物打玩家」**：

   | 寫入者 | 什麼時候 | 加註 |
   |---|---|---|
   | `sub_45D840`（`.c:101658`）| 解完 `CharacterData`（`0x16`／`0x02`／登入鏈）| 全量 |
   | `sub_45E0D0`（`.c:102168`）| **`0x0D` 的差異包** | 只送有變的（這才是原伺服器改血的方式）|
   | `sub_4BDDC0`（`.c:198090`）| **技能的 HP／MP（與彈藥）消耗**：`sub_518BF0(record, skillId)` 是技能分派器（`sub_4BDD20` 查 `Skill/<job>` 的等級列，再依 id 分派到 `sub_519600`…），兩個呼叫端之一是快捷鍵表（`n0xC8 + 8*key + 152`）| 與 `0x0D` 無關，client 自己扣；彈藥需求在 `entry+56`／`+60`，庫存在 `record + 4*tab + 362` |
   | `sub_4C71C0`（`.c:206930`）| client 自己的就地升級 routine | **沒有呼叫端**（§4.21.3）|

   也就是說：**怪物打玩家的扣血一定要由伺服器送 `0x0D`**，client 端沒有別的路徑；而伺服器要知道
   打多少，就得先解出 `0x2C` 的尾段（§4.20.6 第 1 項，目前未解、只讀不回應）。這條閉環因此仍然是
   **OPEN**（ADR-008 的「伺服器只記帳」目前包含「不改玩家的血」）。

### 4.22 ✅ NPC 商店：`0x4A`／`0x4B`（開窗與結果）、`0x16`／`0x33`（client 的按鈕與點擊）

這一節同時解決兩件一直掛在待辦上的事：

1. **「對話框／商店」（`0x49`–`0x4C`）不再只是一個區間名** —— 兩個 opcode 的完整身體、誰開的窗、
   以及 client 會自己丟出斷線例外的兩個時機，全部定位完成。
2. **`CharacterData` 的第 22 欄（`+89/+93`）就是 메소**（原本叫 `unknown93`）。§4.18.8 一直說
   「撿到錢時 client 的錢包不會動、而且不知道是哪一欄」，現在兩個問題都有答案：欄位是它，
   `0x0D` 的旗標 `0x40000` 就是它 —— **錢包的顯示可以被伺服器驅動了**。

#### 4.22.1 誰開的窗：`0x33`「點擊場地物件」（`sub_55AF20`）

`CField` 的滑鼠處理 `sub_4A7770` 用一個 ±25 × −50..+10 的矩形（`rc.left = x-25, rc.top = y-50,
rc.bottom = y+10`）找出指標下的場地物件，只對**型別欄位 `+48 == 3`** 的物件動作，而且同一個物件
3 秒內不重複（`+56` 記時間戳）。命中的物件把它的 id 交給 `sub_55AF20`：

```
u8  0x33
u32 objectId        // 場地物件的執行期 id；對 NPC 就是 0x39 發給它的那個 id
```

送出前它有兩個前置條件：`CWvsApp+24 == 0`（沒有請求在途）與 `hp > 0`（活著），送出後把
`CWvsApp+24 = 1`、`+28 = timeGetTime()` —— **跟 `0x0D` 的 interact 是同一個閘門**。
解除它的方法 §4.11.6 已寫：伺服器回一個空的 `0x19`（`sub_4728B0` 只做 `+24 = 0; +28 = time`）。
`0x0D` 的 `ack` byte 也能清（§4.21.1）—— 兩個都合法，這支伺服器送 `0x19`。

#### 4.22.2 `0x4A`：開窗與菜單（`sub_4B73A0` case 74 → `sub_4B3780`）

`0x49`–`0x4C` 都由 `sub_4B73A0(opcode, packet)` 處理，而**只有 `0x4A` 與 `0x4B` 有分支**：
`0x49`／`0x4C` 落到函式尾端、什麼都不讀。`0x4A` 先 `sub_403350` 配置一個 `0x3B8` bytes 的
`CShopDlg`（RTTI 名稱與 vftable 都在 `.data` 裡，WZ 名稱 `"UI"`），再交給 `sub_4B3780`：

```
u32 shopId          // 存進 dlg+144；client 之後不會把它送回來
u16 count           // 列數，0 是合法的空商店
count × {
  u32 itemId
  u32 price         // client 自己顯示、自己拿它算總價
  if itemId / 10000 == 207: f64le unitPrice // 4B3780複製到+24，4B4AD0作double使用（後續追查更正）
  u16 maxCount      // 一般買入上限（預設1）；207為整組容量，sub_4B6B40讀+32
}
```

- 那一列在 client 記憶體裡是 **48 bytes**（`sub_4B7BA0` 從 `sub_4B3780` 的區域變數整塊複製）：
  `+0 itemId`、`+4 ..`、`+16 price`（`sub_4B6B40` 的 `v4[4]`）、`+24` 那 8 bytes（只有 207）、
  `+32 maxCount`（`v4[8]`）。**線上的順序**才是上面那個。
- `207` 是這份檔案裡唯一會多帶 8 bytes 的家族（`sub_45DD00(dst, 8, …)`，判別用魔法乘法除以 10000）。
  **後續追查更正**：4B4AD0讀同一+24為double，算缺少發數×每發費率，內容已證實；
  `protocol/shop.ts`保留raw `cash`欄名相容trace，新增float64 LE helper，不再誤認為cash serial。
- ⚠️ **開窗前 client 已經有別的 modeless 視窗時，`sub_4B73A0` 直接丟 `CDisconnectException`**
  （`if (this_15 != 0) throw ...`）—— 所以伺服器不能在已經開著商店時再送一次 `0x4A`。
  這支伺服器用 `FieldSession.shop` 記著自己開過哪個窗，第二次點同一個 NPC 只記一行 log。

#### 4.22.3 `0x4B`：一個 byte，而且**只有在請求在途時才合法**

```
u8 code
```

`sub_4B73A0` case 75 的流程：把 `dword_5C2040`（開著的 modeless 視窗）用 RTTI 轉成 `CShopDlg`；
**是 `CShopDlg` 且 `dlg+184 == 0`（沒有請求在途）→ 丟 `CDisconnectException`**（client 自己斷線），
否則先把 `dlg+184 = 0` 再讀那個 byte，然後照它顯示訊息：

| code | client 的字串 |
|---|---|
| 0 | **不顯示任何東西**（只把「請求在途」清掉）|
| 1 | `물품이 부족합니다`（東西不夠）|
| 2 | `현금이 부족합니다`（錢不夠）|
| 3 | `남은 슬롯이 부족하지 않은지 확인해보세요`（背包沒位子）|
| 4 | 與 1 **同一句話**（差別未定位）|
| >4 | `오류가 발생해 거래를 하지 못했습니다`（預設分支，`.text:004B7469` 的 jump table 是 `cmp eax, 4`）|

`dlg+184` 由三個「會做事」的按鈕在送出前設起來（`sub_4B6B40`／`sub_4B6E90`／`sub_4B7130`），
**關窗的 `sub_4B3C80` 不設**。於是協定變成：

- 買／賣／充電 **一定**要回一個 `0x4B`（哪怕是 `0`）——那是 client 解鎖自己的唯一方式。
- 關窗**不能**回 `0x4B`：那時 `dlg+184 == 0`（而且視窗正在被拆掉），回下去就是叫 client 丟例外。

#### 4.22.4 `0x16`：四個按鈕，同一個 opcode

四個 sender（`sub_4B6B40`／`sub_4B6E90`／`sub_4B7130`／`sub_4B3C80`）都用
`sub_4A1EA0(&buf, 22, nullptr)` 起頭（**22 = 0x16**），第一個 byte 是動作，其餘看動作：

```
u8 0 buy       u16 rowIndex  u32 itemId  u16 count      // 買：列索引是 client 自己的清單索引
u8 1 sell      u16 slot      u32 itemId  u16 count      // 賣：slot 是背包格（server 靠它找堆疊）
u8 2 recharge  u16 slot                                 // 充電（표창 那一類）
u8 3 close     （沒有了）                                  // 關窗
```

- **`itemId` 才是伺服器該信的那一欄**：`rowIndex` 是 client 自己建的那份清單的索引，而它其實建了
  **兩份**（`dlg+148` 可標價的一組、`dlg+152` 的 207 一組），螢幕上的順序屬於 UI。這支伺服器用
  `itemId` 找列、把索引留在日誌裡。
- 買入之前 client 自己也會檢查：數量必須 `1..maxCount`，總價不能超過 `+89 ^ +93`（見 §4.22.5），
  而且它會先問「몇 개를 사시겠습니까?」。伺服器端再檢查一次是**權威**，不是重複。
- `0x16` 與另一個方向的 `0x16`（`setField`）撞號，跟 `0x0D`／`0x0B`／`0x33` 一樣是同一個位元組在
  兩個方向各有意思（§4.6）。

#### 4.22.5 `+89`／`+93` 是 메소（`unknown93` 改名）

`CharacterData` 的第 22 欄（`u32`，記憶體 `+89/+93` 的遮罩對）有三個互相獨立的讀取端：

| 證據 | 行為 |
|---|---|
| `sub_4B6B40`（買）| `v7 = 紀錄+89 ^ 紀錄+93`，`總價 > v7` 就顯示 **`현금이 부족합니다`** —— 這一欄就是錢 |
| `sub_4B6E90`→`sub_4B5Bxx`（賣）| 同一對值被拿去填商店視窗的持有金額 |
| `.c:225553` 的對話框 | **`얼마를 버리시겠습니까?`**（丟錢）把該值當輸入框初始值，並 `min(值, 50000)` —— 50000 上限是 2003 年的丟錢上限 |

而 `0x0D` 的旗標 `0x40000` 寫的正是這一欄（`sub_45DDC0` → `+89/+93`，§4.21.1），所以**伺服器現在
可以推動畫面上的錢包**：`protocol/chardata.ts` 把它改名為 `mesos`，`game/rewards.ts` 的錢包改成
**這一份紀錄的視圖**（不是第二本帳），撿到錢時連同 `0x11` 一起送 `0x0D`。

#### 4.22.6 伺服器這一側：`protocol/shop.ts`、`game/shops.ts`、`loginserver.ts`

- `protocol/shop.ts`：`0x4A`／`0x4B`／`0x16`／`0x33` 四個 codec 與它們的 describer（`decode` 日誌
  現在看得懂商店的四個方向），`SHOP_RESULT`／`SHOP_REQUEST` 常數，207 家族原封不動攜帶、
  拒絕自行組裝。
- `game/shops.ts`：**價格來自資料**（`Item/Consume/0200.img/<id>/info/price`，`itemPrice`；
  讀不到價格的列**不會被送**，而不是送 0）。**商店的內容是伺服器的選擇**（ADR-010）：
  兩個商店（`1010100` 리나／헤네시스、`2003` 로빈／달팽이사냥터 —— 兩個都是地圖 `life` 裡真的
  存在的 NPC）、`DEFAULT_SHOP_MAX_COUNT = 200`、`SELL_PRICE_RATIO = 0.5`（收購價，client 只看得到
  買價，2003 的收購率不在 binary 裡）。買／賣都會**重新驗證**（錢、格子、數量、哪一格），
  失敗回 `TradeFailure`，由 `shopResultCode` 映射成 `0x4B` 的 byte。
- `loginserver.ts`：`0x33` → 先回 `0x19`，再（若該 NPC 有商店且沒開著窗）送 `0x4A`；
  `0x16` → 買／賣／充電／關窗。成功的交易送三個封包：`0x4B`（silent）＋`0x0B`（那一格換了什麼）
  ＋`0x0D`（`mesos`），跟拾取用的是同一組。`--data off` 時沒有任何價格 ⇒ 商店是空的、買不到東西。
- `wz/paths.ts` 多了 `itemImagePath`：`Item/<kind>/<ids 前四位>.img`，四種 kind（Consume／Etc／
  Book／Special）是這份 `Data.wz` 的實際目錄（`analysis/data_wz_manifest.json`）；**裝備不在
  `Item/` 底下**（`Character/<type>/<id>.img`），所以這一版不賣裝備。

#### 4.22.7 測試

- `test/shops.test.ts`（16）：四個封包的 golden bytes 與 round-trip（含 207 那 8 bytes 的攜帶與兩種
  拒絕、`0x4B` 的 `u8` 範圍、未知動作直接拒絕）；買／賣的完整會計（錢、格子、堆疊剩幾、清空），
  六種失敗；`shopResultCode` 一定落在 client 的 switch 或它的 default；真 `Data.wz` 的價格
  （25／80／160／100＋엘릭서 1000）與「讀不到價格的列不會被送」；`--data off` 什麼都買不到。
- `test/serve.test.ts`：**真 socket** 走完一次商店 —— 點 NPC（`0x33`）→ `0x19`＋`0x4A`（列與價格
  逐欄核對）→ 買一瓶（`0x4B` silent ＋`0x0B`　put ＋`0x0D` `mesos: 75`）→ 錢不夠時 `0x4B` code 2
  → 關窗之後**什麼都不回**。

#### 4.22.8 還不能宣稱的部分

1. ~~207那8 bytes內容未知~~ → 後續由4B3780→4B4AD0證實為補充每發單價double，見本文件末尾補充及ADR-045。
2. **`0x4B` 的 1 與 4**：client 顯示同一句話，差別沒有字串或分支能區分；本伺服器用 1 表示
   「你沒有那個東西」、4 表示「這間店不收」。
3. ~~充電未實作~~ → 0x16 op2補充成功、WZ容量／費率與0發組已接，**2026-10-20 已補齊行為測試**
   （unit×5＋真socket整合＋頁面충전橋；ADR-101），見 `../MESO_RECHARGE.md`。完整遠距扣彈玩法尚未接通。
4. **`0x49`／`0x4C` 沒有 handler**：`sub_4B73A0` 只認 74／75，所以真正的「對話框文字」不在這個
   區間 —— 2003 的 NPC 對話與任務共用 `0x46`–`0x48`（`CQuestMan`）與 client 的 `0x15` 回答，
   那條線還沒解。
5. **商店的內容是選擇**：原伺服器的商店是腳本，`Data.wz` 裡沒有商店資料，所以「哪個 NPC 賣什麼」
   是這份 repo 的決定（ADR-010）；價格則是檔案裡的。
6. ~~**NPC 的對話與走動**（`0x3D`）仍然 OPEN（§4.19.9）~~ → **ADR-062 已實作**（§4.28.2／§4.28.4）：
   `0x3D` 的兩個 signed byte、`action = -1` 走 `info.speak`、`action >= 0` 的 forced action 與
   `extra[raw].speak`、條件性 `CMovePath`、單一 controller 轉送都已完成，
   `native-npc-behavior.test.ts` 有 12 個測試。仍缺實機驗證（ADR-004）。

### 4.23 ✅ NPC 對話：`0x47`（s2c）與 `0x15`（c2s）

「跟 NPC 說話」在這份 build 裡就是**一個對話框封包**：伺服器把要說的話放進 `0x47`，client 用
`CUtilDlgEx` 把字畫出來、跑成 modal、把玩家的選擇用 `0x15` 送回來。沒有在這條封包找到任務狀態或腳本下載；`0x46`／`0x48` 沒有 handler（下表），
**但這不代表原伺服器沒有任務腳本**。info.quest 的原腳本仍未重建。

#### 4.23.1 分派與欄位

`sub_472770`（CField 的分派器）把 70..72 交給 `sub_4A58F0(dword_5C2048, opcode, packet)`
（`dword_5C2048` 是 `CQuestMan` 全域），而它只認 71：

| opcode | 分支 |
|---|---|
| `0x46` (70) | **沒有**（落在範圍裡、沒有 case）|
| `0x47` (71) | `sub_4A5910`（175012-175082）|
| `0x48` (72) | **沒有** |

`sub_4A5910` 的欄位，依讀取順序：

| # | 寬度 | 名稱 | 說明 |
|---|---|---|---|
| — | — | guard | `CQuestMan+4 != 0` ⇒ `CDisconnectException`：**一次只能有一個對話框**，與商店的 `CShopDlg+184` 同型 |
| 1 | `u8` | `unknownA` | 讀完就再也不會被用到（見下）|
| 2 | `u32` | `npcId` | 同上 |
| 3 | `u8` | `subOp` | 0..4；**> 4 直接丟掉**（不報錯、不回任何東西）|
| 4 | … | body | 依 `subOp`，見下表 |

前兩個欄位「讀了不用」是這個 build 的事實，不是漏看：`.lst` 裡五個 handler 的第二個堆疊引數
（`[esp+8]`，也就是那個 `u32`）**完全沒有被引用**，第一個只被當成下一次 byte 讀取的暫存槽。
所以 client 不可能在意裡面放什麼 —— 本伺服器在第 1 欄送 0，第 2 欄送**被點的 NPC 的池 id**
（`0x39` 發的那個），那是**我們**給這個空欄位的意義，讓擷取檔自己說得出話。

body（`sub_432680`／`sub_45DC40`／`sub_45DC80`／`sub_45DCC0` 的讀取順序；`str` = `u16 長度` + 原始 bytes）：

| subOp | 對話框 kind | body | client 回的 `0x15` |
|---|---|---|---|
| 0 `say` | 0 | `str message` ＋ `u8` ＋ `u8` | `u8 0`、`u8 answer` |
| 1 `confirm` | 1 | `str message` | `u8 1`、`u8 answer` |
| 2 `askText` | 3 | `str message`、`str default`、`s16`、`s16` | `u8 2`、`u8 answer`［= 1 時再接 `str`］|
| 3 `askNumber` | 2 | `str message`、`u32`、`u32`、`u32` | `u8 3`、`u8 answer`［= 1 時再接 `u32`］|
| 4 `kind 4` | 4 | `str message` | `u8 4`、`u8 answer`［= 1 時再接 `u32`］|

五個 handler（`sub_4A5A80`／`4A5D00`／`4A5F40`／`4A6320`／`4A65C0`，175089-175760）都是同一個形狀：
`sub_535AC0(dlg, kind, 1, message)` 開一個 `CUtilDlgEx`（0x3E4 bytes），再呼叫**一個** setter
（`sub_535C60`／`sub_535C80`／`sub_535CE0`／`sub_535C90`／`sub_535E30`，即上表的 kind）、
`sub_530CE0` 置中顯示，然後 `sub_461DD0` **把對話框跑成 modal**（`sub_5526D0(n3000, dlg+84)` 迴圈，
回傳 `dlg+80`）。所以：封包一定先被完整讀完，玩家的回答才可能送出；`sub_4A5910` 在回包之後把
`CQuestMan+4` 清掉 —— 一次一包是 client 保證的節奏。

`sub_535AC0` 的第 3 個引數（本節全部是 1）是「這個對話框來自伺服器」的旗標：client 自己的
本地呼叫端一律傳 0，這是分辨兩邊的現成記號。

#### 4.23.2 五個 kind 的語意（證據是 client 自己的本地用法）

`sub_5332C0`（311356-311392）是對話框的按鍵處理，它**依 kind 決定哪些結果可以結束 modal**，
於是把每個 kind 的回包碼釘死：

| kind | 可結束 modal 的結果 | handler 送出的 `answer` |
|---|---|---|
| 0 | `0x2000`、`0x2001`（＝主要按鈕，id 1；`sub_52BE10` 的 Enter 也映射到它）、ESC → 2 | `0x2001` → **1**；`0x2000` → **0**；其餘 → **0xFF** |
| 1 | `6`(IDYES) / `7`(IDNO)、ESC → 2 | `1` / `0` / `0xFF` |
| 2、3、4 | 主要按鈕 → 1、ESC → 2 | `1`（並附帶值）/ 其餘 → `0` |

client 在本地用到這些 kind 的地方就是語意的直接證據（行號在 `MapleStory.exe.c`）：

| kind | 本地使用者 | 參數 | client 從哪裡讀回結果 |
|---|---|---|---|
| 0 | 30 天現金道具公告（338650）| `sub_535C60(dlg, 0, 0)` | 丟掉不看 |
| 2 | 「얼마를 버리시겠습니까?」(225559)、「얼마를 드리시겠습니까?」(220444)、191679、108018 | `sub_535C90(dlg, 預設值, 下限, 上限)`：`(1, 1, 메소)`、`(10, 10, min(메소, 50000))` | `dlg+152`（數字）|
| 3 | 「길드명을 입력하십시오.」(254846) | `sub_535CE0(dlg, 預設字串, 4, 12)` | `dlg+160`（字串，`sub_4A61C0`）|
| 4 | **沒有本地呼叫者** | — | `dlg+164`（`sub_535AC0` 初始化成 `-1`；`sub_5333D0` 在列上取值時寫入的是「列的 `+36`」）|

⇒ kind 2 = **輸入數字**（回一個 `u32`）、kind 3 = **輸入文字**（回一個字串，兩個 `s16` 是長度範圍、
`-1` 也合法）、kind 0 = 有主要按鈕的文字框、kind 1 = 是／否。kind 4 是 `#L<number>#..#l` 選項（2026-10-18再交叉5338A0／533350／5333D0）。
`532E60` 反編譯失敗但listing完整：只畫文字框，沒有額外OK／Cancel；共享header Close仍在。遊戲層尚無原任務呼叫者。

#### 4.23.3 我們這一側（`protocol/quest.ts`／`game/dialogue.ts`／`protocol/cp949.ts`）

- `protocol/quest.ts`：`QUEST_TALK_OPCODE`（`0x47`）／`QUEST_REPLY_OPCODE`（`0x15`）、
  五種 body 的 encode／read／describe、`QUEST_ANSWER`（`1`／`0`／`0xFF`）、`0x15` 的 encode（假 client 與
  煙霧測試用）與 read（伺服器用）。golden bytes 在 `server/test/quest.test.ts`。
- `game/dialogue.ts`：台詞**不是我們編的**，是 `Npc/<7 位 id>.img -> info/speak`
  （數字鍵的 property 清單，`0`、`1`、…；`info/quest` 例如 `begin5`／`rina` 原樣帶著不解釋）。
  **這是原待機自言自語池，不是任務腳本**（49A0C0／499C00）；點擊分頁屬本地政策。
  `NpcTalk` 只記「這隻 NPC、這幾句、講到第幾句」。
- 遊戲層接法（**我們的選擇**，binary 裡沒有伺服器可以對照）：`0x33` 點 NPC → 有商店 → `0x4A`；
  沒商店 → `0x47 say` 的第一句；`0x15` 的 `answer == 1` → 下一句，`answer == 0` → 上一頁，FF（ESC／關窗）→ 結束；
  NPC 沒有 `info/speak`（出貨資料裡的「메이플운수 중형택시」就是）→ 只回 `0x19`。
  對話進行中再點一次同一個 NPC 只回 `0x19`（送第二個 `0x47` 會讓 client 丟例外）。
- `protocol/cp949.ts`：**字要送出去就得是 CP949**。client 的 `sub_432680` 是 `u16 長度` + 原始 bytes，
  直接進 `ZXString<char>`，畫的時候用系統 ANSI 字碼頁（＝CP949，這也是 `MapleStory.exe` 自己那些韓文字串
  的編碼）。Node 只有 CP949 的**解碼器**（`TextDecoder("euc-kr")`），所以反向表是第一次用到時
  「把 126 × 190 個合法 lead/trail 解一次再反轉」建出來的；編不出來的字元**丟例外**而不是送出去變亂碼
  （Latin-1 的重音字母不在這個字碼頁裡、emoji 也不在；漢字／假名／希臘／西里爾在）。

#### 4.23.4 2026-10-18交叉補充（ADR-061，實作／回歸來源未執行）

- `535C60` 的body兩byte不是ignored：+128非零出BtPrev，+132非零出BtNext、零出BtOK（532500）。
- `52FEB0`明設CUtilDlgEx vtable。`.lst 005BE990` 的連續UTF-16為完整`UI/UIWindow.img/UtilDlgEx`，
  不是.c切開後的`UI`。5309B0在serverFlag=1時加2，故為Ex2；header同理為BtUIClose2。
- 531FB0 `.lst` ret10h僅四個stack args，.c的多餘args是反編譯錯誤；七筆FillRect與五色從push順序交叉還原。
- 530C20／530CA0／535E40／535EF0給出width300/230、padding8/2、240普通文字上限、8px scroll步及各kind高度。
- Browser/session現在保留所有五種body並依當前kind回0x15；現有game仍只產say。
  對話窗範例為明示本地唯讀工具，不發任務封包或角色寫入。
- 40C730的NPC預設delay180，已修掉1000ms。49A0C0 idle4–12秒抽選與499C00 speech5000ms已定位，
  但0x2F/0x3D action index疑點與controller／移動同步仍未完成，不臆造wire。
- **`5338A0`＝record walker的dispatch（ADR-107交叉）**：lexer（534A80/534FA0）只認`#`/`L`/`i`/`s`
  ——534FA0的switch：`#`→escape（534A80已先把`#`本身入record，534FA0 case '#'不再emit）、
  L/i/s→收數字到NUL/CR/`#`（結尾`#`被消耗）、default→macro字元照字面emit；**語意在walker**：
  5338A0對整條record做`strcmp`（sub_416B00）：`#k`/`#r`/`#g`/`#b`＝色0/1/2/3、`#e`/`#n`＝bold 1/0、
  **`#l`精確匹配→selection（v163）設−1、不畫**——mid-word也成立：`#literal`被lex成record`"#l"`＋
  text`"iteral"`，原版真的吃掉那個l（selection開沒開都照關）；record長度>2且`#L`/`#i`/`#s`開頭→
  atoi（534990）：`#L`開selection、`#i`/`#s`查圖示（479D30/479B10 raw旗標）存進48-byte列
  （+32＝selection繼承、+36列值，kind-4的 dlg+164 由5333D0從+36收）；**沒匹配任何dispatch的
  record（`#h`、`#t`、單`#`）照字面畫**。舊測試期望`/^#L99#literal /`釘的是猜測的非原生語意，
  已按證據改回`/^#L99iteral /`並補釘「`#l`之後的record不再繼承selection」。
- 完整表格、原色、操作入口、markup／browser字型限制與保存見[原NPC對話](../NATIVE_NPC_DIALOGUE.md)。
  **沒有執行測試、typecheck或browser/probe。**

### 4.24 ✅ 一張地圖上的多個玩家：哪些封包是「世界的事實」（`game/world.ts`，ADR-012）

§4.11 把「兩個 client 走進同一張圖並互相看見」需要的封包解到欄位層，但伺服器那一側一直是
**一個連線一份世界**：`MobField`／`NpcField`／`DropField` 都掛在連線上，所以第二個玩家會拿到自己的一份
怪物（各自扣各自的血）、自己的一套掉落物 id，以及自己的 timer（同一個怪物在兩個 client 上走不同的路）。
這一節記的是把世界搬到「每張地圖一份」之後學到的東西：哪些封包是**場地的事實**（對站在圖裡的每個人都
成立）、哪些是**個人的**，以及一個剛進場的人要看到什麼才和早進來的人看到同一張圖。

實作：`server/src/game/world.ts`（`FieldInstance`／`FieldRegistry`，`FieldMember` 是唯一的介面），
測試：`server/test/world.test.ts`（18 個，假成員）＋ `server/test/serve.test.ts` 的兩個真 socket 測試。

#### 4.24.1 「世界的事實」與「個人的事」怎麼分（證據：handler 落在哪個池子）

| opcode | 讀它的物件（§4.11.1） | 這句話在說什麼 | 誰收到 |
|---|---|---|---|
| `0x1C`／`0x1D` | CUserPool（`sub_51CFE0`／`sub_51D280`）| 有人進場／離場 | 場地裡的所有人（含剛進場的：他要看到已經在的人）|
| `0x22` | CUserPool（`sub_51D590`）| 某個人在走 | 除了那個人以外的所有人 |
| `0x2F`／`0x30`／`0x31` | CMobPool（`sub_4924A0`／`sub_4926B0`／`sub_4927B0`）| 怪物出現／開始死亡／屍體走了或回來了 | 所有人 |
| `0x33`／`0x34`／`0x35` | CMobPool（`sub_492380`）| 怪物在走／受到攻擊（閃爍）／換動畫 | 所有人（`0x34` 見 4.24.4 的保留）|
| `0x39`／`0x3A`／`0x3B` | CNpcPool（`sub_49F6C0`…）| NPC 出現／離開／**走動**（§4.28）| 所有人 |
| `0x43`／`0x44` | CRewardPool（`sub_4A88A0`／`sub_4A95B0`）| 地上多了一個掉落物／某個掉落物沒了 | 所有人 |
| `0x16` | CStage 基底（`sub_4C2780`）| **你**進這張圖（帶你的 `CharacterData`）| 只有你 |
| `0x0B`／`0x0D`／`0x11` | CWvsApp（`sub_55A900`）| **你的**某一格道具／能力值／撿到東西的訊息 | 只有你 |
| `0x19`／`0x4A`／`0x4B`／`0x47` | `CField`／`CUniqueModeless`／`CQuestMan` | 你的請求被放行／你的商店視窗／你的對話框 | 只有你 |

判準不是猜的：上面「所有人」那一組的 handler 全部掛在**場地自己的池子**上，每一句話都是「這張圖現在長
什麼樣」——`0x1C` 是「池子裡多了一個使用者」，`0x43` 是「地上多了一個 id」，對每個站在圖裡的人都成立；
反過來 `0x0B`／`0x0D`／`0x11` 動的是**這個人的角色紀錄**（`0x0D` 是能力值差異包，§4.21），
`0x16` 帶的是他自己的 `CharacterData`。

`0x1C` 還多一行自我排除：`sub_51CFE0` 讀到 id 後先比 `n3000[5]`（＝本機角色 id），相等就直接 return。
⇒ 伺服器**不需要**送自己的 `0x1C`（送了自己也會忽略），而自己的頭像來自 `0x16` 的 `CharacterData`。

#### 4.24.2 剛進場的人要看到什麼（snapshot）

| 送什麼 | 為什麼是這個形狀 |
|---|---|
| 每個**還活著**的怪物一個 `0x2F`（§4.15）| 新 client 的 `CMobPool` 是空的；位置用怪物**現在**的位置，不是出生點 |
| 每個 NPC 一個**完整** `0x39`（§4.19）| ⚠️ 5-byte 的形狀**不是**給新玩家的：`sub_49F6C0` 只要 id 已知就結束讀取，而新 client 的池子是空的。完整 body（20 bytes）才有模板與座標 |
| 地上每個掉落物一個 `0x43`（§4.18）| 一樣的理由：`dropId` 是場地的，新 client 沒見過 |
| 每個已在場的玩家一個 `0x1C` | 見下（4.24.3）|
| 已在場的玩家各收到新人的一個 `0x1C` | 同一件事的另一半 |

- 只有**活著**的怪物會進 snapshot（屍體不補送）。這一格是**我們的選擇**：沒有證據說原伺服器會補，
  補了也不會錯，只是多播一段不在場的死亡動畫。
- 順序是 `0x16`（client 的場地要先存在）→ 怪物 → NPC → 掉落物 → 玩家（`0x1C`）。每個封包彼此獨立，
  所以順序本身沒有證據，這是**我們的選擇**。

#### 4.24.3 `0x1C` 的九個欄位：能填的、填 0 的、以及為什麼填 0 是安全的

| 欄位 | 我們送 | 依據 |
|---|---|---|
| `characterId` | 角色 id | `sub_51CFE0` 用它當 `CUserPool` 的 key |
| `name` | 角色名（ASCII，§4.9）| `sub_520680` → `ZXString`，就是頭上的名字 |
| `avatarItems` | `CharacterData` 兩個穿戴陣列的 item id | `sub_45F340` 依 **id 自己分類**（`itemId/1000/10`），所以順序不重要；**0 不能出現**（那是清單結尾），所以 0 的 id 會被濾掉 |
| `unknown64` | `0` | `CUser+64`，語意未解（§6 第 2 項）|
| `face` | 角色的 **`appearanceA`**（沒有就補 `lookOf` 的 `20000`）| `sub_520680` → `sub_507A20` → `sub_508260` 寫進 `CUser+68`，就是 client 畫的那張臉（§4.11.3c）|
| `unknownA`／`unknownB` | `0` | `sub_520680` 讀了直接丟掉（不存）|
| `x`／`y` | 場地記得的位置；沒動過的人＝出生點 | `sub_485400(field, id)` 之後交給 vecctrl |
| `action` | `0` | `CUser+180` 的姿態，值表未解 → 一律「站著」 |
| `foothold` | 腳踏點 id（算得出來時）| 見下 |

- **填 0 為什麼安全**：`sub_485400` 對未知的 foothold id 回 0（＝沒有 foothold），所以「算不出來」
  不會壞；`action`／`unknown64` 與兩個「讀了就丟」的 u32 只是外觀的細節，不是長度或順序的一部分。
  **`face` 不填 0**：0 是「沒有這個部位」，client 會把整顆頭畫空（§4.11.3c）。
- **出生點**（`spawnPointOf`）：地圖的 `sp` portal → 第一個 `pt = 0` 的 portal → 第一個 portal，
  再用 `footholdUnderPoint()`（腳踏點的 x 覆蓋 + y 最接近的線段）取那個位置的腳踏點 id。
  ⚠️ `0x16` 的 `mode` 語意未解（§6 第 2 項），所以「`mode = 0` ⇒ 玩家站在 `sp` portal」是**我們的假設**，
  要改只有一處（`spawnPointOf`）。真 `Data.wz` 上它落在합당한 값：地圖 40000 的 `sp` portal (1,183)
  → foothold 28（就是那個線段的 id）。

#### 4.24.4 廣播 vs 個人：含**我們的選擇**的部分

| 事件 | 送什麼 | 給誰 | 依據 |
|---|---|---|---|
| 打死一隻怪物 | `0x34`（受擊閃爍）→ `0x30`（死亡動畫）| 全場 | `0x30` 是明顯的世界事實；⚠️ `0x34` 的廣播範圍**沒有證據**（原伺服器可能只回攻擊者），我們選「大家都看到同一隻怪的反應」 |
| 那一擊的經驗值 | `0x0D` 差異包 | 只有攻擊者 | 差異是**他的**角色紀錄（§4.21，ADR-009）|
| 怪物掉的東西 | `0x43` | 全場 | 掉落物屬於場地（§4.18）|
| 拾取 | `0x44` kind 2 | 全場 | 見 4.24.6 |
| 升級 | `0x0D` 差異包 ＋ `0x29`（`u32 characterId`＋`u8 0`）| 差異包**只有升級的人**；`0x29` 給**其他人**（自己的 client 已經從 `0x0D` 播了，見 §4.27）|
| 離線 | `0x1D` | 其他人 | `sub_51D280` |
| NPC controller／idle | `0x3B` flag1（u8＋u32）及3D | 3B僅指定者；3D本圖全體含sender | 靜止NPC idle；movable opt-in；controller選擇／透明索引relay是重建政策，§4.28／ADR-062 |

#### 4.24.5 世界的時鐘：一個 interval，不是每個連線一個

原本每個連線一個 `setInterval`：兩個人在同一張圖就會各自拿到一份 `0x33` 腿、各自算一次重生。
現在是**一個 server-wide interval**（`GameEntryServer.startClock`，第一個場地出現時啟動），
每 tick 走過所有場地（`FieldInstance.tick`）。兩個是**我們的選擇**：

1. **沒人看的場地不派 `0x33`**：一條腿是對 client 的承諾（它會把怪物走到那裡），沒人看就不走；
   但屍體／重生照算，所以下一個進來的人看到的是「該在的怪物都在」。
2. **場地在最後一個人離開後不刪**（`FieldRegistry` 留著）：世界比連線長壽，重登看到同一張圖；
   代價是記憶體隨「去過的地圖數」成長（上限＝地圖數，出貨資料 100 張）。

#### 4.24.6 拾取：一件掉落的消失是世界的，拿到什麼是個人的

`0x44` kind 2 只說「這個 `dropId` 沒了，是這個人拿走的」→ 全場（**含**撿的人：飛行／音效就是這個封包）；
`0x0B`（哪一格多了什麼）、`0x0D`（錢）、`0x11`（訊息）只在撿的人身上才有意義。

⚠️ 這一節順手修掉一個缺口：**撿到 mesos 原本只送 `0x11`**，錢在 client 上不會動——錢是角色紀錄的第
22 欄，只有 `0x0D` 會動它（§4.22.5）。現在 `pickUp` 先送 `0x0D` 的 `{mesos}`、再送 `0x11`。

#### 4.24.7 一個 character id 只能在一張圖裡出現一次

- `CUserPool` 以 id 為 key，所以同一張圖裡重複的 id 會讓 client 少算一個人（或更新錯的人）。
  `FieldInstance.join` 遇到重複的 id 會先送 `0x1D` 再讓新的進場。
- 這一節也把**角色 id 的配發改成全伺服器唯一**（`nextCharacterId(accounts)`）：原本是「每個帳號從 1
  起算」，兩個帳號的第一個角色都會是 1 → 同一張圖就撞 id。⚠️ 症狀很難查，因為 `sub_51CFE0` 的自我排除
  會讓 client **安靜地忽略**那筆進場紀錄（其中一個人看不到另一個人，而不是崩潰）。

#### 4.24.8 真的跑起來的樣子（真 `Data.wz`、兩個 socket）

地圖 40000（달팽이사냥터，63 隻怪／1 個 NPC）：

```
Hero 進場    : snapshot 65 個封包（0x16 + 63 × 0x2F + 0x39），出生點 (1,183)、foothold 28
Alt 進場     : 同一份 snapshot，然後 0x1C「Hero 在 (1,183)、foothold 28、avatar=[]」
Hero 收到    : 0x1C「Alt 在 (1,183)」
Hero 走一步  : Alt 收到 0x22 characterId=11 → (441,395)（Hero 送的路徑，前面多了 id）
Hero 打第一隻: Hero 收到 0x34 0x30 0x0d 0x43、Alt 收到 0x34 0x30 0x43
               兩邊的掉落物一模一樣（dropId 1、(458,395)、錢 1）；0x0d 只在 Hero（+3 exp）
Alt 走上掉落 : Alt 收到 0x44 0x0d 0x11、Hero 收到同一個 0x44 {dropId 1, kind 2, characterId 12}
Alt 離線     : Hero 收到 0x1D characterId=12
```

#### 4.24.9 還不能宣稱的部分

1. **沒有實機驗證**：這一節全部是「我們的兩個假 client」；原 client 看不看得到另一個人、頭像長什麼樣、
   走路的插值順不順，都要靠 ADR-004 的 oracle run。
2. `0x34` 的廣播範圍是**我們的選擇**（4.24.4）；原伺服器的行為沒有證據。
3. ~~`0x29` 未解~~ → **已解並實作（§4.27／ADR-015）**：別人看得到升級特效了；剩下的是「不送給升級者自己」是推論（§4.27.5）。
4. 「場地不刪」「沒人看不走路」是**我們的選擇**（沒有 server 可以對照）。
5. **沒有頻道／分流**：整個 server 只有一份世界（一張圖一個 instance）。加頻道時要改的是
   `FieldRegistry.of(mapId)`（key 要變成 map + channel）。
6. ~~NPC 的 `0x3D`（走動的 NPC）仍未實作（§4.19.9 第 2 項）。~~ → **ADR-062 已實作**（§4.28.4）：
   靜止 archive-backed NPC 預設可控，移動的仍需 `--npc-walk` opt-in（原 server 的 controller
   挑選／距離政策未知，見 §6 第 14 項）。
7. 進場 snapshot 沒有補送屍體、也沒有補送「正在死亡中」的怪物（4.24.2 的選擇）。

### 4.25 ✅ 換地圖：`0x0D` 的傳送門請求 → `0x16`（＋「紀錄的 `mapId` 就是登入的地圖」）

§4.11.6 解出了 client 的兩個 field 請求（`0x0D` 互動、`0x0E` 自己的移動），但伺服器這一側一直只有
「一個 port 一張圖」。這一節把**走過傳送門**接起來：請求的形狀、目的地從哪來、四個步驟的順序、
人會落在哪裡，以及為什麼「登入在哪張圖」是**角色紀錄自己的事**。

實作：`net/loginserver.ts` 的 `handlePortal`／`enterMap`／`withMapId`，`game/world.ts` 的
`FieldInstance.portal`／`map`；測試：`test/serve.test.ts` 的傳送門端到端（13）、`test/world.test.ts`
的 `portal`／第二張圖（2 個）。

#### 4.25.1 請求：`0x0D` 與那個「一定要回」的解鎖封包

| 方向 | 封包 | 內容 | 證據 |
|---|---|---|---|
| c2s | `0x0D` | `s32 kind` + `string name`（`kind = -1` ＝「滑鼠下的東西」，`name` ＝它的名字）| `sub_472590`（`CField::SendInteract`）；`sub_5124C0`／`sub_512510` 在滑鼠下是傳送門時播 `Portal` 音效並送 `-1` ＋ 傳送門的 `pn`（§4.11.6）|
| s2c | `0x19` | **空的**，只把 client 的互動閘門解開 | `sub_4728B0`：`n3000[6] = 0`；`sub_472590` 送完 `0x0D` 後設 `n3000[6] = 1` 並有 500 ms 節流 |

⇒ **每一個 `0x0D` 都欠一個 `0x19`**，即使是「這個名字不是本圖的傳送門」。不回，玩家之後再也按不了
任何東西（閘門永遠是 1）——所以本伺服器在讀取封包**之前**就先把 `0x19` 送出去。

- `kind` 只有 `-1` 有證據：GM 的 `/헉맵 <mapId>` 會走同一個 sender（§4.11.6），它填什麼沒有定位，
  所以其他 `kind` 一律**只記一行日誌、不動玩家**（`INTERACT_KIND_CURSOR`）。

#### 4.25.2 目的地不在封包裡，在地圖資料裡

`0x0D` 只有「哪一個傳送門」的名字，**沒有地圖 id**。目的地是那張圖自己的 `portal` 節點：
`tm`（to map）／`tn`（to name，目的地那一側的傳送門名字）。

- `tm = 0`（或 `999999999`，出貨資料裡「沒有目的地」的寫法）⇒ 這個傳送門不連去別張圖，只記日誌。
- 名字比對**不分大小寫**（本伺服器的選擇）：名字是地圖資料，client 自己的比對沒定位，而大小寫的差別
  會變成「傳送門有沒有作用」這種最難查的錯誤。
- 因此「玩家用了傳送門」＝「查本圖同名的 portal」＋「它的 `tm` 就是新地圖」。同圖的傳送門
  （`tm == 本圖`）也走同一條路：離開再進入，client 本來就會把場地重建（沒有特例）。

#### 4.25.3 四個步驟的順序（每一步都有理由）

| # | 做什麼 | 為什麼是這個順序 |
|---|---|---|
| 1 | `0x19` 解鎖 | 見 4.25.1；不管後面成不成立都欠 |
| 2 | 目的地**先建好**（`FieldRegistry.of`）| 建不出來（那張圖沒有 `Map/Map/*.img`）就**留在原地**：這是唯一不會把玩家丟進「沒人模擬的地圖」的答案 |
| 3 | 離開舊場地（`0x1D` 給還在的人）| client 的 `CUserPool` 以角色 id 為 key，同一個人**不能同時在兩張圖**（否則兩張圖各有一個他）|
| 4 | `0x16`（新地圖），然後 `join`（快照）| client 要先有場地物件才裝得下後面那些封包（`0x2F`／`0x39`／`0x43`／`0x1C`）|

- **商店與對話一起丟掉**：那些視窗屬於剛離開那張圖的 NPC，client 重建場地時會自己收掉，
  伺服器留著就會出現「回一個已經不存在的視窗」的請求。
- 換圖時**只有**那條連線的 `send` 與錢包不變（它們掛在 session 上，session 跟著人走）。

#### 4.25.4 落點已定位：CharacterData+101 的 spawn portal index（2026-10-17 更正）

原先把落點未知歸到 `0x16.mode` 是錯誤追蹤方向，現已由 `sub_511820` 確證。
`spawnPortalIndex` 是 **non-type3 一般門陣列的 u8 索引**（含 type0），初始 x=portal.x、y=portal.y−10。
伺服器現在將目的 `tn` 解析到這個索引，寫進角色資料、0x16與保存；remote及browser一致。
完整來源、門類型及容錯差異見 §4.43。先前「tn只記日誌／永遠sp」僅為歷史實作，已不適用。

#### 4.25.5 「登入在哪張圖」是角色紀錄自己的事

`0x16` 的地圖 id 來自 `CharacterData`（第 23 欄，`+97`）：`sub_4C2780` 把解出來的紀錄交給場地建構子，
`sub_4694F0` 用它載入 `Map/Map/%09d.img`（§4.11.2b）。所以伺服器只要把**玩家自己的紀錄**送回去就好，
本伺服器現在就是這樣：

- 有 `entry.character` ⇒ **進該紀錄的地圖**；map0 是真實地圖，不能一概替換。
- 只有 provider 根本沒有 map0 的 archive-free/tooling 情況，保留舊 map0→`--map` 相容行為；沒有 record 的 handoff 使用預設圖。

`cli.ts` 因此把 `--map` 同時給兩邊：`LoginServer.startMapId`（**新角色**的紀錄要填哪張圖）
與 `GameEntryServer.mapId`（沒有 mapId 的紀錄的後備）。

#### 4.25.6 還不能宣稱的部分

1. `0x16.mode` 的其他語意仍未全解；**不是現在已解出的 +101 出生門索引**。
2. `tn` 已真正使用，原封包與保存有回歸測試（§4.43）。
3. GM 地圖命令（kind=mapId／empty name）已接，明確 operator allowlist、預設禁止，不猜原 server rank。
4. pt0出生／pt1隱藏手動／pt2可見手動／pt3自動已由client分支證實；任務／等級等原 server 條件仍未解。
5. **沒有頻道／分流**：`FieldRegistry.of(mapId)` 是唯一入口，加頻道就是 key 變成 `(mapId, channel)`。
6. **沒有實機驗證**：client 走進傳送門時的動畫／音效、換圖後鏡頭與 UI 的重建，全都沒看過。

#### 4.25.7 真的跑起來的樣子（真 `Data.wz`，兩張相鄰的圖）

```
A = 102020000 페리온서쪽령（73 隻怪、0 個 NPC、23 個傳送門）
B = 102030000 커닝시티북쪽공사장（73 隻怪、0 個 NPC、24 個傳送門）
portal "west00" of A: tm=102030000 tn="east00" at (-42,272)；B 真的有 "east00" at (-2691,335)

Hero 進 A      : 74 個封包（0x16 ＋ 73 × 0x2F），出生點 (33,-32)、foothold 63
Alt 進 A       : Hero 收到他的 0x1C，他看到 Hero 的 0x1C
Alt 用 west00  : [0x19, 0x16, 73 × 0x2F] → 0x16 的地圖是 102030000，落在 (-5863,149) foothold 41
                 Hero（還在 A）收到 0x1D characterId=12
Hero 也走過去  : [0x19, 0x16, 73 × 0x2F, 0x1C] → 0x1C 說 Alt 在 (-5863,149)
                 Alt 收到 Hero 的 0x1C（兩個人在 B 又見面了）
Hero 走一步    : Alt 收到 0x22（新場地的轉播照舊）
Solo（紀錄寫 B）: 直接進 B，0x16 的地圖是 B，而且收到 11／12 兩個人的 0x1C
Alt 離線       : Hero 收到 0x1D
```

#### 4.25.8 測試

| 檔案 | 內容 |
|---|---|
| `server/test/serve.test.ts`（13）| 兩條真 socket：不是本圖的傳送門名只拿得到 `0x19`；`west00` → `[0x19, 0x16(2000000), 0x2F, 0x39]`；舊圖收到 `0x1D`；紀錄寫著 2000000 的第三個連線進得了那張圖、且看到先過去的人站在**那張圖的**出生點上；先過去的人收到新人的 `0x1C` |
| `server/test/world.test.ts` | `FieldInstance.portal` 不分大小寫、查不到回 `undefined`、`map` 留著自己那張圖；第二張圖是第二個場地（自己的出生點、自己的 portal、`FieldRegistry` 也留著它）|
| `server/test/field.test.ts`（既有）| `0x0D` 的 `s32 kind` ＋字串（`encodeClientInteract`／`readClientInteract`）|

### 4.26 場地聊天更正：c2s `0x12` → s2c `0x1F`（ADR-059）

**2026-10-18 原檔重讀更正；新實作／fixture未測試。** 舊版把 `0x1A/0x12` 當成一般聊天，
又把 `CConfig+24` 當成聊天窗開關，兩者都不正確。舊socket／probe結果不驗證本次修正。

- `470C70`：`[12][string text]`，不含名字／id，也沒有本機echo。
- `51D530 → 51CD10 → 50B320`：`[1F][u32 characterId][string text]`。查self或remote，未知id丟棄。
- `50B320` 以 `%s : %s` 組出**同一份完整含名字的文字**，先給 `4FB670(...,0)`白字log，
  再經 `4E2850` 轉寬字，給 `4373A0` 五秒normal/dead氣泡。不是只把原訊息畫在頭上。
- server `handleChat` 轉播 `encodeUserBalloon({characterId:session.characterId,text})`，
  含說話者、同場地、保留原CP949 bytes。這是依接收路徑重建的server政策，不是假稱取得原server程式。
- `0x1A/0x12` 則是**收到的密語**，`name>> text`綠字，不產生頭頂氣泡，見§4.31。
- browser把事件標示 `channel=field|whisper`；不能用名字／文字內容猜來源，也不能把server提示冒充System密語。
- `55CDE0`：`[13][00][string text]` → `[공지사항] text`，StatusBar font5淡黃；type1→52BBE0 CUtilDlg1000單OK提示窗，ADR-088已補完整收件鏈；其他type讀完string忽略。

`field.test.ts`保留兩種不同codec的golden來源；`serve.test.ts`一般聊天fixture改期待0x1F／id；
`native-chat-gameoptions.test.ts`新增channel／unknown id／notice／refusal／wrap來源。**全部未執行。**
完整幾何、原檔地址、生命週期與限制見 [NATIVE_GAME_OPTIONS_CHAT](../NATIVE_GAME_OPTIONS_CHAT.md)。

### 4.27 ✅ 升級的兩半：自己的 `0x0D`、別人的 `0x29`

§4.21 解了 `0x0D` 的升級分支，也在同一節記下「升級對別人不可見」——因為 `0x29`（別人看到的升級特效）
當時沒有解。這一節把它解完：封包形狀、client 用它做什麼、以及為什麼**只送給別人**。

實作：`protocol/field.ts` 的 `USER_EFFECT_LEVEL_UP`／`UserEffect`／`encodeUserEffect`／`readUserEffect`，
`net/loginserver.ts` 的 `awardKillExp`；測試：`test/field.test.ts` 的 golden（1）、`test/serve.test.ts`
的兩條真 socket（1）。

#### 4.27.1 形狀：`u32 characterId` ＋ `u8 effect`，id 查不到就整個丟掉

| 位置 | 內容 | 證據 |
|---|---|---|
| 分派 | `CUserPool` 的 `0x21`–`0x2A` 都由 `sub_51D590` 處理，case `')'`（0x29）呼叫 `sub_522300(user, packet)` | `.c:289577`（`sub_51D590`）|
| id | `sub_51D590` 先讀 `u32`，再用 `sub_51CD30(pool, id)` 查那個人在不在；**查不到就 return**（封包整包丟棄）| 同上（`v5 == nullptr` 直接結束）|
| effect | `sub_522300` 讀 `u8`：`0` → 用 `sub_50D6D0(this)` 在那個人身上建效果，資源是 `Effect/BasicEff.img/LevelUp` ＋ 音效 `LevelUp`；`1` → 再讀一個 `u32`（做什麼未解）；其他值 → 什麼都不做 | `.c:294701`（`sub_522300`）|

- 「查不到就丟掉」是這個封包可以**安全廣播**的原因：對不知道的 id 送它等於沒送。
- effect 只有 `0` 有證據，所以 codec 也只認 `0`（不是 0 就丟 `RangeError`，與 `0x1A` 的非聊天 sub-op
  同一條規矩）。

#### 4.27.2 為什麼只送給別人：升級的人自己已經播了

`0x0D`（`sub_55BEB0`）的**尾端**會比較新舊等級，變大時在同一支函式裡播**同一組資源**
（`Effect/BasicEff.img/LevelUp` ＋ `LevelUp` 音效，`.c:352616`）。也就是說：

- **升級的人**：`0x0D` 的差異包 → client 自己播特效（§4.21 已記，`game/exp.ts` 的註解也提到）。
- **其他人**：`0x29` ＋ 那個人的角色 id ＋ `0` → 同一組特效畫在**那個人的位置**上。

⚠️ 「不送給升級的人自己」是**推論**：兩條路都會播同一組資源，兩者都送＝播兩次（疊在一起）。
client 端沒有任何「同一個效果去重」的邏輯（`sub_50D6D0` 每次呼叫都建一個新效果物件），所以本伺服器
送 `0x29` 時排除升級的人（`FieldInstance.broadcast` 的第二個參數）。這件事列進 §6，讓 oracle run 回答。

#### 4.27.3 伺服器這一側

`awardKillExp` 在 `gain.levels > 0` 時多做一件事：先送升級者自己的 `0x0D`（既有行為），再
`session.instance.broadcast(encodeUserEffect({characterId, effect: USER_EFFECT_LEVEL_UP}), characterId)`
—— 排除自己，並記一行 log（`0x29 level-up effect for "Hero" sent to 1 other player(s)`）。
`awardKillExp` 原本那段「⚠️ 別人的升級特效 `0x29` 未解」的註解就是這一節的解。

#### 4.27.4 測試與實跑

| 檔案 | 內容 |
|---|---|
| `server/test/field.test.ts` | golden bytes `29`＋`07000000`＋`00`、`readUserEffect` 逐欄、`describeFieldOpcode(0x29)` 是 `0x29 CUserPool(user effect)`、effect `1` 被拒絕而不是被半讀 |
| `server/test/serve.test.ts` | 兩條真 socket：殺怪升級時別人收到 `[0x34（被打）, 0x30（死）, 0x29]`（同一個同步處理常式，中間插不進怪的 tick）且 `0x29` 逐欄是 `{characterId: 7, effect: 0}`；升級的人收到 `0x0D`（`level: 2`、HP/MP 回滿）而**沒有** `0x29` |

真 `Data.wz` 兩個 client（달팽이사냥터 40000）：달팽이（`maxHP 8`、把 exp 調成 20）一擊升到 2 級 ——
Alt 收到 `[0x34, 0x30, 0x29]`、Hero 收到 `{level: 2, hp: 50, mp: 50, exp: 5}` 且 0 個 `0x29`。

#### 4.27.5 還不能宣稱的部分

1. **effect `1`**：只知道後面還有一個 `u32`，不知道它做什麼，所以沒有 codec。
2. **「只送別人」是推論**（§4.27.2）：oracle run 可以確認（如果真正的伺服器也送給升級者自己，
   差別只是特效播兩次）。
3. **效果畫在哪裡、鏡頭怎麼動**：全在 client（伺服器只給 id 與 effect）。
4. **沒有實機驗證**（ADR-004）：沒看過真的 client 播這個特效。
5. **`0x29` 沒有其他用途的證據**：`0x23`–`0x25` 是技能／效果家族，`0x29` 只有 effect 0 解出來。

### 4.28 🟡 NPC controller、待機動作與自言自語（2026-10-18更正／ADR-062）

**重要更正**：原節把 `499760` 稱為「走路開關」、`499C00` 稱為「播動畫」、四個s16稱活動範圍，
均不成立。對照 `499D60/49A0C0/49A280/49A3C0/49CBF0` 及 listing 後，這是 controller／idle／speech 鏈。
先前的PASS或原wire形狀不證明舊語意。此次未執行測試／typecheck／browser／VM／probe。
完整證據、實作及server policy見 [NATIVE_NPC_BEHAVIOR](../NATIVE_NPC_BEHAVIOR.md)。

#### 4.28.1 `499760`／`499D60`／`49A0C0`：控制者與待機選擇

`499760(...,1)`開vecctrl controller、清inflight、設 `rand()%8000+4000`；0關controller。
`+250..260` 是CMovePath目前元素 x/y/vx/vy/action/foothold，**不是WZ活動矩形**（見§4.11）。
499D60每tick30ms只讓控制者倒數，無inflight才可能送。靜止NPC也會49A0C0抽選，故3B不能等同走動。
有氣泡、forced action或timer>0不另抽；先重設timer，再於extraActions.length+info.speak.length等權抽槽。
extra i傳i+2及其speak隨機索引；info.speak傳action=-1及池索引。499C00建立normal五秒深紅文字氣泡，非播放動畫。
forced action單次播完回base；每格倒數減30、換格直接重設delay，丟棄overshoot。

#### 4.28.2 `0x2F`／`0x3D`：signed索引與條件路徑

49A3C0寫c2s2F：u32 npcId、s8 action、s8 speech；只有template+8!=0追加CMovePath。
49CBF0已定位template+8來自有效root **move屬性存在**；own info.speak及一跳linked root extra順序有明確來源。
s2c3D由49F5B0先讀id，再49A280讀兩signed byte：action=-1取info.speak[speech]；
action>=0且 **raw<extraCount** 才forced=raw；speech從 **extra[raw].speak**，art40C730卻用 **extra[raw-2]**。
listing保留了movsx、sender+2、receiver raw guard／stride8，**原server是否重寫仍未知**，不能自行補正。
路徑與索引是否有效無關：只要move旗標存在就讀；最後清inflight。
不動模板7bytes；移動模板7+5+14×count。現codec兩種均有，server依本圖metadata決定是否解path。
server目前透明轉送、只允許單一controller報告，**這是明示重建政策，不是已恢復2003 server**。

#### 4.28.3 怪物那一側是同一個機制（順手定位，也是我們的偏離所在）

`0x31`（`sub_4927B0`，154116-154160）＝ `u8 flag` ＋ `u32 mobId`：

- flag 1 → `sub_491630`（152770-152888）：池裡**已有**這個 id 就只刷新，**沒有**就用封包裡的
  `u32 templateId` 建一隻（`sub_48CFA0` 取模板、`sub_4848E0` 建構、`sub_484ED0` 讀身體）——
  兩條路的最後都是 `sub_485330(mob, 1)`，也就是**開始走**（`sub_485520(mob) != 0` 時不動，已經在走）。
- flag 0 → `sub_491830`（152889-）→ `sub_485330(mob, 0)`（停，把 `vecctrl+216` 的移動路徑解掉）→ 再解鏈。
- `0x2F`（`sub_4924A0`）**不會**呼叫 `sub_485330`：它只建立怪物，所以「出現」與「開始活動」在原協定裡
  是兩個封包。

所以 **2003 年的怪物也是 client 自己走的**（一被標成「活著」就自己走，範圍由 client 自己的資料決定），
這與 §4.20「怪物的 AI 在 client 裡」和 §4.11.2「`0x16` 的三個亂數種子決定怪物行為」是同一件事。
我們的伺服器是**伺服器決定**（每條腿一個 `0x33`，§4.16／ADR-008 的例外）：多人同步需要一個權威
（§4.24）。⚠️ 原 client 自己的走動會不會與我們的 `0x33` 打架，**沒有實機證據**（§6 第 14 項）。

#### 4.28.4 伺服器這一側（ADR-062取代舊「所有進圖者都走」政策）

`NpcField.enterPackets()`只送visibility；`FieldInstance`按NPC挑最早在場成員單獨送3B on，保留現有owner，
離場交接，despawn先off再3A，2F通過控制權／sender槽／模板path／長度驗證才含sender廣播3D。
靜止archive-backed NPC預設可控；movable仍需legacy `--npc-walk` opt-in，browser不產生NPC自主走路路徑。
`NpcEntry.walking`／`setWalking`只保留legacy API名，不代表真的在移動。250ms反洪水是重建防護。
新回歸來源 `native-npc-behavior.test.ts` 及npc/world/field/webclient fixture **均未執行**；啟服不是PASS。

### 4.29 ✅ 存檔不是封包：client 只**收**角色紀錄，從不回送

持久化（ADR-017）之所以是**我們的設計**而不是「照封包實作」，是因為協定裡沒有那個封包。證據是本檔案
自己的目錄：**client → server 的遊戲內送包**就是這七個（§4.13 的 sender 表；`src/protocol/field.ts` 的
`CLIENT_FIELD_OPCODE` 是同一份清單）——

| c2s | 語意 | 帶什麼 |
|---|---|---|
| `0x0D` | 與物件互動（傳送門、商店、對話框） | 種類 ＋ 名字／索引（§4.25／§4.22）|
| `0x0E` | 自己走路 | 一條 `CMovePath`（§4.24.2）|
| `0x0F`／`0x10`／`0x11` | 攻擊三兄弟 | 目標與傷害（**client 算的**，§4.13.1）|
| `0x12` | 聊天 | CP949 bytes（§4.26）|
| `0x15` | 對話框的按鈕 | sub-op ＋ 答案（§4.23）|
| `0x2C` | 怪物動作回報 | mobId ＋ 旗標 ＋ 動作 ＋ 一條 `CMovePath`（§4.20）|

**沒有任何一列帶角色資料**：等級、經驗值、HP／MP、道具、錢、`mapId` 全都只在**伺服器手上**那一份
`CharacterData` 裡（`protocol/chardata.ts`），而 client 只在兩個地方**收到**它 —— 登入的 `0x03`
（角色清單，`sub_431080` 一次收 3 份，§4.8）與進場的 `0x16`（`sub_4C2780` 收 1 份，**`mapId` 就是從那裡
決定登入哪張圖**，§4.11.2b）。其他 sender（登入／選角、商城、組隊…）也只帶指令與參數。**玩家掉血同樣
不是 client 回報的**：§4.20.7 說 `0x2C` 的尾段是移動路徑，不是傷害，所以那條路徑在協定裡目前找不到
（§4.20.7；§6 第 5 項把怪物 AI 歸給 client 那一側）。

**結論**：存檔的時機與格式在 2003 年的協定裡**沒有答案可比對** —— 它是伺服器實作自己的事，跟掉落機率
（§4.18／ADR-007）與商店價格（§4.22／ADR-010）同一類。設計與取捨見 **ADR-017**；`src/game/save.ts` 是
它的實作，`server/test/save.test.ts` 是它的規格（來回轉換、拒絕讀不懂的檔案、原子寫入），
`serve.test.ts` 的兩條真 socket 測試則釘住「下線時存一次」與「重啟後同一個角色還在」。

### 4.30 ✅ 「已在線上」與心跳：`0x08` 是 client 唯一保證會回的封包（ADR-018）

`0x01`（以及 `0x02`／`0x03`）的 `result` 有一個值是 **`7`**：client 顯示
「현재 접속중인 아이디이거나,\r\n현재 서버점검중입니다.」（「這個帳號正在線上，或伺服器維修中」）。
這代表**原伺服器會拒絕同一帳號的第二條連線**，而那個行為是 client 自己的設計 —— 訊息字串就是證據
（§4.8 的修正；`LOGIN_RESULT.alreadyConnected`）。這一節記的是「誰在線上」怎麼實作、以及它為什麼需要
一個心跳。

**`0x08` 的地位**（§4.2 的重點，值得單獨寫一次）：`sub_43B170` 是 client 的分派器，而 `0x07`／`0x08`
是它在**看當前 stage 之前**就處理掉的兩個 opcode：

```c
case 7:  sub_43B400(packet);        // 斷線／遷移
case 8:  sub_43B280(this, packet);  // 回聲：讀一個 u32，原封不動送回去
```

`sub_43B280` 沒有條件、沒有狀態、不看 stage —— 所以伺服器在**任何階段**（標題畫面、選角、地圖內）
送 `[0x08][u32]` 都會收到同樣的 `[0x08][u32]` 回來。這是 client 唯一一個「一定有人回答」的封包，
因此也是唯一能拿來量測「這條連線還活著嗎」的東西。

**實作（`server/src/net/`）**：

| 檔案 | 負責 |
|---|---|
| `online.ts` | `OnlineAccounts`：`account → 活著的 session 集合`（一個帳號一個座位）；`SeatKeeper`：一條連線的座位 ＋ 心跳一起拿、一起還 |
| `heartbeat.ts` | 每 `intervalMs` 對「安靜了」的 session 送一次 `0x08`；安靜超過 `timeoutMs`（預設 3 × interval）就 `socket.destroy()` |

- **座位在兩半各拿一次**：`LoginServer` 在 `0x01` 成功時拿、socket close 時還；`GameEntryServer` 在角色
  進場（`0x04` 之後的 `enterField`）時拿、socket close 時還。兩半共用**同一份** `OnlineAccounts`
  （`cli.ts` 傳給兩個 server），因為換到遊戲伺服器是**另一條 TCP 連線**：只有登入那一半會在選角畫面
  待到連線逾時，只有遊戲那一半則認不出「剛登入、還沒選角」的帳號。
- **`0x01` 的拒絕**：`online.sessionsOf(name)` 非空 → 回 `7`，並在日誌寫出**是誰在佔**：
  `login 10.0.0.9:53123 (32s), game 10.0.0.9:53140 (5s)`。玩家申訴「它說我已經在線上」時，
  操作者要的答案就是這一行的兩個欄位。
- **同一個角色兩條連線**（沒有座位也做得出來：兩次 `0x03`、重播的 client、登入伺服器重啟）另外擋：
  `GameEntryServer` 用 `sessionsByCharacter` 記住每個 id 的 session，第二條連線直接關掉。理由不是
  「重複的 id」本身（`FieldInstance.join` 會處理），而是**舊的那條連線會活著但沒有人看見**：
  它還能走、能說話、能打怪，而且兩條連線寫的是**同一個** `CharacterData`（帳號表裡的那一份，ADR-017）。
- **半開的連線**是這個設計唯一的漏洞，而 `0x08` 就是它的答案：任何封包都算活著的證明
  （`heartbeat.note`），安靜太久才問；問了三次不回答就`destroy()` —— 那會讓**所有 close 處理路徑照常執行**
  （座位歸還、`0x1D` 廣播、存檔），跟玩家自己關掉視窗完全一樣。
- **這兩個號碼是我們的選擇**：ping 間隔（預設 30 s）與逾時（3 倍）**不在 client 裡**（client 只負責回答），
  所以是 ADR-018 的設計決策，不是解出來的常數。`--ping <ms|off>` 可以改；`off` 是「相信 TCP」，
  代價是無聲消失的連線會把帳號佔到 OS 發現為止。
- `sub_43B280` 回的那個 u32 本身沒有語意（client 讀進來就送回去，沒有其他地方讀它）—— 本伺服器送一個
  計數器，只為了讓**我們自己的** trace 好讀。2003 年的伺服器送了什麼，client 裡沒有證據。

**結論**：「已在線上」不是我們發明的規則，是 client 的訊息；我們補上的是它需要的狀態，以及讓那個狀態
不會變成永久鎖門的心跳。`server/test/online.test.ts`、`heartbeat.test.ts` 與 `serve.test.ts` 的四條測試
（第二條登入被拒 → 另一個帳號不受影響 → 下線後可以再進；同一個角色第二條連線被關；不回心跳的 session
失去座位；`close()` 立刻歸還座位）釘住這些行為。

### 4.31 ✅ 密語與找人：`0x23` 是「對一個名字的請求」，回包是 `0x1A` 的另外兩個 sub-op（ADR-019）

**2026-10-18 ADR-059更正**：一般聊天走0x1F，密語接收才是0x1A/0x12。以下保留找人／密語的形狀，修正舊氣泡假說。
`0x23` 的每個 byte、`0x1A` 的四個 case，以及伺服器端
「用名字找人」的那一半。

**送出：client 的 `0x23`（`sub_4717D0`）**

三個地方會叫它：`/귓속말 <name> <text>`（`sub_470E10`，`.text:00471385`）、`/헉추적 <name>`
（同一支，`.text:00471009`）、以及聊天輸入框按 Enter 時**已經有密語對象**的那條路（`sub_4F8CB0`，
`.text:004F8F9F`；對象是 `sub_4732D0` 存進 `this + 247` 的名字）。它開頭先擋「一次只允許一個請求」：

```c
if ( *(this + 6) != nullptr ) {                  // 上一個請求還沒被回答
    sub_4FB670(this_3, "다른 요청을 처리 중입니다", 6);   // "正在處理另一個請求"
    return;
}
```

那個旗標（`CField + 24`）由0x09／0x0A回包清掉（**不是**0x12／0x22），也會自己過期：
`sub_4728D0` 在 `timeGetTime() - (CField + 32) > 0xBB8`（3 秒）時把它放掉。所以它是 **client 自己的
UI 節流**，不是協定的一部分 —— 但知道它存在，就等於知道同一個client不會同時送兩個find／whisper（拒收另走472910，不經此gate），
而且它等一個回包最多等 3 秒。

封包本體（`sub_4A1EA0(&buf, 35, 0)` 的第一個 byte 就是 opcode，寫入點在 `sub_4A1F20` 的
`.text:004A1F85`）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| opcode | `u8` | `0x23`（`sub_4717D0` 的 35） |
| kind | `u8` | `0x05` = 找人、`0x06` = 密語、`0x22` = 收到密語後拒收；第二字串是自己的名字 |
| name | `str` | 目標的名字（CP949），**先寫** |
| text | `str` | 只有帶訊息的 kind 才有 |

`kind` 的推導是 `v9 = (v6 + 1) | 4`，其中 `v6` = 「第二個參數（訊息）不是空字串」：

```asm
; .text:00471859   ; eax 是「訊息是空的嗎」(1 = 空)
sete  %bl         ; bl = (eax == 0)  -> 有訊息 = 1、沒訊息 = 0
inc   %ebx        ; 2 / 1
or    $0x4,%bl    ; 0x06 / 0x05
; .text:0047189A
mov   %bl,(%ecx,%eax,1)   ; 寫進封包
```

所以它是 `0x04 | (有訊息 ? 2 : 1)`：`0x04` 是「對一個使用者」這個家族，低兩位元是「有沒有內容」。
第三個kind `0x22`是 `0x20 | 2`：472910收到密語時讀 **CConfig+24的goWhisper**
（listing004729DC確認byte offset18h，不是聊天窗顯示旗標）。開啟則綠字顯示，關閉則送
`[23][22][str sender][str ownName]`。第二個字串來自 `4732C0(4337A0())`，不是訊息。
兩條路都以4732D0記住sender為回覆對象。原GameOpt即為這個選項的UI；不用發明額外開關封包。

**兩個字串的先後**：`sub_4717D0` 先寫第 3 個參數（`.text:004718AD` 的 `sub_430230`）、有訊息時才寫第 2 個
（`.text:004718E4`）。在 `/귓속말` 的呼叫點（`.text:00471379`..`.text:00471385`）第 3 個是
`sub_526370` 的第 1 個輸出，而**那一個**是被 `sub_524A00` 驗證為角色名的字串（`.text:00471366`），
第 2 個才是玩家打的話。所以線上的順序是 **name 然後 text**，跟讀取端的直覺一致。

**回包：`0x1A` 的四個 case（`sub_472910`）**

`sub_472910` 先讀 `u8` 再用 `v8 = (char)ArgList - 9` 進跳表：

| sub-op | 讀取 | client 顯示 |
|---|---|---|
| `0x09` | `str name` + `u32 mapId` | `'name'님의 현재 위치는 'street:map'입니다`；第二個欄位是 **map id**（`sub_4694F0` 拿它載入 `Map/Map/%09d.img` 自己查地名），`0xFFFFFFFF` 才是 `'name'님을 찾지 못했습니다` |
| `0x0A` | `str name` + `u8 flag` | flag≠0 且 client 自己最後送出的文字（`this + 7`，由 `sub_4717D0` 寫入）非空 → `name<< text`；flag≠0 但沒有 → `'name'님께 귓속말을 전달했습니다.`；flag=0 → `'name'님을 찾지 못했습니다` |
| `0x12` | `str name` + `str text` | goWhisper=1：`name>> text`（密語font1綠）；否則送c2s23/22拒收。兩者都把名字存進 `this + 247`（密語的回覆對象） |
| `0x22` | `str name` | `'name'님은 현재 귓속말이 거부되어 있습니다.`（對方拒收） |

⚠️ **三件容易看錯的事**：

1. `0x09` 的第二個欄位**不是**角色 id，是地圖 id（`sub_4694F0` 的參數），所以「找人在哪」不需要伺服器
   送任何地名。
2. `0x0A` **沒有 text**。它顯示的那一行文字是**寄件者自己電腦裡**的那一份（`CField + 28`）——
   2003 年的 client 認為「你剛送出去的東西你已經有了」，所以回包只帶名字與成功與否。
3. **收到的密語是0x1A/0x12，與一般聊天0x1F可區分**。收件者看綠字 `name>> text`；
   寄件者0x0A用本機保留文字顯示 `name<< text`。沒有私訊視窗，不代表wire無分類。
4. **拒收有驅動者**：GameOpt的goWhisper。server在真delivery後允許3秒內的相同sender-session receipt，
   校驗raw own-name、consume後回原sender `[1A][22][str refuser]`。不能憑任意名字偽造拒收。
   這是本專案防偽政策，不是原server證據；goWhisper不存角色save。

**伺服器端（ADR-019）**

| 決定 | 內容 |
|---|---|
| 怎麼找名字 | `sessionNamed`：掃 `sessionsByCharacter`（線上 session 的唯一真相），不另建索引 |
| 「線上」是什麼 | 只有活著的 session 才算：沒有 session 的角色沒有地圖可報、也沒有 client 可送，`0x09` 回 `0xFFFFFFFF`、`0x0A` 回 flag 0 —— 兩個都是 client 的「找不到」訊息 |
| 大小寫 | 比對忽略大小寫（角色建立時 `nameTaken` 就是這樣擋重複的），但**回覆一律用存在的那個拼法**，所以打到 `alt` 會看到 `Alt` |
| 跨圖 | 送達不看成員在哪張圖：`target.send(...)` 走對方自己的連線，這是本伺服器第一個離開「寄件者所在場地」的封包 |
| 拒收與一般聊天 | ADR-059：goWhisper→c2s23/22→s2c1A/22；一般聊天另走1F，與拒收沒有氣泡因果關係 |
| 落地 | 密語**不進存檔**：沒有離線訊息這種東西（`--save` 的格式不需要動） |

**歷史驗證不沿用**：ADR-019原先的socket／CLI結果只描述當時程式，尤其「氣球不回」不能證明錯誤的氣泡假說。
本次已改fixture為實際delivery後拒收、偽造拒收不通知、0x1F公開聊天；腳本舊kind0x22名稱也更正。
依使用者要求沒有重跑任何test／probe。缺少request ID的晚回包仍無法完美關聯，不能冒稱已解。

### 4.32 ✅ 死亡與復活（`부활`）：視窗是 client 的，`0x0D` `kind = 0` 是請求，`0x16` 才是復活（ADR-020）

ROADMAP 的「被怪物打不會掉血」與「死亡」是同一條鏈的兩半，這一節把**兩半各定位到哪裡**寫清楚：
可以實作的那一半（復活＝伺服器換圖＋補滿 HP）已實作，另一半（誰宣告玩家死亡、誰扣玩家的血）
仍然是 OPEN —— 沒有證據的地方不補。

#### 4.32.1 「死了」就是那個動作位元組：`CUser + 180` ＝ 18／19

`CUser + 180` 是動作／姿態位元組（`0x1C` 送進來的 `action` 就是它，§4.11.3；那張值表**沒有解出來**，
所以本伺服器對遠端角色一律送 0 ＝ 站著）。**死掉是 18／19 這一對**：兩個值只差 bit 0，所以每個
判斷都先 `& 0xFFFFFFFE`（`sub_5084C0` 也用 `state >> 1` 去查動作）。

| 函式 | 程式碼 | 意義 |
|---|---|---|
| `sub_50B570`（.c:271786）| `return (*(this + 45) & 0xFFFFFFFE) == 18;` | 「我死了嗎」——`this` 是 `_DWORD *`，所以 `+45` ＝ byte 180 |
| `sub_464580(a1)`（.c:108052）| `(*(this_6 + 180) & 0xFFFFFFFE) == 0x12` → 顯示 **「죽은 후에는 할 수 없는 일입니다.」**（`aE_7`）| 死後禁止做的事（`this_6` ＝ 全域 0x5C2034）|
| 同上 | `a1 != 0 && *(this_6 + 176) > 0` → 「지금은 할 수 없습니다.\r\n숨을 돌리고 다시 시도하세요.」| 那是**冷卻**（`+176`），不是死 |
| `sub_509AF0`（.c:270659）| `*(_DWORD *)(n3000 + 680) == 0` | 場地層級的「還沒有待復活」 |

> `CField + 680` 就是下面那個 2.2 秒計時器。`sub_558CF0`（349622）讀它時寫成 `*(this + 170)`
> （`this` 是 `_DWORD *`）；`sub_4728D0`（121204）是呼叫 `sub_558CF0` 的那一幀（它的 disassembly 直接
> 證明這個物件的 whisper 閘門在 `+0x18`、時間戳在 `+0x20`，與 §4.31 的 `CField + 24／+32` 同一個物件）。

#### 4.32.2 復活視窗 `CUIRevive`：`sub_4E94E0`，一行字＋一個 OK

| 事實 | 證據 |
|---|---|
| 文字 | `aI_6` ＝ 「확인을 누르시면 부활하게 됩니다.\r\n부활을 하시면 안전한 마을로 이동됩니다.」（.c:239955）|
| 版面 | `sub_545450(this, 268, 104, 264, 132, 10, 0)`（.c:239980）—— x／y／寬／高／id |
| vftable | 0x5872C4／0x5872CC／0x587300（三個基底子物件）|
| 單例 | 建好後存進全域 `this_16`（0x5C26A8），`sub_4E9660` 的解構子把它歸零 → 一生只建一次 |
| **什麼時候出現** | `sub_558CF0`（每幀）：`*(CField + 680) != 0` 且 `現在 - 它 > 2200`（**2.2 秒**）→ 建（或叫回）視窗，然後把欄位歸零 |

**誰寫入 `CField + 680`（＝誰宣告玩家死亡）還沒定位** —— 這是這條鏈缺的第一塊，見 §6 第 18 項。

#### 4.32.3 按下 OK：c2s `0x0D` `kind = 0`（`sub_4E9E70`）

```c
LONG *sub_4E9E70()                                    // 0x4E9E70
{
  if ( _RTDynamicCast(dword_5C212C, 0, &CStage, &CField, 0) != 0 )  // 現在是場地階段
    sub_472590(0, nullptr);                            // ← 送出 c2s 0x0D：kind 0、name 空
  sub_545A50(this_16);                                 // 關掉視窗
  ...
}
```

兩個入口：`sub_4E9E20(1)`（callback id 1 ＝ OK 鈕）與 `sub_4E9E30(13, a2)`（**13 ＝ VK_RETURN**；
`27` ＝ ESC 只被吞掉）。所以**復活請求與傳送門是同一個封包**，只差 `kind`（`-1` ＝ 游標下的物件、
`0` ＝ 復活、map id ＝ GM 的 `/헉맵`）。`name` 是空字串（`sub_430230` 對 `nullptr` 會寫空字串，§4.13）。

#### 4.32.4 真正讓人活過來的是 `0x16`（不是任何 HP 封包）

`0x16` 的處理函式 `sub_4C2780`（202598）在同一支函式裡做三件事：`sub_45FCC0` 把封包裡的
`CharacterData` 解出來 → `sub_463050` 之後建**新的場地**（`sub_468D40` → `sub_4C3460`）→ 再建
**新的本機角色**：

```c
202743:      v35 = sub_4772F0(k_5);            // 0x18 bytes 的階段物件
202747:    sub_4C3460(v35, 0);
202752:  k_6 = sub_403350(&dword_5C25F0, 0xA8u);   // 0xA8 ＝ CField
202756:    v38 = sub_468D40(k_6);
202760:  sub_4C3460(v38, (int)&v48);
202767:  result = sub_51CBF0(v39, v42, k_3);   // → 288935: sub_511030(v5, *n16_1) ＝ CUserLocal 建構子
```

⇒ 死掉的動作位元組、屍體與那個視窗都屬於**被換掉的那張圖**；新的本機角色從封包裡的紀錄開始，
而紀錄就是 client 的 HP 條畫的那一份（§4.21）。所以伺服器只要：**先把 HP 補滿，再送 `0x16`**，
不需要第二個封包（ADR-020）。

#### 4.32.5 伺服器端：目的地是 `info/returnMap`，而 client 完全不讀它

`returnMap` 這個字串**在整個執行檔裡出現 0 次**（`grep` 過 `.c`），所以「안전한 마을로（安全的村莊）」是 client
交給伺服器的問題，答案只能在資料裡：`Map/Map/*.img/info/returnMap`（`game/map.ts` 的
`MapData.returnMapId`）。100 張圖的實際分布（`analysis/map_meta.json`）：

| `returnMap` | 張數 | 例子 |
|---|---|---|
| `999999999`（**哨兵**，不是地圖 id）| 25 | 每一個村莊：`1010000` 암허스트（`town = 1`）|
| `100000000`／`101000000`／`102000000`／`103000000`／`104000000`／`105040300` | 65 | 野外圖指向自己的村莊（`001000000` 암허스트서쪽필드 → `1010000`）|
| `1010000`／`40000` | 8 | 早期地圖用的是短 id（`40000` ＝ 달팽이사냥터）|
| （無）| 2 | |

規則（`reviveMapId`，`game/map.ts`）：`returnMap` 是**正整數且不是哨兵**就用它，否則用**當前這張圖**。
哨兵一定要排除：它不是地圖，`loadMapData(999999999)` 回 `undefined`（`test/map.test.ts` 早就釘住了）。
「重進當前這張圖」不是「沒辦法時的降級」而是**真正的復活**（§4.32.4：新的本機角色就是活過來的證據），
所以村莊裡死亡也走得通。

伺服器流程（`GameEntryServer.revive`）：`0x19` 放行閘門（與點擊同一個閘門，`sub_472590` 會把它設起來）
→ HP ＝ maxHp → 目的地讀不到圖就退回當前圖 → `enterMap`（`0x1D` 給舊場地、`0x16` 帶紀錄、`0x1C` 給新場地）。

#### 4.32.6 還缺的一半（OPEN）

- **誰宣告玩家死亡**：`CField + 680` 的寫入者還沒找到（找法：它是一個「時間」，寫入點應該在
  client 判斷 HP ≤ 0 的地方）。在那之前伺服器不會自己送 `0x0D` 的 `hp = 0` —— 那會不會觸發
  這條動畫／視窗，沒有證據。
- ~~**怪物打玩家時誰扣血**~~ → **已解，見 §4.33**：client 自己算傷害，用 **c2s `0x1C`** 回報差值，
  而玩家紀錄的 HP 只有伺服器的 `0x0D` 會寫（§4.21）——所以「被打 → 血條下降」＝
  `sub_5114A0` 回報 → 伺服器套用（`game/vitals.ts`，ADR-021）→ s2c `0x0D`。c2s `0x2C` 裡沒有傷害
  欄位這件事依然成立（§4.20.2），但傷害本來就不走 `0x2C`。
- 死亡的懲罰（掉經驗／掉道具）沒有任何證據，沒有實作。

**驗證**：`map.test.ts`（`reviveMapId` 的三種資料形狀＋真 `Data.wz` 的 `001000000` → `1010000`、
`1010000` 的哨兵）；`serve.test.ts`「a revive restores HP and re-enters a field」用三條真連線跑
「1/50 死亡 → `0x0D kind 0` → `0x19` ＋ `0x16`（50/50、換圖）→ 別人看到 `0x1D`／`0x1C` →
在新圖被第三人看到 → 在村莊再復活一次（讀不到 returnMap → 重進）」。

### 4.33 ✅ 玩家自己的 HP／MP 變動：c2s `0x1C`（client 回報差值，伺服器用 `0x0D` 落帳）（ADR-021）

§4.32.6 缺的那一半：**扣血不需要任何伺服器封包**。2003 年的 client 自己跑怪物 AI、自己算傷害，
把「我掉了多少血」用 **c2s `0x1C`** 回報；而**玩家紀錄的 HP 只有伺服器的 `0x0D` 會寫**（§4.21）。
完整鏈是：`怪物 AI（client）` → `sub_4C8ED0` 算出傷害 → `sub_5114A0` → **c2s `0x1C`** →
伺服器套用 → **s2c `0x0D`** → 血條。

#### 4.33.1 封包：`[0x1C][u32 flags][s16 hpΔ][s16 mpΔ][u8 flag]`（byte-exact）

唯一的寫入者是 `sub_55B870(__int16 hpΔ, __int16 mpΔ, char flag)`（`.c:352187`），它用 `ZArray`
逐段 append；`objdump` 逐 byte 對得上：

| 位址 | 指令 | 意義 |
|---|---|---|
| `.text:0055B88A`／`0055B890` | `push $0x1c` → `call 0x4a1ea0` | opcode byte（`sub_4A1EA0` 的第 2 個參數就是 opcode；⛔ **不是** `sub_43AD50` 加的）|
| `.text:0055B8DD` | `movl $0x1400,(%ecx,%eax,1)` | `u32 flags`：`0x400`＝hp、`0x1000`＝mp（**與 `0x0D` 差異包同一組 bit**）|
| `.text:0055B934` | `mov %cx,(%edx,%eax,1)` | `s16 hpΔ`（傷害是負的：`sub_55B870(-damage, 0, 0)`）|
| `.text:0055B98E` | `mov %cx,(%edx,%eax,1)` | `s16 mpΔ` |
| `.text:0055B9DE` | `mov %cl,(%edx,%eax,1)` | `u8 flag` |
| `.text:0055B9E5`／`0055B9F5` | `mov 0x5c1f70,%ecx` → `call 0x43ad50` | 唯一的送出路徑（§4.2）：加 `0xD3` 標頭 → 加密 → 排入送出佇列 |

⚠️ **`0x0D` 送的是絕對值、`0x1C` 送的是差值**：同一組 `flags`、相反的語意（例如 `-30` ＝ `E2 FF`）。
`flag` byte 的語意未定位：傷害路徑送 0，地圖回復路徑在場地類型 36／37 且 `sub_4BE790(紀錄)` 非 0
（道具驅動）時送 1。

#### 4.33.2 誰送它：傷害（`sub_5114A0`）與地圖回復（`sub_558950`）

`sub_55B870` 全檔只有三個呼叫點：

| 呼叫點 | 情境 | 參數 |
|---|---|---|
| `sub_5114A0`（`.c:277377`）| **玩家被打** | `sub_55B870(-damage, 0, 0)` |
| `sub_558950`（`.c:349512`／`349536`）| **地圖自己的回復** | `(+hp, 0, flag)`／`(0, +mp, 0)` |

**身體碰撞傷害那條路**（**不需要先收到怪物攻擊封包**）：

> 2026-10-18 更正（ADR-076）：舊版把487D10選招寫成這條傷害鏈的第1步，容易誤認主動攻擊命中會走下述HP回報。
> 原487D10→488E30安排的命中callback是vtable005875FC+8／0058767C+8的 **50DEC0**，只以41F8A0
> 把hit art附玩家(0,-30)，不呼4C8ED0／5114A0／55B870，也不設1500ms hurt鎖。
> 選招的conMP／動作0x2C與碰撞傷害不是先後相依。詳[怪物主動攻擊原證](../NATIVE_MOB_ATTACKS.md)。

1. 玩家與怪物的身體RECT重疊，才進下面的碰撞路徑；**不是ball命中或attackAfter觸發傷害公式**。
2. 本機玩家：`sub_511C60`（本機每幀）`sub_491FF0(CMobPool, 自己的矩形)` 找重疊的怪物，
   再 `sub_4C8ED0(n3000+158, n3000+10, mob+136, …)` 算出傷害；`> 0` 就
   `sub_5114A0(this, damage, ±270, -270, 1500)`。
3. `sub_5114A0`：`sub_55B870(-damage, 0, 0)` 回報 → 擊退（`v6[22]`／`v6[23]` 兩個 double）→
   `*(this+90) = 1500`（1.5 秒受擊冷卻）→ `sub_509790(this, 1, 1500)`（受擊動作）→
   `sub_508450(this, -damage)`（傷害數字）。`sub_542F10`（`CVecCtrlUser` vtable **offset 0xC4**
   ＝ slot 49）走同一條路。
3b. **`sub_537B00`＝外力施放瞬間的「clamp式合併」（ADR-107讀完，`.c:315762`）**：把pending的
   兩個double（`+176` x／`+184` y——就是5114A0寫的`v6[22]`/`v6[23]`槽）合併進當前速度
   （`+48` vx／`+56` vy）：**同向且|velocity|已≥|force|→原封不動**（y分支`force<0 && vy<=force`
   →LABEL_23直接跳過store；x分支同型）；否則`v += force`、結果越過force就**clamp在force**。
   `mergeImpulse`（client/contact.ts；累積5114A0／施放537B00兩處同型）與它逐分支相符——
   **不是加總堆疊**：跳躍升力−495（−555 lift＋一格重力60）碰上同時的−270擊退，原生答案是
   −495不動；弱外力既不能抹掉也不能疊上launch。native-locomotion舊釘−765是猜測的堆疊模型，
   已按537B00改回−495（x側0→270照合併，因為那邊velocity較弱）。
4. ⚠️ **這一整條路都不寫玩家紀錄的 HP**。紀錄的 `+53`／`+55`（HP 的 XOR 對）只有這些寫入者：
   `sub_45E0D0`（s2c `0x0D` 差異包，§4.21）、`sub_45D840`（`sub_45FCC0` 讀 `CharacterData`，
   `0x16` 進場時）、`sub_4BDDC0` 與 `sub_518BF0`（道具效果；使用道具／快捷鍵那條路）、
   `sub_4C71C0`（client 自己的升級重算，**這份執行檔沒有任何呼叫點**）。另外 `sub_4C5DC0` 寫的是
   `CWvsApp + 112` 那個「UI 副本」的同名欄位（同樣吃 `0x0D`）。**所以 `sub_5114A0` 只能回報差值，
   血條要等伺服器的 `0x0D`** —— 這就是「誰扣玩家的血」的答案：沒有誰扣，client 算完回報、
   伺服器落帳、再用 `0x0D` 把權威值送回去。

**地圖回復那條路**（`sub_558950`）：每 10000 ms 一次，HP ＝ 道具群組 `1000000`（`sub_4BDD20`）
的值 + 10、MP ＝ `2000000` 的值 + 3，乘上場地的回復率（`v25` 這個 double），只在 `hp < maxHp`／
`mp < maxMp` 時送。⚠️ 它**不擋死亡**（只擋滿血）—— 伺服器端的對應規則是「HP ＝ 0 時不回復」
（見下）。

#### 4.33.3 伺服器端（ADR-021）

- `protocol/field.ts`：`CLIENT_FIELD_OPCODE.statReport = 0x1c` ＋ `readClientStatReport`／
  `encodeClientStatReport`／`describeClientStatReport`。旗標沿用 `0x0D` 的 bit
  （`statDiffFlag("hp")`／`("mp")`，所以兩份封包的 bit 只有一處定義）；**未定位的 bit 直接丟例外**
  （與 `0x0D` 的 panel block 同一條規則）。
- `game/vitals.ts`：`applyVitalReport(stats, report)` 就地套用差值，回傳**只有真的動了的欄位**的
  `StatDiff`（沒動就不送包，與商店／經驗同一慣例）。三條伺服器自己的規則：
  1. 夾在 `[0, max]`（低於 0 的一擊落在 0，絕不會到負的）；
  2. **HP ＝ 0 時不接受正向 HP 差值**（§4.33.2 說 client 的回復不擋死亡，沒有這條規則的話屍體會
     每 10 秒站起來 10 點；真正補滿的是復活那條路，§4.32／ADR-020）；
  3. MP 不受死亡規則影響（MP 不是死亡狀態的一部分）。
- 伺服器**不驗算傷害**：`0x2C` 沒有傷害欄位可對（§4.20.2），傷害公式住在 `Mob/<id>.img/attack<i>`
  與 client 的 `sub_4C8ED0` 裡；原 2003 server 也只能照單全收。要驗算＝在伺服器重寫一份怪物 AI，
  那是另一個決策（ADR-021 列為後續選項）。
- **別人的 HP 條仍然是各自 client 自己的**：遠端玩家的記錄裡沒有 HP 的來源 —— s2c `0x1C`（別人
  進場）只帶 id／名字／外觀／座標（§4.11.3），沒有任何 HP；「某人被打」在別人的畫面上是那個人
  自己的 client 在自己跑怪物 AI 時算出來的（vtable `+184`）。這條維持原樣，不另外發明封包。

**驗證**：`field.test.ts`（黃金 bytes 兩個方向 ＋ 未知旗標被拒）；`vitals.test.ts`（夾、死亡不回復、
沒動不送、NaN）；`serve.test.ts`「a monster's damage lands because the client reports it」用真 socket 走
`-30 → hp 20`、再一次 `-30 → hp 0`、死後 `+10 hp／+3 mp → 只回 mp`、以及復活接回來（50/50、MP 不變）；
`whisper_probe.mjs` 在真 `Data.wz` 上多兩項（`-30` 回 `hp 20`、`-30` 回 `hp 0`）與復活那項的 HP 斷言
（加上 §4.34 新增的 8 項之後，這支探針共 **31** 項檢查）。

### 4.34 ✅ 使用道具：c2s `0x18`（藥水）／`0x19`（地圖道具），效果由伺服器決定（ADR-022／ADR-150）

§4.22 的商店只做到「買進袋子」；用掉那一步是這一節。兩個封包共用同一個形狀，而**道具做什麼**既不在
封包裡、也不在伺服器上 —— 它是 `Item/Consume/0XXX.img/<id>/spec` 那一格，也就是 client 自己讀的效果表。

#### 4.34.1 封包：`[0x18|0x19][s16 slot][u32 itemId]`（byte-exact）

| 位址 | 指令 | 意義 |
|---|---|---|
| `.text:0055B311` | `push $0x18` → `call 0x4a1ea0` | `sub_55B2C0` 的 opcode（用道具）|
| `.text:0055B501` | `push $0x19` → `call 0x4a1ea0` | `sub_55B4B0` 的 opcode（地圖道具）|
| `sub_55B2C0`／`sub_55B4B0` 的 `a2` | `mov %cx` | **`s16 slot`**：USE 分頁裡的欄位編號 |
| 同上，`Args` | `mov %ecx` | **`u32 itemId`** |

⚠️ **分頁位元組不在線上**：`0x18`／`0x19` 只可能來自 USE 分頁，分頁是「送哪一個 opcode」決定的；
`itemId` 是**封包自己宣稱**那個欄位裡有什麼，不是伺服器的帳（所以伺服器一定要拿自己的紀錄再對一次）。

兩個送出者，都用 `itemId/10000` 決定分支（`objdump` 對得上）：

| 函式 | 是誰 | 分支 |
|---|---|---|
| `sub_462DC0`（`.c:107025-107044`）| 道具欄的「使用」（`*(this+3) == 2` ＝ USE 分頁）| `200`／`201`／`202` → `sub_55B2C0`（0x18）；`203` → `sub_55B4B0`（0x19）|
| `sub_512570`（`.c:278062`）| 快捷鍵 | 只有 `200`／`201`／`202` → `sub_55B2C0`（0x18）|

兩個都先過**同一組 client 自己的閘門**（`.c:107025`／`.c:278082`）：`*(this+6) == 0`（沒有在途的請求）、
**本機紀錄的 HP > 0**（死了不給用 —— 和 §4.32 的死亡位元組同一件事），以及節流：**200 ms**（0x18，
`timeGetTime() - *(this+7) >= 0xC8`）／**500 ms**（0x19，`>= 0x1F4`）。這三條都是 client 的規則；伺服器
不能靠它們（見 4.34.5），但要知道它們存在，因為「原 client 送不出來的東西」不需要伺服器擋。

#### 4.34.2 回答：`0x0B`（含「拒絕」）＋ `0x0D` 或 `0x16`

這個 slice 的形狀和 §4.22 的物件點擊完全一樣：**每一個請求都要有回包**，因為 client 的閘門
（`*(this+6)`）是靠回包解開的。`0x0B` 的 `result` byte 由 `sub_55BAB0` 先丟給 `sub_463050(this, …)`
（§4.6），**才**測試內容 —— 所以 `[0x0B][result = 0][count = 0]` 是格式完整、語意為「什麼都沒變」的一包，
那就是這一節選的**拒絕**（不是沉默：沉默會讓玩家連下一罐都喝不了）。

三個真的會發生的結果：

| 結果 | 封包 | 誰寫的 |
|---|---|---|
| 拒絕（沒有 `spec`／`mdd`或未知 buff 欄位沒接／滿血／欄位裡不是那個道具／目的地不是地圖）| **空的 `0x0B`**（`result = 1`）| `handleUseItem` 的 `refuse()` |
| 藥水（`0x18`）：HP／MP 動了 | `0x0B`（`put` 剩下的數量，或沒有了就是 `clear`）＋ `0x0D` 差異包 | `takeItem` ＋ `encodeStatUpdate` |
| 地圖道具（`0x19`）：換圖 | `0x0B`（同上）＋ `0x16` | `takeItem` ＋ `enterMap`（和傳送門／復活同一條路，§4.25／§4.32）|

#### 4.34.3 效果表：`spec` 是 client 自己讀的那一格（全表）

`Item/Consume/0XXX.img/<id>/spec` 的欄位就是**這個檔案裡所有**的消費品效果（`wz dump` 全家族核對過）：

| 家族 | 例子 | `spec` | opcode |
|---|---|---|---|
| 0200 藥水 | `02000000` 빨간 포션／`02000001`／`02000002` | `hp` 50／150／300 | 0x18 |
| | `02000003` 파란 포션／`02000006` | `mp` 100／300 | 0x18 |
| | `02000004` 엘릭서 | `hpR` 50、`mpR` 50 | 0x18 |
| | `02000005` 파워 엘릭서 | `hpR` 100、`mpR` 100 | 0x18 |
| | `02002000`–`02002005` 各種 물약 | `eva`／`speed`／`mad`／`pad`／`acc` ＋ `time` | 0x18→0x0D暫時能力（已接）|
| 0201 食物 | `02010000`–`02010004` | `hp` 30／100／50、`mp` 50／150 | 0x18 |
| | `02010005` | `hpR` 30、`mpR` 30 | 0x18 |
| | `02010006` | `hpR` **`"50"`**（字串！）、`mpR` `"50"` | 0x18（讀不到值 → 拒絕）|
| | `02011000` | `spec` 是**空的** | —（拒絕）|
| | `02012000`–`02012003` | `pad`／`eva`／`mad`／`pdd` ＋ `time` 300000 | 0x18→0x0D暫時能力（已接）|
| 0202 高階藥水 | `02020000`–`02020006`、`02022000`、`02022003` | `mp` 200／`hp` 200／`hp` 100＋`mp` 100／`hp` 400／400／300／500／`mp` 800／`hp` 1000 | 0x18 |
| | `02022002` 사이다 | `pda` 20、`acc` −5、`time` 180000 | 0x18→0x0D（`pda`＝PAD別名，ADR-106）|
| 0203 傳送 | `02030000` 마을 귀환 주문서 | `moveTo` **−1** | **0x19** |
| | `02030001`–`02030005` | `moveTo` 104000000／101000000／102000000／100000000／103010000 | **0x19** |
| 0204 卷軸強化 | `02040000`…（75 個）| **沒有 `spec`**（`info/price` 全是 1）| 兩個 opcode 都不是 |
| 0207 標槍 | `02070000`… | **沒有 `spec`** | — |

兩條規則直接從表裡讀出來：

1. **`info/desc` 會說謊（或至少不精確），`spec` 才是效果。** 빨간 포션 的 `info/desc` 寫
   「HP를 약 50 회복시킨다」而 `spec/hp` 正是 50；엘릭서 的 desc 寫「약 50%」而 `hpR`／`mpR` 是 50；
   파워 엘릭서 的 desc 寫「HP, MP를 모두 회복시킨다」而 `hpR`／`mpR` 是 **100**。所以伺服器讀的是
   `spec`，不是描述文字。
2. **形狀不對的值等於沒有值**：`02010006` 的 `hpR`／`mpR` 是**字串** `"50"`（整份檔案唯一一個），
   照 `wz/props.ts` 的規則（`asNumber`：型別不對就是 fallback）會被當成「這一項沒有」，於是那一罐
   在伺服器上做不了事 → 拒絕。⚠️ 不要「順手」把字串轉成數字：那是在猜原 client 的行為。
3. `moveTo` 的 `−1` ＝「最近的城市」（마을 귀환 주문서 的 `info/desc` 正是「현재 위치에서 가장 가까운
   마을로 귀환」），其他五個是**寫死的村莊 id**；`0204`（強化卷軸）與 `0207`（標槍）連 `spec` 都沒有 ——
   前者本來就不是「用在自己身上」，後者是丟出去用的（`0x1A` 家族，本節不含）。

#### 4.34.4 誰把效果寫進紀錄：`sub_518BF0` → `sub_4BDDC0`（效果表的 loader 仍 OPEN）

§4.33.2 說紀錄的 HP 只有幾個寫入者，其中兩個在「道具」那條路上 —— 就是這裡：

- **`sub_518BF0(this, skillId)`**（`.c:284652`）：`sub_463050` 拿本機紀錄 →
  **動作位元組是 `0x12`／`0x13`（死亡）就 `return 0`**（`if ((*(this + 45) & 0xFFFFFFFE) == 0x12)`，
  和 §4.32 的死亡位元組是同一組）→ `sub_4BDD20(dword_5C2038, 紀錄, skillId, &out)` 查
  **CSkillInfo**（回傳 `<= 0` ＝「沒有學到這個技能」）→ `sub_4BDDC0(this, 紀錄, skillId)` →
  之後是一大串依技能 id 的特例。
  ⚠️ **這裡的歸因在 ADR-150 被更正過。**
  `dword_5C2038` **不是**道具效果表 —— 它是 **CSkillInfo 單例**（`sub_4BA4B0` 是它的建構子，
  寫進去的是 `&CSkillInfo::vftable'`）；`sub_4BDDC0` 也不是「把補血量減掉」，而是
  **技能的「付得起嗎＋付下去」**（`hpCon`／`mpCon`／`itemCon`）。引數也不是 itemId ——
  快捷鍵（`.text:005125E8`）的條目有一個 **kind 位元組在 `+0x94`**：**kind 1 ＝ 技能**
  （進 `sub_518BF0`，**本機算完就結束、不送包**）、**kind 2 ＝ 道具**（去 USE 分頁找那一格，
  送 c2s `0x18`）。見 §4.34.4c。
- **`sub_4BDDC0`**（`.c:197970`）：檢查（`n4_1/1000 % 10 == 0` 就先退貨、等級／HP／MP 門檻、
  `+56` 那個「需要持有 N 個某道具」的欄位）→ 把紀錄的 HP／MP **XOR 對**（`+53^+55`、`+61^+63`）
  用「舊值 − 表值」寫回，中間夾一段自訂 RNG 的混淆（`sub_4619F0`／`sub_48A900`，與 `0x16` 的
  場地亂數同一個引擎，§4.11.2）。
- **呼叫者只有兩個**：快捷鍵 `sub_512570`（它的條目 `kind`：**1 → 只在本機套用、完全不送包**；
  2 → 在 USE 分頁裡找那個 itemId 的欄位再送 `0x18`）與 `sub_4ED340`（帶滑鼠座標的 UI handler）。
- ~~⚠️ **OPEN**：把 `spec` 讀成那張表的 loader 沒有定位~~
  → **ADR-150 已結案，而且結論是「沒有這個 loader」**。名字找不到是因為
  **這支 client 不讀 `spec`**：欄位詞彙只接在技能樹 loader 上，而且詞彙裡沒有任何 rate 欄位。
  所以「原 client 的百分比怎麼取整」不是「還沒找到」，而是**問錯了版本**（§4.34.4c）。
  本專案讀 WZ（`game/items.ts`）的理由也因此更單純：決定權本來就在伺服器，
  `spec` 是給**伺服器**讀的資料，不是 client 的效果表。

#### 4.34.4b ✅ 施用端沒有百分比算術：`sub_4BDDC0` 只是減一個已算好的 WORD

（ADR-150 更正）第 19 項問「原 client 對 `hpR`／`mpR` 怎麼取整」。
**答案是：這支 client 裡根本沒有 `hpR`／`mpR`。** 這節記的算術（減一個已算好的 WORD）是對的，
但它減的是**技能的 `hpCon`／`mpCon`**，不是道具的補血量；而這支 binary 的欄位詞彙裡
**沒有任何 rate 欄位**（`hp`／`mp`／`maxHP`／`maxMP`／`conMP`／`incMHP`／`incMMP` 有，
`hpR`／`mpR` 一個都沒有）。所以「原 client 怎麼取整」這個問題**問錯了版本** ——
`hpR`／`mpR` 是 WZ 有、而 2003 client 從來不讀的欄位（見 §4.34.4c）。

`sub_4BDDC0`（`.c:197970`）是唯一的施用者，它的核心只有兩行：

```c
LOWORD(n4) = (*(_WORD *)(v4 + 53) ^ *(_WORD *)(v4 + 55)) - *(_WORD *)(n4_2 + 48);   // hp
LOWORD(n4) = (*(_WORD *)(v4 + 61) ^ *(_WORD *)(v4 + 63)) - *(_WORD *)(n4_2 + 52);   // mp
```

也就是 **`newHp = hp − entry[+48]`、`newMp = mp − entry[+52]`**，兩個都是直接從效果表條目讀出的
**WORD**，沒有乘 `maxHp`、沒有除 100、沒有任何 rate 欄位。所以：

- （ADR-150 更正）`+48`／`+52` 是 **CSkillInfo 條目的 `hpCon`／`mpCon`**，也就是**技能的代價**
  （由 `sub_4BC590` 的寫入對出來：`p_pvarg_4[12] = hpCon` ⇒ byte 48，`+13` ⇒ 52）。
  它是**被扣掉的**，所以補血的「存成負數」那套說法在這裡不成立。
- 所以「`hpR`／`mpR` 在建表時被解成數字」這句**沒有根據**：這張表是技能表，沒有 rate 欄位。

而查表那一端 `sub_4BDD20`（`.c:197929`）也同樣沒有算術：它是
`__ROR4__(itemId, 5) % bucketCount` 取桶、然後沿鏈走 `v7[2] == itemId` 的純查表，回傳 `v7[3]`
（條目陣列索引）。**兩端都沒有百分比** ⇒ loader 是唯一剩下的地方。

施用端另外三件事（都有原證，不是推論）：

1. **家族閘門**：`n4_1 / 1000 % 10 == 0` 直接 `return 0` —— 千位數是 0 的不是可施放的技能
   （例如 `1100000` 那種 `x000000` 形狀的職業／精通容器）。
2. **「付得起嗎」兩道閘，而且 HP 與 MP 不對稱**（`v7 = *(entry+48)`、`v8 = *(entry+52)`，都以
   signed 16-bit 跟目前值比）：
   - HP：`v7 != 0 && v7 >= hp` → 拒絕。**扣到 0 也不行**（`>=`）。
     讀成代價就是「不能用技能把自己扣死」；如果這是補血量，這條規則就沒有意義。
   - MP：`v8 != 0 && v8 > mp` → 拒絕。**扣到 0 可以**（`>`），只有會扣成負數才拒。
     這個 `>=`／`>` 的差異是 listing 上就有的（`004BDE55 jl` vs `004BDE71 jle`），不是我們的選擇。
     **而這個不對稱正是「這是代價、不是補血」最乾淨的證據。**
3. **「需持有 N 個某道具」**：`entry[+56]` 是 `itemCon`（道具 **id**）、`entry[+60]` 是
   `itemConNo`（**數量**）—— 這個配對是用 `sub_4BC590` 的寫入對出來的
   （dword 14 ⇒ byte 56、dword 15 ⇒ byte 60），`.text:004BDE85 cmp [ebx+3Ch], esi` 也在同一邊。
   `n4 = id / 1000000` 當分頁號（`<= 0` 或 `> 4` 直接拒），然後掃那個分頁數持有量，不夠就拒。
   （反編譯把最後那次比較印成 `+56`，但 `+56` 是 id、`+60` 才是數量，所以比的是 `+60`。）

> 對伺服器的意義：`game/items.ts` 的 `consumeDeltas` 用 `Math.floor` 並且註明「2003 的取整不在
> binary 裡」。ADR-150 之後這句要改成**更強的說法**：不是「不在施用端」，而是
> **2003 client 根本沒有這段算術**（它的欄位詞彙裡沒有 `hpR`／`mpR`）。`floor` 因此不是
> 「還差一處沒查」，而是**我們自己的選擇** —— 而我們必須自己選，因為決定權本來就在伺服器。

#### 4.34.4c ✅ `sub_4BDDC0` 是技能代價檢查，而且這支 client **沒有** client 端的道具效果表（ADR-150）

§6 第 19 項的前提（「`spec` 怎麼被讀成 `dword_5C2038` 那張道具效果表」）**在根上就錯了**。
下面每一條都有原證（`server/test/native-skill-cost-check.test.ts`，10 測試／16 突變全數釘死）。

**一、`dword_5C2038` 是 CSkillInfo。**
`sub_4BA4B0` 是它的建構子，寫進去的是 `&CSkillInfo::vftable'`；`sub_4BAC80` 用
`*(this + 2)`／`*(this + 3)` 那張自己的 ZMap 以 id 取 SKILLROOT。`sub_4BDD20` 則再查
**角色紀錄自己的一張表（`+386` 桶陣列／`+390` 桶數）** 把 id 換成**等級**，然後
**夾到條目陣列的長度**（`*(SKILLROOT + 72)` 的元素數）—— 所以回傳的是**等級**，不是條目索引。

**二、`sub_4BDDC0` 讀的那四格是技能代價欄位。**
條目是 120 位元組、以等級為索引（`sub_4BDDC0` 的 `*(root+72) + 120*v5 - 120` 和
`sub_4BC590` 的 `&pvarg_1[-7] + 30*Value_1 - 2` 是**同一個算式**，30 個 int ＝ 120 bytes）。
把 `sub_4BC590` 的寫入位置對上欄位名：

| byte | dword | 欄位 | `sub_4BDDC0` 怎麼用 |
|---|---|---|---|
| 48 | 12 | `hpCon` | 與目前 HP 比（XOR 對 `+53`^`+55`）|
| 52 | 13 | `mpCon` | 與目前 MP 比（XOR 對 `+61`^`+63`）|
| 56 | 14 | `itemCon`（**道具 id**）| `/1000000` 取分頁號，須在 1..4 |
| 60 | 15 | `itemConNo`（**數量**）| 與持有的總數比 |

**三、HP 與 MP 的不對稱就是「這是代價」的證據。**
`004BDE55 jl`（`hpCon < hp` 才繼續）vs `004BDE71 jle`（`mpCon <= mp` 就繼續）。
也就是 **HP 不能扣到 0、MP 可以扣光**。補血道具不會想要這條規則。

**四、快捷鍵有 kind，兩條路完全分開**（`.text:005125E8`，`[eax+ecx*8+94h]`，stride 8）：

| kind | 走哪 | 送包？ |
|---|---|---|
| **1** | `sub_518BF0(this, *(quickslot+0x98))` → `sub_4BDDC0` → **本機扣完就 `retn 4`** | **不送** |
| **2** | 在 USE 分頁找那一格 → `sub_55B2C0`（c2s `0x18`）| 送，效果由伺服器決定 |

所以 `sub_518BF0`／`sub_4BDDC0`／`sub_4BDD20`／`dword_5C2038` **整條都是技能那一路**。

**五、這支 client 不讀 `spec`。**
- 欄位詞彙（那 34 個字面字串）**只接在 `sub_4BB270` 的技能樹 loader 上**（`sub_4BC590` 只有一個
  呼叫點），而且裡面**沒有任何 rate 欄位**：有 `hp`／`mp`／`maxHP`／`maxMP`／`conMP`／
  `incMHP`／`incMMP`，**沒有 `hpR`／`mpR`**。
- `spec` 這四個字在兩種編碼（UTF-16／ASCII）下**都是 0 次**。
- 全 binary 只有三個 `Item/` 路徑模板：`Item/%s/%04d.img`（通用圖示／info）、
  `Item/Special/0900.img`、`Item/Book/0500.img/05000000/info/icon` —— 沒有 `spec` 那一路。

⇒ **結論**：`spec/hpR` 是 **WZ 有、2003 client 從不讀**的欄位（我們的 `game/items.ts` 讀得到，
因為我們讀 WZ）。原版是**伺服器**把百分比解成數字、再用 `0x0D` 把結果送回來。
所以第 19 項「原 client 怎麼取整」**沒有答案可查** —— 是問錯了版本，不是「還差一處沒查」。

#### 4.34.5 伺服器端（ADR-022）

- `protocol/field.ts`：`CLIENT_FIELD_OPCODE.useItem = 0x18`／`useMapItem = 0x19`、
  `USE_ITEM_OPCODES`、`readClientUseItem`／`encodeClientUseItem`／`describeClientUseItem`（分頁不在線上，
  所以唯讀的只有兩個欄位；未知的 bit 一律丟例外，與 §4.21／§4.33 同一條規則）。
- `game/items.ts`：`consumeSpecOf`（`Item/Consume/0XXX.img/<id>/spec` → `ConsumeSpec`；
  未定位的欄位收進 `unapplied`，讓**用不到的 buff 道具被拒絕而不是半套用**）、`healsVitals`、
  `consumeDeltas`（`hp`／`mp` 是定值、`hpR`／`mpR` 是**上限的百分比並向下取整** —— 半點 HP 不是血條能畫的
  東西，這是伺服器的選擇，原 client 的取整方式未定位）、`consumeSpecProvider(archive)`。
- `net/loginserver.ts` 的 `handleUseItem`／`useMapItem`：**先查 spec → 再驗「真的會動」→ 最後才扣道具**
  （滿血喝藥水不會浪費一罐；`0x19` 的目的地用 `fields.of` 先驗，換不到的圖不會把卷軸吃掉）。
  `moveTo < 0` 用 `reviveMapId(地圖)`（§4.32 的同一個答案：`info/returnMap`，村莊的哨兵
  `999999999` 就是「重進這一張」）。
- `--start-mesos <n>`（**新角色**的起始錢，預設 0 ＝ 2003 年新角色的樣子；沒有它就買不了東西，
  所以這是一個明講的伺服器選擇，與掉落率同一個層級）。
- `game/shops.ts` 的三間店：`1010100` 리나（헤네시스）、`2003` 로빈（달팽이사냥터）、
  **`12100` 마이（암허스트）**；三間都賣 마을 귀환 주문서（75），마이 還賣 헤네시스 귀환 주문서（90）——
  前者是「新角色真的能到得了的店」（`--map` 的 1000000 → 1010000 就是復活也會去的那個村），
  後者是**指名一張圖**的卷軸，所以「用道具換圖」在測試裡是可觀察的。

#### 4.34.6 驗證

- `test/items.test.ts`（6 個，手寫 fixture 的 archive）：`spec` 的每一種形狀（定值／百分比／向下取整／
  buff 進 `unapplied`／`moveTo`／空 `spec`／沒有圖／不是道具 id／`--data off`）與**滿血時什麼都不該發生**。
- `test/field.test.ts`：`0x18`／`0x19` 兩個方向的黃金 bytes（`18 0300 80841e00`、`19 0100 b0f91e00`）
  與兩個陷阱（第三種 opcode、超出 u32 的 id）。
- `test/serve.test.ts`「using a USE-tab item…」：真 socket 走完**買（`0x4A` 三列含 2030000@75）→
  喝一罐（`0x0B` `put` 剩 1 ＋ `0x0D` hp 50）→ 滿血再喝（**空的 `0x0B`**，罐子還在）→ `0x1C` 打一拳
  → 喝掉最後一罐（`0x0B` `clear`）→ 空欄位（拒絕，且**沒有**後續封包）→ 捲軸（`0x0B` `clear` ＋
  `0x16` → 1010000）→ 欄位已空（拒絕，沒有第二個 `0x16`）**。
- `test/shops.test.ts`：「三間店的每一列都有 `info/price`」之外多一條**「每一列用起來都有事做」**
  （每個 id 的 `spec` 非空、而且不是回血就是命名一張圖）。
- `server/scripts/whisper_probe.mjs`（**31** 項，新增 8 項）：在真 `Data.wz` 上從 마이（池 id 從 `0x39`
  的模板欄位認出來）開窗、確認 헤네시스 귀환 주문서 標的是**存檔裡的 90**、買下去看 `0x4B silent` ＋
  `0x0B put` ＋ 錢包 `200 → 110`、用掉看 `0x0B clear` ＋ `0x16` 真的進 `100000000`。這一段需要
  `--start-mesos 200`（否則只印一行提示跳過）。

### 4.35 ✅ 表情：c2s `0x13`（自己的臉）與 s2c `0x27`（別人的臉）（ADR-023）

§4.11.7 的 `CUserPool` 分支表裡 `0x27` 一直只寫著「u32 → 動作／姿勢切換」；這一節把它接回**按鍵**那一端，
並且把「哪九張臉」直接從執行檔讀出來。

#### 4.35.1 c2s `0x13`：`[0x13][u32 emotion]`（byte-exact）

唯一送出者是**按鍵分派器** `sub_511E20`（`.text:00511FDF` 的 `push $0x13` + `call 0x4a1ea0`；整個函式只有
這一個 `0x13`）。它的 switch 由**按鍵類別表**決定（`.data:0x512260[key - 16]`，key ∈ 16..123）：

| 類別 | 按鍵 | 做什麼 |
|---|---|---|
| 0–9 | Shift／Ctrl／Alt／PageUp／PageDown／End／Home／↑／Insert／Delete | 各自的單鍵行為（case 0..9）|
| **10** | **F1–F12（VK 112–123）** | **表情**（case 10）|
| 11 | 其餘 86 個按鍵 | 一般按鍵（移動／攻擊／道具…；同一個函式在別的 case 裡呼叫 `sub_512F90`（`0x0F`）／`sub_513C80`（`0x10`），所以「攻擊家族入口」與「表情」是同一個按鍵分派器的不同 case）|

case 10 的兩道警衛是 `if (key == 119) return 1;`（F8 什麼都不做）與 `(unsigned)(key - 111) <= 8`，所以
**F1..F7 送 1..7**（`key - 111`），F9..F12 連送都送不出去（`key - 111 > 8`）。順序才是重點：

```
.text:00511FD8  call 0x509790          ; CUser::SetFace(this, key - 111, -1)  <- 先套在自己身上
.text:00511FDF  push $0x13             ; 才組封包
.text:00511FEA  mov 0xac(%esi),%esi    ; 寫入的是 CUser+172（剛被 SetFace 寫過的那格）
```

⇒ **送出的人不需要伺服器就能看到自己的表情**，這也是伺服器只廣播給別人的理由（4.35.4）。封包本體只有
一個 `u32`：`CUser + 172`。`sub_509790` 的參數是 `unsigned`，`n8 <= 8` 的檢查在它裡面，`objdump` 的
`cmp $0x9,%eax` / `jge` 對得上（-1 ＝「沒有表情」）。

#### 4.35.2 九張臉：`.data:0x5B20D8` 的九個 `wchar_t*`（＝ `EMOTION_NAMES`）

`CUser + 172` 是索引，`-1` ＝沒有：建構子 `sub_507680` 寫 `-1`，`CUser::SetAvatar`（`sub_508260`，
就是 `0x1C` 第一個 u32（**臉**）與外觀清單收下的那一位，§4.11.3c）換裝時寫 `-1` 再
`sub_509790(this, 0, -1)`。

| 索引 | 名稱（`Character/Face/%07d.img` 的子節點）| 誰會用 |
|---|---|---|
| 0 | `blink`（平常、眨眼）| 預設；畫圖端 `n8 > 8` 也夾回 0 |
| 1 | `hit`（被打）| **client 在被打時自己用**（`sub_5114A0`：`sub_509790(this, 1, 1500)`，1500 ms）|
| 2 | `smile` | F2 |
| 3 | `troubled` | F3 |
| 4 | `cry` | F4 |
| 5 | `angry` | F5 |
| 6 | `bewildered` | F6 |
| 7 | `stunned` | F7 |
| 8 | `vomit` | 沒有按鍵（`n8 <= 8` 允許，F1..F7 到不了）|

兩份互相印證的證據：`.data:0x5B20D8` 是九個 `wchar_t*`（`0x5B254C` `blink`、`0x5B2544` `hit`、
`0x5B2538` `smile`、`0x5B2524` `troubled`、`0x5B251C` `cry`、`0x5B2510` `angry`、`0x5B24F8` `bewildered`、
`0x5B24E8` `stunned`、`0x5B24DC` `vomit`；讀法：`objdump -s --start-address=0x5B20D8` 的九個指標 ＋ 各自指向的
寬字串），而畫臉的 `sub_408400` 正是用 `(&off_5B20D8)[n8 > 8 ? 0 : n8]` 取名字去查臉圖；`Data.wz` 的
`Character/Face/00020000.img` 子節點也正好是 `default` 加這九個（`wz dump` 印得出來）。索引 1 兩邊都對得上：
client 被打時給自己 `1`，而表上第 1 個就是 `hit`。

⚠️ 名稱只有這些英文節點名，**沒有韓文對應**：`기쁨`／`슬픔`／`화남`／`눈물` 在 `.exe` 與 `Data.wz` 裡都
找不到（按鍵設定不在資料檔裡），所以文件與程式一律用這九個節點名，不替它們編譯名。

#### 4.35.3 s2c `0x27`：`[u32 characterId][u32 emotion]`

`sub_51D590` 的 case `'\''`（0x27）：範圍分派器先讀 `u32 characterId` 並用 `sub_51CD30` 在池裡查
**（查不到就整包丟掉**，所以對一個不在場的角色送它是安全的），再讀一個 `u32` 交給
`sub_509790(user, emotion, -1)` —— 和 c2s `0x13` 的送出端是**同一個函式**，所以兩邊對「0..8 才是臉」的
判斷一致（`sub_509790` 的 `n8 <= 8` 與 `(n35 != 33 && n35 != 32 || n8 != 8)` 那道護欄）。

#### 4.35.4 誰該收到它（ADR-023）

- **送出的人不要收**：client 已經自己套用過了（4.35.1 的順序），回送只會把同一個值再設一次；這與
  `0x22`（自己的移動路徑）與 `0x29`（自己的升級特效，ADR-015）是同一條規則。
- **被打的 `hit` 不用送**：每個 client 都在本機自己算怪物傷害（§4.33），「別人被打」在別人畫面上也是
  那個人自己的 client 算出來的 —— 伺服器沒有、也不需要這個事件的來源。
- **沒有回包義務**：表情不像點擊或使用道具，client 沒有在途請求閘門，所以不合法（> 8）的值直接丟掉並
  記一行日誌，而不是回一個空包。
- **狀態不用記**：臉是「現在的樣子」而不是伺服器要保存的東西 —— 換圖時不會重送（新進場的人本來就從
  `0x1C` 的紀錄開始畫），存檔也不動。

#### 4.35.5 s2c `0x1F`一般聊天與normal/dead氣泡（ADR-059，已編輯、未測試）

`51D530`讀u32 id、`51CD10`找self／remote、`50B320`讀string；未知id丟棄。
`50B320`把 `%s : %s` 的**完整字串**先送白字StatusBar，再交 `4373A0` 顯示5000ms。
4373A0／4386E0與WZ `UI/ChatBalloon.img/normal|dead`確認84px換行、12px cells、14px列、
單行奇數欄最多7、多行7欄、原十片圖、alpha224；head anchor由avatar canvas原點計算，root z250210。

**刪除舊假說**：c2s23/22是goWhisper拒收，與1F沒有驅動關係。公開聊天的server送出政策見§4.26；
GameOpt、64換行record、五秒reader自動追尾、字體與完整Gr2D限制見 [交叉證據](../NATIVE_GAME_OPTIONS_CHAT.md)。

### 4.36 ✅ 道具欄的拖放：c2s `0x17` ＋ 兩個回答（`0x0B`／s2c `0x28`）（ADR-029）

§4.22 的商店把東西放進袋子、§4.34 讓藥水生效；這一節是**玩家自己搬東西**：雙擊裝備、拖到另一個格子、拖到
已穿戴的位置、丟到地上。四種動作由**同一個送出者**負責，而它的四個參數就是線上的四個欄位。

#### 4.36.1 封包：`[0x17][u8 tab][s16 fromSlot][s16 toSlot][s16 count]`（byte-exact）

`sub_55ACB0`（.c:351477）依序 append `a2`(u8)、`a3`(u16)、`x`(u16)、`ArgList`(u16)，opcode 23 ＝ `0x17`
（`.text:0055AD01` 的 `push $0x17` ＋ `.text:0055AD07` 的 `call 0x4a1ea0`）。四個呼叫點一一對應：

| 送出者 | 什麼動作 | 線上四格 |
|---|---|---|
| `sub_4636B0`（.c:107381）| 雙擊裝備（能力不足先跳 `현재 능력치가 낮아서…`，**不送**）| `1, 格, -部位, -1` |
| `sub_4630A0`（.c:107062）| 裝備分頁裡的拖放（兩端都可能已穿戴）| `1, from, to, -1` |
| `sub_463A50`（.c:107536）| 任何分頁裡的拖放（from/to 由滑鼠決定，兩者相等時先 return）| `tab, from, to, -1` |
| `sub_463BE0`（.c:107607）| 丟到地上（問過「몇 개나 버리시겠습니까?」之後）| `tab, from, 0, 數量` |

- `tab`：1 裝備／2 消耗／3 其他／4 現金（`INVENTORY_TAB`，與 `CharacterData` 的順序同一套）。
- **負的格子 ＝ 已穿戴**，號碼與 itemId 的部位碼同一套（`-1` 帽子、`-11` 武器、`111xxxx` 可到 `-12`/`-13`，§4.11.3d）。
  雙擊那條路的部位是**游標所指的那一格**（`sub_463490` → `n2_1 = sub_4D9110(x, y)` → `sub_4636B0(this, *(this+4), n2_1)`），
  而且送出前客戶端自己比對過 itemId 的 part code 與游標那一格（`switch (itemId / 1000 / 10)`，不符就 return）——
  所以「哪個部位」是請求的內容，不是伺服器猜的。
- `count`：三個搬移送出者都送**字面上的 `-1`**（整格）；只有丟棄帶數量，而那個數量是**問出來的**
  （`sub_4643F0(asc_5B578C, 堆疊數)`，`몇 개나 버리시겠습니까?`）——除了兩種例外：`tab == 1`（裝備分頁）
  時它直接用 `1`，`itemId / 10000 == 207` 時直接送**整疊**（家族未查）。所以「丟幾個」是客戶端的選擇，
  伺服器只把它跟堆疊數比對（§4.36.3）。**ADR-100 複核：`sub_55ACB0` 全 EXE 只有這四個呼叫點**
  （`.c:107253`／`107530`／`107603`／`107698`）⇒ 這版 client **沒有**「把一疊拆到另一格」的搬移送出者；
  背包內唯一的拆分就是丟棄（帶數量）與合併溢出的餘量（§4.36.3 第六條）。
- ⚠️ **能力需求不在這裡**：`sub_4636B0` 用 `sub_4C5020`／`sub_4C5420` 算出的角色總和，比對 `sub_465A30(itemId)`
  的 `reqSTR/DEX/INT/LUK/level` 與職業位元（`sub_4657F0(itemId) ∈ {0,30,31,32,33,37,38}`）以及性別位
  （`itemId / 1000 % 10` 對 `record + 17`）。這是客戶端自己的規則，伺服器照抄只會多一份沒人能驗的第二份規則。

#### 4.36.2 客戶端自己不搬，而且它有閘門 ⇒ 拒絕一定要回包

- 四個送出者都**不動客戶端的道具欄**：`sub_55ACB0` 只組包、送出，然後把 `CWvsApp + 0x18` 設成 1
  （`.text:0055AE70`）。
- 每個送出者開頭都檢查那一格 ＋ 500 ms 節流 ＋ 本機 HP > 0（`sub_463A50`：`n3000[6] != 0 || (HP 的那兩個
  byte) <= 0 || timeGetTime() - n3000[7] < 0x1F4` 就 return 0）。
- 能清掉那一格的**只有 `0x0B`**：`sub_55BAB0` 在 `result != 0` 時 `movl $0x0,0x18`（`.text:0055BB0C`，§4.6）。

⇒ 這個 slice 的拒絕**必須是空的 `0x0B`**（`[0x0B][1][0]`）。沉默會讓閘門永遠關著，玩家第一次被拒之後整個
道具欄就再也不能互動——這與 §4.34.2 的 `0x18`／`0x19` 是同一條規則，也是「原 client 沒有回包義務」那些 opcode
（§4.35.4 的表情）與這一族的分界。

#### 4.36.3 伺服器端（ADR-029）

`applyChangeSlot`（`game/inventory.ts`，純函式）先判定再寫入，答案只有兩種：`{kind:"done", changes, lookChanged}`
或 `{kind:"failed", reason}`（`reason` 只進日誌——線上沒有結果位元組）。判定順序：

| 條件 | 拒絕值 |
|---|---|
| `tab ∉ 1..4` | `unknownTab` |
| `fromSlot == 0` | `slotOutOfRange` |
| 負格但 `tab != 1`、或 `\|slot\| > 14`、或超過該分頁的格數 | `slotOutOfRange` |
| `count != -1`（地面以外的四種動作） | `badCount` |
| 來源格是空的 | `emptySlot` |
| 來源格的道具不屬於那一格（裝備分頁放了消耗品／部位不符）| `itemNotInTab`／`wrongPart` |
| 目的格的道具放不回來源格（互換不可能）| `displacedItemDoesNotFit` |
| `toSlot == 0` 而 `count` 不是 `1..堆疊數`（裝備只能 1）| `badCount` |
| `toSlot == 0` 而來源是現金道具（`cash != null`）| `cashItem` |

成功時的 `changes` 就是 `0x0B` 的內容（目的格 `put`、來源格 `clear`；兩格都有東西就是兩個 `put`），
`lookChanged` ＝「動到了負格」，呼叫者據此送 `0x28`（§4.11.8）。決策記在 ADR-029：**只驗結構不驗需求**、
**兩格都有東西 ＝ 互換**、**丟到地上有落地規則**（第 4 點的追加見 ADR-029 追記；「現金裝備不動」已被
ADR-105 以 binary 證據推翻——現金裝備照普通裝備穿，`wornCash` 才是不可動的伺服器回聲組，§4.36.6）。
**第六條：同種可疊道具拖到同一種上 ＝ 合併，不是互換（ADR-100）**。client 從不自己搬（§4.36.2），
2003 server 對「一疊丢到同一種上」的處置因此不可證，是伺服器政策：目的格先補滿到 `MAX_ITEM_STACK`
（＝`grantItem` 撿拾／購買疊加用的同一個上限，`game/rewards.ts`），來源格留剩餘——總和 ≤ 上限時是
`put(目的格, 總和)`＋`clear(來源格)`，超過時是兩個 `put`（目的格＝上限、來源格＝餘量）；一個拖放
**絕不銷毀道具、也不需要拒絕**。現金道具（各帶序號，合併會少一個）與裝備（不可疊，同 id 也是兩件）
維持原互換分支；合併只發生在兩正格之間，`lookChanged` 恆為 false。

**丟到地上那一條路**（`toSlot = 0`，`sub_463BE0`）多一個答案而不是一個拒絕：`applyChangeSlot` 回
`{kind: "drop", slot, count, changes, lookChanged}` —— `changes` 是 `0x0B`（整疊丟掉是 `clear`、丟一部分是
同一格重 `put`），**地面上那一半屬於場地**（呼叫者做 `FieldInstance.dropItem` → `0x43` `kind 2` 給全場、
**包含丟的人**：客戶端從來沒在地上畫過它，那一包才是它第一次出現在畫面上的原因）。`slot` 是**那件道具本身**
（數量已改成丟出去的量），落地紀錄因此留得住物件——撿回來的是同一件（`game/rewards.ts` 的 `freshSlot`）。
動到負格時照樣要 `0x28`（把武器丟到地上 ＝ 脫掉它，§4.11.8）。

#### 4.36.4 驗證

- `test/field.test.ts`：`0x17` 與 `0x28` 的 golden bytes（`-1` 的 s16、flags 驅動的可選欄位、清單結尾的 0、
  清單含 0 會被拒）。
- `test/inventory.test.ts`：十個純函式案例（裝備／卸下／換位／互換／**丟到地上：丟一部分與整疊、
  裝備只能 1、現金道具與 `count` 不合理的拒絕**／邊界與各拒絕值）。
- `test/drop.test.ts`：玩家丟的東西（`dropFromPlayer`）——落點就是玩家、沒有怪物區塊、`0x43` 15 bytes、
  「沒動過的人撿不到、動過的人撿得到」、以及**模板欄位留著**（`ruc = 4` 的武器原樣回來）。
- `test/serve.test.ts`「a throw-away answers 0x0B and puts the item on the ground for the whole map」：丟 4 瓶藥水
  → 自己收 `0x0B`（同一格 `put` 剩 6）＋**自己與觀察者都收 `0x43`**（`kind 2`、15 bytes、沒有 `mobId`）
  → 站著不動**不會**被自己撿回來 → 走開 80 px 也不會 → 走回去才 `0x44 kind 2`（含自己的 id）＋`0x0B`
  （回到 10 瓶）＋`0x11`；`count = 0` 的請求是空的 `0x0B`，地上不多一筆。
- `test/serve.test.ts`「equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map」：同場兩人，
  穿戴者收到 `0x0B`（`put(-1)` ＋ `clear(2)`）、觀察者收到 `0x28`（清單從 `[30000]` 變成 `[30000,1002000]`）、
  穿戴者**沒有**自己的 `0x28`、紀錄本身（同一個物件）的 `worn[1]` 是那頂帽子、同一個拖放再送一次是空的 `0x0B`。

#### 4.36.5 還缺的一半（OPEN）

- **地面壽命與拾取仍是伺服器政策**：躺多久（`DROP_LIFETIME_MS` 300 s）、誰能撿（同圖＋40/60 px
  reach＋「必須在這筆掉落之後動過」，§4.18.6 第 5 點）都未由 binary 恢復。玩家楓幣丟棄已有 client sender：
  c2s `0x1F`（`sub_55D5F0`，§4.18 supplement）；它和 `0x17` 道具丟棄分開處理。`0x43`／`0x44` 的呈現端
  client logic 已由反編譯碼解出，但原 server pickup/lifetime policy 仍需 oracle（ADR-007）。
- ~~**現金裝備**~~：**已由 ADR-105 結案（§4.36.6）**——穿戴路上沒有原生 cash 閘門，現金裝備照普通裝備穿；
  `wornCash` 沒有任何 client sender 能指到（`sub_465710` 的負槽只映到普通 worn 組），維持伺服器專屬回聲組。
  **丟到地上的現金道具仍然拒絕**（`cashItem`——序號只存在道具欄那一格，落地紀錄沒有地方放它；原生
  `sub_463BE0` 自己也拒：`sub_47A420` 讀 WZ `info/cash`，再加序號非零。寧可少丟一件，也不要送一個會
  讓客戶端丟 `AVCDisconnectException` 的 `0x0B`（§4.6 的收尾檢查））。
- **裝備的能力加成**：~~客戶端自己算傷害（§4.17），所以伺服器不重算武器攻擊力~~；**這句已過時**：伺服器現在照
  `sub_4C7960` 算（`game/nativecombat.ts`，§4.51），用的正是裝備**實例**的 PAD；「換武器 → 攻擊動作家族改變」那條路
  （c2s `0x0F`／`0x10`／`0x11` 的選擇）也在客戶端，本伺服器不干預（§4.11.7c）。

#### 4.36.6 ✅ 現金裝備／戒指格 12・13／寵物家族（ADR-105，結案）

§4.36.5 曾把「穿戴格 12／13 在這一版 client 裡畫不出來，要先知道原伺服器怎麼用它」列為硬問題。
這一輪把整條家族從 binary 讀完，答案是：**問題本身問錯了方向**——`wornCash` 不是「穿戴格 12／13」，
穿戴格 12／13 屬於普通 worn 組（戒指），而這一版根本沒有戒指內容。逐條證據：

- **雙擊穿戴的部位表就是 `sub_463490` 的 switch**（`.c` 107258 起；先前只讀過它的下游 `sub_4636B0`）：
  `sub_4D9110(x, y)` 先把點擊座標映到裝備窗的格子（32×32 命中框、`dword_5BC3DC` 前的座標表——
  `client/equipment.ts` 的 `EQUIP_SLOTS`/`equipSlotAt` 就是這張表），然後 `switch (itemId / 10000)`：
  case `'d'`..`'n'` = 100..110 → 格子必須是 1,2,3,4,5,5,6,7,8,**10**,**9**（盾 109→10、披風 110→9），
  `default` 分支收 `itemId / 100000` ∈ {13, 14}（武器）→ 格子 11，其餘一律 `return 0`。
  switch 之前還有一條性別檢查：`(itemId / 1000) % 10` 必須是 2（中性）或等於角色性別（角色性別 2 略過）——
  與 `canWear` 既有的性別規則逐字相同。
- **case `'o'`（111xxxx，戒指）有兩個原生 sender**：點到格子 12 → `sub_4636B0(this, item, 12)`；
  點到格子 13 → `sub_4636B0(this, item, 13)`（hardcoded）；其他格子拒絕。也就是說「12 或 13 由玩家點的
  格子決定」，id 本身推不出單一部位——`bodyPart(111xxxx)` 維持 0，新 helper `partFitsItem(part, id)`
  （`client/equip-rules.ts`）攜帶這條雙格規則，`canWear` 與 `applyChangeSlot` 的 `fits` 都改用它。
  **但 Data.wz 沒有任何 `Character/011*.img`**（Accessory 目錄只有 0101/0102/0103 開頭）——這一版沒有
  戒指內容，sender 存在而道具不存在；結構層照原生收（-12/-13 的 `0x17` 不再 `wrongPart`），
  需求層照舊（沒有 WZ 條目 → `--data` 世界的准入拒絕，與其他未知 id 相同）。
- **墜飾 112xxxx 不可穿**：switch 的 `default` 只收 13/14，112 → `return 0` ✓（`bodyPart` → 0 已是忠實）。
  格子 14 在 switch 裡沒有任何 id 對映（encode 迴圈寫 1..14，但雙擊表到 13 為止）。
- **穿戴路上沒有 cash 閘門**：`sub_47A420`（WZ `info/cash` 讀取者）全 EXE 只有三個呼叫點——
  `sub_463BE0`（丟棄拒絕：`info/cash != 0 || 序號 != 0`）、CUIItem 的交換／移動拒絕
  （同前兩條再加 `itemId / 1000 == 4031`，配字串「이 아이템은 다른 캐릭터와 교환하거나 옮길 수 없습니다」）、
  `sub_4B4AD0`（清單建造者，只收 `info/cash == 0 && 序號 == 0 && 非 4031` 的道具）。**沒有一個在
  雙擊／拖放穿戴鏈上**；`sub_463490` 的 switch 與 `sub_4636B0` 全程不讀 `info/cash`，`sub_4C5020`
  （有效裝備集合）也不讀。所以現金旗標裝備（如 1002000 갈색 항공 모자，WZ `cash=1`）在原生 client
  就是照普通裝備穿進它部位的 worn 格——`canWear` 移除 `facts?.cash || item.cash` 拒絕
  （原「此裝備部位或現金裝備尚不支援」縮回「此裝備部位尚不支援」，只擋部位）。
- **`wornCash`（client +254）是伺服器專屬回聲組**：`sub_465710`——所有 sender／4C5020 共用的道具存取器——
  對 tab 1 的負槽做 `this + 126 + 8k`（k = -slot），也就是 -1..-14 **只映到普通 worn 組**（+134..+246），
  並以 `a4 < -14` 夾住；+254 那組在整個 EXE 裡只有 `sub_45F610`（encode）讀、`sub_45FCC0`（decode）寫，
  沒有任何 UI／渲染／狀態取用者。結論：沒有一個 `0x17` 能指到 `wornCash`（tab 4 負槽照舊
  `slotOutOfRange`——那不是限制，是原樣），原伺服器怎麼填它已不可觀測（現金商店流程隨伺服器消失），
  本伺服器的遊戲路徑也不填它。它唯一被消費的地方是外觀清單：`avatarItemsOf` 把 `wornCash` 的 id 接在
  worn 之後（`sub_45F340` 同部位「最後一個贏」，現金外觀因此蓋過普通外觀——機制是原生的，
  「原伺服器有沒有這樣填」是選擇，已記入 ADR-105）。
- **111xxxx 的外觀本來就畫不出來**：`sub_45F340` 的 case `'o'` 直接 break（§4.11.3b）——戒指即使穿在
  12／13 格也不進 15-slot 外觀陣列。這不是缺口，是這一版 client 的原樣。
- **寵物家族零內容**：Data.wz 的 Item 目錄只有 `Book/Consume/Etc/Special`——**沒有 `Item/Pet`**；
  `05000000..3` 是 `Item/Book/0500.img`（書），不是寵物蛋。id 類別 5（`itemId / 1000000 == 5`）在
  `sub_4D3950` 串流模式的類別表裡叫「cash」（`itemslot.ts` 的 `ITEM_CATEGORY.cash: 5`），
  產品上 `inventoryTabOfItemId` 把它們收進第 4 分頁（cash）✓。沒有寵物內容 ⇒ 寵物 AI／指令／餵食
  家族在這一版無從實作，結案為「零內容」。
- **既有防線不變**：丟棄現金道具（序號 `cashItem` 拒絕 + 呼叫者 `dropItemAllowed` 的 WZ `info/cash`／未知
  道具拒絕，`cli.ts`）與 207 飛鏢特例照舊——它們本來就有原生證據（`sub_463BE0`／`sub_463A50`）。

### 4.37 ✅ 組隊：s2c `0x10`（結果）與 c2s `0x26`（請求）—— 名冊就是 6 × (u32 id + char name[13])（ADR-030）

§4.10 把 `0x10` 的 type 表列了出來，但只到「哪個 type 帶什麼」。這一節把它補到可實作的層級：兩個方向的
號碼、`0x26` 的五個送出者、102-byte 名冊是怎麼推出來的，以及**伺服器要做的那些決定**（binary 裡沒有）。

**號碼**：s2c `0x10` 是 `CWvsApp` 層（`sub_43B170` 把 `0x0A`–`0x14` 交給 `sub_55A900`，case 16 →
`sub_55C5E0`）；c2s `0x26` 是**遊戲伺服器**的請求（`sub_4A1EA0(..., 38, 0)`）。兩個方向只是剛好同一個數字，
跟 `0x0B`／`0x0F` 一樣互不相干。

#### 4.37.1 `0x10`（s2c）：`u8 type` ＋ 依 type 的 payload

| type | payload | client 做什麼（`sub_55C5E0`）|
|---|---|---|
| `3` | `u32 inviterId` ＋ `str inviterName` | 只在 `*(CWvsApp + 36) != 0` 時才讀（那一格是本機角色的**名字物件**，見 §4.37.4——角色還沒載入時整包丟掉）；跳**模態**對話框「'%s'님이 파티에 초대했습니다.\r\n파티에 가입하시겠습니까?」（`sub_52C140` 回 6 ＝ `IDYES`），按「是」送 `0x26 type 2` ＋**同一個** u32 |
| `5` | `u32 partyId` ＋ 102-byte 名冊 | 安靜地覆蓋名冊（沒有訊息）|
| `6` | `u32 partyId` | `*(CWvsApp+404) = partyId`、名冊清空、把自己（`+20` 的角色 id 與 `+36` 的名字）寫進第 0 格，印「새로운 파티를 만들었습니다」|
| `7`／`14` | — | 「이미 가입한 파티가 있습니다」|
| `8` | — | 「초보자는 파티를 만들 수 없습니다」|
| `10` | `u32 partyId` ＋ `u32 characterId` ＋ `u8 flag`；`flag != 0` 再加 `u8 kicked` ＋ `str name` ＋ 102-byte 名冊 | 見 §4.37.2 |
| `11` | — | 「가입한 파티가 없습니다」|
| `13` | `u32 partyId` ＋ `str name` ＋ 102-byte 名冊 | 名冊換成封包裡那一份；`name` 是自己 →「파티에 가입되었습니다.」、否則「'%s'님이 파티에 가입하셨습니다」|
| `15` | — | 「가입하려는 파티에 이미 최대 인원 수만큼의 파티원이 가입했습니다」|
| 其他 | — | default：「알 수 없는 오류가 발생해서 파티 요청을 처리하지 못했습니다」|

讀取順序是 disassembly 驗過的（`sub_55C5E0`）：case 5 是 `sub_45DCC0`（u32）→ `sub_45F5C0`（0x66 bytes）；
case 13 是 u32（`0x55ca34`）→ `sub_432680`（字串，`0x55ca55`）→ 名冊（`0x55cae3`）；case 10 是 u32
（`0x55c83d`）→ u32（`0x55c86b`）→ u8（`0x55c88e`）→（`flag != 0`）u8（`0x55c8be`）→ 字串（`0x55c8df`）
→ 名冊（`0x55c971`）。

**`CWvsApp + 36` 是本機角色的名字**：`type 13` 收名字時就是拿它來比對（`sub_416B00(name, *(CWvsApp + 36) + 4)`；
相同 →「파티에 가입되었습니다.」、不同 →「'%s'님이 파티에 가입하셨습니다」），`type 6` 也把同一個字串抄進名冊的
第 0 格。所以 `type 3` 的守門不是某個 UI 開關，而是**「本機角色已經載入」**（不在遊戲內就沒有名字可以問）。

#### 4.37.2 `0x10 type 10` 的兩種意思

`flag == 0`：**隊長退隊、隊伍解散**。封包只有兩個 u32（party id 與發起人的角色 id），client **不讀名冊**，
`*(CWvsApp+404) = 0`；訊息取決於「發起人是不是我」：是我 →「파티장을 그만둡니다. 파티가 해체되었습니다」、
否則 →「파티장이 파티를 그만둬서 파티에서 나갑니다」。

`flag != 0`：**有人退隊或被踢**。`kicked` 區分兩者（`0`：自己退出 →「파티를 그만둡니다」／
「'%s'님이 파티를 탈퇴하셨습니다」；`1`：被踢 →「파티에서 강퇴당했습니다.」／「'%s'님이 파티에서
강퇴당하셨습니다」），名冊是**更新後**的那一份，client 直接 `memcpy` 覆蓋自己的 6 格。發起人是自己時
`partyId` 歸零，否則不動。

#### 4.37.3 `0x26`（c2s）：五個送出者，四個指令 ＋ 一個回答

| type | payload | 送出者 | 觸發 |
|---|---|---|---|
| `0` | — | `sub_471CD0` | `/파티만들기`（先看 `n3000[101] == 0`，已在隊伍裡就本地印「이미 가입한 파티가 있습니다」）|
| `1` | `u8`（唯一寫入者是字面 `0`）| `sub_471E90` | `/파티탈퇴`（先看 `n3000[101] != 0`）|
| `2` | `u32 inviterId` | `sub_55C5E0` case 3 | 邀請對話框按「是」|
| `3` | `u32 targetCharacterId` | `sub_472050` | `/파티초대 <name>` |
| `4` | `u32 targetCharacterId` | `sub_4722E0` | `/파티강퇴 <name>` |

`type 3`／`4` 的 id 是**客戶端自己查出來的**：`sub_472050` 用 `sub_51D7D0(CUserPool, name)` 找**同一張圖**的
CUser、取 `+56`（角色 id）；`sub_4722E0` 用 `sub_55DB00(CWvsApp, name)` 在自己的名冊裡找名字、回傳
`*(u32 *)(CWvsApp + 408 + 4 * i)`。所以 2003 的 `/파티초대` **只找得到同圖的人**——線上沒有「名字→id」的查詢。

`type 1` 的第二個 byte 沒有語意可定位（唯一寫入者是字面 `0`）；它與 `type 0` 的差別只有「有沒有隊伍」這個
客戶端自己先擋的檢查。

#### 4.37.4 名冊 = 102 bytes

`sub_45F5C0` 是一次 `qmemcpy(dst, src, 0x66)` 再 `+= 102`，所以形狀要從**讀的人**看：

- `sub_55DB00`：`CWvsApp + 432 + 13 * i` 是名字、`CWvsApp + 408 + 4 * i` 是角色 id（`i = 0..5`）。
- `sub_55CC40`（`/파티정보`）：從 `+432` 起以 **13 bytes** 步進印六個名字。

於是名冊 ＝ `u32 characterId[6]`（24 bytes，`+408`）＋ `char name[6][13]`（78 bytes，`+432`）＝ **102**，
空位全 0；`CWvsApp + 404` 是 party id。名字欄位與 `CharacterData` 那一個完全相同（13 bytes、NUL 結尾、
CP949 byte string），所以 codec 直接沿用 `chardata.ts` 的 `nameFieldBytes`／`nameFieldToString`。

**讀出來必須是六個固定格**（ADR-090）：`sub_45F5C0` 是整塊 memcpy，client 之後用 `+408 + 4i`／
`+432 + 13i`  indexing，不會把空格往前提。把「名字為空」的格子丟掉會改變語義——第 1 格會被當成隊長
（`sub_472050`／`sub_4722E0` 的队长闸門比的就是 `+408` 的第一個 u32），`type 10` 也不能再用「名冊裡
有沒有我」反推 `partyId`（`flag != 0` 且發起人是自己時就是歸零，即使名冊仍含自己）。`readPartyTable`
現在一律回六格（含 `characterId: 0`／`name: ""`），解碼後重新編碼 byte-exact。

**第 0 格就是隊長**，而且這是 client 判斷「我是不是隊長」的唯一方法：`sub_472050`（`/파티초대`）與
`sub_4722E0`（`/파티강퇴`）的前置都是 `n3000[101] != 0 && n3000[102] == n3000[5]`，其中 `n3000[101]` 是
「在隊伍裡」、`n3000[102]` 就是 `+408` 的第一個 u32（＝名冊第 0 格）、`n3000[5]` 是本機角色 id。`type 6`
建立成功時 client 自己做的也正是「清空 102 bytes、把自己寫進第 0 格、把自己的名字抄進 `+432`」
（`memset(this + 408, 0, 0x64)` ＋ `*(u16 *)(this + 508) = 0` ＝ 102 bytes、`*(u32 *)(this + 408) = this + 20`、
`lstrcpyA(this + 432, *(this + 36) + 4)`）——所以伺服器的名冊**必須把隊長放在第 0 格**；隊員照加入順序
往後排，有人離開就往前補，隊長一定還在（他離開＝解散）。

#### 4.37.5 伺服器端（ADR-030）

| 決定 | 我們的選擇 | 理由 |
|---|---|---|
| 隊伍住哪 | 世界層（`GameEntryServer.parties`）| 名冊裡沒有地圖，隊員分散在兩張圖是合法的；`0x1C`／`0x1D` 的場地廣播辦不到 |
| 隊長退隊 | **解散**（`type 10 flag 0` 給全體，含隊長自己）| 封包沒有「換隊長」的欄位，`flag 0` 的訊息就是解散 |
| 下線 | 退隊（隊長 → 解散）| 2003 的隊伍是記憶體裡的東西，沒有離線隊員 |
| 邀請 | 一個目標一格，後到的蓋掉前一個 | 邀請對話框是模態的，玩家不可能同時看兩個 |
| 名冊 | 六格、依加入順序、離開後補位 | 六格就是 client 的陣列；順序只影響顯示 |
| 隊伍 id | 伺服器自己遞增、不重用 | 只回給 client 記錄，線上沒有查詢用到它 |
| 拒絕 | **一定回一個 `0x10`**（`7`／`11`／`15`／`0`）| 跟 `0x0B`／`0x18` 同一條規則：client 在等一個答案（`type 3` 更是模態）|

#### 4.37.6 驗證

- `test/party.test.ts`：`0x26` 五個 type 的 golden bytes（`2600`／`260100`／`2602…`／`2603…`／`2604…`）、
  `0x10` 每個 type 的 golden bytes（含 102-byte 名冊的完整 hex）、雙向 round-trip、未知 type、`describe*`，
  以及 `PartyRegistry` 的建立／加入／滿六人／邀請覆蓋／退出與解散。
- `test/serve.test.ts`（同場兩人）：create → invite → accept → leave（`flag 1`）→ 隊長 leave（`flag 0`）→
  沒有隊伍時的 leave（`type 11`）。
- `whisper_probe.mjs`（真 CLI）：上面那一整條走一次，十個檢查。

#### 4.37.7 本版的派對資訊入口是 `/파티정보`，不是某個 party 視窗（ADR-090）

`sub_55CC40`（`/파티정보`，PE `005B5FA4`）**不送封包**，只把名冊印進聊天（`sub_4FB670(…, 6)`＝font6）：
`*(CWvsApp+404) == 0` → 「가입한 파티가 없습니다」（`005B60E0`）；否則組 `"파티원:"`（`005C0354`）後從
`+432` 以 **13 bytes** 步進走 **六格**、每格前接一個空白（`asc_5BE0C0`）再 append（空名字照印），
最後若 `+408 == +20`（名冊第 0 格就是本機角色）再印「당신은 파티장입니다.」（`005C033C`）。

**這版的 GameMenu 沒有 party 視窗分支**：`sub_559E20` 只處理 index 3／4／5——PE `00559EF5` 起
`mov eax,[ecx+98h]`／`sub eax,3`／`jz`／`dec eax`／`jz`／`dec eax`／`jnz loc_55A067`，C 裡也只有
`case 3:`（CUIGameOpt）、`case 4:`（CUISysOpt）、`case 5:`（`sub_55D9F0` 結束連線）；
`Data.wz` 的 `UI/UIWindow.img` 顶层属性有 `GameMenu`／`Trade`／`Messenger`，**沒有 `Party` 子树**。
所以「BtParty 停用」是原況，不能補一個後期樣式的 party 窗冒稱原版。

原版在**送出前**的本地检查（全部只印字、不送封包）：

| 送出者 | 前置 | 印的字 |
|---|---|---|
| `sub_471CD0` | `n3000[101] != 0` | 「이미 가입한 파티가 있습니다」|
| `sub_471E90` | `n3000[101] == 0` | 「가입한 파티가 없습니다」|
| `sub_472050` | `n3000[101] != 0 && n3000[102] == n3000[5]`；接著 `sub_51D7D0(CUserPool, name)` | 「파티의 방장이 아닙니다」；找不到同圖玩家 →「캐릭터를 찾을 수 없습니다」（`005B6050`）|
| `sub_4722E0` | 同上队长闸門；`sub_55DB00(CWvsApp, name)` 查**自己名冊** | 「파티의 방장이 아닙니다」；找不到 → `"'%s'님은 파티의 멤버가 아닙니다."` |

两条名字查询的大小写规则不同：池是 `lstrcmpiA`（不分大小写），名冊是 `strcmp`（分大小写）。

#### 4.37.8 OPEN

- `0x10` `type 5`：原伺服器什麼時候送（安靜同步、沒有訊息）？本伺服器沒有用它（`13` 已經帶著完整名冊）。
- `0x26` `type 1` 的第二個 byte（`sub_471E90` 只寫 0）。
- **跨圖邀請**：client 的 `/파티초대` 只查 CUserPool（同圖），但 `0x26 type 3` 本身只是一個 u32——原伺服器
  是否接受跨圖的邀請無法從 client 判斷（本伺服器接受：隊伍在世界層）。
- `0x10` `type 5` 的 102-byte 名冊與 `type 13` 相同（同一個 `sub_45F5C0`），但原伺服器什麼時候送
  `type 5` 看不出來（沒有任何訊息，client 也不會把自己補進去）。

### 4.38 ✅ 人氣（인기도）：c2s `0x20` 與 s2c `0x12`（ADR-031）

角色右鍵選單上的「인기도 +」／「인기도 -」是 2003 年唯一的社交評分，兩個方向都解到欄位層。

**送出**：`0x20` 只有一個送出者 `sub_55D7B0(CWvsApp, name, up)`，呼叫點是 `sub_5128B0` 的選單
（`n2 = 1` → up = 1、`n2 = 2` → up = 0）。它在送出前做三件**client 自己的**事：

1. 在自己的 `CUserPool` 裡用**名字**找那個人（`sub_51D7D0`）——所以目標一定在**同一張圖**；
   找不到就本地印「캐릭터를 찾을 수 없습니다」，封包不出去。
2. 5 分鐘的本地冷卻（`timeGetTime() - *(app + 0x2AC) < 300000`）→「잠시 후 다시 시도해 보세요」。
3. 送出 `[0x20][u32 目標角色 id][u8 up]`（`id` 來自 `*(user + 56)`）。

⇒ 這只證明原client的送出限制，不能推論原server沒有再檢查。本repo仍權威檢查同圖目標；原server的冷卻／配額規則未知。

**回包**：`0x12` 的處理函式是 `sub_55C390`（`sub_55A900` 的 case 18）：

| type | payload | client 顯示 |
|---|---|---|
| `0` | `str name` + `u8 up` | 「'%s'님의 인기도를 내렸습니다.」／「…올려주었습니다.」（**給送出者**，`name` 是被給的人）|
| `1` | — | **什麼都不顯示**（`break`，連一行都沒有）|
| `2` | — | 「초보자는 인기도를 올리거나 내리지 못합니다.」|
| `3` | — | 「오늘은 더 이상 인기도를 올리거나 내리지 못합니다.」|
| `4` | — | 「이번 달에는 더 이상 지정된 캐릭터의 인기도를 올리거나 내리지 못합니다.」|
| `5` | `str name` + `u8 up` | 「'%s'님께서 '%s'님의 인기도를 …」（**給被給的人**；`name` 是給的人，第二個名字是 client 自己補的）|
| 其他 | — | 「알 수 없는 오류로 인기도를 올리거나 내리지 못했습니다.」|

`type 5` 的第二個名字是 `*(CWvsApp + 36) + 4`（本機角色名，§4.37.4）**不是**封包裡的字串，所以兩個帶名字
的 type 各自只有**一個**名字由伺服器給。

**數值**：人氣是 `CharacterData` 的 `u16`（`fame`，`0x0D` 的 bit `0x20000` 以 u32 送、只留 2 byte）——
所以「給人氣」的另一半是**給被給的人一個 `0x0D`**（`diffStats` 的 `fame`），他的能力視窗才會跟著動；
給的人自己沒有任何紀錄變動，因此**不送** `0x0D`。

**ADR-089交叉更正／browser鏈**：5478F0只是游標座標轉換，不是選單。5128B0→51D6C0／5085E0的UnionRect→
CUIContextMenu52E050／52F0B0／52E780使用完整PE UTF16 `UI/UIWindow.img/ContextMenu` 四片原WZ。
55D7B0先名字查找再做signedDWORD差，送出前記時間（拒絕照樣冷卻）；558FD0初始化為now−300000。
codec名字維持CP949 byte-string，Session對外一次解碼；0x12未知6..255應走原generic font6，不是decoder exception。
派對邀請及名冊解碼、綁定modal inviterId、重建server以resolveInvite核對接受id防轉錯隊、未證實舊端fail-closed，及原文／測試／保進度LIVE見[原角色互動](../NATIVE_PLAYER_INTERACTIONS.md)。

#### 4.38.1 伺服器端（ADR-031）

`0x20` 的目標用**場地**找（`FieldInstance.member(id)`）：client 只可能送同圖的 id（選單來自
`CUserPool`），查不到就是過期的 id，回 `type 1`（什麼都不顯示），不編一個訊息。

| 規則 | 我們的選擇 | 為什麼 |
|---|---|---|
| 初學者的界線 | `FAME_MIN_LEVEL = 15` | client 沒有任何等級檢查（只有 5 分鐘冷卻），所以「초보자는…」那句話一定是伺服器說的。2003 的實際數字不在 binary 裡 → 選 15 並記錄 |
| 「今天」／「這個月」 | UTC 的日序號／月序號（`fameClock`） | 不隨時區或重開機跳動；同時讓「월」的訊息有明確的界線 |
| 哪一條先問 | 自己 → 初學者 → **這個月同一個人**（`4`）→ **今天**（`3`） | 專案選擇優先回本月重複目標訊息；原server檢查順序未知 |
| 人氣的範圍 | `[0, 65535]` | 紀錄是 u16；往下給 0 分的人不會變成負數 |
| 配額存哪 | **`AccountRecord.fame`（進存檔，ADR-148）** | 它不是角色狀態的一部分（`CharacterData` 沒有那一格），所以掛帳號列而不是角色列；2003 的伺服器怎麼記仍然看不出來 → §4.38.2 |

#### 4.38.2 OPEN

- ~~**配額不進存檔**：重開伺服器就重新開始。~~ → **已結案（ADR-148）**：`AccountRecord.fame`
  （角色 id 的十進位字串 → `{day, month, targets}`）進存檔，`FameLedgers` 變成帳號列上的一層薄視圖
  （不再是自己那張 `Map`，所以沒有第二份可以跟存檔脫勾）。`readSave` 對缺欄位是容忍的，舊檔照樣讀得進來；
  給人氣之後會呼叫 `persist()`。**重啟後**：同一個對象 → `type 4`（這個月），同一天不同對象 → `type 3`。
  仍然不知道的是 2003 的伺服器**怎麼**記這件事（見下一點），我們記的是我們自己的選擇。
- **初學者的界線**是不是 15：client 只證明得出「有這條規則」。
- **被給的人有沒有等級下限**：看不出來（本伺服器不檢查；只有給的人要 ≥ 15）。
- **`type 1` 的用途**：client 有一個「什麼都不顯示」的 case，但哪一種失敗該走它沒有證據（本伺服器用在
  「目標不在這張圖」與「自己給自己」）。

#### 4.38.3 驗證

- `test/fame.test.ts`（10 則）：`0x20` 與 `0x12` 六種 type 的 golden bytes、round-trip、`describe*`、
  `fameClock` 的 UTC 日／月、`applyFame` 的每一條拒絕與成功（含夾在 `[0, 65535]`）、`FameLedgers`。
- `test/serve.test.ts`「fame: 0x20 answers the giver (0), the target (5), and a 0x0D; the quotas refuse (3/4)」：
  兩條真 socket（30 級與 14 級）——type 0 給給的人、type 5 ＋ `0x0D` 給被給的人、同一個目標第二次是
  `4`、14 級的人是 `2`、不在場地的 id 是 `1`。
- `whisper_probe.mjs`（真 CLI）：1 級的角色送出 `0x20` → 收到 `0x12` type 2，目標什麼都沒收到。

### 4.39 🟡 交易（1:1 교환）的偵查：`0x25` 是「視窗」請求、`0x50` 是回包

這一節是**號碼與流程**的偵查紀錄；欄位與實作見 §4.40（ADR-032）。原本寫在這裡的兩個 sender 型別
（`0x4819d9` 的「type 2」、`0x4821ca` 的「type 1」）是**讀錯了**：那兩個 byte 是 SEH 狀態
（`movb $0x2,0x28(%esp)`），真正的 payload byte 是函式稍後的 `movb $0x3,(%eax,%ecx,1)` 與
`movb $0x5,...`，也就是 **type 3** 與 **type 5**。

**c2s `0x25` 不是交易專用**：`objdump` 找到 **七個**送出者 —— `/교환`（`sub_471A40`，`.text:00471b11`）、
`CMiniRoomBaseDlg` 裡兩個（`.text:00481a2a` 的 type 3 ＋ `u32`、`.text:00482228` 的 type 5 ＋ `str name`）、
以及**交易對話框**那四個（`.text:004d3270` 的 type 7、`4d5db7` 的 type 11、`4d60ee` 的 type 12、
`4d62f1` 的 type 13）。⇒ 第一個 payload byte 是**請求種類**，
`0x25` 是「開著的視窗」共用的請求 opcode（跟 s2c 的 `0x50`–`0x52` 一對）。

`/교환` 的形狀（`sub_471A40`）：`[0x25][u8 0][u8 1][u32 目標角色 id]`——第一個 byte 是種類、第二個 byte
永遠是字面 `1`（語意未定位，可能是「1:1」這個房間種類）。送出前的三個前置**都在 client**：

| 前置 | 訊息 |
|---|---|
| GM 帳號（`n3000[9] & 1`）| 「관리용 아이디는 1:1교환을 할 수 없습니다」|
| 已經開著另一個 modeless 視窗（`this_15 != 0`）| 「다른 작업중에는 1:1교환을 할 수 없습니다」|
| 名字不在同一張圖的 `CUserPool`（`sub_51D7D0`）| 「캐릭터를 찾을 수 없습니다」|

**s2c `0x50`–`0x52` → `sub_4815E0`**：先讀一個 `u8 type`，然後看有沒有開著的對話框
（`this_15` 動態轉型成 `CMiniRoomBaseDlg`）：

| 狀態 | type | 去哪裡 | 做什麼 |
|---|---|---|---|
| 沒有對話框 | `1` | `sub_481910` | **交易請求**：`str 對方名字` ＋ `u32`，跳模態「'%s'님께서 1:1 교환을 요청하였습니다…」；按「是」送出 c2s `0x25` **type 3** |
| 沒有對話框 | `2` | `sub_481B20` | **請求失敗**：`u8 code`（0 ＝ 靜默、1 ＝ 캐릭터를 찾을 수 없습니다、2 ＝ `str name` ＋ '%s'님은 다른 일을 하는 중입니다）|
| 沒有對話框 | `4` | `sub_481790` | 進房間：`u8 roomKind`（0 →「방에 들어갈 수 없습니다.」走 `sub_52BBE0` 的CUtilDlg1000單OK提示窗；**只有 `1` 會開出交易視窗**，其他值 `sub_481570` 回 null ⇒ 斷線）|
| 沒有對話框 | 其他 | — | **丟 `AVCDisconnectException`**（client 會斷線！）|
| 有對話框 | `3` | `sub_481E00` | 房間裡多一格：`u8 index` ＋ 參與者 |
| 有對話框 | `5` | vtable 第 15 槽 | 系統訊息 |
| 有對話框 | `6` | `sub_481EB0` | 與 `3` **機器碼幾乎相同**（同一種 `u8 index` ＋ 參與者）|
| 有對話框 | `7`／`8` | vtable 第 16／17 槽 | 第 8 槽＝結束（`u8 code`，見 §4.40.2）|
| 有對話框 | 其他 | vtable 第 18 槽（type 原樣傳進去）| 同上 |

⇒ 視窗裡的那些訊息（放道具、拿掉、錢、鎖定、確認、取消）都是 **virtual** 的，欄位由
`CMiniRoomBaseDlg` 的子類別決定——這是它比攻擊三兄弟難讀的原因，也是為什麼這一節停在這裡。

**三個切片，兩個已經落地**（§4.40）：

1. **邀請** ✅ `0x50 type 1`／`type 2`、`0x25 type 0`／`type 3`（`u32` ＝ 邀請者自己的角色 id，client 只負責回聲）。
2. **視窗** ✅ `0x50 type 4`（進房）／`type 8`（結束）／`type 11`／`12`／`13`（道具、錢、鎖定）與
   c2s 的 `type 7`／`11`／`12`／`13`。三句結束訊息（`교환이 성사되었습니다`／`상대방이 교환을 취소했습니다`／
   `교환에 실패하였습니다`）就是 `type 8` 的 code 3／1／4。
3. **社群選單 ✅ 已在 `sub_5122D0`／`sub_5128B0` 全解（ADR-097 更正）**：舊文把 `sub_512570` 當成選單的
   另一半——它其實是**快捷鍵**（200ms 冷卻；kind1 只在本機、kind2 USE 200-202→`sub_55B2C0` 0x18）。
   真實結構：`sub_4697A0` 收滑鼠訊息，**515=WM_LBUTTONDBLCLK→`sub_512700`**（cursor→
   `sub_49F1F0(IGObj registry dword_5C2050)` 命中→`[0x14][u32 obj+72]`；s2c 0x14 無消費者＝原版
   靜默）；**517=WM_RBUTTONUP→`sub_5128B0`**（`sub_51D6C0(CUserPool,&pt)` 命中→六項彈出）：
   `개인정보` n2=0 **switch 無 case＝原版死項**、`인기도 +`/`−` n2=1/2→`sub_55D7B0(name,1/0)`＝0x20、
   `귓속말` n2=3→`sub_4FB160(chatUI,name,1)` 本地密語欄、`교환신청` n2=4→`sub_471A40(name)`
   （`sub_51D7D0` 名字→id＋「1:1교환을 할 수 없습니다」忙碌閘→0x25）、`파티초대` n2=5（有黨且自己是
   隊長 `x+404≠0 ∧ x+408==x+20`）→`sub_472050(name)`（「이미 소속된 파티」檢查→0x26）。

### 4.40 ✅ 交易（1:1 교환）：`0x25`／`0x50` 的完整欄位與伺服器的房間規則（ADR-032）

§4.39 只到號碼。這一節把讀完的部分寫下來，並對照兩個檔案：`server/src/protocol/miniroom.ts`（codec）
與 `server/src/game/trades.ts`（規則）。**一個 opcode 兩個方向**是這裡最重要的結構——`0x25` 不是
「交易請求」，而是「**開著的視窗**送出的請求」；`0x50` 是同一扇窗的回包，`type` 決定去哪一條路（`0x51`／`0x52` 屬於 messenger，本節不用）。

| 方向 | opcode | 誰用 |
|---|---|---|
| c2s | `0x25` | `/교환`、邀請對話框的「是」、交易視窗的四個按鈕（**七個送出者共用一個 opcode**）|
| s2c | `0x50` | 上面那扇窗的回包（`sub_4815E0`）|

#### 4.40.1 c2s `0x25`：七個送出者、七種 type

| type | 送出者 | payload（opcode 之後）| 意義 |
|---|---|---|---|
| `0` | `/교환` `sub_471A40`（`0x471b11`）| `[u8 roomKind][u32 targetId]`；`roomKind` 的字面值永遠是 `1` | 邀請同一張圖的某個人 |
| `3` | 邀請對話框的「是」`sub_481910`（`0x481a2a`）| `[u32 inviterId]` | 答應；`u32` 就是 `0x50 type 1` 給的那個值（原樣回聲）|
| `5` | `sub_4820E0`（`0x482228`）| `[str name]` | messenger 的「用名字邀請」；本伺服器只記一行 |
| `7` | `sub_4D31F0`（`0x4d3270`）| 空 | 關掉視窗（離開房間）|
| `11` | `sub_4D5C80`（`0x4d5db7`）| `[u8 tab][u16 slot]`＋`tab != 1` 時 `[u16 count]`＋`[u8 roomSlot]` | 把庫存的一格放上桌；`roomSlot` 是 **1..8** |
| `12` | `sub_4D5F50`（`0x4d60ee`）| `[u32 mesos]` | 把錢放上桌 |
| `13` | `sub_4D61F0`（`0x4d62f1`）| 空 | 「정말로 교환하시겠습니까?」的「是」|

`type 11` 的兩個細節是 client 自己決定的，伺服器必須跟著：**裝備（`tab == 1`）不帶 `count`**
（`sub_4D5C80` 只在 `tab != 1` 時寫那個 `u16`，因為裝備不堆疊），而 `roomSlot` 來自
`sub_4D63C0` 的 `y`，`y <= 0` 時 sender 直接放棄——所以交易格是 1..8，從來不會是 0。

#### 4.40.2 s2c `0x50`：`sub_4815E0` 的分派

`sub_4815E0` 先讀 `u8 type`，然後看「現在有沒有開著 modeless 視窗」（`this_15`，
`_RTDynamicCast` 成 `CMiniRoomBaseDlg`）：**沒有**的時候只認 1／2／4，其他一律
`AVCDisconnectException`；**有**的時候把 3／5／6／7／8 交給固定函式或 vtable 第 15–17 槽、
其餘交給第 18 槽（type 原樣傳進去）。

| type | 沒有視窗 | 有視窗 | payload |
|---|---|---|---|
| `1` | `sub_481910` | — | `[str inviterName][u32 inviterId]` |
| `2` | `sub_481B20` | — | `[u8 code]`；`code == 2` 再一個 `[str name]` |
| `3` | — | `sub_481E00` | `[u8 index][participant]` |
| `4` | `sub_481790` → `sub_481D00` | — | `[u8 roomKind][u8 count][u8 myIndex]` ＋ `[u8 index][participant]` 重複到某個 byte 的最高位是 1 |
| `5` | — | vtable 15 | `[u8 0][str text]`（🟡 第一個 byte 被 client 跳過；本伺服器送 0）|
| `6` | — | `sub_481EB0` | `[u8 index][participant]`（與 `3` 的機器碼幾乎相同）|
| `7` | — | vtable 16 | （本伺服器不送）|
| `8` | — | vtable 17 | `[u8 code]`：`1` ＝ 상대방이 교환을 취소했습니다、`3` ＝ 교환이 성사되었습니다、`4` ＝ 교환에 실패하였습니다 |
| `11` | — | vtable 18 | `[u8 index][u8 roomSlot][GW_ItemSlot]`（**帶類別 byte**）|
| `12` | — | vtable 18 | `[u8 index][u32 mesos]` |
| `13` | — | vtable 18 | 空（「鎖定」）|

`type 2` 的三個 code 就是 `sub_481B20` 裡的三條分支：`0` **什麼都不顯示**（＝請求已送出）、
`1`「캐릭터를 찾을 수 없습니다」、`2`「'%s'님은 다른 일을 하는 중입니다」（所以 `2` 才需要那個名字）。
`type 4` 的 `roomKind` 不是 1 就會被客戶端丟掉並斷線（`sub_481570` 只認 1，其餘回 `null`），這是
`0x50` **唯一**會讓 client 主動斷線的欄位，所以伺服器只在這裡送 `1`。

`type 8` 的三句訊息由 `sub_4D3D70`（三個字串 `aI_11`／`aI_12`／`aE_9` 的擁有者，也就是
`CTradingRoomDlg` 覆寫的 vtable 第 17 槽）挑選：它讀一個
`u8`，先呼叫 `(*(*this + 44))(this, 8)`（＝用 type 8 關窗），再看 `1`／`3`／`4` 三個值——其他值
**不做任何事**。所以「結束碼」不是猜的。

#### 4.40.3 participant：`[u8 A][u32 B][外觀清單][str name]`

一段參與者（`type 3`／`4`／`6` 共用，`sub_482340`）：

1. `u8 A` → `sub_423EC0(obj, A, pos)`：它用 `sub_421E00(dword_5C271C, &A, …)` **建兩個同值的文字標籤**
   （本体＋影子）⇒ 這是一個**畫出來的數字**；🟡 是哪個數字沒有直接證據（等級最合理）。本伺服器送**等級**。
2. `u32 B` → `sub_424590(obj, B, faceFromList)`：🟡 與「從外觀清單抽出的臉」並排存；本伺服器送
   `CharacterData.appearanceA`（＝臉），跟 `0x1C` 進場包的第一個 `u32` 同一個值。
3. **外觀清單** → `sub_45F340`：`u32` 一直讀到 0 為止，`id / 10000 == 3` 的進第 0 格（＝頭髮），
   其餘按 `id / 10000` 分派到身體部位——**與 `0x1C` 的 `avatarItems` 完全同一種清單**。
4. `[str name]` → `sub_432680`。

⇒ 這一整段和 `0x1C` 的差別只有最前面兩個欄位（`u8 A`、`u32 face`）與最後的名字，所以伺服器
直接重用 `CharacterData` 的欄位，不需要第二套「外觀」模型。

#### 4.40.4 伺服器這一側（`trades.ts`）

binary 只規定了**位元組**，下面這些是這份 repo 的**規則**，每一條都寫在 `trades.ts` 的檔頭：

| 規則 | 值 | 為什麼 |
|---|---|---|
| 邀請只在**同一張圖** | — | `/교환` 的對象是 `CUserPool` 查出來的（`sub_51D7D0`），client 根本看不到別張圖的人 |
| 邀請存活時間 | `TRADE_INVITE_TTL_MS = 30_000` | client **沒有「拒絕」封包**（模態只有「是」會送 `type 3`），沒有逾時就會永遠卡在「等待對方回答」|
| 一個人同時只能有一個房間 | — | 「'%s'님은 다른 일을 하는 중입니다」（`type 2 code 2`）就是這個意思 |
| 成交的原子性 | `settleTrade` 先 `structuredClone` 再驗證 | 交易窗口可以開幾分鐘，東西可能已經被丟掉／賣掉；**任何一邊不成立就整個不換** |
| 成交後的通知 | 兩邊各 `0x0B`（道具）＋`0x0D`（錢的差異）＋`type 8 code 3` | 庫存只由 `0x0B` 改寫，錢只由 `0x0D` 改寫（§4.36／§4.21）|
| 取消／失敗 | `type 8 code 1`／`code 4` | 三句訊息在 client 自己手上 |
| 斷線 | 對方收到 `code 1` | 沒有別的東西會替那扇窗收尾 |

`settleTrade` 的失敗字串（`left no longer owns an offered item`／`… has no room for …`）是**測試看的**，
不是玩家看的：玩家看到的一律是「교환에 실패하였습니다」。

#### 4.40.5 還是 🟡 的地方，與刻意沒做的事

- **participant 的 `u8 A`**：`sub_423EC0` 把它變成兩個同值的文字標籤（`sub_421E00`），所以它一定會被
  畫出來；**語意**（等級？角色 id？）沒有證據。送等級是選擇——`0x482090`／`sub_482340` 都沒有讀回它，
  而且交易視窗本來就只顯示名字與外觀。
- **`type 4` 的結束 byte**：client 只檢查符號位（`pExceptionObject_2 < 0`），值本身丟掉；本伺服器送
  `0xff`。任何 `0x80`–`0xff` 都等價。
- **`type 5` 的第一個 byte**：client 跳過它，本伺服器送 0。
- **`type 11` 的類別 byte**：s2c 帶、c2s 不帶（`GW_ItemSlot` 的類別由 `itemId / 1000000` 決定），
  所以 codec 的 `encodeMiniRoomItem` 自己補。
- **`0x14` 已更正為「雙擊玩家」**（§4.39 第 3 塊 ✅ ADR-097）：`sub_512700` 送 `[0x14][u32 charid]`，
  與「교환신청」無關（選單的교환신청走 `sub_471A40`→0x25，早已接）。本伺服器對 0x14 只記 log、
  不回包——忠實於原版 s2c 0x14 無消費者。
- **`this_15` 的「另一個視窗開著」閘門**在伺服器這一側**沒有**對應物：本伺服器的會話可以同時開商店
  與交易。這是刻意的不對稱——伺服器的職責是「不要送 client 會斷線的封包」，不是複製它的 UI 限制。

### 4.41 ✅ 메신저（三人聊天室）：c2s `0x24` 與 s2c `0x4D`–`0x4F`（ADR-033）

2003 的「메신저」**不是好友名單**，是一扇三人聊天室（대화방）：`sub_4DDFE0` 開窗時先往訊息區印五行
說明（`[ Maple Messenger 도움말 ]`、`-------------------------`、`초대 : /초대 캐릭터이름`、
`종료 : /q`、`-------------------------`），成員格是 `this + 25 * slot + 31` 的 25 個 dword，
而 `sub_4DF3E0` 的第一行就是 `if (slot <= 2)`。

| 方向 | opcode | 誰用 |
|---|---|---|
| c2s | `0x24` | 開窗／進房、關窗、`/` 指令、聊天（**四個送出者**）|
| s2c | `0x4D`–`0x4F` | `sub_4E18D0`：**三個 opcode 同一個 handler**，語意全在 `u8 type` |

#### 4.41.1 c2s `0x24`：四個送出者

`sub_4A1EA0(&buf, 36, 0)` 的 36 就是 `0x24`。全檔只有四個地方送它，全部在 `CUIMessenger`：

| type | 送出者 | payload（opcode 之後）| 意義 |
|---|---|---|---|
| `0` | `sub_4DDFE0` | `[u32 roomId]`；`0` ＝ 自己開一間 | 開窗／進房。`sub_4DDF10(roomId)`（邀請模態的「是」）就是帶著 `0x4D type 3` 給的號碼走到這裡 |
| `2` | `sub_4DE280` | 空 | 離開房間（關窗）|
| `3` | `sub_4E24B0` | `[str name]` | `/초대 <名字>` 的**名字部分**（`/q`／`/Q` 由 client 自己吃掉，見下）|
| `5` | `sub_4DE490`／`sub_4DEAF0` | `[str line]` | 一行聊天，**client 已經組成「名字 : 內容」**（見 4.41.3）|

`sub_4E24B0` 是 `/` 指令的處理器：先比對 `/q`／`/Q`（`sub_525EC0`），中了就 `sub_4DDFA0` 關窗、
**不送任何封包**；再比對 `/초대`（`sub_526070`）取出名字，空白或自己的名字會被擋掉並印
「- 다른 캐릭터의 이름을 입력하세요.」。

#### 4.41.2 s2c `0x4D`–`0x4F`：一個 handler、八種 type

`0x4D`／`0x4E`／`0x4F` 都指向 `sub_4E18D0`，所以 **opcode 本身不帶語意**。本伺服器固定用 `0x4D`。

| type | 去哪裡 | payload（type 之後）| 畫面／行為 |
|---|---|---|---|
| `0` | `sub_4DF1D0` → `sub_4DF3E0` | `[u8 slot][u8 level🟡][u32 face]` ＋ 外觀清單 ＋ `[str name]` ＋ `[u8 announce]` | 一格成員；`announce != 0` ⇒「- '%s'님이 입장하셨습니다」|
| `1` | `sub_4DF620` → `sub_4DF670` | `[u8 code]` | 「- 초청 받은 대화방에 참가하지 못했습니다」|
| `2` | `sub_4DF8B0` → `sub_4DF910` | `[u8 slot]` | 「- '%s'님이 퇴장하셨습니다」（名字取自那一格；`slot > 2` 直接丟掉）|
| `3` | `sub_4E1BB0` | `[str inviterName][u32 roomId]` | 邀請。**沒有視窗也處理**：`*(n0xC8 + 28) != 0` 才動作，沒開窗就跳模態，按「是」（`sub_52C140 == 6`）⇒ `sub_4DDF10(roomId)` |
| `4` | `sub_4E19A0` | `[str name][u8 ok]` | `ok != 0` ⇒「- '%s'님에게 초청 메시지를 보냈습니다」、`ok == 0` ⇒「- '%s'님을 찾지 못했습니다」|
| `5` | `sub_4E1E30` | `[str line]` | 一行聊天，字串**自己帶「說話者 : 內容」**（用 `strstr(line, " : ")` 拆）|
| `6` | `sub_4E2170` | `[u8 slot][u8 level][u32 face]` ＋ 0 結尾外觀清單（**無名字／announce**）| 原位更新一格；`slot<3` 且該格已有人（name≠0）才套用，名字與 typing 旗標不動、不印行 |
| `7` | `sub_4E2280` | **固定三格**（`do…while(slot<3)`），每格 `[u8 marker]`：0＝清格、1＝原格不動、其他＝`[u8 level][u32 face]`＋外觀清單＋`[str name]` | 整份名冊（fill 走 `sub_4DF3E0(..., announce = 0)`，全程靜默；舊筆記「0 結尾、讀到一半」是錯的——0 是 clear marker）|

`type 3` 的閘門要記下來：**視窗開著時只印一行**，沒開時才跳模態——位元組完全相同，差別在
`this_8` 是不是 `nullptr`。

#### 4.41.3 成員紀錄，以及「client 自己組聊天行」

`sub_4DF1D0` 依序讀：`u8 slot`、`u8 level🟡`、`u32 face`、外觀清單（`sub_45F340`：`u32` 一直讀到 0，
`id / 10000 == 3` 進第 0 格，`101xxxx` 被抽出來另存）、`str name`、`u8 announce`。

- `face` 走 `sub_424590`，與 `0x1C` 的第一個 `u32`、`CharacterData.appearanceA` 同一個值（§4.11.3c）——
  與交易 participant 的 `u32` 是同一格。
- 第二個 `u8` 🟡：它落在 `v9[6]`，與交易 participant 的第一個 `u8` 同一個位置（推論為等級）。

**聊天行是 client 組的**：`sub_4DE490` 先用 `sub_418610(自己的名字)` ＋ `" : "` ＋ 輸入的文字串起來，
`sub_4DEE50` **先印在自己的訊息區**，然後才 `sub_4A1EA0(…, 36)` 送 `type 5`。兩個結論：

1. 伺服器收到的是 `"名字 : 內容"`，不是純文字；
2. **不能把這一行回送給說話的人**，否則他的畫面上會有兩行。

#### 4.41.4 伺服器這一側（`protocol/messenger.ts`、`game/messenger.ts`）

| 規則 | 值 | 為什麼 |
|---|---|---|
| 一間房三格 | `MESSENGER_ROOM_SIZE = 3` | `sub_4DF3E0` 只認 `slot <= 2` |
| 一個人只有一間房 | — | 成員陣列的索引**就是**格子；同時在兩間房會互相蓋掉 |
| 進別人的房要邀請 | `roomId == 0` ＝ 開新房 | 房號是伺服器給的 `u32`；沒有邀請就只是猜中號碼 |
| 邀請存活 | `MESSENGER_INVITE_TTL_MS = 60_000` | client 的模態只有「是」，沒有拒絕封包 |
| 房空了就消失 | — | 2003 的聊天室沒有主持人、沒有殘留狀態 |
| 聊天只送給**別人** | — | client 已經自己印過（4.41.3）|
| 聊天行的名字用**伺服器的** | 前綴換掉、內容保留 | 封包可以偽造；「 : 」之前那一截不算證據 |
| 離線／關窗 | `0x4D type 2` 給其他人 | 離開的人的視窗已經關了，而且那一格是別人的名字 |

#### 4.41.5 還是 🟡 的地方

- ~~**`type 6`／`type 7`**~~：✅ 本輪完整解碼（見 4.41.2 表與 NATIVE_MESSENGER §5b）——codec
  （`encodeMessengerCellUpdate`／`encodeMessengerRoster`＋`MESSENGER_ROSTER_MARKER`）與瀏覽器模型
  都已實作；伺服器發送來源也已接（ADR-098：換裝 `0x28`／升級 `0x29`→type 6 全房間靜默原位、
  離開 splice 補位→type 2 之後 type 7 三格重同步）。新證：type 2 的 `sub_4DF910` **只清一格、
  絕不補位**（印「나가셨습니다」後 tint 0／sprite 釋放）——所以 registry 的 splice 必須靠 type 7
  修復，`compactRosterCells`＝占有 fill／尾巴 clear（keep 用不到）。
- **成員紀錄的第二個 `u8`**：位置與交易的等級相同，語意仍然只有推論。
- **指令字串**：`/초대` 的「초대」是 CP949 的三個 byte。伺服器**不比對指令字**，只取第一個空白
  之後的字（`messengerInviteTarget`）——所以 `/invite Hero` 與 `/초대 Hero` 等價。
- **`0x4D type 4` 的欄位順序**：名字在前、旗標在後（`sub_4E19A0` 先 `sub_432680` 再讀 byte）。
  §4.39 的舊筆記寫反了，這裡以機器碼為準。
- **`0x4E`／`0x4F`**：同一個 handler，但沒有辦法從封包分辨三者，所以只送 `0x4D`。

#### 4.41.6 ✅ 瀏覽器側 CUIMessenger：視窗、字串、typing 政策（ADR-095）

§4.41 解出了封包；本節是**視窗這一側**的原證與對應實作（`client/messenger-state.ts` 模型＋
`client/messenger-window.ts` 繪製／hit＋`client/main.js` 接線），證據全部出自 PE／listing／WZ。

**開窗的兩條路**：

1. 狀態列的 **BtChat**（`sub_4F6B70` 經 vtable slot 32 建鈕，反編譯引數為
   `Create(this, parent, id=1004, x=65, y=91, type=2, &out)`；**沒有 w/h 引數**，38×17 來自
   `UI/StatusBar.img/BtChat` 這張 canvas。狀態列原點 y=392 → 頁面 (65,483)。
   `sub_4F88C0` case 1004 → `sub_4DDF10(0)`）：`roomId=0`＝開新房。
   （六顆鈕的 id/x/y/type 表與原版矩形互相重疊一事見 `docs/NATIVE_MESSENGER.md`／ADR-114。）
2. 邀請模態的「是」（`sub_4E1BB0`）→ `sub_4DDF10(roomId)`，roomId 就是 `0x4D type 3` 帶來的那個 u32。

`sub_4DDF10` 先建窗（`sub_4DDAF0`：`this_8 == nullptr` 才 HeapAlloc；已開著＝no-op，所以 BtChat
連點不會開兩扇），視窗 297×335、home (500,50)（`sub_43D750` uiWndX5/uiWndY5）。建窗即印五行說明
（`sub_4DDFE0` 在送 `0x24 type 0` **之前**先印）；之後的 participant 回包逐格填人。

**`sub_4E0FF0` 的控制項矩形**（窗內座標）：id 1000 關閉鈕 (152,9,26,26)＝`UI/UIWindow.img/BtUIClose`；
id 1001 輸入框 `CCtrlEdit(11,286,176,12)` 上限 256 字；id 1002 捲軸
`CCtrlScrollBar::Create(parent,1002,1,0,179,58,218,0)`，`+44 = 172`（列內容寬提示）。log 繪製
（`sub_4E1320`）自 pos 繪 16 列，x=10、y=63+13k；**append**（`sub_4DEE50`）以 `sub_439A70`
按**寬 170**（`n170=170`）折行、接續行前置 `"    "`（`asc_5BC328`），ZList **無上限**，
follow＝`pos >= count−16`（unsigned，count<16 恆 false）或新 count==16，然後 SetMax(count−15)、
follow 才 SetPos(max−1)——與交易 log 同一個 CCtrlScrollBar，故共用 ADR-094 抽出的
`client/vscroll.ts`（travel 218−2×12−12=182；max=rows−15）。成員欄（`sub_4DFB50`）：腳底
y=103+98×slot、avatar 置中於 charView 欄 x=248、名字白字 (202,105+98×slot)；頭像是
**活的 Shape2D 子窗**（`v9[1]`，`sub_434120`＋"Shape2D#Vector2D"），OnTimer 每 30ms tick ⇒
原版메신저頭像會播站立動畫（瀏覽器以 `member.since`＋`avatarMotionCatalog` 還原）。

**PE 內逐字讀出的韓文字串**（VA→檔案偏移直接自二進位读出、cp949 解碼）：

| 字串 | PE 位置 | 用途 |
|---|---|---|
| `[ Maple Messenger 도움말 ]`＋四行 | `.data` help 區塊 | 開窗即印的五行 |
| `- '%s'님이 입장하셨습니다` | aSI_0 | `type 0` announce |
| `- '%s'님이 퇴장하셨습니다` | — | `type 2` |
| `- 초청 받은 대화방에 참가하지 못했습니다` | — | `type 1` |
| `- '%s'님에게 초청 메시지를 보냈습니다`／`- '%s'님을 찾지 못했습니다` | — | `type 4` ok=1／0 |
| `- 다른 캐릭터의 이름을 입력하세요.` | — | `/초대` 名字空／邀自己 |
| `- '%s'님께서 대화방 초청 메시지를 보냈습니다` | @5BC87C（`sub_4E1BB0` 內 push aS_8/aSE_0，004E1C44/004E1CCE）| 邀請到達時**視窗已開**：只印一行 |
| `'%s'님께서 대화방\r\n 초청 메시지를 보냈습니다\r\n초청에 응하시겠습니까?` | @5BC834 | 邀請到達時**視窗已關**：模態（是→進房；沒有拒絕封包，TTL 60s 自然過期）|
| ` 님이 입력중입니다` | aI_13 | typing 列；多個名字以「,」相接 |

**打字（typing）鏈**：`sub_4DEAF0` 每 3000ms 檢查（`+96` countdown、`+92` flag）：輸入框非空且未送過 →
`0x24 type 5` 送 `名字+"1"`；清空且送過 → `名字+"0"`。**沒有 `" : "` 分隔**——收端（`sub_4E1E30`）
`flag = (right(line,1) != "0")`（任何非 `"0"` 字元都算 on）、比對成員名，只更新 typing
（`vtable+232(avatar COM, flag ? 0xCFFFFFFF : 0)`＋底部 (11,316) 印 `名字… 님이 입력중입니다` 列），
**不印成聊天行**；含 `" : "` 的聊天行則以同一迴圈 flag=0 **先清掉發言者的 tint** 再 append。
`vtable+232`＝ARGB modulate：建構色 `0x00FFFFFF` 正常顯示 ⇒ alpha 0 是 identity；CharSelect
`sub_42E210`（選中 `0xFFFFFFFF`／未選 `0x80FFFFFF` 可見 50% 暗）交叉證明 alpha byte＝不透明度 ⇒
typing＝**204/255≈80%**。伺服器政策（`loginserver.ts` `sayInMessenger`）：無分隔的行只重蓋前綴
（防偽造他人名字）原樣轉發，絕不組成聊天行。瀏覽器 `ctx.globalAlpha = 204/255`
（舊 0.35 近似已按原證更正；`0x0CFFFFFF` 是轉錄錯誤，byte grep 證明 EXE 內不存在）。

**說話與指令**（`sub_4DE490`／`sub_4E24B0`）：Enter 先比對 `/q`（視窗關閉＋`0x24 type 2`）再比對
`/초대`（CP949 三個 byte 前綴；取空白後的名字送 `type 3`，空名／自己＝印 otherName 列不送）；
其他 `/…` 原證只有這兩條指令——未知指令不送不印（🟡 靜默 no-op）。一般文字：client **自己組好**
`自己名字 + " : " + 文字`，**先印在自己的訊息區**才送 `type 5`（所以伺服器不回送給說話的人）。

**瀏覽器接線**：`ClientSession` 的 `0x4D` 分派照 `0x50` 的樣子在**邊界**轉 CP949
（`decodeMessengerEvent` 收、`byteStringOf`＝`encodeCp949` 送——`writeAsciiString` 只吃 byte string）；
webclient 路由 `messenger-enter/leave/command/say`；輸入框是 `#game-ui` 內的真 DOM `#messenger-say`
（隨窗移動、Enter 送、Escape blur）。訊息**無上限**（`sub_4DEE50` 的 ZList 只增不刪；舊瀏覽器
128 行 cap 已移除）。捲軸按住 auto-repeat 以 `vscroll.tick()` 重現（`sub_4523D0` 50ms gate、
同 zone 才續、thumb 不重複；release 的 page 分支是原版死代碼，`cmp [esi+3Ch], eax` 拿 tickcount
比 zone）。SystemMenu 的
goMessenger 勾選框啟用（`sub_4E1BB0` 的 `CConfig+28` 閘門；瀏覽器端 `gameSettings.messenger` 同 policy）。

**驗證**：`messenger.test.ts`（type 6/7 round-trip＋hex＋describe）、`messenger-state.test.ts`
（模型全 transition＋slash 規則＋捲軸幾何＋flag≠"0"＋聊天清 tint＋6/7 語意＋無上限＋since）、
`vscroll.test.ts`（50ms gate／zone 追蹤／page 連翻／thumb 不重複／release 無動作）、
`native-messenger-session.test.ts`（0x4D→事件、0x24 四方法、CP949 邊界）、
`native-messenger-browser.test.ts`（Chromium：hit 矩形、40 行釘底 max=25/thumbTop=194、捲動重繪、
成員名與 typing 列像素差、typing 頭像 204/255 像素差、邀請模態 yes→roomId 42）。

### 4.42 ✅ AP 請求的 bytes／🟡 能力窗與四基礎能力分配

`sub_4F2D70`（CUIStat button ids 2000..2005）呼叫 `sub_55CF60`。後者用
`sub_4A1EA0(&packet, 27, nullptr)` 建包，接著直接寫一個 u32 mask，再送出：

```text
c2s 0x1B: [u32 mask] — 沒有 timestamp，沒有欲設定的能力值
HP 0x800 / MP 0x2000 / STR 0x40 / DEX 0x80 / INT 0x100 / LUK 0x200
```

它檢查 native pending gate、HP>0、AP>0、距上次送出至少 500ms；送出後設 pending。
`s2c 0x0D` 的非零 ack 清除 gate（§4.21），拒絕也不能不回應。
**勿把 AP 的 c2s 0x1B 和近戰 c2s 0x0F 混淆，亦勿和 s2c 方向的 CUserPool 區間混淆。**

`sub_4F2450` 的窗為 176×315；`sub_4F2820` 配置 BtApUp：x148、y112/130/202/220/238/256，
BtDetail (122,280)。`sub_4F3210` 依 AP!=0 enable 六個按鈕；500ms 是 sender gate，不是把有 AP 的
按鈕短暫換成 disabled 圖。`sub_4F32D0` 繪字座標與原 WZ 路徑見
[`../SMOOTH_STAT_VALIDATION.md`](../SMOOTH_STAT_VALIDATION.md)。

實作 `protocol/ability.ts`、`game/ability.ts`、native dispatch、ClientSession、Web bridge 與原能力窗。
只落帳 STR/DEX/INT/LUK 各 +1/AP-1；單 mask／長度／點數／alive／500ms 均檢查，成功立即 persist，
拒絕回空 diff+ack。0x0D 四基礎能力為 u8（§4.21.1），因此拒絕 255 再增加且不耗點，不宣稱這是原遊戲上限。

HP/MP 自然／AP 成長現已由原表接上（見 STAT_GROWTH，未測試）；升級發放 AP/SP、Detail 與完整裝備／buff 總能力仍未定位或未完整接上，不用後期版本公式填空。
真 TCP／WS／隔離 Chromium 六 AP 測試均走原封包，不是只改畫面；限制與重現見上方驗證文件。

### 4.43 ✅ 原版門類型、CharacterData+101 與繩頂登台（2026-10-17）

| 原函式 | 已確證行為 |
|---|---|
| `sub_4A3920` | pt3獨立auto陣列，其他pt（含0）保留WZ列舉順序進一般陣列 |
| `sub_5124C0`／`sub_4A47D0` | 每user update找type3，x/y±50，不要求grounded／↑ |
| `sub_512510`／`sub_4A4740` | grounded＋↑，一般陣列pt!=0，x±20/y±50；反向找，RECT右／下exclusive |
| `sub_511820` | CharacterStats+101為一般門陣列u8索引，初始化x=portal.x、y=portal.y−10 |
| `sub_542DF0` | 攀爬向上越y1且uf=true→y1−5並detach；uf=false→clamp；越底→y2+1 |

1000000的八條真繩頂平台全部y1−2；舊y1−1會在平台下方，非素材缺失，也不應擴大floor snap。
已改原版−5並由swept gravity落地。tm=0也不是無效門；真正無目的地為999999999，pt0不可啟動。
`tn`→non-pt3 index→`spawnPortalIndex`→0x16／保存／SelfView.spawnPortalIndex，前後端與remote一致。
mode仍有未明語意，但不能再把它與spawn byte混為一談。

**改名（ADR-136）**：意義已由 `sub_511820` 定案，故不再留「保留舊欄名」的妥協——
`CharacterStats.unknown101`→`spawnPortalIndex`，`SessionSnapshot.spawnPortal`→`spawnPortalIndex`，
瀏覽器端 `SelfView.spawnPortal`→`spawnPortalIndex`，全專案統一一名。
wire 是位置性的 `writeByte`/`readByte`，**改名不改封包**；save 的 JSON 鍵會跟著改名，
因此 `characterFromSave` 在新鍵缺席時仍讀舊鍵 `unknown101`（`save.test.ts` 有回歸，
移除該 fallback 會讓舊檔的門索引靜默歸零 → 測試紅）。`SAVE_VERSION` 維持 1：格式沒變。
同時收回 `spawnPointOf` 的「沒給索引就走另一套」分支：一律是「非 pt3 陣列的第 0 個、腳下 y−10」，
與原生 byte=0 的行為一致（原分支只影響 world-only fixture，正式流程一律帶索引）。

`/map`／`/warp`／`/go`／`/헉맵`用原0x0D kind=mapId/empty string；GameEntryServer採明確
`--map-command off|all|account,...`政策，預設off，原TCP偽造也不能繞過。kind0與revive重疊：
僅獲授權且alive時作map0命令；dead仍revive。這是server policy，不宣稱原server GM權限已還原。
`/maps`、`/where`、`/help`是browser便利命令，不創造native opcode。

完整561/561＋TS PASS；八繩×三刷新率、真TCP／WS、Chromium往返門／隱形門／空中type3及登台保持均PASS。
來源表、精確幾何、隔離fixture、重現指令與尚未完成部分見
[`../PORTAL_CLIMB_VALIDATION.md`](../PORTAL_CLIMB_VALIDATION.md)。

### 4.44 ✅ CUIMiniMap原框、裁切與標記（2026-10-17）

`sub_4E52C0`讀miniMap/canvas、world width/height、centerX/Y、mag；NPC只取life.type=n原x/y。
canvasW>=280改內容W210，canvasH>=150改H112。`sub_4E5C70`以unit=1<<mag、玩家位置與world/center
先clamp低再高，算crop後**1:1**貼原圖；point為floor((center+trunc(world))/unit)−crop。
背景白覆A0000000；pt2門CC8090FF（128tick前64亮），NPC AA20FF20（80tick前40亮），
其他人AAFF2020、自己最後DDFFFF00。標記是相疊矩形，與原圖同受內容clip；不標怪物與隱藏／自動門。

`sub_4E6430`用UI/UIWindow.img/MiniMap八片框，window=W+6/H+13、內容(3,3)，sw45×11含MINIMAP字。
`sub_4E7030`是M（scan0x32）切換；`sub_43D750`window type4預設(8,8,shown1)。
`sub_553F40`→`sub_549660`每30ms呼叫registered updates；小地圖每4次更新快取，不依螢幕RAF頻率。

100張真WZ：80有canvas、20沒有node，mag全4；沒有node不造fallback。
已接mapart metadata→webclient→client/minimap.mjs；M／drag／位置顯示保存與上層canvas UI遮擋。
純幾何／標記／WZ及真Chromium操作／三種尺寸／無node／1:1 blits通過；標準564/564＋TS。
精確矩形、crop與框座標、原函式表和限制見 [`../DISPLAY_MINIMAP_VALIDATION.md`](../DISPLAY_MINIMAP_VALIDATION.md)。
localStorage是browser設定替代，不冒稱原per-character設定或絕對閃爍相位已同步。

### 4.45 ✅ 交易視窗／幾何／CConfig go\* 閘門（ADR-091）

`0x25`／`0x50` 的欄位見 §4.39／§4.40；本節補**視窗與閘門**層，完整表在
[NATIVE_TRADE](../NATIVE_TRADE.md)：`sub_4815E0` 無視窗時只認 1/2/4（其餘斷線）、type 7 是
`nullsub_58`；`sub_481790`→`sub_481570(1)`→`sub_481D00`（count/myIndex/成員循環）；
`sub_4D2DB0`+`sub_461C50` 置中 (216,152)；`sub_4D3EF0` 控制項 1001/1002/2/1003/1004（1004 與
BtLock/BtReset 同為「存在但無消費者」）；`sub_4D4960` 的 log(92,21,182,217)@50%黑、名字
x=44/327@y110、mesos 右齊 84/366@y277、lock wash (286|4,124,76,144)@`0x80FFFFFF`（ARGB 已證）；
`sub_4D63C0` 8+8 格；`sub_4D5C80`/`sub_4D5F50` 的 500ms throttle 與 `n3000[6]`；`sub_471A40` 的三句
chat 閘門；`sub_481910` 的 `CConfig+0x20`(goExchange)＋GM 閘門；CConfig 六 go\* 的登錄名／預設／
消費者（goWhisper=0 → `0x23 [1][34][sender][me]` 自動回絕、goGame 零引用）。

**補記（2026-10-19，ADR-092）**：①log 文字畫家 `sub_4D5730`：`for (y=26; y<234; y+=13)` 於 x=94、
font=`this+61`、首列＝scrollbar 位置 `*(this[58]+48)` → **恰 16 列**（瀏覽器無 scroll 拖拉，釘底顯示
最後 16 列）。②數量字 `sub_4D5440`＋`sub_525AE0`（逐位數畫家：left/top 錨點、x 依「位數寬＋間距」
前進）：非裝備（`id/1000000!=1`）畫於 **(35c+291, 35r+148)**＝格左上 (-1,+19)；裝備不畫。
③`0x50` type≥6 的 `sub_481EB0` 已讀完：位元組＝**房間槽索引**，槽非空→`AVCDisconnect(0x21000003)`；
槽空→釋放舊指標、清槽、`sub_482340(idx,reader)`＋vtable+0x38（即「開另一種房間」之路徑；本伺服器
從不送 type 6，瀏覽器對未知 type 丟 RangeError＝🟡不可達）。④goParty=0 時 party s2c case 3
（MapleStory.exe.c:353029）**整包靜默忽略**——不顯示「'%s'님이 파티에 초대했습니다.\r\n파티에
가입하시겠습니까?」（PE 0x5C0304 原文，與瀏覽器逐字相同）、**不回任何包**；瀏覽器已同語意接上，
選項 UI 的 exchange／party 兩格因此啟用（messenger＝無瀏覽器消費者、game＝原版零引用，仍停用）。
⑤（ADR-094）log scrollbar（id 1003）全鏈完成： dword 佈局 +48 pos／+52 max／+56 hit-zone／+64 capture／
+68 arrowLen=12（`sub_451240` Create 後以 COM art cell 高度回填，asm 004512E4-004512F5）／+72 trackLen=216／
+84/88/92 drag startPos/X/Y（`sub_452670`）；建立參數 Create(parent,1003,1,0,x=262,y=21,len=216,0,1) 於
`sub_4D3EF0`（asm 4D4262-4D42E8），`+44=166` 為 log 換行寬。clamp=`sub_452150`（max>1 → pos∈[0,max−1]）；
hit zone=`sub_452500`（外／max≤1→100；v≤12→101 up；v≥204→102 down；thumbTop=12+floor(pos×180/(max−1))；
<thumbTop→103 pageUp；≤thumbTop+12→105 thumb；else 104 pageDown）；箭頭±1=`sub_4525B0`(notify 300/301)；
頁面±max(floor(max/16),16)=`sub_452600`(302/303)；拖拉 pos=startPos+(double)max×dy/180 截斷+clamp=
`sub_4526A0`(304，hit 用 max−1、移動用 max)；放開=`sub_4522B0` ReleaseCapture；滾輪=`sub_452340`
PtInRect(own rect)→pos±steps；按住 auto-repeat=`sub_4523D0`（timer，瀏覽器不重現🟡，同 skills 政策）。
append 規則=`sub_4D5900`：wasBottom=pos≥舊max−16 於 append **前**判定，append 後 max=count−15，
wasBottom∧max>1→pos=max−1；繪製=`sub_4D5730` 自 pos 起 16 列。art=`UI/Basic.img/VScr/{enabled:{prev0,prev1,
next0,next1,base,thumb0,thumb1},disabled:{prev,next,base}}` 皆 12×12 Canvas（WZ dump 實證；EXE 無 VScr ASCII，
paint 函數未在 vtable3 定位——browser 以 skills.ts 同款 stamp 還原）。實作：`client/trade-state.ts`
`tradeLogScroller()`（純函數庫）＋`client/trade-window.ts` paint/hit＋`client/main.js` 滑鼠／滾輪接線；
單元（zone/clamp/follow/page/drag 截斷）＋Chromium（VScr cells、thumb 移動、首列重繪）皆綠。

## 5. 字元編碼

- 遊戲內字串（WZ）用 **ASCII / UTF-16LE + 位置遮罩**（見 `docs/WZ1_FORMAT.md` §3）。
- 網路訊息（封包）中的字串編碼**已解**：`u16 長度` + 原始 bytes，見 §4.4。
  ⚠️ 注意與 WZ 檔內的字串編碼（位置遮罩）**完全不同**，不要混用。
- 那些 bytes 是**人看的文字**時，字碼頁是 **CP949**（client 的 `sub_432680` 原樣收進 `ZXString<char>`，
  繪字時用系統 ANSI 字碼頁；`MapleStory.exe` 自己的韓文字串也是 CP949）。`server/src/protocol/cp949.ts`
  是雙向實作：解碼用 `TextDecoder("euc-kr")`，編碼是**反轉表**（第一次用到時建），
  編不出來的字元丟例外（§4.23.3）。

## 6. 待辦（依重要性）

1. **原 server greeting 的實際欄位值／尾端與 length 選擇**：client parser 的 byte layout 已由 `sub_43A410` 確認並遷移。仍未取得原 server raw bytes，故不宣稱 counted string 內容、是否存在尾端資料或官方固定總長；14-byte 空字串形式只代表 parser-valid minimum，不能冒充官方 captured fixture。
2. **實機驗證 §4.11 的三個 UNKNOWN**（有真實流量就能一次解決）：
   `0x16` 的 `mode`（三個 u32 已解＝場地亂數種子，地圖 id 已解＝`CharacterData.mapId`，§4.11.2／
   §4.11.2b；落點已另由 CharacterData+101 解出，§4.43）；`0x1C` 的 `unknown64` 與第二／第三個 u32
   （第一個 u32 已解＝**臉**，§4.11.3c）；`0x0D` 的 `kind` 其他取值。
3. **攻擊家族已全部解出**（`0x0F`／`0x10`／`0x11`，§4.13.1＋§4.13.1b），三支共用一個 codec，並且已經接上
   怪物的 HP（§4.17：`0x34`／`0x30`／`0x31`，伺服器把 client 報的傷害記在帳上）。
   還缺的是**真實流量驗證**（§6 第 2 項）。~~與 `0x10` 的 `u16 v138`。~~ → **那個 u16 已定位**：
   它是射擊用的**投射物 USE 分頁格號**（`sub_511630` 的回傳值），見 §4.11.7c；欄位叫
   `projectileSlot`，`ATTACK_SHAPE[0x10].extraU16AfterHeader` 就是它，四個測試檔都在用。
4. **CField 其餘區間**（分派已拆到函式，見 §4.12）：~~`0x1A` 的 sub-opcode 表~~
   （四個case與goWhisper拒收已接，ADR-059／§4.31；未測試）、
   CUserPool 的 `0x1E–0x29` 分支（**`0x27` 表情已完成，§4.35**；**`0x26` 隊伍請求已完成，§4.37**；
   `0x1F`一般聊天與normal/dead氣泡已接、未測試，見§4.35.5／ADR-059；**`0x23`／`0x24`／`0x25` ＝「別人的攻擊」已讀完（§4.11.7b）並且三支都轉播（§4.11.7c／ADR-027）**）、
   `0x35`（動畫區塊）的用途（`0x2F` 進場、`0x33` 移動、`0x30`／`0x31`／
   `0x34` 的離場／收屍／受擊都已完成，§4.15／§4.16／§4.17）、
   `0x46–0x48`（CQuestMan）**已完成**：只有 `0x47` 有 case，而且它就是 NPC 對話（`0x15` 是回包），
   見 §4.23；`0x4D–0x52`（messenger／miniroom）**交易已完成**（§4.40／ADR-032：`0x25` 七個 type、
   `0x50` 的 1／2／3／4／6／8／11／12／13、participant 的形狀、原子交換），
   **messenger 那半也已完成**（§4.41／ADR-095）：`0x4D`–`0x4F` 才是 messenger
   （`sub_4E18D0`／`CUIMessenger`，c2s 是 `0x24`），`0x50`–`0x52` 是 miniroom
   （`sub_4815E0`／`CMiniRoomBaseDlg`，c2s 是 `0x25`）——舊註解把兩組 opcode 寫反了，
   而且 `0x25 type 5`（`inviteByName`）也已實作（`loginserver.ts` 的 `case "inviteByName"`，
   `test/miniroom.test.ts`）。
   （CRewardPool 的 `0x42–0x45` **已完成**：只有 `0x43`／`0x44` 有 handler，見 §4.18；
   商店的 `0x4A`／`0x4B` **已完成**（開窗與結果；`0x49`／`0x4C` 沒有 case），
   加上 client 的 `0x33`／`0x16` 與那個空的 `0x19`，見 §4.22；
   CNpcPool 的 `0x39`／`0x3A`／`0x3B` **已完成**（`0x3B` 的語意＝「你自己走」也解了，§4.28），
   `0x38`／`0x41` 與 `0x3D` 的欄位仍 OPEN，見 §4.19；
   `CWvsApp` 層的 `0x0D` 能力值差異包 **已完成**，見 §4.21。）
5. **進地圖之後還缺的東西** ✅ 進場、移動、打怪與掉寶的閉環都已完成：`0x16` → `0x2F`（§4.15）→
   每段一個 `0x33`（§4.16，含腳踏點幾何）→ 命中／死亡／重生（§4.17：`0x34`／`0x30`／`0x31`，
   含 `dieMs` 與重生計時）→ 掉落物與拾取（§4.18：`0x43`／`0x44`／`0x0B`／`0x11`）。
   **經驗值與升級也接上了**（§4.21：殺怪送 `0x0D` 能力值差異包，門檻是 client 自己的公式）。
   商店也接上了（§4.22：點 NPC → `0x19`＋`0x4A`；買／賣 → `0x4B`＋`0x0B`＋`0x0D`），
   **用掉買來的東西也接上了**（§4.34：`0x18` 回血／`0x19` 換圖）。
   ⚠️ ADR-150 更正：效果**不是** client 自己的 `Item/Consume/0XXX.img/<id>/spec` ——
   2003 client 不讀 `spec`（§4.34.4c），血量是**伺服器算完用 `0x0D` 送回來**的；
   `spec` 是我們**讀 WZ 當伺服器用**，這點不變，且現在有原證支持。
   NPC 的對話也接上了（§4.23：點 NPC → `0x19`＋`0x47`，台詞是 `Npc/<id>.img -> info/speak`，
   client 的 `0x15` 走下一句）；**走過傳送門換地圖也接上了**（§4.25：`0x0D` → `0x19` ＋`0x16`，
   目的地是地圖資料的 `tm`，落點由 `tn`→+101 索引決定（§4.43），紀錄的 `mapId` 就是登入的地圖）；
   ~~剩下的 NPC 那一半是 `0x3D`（**伺服器指定**動作的 NPC）~~ → **ADR-062 已實作**：
   `0x3D` 的 forced action／語音索引／條件性 `CMovePath`／單一 controller 轉送都完成了
   （§4.28.2／§4.28.4，`native-npc-behavior.test.ts`），`0x3B` 的「client 自己走」也早就實作了。
   真正剩下的只有**任務**流程
   （`info/quest` 的腳本名已經讀得到，但這個 client 沒有任務 UI、`0x46`／`0x48` 也沒有 handler）。
   怪物 AI **不在伺服器上**（§4.20：它在 client 裡，伺服器只收到 `0x2C` 的回報），
   所以 ROADMAP 的「怪物 AI」屬於 Phase 3/4 的 client，而不是伺服器。
   ~~`0x2F` 那兩個只被查表的 `u16`（§4.12.1）仍是 OPEN~~
   → **已定位（ADR-149）**：兩個都是**音效組 id**（讀成 `u16`、**當 `s16` 用**），查同一張全域
   ZMap（`this_7 + 0x64`），結果建出 mob 的**兩支定位發聲器**（`mob + 26`／`+27`）。
   送 0 走的是「查表失敗」路徑（值是 0 而非錯誤），正是 client 自己會處理的那條，所以不擋路。
   **仍未證實**：這兩個 id 的鍵空間（那張表在 `.text` 只有讀、沒有寫）。
6. **`0x12`／`0x11` 的少數分支**：`0x11` 的 type ≠ 0/1 分支（已解＝背包滿的訊息，§4.18.5）、
   ~~`0x12` 的 type 4 之後~~ → **已解**（§4.38，`protocol/fame.ts` 的檔頭有 `sub_55C390`
   的完整對照表）：`0x12` 在 s2c 方向是**人氣**系統（c2s 的 `0x12` 才是一般聊天，同名不同方向），
   `type 0` 與 `type 5` 帶 `str name` ＋ `u8 up`、`1` 不顯示、`2`／`3`／`4` 是三種拒絕訊息，
   **`type 5` 的第二個名字是本機角色名（`*(CWvsApp + 36) + 4`）不是封包欄位**，
   `>= 6` 一律走「알 수 없는 오류」；codec 把未知 type 收成 `{ kind: "unknown" }` 而不是猜。
   `0x0D`／`0x0F` 共用 `4C5DC0` 的duration/mask已更正並解出（§4.21.2）；
   ~~`0x0F` 的其他mode／取消效果語意仍未定位，不造opcode。~~
   → **已結案（ADR-147）**：mode 就是第二個位元組 `B`（只有 0 有實作，其餘讀掉後丟棄）；
   取消不是 opcode，是 `sub_4C65A0` 的到期清除 ＋ `durationMs == 0` 的提早返回。
   **`0x0F` 結構上永遠不可能帶 buff 圖示**（傳 `nullptr` 給 decoder，拿不回 mask）。
   完整 asm 證據（兩個表頭位元組的 guard 順序、`push 0`、兩者的呼叫集合對照）見 §4.21.2
   與 `server/test/native-tempstat-0f.test.ts`。
7. **live greeting／後續首包的方向與階段 trace**：登入與遊戲 listener 已改用同一個 length-prefixed greeting codec；舊 live bad-header logs 產生於先前 211-byte harness，不能用作新格式的 raw evidence。若要定位那些歷史 session mismatch 的 runtime 原因，仍需同一連線的原始 bytes、端點與 stage，而不是再以舊模型解讀。
8. ~~由 §4.1／§4.5／§4.7–§4.13 的對照表產生 `protocol/schema/`~~ → 已做成
   `server/src/protocol/schema.ts`（§4.14，`cli.ts schema`，6 個反漂移測試）。
   剩下的只有**用 `capture` 對照真實流量**（與第 2 項同一件事）。
9. ~~`unknown97`~~ → **已證實是 `mapId`**（§4.11.2b：`sub_468E00` 用它載入 `Map/Map/%09d.img`）。
   ~~剩下的：`unknown18`／`unknown1A`（現金區塊）與 `unknown26`／`unknown93`（能力值區塊）。~~
   → **只剩 `unknown26` 一個**：
   - ~~`unknown18`／`unknown1A`~~：**已解**，就是 `GW_ItemSlot` 的現金三件組
     （`cashSn` 等，`sub_45E560` 寫、`sub_45E6A0` 比；`itemslot.ts` 的 `ItemSlotCashBlock`），
     現金裝備那一半也由 ADR-105 以 binary 證據結案（§4.36.6）。
   - ~~`unknown93`~~：**已解**，它不是欄位，是 `mesos` 混淆配對的另一半（`+89/+93`，§4.22.5）。
   - `unknown26` 是唯一仍**沒有語意名稱**的紀錄欄位，但不再是傳輸缺口（ADR-153）：它是夾在
     `appearanceB` 與下一個 dword 間的 u8；CharacterData 讀／寫、`0x0D` diff 的 u32→low-byte
     截取及反向 zero-extend 都已交叉驗證，且 listing 沒有找到直接的規則／外觀消費端。新角色設 0
     是伺服器重建政策，舊角色原值保留。不要猜成 skin；若要知道它在原 server 的真正用途，仍需
     原伺服器或真實角色資料。**能力值與錢的位移已經沒有 unknown 了。**
   `spawnPortalIndex` 已解為出生門索引，見 §4.43。
10. ~~**組隊的 102-byte 角色區塊**（§4.10 `0x10` type 13）與 §4.11.3 的進場紀錄是不是同一種
   格式~~ → **比過了，不是同一種**（已結案）。`sub_45F5C0` 是一次 `qmemcpy(…, 0x66)`，
   所以格式只能從讀取端定：`sub_55DB00` 用 `this + 408 + 4 * i` 取角色 id、用
   `this + 432 + 13 * i` 找名字（i = 0..5），`sub_55CC40`（`/파티정보`）也以 13 bytes 步進
   印六個名字。故名冊＝ `u32 characterId[6]`（24）＋ `char name[6][13]`（78）＝ 102，
   空位全 0 —— **它只有 id 與名字，不是角色紀錄**。兩者**唯一**共用的東西是名字欄的編碼
   （13 bytes、NUL 結尾、CP949），`party.ts` 直接沿用 `chardata.ts` 的 `nameFieldBytes`。
11. **`0x0D` 的暫時能力尾段已重新定位**（§4.21.2／TEMPORARY_STATS）：舊panelFlags命名錯誤，
   現在已有duration/mask/values/source codec及加速藥水（未測），其餘戰鬥buff效果仍缺。
   ~~**AP／SP 自然發放量仍缺**~~ → **ADR-142：定位為「不存在」，不是還沒找到。**
   整份反編譯只在一對 getter（`sub_4F5450` 讀 `+69/+71`、`sub_4EF600` 讀 `+73/+75`）裡
   **讀**這兩個欄位，沒有任何寫入者；`sub_4C71C0` 是全 exe 唯一的升級常式，只動 level／exp／
   HP·MP 上限與補滿，完全不碰 AP／SP；`Etc/MakeCharInfo.img` 也沒有。所以 2003 年的發放量
   整段在 server 上，而 server 不在這一版裡 —— **任何數值都是我們的政策**，故做成具名常數
   `DEFAULT_LEVEL_REWARD`（5 AP／3 SP）＋ `--ap-per-level`／`--sp-per-level`，開機時印在 log，
   `level-reward.test.ts` 釘住「只有 getter、沒有寫入者」這件事本身。
   HP／MP 的原表與被動已於本輪重新定位並接上，
   舊「client 裡沒有成長量」判讀錯誤，見 STAT_GROWTH／ADR-047（均未測試）。~~「被怪物打 → 扣玩家的血」沒有驅動者~~ →
   **已解**：驅動者是 **c2s `0x1C`**（client 自己算完傷害、回報差值，伺服器落帳並用 `0x0D` 回覆），
   見 **§4.33**／ADR-021；`0x2C` 的尾段確實是**路徑**不是傷害（§4.20.7），所以傷害從來就不在
   `0x2C` 裡。
12. ~~**`mesos` 在 client 角色紀錄裡的位移**~~ → **已解**：`+89/+93`（第 22 欄）就是錢，
   `0x0D` 的旗標 `0x40000` 送它（§4.22.5）。剩下的延伸題是「**商店的庫存與收購價**」——
   ~~原伺服器的商店是腳本，所以那是我們的選擇（ADR-010），而不是還沒解出來的東西。~~
   **錯，ADR-140 已結案**：庫存與售價一直在 `Npc/<id>.img/info/shop`（20 個 NPC、594 列，
   每列自帶 `price`／`stock`／`period`，207 另有 `unitPrice`）。只有賣回商店的**收購價**
   （`SELL_PRICE_RATIO` 五折）仍是我們的選擇。
   同一句話也適用**新角色的起始錢**（`--start-mesos`，預設 0：2003 年的新角色身上沒有錢，
   連一罐紅水都買不起，那是設計而不是缺口）。紅水的**商店價是 50**（루시 11100），
   不是道具自己的 `info/price` 25；ADR-140 之前這裡引用的 25 就是拿錯的那個數字。
13. **多玩家在同一張圖之後剩下的洞**（§4.24.9）：`0x1C` 的 `unknown64`／第二與第三個 u32／`action`
   語意（仍送 0；第一個 u32 ＝ **臉**已解，§4.11.3c）、`0x34` 的廣播範圍（我們的選擇）、`0x29` 的
   ~~effect 1（未解）~~ → **已解**：effect 1 是「學到技能」
   （`sub_522300` type1 再讀 `u32 skillId` ＋ `u8` 等級），`readUserEffect` 已解；
   effect 2 以上拒收而不是當升級解。「不送給升級者自己」的推論、頻道／分流
   （`FieldRegistry.of` 是入口）、
   以及**兩個真 client 的實機驗證**。
14. **NPC／怪物的「client 自己走」與我們的權威之間的關係**（§4.28.3）：`0x31` flag 1 會讓原 client
   自己走那隻怪（`sub_485330`），而我們是伺服器每條腿送 `0x33` —— 兩者會不會互相打斷
   ~~只有 oracle run 能回答~~ → **client 那一半已經回答了（ADR-151）：不會打架，`0x33` 會先踩煞車。**
   四條路共用**同一個判斷** `sub_485520(mob)` ＝ `*( *(mob+27) + 24 )`（「有 controller 在跑嗎」），
   但**反應並不對稱**：

   | 誰 | controller 在跑時 |
   |---|---|
   | `0x31` flag 1（推進一步 client 自己的走法）| **什麼都不做**（`if (result == 0)` 才進 `sub_485330`）|
   | `0x31` flag 0（移除）| **先停**（`sub_485330(v6, 0)`），`*(mob+112) == 0` 才真的放掉 |
   | `0x33`（伺服器送的移動）| **先停**（inline 同一個 vtable slot 184、七個 0 的呼叫），再套新路徑 |

   收尾狀態也對得上：`sub_485330(mob, 0)` 停在 `-2`／`-3`（`4→-2`、`5→-3`，其他→`-1`），
   而 `0x33` 結尾寫的是 `*(mob+29) = -(flag != 0) - 2` —— **同一組停止狀態**。
   ⇒ **伺服器端的 `0x33` 永遠壓過 client 自己的走法**：收到第一個 `0x33` 就會停掉 `0x31` 開的場，
   所以我們「每條腿送 `0x33`」這件事**不管原伺服器送不送 `0x31` 都安全**。
   **仍未解（真的要 oracle run）**：`--npc-walk` 的**預設值**（目前 `none`）——
   原伺服器走了哪些 NPC 完全未知；以及原 server 對 sender+2／receiver raw 索引的處理、
   原 controller 挑選／距離政策。ADR-062已確認+250..260是當前CMovePath元素，template+8是move存在。

15. ~~**「已在線上」的處理**~~ → **已完成**：`OnlineAccounts`（`account → 活著的 session`）＋
   `SeatKeeper`＋`Heartbeat`，見 **§4.30** 與 ADR-018；`0x01` 對已在線上的帳號回 `7`，
   第二條連線佔同一個角色也會被關掉，安靜的 session 由 `0x08` 心跳清掉。剩下的問題只有**號碼**：
   ping 間隔與逾時是我們選的（30 s／90 s，`--ping`），實機跑一段時間就知道合不合適。

16. ~~**`0x06` 的 10 個外觀 u32 → `CharacterData`**~~ → **已完成（§4.8.1a、§4.11.3d）**：
   臉、頭髮、上衣、褲子、鞋子、武器，然後四顆骰子。伺服器把**臉與頭髮**寫進新角色紀錄
   （`appearanceA`／`appearanceB`）、把**第 3–6 個**變成**穿戴裝備**（格號 5／6／7／11 由 itemId 的
   part code 決定：`wornOfLook` ＋ `withWorn`），`0x1C`／`0x05`／`0x02` 三個出口都據此送對
   （`avatarItemsOf` 讀的就是同一個穿戴 Map）。格號的證據鏈見 §4.11.3d。
   **骰子亦已完成**：newDlg 的四行標籤配合 `sub_430690` 四個 y 座標確定
   STR／DEX／INT／LUK 次序（§4.8.1a）。瀏覽器讀真 MakeCharInfo、套用骰點並走原始封包，
   驗證與剩餘限制見 `../CREATION_VALIDATION.md`。~~裝備的初始 `ruc`／能力值仍未套入 WZ info。~~
   **已補**：`createCharacter` 現在把四件起始裝備整件換成 `equipmentFromTemplate`
   （＝ `sub_47A740` 的 15 個 WORD + `tuc`→`ruc`），缺模板直接丟錯而不是默默給出全零裝備；
   `equipment-generation.test.ts` 有釘住。舊存檔走顯式的 `planBlankStarterRepair`（不自動跑）。


17. ~~**ADR-059已編輯、未測試**~~ → **行為面已測試，原證本輪補上（ADR-144）**：
   - 行為：`native-chat-gameoptions.test.ts` 7 個測試已釘住 c2s `0x23`/`0x22` 拒收、
     s2c `0x1A`/`0x22` 回 sender、`0x1F` 公開聊天（`51D530`／`50B320`）、`4373A0` 五秒氣泡、
     `55CDE0` type0／type1，以及 GameOpt 接線（只有 goGame 仍 disabled）。
   - **原證（本輪新增，`native-whisper-gate.test.ts` 5 個測試，4 突變全數釘死）**：
     `goWhisper` 確實是 **CConfig+24** —— `sub_472910` case 9（進來的密語）讀
     `*(_DWORD*)(n0xC8 + 24)`：`!= 0` 就把 `"%s>> %s"` 那行走 `sub_4FB670` 送進聊天記錄；
     `== 0` 就組 c2s `0x23`（35）＋子型別 `0x22`（34）送出去＝**自動拒收**。
     旁證：`sub_4E7030`（goMiniMap）讀的是同一個物件的 **+20** 並且原地反相
     （`*(_DWORD*)(n0xC8+20) = *(_DWORD*)(n0xC8+20) == 0`），IDA 的 guessed-type 註解把
     `n0xC8` 定為 **`dword_5C1F74`** ⇒ 這是一組從 +20 起每 4 byte 一個的布林陣列，
     所以「+24 是 goWhisper」是**佈局推論**，不是單點猜測。
   還缺完整IWzFont／GDI metrics、Gr2D layer engine、Messenger／交換／Party／小遊戲UI，
   缺request ID的逾時回包關聯；不是等待「氣泡請求的文字從哪來」。

18. ~~**死亡的另一半**~~ **（b）已完成：§4.33。**
   **(a) 誰寫入 `CField + 680` —— 已結案（ADR-145，`native-death-timestamp.test.ts` 7 測試／7 突變）。**
   舊註解的推測是對的，而且**答案比「往下找」更近一層**：`sub_5084C0` 本身就是那個呼叫者。
   整條鏈：
   1. `sub_5084C0`（動作位元組的 setter）：`*(this+45) = n35`，且只在「變了或被強制」時才寫。
   2. 同一支函式：`(n35 & 0xFFFFFFFE) == 0x12` —— 也就是 **18／19＝死亡** —— 時直接呼叫
      `sub_509AF0(this, (void **)(a3 == 0))`。**死亡時間就是在這裡蓋的。**
   3. `sub_509AF0`：三個閘（是本機角色、不是被強制的、而且 `+680` 還是 0）成立才寫一次
      `*(_DWORD*)(n3000 + 680) = *(_DWORD*)(n3000_0 + 20)`。
   4. `sub_558CF0`（每幀更新）：`n3000_0[5] − *(this+170) > 2200` 就從 `dword_5C25F0`
      配置 0x5C、交給 `sub_4E94E0` 建出復活視窗，並把 `+680` 清成 0（所以只彈一次）。
   5. `sub_558FD0`（進場初始化）與 `sub_559330`（卸載）清 0。
   `n3000_0[5]` 是 ms 計數（別處拿它跟 300 比）。
   > ⚠️ **這裡有個會讓人得出完全相反結論的陷阱**：`+680` 在 listing 裡有三種寫法 ——
   > `n3000 + 680`（`int`）、`this + 680`（`int`）、`this + 170`（`_DWORD*`，170×4＝680）。
   > 只 grep `680` 會**漏掉唯一的讀取端 `sub_558CF0`**，然後得到「寫入兩次、讀取零次＝死欄位」
   > 的錯誤結論（我第一輪就是這樣）。`sub_4FFE30`（CUIToolTip 建構式）的 `this + 170`
   > 又是**另一個物件**，別混進來。
   **這不再是**
   ROADMAP 的阻礙：扣血已由 §4.33 走完，`hp = 0` 現在是伺服器算出來的（`game/vitals.ts`），
   client 自己會走完死亡與 2.2 秒那條路（§4.32）。另外，**伺服器端的傷害驗算**（把 `Mob/<id>.img`
   的 `attack<i>` 搬到伺服器上重算）是 ADR-021 列出的後續選項，不是缺口。

19. **效果表的 loader（§4.34.4）**：`spec` 是怎麼被讀成 `dword_5C2038` 那張道具效果表的。
   ~~以及**原 client 對 `hpR`／`mpR` 怎麼取整**。~~ → **後半已收窄，見 §4.34.4b**：施用端
   （`sub_4BDDC0`）是 `hp − entry[+48]`／`mp − entry[+52]` 的**純減法**，查表端（`sub_4BDD20`）
   是純 hash 查表，**兩端都沒有任何百分比算術** —— 所以取整只可能存在於建表的 loader 裡，
   搜尋範圍從「整條補血路徑」縮到「`dword_5C2038` 被填的那一處」。`+48`／`+52`／`+56`／`+60`
   的語意、家族閘門與 HP（`>=`）／MP（`>`）不對稱的付得起檢查也都已定位。
   ~~`hp`／`hpR`／`mp`／`mpR`／`moveTo`／`slotMax`／`reqLevel` 在 `.exe` 裡
   沒有任何字面字串，所以入口不在字串表。~~
   → **錯，而且是同一個陷阱的第二次（ADR-146，`native-effect-fields.test.ts` 8 測試／6 突變）。**
   WZ 的 property 名是 **UTF-16**，IDA 把它們輸出成 `wchar_t aPad[] = L"pad";`，
   執行檔裡也放在 UTF-16 字串池而不是 NUL 結尾的 ASCII 池。**`grep -a "pad" MapleStory.exe`
   回傳 0 筆 —— 但 `pad` 就在裡面。** 所以「字串表裡沒有」若是用 ASCII 掃出來的，那是
   **偽陰性，不是證據**。這也是我處理這一項時第二次踩到（第一次見上面 item 18 的 `+680`）。
   **字段解析器是 `sub_4BC590`**（`004BC590`，listing 196596）：它用 `sub_405DF0` 依序讀 26 個
   字段名，填進擁有者 `+72` 那條 120 位元組效果陣列的其中一格：
   `hs, hp, mp, pad, pdd, mad, mdd, acc, eva, craft, speed, jump, hpCon, mpCon, itemCon,
   itemConNo, damage, time, prop, range, attackCount, bulletCount, mastery, x, y, z`
   （外加 `effect`／`ball`／`hit/%d`／`afterimage` 四條子路徑）。
   **`pad`／`pdd`／`mad`／`mdd` 四個連號出現**，正好 independent 地印證 ADR-143 對 `mdd` 的更正。
   而 `sub_4BC590` **只被呼叫一次** —— 來自 `sub_4BB270`，走的是
   `Skill/%03d.img/skill/%07d/{effect,hit/%d,ball,afterimage,level}`，**也就是技能樹**。
   ⇒ 這個共用的效果解析器在本版**只接在技能上，沒有接到道具的 `spec`**。
   **仍然真的不存在的是（兩種編碼都 0 筆）：`spec`／`hpR`／`mpR`／`moveTo`／`slotMax`。**
   所以：`spec` 這個節點名 client 連一個字串都沒有，道具效果一定是**由已經握著 `spec`
   節點的呼叫端**往下走的（`sub_4BC590` 那套字段名是共用的，但呼叫點不是）；
   `hpR`／`mpR`／`moveTo` 則**永遠不可能靠 client 的字面 key 佐證**，它們唯一的依據就是
   Data.wz 本身 —— 測試同時釘住「client 沒有」與「Data.wz 有」兩端，任何一端翻了都要改註解。
   它不擋任何功能（伺服器直接讀 WZ），只擋「原 client 的數字與我們的數字是否一致」這個問題；
   **未結的部分已從「找 loader」收窄成「誰把道具 `spec` 節點交給解析器」**。
> **✅ 第 19 項至此結案（ADR-150），而且是以「前提錯了」的方式結案。**
> 這個編號問的是「`spec` 是怎麼被讀成 `dword_5C2038` 那張道具效果表的」。
> **那張道具效果表不存在**：
>
> - `dword_5C2038` 是 **CSkillInfo 單例**（`sub_4BA4B0` 建構子寫入 `&CSkillInfo::vftable'`）。
> - `sub_4BDDC0` 是**技能的「付得起嗎＋付下去」**：`+48`／`+52`／`+56`／`+60` ＝
>   `hpCon`／`mpCon`／`itemCon`（道具 id）／`itemConNo`（數量）。
>   **決定性的證據是 HP（`>=`）／MP（`>`）的不對稱** —— 那是「不能用技能把自己扣死」，
>   補血道具不會想要這條規則。
> - 快捷鍵條目有 **kind**（`+0x94`）：**1 ＝ 技能**（`sub_518BF0`，本機扣完不送包）、
>   **2 ＝ 道具**（送 c2s `0x18`，效果由伺服器決定）。所以上面那整串全是技能那一路。
> - 而 `spec`：**這支 client 不讀它**。欄位詞彙只接在技能樹 loader 上（`sub_4BC590` 只有一個
>   呼叫點），詞彙裡**沒有 `hpR`／`mpR`**，而且 `spec` 在 UTF-16 與 ASCII 兩種編碼下都是 0 次。
>
> ⇒ 「原 client 對 `hpR`／`mpR` 怎麼取整」**沒有答案可查** —— 是問錯了版本，
> 不是「還差一處沒查」。`spec/hpR` 是 **WZ 有、2003 client 從不讀**的欄位。
> 原證與突變見 `server/test/native-skill-cost-check.test.ts`（10 測試／16 突變全數釘死）。
> 我們的 `game/items.ts` 讀 `spec` 是**當伺服器用**，這點不變，且現在有原證支持。

20. **buff 道具（`spec/time` 家族，§4.34.3）——已全部接通，剩 MDD 一個欄位**：`2002001` speed8 已接原
   0x0D暫時能力、原raw圖示與實際walk倍率；`pad`／`mad`／`acc`／`eva`／`pdd` 的實際消費者也已接
   （ADR-070/073 世代，`magic-skills.test` 的 wire-list 案例）。ADR-106 補上最後一個可證欄位：
   `02022002`（사이다）的 `pda` 是它自己對 PAD 的拼法——`info/desc` 写「5분간 물리 공격력이 20
   증가한다…명중률은 5 감소한다」，spec 給 `pda 20, acc −5`（desc 提名、spec 定值，§4.34.3 規則1）。
   全 Data.wz 只有這一件用這個名字；`consumeSpecOf` 以別名接入 pad 欄，同時出現 `pad`＋`pda` 的
   （這版沒有的形狀）仍整筆拒絕。duration/mask舊誤讀已更正，見§4.21.2。
   ~~現在整份 WZ 只剩 `mdd` 一個欄位沒有消費者，含它的道具照舊 `spec.unapplied` 整筆拒絕。~~
   → **錯，拿真的 Data.wz 盤點過了（`consume-inventory.test.ts`）**：45 件帶 `spec` 的道具，
   欄位名總共就這 13 個 —— `hp`／`mp`／`hpR`／`mpR`／`moveTo`／`time` 加上
   `speed`／`pad`（含別名 `pda`）／`mad`／`acc`／`eva`／`pdd` —— **`mdd` 一個都沒有**，而且
   每一件的 `unapplied` 都是空的。所以那條拒絕路徑是**給將來的 archive 用的安全網**，
   不是現在還在掉的洞（差別很大：後者代表有道具被白吃掉）。
   盤點也順手證實了 §4.34.3 規則 2 在真資料上只有一個例子：`02010006` 的 `hpR`／`mpR` 是
   **字串** `"50"`，讀不到值 → 整件不做任何事（不是當成 50% 補血）。

21. **道具欄拖放剩下的一件事**（§4.36.5）：**裝備的能力加成**。~~傷害是客戶端自己算的，所以本伺服器不重算
   武器攻擊力，換武器也不動我們的帳。~~ → **過時，ADR-141 已翻案**：`game/nativecombat.ts`
   現在把 `sub_4C7960` 的武器分支整條搬到伺服器上重算（武器→主屬／副屬對照表、`case 32` 的落穿、
   45／46／47 的槍星路徑），`native-physical-formula.test.ts` 8/8 突變全數釘死。落地本身的常數（壽命／可撿範圍／「必須動過」）是伺服器的選擇，
   要等實機 run 對照。（**現金裝備／戒指格 12・13／寵物家族已由 ADR-105 以 binary 證據結案**，見 §4.36.6：
   現金裝備照普通裝備穿、`wornCash` 是伺服器專屬回聲組、戒指有原生 sender 但這一版沒有內容、寵物零內容。）

22. ~~**人氣（§4.38）的配額不進存檔**~~ → **已結案（ADR-148）**：`AccountRecord.fame`
   進存檔，`FameLedgers` 是帳號列上的一層視圖（不再自己存一份），給完人氣會 `persist()`。
   證據是真重啟的整合測試（`serve.test.ts`：兩台真 socket 伺服器，中間只帶存檔的 bytes）：
   重啟後同一個對象 → `type 4`、同一天不同對象 → `type 3`，兩條配額都回來了。
   `fame.test.ts` 12 個、`save.test.ts` 22 個，變異 8 條釘死／3 條等價（詳見 ADR-148）。
   **仍然沒有 binary 證據的是**：「初學者的界線＝15」與「被給的人沒有等級下限」——
   這是我們的選擇，跟「配額記在帳號列」一樣，都不是從原伺服器看出來的。

## 7. 擷取工作流（ADR-004）

> ✅ 除了被動擷取，現在也可以**主動走完登入鏈**：
> `node server/src/cli.ts serve --port 8484 --game-port 8485 --account admin:admin`
> （實作 §4.8；原 client 導向該 port 即可走到選角畫面。遊戲內階段尚未實作，因此進地圖後會停在
> `GameEntryServer` 的角色記錄上。）

```bash
# 1. Session mode sends a 14-byte parser-valid minimum greeting (empty counted string).
#    This is a harness value, not a capture of the original server's chosen string/tail.
node server/src/cli.ts capture --port 8484 --out traces/login.jsonl

#    Pin both client cipher seeds; --handshake-body sets counted bytes (their original value is unknown).
node server/src/cli.ts capture --port 8484 --handshake 0x11223344:0x55667788 \
     --handshake-body 000102 --out traces/login.jsonl

#    Use --handshake off when the peer is expected to send the greeting first (e.g. replay).
node server/src/cli.ts capture --port 8484 --handshake off --out traces/login.jsonl

# 2. Decode raw greeting bytes then replay frames; without a greeting, provide seeds manually.
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
| `tools/wzimg.py` | `.img` 值層編解碼器：物件語法、名稱表、15 種型別、`Canvas`／`UOL`／`Shape2D#*` body、zlib 像素解碼。全檔 1,056 張 image 逐 byte 驗證（規格見 `docs/WZ1_FORMAT.md` §4） |
| `tools/wzdata.py <Data.wz> [--census\|--manifest STEM\|--maps OUT\|--dump PATH]` | 讀 `Data.wz` 的**唯一支援入口**：解析樹、驗證／掃描定位每張 image、統計 canvas 與像素、輸出 manifest／地圖 metadata／單張屬性樹 |
| `node server/src/cli.ts wz <images|census|maps|dump|png>` | WZ 的產品端入口（ADR-005）：目錄樹、值層、canvas 普查、地圖 metadata、單張 dump、像素→PNG；與上面兩個 Python 工具對同一組黃金值 |
| `server/src/protocol/mob.ts` | 怪物封包 codec：`0x2F` 進場（`u32 mobId`＋`u32 templateId`＋`s16 x,y`＋`u8 facing`＋`u16 ×2`＋動畫旗標區塊，§4.12.1）、`0x33` 移動（§4.16.1）、`0x30` 死亡計時／`0x31` 收屍與重生／`0x34` 怪物 MP（§4.17）；`encode`／`read`／`describe` 三件套，golden 測試在 `server/test/mob.test.ts`，`decode` 與 `cli.ts schema` 共用同一份 |
| `server/src/game/mobs.ts` | 一場地的怪物：出生點從 `life`、腳踏點折線決定巡邏範圍、每段一個 `0x33`；`Mob/<id>.img` 的 `info`（`speed`／`maxHP`／`maxMP`／`level`／`exp`）與 die 動畫長度（`dieMs`）由 `mobTemplateProvider` 快取。**怪物是伺服器驅動的**，並且有 HP：`applyDamage` → `0x34`／`0x30`，`tickPackets` 收屍與重生（§4.16／§4.17；golden 測試在 `server/test/mobs.test.ts`）|
| `server/src/game/map.ts` | 伺服器端的地圖視圖：`WzArchive.mapMetadata()` → `life`（怪物／NPC 出生點）、`portal`、`info`、腳踏點（`footholdSegments`）；`mapDataProvider(archive)` 做快取，`GameEntryServer` 用它送 `0x2F` 並驅動巡邏（§4.15／§4.16）|
| `server/src/wz/paths.ts` | 客戶端自己的 WZ 路徑（`Map/Map/%09d.img` ＝ `mapImagePath`、`foothold`／`ladderRope`／`portal`、`MapHelper.img`）；地圖載入器的函式表在 §4.11.2b，golden 測試在 `server/test/paths.test.ts` |


## 補充：CUIEquip／背包拖放與原視窗位置校正（2026-10-17）

`sub_4D89F0`的Equip窗176×315；`sub_4D9110`從PE VA005BC368讀14組(x,y)，每格32px，strict邊界。
反編譯的a7字串"7"實是座標表中y=55的低byte，不能以字串猜版面。
`sub_506440`把114/128,9存為Close控制座標；視窗位置另經`sub_43E340`讀CConfig。
`sub_43D750`給type0/1/2預設(24,24)/(48,48)/(72,72)，修正舊背包誤讀；能力窗原browser政策也改回native預設。
CUIItem的uiOpt0預設0、建構子+1給初始裝備頁，不能因有藥水便切USE。

sub_462DC0→4636B0雙擊裝備，4630A0／463A50拖放；均用既有§4.36的0x17，count=-1，
負格worn。req使用4636B0／4658E0的gender/level/job與四基礎能力，先排除舊部位與465B50／465C60互斥物。
本輪未在這些比較找到人氣檢查；舊§4.36將fame列為已比較需求過度，以實際比較的欄位為準。

ClientSession→WS→頁面接通ack／500ms、0x0B本人look重建與0x28旁觀原地外觀更新，保留remote path；
原0x0B op2 swap的正／負容器分開處理。一般換位／互換／穿脫立即保存，沒有改存檔schema或回填舊裝備數值。
WZ facts與wire instance stats分開；套服／褲、雙手／盾原子卸下的空格選擇仍是server政策。
真TCP／WS、VM、雙頁Chromium與既有功能回歸通過，570/570＋TS。
精確座標、函式表與未完成界線見 [`../EQUIPMENT_VALIDATION.md`](../EQUIPMENT_VALIDATION.md)。


## 補充：CUIItem捲動、CUtilDlgEx數量與商店預設值（2026-10-17；未執行測試）

- 4DA440建立id2001捲軸(147,80,h208)；4DA810／4DA8B0採每tab row，firstSlot=4*row+1。
  4DB170／4DB990的24格命中、矩形都相對於firstSlot，不能只捲畫面卻送可見格編號。
- 463BE0：cash／cash serial拒絕，4031家族先確認，非equip且非207的堆疊>1才問數量；
  4643F0→535C90(total,1,total)，不是預設1。207整組送0x17的to0。
- 4B6B40：4B7960(prompt,1,row[8])，故0x4A maxCount為**上限，不是預設**；
  校正舊shop.ts與shops.ts註解。4B6E90 sell則是(total,1,total)，207改Yes/No整組。
- type2由530C20給230內容寬；535EF0給外寬+22／textHeight+99；532A80給input
  (16,textHeight+38)、OK(w-119,h-42)、Cancel(w-65,h-42)。531110使用真UtilDlgEx Border/0..7。
- 本輪只讀CP949反編譯及WZ原樹／尺寸，沒有執行原Windows client動態oracle，亦沒有測試結果。
  實作、持久化／地面暫存界線與瀏覽器政策見 [`../INVENTORY_OPERATIONS.md`](../INVENTORY_OPERATIONS.md)。


## 補充：楓幣丟棄0x1F與207補充費率double（2026-10-17；未測試）

- 4DA440金幣按鈕2002=(8,294)，WZ BtCoin四態17×17。
- 4DAF70的原韓文「얼마를 버리시겠습니까?」，535C90(10,10,min(wallet,50000))；
  55D5F0建立opcode31，接u32 amount，檢查pending／HP／200ms。schema、describer、session、WS、browser、
  server及共享地面錢幣已接；0x0D非零ack釋放成功／拒絕請求。勿與s2c0x1F氣球混淆。
- §4.22的舊「207的8 bytes未知」結論更正：4B3780複製到row+24，4B4AD0讀為double，
  以(補充列+32容量-實物發數)*該double算補充費；47A1D0讀WZ unitPrice也是double。
- 4B3780把207列放到補充列表；只有price非零的列進可購買列表。瀏覽器與server買入row都按後者計數。
- 4B7130的原確認「정말로 충전하시겠습니까?」已CP949逐字核對；確認後重查格物件，再送action2+u16slot。
- 4B4AD0的右側售出列基數為info/price+ceil(quantity*info/unitPrice)，不是quantity*info/price。
- 464000交易拖放的207直接傳整組quantity，4D5C80排除一般count0但允許207 count0；
  新整組／空組在buy/recharge/sell/drop/pickup/既有server trade之間保留獨立物件。
- WZ八種207的基礎容量為500/500/700/500/400/600/800/600，費率0.3/0.4/0.5/0.6/0.6/0.7/0.8/1。
  ~~stock~~ **ADR-140 已找到原資料**：`Npc/<id>.img/info/shop/<item>/stock` 與 `period`
  就是庫存量與補貨間隔（「`period` 的單位是小時」仍是推論）。ceil整數補充費及50%回收仍是server政策，完整遠距扣彈仍未接，見ADR-045。
- 未執行任何測試、typecheck或browser；只解析原資料及靜態閱讀原碼。新增golden測試來源未執行。


## 補充：基本武器動作表與單發射擊（2026-10-17；未測試）

427F60讀PE VA5B2144（7 groups×2 rows×6 u32），427FE0讀5B2294（×4 u32）。normal列：
melee group1=[5,6,7,16,17]、2=[10,13,14,19,20]、3=[9,11]、4=[9,19]、
5=[9,10,11,16,17]、6=[6]、7=[16,17]；shoot group3=[22]、4=[23]、7=[24,25,26]。
43FC80把22／23命名shoot1／shoot2，24–26別名swingO1–3；不是移動action byte。
WZ1462000 shoot2/body有五幀150,150,250,100,100，speed4逐格取整後168,168,281,112,112。
原loader把info/attackSpeed寫src[8]（缺值3），508290→this[38]，4BE8B0夾0..6，
508700逐格trunc(delay×(speed+5)/8)，不再只是「attackSpeed最合理候選」。

511630依USE槽升序／相容／足量，0發跳過。511E20先近身測試，無近敵才513C80；
513C80基本遠界是角色x±200，近界x±n119、y−25，並非near再加200。
發射等待讀this[50]陣列最後格並由總delay扣除；飛行trunc(distance×1.5)，起點在近界，空射仍有飛彈及0x10。
41BC80讀bullet子畫布；41BF60按起點減終點向量atan2轉向。

本輪接通basic 0x10消耗1發、0x24扣彈前id轉播、0x0B put／clear timer0及原WZ動作／bullet。
**未把op1 key改解成quantity**；207保0，末箭清格後仍保留該次投射物id。
server排程／安全界線、canvas碰撞與暫定終點、ammo incPAD加入現近似公式皆有政策界線，
不能由client程式證明原server，也不代表技能／完整職業已完成。見`docs/BASIC_ATTACKS.md`／ADR-046。
使用者要求不測試，新增回歸來源未執行，非PASS紀錄。


## 補充：CUISkill／SP 學習（2026-10-17；新增實作未測試）

- 55D140送c2s0x1D＋u32 skillId；4EE1B0檢查HP／SP／pending／500ms，再用55ABE0的三態：
  前置不足0、已達max -1、其他1。沒有添加後期角色等級限制。
- CWvsApp55A900 **case14**→55B6A0才是技能map更新：u8 release、u16 count、每筆u32id＋signed32level，
  level>0寫CharacterData+382，否則移除；release非零解鎖並更新計時。**不是0x0F**、不帶expiry。
- 43FF00／PE VA5B40D4原名字表以CP949讀取：100검사、110전사、200매지션、230성직자等；
  43FFB0生成職業book祖先，job0不產生書。讀真WZ存在book，不填後期初心者技能。
- CUISkill4EC910為176×315；4ECD40 tab(3,52,w170)、scroll(161,116,h162)、close(128,9)；
  4ED8E0四個154×38 row在(5,119+40i)，icon(8,122+40i)，SP-up(139,137+40i)，SP(68,282)。
  4EE5E0一般row命中排除每列2px間隙；拖曳icon另是32×32。max仍用正常icon／skill1，僅req不足用disabled。
- 實作map32保存／完整進場snapshot與1000001／2000001成長讀取共用；不另建假技能等級。
  原codec之外，server權威交易／保存／SP stat回包順序是重建政策，非已擷取原伺服器序列。
- 本輪未執行任何test／typecheck／browser／VM／probe。主動施放、其他被動／buff、自然AP/SP及轉職未接；
  tooltip是簡化版。詳見`docs/SKILLS.md`／ADR-048，不把學習紀錄當成所有技能效果完成。


## 補充：自然恢復與原report的固定欄位（2026-10-17；實作未測試）

- 4707E0讀info/recovery成double，field+144、缺省1；558950同一倍率用於HP及MP，向零截斷後夾剩餘量。
- HP／MP計數各+30；站立action2／3且位置相同才累HP，其他狀態歸零；MP只需活人且未滿，移動也累計。
- HP1000000.hp（level struct+4）+10；MP2000000.mp（+8）+3，不是物品或成長x/y。
- 36／37是ladder／rope action，**不是場地type**。4BE790按job查1000002／4100001／4200001，讀time（+68）×1000；
  無技能／非正interval不能爬繩回血。真1000002第一級31秒、末級10秒；不補不存在的410／420書內容。
- 55B870固定寫flags5120=0x1400，然後兩個s16 HP／MP、u8 flag；HP／MP分開呼叫時另一delta仍0。
  繩梯HP flag1、MP flag0。ClientSession.recover明確補0，避免只寫單flag而偏離原sender。
- 恢復clock在browser client、同一0x1C→0x0D回值，沒有第二個server無條件補血timer。
  瀏覽器長幀／背景策略、未完整TotalStat／CVecCtrl，以及原report信任界線見RECOVERY_TEST_TOOLS.md。
- 本輪另加明示非原版的--test-tools面板；它不是新找到的GM封包／轉職規則，不加入native opcode catalogue。
  帳號owner驗證、confirm、記憶體還原點與升級保護是開發工具政策，不是原client證據。
- 沒有執行任何測試／typecheck／browser／probe；回歸來源未執行，啟服務不代表PASS。見ADR-049。

## 補充：有效裝備、Detail、普通物理與原傷害字圖（2026-10-18；實作未測試）

- **更正「尚未定位原傷害公式」**：4C7960是普通物理（741行）；4C89D0另為魔法路徑；
  4C8ED0是碰撞受傷，515CB0只匯出look。普通物理已接新路徑，魔法／碰撞未接受傷迴圈。
- 4C5020會從normal1..14加四屬性，再逐件扣掉自身加值檢查需求，第一件失格移除後重掃；
  包含原gender/job bit/mage weapon whitelist，不是把所有worn無條件加上。
- 4C5420／5740實例WORD為signed，基底MAD/MDD=INT，ACC依職業，EVA=truncDEX/4+truncLUK/2，
  hands=DEX+INT+LUK且未加equip craft；3000000.x及4000000.x/y直接加ACC/EVA。
- Detail原背景在 `UI/UIWindow.img/Stat/backgrnd2`，不是StatDetail；176×192，parent+(176,123)，
  x80、y12+18i九列。攻擊列不是傷害range：弓DEX+PAD、賊LUK+(STR+DEX)/4+PAD，其餘STR+PAD。
- 4C7960預抽7次第一stream，ACC命中、武器／動作係數、mastery與等差、物理屬性、PD0.5..0.6；
  成功結果trunc/clamp1..9999、失手0。48D080怪物欄是PA/PD/acc/eva，不能套後期欄名。
- 原特殊射擊分支 `roll > 3*level` 時乘 `5*level%` 雖反直覺，PE4C88B5..4C88CE也一致，
  本輪不擅自換成後期暴擊公式。4BE270是level/mastery，並非x；其修改ACC發生在本函數命中基準算完之後。
- 0x16 seeds已接第一ClientRandom到普通物理；動作selector仍未共用該序列，不宣稱全域逐步相同。
- 41AF20載NoRed0/1；41E610首字bank1、餘字bank0、依canvas origin及width的3/5 overlap、
  50px組圖；41F200用NoRed0/Miss raw center。400ms opaque＋600ms fade、1000ms上升30px。
  字圖來自原WZ，不是CSS白字；mob anchor取485C20當前canvas originY。
- 2002004 pad5/time180000、2002005 acc5/time300000已接消費者；EVA/MAD/PDD等道具仍拒用。
- 裝備effective maxHP/MP接補藥／自然恢復／升級補滿；移除裝備後clamp current vitals是server重建政策，
  非取得原server規則。bridge stat-basis只是WZ計算view message，不是新nativeopcode。
- 完整來源、範圍、操作及未執行回歸來源：`NATIVE_STATS_COMBAT.md`／ADR-051。
  沒有執行test/check/typecheck/browser/VM/probe，不以啟服或歷史PASS宣稱驗證。


## 補充：碰撞／受傷／復活接線與原來源修訂（2026-10-18；實作未測試）

- 40B530每frame讀lt/rb，缺值SetRectEmpty；486260更新當前／鏡像框，485AA0碰撞時Union前後位置。
  5085E0玩家框(-22,-65,22,0)；491FF0另做左右25／上30下10與centre±1的內縮，不能漏這一層。
- 4C8ED0是stream2，MISS只抽EVA，hit才再抽PA；等差用C整除。詳式見NATIVE_CONTACT_REVIVE.md。
  48D080讀PA/PD，這份WZ某些mob只有PADamage/PDDamage，所以原default0導向min1；不是缺素材，不能暗中alias。
- 5114A0先0x1C負HP、signed1500ms、pending外力22/23，再由537B00釋放地面／繩梯並有界併入速度；
  水平sign來自相對位移，不是中心左右。MISS負1500ms但不新套受傷tint／hit表情／外力。
- 509860／485C20的canvas vtable+132是originY，不是PNG height。41AF20 offset25/26為NoViolet0/1；
  508450受傷與MISS的palette2用它。palette1是NoBlue，不能由正數分支誤稱打怪紅字。
- **修訂§6第18項**：509AF0不是無條件進場hook。local user、a2非零、CField+680仍0時，
  PE509B1A..509B3C明確寫遊戲時間到+0x2a8；5084C0在動作18/19變更時呼此路徑，558CF0差>2200建CUIRevive。
  瀏覽器本輪從原stat回覆HP0接dead／delay／原Notice視窗／kind0復活；完整墓碑落地與原HP→CVecCtrl全鏈仍非全數移植。
- 4E94E0窗268,104／264×132；4E9750用UI/Basic.img/Notice/backgrnd與BtOK，按鈕相對100,92；
  4E99C0兩行14px、12px黑字／白色+1影。4E9E30 Enter確認／Escape吃掉，4E9E70原0x0D kind0空name。
- 同輪修canvas delay與avatarFrame少接emotion參數；現在EVA/PDD有消費者才接受temp spec，2002000可喝。
- JSON contactField／touch-result／rate gate／snapshot容差皆browser bridge政策，不加native opcode、不宣稱原server規則。
- 沒有執行任何test/check/typecheck/browser/VM/probe；新回歸來源未執行，LIVE非PASS。見ADR-052及NATIVE_CONTACT_REVIVE.md。


### 2026-10-18 更正：movement state 不是 body action index×2（508FC0）

本輪靜態讀 `sub_508FC0`（原C L269834–269874），再比對508700的呼叫：
先 `switch(y>>1)`，再選Character body action；facing是y&1。

| movement base（不含facing） | 508FC0 case | body action |
| --- | --- | --- |
| 2 | 1 | walk1／walk2，依武器walk型 |
| 4 | 2 | stand1／stand2，依武器stand型 |
| 6 | 3 | 35 jump |
| 8 | 4 | 4 alert |
| 10 | 5 | 33 prone |
| 12 | 6 | 34 proneStab |
| 14 | 7 | 36 ladder |
| 16 | 8 | 37 rope |
| 18 | 9 | 38 dead |
| 其他（含0） | default | 0 walk1 |

先前browser把body jump35／ladder36／rope37直接乘2送70／72／74，是錯的。
`client/motion.mjs`的actionOf／remoteStance／actorDepth已改；mob仍用自己的16項表，mob hit1同值14不是角色ladder。
目前不藉此新增prone施放或完整alert計時；本輪不執行test/check/typecheck/browser/VM/probe。
原來源、跳躍怪／背景等接線及界線見 `NATIVE_JUMP_ATTACK_BACKGROUNDS.md`／ADR-056。


## 2026-10-18 補記：圖層不等於封包位置y，overlay也不是world z加法

靜態來源定位，**本輪未執行test/check/typecheck/browser/VM/probe**。完整整理見 `../NATIVE_LAYER_PRIORITY.md`／ADR-057。

- Gr2D vtable100275A8：+188→10013770、+260→10014510；10013D40比較parent chain／z／序號，非world y。
- 537260 init首參數→controller+24；511820 local傳1，520680 remote傳0；509A80在前者root多2。
- 4011C0 zmap numeric reset；4C1610 islot最大rank、smap∩vslot；402130整part衝突不是單純z排序。
- 402490 faceZ分兩面→508700 user+376/372；507A20 body0／afterimage1／front2為overlay child。
- 509AF0 tomb(-1)也overlay主層，不能當worldRootZ-1。47D110 name child5、腳下(-width/2,+2)。
- 513C80讀515C70(main layer z)→41B630 record[7]→41BF60 bullet create；damage41E610／41F200為-1073471524。
- 46BDA0 back依1000*index-1073869824，未讀現代front旗標。原tile／obj公式未變，obj pointer arithmetic不是4*z。
  **ADR-107結案實作bug**：index的來源是`sub_46BD54`的`for(i=0..count-1)`用`itow(i)`**按名字**抓子節點、
  把位置`i`傳進46BDA0——所以entry的key就是index（實資料key恆等位置；非數字key原loader根本抓不到，跳過）。
  舊實作`asNumber(entry.name)`只收number、property key是string→恆fallback 0→**所有back同z、index從未參與**
  （順序只剩sort穩定性兜著）；已改`Number(entry.name)`＋整數/非負閘，`1000*index−147990`
  （−147990＝−1073869824相對tile base −1073721834）。
- HTTP僅新增MapBack.z與avatar planes=1/header；本輪沒有更改原版封包版型，也未宣稱NPC行走／全controller已完成。

### 後續原版本機UI接線：Menu／SysOpt／StatusBar（2026-10-18，未測試，ADR-058）

- 559E20 + PE vtable588098／588028確認52C8E0為GameMenu create、52D800為SysOpt create；55A090／55A440是刪除器。
  原WZ176×240與347×225，461C50以(800-w)>>1／(600-h)>>1置中；六列1000+i取index，4開SysOpt、5走55D9F0離線回登入。
- 43D360預設音量15、mute0；52D800與listing52DD59..52DD72設count20；43DEB0輸出`trunc(100*(step+1)/20)`，
  非把15當100%、不是第0段就mute。52DE80 preview、52DF20保存或還原snapshot；均屬本機設定，不新增stat封包。
- 463DF0重綁清同itemId、覆蓋目的；463F10只清配置。CDraggable只在status→field呼清除，status→其他窗不丟物。
  快捷格拖曳從4F90F0先找實際USE堆；新增client純配置move／clear與tooltip，不新增0x17／drop請求。
- 4F8940→535AC0(type3)／535CE0(4,12)，PE5BD308原提示；524A00(name,null,null)是CP9494..12 bytes與KS範圍、I/l限制，
  null不套建角禁語。4FB160本機recipient格FF315573、font0白字；4F8CB0選定後非slash按recipient送既有0x23 kind6，
  並非選名字就送封包。receiver既有0x1A仍無悄悄話分類，不依文字推測。

以上是browser還原接線，不是新wire格式／原server規則。新增來源回歸未執行；詳細差異／操作見NATIVE_SYSTEM_UI.md。


### 4.46 後續：主動技能0x1E與user effect type1（2026-10-18，未測試）

原55D320送30 decimal：u32 skillId、u8 level、u8 count、u32 characterId[count]。
519270自身buff使用count0；519950以party六格／±50半開RECT找同圖其他隊友。
522300的0x29 type1不只u32，還有**u8 level**；4BAC80→50C460證明是技能特效。
新codec/schema在skilluse.ts／field.ts；SP的0x1D保持獨立。
55D5F0的0x1F由販售數量dialog呼叫，不是技能取消，未硬接。
七招範圍、原VariantChangeType／Focus BSTR、傷害順序、常數與政策詳[ACTIVE_SKILLS](../ACTIVE_SKILLS.md)。
未執行測試／typecheck／語法／browser／VM／probe，沒有PASS或全技能宣稱。


### 4.47 續作：513C80多彈藥／Lucky Seven與0x400（2026-10-18，未測試）

511630對level bulletCount找同一疊足量ammo；513C80的damage hits為min15(bulletCount*attackCount)，
缺／<=1個別作1，0x10的high nibble仍至多一個mob。0x24保留原技能level／id及消耗前projectileId。
513C80彈體終點7*(2*i-n+1)、星鏢207族launch才加120*i；共同damage release+travel不可套同一延後。
4C7960 case47對4001344走LUK1.3..0.5*5*PAD，仍PD後damage%、七字cursor，不是普通claw公式。
4C5DC0的0x400寫temp58/59，CWvsApp28+58=86，512F90／513C80皆把86^87交4BE8B0第三參數；
55AA80換有效weapon時清86/87、4CC050圖示mask&=~0x400，故unknown400確證booster。0x200／0x800不猜。
55BEB0 ack重stamp200ms門檻，更正前輪send-only說法。全鏈與未知server規則見[NATIVE_RANGED_SKILLS](../NATIVE_RANGED_SKILLS.md)。
新增來源未執行，不宣稱測試PASS或全技能1:1。


### 4.48 4636B0穿戴順序／0x17邊界與主動時鐘關聯（2026-10-18，未測試）

4636B0（.c約107382）：4C5020先取完整有效集合→465B50/465C60衝突與空位檢查→刪部位→4C5420。
不能排除舊武器後重跑4C5020，否則會提前刪依賴裝備、錯誤拒絕原允許的穿戴入口。
GameEntry共用純規則亦驗反向swap；clone／預encode再commit，0x17尾隨垃圾／錯需求回空0x0B。
工具所需level讀真WZ，明確raiseLevel才以原EXP／HPMP成長補足；不是新native opcode或原版任務獎勵。
主動attackToken只加browser/bridge JSON，不改0x0F/10或0x23/24；回原動作clock，不造admission ACK。
遠端固定receipt source/z/target identity。原證／重建政策詳[NATIVE_EQUIP_ADMISSION](../NATIVE_EQUIP_ADMISSION.md)。

### 4.49 0x11→0x25魔法獨立鏈、120ms段序更正與道具欄位漏接（2026-10-18，未測試）

- 514D30／428040／PE5B2374：正常row僅group1/6的28/29；skillType3奇列全空。43FC80 alias是swingO1/O3，非magic1/2。
- 514DDA..514DE8直接傳avatar+152 attackSpeed；不套4BE8B0的物理Booster減速。508700仍逐格clamp縮放。
- 50D6D0取avatar+52 CVecCtrl；514D30檢查ctrl+112 foothold，537260與落地路徑寫此值及page/group。
- 491F20在±50..±300每20px切片，half-height=距人物/4；485B80取與薄ray延展後RECT交集中心。不是單一細ray。
- 514BA0的真ball存在才走564600 directed foothold ray與distance×1.5；Magic Claw無ball無travel且不查牆，不能落入ammo fallback。
- 4C89D0獨立INT/LUK命中、MAD與技能mastery/mad、MD與元素。4C8B6D每次只inc1，miss1slot／hit3slot，預取7字沿cursor循環。
- 4BE150 P/I/F/L/W/H/D/U八槽、無數字或0=>999、未知字元失敗；4C89D0以mob P起，skill標999的I..D取max，U不讀，1×.5／2×1.5。
- **更正舊判讀**：4882F0 DAMAGEINFO[0]=impact+120*ordinal；listing4863C8..4863CD減世界時間再條件跳過、486404呼487A30。
  這是到期時間，不是character識別。487A30以30px*ordinal提高數字，damage>0才畫skill hit art。
- 道具reader已允許eva/pdd但handleUseItem只列speed/pad/acc，是實際漏接。共用清單接通，並新增MAD消費者與原藥水；未知MDD仍拒。

原公式、常數表、封包／bridge／remote／消費／生命週期與重建政策詳
[NATIVE_MAGIC_SKILLS](../NATIVE_MAGIC_SKILLS.md)／ADR-073。所有本輪回歸來源均未執行，不援用歷史PASS。


### 4.50 ✅ 卷軸強化：c2s `0x1A`（`sub_55B0E0`）——完整鏈（ADR-099）

**這不是 s2c `0x1A`**（§4.31 的 userMessage／密語家族）：c2s 與 s2c 是兩張 opcode 表，互不相撞。
本節是**client → server** 的 `0x1A`：把一張 `0204` 升級卷軸拖到一件裝備上。

#### 4.50.1 封包：`[0x1A][s16 scrollSlot][s16 equipSlot]`（byte-exact）

`sub_55B0E0(this, __int16 a2, __int16 a3)`（`.c:351717`，`.text:0055B130`）：
- `sub_4A1EA0(&buf, 26, nullptr)`——**26 = 0x1A**，先立封包头；
- 接著 `*(_WORD*)(p) = a2; p += 2;`、`*(_WORD*)(p) = a3; p += 2;`——兩個 s16；
- `sub_43AD50(this_13, &buf)` 送出，`*(this+6) = 1`（設 busy）、`*(this+7) = timeGetTime()`（記時刻）。

所以 `a2 = scrollSlot`（USE tab 的正格）、`a3 = equipSlot`（見 4.50.2：穿在身上時是**負格**）。
Codec：`protocol/field.ts` 的 `ClientScrollUpgrade{scrollSlot,equipSlot}`／`readClientScrollUpgrade`／
`encodeClientScrollUpgrade`（PacketWriter(5)：u8 opcode + s16×2）／`describeClientScrollUpgrade`；
`CLIENT_FIELD_OPCODE.scrollUpgrade = 0x1a` 接在 `useMapItem 0x19` 之後。

#### 4.50.2 client 的三道閘＋相容規則（`sub_55B0E0` 與其 drag caller `.c:107957`）

`sub_55B0E0` 自己在送出前有三道閘（與 §4.36 `sub_55ACB0` 同型）：
- `if (*(this+6)) return;`——**busy**：上一封還沒被回答就不送第二封；
- `(*(this+9))` 的 `+53 ^ +55` 兩個 word `> 0`——狀態檢查（語意未解：不是 HP 直讀，XOR 是「兩 word
  不相等」；伺服器以 hp≤0 拒絕對齊 `0x17`／`0x18` 的死亡閘，ADR-100 補）；
- `timeGetTime() - *(this+7) >= 0x1F4`——**500ms 冷卻**（0x1F4 = 500）。

caller（拖放到裝備的那支分支，`.c:107957`）先決定「這是不是一張合法卷軸」：

```c
v10 = *(v7 + 12);   // 被拖道具（卷軸）的 itemId
v11 = *(v9 + 12);   // 目標（裝備）的 itemId
if ( v10 / 10000 == 204            // 卷軸 family == 204
  && v11 / 1000000 == 1            // 目標 family == 1（裝備）
  && v11 / 10000 % 100 == (v10 % 10000) / 100 )   // category 相等
  sub_55B0E0(n3000_1, *(this + 4), v8);
```

（`1374389535LL * x >> 32 >> 5` 是編譯器的 `/100`。）`v8 = -sub_4D9110(x, y)`：目標格由畫面座標取得，
**穿在紙娃娃上的取負**（`-part`）；`a2 = *(this+4)` 是卷軸自己的來源格。
⇒ `scrollMatchesEquip(scrollId, equipId)`（`game/scrolls.ts`）就是這條規則的直譯，並逐一对過
WZ 全 75 張卷軸的韩文名與 category：

| category | 裝備 | 卷軸 id 段 |
|---|---|---|
| 0 | 투구（頭盔）`100xxxx` | `0204000x` |
| 3 | 귀장식（耳飾）`103xxxx` | `0204003x` |
| 4 | 상의（上衣）`104xxxx` | `0204004x` |
| 5 | 전신갑옷（全身甲）`105xxxx` | `0204005x` |
| 6 | 하의（下衣）`106xxxx` | `0204006x` |
| 7 | 신발（鞋）`107xxxx` | `0204007x` |
| 8 | 장갑（手套）`108xxxx` | `0204008x` |
| 9 | 방패（盾）`109xxxx` | `0204009x` |
| 10 | 망토（披風）`110xxxx` | `0204100x` |
| 30–33 | 한손검/도/둔기/단검（單手劍/刀/鈍器/短劍）`130–133xxxx` | `0204300x`…`0204330x` |
| 37 | 완드（魔杖）`137xxxx` | `0204370x` |
| 38 | 스태프（法杖）`138xxxx` | `0204380x` |
| 40–47 | 두손검/도끼/둔기/창/폴암/활/석궁/아대（雙手劍/斧/鈍器/槍/長柄/弓/弩/拳套）`140–147xxxx` | `0204400x`…`0204470x` |

#### 4.50.3 WZ 效果表：`Item/Consume/0204.img/<id>/info`

`success`（全族只有 10／60／100 三種）＋**正的** `inc*` 增量；**沒有 `spec`**（§4.34.3 已列 0204
「沒有 spec、price 全是 1」），**沒有 `recover`／`destroy`** ⇒ 失敗絕不銷毀裝備。
`inc*` → equip stat 的對照（`SCROLL_INC_TO_STAT`）：incSTR→str、incDEX→dex、incINT→int、incLUK→luk、
incMHP→maxHp、incMMP→maxMp、incPAD→pad、incMAD→mad、incPDD→pdd、incMDD→mdd、incACC→acc、
incEVA→eva、incCraft→craft、incSpeed→speed、incJump→jump。
實例（dump 對過）：`02040000`=100%/incPDD1；`02040001`=60%/incPDD2+incMDD1；
`02040002`=10%/incPDD5+incMDD3+incACC1；`02043000`=100%/incPAD1。
Reader：`scrollSpecOf(archive,itemId)`／`scrollSpecProvider(archive)`（`game/scrolls.ts`），讀不到回
`undefined`（非 204、`--data off`、無該 node、success 非 0..100 整數），絕不 throw。

#### 4.50.4 伺服器端（ADR-099）

`loginserver.ts` 的 `handleScrollUpgrade` ＋ `0x1A` dispatch（接在 changeSlot dispatch 之後）；
`cli.ts` 接 `scrollSpecProvider(archive)`。
- **成功 roll＝政策**（原版 server binary 不存在，不可證）：`scrollRandom.range(0,100) < success`；
  `scrollRandom` 是可注入的 `RandomSource`（預設 `ClientRandom`，seed 0x5c07/0x1a0f/0x2e3c），測試注入定值。
- **slot 會計＝政策**：一次使用必耗一格 `ruc-=1`／`cuc+=1`（`ruc+cuc` 不變）；增量**只在成功時加**。
- 全部 client 閘由伺服器重驗：`scrollSlot>0`、USE 格有卷軸、equip 格有裝備、`scrollMatchesEquip`、
  `ruc>0`、`scrollSpec` 讀得到、非 busy（shop／talk／trade）、**非死亡（hp≤0，ADR-100 補齊與
  `0x17`／`0x18` 同一安全政策）**；任一不過 ⇒ **空 `0x0B`**
  （`encodeInventoryChange([])`，與 §4.36 的拒絕同型——client 的 busy 閘非收到 `0x0B` 不會解）。
- 成功 ⇒ 一個 `0x0B`：`[takeItem 卷軸的 change][put 升級後的裝備回原格（負 worn 格在 tab1 合法）]`；
  **不广播 `0x28` look**（升級不改外觀 id，只是同一格換內容）。之後 `persist()` ＋ log。
- 裝備是**原地**升級（同一格）：worn（負）讀寫 `items.worn`、bag（正）讀寫 `inventories[equip-1]`。

#### 4.50.5 瀏覽器側

`client/main.js` 的 `scrollRequest(scrollSlot, equipSlot)` mirror `slotRequest` 的 500ms 閘（設
`slotPending`、送 `{t:"scroll",...}`）；`equipPanel.hit` 的 drop 分支在 wearItem **之前**加了 scroll case：
把 USE 的 204 卷軸拖到紙娃娃上**已穿**的裝備（`eq.kind==="slot"` 且 `eq.slot<0`）就走這條。
`webclient.ts` 的 `case "scroll"` → `ClientSession.scrollUpgrade` → `encodeClientScrollUpgrade`；
`slotPending` 由既有 `"inventory"` case 在 message.ack 時清除。
- **誠實限制**：瀏覽器背包 UI 一次只顯示一個 tab，**無法把卷軸拖到 equip 背包內的裝備**（正格）；
  這條在原生 EXE 不受影響（caller 直接給正/負格）。伺服器對正、負 equipSlot 都接受。

#### 4.50.6 驗證

`game/scrolls.test.ts`（4 項：scrollMatchesEquip 的 family＋category、applyScroll 的 slot 會計／只在成功加增量／
不改 input、SCROLL_INC_TO_STAT 全對應真 stat、scrollSpecOf 讀真 WZ 的 success＋inc 與各種 undefined）；
`serve.test.ts` 整合（真 archive＋注入定值成功 roll：對 worn hat 卷 ⇒ `0x0B` = [clear 卷軸][put hat
pdd12/mdd6/ruc2/cuc1]、record 原地升級；錯 category（單手劍卷軸投頭盔）⇒ 空 `0x0B` 且 hat 不動、卷軸留袋）。
typecheck／build／format 全綠。


## 0x13／0x11呈現續作（2026-10-19，ADR-088）

- 55CDE0不是只支援type0：所有type讀同一個CP949 string，0→font5公告、1→52BBE0→52C320→461C50置中264×132 Notice/OK modal；2..255忽略。codec、ClientSession與真bridge JSON保留type，本輪已接browser。
- 55C130的金幣／道具／拒絕與55BEB0同級EXP改走原4EB440六列池，不是聊天訊息；沒有多發獎勵、沒有notice到ledger的假ack。
- Shape2D 10019160+98→10011030→10010AD0→10010C40確認6000ms整數RelMove，半程128/255；4A95B0本機taken才播PickUpItem。
- 全部原證、byte/truncation／加密合包／真JSON／原WZ Chromium與生命週期回歸及剩餘差異，集中見[原訊息呈現](../NATIVE_FEEDBACK.md)。不是完整交易／miniroom／所有52BBE0 caller都已實作。


## 補充：攻擊時序／傷害數字的六個常數（2026-10-21，ADR-118；原碼行號本輪實讀）

- **`sub_4882F0` 的呼叫點只有六處**（`.c` 2698 宣告、143029 本體、279032／279880／280625／293783／294119／294474）：
  - `279032` 在 `sub_512F90`（普攻送端，`.c:278610`，結尾 `sub_4A1EA0(&v111, 15, …)`＝`0x0F`）；
  - `279880` 在技能射擊送端（結尾 `sub_4A1EA0(&v124, 16, …)`＝`0x10`）；
  - `280625` 在技能近戰送端（結尾 `sub_4A1EA0(&v91, 17, …)`＝`0x11`）；
  - `293783`／`294119`／`294474` 在 `sub_520F20` 一帶的收端。
  **所以「哪一個 opcode 排傷害數字」與「哪一個 opcode 送刀」是一對一的**，不用靠命名猜。
- **速度 byte 的夾取是兩端同一段**：`sub_4BE8B0`（`.c:198498-198503`）與 `sub_508700`（`.c:269574-269582`）都是
  `n <= 0 → 0`、`n >= 6 → 6`，然後 `v9 = (n + 5) * delay[i]; … = v9 / 8`（整數除法）。7 不比 6 快、−1 不比 0 慢。
- **多目標的 70／280**：`sub_520F20` 的目標迴圈是 `for ( n3000 = 0; ; n3000 += 70 )`（`.c:293748`），
  每圈把 `sub_515CA0(n3000, 280)`（`.c:293779`）加進 `sub_4882F0` 的時間；送端 `sub_512F90`（`.c:279000`/`279055`）同一寫法。
  `sub_515CA0` 本體（`.c:281167`）就是 `a >= b ? b : a`——**上限，不是縮放**。整個 C 只有這兩處呼叫它，
  兩處都在**普攻**路徑；Slash Blast 一類是走普通近戰送出的（ADR-070），所以技能分支套同一個延遲是對的。
  與之獨立的另一個數字是 `sub_4882F0` 自己的 `DAMAGEINFO[0] = impact + 120 * ordinal`（**同一目標的多段**間隔）。
- **射擊／魔法的出手高度都是 `y - 25`**：`sub_513C80` `.c:279602` = `p_right_1 = this_1[101] - 25`；
  `sub_514D30`（魔法）同一個 25。它不是魔法專屬——`MAGIC_NEAR=50`／`MAGIC_RANGE=300` 才是（普攻是 ±200／±n119）。
- **`sub_512F90` 的近界裁剪**（`.c:278743` 起手 `*a4 = 65;`，`.c:278795-278801`）：
  `if (left < -65) left = -65; if (left >= right - 1) left = right - 1; *a4 = -left;`。
  **順序有意義**：先夾 −65 再夾進遠界內側，遠界落在裁剪點後方時結果是 `right - 1`（可能比 65 更遠）。
- **傷害上下限**：`sub_4C8ED0` 的收尾（`.c:208415-208423`）是 `v <= 1.0 → 1`、`v >= 9999.0 → 9999`。
  同一支函式裡對 PAD／EVA／PD 那些**數值項**是另一個上限 `999`（`.c:207799-207801` 一帶的 `n999`），**不要混用**。
- **傷害數字的 y**：`sub_487A30` `.c:142639` = `v16 = *(this + 91) - 30 * a6 - sub_485C20(this)`，
  `a6` 是這一刀裡的第幾段（`sub_520F20` 的 `i_2`，`.c:293777`）；`sub_41F200`（Miss）／`sub_41E610`（數字）用同一個點。
- **0 不是傷害值**：`sub_4C8ED0` 出不來 0（它的下限是 1），0 是「碰到但沒扣血」的表示，
  而 `sub_487A30` 走 `sub_41F200` 那條（Miss 點陣圖）——所以 `damageGlyphLayout` 對任何 `!(value > 0)` 都印 MISS。

### UI/Basic.img 的兩個 cell 尺寸（2026-10-21，ADR-119）

- `VScr`：**十個 cell 全部 12×12**（`enabled/{prev0,prev1,next0,next1,base,thumb0,thumb1}`、`disabled/{prev,next,base}`）。EXE 裡沒有 `VScr` 的 ASCII——`CCtrlScrollBar` 經 `sub_4591A0` 取 cell 名——所以 WZ 是唯一 oracle。`bun tools/wz.ts dump "UI/Basic.img"` 與 `server/test/ui-basic-cells.test.ts`（開 `Data.wz` 逐格讀回）皆可證。
- 由它推出：`3 * VSCR_CELL + vScrollTravel(h) === h`，即 `prev` 帽＋拇指行程＋拇指＋`next` 帽＝整條軌道。原碼 `sub_452500`/`sub_4526A0` 的 `len - 3*arrow`／`len - arrow` 就是這個（交易 log：`+68 arrowLen=12`、`+72 trackLen=216` → zones 12／204、`thumbTop = 12 + floor(pos*180/(max-1))`、`dy/180`）。
- 已命名為 `VSCR_CELL`（`client/vscroll.ts`），替掉 `vscroll`／`inventory-window`／`shop-window`／`npcdialogue`／`trade-state`／`messenger-state`／`skills`／`main.js` 共 24 處裸 12／36。
- **未採用的說法**：既有筆記稱 `sub_451240` 以 COM art cell 高度回填 `+68`。實讀 `MapleStory.exe.c:89105`：`*(this + 17) = pvargDest` 存的是 COM 呼叫回傳的**物件指標**（vtable+80／+88），不是數字。故不重複該說法。
- `Tab`：**九個 cell，`left{0,1}` 4×24、`middle{0,1,2}` 14×24、`right{0,1}` 12×24、`fill{0,1}` 1×24**（`sub_4582A0` 經 `sub_4591A0` 取這四種 piece 名）。已命名 `TAB_HEIGHT/TAB_LEFT/TAB_MIDDLE/TAB_RIGHT/TAB_FILL`（`client/shop-window.ts`）；`SHOP.tabs.height` 與 `INVENTORY.tabs[*].height` 都是 24。
- NPC 對話捲軸的拖拉用 **18**（＝帽 + 半個拇指，抓中心），背包／商店用 **12**（拇指上緣）。兩者不一致但**皆保留原行為**，已註明。
- 三個捲軸幾何模型**刻意不合併**：`CCtrlScrollBar` 用 `floor(pos*travel/(max-1))`，背包／商店用 `round(travel*pos/max)`——兩條不同的原碼公式。

### 商店列的繪製：sub_4B5B10 / sub_4B5FA0 的座標（2026-10-21，ADR-120）

- `sub_4B5B10`（買方列，`MapleStory.exe.c:190169`）：文字 x = **42**（＝`SHOP.buyList.nameX`）；兩行是 `n71_2` 與 `n71_1 + 16`；列間距 `n71 += 35`。
- `sub_4B5FA0`（賣方列，`MapleStory.exe.c:190388`）：
  - `n245 = 245`（＝`SHOP.sellList.nameX`）為兩行文字的 x；兩行是 `n110_1 - 16` 與 `n110`。
  - **`n110` 起手 = 110**。賣方第一列 y = 91，故 `SHOP_ROW_NAME_TOP = 3` → 94（`n110 - 16`）、`SHOP_ROW_PRICE_TOP = 19` → 110（`n110`）。兩行相距 **16**。
  - 選取面：`n245 = n110_1 - 20` → 90（＝`SHOP.face.sell.y = 90`，列在 91）。
  - 堆疊數：`n110_2 = 209`（＝`SHOP.sellList.x`）、y = `n110 + 1` = **111** → `SHOP_STACK_TOP = 20`；由 `sub_525AE0` 逐位數畫出。
  - 列間距 `n110 += 35`；`while ( n110 < 285 )` → `110 + 5×35 = 285`，**五列**（`SHOP.sellList.rows = 5`）。
- `UI/Basic.img/ItemNo`：十個 glyph 皆 11px 高；`0,2..9` 為 **8px** 寬，`1` 為 **5px**（窄字）。故 `ITEM_NO_ADVANCE = 8`（固定推進）不重疊、不留縫。
- **未決**：`sub_525AE0` 在本 `MapleStory.exe.c` **只有 `idb` 宣告（第 5343 行）、無函式本體**，因此原版究竟是「固定 8」還是「各 glyph 寬＋間距」推進，此版證據無法判定。現況：商店列用固定 8，status bar 的 `drawItemCount` 用逐 glyph 寬。
- **【ADR-123 更正】上面的「未決」是錯的**：`sub_525AE0` **有本體，在 `MapleStory.exe.c:298618`**（第 5343 行只是前向宣告）。推進是 `n146 += a6 + v34` = **各 glyph 自己的寬度＋第六個引數**。`ITEM_NO_ADVANCE = 8` 已作廢。
- **無原碼依據**：`SHOP_ROW_TEXT_CLIP = 14`（一行文字的裁切高度）是我們自己的裁切框。
- 買／賣／補充三個入口的守門（`shopPending || slotPending || mesoPending || modalOpen() || selfView?.hp <= 0`）已收回 `shopActionBlocked()`；注意 `hp === undefined` 時原式 `undefined <= 0` 為 **false**（玩家未知時不擋），已由測試釘住。

### 背包窗的繪製與幾個沒有原證的常數（2026-10-21，ADR-121）

- `UI/UIWindow.img/Item/backgrnd` = **162×315**，與 `INVENTORY.width/height`（`client/inventory-window.ts`）一致——美術檔回頭證明版面。**勿與 `sub_4D89F0` 的 Equip 窗 176×315 混淆**（另一個視窗）。
- `UI/UIWindow.img/Item/activeIcon` = **36×36**，比 32px 格每邊大 2px → `INVENTORY_ACTIVE_ICON_INSET = 2`（有原證）。
- 堆疊數錨點（格子右下角內縮 **1**、下方 **+2**，落在 35px pitch 的 3px 縫）**無原證**：背包數量畫家 `sub_4DB240`（`MapleStory.exe.c:225635`，`:225848` 呼叫 `sub_525AE0`）反編譯後埋在 `VARIANTARG` union，讀不出數字。同 `sub_525AE0` 在商店列（`sub_4B5FA0`）是可讀的，見 ADR-120。
- **【ADR-123 更正】原版堆疊數是靠左的 (0, +20)**：`sub_4DB990`（`:226041`）建的 rect 是 `35c+6, 35r+80, 35c+38, 35r+112`，`:225848` 餵給 `sub_525AE0` 的是 `rect.left` 與 `rect.bottom - 12`。舊的「右下角內縮 1、下方 +2」已作廢。
- `INVENTORY_TAB_LABEL`（left 6 / top 5 / width 22 / height 13 / baseline 12）＝蓋住 sheet 自帶韓文標籤的底板，**無原證**。
- 關閉鈕座標 (114, 9) 已改用 `INVENTORY.close`（原本在 main.js 寫死一份）。
- 繪製順序（與原頁一致）：sheet → 關閉鈕 → 頁籤面 → 項目格（圖示置中、堆疊數）→ hover 框 → 捲軸 → 金幣鈕 → 楓幣。

### 窗板尺寸、置中與 registry 預設值（2026-10-21，ADR-122）

- **`UI/UIWindow.img` 九塊窗板實測**（`archive.objects("UI/UIWindow.img")` 逐塊讀出，全部像素級）：
  `Item/backgrnd` **162×315**、`Equip/backgrnd` **176×315**、`Stat/backgrnd` **176×315**、`Skill/backgrnd` **176×315**、`Shop/backgrnd` **407×291**、`Trade/backgrnd` **367×295**、`Messenger/backgrnd` **200×335**、`Messenger/charView` **97×322**、`Stat/backgrnd2` **176×192**。
  陷阱：裝備窗 176×315 ≠ 背包窗 162×315。
- **`sub_461C50`（`MapleStory.exe.c:105778`）＝視窗置中**，收尾一行在 `:105835`：
  `sub_545450(this, (unsigned int)(800 - v17) >> 1, (unsigned int)(600 - v16) >> 1, v15, (int)pv, 10, a3);`
  → `x = (800 - width) >> 1`、`y = (600 - height) >> 1`，對 800×600 client。shop（407×291→196,154）與 trade（367×295→216,152）皆吻合。
- **`sub_43D750`（`MapleStory.exe.c:69546`）＝ registry 的 `uiWndX%d`／`uiWndY%d`／`uiOpt%d` 預設值**，`i = 0..5`：
  - `i != 4 && i != 5`：`n8 = 8 * (3 * i + 3)`（`:69584`），x 與 y 同值 → **24 / 48 / 72 / 96**（背包／裝備／能力／技能）。
  - `i == 4`：`8, 8`（本版無對應視窗）。
  - `i == 5`：`n8 = 500; n8_1 = 50;`（`:69589`）→ **messenger 的 (500,50)**。
  - 讀入後的夾限：**`x > 784 → 784`、`y > 584 → 584`**（`:69600`／`:69602`）。`client/equipment.ts` 的拖曳夾限與此一致；`statwindow.ts`／`skills.ts` 的 `624`／`285`（＝800−176／600−315）是我們自己的「整扇窗留在畫面內」政策。
- **`Stat/backgrnd2`（176×192）**：`statwindow.ts` 把它掛在父窗 +(176,123)，`123 + 192 = 315`，正好收在父窗下緣——故 `contains()` 的 detail 分支可以對兩邊都用 `STAT_WINDOW.height`。
- **無原碼依據**：`MESSENGER_WINDOW.width = 297` 是 `backgrnd`(200) + `charView`(97) 拼出來的，不是單一 canvas；`charView.y = 13` 是 `335 − 322` 的差，屬我們自己推出的置中。

### `sub_525AE0` 的本體與數字錨點（2026-10-21，ADR-123）

- **`sub_525AE0` 有本體，在 `MapleStory.exe.c:298618`**（第 5343 行只是前向宣告；ADR-120／121 記載的「無本體」是錯的，已於兩處加註更正）。
  - `sub_411E50(&v36, "%d", ArgList)` 把數量格式化成字串；逐一字元 `itoa_w(*(char *)(v6 + v36) - 48, Buffer)` 取回 0..9；`sub_402E20(&lVal)` + `sub_406EC0(v12, &pvarg, v27)` 到 property 裡查該數字 → `UI/Basic.img/ItemNo/{d}`。
  - glyph 的 **top-left** 畫在推進中的 `n146` 與共用的 `a3` → **左上錨定**。
  - `n146 += a6 + v34`：`v34` = 該 glyph 自己的寬度，`a6` = 第六個引數（間距）。
  - 第六引數會變：`sub_504480`（`:265177`）在 `:265265` 傳字面常數 `1`。背包／交易／商店三處指派為 0，但中間夾著 `sub_473990`（**本 checkout 無本體**，只有 `:2288` 的 `idb` 宣告），故為最佳讀數非鐵證。
- **呼叫點與錨點**（32px 格子，一律 `(rect.left, rect.bottom - 12)` = 格子左緣、頂邊 **+20**）：
  - 背包 `sub_4DB240` `:225635` → 呼叫 `:225848`；rect 由 `sub_4DB990` `:226041` 建成 `SetRect(lprc, 35c+6, 35r+80, 35c+38, 35r+112)`。
  - 交易 `sub_4D5440` `:219827` → 呼叫 `:219951`；`n146 = 35*(v2%2) + 291`（`:219870`）、`v26 = 35*(v2/2) + 160`（`:219871`）、另一側 `n146 -= 281`（`:219956`）→ 格子 rect `(35c+291 或 35c+10, 35r+128)`。
  - 商店 `sub_4B5FA0` `:190388` → 呼叫 `:190691`；`n110_2 = 209`、y = `n110 + 1` = 111。
  - `sub_4FC440` `:257680` → 呼叫 `:257831`；`LODWORD(v36) = v41 + 20`。
- **`UI/Basic.img/ItemNo`**：十枚 glyph 皆 **11px 高**；`0,2..9` 為 **8px** 寬，`1` 為 **5px**。故「1」會把後面的數字往前拉 3px，固定 8px 推進（`ITEM_NO_ADVANCE`，已刪）不是原版行為。
- **`sub_43D750`（`:69546`）**：registry `uiWndX%d`／`uiWndY%d`／`uiOpt%d`，`i=0..5`；`i!=4&&i!=5` 時預設 `8*(3*i+3)`（`:69584`）→ 24/48/72/96；`i==4` 為 8,8；`i==5` 為 500,50（`:69589`）。讀入後夾限 `x>784→784`、`y>584→584`（`:69600`/`:69602`）。
- **`sub_461C50`（`:105778`）**：置中 `sub_545450(this, (800 - v17) >> 1, (600 - v16) >> 1, ...)`（`:105835`）。

### 道具格、頁籤條與技能窗的原生尺寸（2026-10-21，ADR-124／125）

- **道具格 = 32px、pitch = 35px**（`client/slot.ts`），原碼五處：
  - `sub_4DB990` `:226041`：`SetRect(lprc, 35c+6, 35r+80, 35c+38, 35r+112)` → 一句話同時給出 32 與 35。
  - `sub_4D5440` `:219870`／`:219871`：`n146 = 35*(v2%2)+291`、`v26 = 35*(v2/2)+160`（列底）。
  - `sub_4B5FA0` `:190521`：`n245 = v50 - v54 + 32`。
  - `sub_4D9110` `:223711`：`x < p < x+32 && y < q < y+32`（14 組座標，兩邊嚴格小於）。
  - `sub_4FC440` `:257805`：`n245 = v41 - v46 + 32`。
  - WZ 佐證：`UI/UIWindow.img/Item/activeIcon` 實測 **36×36** = 32 + 2×2。
  - 背包四欄 `6 + 4×35 = 146`，正好停在捲軸 `x = 147` 的前一格（`sub_4DA440` 的 `CCtrlScrollBar id2001 at (147, 80)`）。
- **`sub_4ECD40`（CUISkill 建構式，`MapleStory.exe.c:243551`）**——技能窗版面全部出自這裡：
  - `:243618`：`CCtrlTab id2000 at (3, 52), 170 寬` → 頁籤條 3..173；減掉 `UI/Basic.img/Tab` 的 4/12 兩帽 → 內寬 **154**，從 **7** 開始，右帽蓋在 **161**。
  - `:243639`：`CCtrlScrollBar id2001 at (161, 116) height 162`；`:243646`：`*(*(this+219)+44) = 156`。
  - `:243695`..`:243704`：`CCtrlButton id(2010+i) at (139, n137)`，`n137 = 137`、`n137 += 40`、`while (n137 < 297)` → 四顆，y = 137/177/217/257，pitch **40**（同時是列距）。
  - `sub_4D89F0`（CUIEquip 建構式，`:223384`）另證：`sub_545450(this, v5[0], v4, 176, 315, 10, 0)` → 裝備窗 **176×315**；`sub_506440(this, 1, 128, 9, 1)` → 關閉鈕 (128,9)。
- **`UI/Basic.img/Tab`（ADR-119 實測）**：`left` 4×24、`middle` 14×24、`right` 12×24、`fill` 1×24。已從 `shop-window.ts` 搬到共用 `client/tabstrip.ts`（商店、技能書、背包三條頁籤條都用它）。
- **無原碼依據**：技能窗的 `SKILL_ROW_TOP = 119`、`SKILL_ROW = { x: 5, width: 154 }`、`SKILL_ROW_LIVE = 38`（列畫家 `sub_4ED8E0` 埋在 `VARIANTARG` union 讀不出來）。
- **已做（ADR-126）**：技能窗的捲軸底圖不再是手刻的 `for (let y = 128; y < 266; y += 12)`；六條捲軸全部走共用 `paintVScrollbar`（見下面 ADR-127 那條）。

- **`UI/Basic.img/VScr` / `CCtrlScrollBar`（ADR-126、ADR-127，2026-10-21）**：六條捲軸（交易、messenger、技能、
  商店買、商店賣、背包）現在**全部**由 `client/vscroll.ts` 的 `paintVScrollbar` 畫。第 5 個參數是
  `VScrollPaint { max, offset, pressed?, dragging? }`，其中 `max` 用原版 `SetMax = rows - (capacity - 1)`
  （`<= 1` 就是 disabled 且無 thumb）、`offset = sub_452500` 的 `floor(pos * travel / (max - 1))`。
  `VScroll` 結構上直接滿足它，所以持有 scroller 的視窗把整顆傳進去即可；商店與背包只存列號，就手動傳這兩個數字。
- **`sub_452500` 的 thumb 是 `floor` 不是 `round`（ADR-127 修正）**：商店與背包原本用 `Math.round`，與原版差 1px。
  實例：12 列購買清單 `171 * 3 / 6 = 85.5` → **85**；100 格背包 `172 * 10 / 19 = 90.53` → **90**。已改。
- **已完成（原 ADR-125 的待辦）**：技能窗的捲軸底圖不再是手刻的 `for (let y = 128; y < 266; y += 12)`。
- **無原碼依據**：商店與背包**沒有** per-arrow 的按住狀態，所以 `prev1`/`next1` 只有交易窗會出現。
  這是我們「還沒把那兩個視窗接到 `sub_4521E0` 的按住狀態」的實況，不是原版證明——原版 `CCtrlScrollBar`
  一定有，只是那兩個視窗的持有人還沒被讀出來。

- **`UI/UIWindow.img/BtUIClose` / `BtUIClose2` 是 32x15（ADR-128 實測，四態皆同）**：五個視窗
  （裝備、背包、商店、能力值、技能）＋系統選單＋NPC 對話的關閉鈕共用它。原碼依據是
  `sub_4E0FF0`（`:231327`）：`CCtrlButton::Create(this, 1000, 152, 9, 2, &path)` —— 型別 2 的按鈕
  不帶矩形，矩形就是 sprite 自己的大小，所以 hit test 的框等於片寬。已收回 `client/uicontrols.ts`
  的 `BT_UI_CLOSE`。
- **共用四態按鈕的臉（ADR-128）**：`<path>/<face>/0`，`normal` / `mouseOver` / `pressed` /
  `disabled`，優先序是 **disabled > pressed > hover > normal**。原本手抄了 11 份以上，其中
  statwindow 的關閉鈕缺 `disabled` 臂、login 的標題鈕用 `!dialogOpen &&` 兩次代替 `disabled`。
  已收回 `uiButtonFace()` / `buttonSprite()`。
- **其他實測片寬（ADR-128）**：`UI/Basic.img/BtOK`＋`BtCancel` 65x24、`BtComboBox` 17x16、
  `UI/UIWindow.img/UtilDlgEx{,2}/Bt*` 50x23、`GameMenu/Bt*` 136x23、`UI/Basic.img/CheckBox` 0..3 12x12、
  `UI/Basic.img/Slider` 端帽 3x4／填充 1x2／thumb 17x16。全部收回 `client/uicontrols.ts`。
- **未定（ADR-128 記錄，沒有證據所以沒改）**：`client/systemmenu.ts` 的 combo 箭頭畫在
  `x + c.w - 16`，但 `BtComboBox` 是 17 寬，右緣會超出框 1px。沒有原碼或 WZ 依據支持哪一邊。
- **無原碼依據**：技能窗關閉鈕的位置 `SKILL_CLOSE = { x: 128, y: 9 }`。`sub_4ECD40` 那顆
  `CCtrlButton` 的 Create 埋在 VARIANTARG union 裡；只有「同一張 176x315 底板上裝備窗與能力值窗
  都用 (128,9)」這個交互佐證。

- **七條 `CCtrlScrollBar` 全部走同一個畫家（ADR-129 完成）**：交易、messenger、技能、商店買、
  商店賣、背包、**NPC 對話**。NPC 對話那份是最後一份手刻的 `UI/Basic.img/VScr` 畫法，已經改用
  共用 `paintVScrollbar`（抽出 `drawDialogueScrollbar` 當轉接頭），並且把它的 `Math.round` 也改成
  `sub_452500` 的 `floor`（ADR-127 當初漏了這裡）。
- **`sub_452500` 的 thumb 是 `floor`（再補一例）**：NPC 對話窗 `visibleHeight = 240` →
  `travel = 204`；`maxScroll = 8`、`scroll = 3` → `204 * 3 / 8 = 76.5` → 原版 **76**（原本畫 77）。
- **每個按鈕框 = 它自己那張 sprite 的尺寸（ADR-129 實測並上鎖）**：
  `Item/BtCoin` 17x17、`Stat/BtDetail` 47x18、`Skill/BtSpUp` 17x16、`Shop/BtBuy` 46x19、
  `Shop/BtSell` 46x19、`Shop/BtRecharge` 50x23、`BtUIClose`/`BtUIClose2` 32x15、
  `Trade/BtTrade` 50x23、`Trade/BtCoin` **14x14**（注意與 `Item/BtCoin` 的 17x17 不同）、
  `StatusBar` 四顆 36x35 與 `BtMenu`/`BtChat` 38x17、`CharSelect/BtCheckId` 43x16。
  守門測試在 `server/test/button-boxes.test.ts`。

- **`UI/UIWindow.img/UtilDlgEx{,2}/Border` 八格（ADR-130 實測，兩個調色盤同尺寸）**：
  `0` 左上角 7x18、`1` 上填充 4x18、`2` 右上角 54x31、`3` 左填充 7x4、`4` 右填充 8x4、
  `5` 左下角 7x18、`6` 下填充 4x18、`7` 右下角 8x18。已收回 `client/uiframe.ts`；
  `drawUtilFrame` 寫死的 13（= 31-18）、7、54、8、4、18、31、49（= 31+18）全部由這八格推出。
- **`drawUtilFrame` 的 clip 是有作用的（ADR-130）**：4px 的上下填充會一路貼到「自己的格子跨過右邊框」
  為止，所以大多數寬度下最後一格會**超出最多 3px**（寬 300：291+4=295 > 292）。這與 ADR-127
  「捲軸水槽的 clip 是多餘的」是**相反**的結論，兩處都不要照抄對方的做法。

## ADR-131：按住捲軸箭頭（`sub_4521E0` / `sub_4523D0` / `sub_4524C0` / `sub_4522B0`）

- **四條證據，四個不同的副程式**：按下是 `sub_4521E0`（動作後蓋 `+56` zone / `+60` tick）、
  重複是 `sub_4523D0`（`CCtrlScrollBar` 的 OnTimer，vftable[0]）、節奏是 `sub_4524C0`
  （zone 不是 100/105 且 `GetTickCount() - [esi+3C] > 0x32`，也就是**每 50ms 一次**）、
  放開是 `sub_4522B0`。**thumb（zone 105）被 `sub_4524C0` 明確排除**，所以拖曳中的 thumb
  永不重複 —— 它走的是 `sub_4526A0`。
- **每 tick 用 `GetCursorPos` 重新 hit**：所以「按住後把游標移開箭頭」會**停止**重複，
  移回來會**繼續**，而 press 本身要等放開才清。這跟「記住按下時那個 zone」是不一樣的行為，
  實作時不能省。
- **閘是 `>` 不是 `>=`**：`GetTickCount() - [esi+3C] > 0x32`，所以 50ms 整**仍在閘內**，
  51ms 才是第二次。而且每次動作都會重新蓋章，因此節奏是「每次動作後 50ms」。
- **軌道在 thumb 處分成兩區**（`sub_452500`）：thumb 之上是 103（page up）、
  thumb 自己是 105、thumb 之下是 104（page down）。商店與背包原本把整段當成一個 `track`，
  再由 click 處理器重算方向；ADR-131 起 hit test 直接回傳這五個 zone。
- **商店與背包沒有 `CCtrlScrollBar`**：`sub_4B6EC0` 與 `sub_4DA810` 各存一個整數列索引，
  所以它們只借用「按住」這一半（現在是 `client/vscroll.ts` 的 `pressRepeat()`），
  列算術仍是自己的。

## ADR-132：狀態列的第七顆鈕 `BtWhisper`（`sub_4F6B70` id 1006 / `sub_4F8940`）

- **`sub_4F88C0` 有七個 case，不是六個**：`case 1006: sub_4F8940(this);`。舊的
  `docs/NATIVE_MESSENGER.md` 按鈕表只列到 1005（BtMenu），所以 `BtWhisper` 一直沒被畫、
  也沒被 hit test。
- **建立引數**（`sub_4F6B70`，vtable slot 32）：`Create(this, parent, 1006, 327, 183, 0, &out)`，
  **沒有 w/h 引數**；`type 0`。14×23 來自 `UI/StatusBar.img/BtWhisper`。狀態列原點 y=392
  → 頁面 **(327, 575)**。
- **版面交叉確認**：收件人銘牌在頁面 x 245..324、y 578..595；BtWhisper 在其右側 3px
  （327−324=3）且**垂直置中**（586.5 vs 586.5）。兩組數字必出自同一份原始版面。
- **`sub_4F8940` 的行為**：`this+246`（收件人）非空 → `sub_4FB160(this, lpMultiByteStr_0, ...)`
  而 `lpMultiByteStr_0` 是**空字串**（`CHAR lpMultiByteStr_0[4] = {'\0',...}`），也就是**清除收件人**；
  否則開輸入框問名字，原文是 `asc_5BD308` = **`"귓속말 상대를 입력하세요."`**
  （CP949 `B1 D3 BC D3 B8 BB 20 BB F3 B4 EB B8 A6 20 C0 D4 B7 C2 C7 CF BC BC BF E4 2E`）——
  本專案既有的對話框字串與此**逐位元組相同**。
- **七個 strip 都有四個 face**：`BtChat/BtEquip/BtItem/BtMenu/BtSkill/BtStat/BtWhisper` 全部
  含 `disabled`。舊的 `preloadStatusBar` 只預載 `normal/mouseOver/pressed` 三面（18 個），
  已改為四面（28 個）。
- **畫布要拿回指標**：`#chatbox` 是 `#game-ui` 的直接子節點，而被 `#game-ui > *` 給了
  `pointer-events: auto`，所以它那塊 446×27（頁面 243..689 × 573..600）**整塊吃掉畫布的點擊**。
  已改為 `#chatbox { pointer-events: none }` + `#chatbox > * { pointer-events: auto }`
  （實測：`#say`／`#chat-lines`／`#chat-scroll`／`#emotes button` 都仍然收得到，只有那塊
  空白把指標還給畫布）。

## ADR-133：登入／創角畫面的尺寸（`UI/Login.img`）與 `sub_42E0D0` 的角色格

- **`CharSelect/menu` 是 490×398，程式裡寫的是 491**：`CHARACTER_UI.width` 長期多一格。
  它不是「差一點」而已——**這條測試本來永遠不可能失敗**：它把常數再抄一次
  （`[161, 85, 491, 398]`），而不是去量那張 canvas。兩扇窗都只用 `menu` 這張片自己的尺寸來畫，
  所以 `width`/`height` 在 client 裡其實**沒有被用到**，錯數字才會活這麼久。已改為實測。
- **一次收集成一張表**：`client/selection.ts` 新增 `LOGIN_CELLS`，每個尺寸都寫在**它來自的 WZ 路徑旁邊**，
  再由 `server/test/presentation-selection.test.ts` 走過整張表逐項重測（button strip 是四個 face 的目錄，
  所以量的是 `<path>/normal/0`）。新增一個尺寸就必須給路徑，不給就測不到。
- **`sub_42E0D0`（`:54643`）就是整個角色格 hit test**，每一個數字都出自它：
  `rc.left = n120 - 50`、`rc.top = 178`、`rc.right = n120`、`rc.bottom = 248`；
  `n120` 從 **120** 起、每次 `+= 140`、到 `n120 >= 540` 停。
  → 格子 **50×70**、間距 **140**、第一格左緣 120−50＝**70**；而 `540 = 120 + 3×140` 正是「三格」的由來。
  腳底 `feetX`＝格子自己的中心 x（70+50/2＝95）、`feetY`＝底緣上方 10（178+70−10＝238）。
- **世界列**：`WORLD_UI.rowWidth/rowHeight` 是 `WorldSelect/wsItem` **240×25**；
  `rowY 199 = headerY 181 + wsHeader 18`（`wsHeader` 240×18）——所以 rowY 現在由表推出，不再手寫。
- **人口條**：`worldGaugeClip` 的 101×7 是 `WorldSelect/wsGauge`。
- **創角**：`NEW_CHARACTER_UI` 260×424 是 `CharSelect/newDlg`；`CREATION_BUTTONS[0]` 43×16 是
  `CharSelect/BtCheckId`。
- **按鈕尺寸不可合併**：`WorldSelect/BtConnect` 是 **111×24**，`CharSelect/BtSelect/BtDelete/BtNew`
  三個都是 **141×24**。測試裡有 `notEqual` 擋住「順手整理成同一個常數」。

## ADR-134：`sub_4F6B70` 其實做了九個控制項（1007／1008），與聊天列尺寸的出處

- **`sub_4F6B70` 用 `Create` 建了 id 1000～1008**：1000～1006 是 `CCtrlButton`
  （**872 bytes** 的物件，走 vtable+32，`(parent, id, x, y, type, &out)`）；
  **1007、1008 是別的類別**。全部數字都從**原始組語**讀出（反編譯器對這兩個 call site 猜錯了 signature）。
- **id 1008＝聊天輸入框**。`Create` 走的是 **vtable+8**（不是 +32），組語在 `.text:004F8214`：
  `push 0Ch; push 154h; push 0BCh; push 15Ah; push 3F0h; push esi; call [edx+8]`
  → `Create(parent, 1008, 346, 188, 340, 12, &font)`。後面填的字型區塊是
  **12px、顏色 `0xFF000000`（黑）、`[12] = 70`**——70 就是輸入長度上限。
  列區域（346,188）＋列原點 y=392 → **畫面 (346,580)**。
- **id 1007**：`.text:004F8155` 起 `push 0; push 52h; push 62h; push eax; push 0; push 1; push 3EFh; push esi`
  → `Create(parent, 1007, 1, 0, 689-W, 98, 82, 0)`，接著 `*(control+44) = 446 - W`。
- **W 是捲軸寬度，而且量到了**：`sub_450F70(1, nullptr)` 解析的是 WZ 路徑 **`/enabled/prev0`**，
  而 `UI/Basic.img/VScr` 的十個 cell **全部是 12×12**（`ui-basic-cells.test.ts` 已釘）。
  → **W = 12**。所以 `446 - 12 = 434`（文字欄寬）、`243 + 446 - 12 = 677 = 689 - 12`（1007 拿到的右緣）。
- **日誌列矩形**：`sub_4FBEE0` 與同型函式設的都是同一個框——列區域 **(243, 97)、(446-W) × 84**，
  也就是畫面 (243,489) 434×84；捲軸 **W 寬 × 82 高**。
- **`sub_4F8850` 是通用通知處理器，不是 1007 專屬**：`(id, code∈[300,304])` 加 `code==100` 這組形狀
  在其他視窗也出現（`sub_4B4790` id 1003、`sub_4D4700` id 1003、`sub_4DE430` id 1002、
  `sub_4ED1F0` id 2000），所以不要把它當成 1007 的行為去「實作」。
- **更正一處先前的誤讀**：`sub_403350` 是**記憶體池配置器**（16/32/64/128），**不是字串表查詢**。
  所以 `0x368/0x64/0xA0` 是**物件大小**（CCtrlButton 872、1007 的物件 100、1008 的 160），不是字串 id。
- **結論：1007／1008 其實都已經實作，而且是逐像素正確的**（DOM 版）。`#chatbox` 在 (243,573) 寬 446；
  `#chat-history` 在 (243,489) **434×84**；`#chat-scroll` **12 寬 82 高**；
  `#say` 在 (243+103, 573+7) = **(346,580) 340×12**、12px 黑 Gulim、`maxlength="70"`。
  本輪把它們收進 `CHAT_BAR`（`client/hud.ts`）並加測試，**沒有移動任何東西**。

## ADR-135：原版**沒有**自動註冊，與 `--auto-register`

- **原版沒有任何註冊流程**。未知的 id 就是 `LOGIN_RESULT.notRegistered` = **5**
  「**등록되지 않은 아이디입니다.**」。帳號只可能在遊戲外存在——封測版自己就這麼說：
  「**베타당첨자의 경우에는 별도의 가입없이, 베타신청시의 계정/비번을 이용하세요.**」
  （封測中獎者無需另外註冊，請用申請時的帳號密碼。）
- **登入結果碼已對原始組語逐條對齊**（`sub_4D0DB0`，`.c:215743`；字串在 `.lst` 775251-775263）。
  switch 的值是 `(u8)result + 1`（低位元組相加，所以 `0xFF + 1 = 0` → `case 0`）：

  | code | 韓文訊息 |
  |---|---|
  | 3 | 지워지거나 접속 중지된 아이디입니다. |
  | 4 | 잘못된 패스워드입니다. |
  | 5 | 등록되지 않은 아이디입니다. |
  | 7 | 현재 접속중인 아이디이거나,\r\n현재 서버점검중입니다. |
  | 9 / 0xFF | 시스템 오류로 접속 할 수 없습니다. |

- **`sub_524A00` 是 `Etc/ForbiddenName.img` 的禁字檢查器**，用來驗證角色名／密語對象，
  **不是**帳號格式檢查；觸發時顯示「잘못된 아이디입니다.」（`aAi_2`, `.data:005BD2F0`）。
- **因此 `--auto-register` 是刻意新增、預設關閉、且非原版的功能**（與 `--test-tools`、`--map-command` 同類）。
  空帳號或空密碼**一律不註冊**（任何人打空白就能開的帳號比沒有帳號更糟，且回 5 仍然是字面為真——什麼都沒建）。
  註冊後**立即 `persist()`**，重啟不會在創角前就忘掉它。
- **未解（誠實標記）**：`index.html` 的 `#user maxlength="64"`／`#pass maxlength="12"`
  **在 EXE 裡找不到依據**，只是頁面自己的欄位上限，本輪不假裝有原證。

### 4.46 ✅ 畫面合成沒有模糊，但固定表頭會吃掉畫面頂端（ADR-137，2026-10-22）

**先證偽「糊」這件事**：真 Chromium 跑 100 種組合（DPR 1／1.25／1.5／2／3 × 五種顯示模式 ×
四種鏡頭），比對「最終截圖 vs canvas backing store」，並逐格檢查「一個來源像素是否剛好是一塊
k×k 且內部同色的裝置像素」。**100/100 全部 `nonUniform=0`**。數學上也必然如此：
CSS 尺寸恆為 `800×ds`、transform 恆為 `1/dpr`，乘回 dpr 恰好等於 backing store，
所以合成器從來不需要縮放。鏡頭原點（`collisionRound`）、角色／怪物座標、UI 圖示原點亦全為整數。

**真正的缺陷**：`#bar`（實測 43px）是 `position: fixed` 浮動表頭，但 `viewLayout` 量的是
`#game-viewport`（`inset: 0`＝整個視窗），畫面在整個視窗置中 → 只要垂直餘量 < 43px，
**畫面頂端就滑到表頭底下**：1300×600 與 1000×600 各被吃掉 **43px（7.2%）**，
1200×620 吃掉 33px、1500×640@DPR2 吃掉 23px。偏矮的預覽 iframe 正好落在這個區間。

**修法**：`viewLayout` 新增 `reservedTop`，扣掉表頭列後才置中；`displayControls` 新增 `chrome`
去量它（標題畫面 `display: none` 量到 0，自然不保留任何列）。表頭高度由內容決定（43），
直接相加會讓 `43 × 1.5 = 64.5` 落在半個裝置像素上，故保留列必須**無條件進位**到 `originGrid`。

**UI 層的驗證缺口**：`zoom-display-browser.test.ts` 只畫世界層；HUD／狀態列／聊天全在 800×600
的 UI buffer 上再整數放大，**之前完全沒測**。新增 `display-ui-surface.test.ts` 用全不透明 2×2
棋盤（最高頻率、不留透明讓世界層透出）補上，並涵蓋預設 `pixel` 模式與 `wide` 鏡頭。
變異驗證：`presentUi` 改 `imageSmoothingEnabled=true` → `nonUniform` 由 0 暴衝到 479,999/480,000。

**尚未解決（需使用者決定）**：整數裝置像素放大在分數縮放螢幕上會讓畫面**小於原版 800×600**
（CSS 尺寸 = `800×ds/dpr`，要 ≥800×600 需 `ds ≥ dpr`，下一個整數又太大）。
實測 DPR 1.25 → 640×480（80%）、DPR 1.5 → 533×400（67%）、DPR 2 偏矮 → 400×300（50%）。
完全清晰，只是小；改成「不小於原版」就必須進位並允許捲動。

### 4.47 ✅ 登入畫面抖動：自動模式的 `floor(fit)` 階梯在邊界上翻轉（ADR-138，2026-10-22）

**抖動不在繪製路徑（已逐項實測排除）**：`drawTitleScreen` 無 `now`、無與時間相關的繪圖；
canvas 60 幀 hash 只有 1 種、0 幀不同；版面 90 幀只有 1 種；DOM 90 幀只有 1 種；
`style.css` 無 `@keyframes`（僅 `transition: opacity 120ms`）；RAF 中位數 16.7ms／標準差 0.06ms／0/119 幀逾 20ms。

**真因在尺寸決策**：自動模式 `floor(min(w/800, usable/600) * dpr)` 是階梯函數，
邊界上視窗抖 1px 即讓 `deviceScale` 於 2↔1 間翻轉，畫面在 **1600×1200 ↔ 800×600** 反覆跳動。
實測邊界在 h=1200（1199→ds1、1200→ds2）；於 1199↔1201 擺盪得 `2/1600 1/800 2/1600 1/800 …`。
這解釋了兩件事：**只有預設（自動）模式會**（手動倍率固定），以及**單張截圖看不出來**
（兩個尺寸單獨看都對，必須擺盪視窗或取多幀才現形）。iframe 縮放或捲軸出現即足以觸發。

**修法＝磁滯**：`viewLayout` 新增 `current`，由 `display-controls` 回餵目前倍率；
帶寬 `AUTO_HYSTERESIS_PX = 24`（比一條捲軸寬——捲軸是環境自身造成的最大一步）。
手動模式不看 `current`（倍率為使用者直接選定者）。變異驗證：移除磁滯段 → 該測試紅、餘 7 條綠。

**初版修法自踩一洞（瀏覽器實測抓到）：只有「往下」才該維持。**
初版寫「只要還在該格就維持」，連換模式也被維持，`pixel`(1×) → `pixel-original` 竟仍是 640×480
（DPR 1.25／1203×903 實測），永遠到不了自己的下限。
理由：抖動**永遠是往下掉**（`fit` 跨整數→`floor` 掉一格→畫面減半）；往上升不可能是抖動
（代表下一個尺寸真裝得下，且升上去不會再讓視窗變小），故須立刻生效。
改為 `deviceScale < held` 才維持後：`pixel` 640×480、`pixel-original` **1280×960**
（backing 1600×1200），`scrollWidth 1283 > clientWidth 1203` 如實回報溢出可捲動。
變異驗證：拿掉 `deviceScale < held` → 「抖動」測試紅、餘全綠。
真實 Chromium 複驗：1200↔1199 擺盪六次，修好前交替、修好後 `1600×1200` 連六次（`distinct=1`）。

**第六個顯示選項 `pixel-original`（ADR-137 結尾使用者選「兩者都要」）**：
`min(4, max(1, floor(fit), ceil(dpr)))`——自動模式加下限。CSS 尺寸為 `800×ds/dpr`，
欲 ≥800×600 需 `ds ≥ dpr`，而下一個整數是唯一清晰的取法；裝不下則捲動
（與既有手動模式政策「視窗較小，請捲動；不縮小模糊」一致）。原本 `pixel` 完整保留，非只剩一個選項。
下拉選單現為六項。變異驗證：移除 `Math.ceil(dpr)` → 該測試紅、餘綠
（DPR 1.25 之 1536×760：`pixel` 縮至 640×480，新模式維持 2×／1280×960 並回報 `overflowing`）。

**自踩兩坑**：(1) 首版測試預期 2000×2000 升 3× 為錯——寬度 `2000/800=2.5` 才是瓶頸；
改 3000×2000 方測得真正升級。(2) `select.children.length` 與 `DISPLAY_MODES.length`
各有一處寫死的 5，前者已改為直接讀 `DISPLAY_MODES.length` 以防再度飄移。

**順手查清：LIVE 的 `body length 8276 exceeds the 1460 cap` 不是 bug。**
暫於 `session.ts` deframer 傾印原始位元組（驗證後已完全還原）：
`47 45 54 20 2f 20 48 54 54 50 2f 31 2e 31 0d 0a 48 6f 73 74 3a 20 38 36 30 36 …` =
`GET / HTTP/1.1\\r\\nHost: 8606-…`，即**沙箱埠預覽對裸 TCP 登入埠（8606）的 HTTP 探測**，
非遊戲客戶端封包。伺服器誤讀為超長封包並關閉連線，行為正確，毋需修復亦毋庸複查。

### 4.48 ✅ Greeting length → version／counted bytes／seeds；`0xD3` 不是 wire length（ADR-167）

倉庫 EXE 中 `0x00D3` 出現在不同語境：`0043AD75` 是 c2s session-header magic；`0043A76E` 是 greeting parser 讀出的 version 比較值。版本錯誤分支 `<211` 會 terminate，`>211` 會建立 expected=211／received=N 的 patch record（`sub_468400`）；這確認它是版本值，不是 outer length。

**`sub_43A410` 的接收步驟（以 `MapleStory.exe.c` 與 `.lst` 互證）**：

1. `0043A5DF–0043A645` 第一次 `recv()` 取得 2-byte little-endian prefix；`0043A645` 將它讀作後續 payload 長度，並以 1460-byte buffer capacity 檢查上限。
2. `0043A661` 的 `mov esi, edi` 將 receive destination 重設至 buffer base；第二階段從 socket 目前位置再收 prefix 宣告的 bytes。因此這批 bytes **覆蓋 buffer 開頭**，不會把 prefix 留在 payload 中。此指標重設是先前誤讀中漏掉的關鍵。
3. payload offset 0 是 version `0x00D3`（`0043A6C8` 讀、`0043A76E` 比較）；payload offset 2 是 u16 counted length（`0043A6F2`）；counted bytes 從 payload offset 4 起（`0043A717` 呼叫 `sub_418610`）。
4. counted bytes 後的第一個 u32 寫到 `CClientSocket+120`，供 send cipher（`sub_43AD50`）；第二個 u32 寫到 `+124`，供 receive cipher（`sub_43AFA0`）。若 counted length 為 N，wire offsets 分別是 `6+N` 與 `10+N`。

線上布局（little-endian）：

```text
u16 payloadLength (不含這 2 bytes)
  u16 version=0x00D3
  u16 countedLength
  byte[countedLength]
  u32 clientSendSeed
  u32 clientRecvSeed
  [any bytes left in declared payload; this parser path does not inspect them]
```

空 counted string 時 payload 下限為 12、wire 下限為 14 bytes；這是 parser-valid minimum，不是已證實原 server 的固定 greeting 長度。`sub_418610` 可接受 count=0；已傳入的 bytes 被複製至 temporary ZXString 後釋放，parser 未再使用字串內容，故 server-side semantics／實際字串值仍未知。這份 EXE/listing 與長度前置、版本後置的格式相符，沒有必要再假設 binary／stage／offset mismatch。

`session.ts`、`decode.ts`、capture、login/game listener、Node fake client 與相應 tests 已遷移。預設輸出 14-byte 形式是最小測試／harness greeting；沒有宣稱它就是原 server 的精確輸出，且不把 211 當 wire length。

### 4.49 ✅ NPC 商店資料位於 `Npc/<id>.img/info/shop`（ADR-140），原手寫三間為虛構且價格錯誤

**資料確實存在**：`Npc/<id>.img` → **`info`** → `shop` → `<8位道具id>` → `{price, stock, period, unitPrice?}`。
70 個 `Npc/*.img` 中 **20 個**帶商店，共 **594 列**。
前版文件稱「庫存在已消失之 2003 server script」有誤；節點在 `info` 下（頂層僅 `info` 與動畫），故先前未尋得。
NPC 圖檔為原版 `Npc/%07d.img`（`sub_411E50`）**零填充 7 位**（`Npc/0000220.img` = id 220）。

**商店自有的 `price` ≠ 道具的 `info/price`，且 543 列中 541 列相異**（多為 2 倍但非必然）：
1302000 검 info=1/shop=50（NPC 11000）、1302007 카알 대검 1500/3000、1332000 삼각 자마다르 2000/4000、
2000000 빨간 포션 25/50（루시 11100）、1402001 목검 1500/100。故售價須讀列自身，僅 8 列（皆 207）退回 `info/price`。

**`unitPrice` 同理且有實例**：48 列中 40 列與 `info/unitPrice` 一致，
惟 **1061001（24시간 포장마차）為 1／2／3…**，而道具自身為 0.3／0.4／0.5…。

**`stock`／`period` 已實作**：`stock` 為架上量（耗盡回 `outOfStock`＝客戶端「물품이 부족합니다」）；
`period` 為補貨間隔。**「單位為小時」係推論**：全檔僅見 **4、6、12**，皆整除 24，且按類別分群
（消耗品 4、裝備 6 或 12）。庫存僅存於記憶體（重開即補滿），不改存檔格式。

**移除**：虛構三間（`1010100`／`2003`／`12100`，三者皆無 `shop` 節點）及「將全部 207 塞入每間店」之行為。
新玩家可達之真商店：1000000 →（portal 4）→ 1010000 암허스트 →（portal 2）→ **1010001 암허스트무기상점**
（칼 1011000／샘 1011001），或（portal 4）→ **1010003 암허스트잡화상점**（루시 11100）。
20 間中 19 間有置於地圖（220 無）。

**變異驗證**：`buyPriceOf` 退回 `info/price` → 6 條紅；`unitPriceOf` 退回 `info/unitPrice` → 1 條紅；
庫存不減 → 1 條紅；移除 `info/shop` 讀取 → 4 條紅。

### 4.51 ✅ `sub_4C7960` 的武器分支：能力值欄位、揮擊係數、action 32 的全套對照（ADR-141）

**為何有這一節**：`game/nativecombat.ts` 是 `sub_4C7960`（`.c:207249`）的逐行轉寫，但其中**兩個分支
「有原證卻沒有測試釘住」**——把任一個揮擊係數反過來，整套 1365 個測試仍然全綠。本節把原證記下來，
並由 `server/test/native-physical-formula.test.ts` 釘死。

**能力值欄位（同一組 obfuscated xor-pair）**：`sub_4C7960` 以 `a3[i] ^ a3[i+1]` 讀能力值。三個欄位
由三個分支互相鎖定：劍系拿 `a3[6]^a3[7]` 當骰底、加 `a3[8]^a3[9]`；弓系正好相反；爪系骰
`a3[12]^a3[13]` 並加前兩者的和。唯一一致的讀法：

  `a3[6]^a3[7]` ＝ **STR**　　`a3[8]^a9` ＝ **DEX**　　`a3[12]^a3[13]` ＝ **LUK**　　（`a3[2]^a3[3]` ＝ 等級、`a3[4]^a3[5]` ＝ 職業）

**武器分支表**（`uniform(x, x*factor)` 記為 U，`factor = (mastery*5+10)*0.009000000000000001`）:

| weapon | 骰底 | 加項 | 係數（action 5–15／其他） | 原始碼位置 |
|---|---|---|---|---|
| 30 33 40 | STR | DEX | 4 / 4（單手劍沒有揮擊差別） | 207566 |
| 31 32 37 38 41 42 44 | STR | DEX | **4 / 2** | 207628（`LABEL_91` 的 `v55+v55`） |
| 43 | STR | DEX | **2 / 4**（**與上列相反**） | 207693 |
| 45 46 | DEX | STR | 4 / 4 | 207855 |
| 47 | LUK | STR+DEX | 4 / 4 | 207894 |
| 33 且 branch 4（盜賊） | LUK | STR+DEX | 4 / 4 | 207569 |

**`action === 32` 不是特例，是同一個 fallthrough**（207552–207977）：
```c
v34 = 0.0;
if (weapon != 45 && != 46 && != 47) { n5_1 = action; goto LABEL_63; }
n5_1 = action;
if (action >= 22 && action <= 27) {
LABEL_63:
  if (n5_1 != 32) { switch (weapon) { ... } }   // action 32 -> 整段跳過
}
// 落到這裡 = (weapon ∈ {45,46,47} 且 action ∉ [22,27]) 或 action == 32
v34 = uniform(STR, STR*0.5) * PAD * 0.006666666666666667;   // = 1/150
```
所以 `action 32` 對**任何**武器都走這條（劍也一樣），而 45/46/47 在 action 22–27 內反而回到 switch。

**其餘常數全部對到**：`0.392156862745098` ＝ 100/255（等級夠時的命中分母）；`255 + diff*10`
（等級不夠）；`branch 3` 命中 `0.4/0.8`、其餘 `0.5/1.5`；`raw *= (100-diff)*0.01`（`LABEL_132`，
所有分支共用）；屬性 1 → ×0.5、2 → `max(raw, raw*1.5)` 上限 9999；`defense = uniform(PD*0.5, PD*0.6)`；
爆擊 `uniform(0,100) > 3*level` → `× 5*level*0.01`；`<= 1` 一律給 1（這就是「最低傷害 1」）。

**`sub_4C8ED0`（接觸傷害）同樣全套對到**（208239+）：EVA ＝ base+temp、`level < mob.level` 時
`eva - (mobLevel-level)/2`；`uniform(eva*0.1, eva) >= mob.acc` 即 MISS；
`damage = uniform(PA*0.7, PA*0.8) * PA * 0.01`；依職業扣
`((str*0.15+dex*0.1)*PDD)/(level*2.5)`／`((dex+str)*0.5*PDD)/(level*2.2)`／`((str*0.2+dex*0.1)*PDD)/(level*2.5)`。

**Detail（面板）第一列的「攻擊力」不是 PAD**：`detailRows` 是 `PAD + STR`（branch 0／1；
branch 3 用 DEX、branch 4 用 `LUK + trunc((DEX+STR)/4)`）。所以「面板 29」可以是 `PAD 17 + STR 12`，
**也可以是 `PAD 0 + STR 29`**——後者就是「面板攻擊力 29 但打怪都是 1」的全部原因：
PAD 0 時 `raw` 被乘成 0，再由 `<= 1 → 1` 鉗成最低傷害。`equipment-generation.test.ts`
有把這整條（Detail29／damage1 → 修復後 Detail46／正常傷害）釘住。
