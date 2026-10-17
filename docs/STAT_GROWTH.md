# 原版 HP／MP 成長、六種 AP 加點與隔離預覽

2026-10-17。**本輪未執行測試、typecheck、瀏覽器或 probe**；依使用者要求只做原版來源研究、實作與靜態審閱，最後啟動服務供使用者自行操作。新增／更新的測試檔只是回歸來源，不是 PASS 紀錄。

## 1. 更正先前的反編譯誤讀

先前 `exp.ts`、FINDINGS §4.21.3／§4.21.6 與 ADR-009 把 `sub_4C7450` 說成傷害範圍計算、把 `1000001` 說成武器、把 `dword_5BB344` 說成熟練度表，**這些判讀是錯的**。

本輪重新讀完整函式，並從原 `MapleStory.exe` 的 PE section 對映讀取 **VA 0x5BB344 的 60 個 signed DWORD**，與 `.c` initializer 一致：它是 HP／MP 成長表；1000001／2000001 是技能。未修改 exe 或 Data.wz。

- `sub_4C7450(record, basicStat, mask, natural)`：職業組 `floor(job / 100)`，大於 4 不成長；row = `2 * group + (natural == 0)`。
- 每 row 六欄 `[HPmin, HPmax, unused, MPmin, MPmax, INTcoefficient]`；第三欄在本函式沒有使用。
- HP 增量 = `HPmin + rand() % (HPmax - HPmin + 1)`。
- MP 增量 = `MPmin + rand() % (MPmax - MPmin + 1) + trunc(INT * coefficient / 200)`。
- 對應 mask 是 **HP 0x800／MP 0x2000**，不是傷害範圍。

| 職業組 | 自然升級 HP | 自然升級 MP | AP→HP | AP→MP |
|---|---|---|---|---|
| 0（初心者） | 20..25 | 10..12 + trunc(INT×20/200) | 15..20 | 6..8 + trunc(INT×15/200) |
| 1（戰士） | 40..45 | 4..6 + trunc(INT×20/200) | 35..40 | 2..4 + trunc(INT×15/200) |
| 2（法師） | 10..15 | 22..24 + trunc(INT×20/200) | 5..10 | 18..20 + trunc(INT×15/200) |
| 3（弓手） | 20..25 | 10..12 + trunc(INT×20/200) | 15..20 | 6..8 + trunc(INT×15/200) |
| 4（盜賊） | 20..25 | 10..12 + trunc(INT×20/200) | 15..20 | 6..8 + trunc(INT×15/200) |

HP 原最大值小於 **30000** 才寫入，結果夾 **50..30000**；MP 小於 **10000** 才寫入，結果夾 **5..10000**。它改的是角色紀錄的 maxima，不是裝備加成後的完整能力面板。

`sub_4C71C0` 在等級增加後呼叫 `(record, basicStat, 0x2800, 1)`，然後僅在 `hp > 0` 時補滿新 HP／MP。這支 routine **在此 binary 沒有呼叫端**；採用其表在伺服器結算，是有來源的重建接線，不是原 server 的程式碼。

## 2. 被動技能與 INT 的真正來源

- `sub_45FCC0` 的 CharacterData flag **0x20** 把 u32/u32 寫到 `record+382` 的 ZMap；其 bucket pointer 在 `+386`。`sub_4C7450` 從同一張 map 查 1000001／2000001，故既有 `items.map32` 在這條路徑是 **skillId → learned level**，不是裝備。
- 技能 loader 把 WZ **x 放在 level struct +92，y 放在 +96**；每級 struct 120 bytes。自然成長取 x，AP 取 y；正數技能等級夾到載入級數上限。
- 真正讀取 `Skill/100.img/skill/1000001/level/<level>` 與 `Skill/200.img/skill/2000001/level/<level>`，僅對已學技能加成，不假裝所有角色自帶滿級被動。
- **戰士技能 level 10 的 hs 寫 40／30，但數值 x=30、y=20**；必須按 loader 的數值，不能照說明文字或自行算 4×level／3×level。法師 level 10 為 x=20、y=10。
- `sub_4C5420` 把基礎 INT 與一般穿戴裝備的 INT 相加到 `BasicStat[10] ^ [11]`。成長 context 因此讀實際 worn 1..14 的 ItemSlot INT；不讀 cash 外觀、不讀包內裝備，也不拿 WZ 道具模板重複加值。裝備的 signed16 值依原語意還原。

