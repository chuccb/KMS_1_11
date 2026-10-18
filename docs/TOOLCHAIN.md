# Bun / TypeScript / ESNext 工具鏈

更新：2026-10-18。**這是尚未完成的全專案遷移，不是完成交付聲明。**

## 唯一版本與安裝入口

| 工具 | 固定穩定版 | 鎖定來源 |
| --- | --- | --- |
| Bun | 1.4.3 | `.bun-version`、根 `package.json` 的 `packageManager` |
| TypeScript | 7.0.2 | 根 `package.json` 與 `bun.lock` |
| Bun 型別 | 1.4.3 | 同上；與 runtime 同版 |
| Prettier | 3.9.10 | 同上與 `.prettierrc.json` |
| checkout Action | v7.0.1 | CI 固定完整 commit SHA |
| setup-bun Action | v2.2.0 | CI 固定完整 commit SHA |

本日查證：[Bun release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3)、
[TypeScript registry](https://registry.npmjs.org/typescript/latest)、
[Bun 型別 registry](https://registry.npmjs.org/@types/bun/latest)、
[Prettier registry](https://registry.npmjs.org/prettier/latest)、
[setup-bun release](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0)。
此為本日最新穩定版基線，不宣稱永遠最新；升版要重新檢查 lockfile、型別、回歸及瀏覽器建置。

先用官方發行版安裝固定 Bun，再從 repository 根目錄執行：

```sh
bun tools/setup.ts
bun run typecheck
bun run format:check
bun run test
bun run build
```

`setup.ts` 檢查實際 Bun 版本後，只執行 frozen lockfile 安裝，禁止安裝生命週期腳本；不測試、不登入、不寫進度。
本沙箱的 Bun 位於 ignored `generated/toolchain/bin/bun`；新 shell 可明示
`export PATH="$PWD/generated/toolchain/bin:$PATH"`。不覆寫作業系統的 Node/Python。

## 編譯、瀏覽器與遷移界線

- 根 `tsconfig.json` 使用 `target/module: ESNext`、Bundler resolution、嚴格型別、unused 檢查、
  `verbatimModuleSyntax`、`erasableSyntaxOnly`，**不關 strict、不 skipLibCheck、不加 allowJs 假裝遷移完成**。
- 所有 `client/**/*.ts`／`.mts`、server、tools 的 TypeScript 都在檢查範圍。
  **剩餘 `client/main.js`、`.mjs` 及 probe 並未因此獲得嚴格型別驗證**，仍必須實際遷移。
- 已遷移共用模組把宣告和實作收斂到同一 `.ts`，保留原證常數、順序與整數運算。
- 開發 HTTP 只對 `.ts` 使用 Bun.Transpiler，移除型別後以 JavaScript MIME 回應；不用瀏覽器原生理解 TS。
  `server/test/bun-static.test.ts` 以獨立 port 檢查此路徑，不連遊戲、不登入。
- `bun run build` 用 Bun 的 browser/ESM bundler 輸出 ignored `dist/client`，複製 HTML、CSS 與字型。
  建置結果是產物，不是 authored JavaScript 原始碼。
- `node:` 匯入是 Bun 提供的標準函式庫相容介面，不呼叫 Node runtime；現存 `node:test` 來源由 Bun 執行。
- 目前全專案遷移尚欠主瀏覽器入口、其餘 `.mjs` 與手動 probe 的實作型別，不能以能 bundle 代替完成。

## 工具遷移與原證

已移除 Node/npm 與 Python 的獨立版本檔、server 重複 package/lock/tsconfig，以及 Bash/Python 的啟動／分析實作。
分析改用以下 TypeScript 入口：

```sh
bun tools/hexfunc.ts MapleStory.exe.c sub_5376C0 --calls
bun tools/kstr.ts MapleStory.exe.c sub_5376C0 --names
bun tools/wz.ts help
bun tools/wz.ts manifest
bun tools/wz.ts dump Map/Map/101000000.img --json
```

WZ 工具直接重用產品 parser，不再維護第二套 Python parser；舊 Python CLI 的子命令／參數並非全部同名。
因此**不能再聲稱有兩個獨立現行 reader**。改以舊 Python 已保存且不重新生成的
`analysis/data_wz_manifest.json`，對照所有 1,056 個 image 的 offset、size、source 及每段原始 bytes checksum，
另保留產品 parser 的手建 fixture 與既有 goldens。
反編譯工具保留原始 bytes，再以 CP949 優先解碼；不先 UTF-8 replace 毀掉韓文字串。

原 `.c`／`.lst`、EXE/DLL/ACM、WZ、analysis 資料與過往 ADR 均是原證或歷史記錄，**不翻譯、不格式化、不刪除**。
歷史文件中的 `.py`、`node`、`npm` 舊命令只代表當時操作；現行命令以本頁與 README 為準。

## 存檔與操作安全

```sh
# 必須先停止舊程序、確認真正 save、冷備；這個入口不替你做以上三件事。
bun tools/serve-existing-save.ts generated/<真正存在的存檔>.json
```

只接受已存在、非空的 regular file，否則直接失敗，不建立 replacement、不加種子帳號、不聲稱恢復成功。
預設 web/login/game 為 8515/8516/8517，綁 0.0.0.0；可用 `KMS_WEB_PORT`、`KMS_LOGIN_PORT`、
`KMS_GAME_PORT` 指定 1–65535。瀏覽器素材與 WebSocket 維持同 origin，不指向使用者機器的 localhost。
保護測試只用臨時 fixture，不接觸玩家存檔。

本次允許型別、格式、單元回歸及建置；**不自動登入、不操作角色、不寫玩家進度、不自動跑手動 probe**。

## 實際驗證狀態

來源凍結後，所有 TS 的嚴格型別、格式與 browser build 均通過。完整回歸為 **828 pass / 45 fail**；
同版 Bun 執行 d311622 隔離原始碼為 **823 pass / 45 fail**，按檔名／標題／重複次數比較，失敗完全相同。
工具／HTTP 新增的五項全部通過（包含原 manifest 全 image checksum 與整個 browser import graph）。
**45 個失敗仍阻擋驗收，這不是全專案完成；也不能從 Bun 參照推論原 Node 一樣失敗。**
詳本次遷移記錄 [BUN_MIGRATION](BUN_MIGRATION.md)。
CI 使用同一組 Bun 命令，不靠 `continue-on-error`、篩掉失敗案例或縮小型別設定讓結果變綠。
