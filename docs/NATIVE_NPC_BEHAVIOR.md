> **續作／未測試**：[NATIVE_MOB_KB_NPC_STATE](NATIVE_MOB_KB_NPC_STATE.md)／ADR-075：真KB路徑取代巡邏、hit action與門檻／互斥／時鐘，NPC完整方向byte／forced flip、當前canvas氣泡錨點與冷載名牌可見性。本文舊限制依該續作閱讀。

# 原 NPC 待機、氣泡、控制指定與封包生命週期

日期：2026-10-18 ｜ ADR-062 ｜ **已編輯實作／回歸來源，未執行驗證**。

依使用者要求，本輪沒有執行 test/check/typecheck、語法檢查、瀏覽器、VM、HTTP／登入 probe。
讀 EXE C／listing／WZ 是來源研究；啟動 LIVE 不是功能 PASS。

## 這輪一起接上的部分

- `NpcBehavior`：自身 `info.speak`、有序 extra-action 名字／各自 speak、move-property 存在旗標。
  metadata-only 讀取不解碼 PNG。不是從 action 圖片檔案數猜池的長度。
- 分開 **40C020 的動作美術合併** 與 **49CBF0 的行為資料**：前者可保留 own-only 動作；後者遇到 link 後，
  只列舉**一跳連結根目錄**，保留自身 info。不能把 own-only 圖也加進待機抽選索引。
- 補 c2s `0x2F`／s2c `0x3D` id、兩個 **signed byte** codec。`0xFF` 是 −1，不是 255。
  move 存在的模板才有 CMovePath；不動模板固定7 bytes，移動模板為7+5+14×count。
- `0x3B` 進 session／JSON／browser，不再當 unknown。更正過去「走路開關」的說法：這是本 client 的控制指定，
  靜止 NPC 自言自語也需要。client pool 保留 visibility/control 兩個 bit，兩者皆清才移除。
- Field 每 NPC 一位 controller，不對所有進圖玩家都送 on；離開／斷線後交給留下的成員。
  NPC 移除先撤控制再撤 visibility；`spawnAll()` 冪等，不能重複生同一批 NPC。
- Browser controller 使用獨立 presentation MSVCRT 型 rand（不消耗角色戰鬥 RNG），依30ms量化倒數與
  `rand()%8000+4000`、extra/speak 等權槽抽選。有 forced action／氣泡／in-flight 時不另送。
- **所有接收者包含 controller 都等真正 `0x3D` 回包才演出**，不是各分頁隨機亂播。
- NPC frame 逐格用 `ceil(delay/30)*30`，丟棄每格倒數 overshoot。forced action 單次結束回 base，
  不再所有 NPC 永遠只 loop stand，也不把強制表情做永久循環。缺省180ms沿用 ADR-061。
- 原 normal 九片／arrow 氣泡、5000ms、alpha224、root z250210；NPC 字色 **FF800000**，玩家聊天仍為黑。
  以當下 action canvas0 的 **height** 為錨，不是 dc 點擊框；五秒氣泡期間名牌 alpha0，結束恢復黃名牌。
- metadata 慢到時只套還有效的回包；field/login/disconnect/leave 清理 NPC action、氣泡、in-flight、pending。
  過期 art fetch 不回寫新場地 cache。冷讀 queue 上限16是 browser 防護，不是原 client 規則。
- CMovePath 依模板解碼／驗長／轉送，browser 可用既有 remote path sampler 被動接收；`499B70` 的 NPC base
  是 `(movementAction >> 1) == 2 ? move : stand`，不能用 mob 或 user 的表。
  **尚未實作 browser CVecCtrlNpc 自主走路／5398B0 路徑生成**。
- 體驗工具新增純讀 NPC 狀態（控制者、目前動作、等待回包、氣泡、最後 signed 索引）；不加 fake-force 按鈕。

## 原碼／listing／WZ 對照

| 來源 | 交叉確認 | 對應 |
|---|---|---|
| `49C570 -> 49CBF0`，`.lst` 293811起 | own info；一跳 link 替換列舉根；move存在寫 template+8；info.speak及extras | `game/sprites.ts` npcBehaviorOf |
| `40C020`／`40C730` | 動作圖 link merge不同；forced>=2取extra[action−2]，缺省180 | npcNodesOf／npcArtOf |
| `499760` | on清inflight、初設4–12秒timer；off清controller | session/controller |
| `499D60`，`.lst` 288500起 | 控制者才倒數／送出、每tick30ms、forced末格還原、bubble期間name color00FFFFFF | npcPresentation |
| `49A0C0`，`.lst` 288883起；`49A168/49A183` | 先roll timer，再roll extra+speak槽；extra索引+2寫出 | chooseNpcIdle |
| `49A3C0`，`.lst` 289268起 | opcode47=0x2F、npcId、兩byte；move才追加495880路徑 | protocol/npc.ts |
| `49A280`，`.lst` 289123起；`49A2C2/49A2E8` | 兩處movsx；raw guard、raw speech；不論索引有效與否，move才4967C0；最後清inflight | receiveNpcIdle／codec |
| `49F6C0/49F810/49F260/49F380` | pool visibility/control bit；已知0x3B六bytes、未知on完整形狀21bytes | ClientSession |
| `499C00 -> 4373A0`，`.lst` 106864 `mov esi,FF800000` | 5000、normal style0、font mode1深紅，非動作動畫長度 | chatBalloons獨立NPC實例 |
| `433F50`（layer vtable264 get_canvas）、`4373A0`（canvas vtable132 height）、`4386E0` | canvas0高度，y=offsetY-height-5 | originY／draw |
| `499B70` | 低位方向、movement action>>1==2對應move | passive base stance |
| `Npc/0002003.img` | Robin：四筆info.speak；root順序info/stand/finger/wink/heart | 原待機池，不是quest腳本 |
| `Map/Map/000040000.img/life` | Robin template0002003、(69,275)、fh28；圖內亦有怪 | 現有40000捷徑 |

