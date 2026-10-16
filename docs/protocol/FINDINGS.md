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

- `u16 @ 0`：`0xD3 ^ HIWORD(cipherState)`——**每個封包都不同**，同時作為狀態同步自檢（§3）。
- `u16 @ 2`：本文長度；本文 = 接下來的 `bodyLen` bytes，**加密**。
- 上限：單包不超過 **1456 bytes** 本文；超過時 `sub_4A2030` 會切成 **1460 bytes 的 socket chunk** 送出，
  **只有第一塊帶標頭**（`sub_4A2030` 內 `v11 > 1456` 分支）。
- 明文特例：**連線後第一個封包是 211 bytes 的握手**，其本文不加密（金鑰就藏在裡面）。

**已證實的 211-byte 握手**（`sub_43A410`，於 `FD_CONNECT` 後執行）：

```
u16 totalLen                     // == 211，否則：
    > 211 → CxxThrowException(_TI3_AVCPatchException__)      // 需要更新（PATCH）
    < 211 → CxxThrowException(_TI3_AVCTerminateException__)  // 終止
u16 bodyLen                      // == 199
u8[bodyLen] body                 // 199 bytes
u32 sendSeed                     // @ 4 + bodyLen = 203  → *(this + 120)
u32 recvSeed                     // @ 8 + bodyLen = 207  → *(this + 124)
```

> 解讀：這是**登入/版本檢查握手**。長度必須等於 211 是這支 handler 的契約；兩個例外類別的存在意味著
> 「版本不符 → 走更新流程」。`body` 的內容語意仍為 **UNKNOWN**（§6 待辦 1）。
>
> 🟡 **HYPOTHESIS（未證實）**：`sub_43A410` 是**接收**路徑（`FD_CONNECT` → 讀 211 bytes），因此推論
> **由伺服器先送這 211 bytes**。若成立，重寫版 client 必須等握手才能送出任何封包——可用擷取一秒確認。

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
| 標頭 | `0xD3 ^ HIWORD(state)`，取「推進前」的狀態 | `sub_4A2030`（先寫標頭再推進）|
| 推進時機 | **每個封包一次**（不是每個 byte）| `sub_4A2030`、`sub_4A1B90` 呼叫端 |

> 驗證自檢：因為標頭由狀態推導，**用錯種子會立刻在標頭出現不符**，不會靜默產生看似合理的亂碼。
> 實作把這點變成硬檢查（`SessionDeframer.headerOk`、`decode` 的 exit code）。

## 4. 封包分派（dispatch）✅ 已定位

**已證實**：opcode 是**本文第 0 個 byte**，由 `sub_43B170` 讀取後分派（**不是** jump table，也不是 if-chain）。

```c
// sub_43B170(this = CClientSocket, packet)
opcode = packet->bytes[0];
switch (opcode) {
  case 0x07: sub_43B400(...);  break;   // byte1 == 0 → _TI3_AVCDisconnectException__；否則配置 0x18 bytes 物件（sub_4772F0 + sub_4C3460）後讀 u32、u16
  case 0x08: sub_43B280(...);  break;   // 讀 u32 → 走 sub_43AD50 送出路徑
  case 0x0A ... 0x14:                   // 10..20
             sub_55A900(3000, opcode, packet); break;
  default:   (**(dword_5C212C + 8))(dword_5C212C + 8, opcode, packet);   // 萬用 handler 物件
}
```

- 呼叫端：`sub_43AFA0`（收包迴圈）→ `sub_43B170`。
- 「無大型靜態 handler 表」為**已排除**的線索：86 個 `jpt_` 中最多的 `jpt_56FB8B`（46 目標）屬於
  `sub_56FA9D`（韓文 Hangul 0x4003–0x400D 的 COM/BSTR 轉換），與封包無關；「小整數 cmp 數量」啟發法的
  最高分者 `sub_4F9AD0` 是 UI tooltip。這些都不必再試。

## 5. 字元編碼

- 遊戲內字串（WZ）用 **ASCII / UTF-16LE + 位置遮罩**（見 `docs/WZ1_FORMAT.md` §3）。
- 網路訊息中的字串編碼、長度前綴**尚未證實**（原 client 支援韓文 IME，字串很可能是長度前綴 + 位元組序列）→ `UNKNOWN`。
  §6 待辦 2 的擷取會一併解出。

## 6. 待辦（依重要性）

1. **211-byte 握手的 `body`（199 bytes）要放什麼**：擷取原 client 對真實伺服器的請求，或反推
   `sub_418610` 呼叫端對 `body` 的期待。🟡 待辦 1 之前先確認方向（§2 HYPOTHESIS）。
2. opcode 語意：`0x07`（斷線/例外路徑）、`0x08`（送出路徑）、`0x0A–0x14`（`sub_55A900`）各自讀取的欄位，
   以及 `dword_5C212C` 指向的萬用 handler 表。
3. 由分派與擷取反推 opcode 常數表 → 產生 `protocol/schema/`。
4. 反推字串編碼規則並補測試向量。
5. 🟡 未解的驗證項：`sub_43AFA0` 中的 `-212` 標頭字檢查（`header - 212` / 與 `0xD3` 的關係）語意。

## 7. 擷取工作流（ADR-004）

```bash
# 1. 接住原 client（預設 session 模式：等 211-byte 握手取種子，之後即時解密）
node server/src/cli.ts capture --port 8484 --out traces/login.jsonl

# 2. 把 JSONL 重播成可讀封包（種子可自動取自握手）
node server/src/cli.ts decode traces/login.jsonl
node server/src/cli.ts decode traces/login.jsonl --recv-seed 0x11223344 --json
```

- trace 的 `hex` 一律是**線上的原始 bytes**（證據），`plainHex` 才是解密的本文。
- 任何無法解碼的 chunk 只會被標記一次，之後該連線改為 raw dump——外部探測（如 sandbox 的 HTTP probe）
  不會汙染 trace。
- `decode` 會逐包檢查標頭並以非零 exit code 回報不符：**用錯種子的假成功會被抓出來**。
