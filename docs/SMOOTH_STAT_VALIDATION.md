# 流暢度、原能力窗與 AP：來源、驗證及限制

2026-10-17。本輪不改移動／跳躍／繩索物理參數，不改 `Data.wz`，也不把局部完成當作全遊戲 1:1。

## 1. 量測後減少無謂工作

- `client/scene.mjs`：地圖靜態節點只在 art 載入時排序一次。每幀只排序小量動態角色／怪物，再穩定合併。
  比較規則仍是 `z`、腳底 `y`；完全相等時仍先畫原先插入的地圖節點，不改圖層／前景／攀爬深度。
- 畫圖前使用**解碼圖片的實際寬高**、WZ origin、flip 與原本的整數座標檢查可見性。
  不能只用物件錨點裁切：錨點在畫面外的大圖仍可有可見像素。碰到邊界仍保留。
- `wzart.at()` 仍提供同一個 `CanvasArt` API，但 PNG 改為首次讀取 `png` 時才壓縮並快取。
  地圖 metadata 和 avatar 的 RGBA parts 不再順便壓縮之後根本不會被使用的 PNG；輸出 bytes 不變。
- 地圖切換不再清空共用圖像／avatar 快取。普通圖片達 1024 項時批次淘汰 256 項非 UI 舊項目；
  avatar 達 256 項時淘汰 64 項。UI 項目優先保留，並非載入整個遊戲的無界快取。
- avatar blob URL 在圖片成功／失敗解碼後都 `revokeObjectURL`，已解碼的 Image 繼續繪製。
- 舊的 map id 非同步回覆檢查保留；切換地圖會清除上一張的 scene，並不是把上一張圖留在背景。

### 實測，不誇大 FPS

同一支 `browser_render_probe.mjs`，正常登入 `alt`，靜止、不注入角色狀態；暖機 8 秒後取 120 幀：

| 指標 | 修改前 | 初次修改後 |
|---|---:|---:|
| 每幀 drawImage 中位數 | 794 | 130 |
| render CPU 中位數 | 0.60 ms | 0.40 ms |
| render CPU p95 | 0.70 ms | 0.60 ms |
| RAF 間隔中位數／p95 | 16.7 / 16.7 ms | 16.7 / 16.7 ms |

最後重啟最新版再次量測：drawImage 中位數／p95 均 128；CPU 中位數 0.40 ms、p95 1.00 ms，
RAF 中位數／p95 仍 16.7 ms。CPU 尾端有波動，**沒有證據保證每次 p95 都更快**；穩定可確認的是少了大量不可見繪製。

繪圖呼叫減少約 **84%**。這是 sandbox／software Chromium 的短時間樣本；人物數、動作、地圖、機器會影響數字。
**原本已約 60 FPS**，不能說成「原本低 FPS，修改後才到 60 FPS」，也不是所有硬體的幀率保證。

冷 provider 的 `mapArt(1000000)` 單次由約 505 ms 減至約 99 ms；獨立正式 probe 再量約 92 ms。
這些是單次冷 provider／已存在 OS 檔案快取的樣本，不是所有地圖／所有載入時間的統計。
`art_perf_probe.mjs` 更直接驗證：755 個 map sprites 的 metadata **0 次 PNG 壓縮**，三張 avatar
只壓縮最後三張成品，重讀 `png` 不再壓縮。三 avatar frames 該次約 9.7 ms。

## 2. 原 Stat 能力窗，不再只印「還沒接上」

| 原來源 | 已落地 |
|---|---|
| `sub_4F2450`／`UI/UIWindow.img/Stat/backgrnd` | 176×315 原圖，原 close widget (128,9) |
| `sub_4F2820` | AP 按鈕 x148，HP／MP／STR／DEX／INT／LUK 的 y 為 112／130／202／220／238／256；Detail (122,280) |
| `sub_4F32D0` | name (45,61)、job (45,79)、community (68,97)、HP (38,113)、MP (38,131)、EXP (57,149)、fame (57,167)、四能力 (45,203+18i)、AP (77,282) |
| 同一 draw 函式 | HP／MP `current / max`、EXP `value (integer%)`、四基礎能力及 AP；沒有自己加一排現代版欄位 |
| PE `005BCEA8` CP949 | 固定 `내커뮤니티`，和原 client 一致，不是假造使用者的公會名稱 |
| `sub_4F3210` | 有 AP 時基礎按鈕維持原 enabled 外觀；pending／500ms 檢查在送出端，不讓按鈕閃成灰色 |

