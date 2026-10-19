# 原版社交指令鏈：/파티정보、名冊六格、指令安全與邀請所有權

更新：2026-10-19；ADR-090。證據一律取自本庫 `MapleStory.exe`（PE bytes）、`MapleStory.exe.c`、
`MapleStory.exe.lst` 與 `Data.wz`；未套用後期版本 MapleStory 規則。
本輪完成的是「原版已定位的社交指令與派對名冊／邀請生命週期」，不是完整 party 視窗、交易房、
Messenger、組隊經驗分配或全案驗收。

## 1. 先更正兩处旧判讀

| 舊判讀 | 直接回看原檔的結果 |
|---|---|
| 「GameMenu 的 Party 按鈕是尚未實作的組隊視窗」 | `sub_559E20`（CUIGameMenu 建立後的分派）只處理 index **3／4／5**：PE `00559EF5` 起 27 bytes 是 `mov eax,[ecx+98h]`／`sub eax,3`／`jz`／`dec eax`／`jz`／`dec eax`／`jnz loc_55A067`，其餘 index 直接落到 `loc_55A067`（收尾）。C 裡也只有 `case 3:`（CUIGameOpt）、`case 4:`（CUISysOpt）、`case 5:`（`sub_55D9F0` 結束連線）。`Data.wz` 的 `UI/UIWindow.img` 顶层属性有 `GameMenu`／`Trade`／`Messenger`，**沒有 `Party` 子树**。所以「派對按鈕沒有分支」是這版的原況，不是我們漏接的視窗；不能補一個後期樣式的 party 窗冒稱原版。 |
| 「`/헉추적` 是玩家找人的指令」 | `/헉추적` 在 `sub_470E10` 的 GM 闸門 `(*((_BYTE *)n3000 + 9) & 1) != 0` 之內。玩家版是 **`/찾기`**（PE `005B5FB8`），走 `sub_526070` 比對後呼叫 `sub_4717D0`（`0x23` kind `0x05`）。`/귓속말`（PE `005B5FC0`）用 `sub_526370` 拆兩段，並在送出前要求 `sub_524A00(&name, null, null) != 0`。 |

`/파티정보` 才是這版已定位的派對資訊入口：`sub_470E10` 比對 PE `005B5FA4` 後呼叫 `sub_55CC40`，
**不送任何封包**，只把名冊印進聊天（font6）：

- `*(CWvsApp+404) == 0` → 「가입한 파티가 없습니다」。
- 否則先組 `"파티원:"`（PE `005C0354`），再從 `+432` 起以 **13 bytes** 步進走 **六格**，
  每格前面接一個空白（`asc_5BE0C0`）後 append；空名字也照印，所以六人未滿時尾端就是空白。
- 之後若 `+408`（名冊第 0 格 id）`== +20`（本機角色 id）再印「당신은 파티장입니다.」（PE `005C033C`）。

## 2. 名冊是「六個固定格」，不是可壓縮清單

`sub_45F5C0` 是一次 `qmemcpy(dst, src, 0x66)`：`u32 id[6]`（`+408`）＋ `char name[6][13]`（`+432`）。
旧 `readPartyTable` 把「名字為空」的格子丟掉，这在 `type 5／10／13` 上会**改变语义**：

| 情况 | 压缩后的错误结果 |
|---|---|
| 服务器把队长放在第 1 格（第 0 格空） | 第 1 格被当成队长，本机误判自己不是／是队长 |
| `type 10` 带著仍含自己的旧名冊 | 用「名冊裡有没有我」推 partyId，会盖掉原本的归零规则 |
| round-trip | 解码后再编码不再是同一串 bytes |

现在 `readPartyTable` 一律回六格（含 `characterId: 0`／`name: ""`），`encodePartyTable` 不变，
`test/party.test.ts` 钉住「解码后重新编码 byte-exact」与全零格。`client/party-state.ts` 依 `55C5E0`
的實際語義保存 `partyId`：`created` 清名冊並把自己寫進第 0 格；`sync`／`joined` 直接採用封包
`partyId`（**不**用名冊推斷自己在不在裡面）；`left` 且發起人是自己時歸零；`ended` 只歸零
`partyId`、保留旧 bytes（原版就是这样，动作全部由 `partyId == 0` 擋住）。`PARTY_MAX_MEMBERS`
移到这里，由 `protocol/party.ts` 再匯出，避免 browser 模組在執行期匯入 server 目录
（既有「共用純規則放 client」的架构说明见 [ARCHITECTURE](ARCHITECTURE.md)）。

## 3. 原版送出前的本地检查，现在在 client 端就先挡

