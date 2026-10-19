# 原版角色右鍵／人氣／派對邀請完整接收鏈

更新：2026-10-19；ADR-089。**後續 ADR-090**：原社交指令鏈（`/파티정보` 等）、名冊固定六格、
邀请确认所有权与权威 registry 悬空邀请修正见 [NATIVE_SOCIAL_COMMANDS](NATIVE_SOCIAL_COMMANDS.md)；
本页下方数字是 ADR-089 当轮记录，不代表最新状态。以本庫 `MapleStory.exe`、C、listing、`Data.wz` 為準；不補後版規則。
此輪完成的是同圖玩家互動入口及相連協定／呈現／輸入生命週期，不是完整人物資訊、交易房、派對經驗或全遊戲驗收。

## 1. 先更正原證與缺口

舊 `protocol/fame.ts` 與 FINDINGS §4.38 把 `5478F0` 當成人物選單。直接回看 C／listing：

| 原函式／位置 | 實際意義與實作 |
|---|---|
| `5478F0`（C 約332259） | CWndMan 游標座標轉換，不是選單。`5128B0` 分別用它取世界／畫面座標 |
| `5128B0`（C 約278247） | 真正玩家選單建立／動作分派；`55D7B0` 兩個 call 在 C278432／278435 |
| `51D6C0 → 5085E0(a3=1)` | 按 pool 順序取首個命中；兩個位置各加 `[-22,-65,22,0)` 再做 **UnionRect**，不是圖檔 bounds／alpha，也不是兩個獨立 rect 的 OR |
| `52E050`／`52F0B0` | CUIContextMenu 四個 canvas、項目、89px 寬、3px 頂／15px 列／18px 底；每列命中 `[12,85)×[4+15i,17+15i)` |
| `52E780`／`52E670`／`52E6F0` | 分片繪圖、黏住先前 hover、滑鼠捕獲／放開與外部取消；不是 CCtrlButton，不加按鈕音效 |
| `55D7B0`／`51D7D0` | 同圖名字（`lstrcmpiA`）先查，再檢查 signed DWORD elapsed `<300000`；**送出時**記時間，即使其後被拒也不退還 |
| `558FD0` | 建立 field UI 時把 app+684 設成 `timeGetTime()-300000`，所以首次可送。此輪 clock 隨 Session 重設，不因一般地圖快照重設 |
| `55C390` | 人氣回覆0／5的名字與方向、1安靜、2／3／4拒絕、其他 generic error；文字全部 font6 |
| `55C5E0` | 派對邀請 modal、102-byte 名冊、建立／自己或他人加入／退隊／被踢／解散與拒絕；文字 font6 |

C 名稱註解常只印出 `UI`；PE VA **5BE89C** 的完整 UTF16 是 `UI/UIWindow.img/ContextMenu`。
實際四片素材都存在，`ArtReader.at` 只取 canvas，不能用父目錄回 `undefined` 宣稱缺素材：

| 子 canvas | width×height | origin | 原 Copy 繪點 |
|---|---|---|---|
| `0` | 81×3 | -8,0 | x+8,y |
| `1` | 81×15 | -8,0 | 名字列 x+8,y+3 |
| `2` | 81×15 | -8,0 | 普通列 x+8,y+3+15i |
| `3` | 89×18 | 0,0 | 最後列／底 x,y+3+15(n-1) |

6列為 **89×96**；隊長多「파티초대」為 **89×111**。名字／普通／停用字色依 `527720(0/1/2)`：
Gulim12 白／黑／404040；選中列73×13上疊 `80000000`，再畫白字。文字位置 `(13,5+15i)`。
這是原圖與尺寸／顏色證據，不是 browser Gulim fallback 與 Win32 GDI 逐像素等價證明。

