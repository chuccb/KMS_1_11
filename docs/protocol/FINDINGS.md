# 協定調查筆記（KMS 1.11, 2003）

> 規則：**每條都要有證據位址**。未證實者標 `HYPOTHESIS`，不得當規格使用。
> 證據優先序：原始 binary > IDA LST > Hex-Rays C > 實機擷取 > 外部資料。

---

## 1. 傳輸層 ✅

| 項目 | 內容 | 證據 |
|---|---|---|
| 傳輸 | Winsock TCP（`WS2_32`、`recv`/`send`）| `MapleStory.exe` import table；`MapleStory.exe.c` `sub_43A410`、`sub_43A9B0`、`sub_43ADB0` |
| 非阻塞 | `recv` 回 −1 且 `WSAGetLastError() == 10035`（WSAEWOULDBLOCK）時 `Sleep(100ms)`，最多重試 100 次 | `sub_43A410`（`n100 = 100`）|
| 接收緩衝 | 每次接收緩衝 **1460** bytes（= MTU）| `sub_43C3F0(..., 1460, ...)` 於 `sub_43A410` |
| 收包模型 | 收到後包成 `ZSocketBuffer` 並串進 socket 的 buffer 鏈 | `sub_43A9B0`（`*v10 = &ZSocketBuffer::vftable`）、`sub_43B6B0` |
| 送包模型 | 送出佇列（`ZSocketBuffer` 鏈），部分送出時把剩餘 bytes 重新排隊 | `sub_43ADB0`（`send()` 後比較 `v5 == v8`）|
| 類別 | `CClientSocket`、`ZSocket`、`ZSocketThread`、`ZSocketBuffer`、`ZPort`/`ZPortThread` | RTTI（`analysis/rtti_raw.txt`）|

## 2. 封包框架（framing）✅ / 🟡

**已證實**（`MapleStory.exe.c sub_43A410`）：

```
recv 2 bytes → u16 LE  v16 = *v15            // 這個 u16 是「總長度」
if (u16 > 緩衝上限 1460) → 中斷連線
再 recv 直到「緩衝內位元組數 == v16」
```
即：**前 2 bytes 為整個封包的總長度，且長度包含這 2 bytes 本身**（buffer 從 `v15` 起算，收滿 `v16` bytes 為止）。
> ✅ 已證實的是「u16 LE 長度前綴 + 1460 上限」；🟡 「長度是否含自身」由 `v17 - v15 == v16` 推得（強證據，但建議以實機擷取再確認）。

**同一函式接著解析的內容**（這是一段特定握手，總長必須剛好 `0xD3` = 211）：

```
u16 totalLen                     // == 211，否則：
    > 211 → CxxThrowException(_TI3_AVCPatchException__)     // 需要更新（PATCH）
    < 211 → CxxThrowException(_TI3_AVCTerminateException__)  // 終止
u16 payloadLen                   // p_count = v15 + 1（= byte offset 2）
u8[payloadLen] payload           // sub_418610(&v56, p_count + 2, payloadLen)
u32                              // → *(this + 120)
u32                              // → *(this + 124)
```
> 解讀：這是**登入/版本檢查握手**。長度必須等於 211 是這支 handler 的契約；`CPatchException` / `CTerminateException`
> 的存在意味著「版本不符 → 走更新流程」。`payload`、兩個 `u32` 的語意 = **UNKNOWN**（待擷取比對）。

**🟡 HYPOTHESIS**：其餘封包（`ZSocketBuffer` 鏈的消費端）可能採相同框架；**必須以擷取驗證**，
在驗證前 codec 一律以「可切換 framing 策略」實作，不得寫死。

## 3. 封包分派（dispatch）🟡 尚未定位

已排除／未找到的線索：
- ❌ **不是** 大型靜態 jump table：`MapleStory.exe.lst` 共 86 個 `jpt_` 區塊，最大僅 46 個目標，
  且最大的 `jpt_56FB8B` 屬於 `sub_56FA9D`（**韓文 Hangul 相容字素 0x4003–0x400D 的 COM/BSTR 字串轉換**，非封包）。
- ❌ 以「函式內小整數比較數量」找 if-chain 的啟發法，最高分者 `sub_4F9AD0` 其實是 **UI tooltip**（HP/MP/EXP 文字）。
- 🟡 推測為**稀疏 case 的二元搜尋式 if-chain**（編譯器對稀疏 case 不產生 jump table）或**執行期建立的 handler 表**。

**下一步（依序）**：
1. 追 `sub_43B6B0`（把 `ZSocketBuffer` 接入鏈）的**消費端**：誰從鏈上取資料、讀出第一個 `u16` 作為 opcode。
2. 在 `MapleStory.exe.lst` 搜尋 `ZSocketBuffer` vftable 的 xref（`off_` 常數）。
3. 找 `CClientSocket` 物件的欄位寫入點（`+120`/`+124` 已被上述握手寫入）→ 反推其他 handler。
4. 以 `server` 的 `capture` 模式接住原 client，取得**真實 opcode 序列**（最有效，見 ADR-004）。

## 4. 已知的訊息語意（暫定，待擷取補完）

| 名稱 | 方向 | 內容 | 狀態 |
|---|---|---|---|
| CheckVersion / handshake | S→C | 總長 211，含 `payloadLen` + payload + 2×`u32` | ✅ 結構；🟡 語意 |
| Patch 判定 | — | 長度 > 211 觸發 `CPatchException` | ✅ |
| 連線終止 | — | 長度 < 211 觸發 `CTerminateException` | ✅ |

## 5. 字元編碼

- 遊戲內字串（WZ）用 **ASCII / UTF-16LE + 位置遮罩**（見 `docs/WZ1_FORMAT.md` §3）。
- 網路訊息中的字串編碼、長度前綴**尚未證實**（原 client 支援韓文 IME，字串很可能是長度前綴 + 位元組序列）→ `UNKNOWN`。

## 6. 待辦（依重要性）

1. 用 `capture` 伺服器取得真實登入序列（含 211-byte 握手與後續 opcode）。
2. 定位 dispatch（§3 四步）。
3. 由 dispatch 反推 opcode 常數表 → 產生 `protocol/schema/`。
4. 反推字串編碼規則並補測試向量。