`client/statwindow.mjs` 用原 WZ 按鈕的 normal／mouseOver／pressed／disabled 畫面；DOM 僅提供透明輸入區與可及文字。
狀態列原 `BtStat` 和瀏覽器 **S** 捷徑都可開關；Escape／原 close 可關閉，視窗可拖曳並記住位置。
S 現在是能力窗，不再兼作向下移動；往下／下繩索用原本的 ArrowDown。聊天／名稱輸入不會觸發遊戲捷徑。
歷史初次位置(20,35)是當時browser政策；本輪已由sub_43D750／43E340查證type2原預設(72,72)並改回，
既有已保存位置保留。畫面內夾限／localStorage仍不代表原版整套視窗管理器已還原；見 `EQUIPMENT_VALIDATION.md`。

## 3. 真 AP 配點鏈

`CUIStat::OnButtonClicked sub_4F2D70 -> sub_55CF60`：

```text
c2s [1B] [u32 stat mask]
STR=00000040  DEX=00000080  INT=00000100  LUK=00000200
MaxHP=00000800  MaxMP=00002000
```

sender 檢查 pending、HP>0、AP>0 與 500ms 間隔；**0x1B 是 AP，不是近戰攻擊**，近戰是 c2s 0x0F。
這個版本只有一個 u32 mask，不能套用其他版本的 timestamp 欄位。

- WS `{t:"ability-up",field:"str"|"dex"|"int"|"luk"}` → `ClientSession` → 加密 TCP 原 `0x1B`。
- game server 僅對單一、合法基礎能力 mask，活著且有 AP 的角色加 1／扣 1，沒有 client 傳來的目標數值。
  重送、混合 mask、錯誤長度、零 AP、死亡、非法點數均不消耗點數；server 也用 monotonic clock 限制 500ms。
- 回真 s2c `0x0D`（能力＋AP diff，`ack=true`）；拒絕也回空 diff＋ack，不能把 native pending 鎖死。
  JSON 的 `ability-result.changed` 是 bridge 根據這個回包產生，不是額外的原版封包。
- 成功即呼叫原 persist，不只等斷線；重連／重新載入存檔保留結果。其他玩家的 AP 不變。
- `SelfView` 初始與後續 diff 同步 STR／DEX／INT／LUK／AP／SP／fame。
  同時修正 `ClientSession.character.stats` 的舊 snapshot，後續傷害計算不再讀登入時的舊能力。
- 修正升級後 `expToNext` 仍沿用登入等級的問題，能力窗與原 HUD 的百分比分母跟隨新等級。
- 修正首次進圖的 packet drain 次序：先套用 `0x16`，再依 wire order 處理同一批 queued pool／stat packets。
  否則先放進 mob pool，再由 `0x16` 清空，且 queued stat 更新可能在 self 尚不存在時被丟掉。
- 協定 catalogue／capture describer 也加入 `abilityUp`，不把已定位的 AP 封包留成 unmapped。

## 4. 測試與重現

- `cd server && npm run check`：**555/555 通過**，strict TypeScript 通過。
- `server/test/ability.test.ts`：真 bytes、嚴格 payload 長度、四能力、無損拒絕、254→255、255 拒絕及真 0x0D codec。
- `server/test/client-session.test.ts`：一個 TCP write 合併 field／mob／NPC／stat，保留正確事件順序、pool、最新 snapshot、EXP 分母。
- `server/test/serve.test.ts`：原 native frame／cipher 的 AP、錯誤 packet 放行、cooldown 與成功立即保存。
- `server/test/webclient.test.ts`：bridge／完整登入、跨玩家隔離、防重 pending、拒絕後可再配點、真重連。
- `server/scripts/scene_probe.mjs`：100 組隨機完整 scene 對照舊 stable sort；origin／flip／邊界與空 scene。
- `node server/scripts/client_probe.mjs`：既有五組加 **STAT/AP**：鍵盤、拖曳、原外觀、零 optimistic 修改、pending／500ms／拒絕放行。
- `node server/scripts/art_perf_probe.mjs`：只讀真 Data.wz，計數實際 PNG 壓縮與 byte-cache。
- 真 Chromium `browser_stat_probe.mjs 8595`：**隔離** ability 帳號六 AP fixture；真登入、S／原狀態列、176×315／1.25x、
  六次真配點、同時點擊無重送、零 AP、拖曳與記憶、重連保留、blob 全釋放、JS／HTTP errors 為空。
  探針拒絕 8495，不能拿使用者角色充當可修改的測試 fixture。