| 原函式 | 前置检查 | 本地印的字（font6，PE 位址） |
|---|---|---|
| `sub_471CD0` `/파티만들기` | `n3000[101] != 0`（已在隊伍） | 「이미 가입한 파티가 있습니다」`005B602C` 区 |
| `sub_471E90` `/파티탈퇴` | `n3000[101] == 0`（沒有隊伍） | 「가입한 파티가 없습니다」`005B60E0` |
| `sub_472050` `/파티초대 <name>` | `n3000[101] != 0 && n3000[102] == n3000[5]`（在隊伍且自己是名冊第 0 格） | 「파티의 방장이 아닙니다」；接著 `sub_51D7D0(CUserPool, name)` 找不到同圖玩家 → 「캐릭터를 찾을 수 없습니다」`005B6050` |
| `sub_4722E0` `/파티강퇴 <name>` | 同上队长闸門；`sub_55DB00(CWvsApp, name)` 在**自己名冊**找 | 「파티의 방장이 아닙니다」；找不到 → `"'%s'님은 파티의 멤버가 아닙니다."` |
| `sub_55CC40` `/파티정보` | `n3000[101]` | 见 §1 |

旧实作把这些情况当成 `throw`（bridge 回一般 error），既不是原文也没有本地即时反馈。现在
`ClientSession.partyCommand()` 先跑同一套检查，用新 `party-command` 事件回 `PartyCommandFeedback`，
browser 用 `partyCommandLines()` 印原文；`info` 在**死亡时仍可用**（原版只读状态，不需 living），
其余动作保留既有「living field session」的 browser 政策。**送出前不乐观改 partyId／名冊**：
只有原生 `0x10` 能改变成员关系。名字大小写沿用两条不同规则——邀请查同图池是 `lstrcmpiA`
（`51D7D0`），踢人查名冊是 `strcmp`（`55DB00`）。

## 4. 指令路由：斜线行绝不变成公开聊天

旧 bridge 的 `say()` 只认 `/party …` 与四条 `/파티*`；其余**任何**文字都直接 `session.say()`
变成 `0x12` 公开聊天。也就是说用 `{t:"say",text:"/귓속말 某 秘密"}` 打进来的私讯会被**公开广播**。
browser 自己的 `runCommand()` 会挡住未知斜线行，但 bridge JSON 边界没有。

现在两边共用 `server/src/net/chat-input.ts` 的 `routeChatInput()` 与 `client/social-commands.ts`
的 `parseSocialCommand()`：

- 原文 `/파티정보`、`/파티만들기`、`/파티탈퇴`、`/파티초대 <name>`、`/파티강퇴 <name>`、
  `/귓속말 <name> <text>`、`/찾기 <name>`；browser 别名 `/party info|create|leave|invite|kick|accept|decline`、
  `/w`、`/f`（别名是本页面的名字，不会当成原文送到原生 server）。
- `526070` 用的是**一个 ASCII 空白**做前缀切分，不是 `\s+`：`/파티초대\t名字` 不是该指令。
  `/귓속말` 用 `526370` 拆两段，**两段都非空**才送。
- `/귓속말` 在送出前套用原 `524A00` 名字闸門（4..12 CP949 bytes、ASCII 字母数字或 KS Hangul 双字节、
  `I`/`l` 合计少于四个、不能对自己）；原版失败时静默丢弃，这里回同一句韩文原因（repo 政策，
  browser 本来就印这句）。`/찾기` 原版没有这道闸門，故不额外加。
- `/교환` 原版有真实 `0x25` 送出链，但 browser 交易房未完成：**明确拒绝**并说明，不送假邀请。
- 参数错、未知、含换行／NUL 的斜线行一律拒绝，**不会**落到公开聊天；GM 专用 `/헉*` 也不在玩家路由内。
- `/map`、`/maps`、`/where`、`/help`、`/tools` 是本页面的操作者／体验工具命令，走既有 typed
  `warp-map` 与 server 授权，不经过这条社交路由，也没有被改成聊天 fallback。

`field` 事件的 projection 新增 `socialCommands` 标记：browser 只有在桥接来源确实带这条共用路由时
才送 `party-command`。**旧附接进程**（内存里是旧 `clientEventJson`）搭配磁盘上的新 browser 时，
标记缺席 → 界面明示不送，而不是丢一个旧 bridge 不认识的 message type。`partyInviteIdentity`
的语义不变：`tools/attach-web.ts` 仍固定 `false`，附接 LIVE 的邀请／接受继续停用。

## 5. 邀请确认的所有权与生命週期

`client/party-invitation.ts` 把确认窗从 `main.js` 内联逻辑抽出来，只拥有**这一张**确认，不接管共用
item dialog：

- 第一个 offer 拥有 modal；后来的 offer 不重定向、不排队（session 端 first-wins 仍然先挡）。
- 原生成员关系更新（真的入队）会关掉自己这张确认并**本地**回 decline；不发明原生拒绝 opcode。
- 按「是」时若场地／死亡／portal 上下文已换（`context()` 不再是同一 owner），降级为 decline，
  旧 callback 也不能回答新 offer、不能关别人的窗、不能送两次。
- 能力未证实（附接旧原生世界）时 fail-closed：回 decline 并印既有说明，既有世界不重启。