## 必須明說的索引差異：沒有擅自修正

原 listing 同時存在：

1. sender `49A0C0`：抽 extra `i`，送 action=`i+2`；speech 從 **extra[i].speak** 抽。
2. receiver `49A280`：要求 **raw action < extraCount**，forced=raw；speech 從 **extra[raw].speak** 取。
3. art `40C730`：forced>=2 時卻從 **extra[raw−2]** 取動作名字。

不是 C 反編譯把 signed char 誤讀：listing 有 movsx、+2、raw guard／raw stride8，已逐段回查。
目前沒有2003年伺服器原碼／對應封包 capture，**不能確認原伺服器是否重寫／原版是否也帶此 quirk**。
本輪沒有把 raw guard 改成 raw−2、沒有把 action.speak 偷換到 art 的索引，也沒刪兩個池項來硬湊。

### 現行伺服器重建政策（不是已考證的2003伺服器）

- 每個可用 NPC 由最早仍在此圖的成員控制；保留已有控制者，不因新玩家進場搶走。
- 靜止 archive-backed NPC 預設可控。movable／無metadata NPC 仍需 legacy `--npc-walk` 明示 opt-in；
  `walking`／`setWalking` 只是相容舊 API 名稱，**不是實際走動狀態**。
- 驗證控制權、當前場地NPC、**sender** 槽範圍、signed整數、模板是否應有path及尾端無多餘資料；
  支援sender索引轉byte後的負值wrap，不讓合法request永久等不到ack。
- 原樣透明轉送 action/speech/path，包含回給sender；每NPC250ms反洪水界線是重建防護，不是原協定常數。
- Web sender另帶mapId到bridge，防舊場地延遲請求；mapId **不寫進0x2F**。

**後果**：抽到某些 extra raw 超出原 receiver guard 時，這次不播表情；某些 art／speech 不同池項。
例如Robin有三個extra，sender2/3/4中，原receiver僅接受2，art是finger，而speech取heart池。
這不是「所有NPC額外表情已完全還原」；是把可證實的client兩端都實作、保留差異、公開server policy。

## 方便入口，不改玩家進度

登入後：**體驗工具（非原版）→「獵場／NPC Robin ·40000」**，只沿用明示的地圖命令，不換裝、不補血、不改能力。
Robin位於(69,275)，不點擊也會參與待機抽選；不保證第一次或每次抽到氣泡，4–12秒是**抽選間隔**。
圖內有怪，不提供自動無敵。唯讀NPC狀態不發送強制演出封包、不寫存檔。
正常點擊開CUtilDlgEx2仍是 ADR-061 本地say政策；`info.quest=begin5`原腳本尚未恢復。

## 還沒有完成／沒有驗證

- 原server的索引轉換、controller挑選／距離／再分配規則未知；不能把上述政策稱為原版server。
- 自主NPC走路、CVecCtrlNpc path generation／smoothing／全域30ms app調度未完成；現有sampler非完整原CVecCtrl。
- Browser字型fallback非原GDI Gulim metrics，氣泡換行仍沿用現有browser wrapper，不聲稱逐像素相同。
- 本輪沒有新增原quest腳本、任務獎勵、技能施放、cash/pet或交易UI。
- 新 `native-npc-behavior.test.ts` 及舊npc/world/field/webclient/cursor fixtures **只寫來源，全部未執行**。
- 未執行任何功能測試／check／typecheck／語法檢查／browser／VM／HTTP／登入probe；舊PASS不適用。

## 保存／LIVE

沿用 `generated/preview-death-20261018.json`；結束先停止舊服務，冷備當下同檔，再以同檔啟動。
不seed、不覆回任何歷史備份、不重設玩家角色或進度。實際備份與服務啟動結果附於交付紀錄；啟服不等於功能PASS。

### 本輪實際保存／啟動紀錄

- 停止舊服務 `kms-1-11-ca0f1379` 後，複製當下正在使用的同一份存檔。
- 冷備：`generated/backups/preview-death-before-native-npc-behavior-20261018-013648.json`。
- 主檔／冷備 SHA256 同為 `82e0f6e37c43abb4588b14a9a9a69b1d5aa13f8704ddaf61096b10d9c0fdd616`。
- 新 LIVE：`kms-1-11-npc-89d1781b`／PID15721；web8515、login8516、game8517，全部bind 0.0.0.0。
- 同 save 載入2帳號／1角色；`preview/preview`、`demo/demo`；map-command及test-tools仍限定preview,demo。
- 只啟動服務，沒有額外執行測試、HTTP／登入／browser probe；沒有seed、回復舊備份或自動改角色。