原列順序：名字、`개인정보`、`인기도 +`、`인기도 -`、`귓속말`、`교환신청`，僅自身為名冊首位隊長再加 `파티초대`。
`개인정보` 的 n2=0 在 `sub_5128B0` 的選擇 switch **沒有 case 0**＝原版死項（browser 保持停用即忠實）。
真正的 `0x14` 是**雙擊玩家**鏈（`sub_4697A0` msg 515＝WM_LBUTTONDBLCLK→`sub_512700`→`[u32 obj+72]`，
ADR-097），且本版 s2c `0x14` 無消費者（`sub_55A900` switch 只有 case 11..19）——原版個人情報恆靜默。
browser 已接通：canvas 雙擊玩家→`{t:'player-info',name}`→`session.playerInfo(name)`（同圖解析名字、
查無不送）→c2s `0x14`；伺服器只記 log 不回包（忠實靜默）。native 雙擊無類型過濾（NPC/mob 也會送
自身 +72），非 CUser 的 +72 語意未證——browser 只對玩家送，🟡 記錄為已知差異。
交易 id4 的送出鏈（`sub_471A40`→0x25）與 browser 交易房已完成——見 NATIVE_TRADE 與
ADR-091/094/096（窗體、log 畫家 `sub_4D5730`、捲軸 auto-repeat、goExchange 閘門）；選單外觀
本身從不是交易完成的依據。

## 2. 已接通的產品鏈

### 2.1 同圖右鍵選單與密語

- `client/player-menu-data.ts`：原列／幾何、UnionRect、party leader 投影。
- `client/player-menu.ts`：真 WZ 繪圖；DOM 僅提供透明命中／語意與鍵盤焦點。無假底圖、無額外背包按鈕。
- `main.js` 用既有 lens／camera 的 `screenToWorld` 反投影，保留每個 remote actor 上一個呈現位置，按 user pool 迭代取首個命中；不挑最近的人、不依圖片尺寸放大。
- UI 座標仍固定800×600；原視窗／小地圖／HUD 覆蓋處不從背面打開選單。拉近／拉遠不改世界命中尺寸。
- 密語選擇直接走既有 `whisperNameError`、收件者／最後收件者與聊天輸入焦點；選擇本身不送假訊息。真正輸入後沿既有0x23／0x1A與冷卻／回覆鏈送出。

### 2.2 人氣

`右鍵 → fameUp/fameDown → /ws {t:'fame',name,up:boolean} → ClientSession.giveFame → 0x20 → 既有權威 GameEntryServer → 0x12／0x0D → ClientSession → clientEventJson → fameMessage／能力值`。

- 選單不持有可過期的可操作 id：Session 先以當前同圖名字找 target，再保留冷卻；查無目標印原文 font6、不送封包。
- `FameRequestClock` 保留 `(now-last)|0` 與 DWORD wrap，不改成牆鐘／普通 deadline。300000ms整點可再送；伺服器拒絕照樣耗掉本機冷卻。
- codec 保留其既有 **CP949 byte-string** 名字契約，與 CharacterStats／party table 一致；只在 Session 對外事件邊界解一次為 Unicode，不破壞既有原生 server 的 byte-string 編碼。
- 未知 type6..255 現在走原 generic error，不再把它當壞封包丟到 `unknown`。未知只消耗 type；0／5缺字串或方向仍是 malformed，不假裝成功。
- type1完全安靜；type5第二名字取本機 SelfView，不多讀一個 wire string。`0x0D` 仍是能力值權威，不依文字自行加減人氣。
- **Lv15、UTC 日／月、先月後日、u16夾限及 ledger 不入 save 均保留為既有 repo 政策**。此輪沒有改配額、獎勵、等級或 save 格式；原 server 的真實公式／持久性仍未知。

### 2.3 派對邀請及回覆生命週期

- 只在 partyId非0且名冊第一人是本機角色時顯示邀請列。名冊跟 Session 一樣跨圖保留，登出／新登入／斷線才清。
- 選擇後經 `/ws party-invite → partyCommand('invite') → 0x26/type3`，仍重新查當前同圖 user；不借跨圖名字清單送舊 id。同圖查找51D7D0是`lstrcmpiA`，但踢人名冊55DB00是`strcmp`，兩者不混成同一種比對。
- `0x10` 的 inviter、joined／left 名字與102-byte名冊都在 Session 邊界做 CP949 解碼；不只修選單標題，亦修邀請確認與後續 roster／kick 查找的韓文名字。
- 邀請文字用原 CRLF、既有 Yes/No 原素材 modal；每個接受／拒絕 JSON **帶顯示的 inviterId**。Session 只回應當前 pending 的同一 id；拒絕只清本機 pending，不編一個原協定不存在的拒絕包。
- 原 client 在邀請 modal 內阻塞處理；browser 不阻塞世界／網路。畫面採明示 **first-inviter-wins、後到 offer不排隊** 政策，避免第二人換掉第一個確認窗。
- **連 server 一起修**：既有重建 `GameEntryServer` 原先讀了請求inviterId卻只按當前pending入隊。`PartyRegistry.resolveInvite(targetId,inviterId)` 現在核對目標、確認的人、partyId、仍為隊長；`handlePartyRequest` 直接使用封包id呼叫它。新邀請仍按既有repo的latest-wins單槽政策覆蓋；舊確認因此可能已過期而回原generic拒絕，但絕不能改加入新隊伍，也不消耗最新offer。這不是宣稱找到了原官方server的儲存策略。
- map replacement、死亡與 close 都丟棄 pending；不匹配inviterId的舊回應不清目前pending；拒絕可在死亡時只清本機狀態。
- 原55C5E0所有已解種類都走精確原文 font6：自己／他人、退隊／被踢／隊長解散分開；invite是modal、sync安靜，不統一改成通用「파티」前綴。