- 最新 selection／facing（425 個 mob move packets）、男女真建刪、motion `--climb`／audio decode+playback／frame 全部通過；
  男女 QA 角色最後皆為零，ability 六 AP 用盡為零，真瀏覽器 JS／素材 HTTP 錯誤皆為空。

瀏覽器 scripts 以 `PLAYWRIGHT_MODULE`、`CHROMIUM_EXECUTABLE`、`LD_LIBRARY_PATH` 指定本機 Chromium；
截圖／輸出在忽略的 `generated/validation/`，不把衍生素材加到 Git。

## 5. 明確未完成／差異

- **目前只做四基礎能力配點**。HP／MP 按鈕雖已定位，職業／技能相關的 AP 成長公式未證實，因此禁用，不用假數字冒充。
- **升級發放 AP／SP 及 maxHP／maxMP 成長仍未實作**（`game/exp.ts` 的既有限制）。本輪處理「已有 AP 的分配」，
  不偷偷替既有使用者補點；六 AP 是隔離測試 fixture，不是宣稱原版新角色帶六 AP。
- Detail 尚無完整戰鬥能力／buff 計算，所以保留 disabled 原按鈕，沒有開一個亂填數字的假視窗。
- 裝備加成／技能／buff 後的總能力與 `base+bonus` 標示尚未完整接上；目前印伺服器儲存的基礎能力。
- `0x0D` 的 STR／DEX／INT／LUK reader 是 **u8**，完整 CharacterData 卻是 u16（既有 FINDINGS 4.21.1）。
  本輪拒絕把 255 再加到 256，且不扣 AP，以免 wire 截斷；**不是宣稱 255 是原遊戲最終能力上限**。
- 韓文字型仍以本地 Noto CJK fallback，不是原 Dotum；視窗焦點／重疊管理也尚非整個 native CUI 系統逐像素等價。
- Equip／Skill／小地圖、其他未接齊的 browser UI 與完整怪物戰鬥 AI，不在本輪冒稱完成。


### 隔離 Stat fixture 的建立方式

先停止隔離伺服器；**不要**改正式 `kms111-save.json`，也不要對正式 port 跑會配點的 probe。
下列從 repo root 執行，只寫測試檔：

```sh
node --input-type=module - <<'JS'
import { writeFileSync } from 'node:fs';
import { zeroStats, characterDataOf, startingCharacterItems } from './server/src/protocol/chardata.ts';
import { saveJson } from './server/src/game/save.ts';
const stats = Object.assign(zeroStats(), {id:91,name:'Ability',level:1,str:8,dex:6,int:6,luk:5,
  hp:50,maxHp:50,mp:50,maxMp:50,ap:6,appearanceA:20000,appearanceB:30000,mapId:1000000});
writeFileSync('/tmp/kms111-stat-save.json', saveJson(new Map([
  ['ability',{password:'ability',characters:[characterDataOf(stats,startingCharacterItems())]}],
  ['maker',{password:'maker',characters:[]}],['female',{password:'female',gender:1,characters:[]}]
])));
JS
# 於 server/ 啟動隔離 8595/8596/8597，--save /tmp/kms111-stat-save.json --data ../Data.wz。
# 不使用或覆蓋正式 8495/8496/8497。
```

本輪 release 紀錄（sandbox 暫存）：`/tmp/smooth-stat-full-555-release.log`、
`/tmp/browser-stat-native-release.log`、`/tmp/browser-smooth-creation-release.log`、
`/tmp/browser-smooth-selection-release.log`、`/tmp/browser-smooth-climb-release.log`、
`/tmp/smooth-frame-native-release.log`、`/tmp/smooth-render-final.json`。
截圖：`generated/validation/stat-ability-native.png`、`stat-field-native.png`。
