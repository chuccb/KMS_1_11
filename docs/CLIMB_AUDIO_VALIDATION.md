# 繩索合成、移動與原始音訊驗證（2026-10-17）

> 後續frame／play舊MJS已刪，真Chromium／有界keyboard的現行入口與限制見 [STRICT_FRAME_PLAY_TOOLS](STRICT_FRAME_PLAY_TOOLS.md)；下列舊名稱只作歷史紀錄。

> 後續ADR-082：7支browser工具已真正遷成TS；本頁舊node／MJS命令及PASS保留歷史時點，不是現行操作入口。
> 現行安全命令、未執行的手動場景與最新型別整理見 [STRICT_BROWSER_TOOL_MIGRATION](STRICT_BROWSER_TOOL_MIGRATION.md)。

> 後續朝向／地面怪物／世界與角色選擇的修正及 536 項驗證，見 `FACING_SELECTION_VALIDATION.md`。本報告的 530 項是前一輪結果。

本次針對使用者提供的「繩上正面臉／衣服消失／站立武器伸出」截圖追查；不是換一張替代圖片。`Data.wz` 未修改。

## 1. 截圖的實際原因與修正

`Character/00002000.img/{rope,ladder}/<frame>/body` 的 z 是 **backBody**，head 的 z 是 **backHead**；原 compositor 卻固定使用 body/head 的正面 rank，使皮膚蓋住後方衣服。另有兩個獨立錯誤：沒有 rope/ladder 動作的武器錯誤 fallback 到 stand1/0，而 body frame 的 `face=0` 沒有被尊重。

修正：

- 身體、頭部各自依 canvas 的實際 z 名稱查 `zmap.img`。
- 裝備只使用當前動作的真實 frame；缺動作表示不畫該裝備，不混搭站立武器。未知的整體動作仍可在 body 層 fallback，與每部件任意 fallback 不同。
- body `face=0` 不合成正面表情；攀爬用其專屬 backHair，沒有重複加 backDefault。
- 攀爬時清除先前的攻擊動畫，不讓尚未結束的 swing 覆蓋繩索姿勢。
- 新版 avatar URL 帶 compositor revision，避免瀏覽器沿用一小時內快取的舊錯誤攀爬 PNG。

回歸逐一合成 rope/ladder 的 0、1 frame，驗證：加站立武器不改 PNG、換正面 face 不改 PNG、穿衣服必須改變 PNG；不是只檢查「有產生圖片」。

## 2. 移動／攀爬的後續修正

- 原 `sub_5382F0` 的普通空中控制上限是 `10000 * 0.0008928571428571428 = 8.92857…`。先前誤為 89.2857（十倍）。這是站立起跳時可施加的空中控制上限，不是把走跳的慣性速度降到 9；已保留走跳慣性。
- `sub_5378D0` 的平地起跳水平增量改為先加 80% walk speed、再 clamp，而不是直接取 max。
- 地圖 ladderRope 的 `page`／`uf` 保留到瀏覽器；攀爬依 rope page 排深度。
- 允許地面與繩尾差 2px 的原始放置，抓繩後 clamp 進合法範圍；離開底端或未接平台的頂端，不會下一步又自動抓回。
- 持續按住 Up+Jump 跳離繩索時不立即取消跳躍、重新吸回；`uf=false` 的上端不錯誤穿出。
- 攀爬兩幀用原 body 的 **250ms** delay，停止時凍結當前幀，不強制跳回 frame 0。步行／站立改為每角色動作時鐘，而非所有角色共享牆鐘相位。
- 遠端 path 保留 action/vx/vy，跳躍、rope、ladder 不一律誤畫為 walk1。
- frame catch-up 上限與 fixed-step module 一致為 250ms，減少較慢 render frame 人為丟掉物理時間。

仍未覆蓋所有 water／flight／knockback／skill 行為；伺服器巡邏政策與完整原版 AI 也不是本次已完成項目。

## 3. 原始 BGM 與 SE

### 資料讀取

`game/audio.ts` 驗證 Sound_DX8 的 flag、compact size/duration、DirectShow media header、WAVEFORMATEX 與 payload 邊界。原檔有 **92 個 sound body + 58 個 UOL 別名 = 150 個可取用 sound 路徑**。