## 3. 明示 browser 差異與守衛

1. 原 menu anchor 是 `(cursor.x,cursor.y-height)`；browser 在800×600內夾限，避免邊緣操作不可達。
2. 原 id0未處理與未完成交易房列保留韓文標籤，但**可見停用且有原因**，不是可點的假功能；原版這兩列並非如此停用。
3. 保留 native sticky hover；但 browser 放開必須落在可用列，停用／縫隙不可觸發之前停留的人氣選項。停用DOM button `pointer-events:none`，讓捕獲層能收到取消放開，不被 Chromium disabled control 吞掉。
4. 原圖／命中之外另有 browser 可及性：焦點、Tab／ShiftTab／上下／Home／End／Enter／Space／Escape；不把這些鍵盤政策說成已證明原 CUIContextMenu 的鍵盤迴圈。
5. 捕獲期間清方向／攻擊／拖曳並阻擋 gameplay input；按外面先關閉且不能穿透點擊。下一次真正 mousedown 會清已耗用 click 的 sentinel，避免因 DOM control 已移除、未產生 click 而吞掉下一次正常點擊。
6. focus離開、blur／pointercancel／hidden、modal／實驗面板、死亡／離場／field／斷線取消捕獲；資源晚完成受 generation 與當前角色／field／living守衛約束，不在新場景復活選單。素材沒載入不放一塊不可見可點區。
7. browser 活人／連線／物品操作／portal 等 gating 是既有安全政策，不是新推測人氣等級公式。選單不改物理步長、速度、鏡頭、掉落 fh 或角色資料。
8. 新 bridge 的 field JSON 明示 `playerMenu:true`，另以 `partyInviteIdentity` 區分原生server是否已具接受身份檢查。未證實時，隊長邀請列可見停用、收到邀請只本機拒絕，不彈可接受的假確認；bridge同時封鎖直接JSON及斜線指令的invite／accept。舊執行中 bridge 沒選單能力不顯示新入口。
9. 同程序 `serve --web-port` 以本次修正的GameEntryServer啟動時才明示身份能力；`attach-web` **固定false且沒有繞過參數**。不猜遠端版本、不把只修前端說成已修既有執行中server。

## 4. 不重啟既有世界的新入口

保留既有 native login **8516**／game **8517**／舊 web **8515**、原 process16d5aab4（child6719）。
該 memory-only 世界**已有使用者進度**，不稱它為空世界或恢復舊 save，也沒有重啟、替使用者登入／操作／改存檔。

新增獨立且可重現的橋接工具：

```bash
bun tools/attach-web.ts --port 8525 --login-port 8516 --game-port 8517 \
  --host 0.0.0.0 --data Data.wz
```

它只建立HTTP／WS listener，按使用者連線時才用真 ClientSession連既有TCP世界；不建立帳號／世界／ledger／save。
關閉此橋接只關閉其連線，不停止 native世界。port0僅供隔離測試；錯誤port、未知 `--save`／`--account` 會拒絕。

**本沙箱新版入口：** <https://8525-i9wpwmmdok1w5byfdl5xo.e2b.app/>

**舊入口仍保留：** <https://8515-i9wpwmmdok1w5byfdl5xo.e2b.app/>

既有測試帳號 `preview / preview`、`observer / observer`；請先關閉或登出同帳號舊分頁，再用新入口，免同時登入衝突。
這是**同一個既有記憶體世界**，不是另外清空的新世界。整個 native程序停止仍會失去 memory-only 進度。