`ChatEntry`（`client/chat-entry.ts`）同样抽出编辑框生命週期：IME composition 的 Enter 不送、
Shift+Enter 保留焦点、Escape／空内容左右键退出编辑、blur 清 placeholder；**指令消费是同步的**，
所以被拒的私讯／派对指令不会在 await 之后又变成公开聊天。

## 6. 权威端（server）一併修的部分

`PartyRegistry` 是重建 server 的权威名冊，原本有三处会让状态指向不存在的队伍：

| 修正 | 原因 |
|---|---|
| `invite()` 改成回 `boolean`，先验「party 存在、inviter 是该 party 的现任队长、target 尚未入队」 | 旧版无条件写入 slot，可能记下指向已解散 party 或已入队玩家的邀请 |
| `create()` 清掉新队长的旧 pending 邀请 | 已在别队 slot 里的人建队后，旧邀请仍可被 resolve |
| 解散时把该 party 的**所有**待答邀请清掉（含离线目标） | `leave()` 只清离开者自己的 slot，其余成员的待答邀请会指向已删除的 partyId |
| `join()` 拒绝不属于 registry 的 `Party` 物件 | 旧版会把成员写进已解散的物件，`partyIdOf` 指向不存在的 party（悬空成员） |

`GameEntryServer` 在 registry 拒绝记录邀请时回 `0x10` type 0（「알 수 없는 오류…」），
符合「拒绝也要回一个答案」的既有规则。`resolveInvite(targetId, inviterId)`（ADR-089）不变：
wire 上的 inviterId 才是权威，旧确认只会失败，不会加入别的队，也不消耗新 offer；
`test/serve.test.ts` 现在明确钉住「inviterId 不符 → `unknown`，且真实 offer 未被消耗」。
单一 pending slot 的 latest-wins 仍是本 repo 政策，不是原官方 server 的已证算法。

## 7. 验证与界线

| 验证 | 结果 |
|---|---|
| strict 型別／Prettier／build／`git diff --check` | 全部通过；未关 strict／erasableSyntaxOnly，未新增依赖 |
| 本轮 focused（social／player-menu／party／fame／system-ui／feedback-browser／attach-web） | **69 pass / 0 fail**，13 files，13.08s；`generated/party-native/focused-final.log` |
| 完整 suite（冻结来源） | **1131 pass / 44 fail**，1175 tests／138 files／5315 expects，350.05s，退出码 1（CI 仍不绿）；`generated/party-native/final-authoritative-tests.log` |
| failure multiset 对 ADR-088 基准（1090/44） | 44 records／42 unique，`(file, test label)` 出现次数完全一致，**新增 0／移除 0**（不是只比总数，也不含 Bun 末尾重复摘要）；`generated/party-native/final-failure-comparison.json` |
| 纯 import 检查 | 17 modules 在 fs／net／Bun.serve／fetch 挂钩下 **0 启动 I/O**；含 ESM named-binding 自我验证，避免假零；`generated/party-native/import-safety.json` |
| 附接 LIVE 唯读 | title frame 32、`errors: []`、0 WS（`live-title-final.log`）；101 支 client TS 全 200、preview Host 200（`live-modules.json`）；原 native 进程 6719 保留，未重启世界 |
| Markdown 相对连结 | 467 个标准 inline 相对连结、0 断链（只查档案路径，不冒称验证每个 anchor）；`generated/party-native/doc-links.json` |

原证测试（`server/test/native-social-evidence.test.ts`）直接读 PE bytes／C／listing／真 WZ：
`00559EF5` 的 27 bytes 机器码、`sub_559E20` 只有 case 3/4/5、`sub_55CC40` 的 `+432`／六次／`+= 13`、
四条 `/파티*` 都呼叫 `sub_4FB670`、`UI/UIWindow.img` 顶层无 `Party`、七条指令的 CP949 原文位址、
「파티원:」「당신은 파티장입니다.」与六格空白排印。
加密 synthetic peer（`server/test/fixtures/synthetic-social-peer.ts`）与 Chromium 元件测试
（`server/test/native-social-browser.test.ts`，DPR 1／2、真实产线 HTML／原 PNG、0 WS）不建帐号、
不登入 LIVE、不操作玩家角色、不改存档。

**仍未完成**：完整 party 视窗（这版原档没有对应分支，不能凭空补）、交易房／Messenger／人物资讯 id0、
组队经验与掉落归属、原 server 的邀请储存／配额规则（未知）、`client/main.js` 与 `client_probe.mjs`
的 TS 迁移、既有 44 项失败（CI 仍不绿）。不要把本轮的指令链完成写成整个游戏等价。

可重跑：

```bash
bun run typecheck && bun run format:check && bun run build
bun test --timeout 30000 server/test/native-social*.test.ts server/test/player-menu*.test.ts \
  server/test/party.test.ts server/test/fame.test.ts server/test/native-system-ui.test.ts \
  server/test/feedback-browser.test.ts tools/tests/attach-web.test.ts
bun generated/party-native/import-safety.ts   # 纯 import；不启世界
bun run test
bun server/scripts/frame_probe.ts 8525        # 唯读 title；不登入、不附 --allow-state-changes
```