- MP3 (`wFormatTag=0x55`) 原 payload byte-for-byte 輸出，不重新壓縮、不合成音色。
- PCM (`=1`，NxLogo) 保留原樣本，只加合法 RIFF/WAVE 容器。
- 修正通用 UOL resolver：中間節點的 UOL 不可丟掉未消耗的 path suffix。一些 Item/Use 別名指向 sound-family 容器，再取同角色的 Use leaf；全部已驗證。
- `/api/audio/<encoded Sound/... path>` 支援 Content-Type、HEAD、byte Range、缺檔 404、非法 range 416。只接受 Sound archive 路徑，不讀任意 filesystem。
- 100 張地圖的非空 `info.bgm` 全部能解析。

### 瀏覽器事件

原程式證據：Title（`MapleStory.exe.c` 215203）、WCSelect（338335）、map/info/bgm（119549）；UI `sub_526D50`，Game `sub_5271F0`，Item `sub_526F30`，Mob `sub_5273E0`，Weapon `sub_527550`。

目前接入：

- Title → WCSelect → map `info.bgm`，原始 BGM loop；同曲換圖不重頭播。慢的舊地圖 decode 不會搶回新 BGM。
- UI 按鈕 click／hover、CharSelect、inventory open/close。
- GameIn、Portal、地面 Jump、PickUpItem、LevelUp、Tombstone。
- 武器依 **info/sfx**（例如起始劍為 swordL）選 Attack，而非猜 ID 或使用固定音色。
- Mob 依七位 template id 選 Damage／Die；本地與遠端攻擊皆可觸發對應基本 SE。
- USE item 在 slot quantity 下降的回應後播放該 item 的 Use，不因單純送出／遭拒絕請求就先播放。
- `sub_526CC0` 的位置音量：250px 內 100%，至 1000px 線性降到 40%，之後維持 40%。與全域 SE 音量分開。
- 原設定預設 BGM/SE 皆 15/15；兩個 gain bus 分離，SE 不切斷 BGM。頁面提供靜音按鈕；decoded PCM cache 與重疊 one-shot 有上限。
- 瀏覽器必須由使用者第一次點擊／按鍵解鎖音訊；autoplay 未允許時保留想播放的 BGM，不讓 AudioContext 失敗影響遊戲。

這不是所有聲音事件均已實作的聲明：未實作的技能／完整 UI／logo intro 不會憑空播放那些聲音；也尚未用原客戶端錄音 oracle 比對 DirectSound 的淡入淡出、decoder padding、精確混音增益。原始聲音「可解碼且開始播放」不等於已聽測或聲學 1:1 驗收。

## 4. 執行結果

- `cd server && npm run check`：**530/530 PASS**，TypeScript typecheck 通過。
- 其中 browser module wrapper 執行 **21 項 motion + 9 項 audio engine** 純模組測試：抓繩／退出／jump regrab／freeze frame、遠端動作、autoplay、BGM race、同曲不重播、mute、獨立 SE bus、cache、缺檔與位置音量。
- 原始音訊／HTTP／avatar／中間 UOL suffix 均有持久回歸。
- `client_probe.mjs`：SMOKE / SHOP REGRESSIONS / TITLE REGRESSIONS OK。
- `frame_probe.mjs 8495`：FRAME SMOKE OK。
- 真 Chromium `browser_motion_probe.mjs 8495 --climb`：實際登入 alt 測試帳號、行走／跳過 x=591 的真實 60px 牆，再抓 x=718 的原版繩索；停止於 `(718,193)`、`action=75`（rope + facing）、`vy=0`，等待後 y 不滑動，再跳離。**未注入或傳送角色座標**。攀爬 screenshot 已檢視，衣服／背面／無站立劍均正常。
- 同一真瀏覽器抓到 AudioContext running 中的原始 Title、WCSelect、175.151s map BGM loop 與非靜音 UI／Jump BufferSource.start。
- `browser_audio_probe.mjs 8495`：**150/150 真 Chromium decodeAudioData 成功，silent=0、errors=[]**；包含 PCM、MP3 與全部別名，不只檢查 MPEG 檔頭。

可重跑的兩個 browser script 需外部 Playwright/Chromium（參數見各檔頭）；沒有把 browser dependency 加進產品 package。PNG 截圖與暫時產物位於忽略版控的 `generated/validation/`，不納入 source patch。