限制不可藏：既有8517程序仍是修正前的重建server，不能在不重啟原世界下假稱已載入新身份檢查。
因此此**附接LIVE暫停派對invite／accept**，包含選單、確認、直接JSON與斜線指令；人氣／密語不受影響。
新來源的完整同程序serve已具安全派對鏈，並經隔離權威registry／協定／Session／元件回歸；本輪不替使用者重啟原世界。
獨立橋接也拿不到原 process 內部 `testTools`／`mobPresentation` callback；
新版入口不冒稱具有那些管理工具或私人怪物相位補充。需要既有體驗工具仍可回舊入口，由使用者操作；
完整同程序啟動的 `serve --web-port` 具有原 callbacks，但本輪為保住進度不重啟它。
原 native怪物／角色／傷害／聊天協定仍接既有世界，沒有用 browser 假資料取代。

人氣原 client 冷卻在**拒絕時也消耗五分鐘**；Lv15是本 repo server政策。要兩位真人同圖才能使用目標選單，
不替使用者自動登入第二人、改級或演示送人氣。驗證採下面離線 synthetic peer與元件，並非把缺測轉給玩家。

## 5. 驗證與仍未完成

工具鏈／依賴維持既有 exact pins，沒有新增依賴或關閉 strict／erasableSyntaxOnly。
比較基準採 **34f457d** 上輪同 HEAD 的完整結果（本輪未冒稱重跑舊 baseline）：
`1090 pass / 44 fail / 1134 tests / 129 files`，原記錄 `generated/native-messages/final-complete-tests.log`。

| 驗證 | 最終結果 |
|---|---|
| strict型別／Prettier／build／diff | 全部通過；未關strict、未增加依賴 |
| 同批focused | **42 pass / 0 fail**，9files，5.54s |
| 最終完整suite | **1110 pass / 44 fail**，1154tests／134files，338.13s；退出碼1，CI仍不綠 |
| failure multiset對上輪 | 44records／42unique完全一致，**新增0／移除0**，不是只比較總數 |
| 純import檢查 | 11modules，在fs／net／HTTP／fetch／Bun.serve／window／document hooks下0應用啟動I/O |
| 附接LIVE唯讀 | title frame12、errors[]、0WS；97支TS均200、preview Host200；原6719程序保留 |
| Markdown相對連結 | 456個標準inline相對連結、0斷鏈（只查檔案路徑，不冒稱驗證每個anchor） |

最後穩定來源完整記錄：`generated/player-menu/final-authoritative-tests.log`；精確比較
`generated/player-menu/final-failure-comparison.json`；focused `focused-final.log`、
`import-safety.json`、`title-frame-final.log`、`live-modules.json`、`doc-links.json` 均在同目錄。
這些ignored診斷不是交付必需資產。較早 `full-tests.log` 是preliminary；
`final-complete-tests.log`／`final-current-tests.log`／`final-verified-tests.log` 為調整期間中止的run，**不得當最終完整結果**。

可重跑：

```bash
bun run typecheck
bun run format:check
bun run build
bun test --timeout 30000 server/test/player-menu*.test.ts server/test/fame.test.ts \
  server/test/party.test.ts server/test/native-feedback-evidence.test.ts \
  server/test/native-feedback-session.test.ts tools/tests/attach-web.test.ts
bun run test
# 唯讀title，明示入口；不附--allow-state-changes、不登入
bun server/scripts/frame_probe.ts 8525
```

新增回歸涵蓋原PE字串／全4片WZ與真origin、原幾何／UnionRect、所有人氣回覆／未知／malformed、
signed wrap／精確冷卻邊界、加密coalesced synthetic peer＋實際JSON／0x0D、同圖失效與map／death、
邀請identity／first-wins／decline不送包／韓文名冊、權威registry阻止舊確認被新邀請轉向、未證實原生端capability的bridge／UI fail-closed、Chromium DPR1/2真PNG／實DOM／canvas狀態恢復／
半透明選取／滑鼠穿透與下一click／鍵盤／停用／focusout／stale warm，以及附接bridge不碰原生listener。
Synthetic peer不是 LoginServer／GameEntryServer，不建帳號，不操作真人角色；browser元件只允同origin GET、0WS。

仍未完成：交易房／Messenger／完整人物資訊入口、party UI總體／組隊EXP／歸屬、原 server配額持久與其他未知公式、
原 CWndMan全域z-order／GDI／重疊pool順序的原client執行期對照、主入口完整TS遷移與既有44個測試失敗。
不要把本輪鏈路完成寫成整個遊戲等價或CI全綠。