目前仍沿用伺服器既有穿戴集合；原版會按需求依賴篩掉不合格裝備的完整鏈還沒移植。這次加入 INT 成長用途，**不代表完整裝備／buff totals 已完成**。

## 3. 端到端實作

- 新 `game/growth.ts` 共用自然／AP 成長、原表、WZ 被動快取與角色 context。
- `awardExp` 每跨一級計算一次 HP／MP；跨多級不只算最後一級。活人最後回滿、死人保留原當前值，不藉升級復活。已達 200 不再成長。
- 殺怪結算的 `0x0D` 包含實際變動的 level／exp／maxHp／maxMp／hp／mp，其他玩家仍只收原升級特效。**每次有效經驗結算立即保存**，包含延後投射物命中，不等退出才保存。
- 原 `0x1B + u32 mask` 加點支援 STR／DEX／INT／LUK／HP／MP 六項。只接受一個精確 mask，不把 OR 合併請求當多次加點。
- HP／MP 僅成功增加最大值後扣 1 AP；不免費補當前 HP／MP；到上限、死亡、AP 不足、損壞數值／未知職業等拒絕，不扣點。
- 沿用 500ms pending／服務端 rate gate，成功與拒絕都用 nonzero `0x0D ack` 解鎖；成功立即持久化。
- 瀏覽器原 Stat 的兩個 HP／MP AP 按鈕、WS bridge、TCP ClientSession、snapshot、cap disable 與可存取文字同步接通；仍由服務端決定增量，不樂觀改 UI。
- 不改存檔格式；map32 原有技能紀錄保留，不遷移／清掉其他存檔。

RNG 由伺服器產生 0..32767 整數再做 modulo；可注入來源以便日後回歸。不宣稱與原程式 MSVCRT PRNG 的隱藏種子／呼叫序列同步。連續跨級與伺服器權威加點亦屬重建接線。

## 4. 明確仍未完成

**自然升級發放 AP／SP 的數量仍未找到原版證據**。本函式沒有加 AP／SP，因此這次不偷偷套 5 AP／3 SP 或後期職業規則；`awardExp` 保留原 AP／SP。這與「HP／MP 成長沒有證據」是兩件事，不能再混寫。

技能學習／SP 操作 UI、職業轉職與其初次加成、完整主動技能／buff、Detail／完整裝備合計、原 CShape2D 碰撞與傷害仍未完成。兩個成長被動的既有紀錄可生效，不等於全套技能系統已完成。

## 5. 本次隔離預覽

按使用者選擇建立**全新隔離體驗存檔**，不恢復／冒充先前遺失的進度：

- 存檔：`generated/preview-growth-20261017.json`，位於工作區持久目錄，Git 忽略，不放 `/tmp`。
- `preview / preview`：新初心者 `Preview`，level 1、HP／MP 50、**額外 20 AP 只作沙箱體驗配置**，方便操作六種 AP。這不是原版創角或升級發放規則；無滿級被動、無舊進度。
- `demo / demo`：空的新帳號，可自行走原創角流程；正常新角色仍 AP=0。
- 僅這兩個隔離帳號開啟 `/map ID` 權限；`/map 40000` 可前往蝸牛區，`/help` 看既有操作。S 開 Stat；HP／MP AP 只改上限，當前值未補滿是刻意遵循原函式。
- 服務綁定 0.0.0.0；網頁使用同源 WS，不要求使用者瀏覽器連 localhost。

啟動命令（若已在執行不要重複啟動；重啟不刪存檔）：

```sh
cd server
node src/cli.ts serve --host 0.0.0.0 --port 8496 --game-port 8497 --web-port 8495 \
  --data ../Data.wz --save ../generated/preview-growth-20261017.json \
  --account preview:preview,demo:demo --map-command preview,demo --ping off
```

本輪只啟動服務並讀啟動日誌，未自動登入／按鍵／打怪／HTTP probe；實際遊玩由使用者自行確認。啟動成功不代表以上功能已通過執行驗證。

啟動紀錄：隔離檔成功載入 2 個帳號／1 個角色，web **8495**、login 8496、game 8497 均綁定 0.0.0.0；啟動工具未回報預覽阻擋警告。這只證明服務已開啟，不是登入或遊戲功能測試。
