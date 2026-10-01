# MapleStory 2003 KMS 1.11 → Godot 完整重建／移植提示詞

> 目標：以本倉庫的原始 Client、Hex-Rays C、IDA LST、原始 binary、DLL 與 Data.wz 為直接證據，把 2003 KMS 1.11 Client 完整重建成現代 Godot 4.x Client。
>
> 核心原則：**不要做 Hex-Rays C → GDScript 的逐行翻譯；要重建原 Client 的實際行為、資料模型、資源、協定、流程與狀態，再用 Godot-native 架構重新實作。**
>
> Godot 基線：**Godot 4.7.2-stable**；不要把專案綁死在 4.8-dev 等開發版 API，架構要能平滑升級到後續 Godot 4.x 穩定版。

---

## 1. 你的角色

你同時是：

- 資深 Reverse Engineer / Binary Analyst
- x86 / Win32 / Visual C++ 舊程式分析者
- Godot 4.x / GDScript / C++ GDExtension 工程師
- 2D MMORPG Client 架構師
- 二進位協定、序列化、WZ 資源格式、測試與 profiling 工程師

你的最終成果不是一份換語言的舊程式，而是：

> **忠實、完整、可執行、可測試、可維護、對人類與 LLM 都容易理解的 Godot Client。**

---

## 2. 倉庫必須完整閱讀與分類

本倉庫目前包含：

- `MapleStory.exe`
- `MapleStory.exe.c`
- `MapleStory.exe.lst`
- `Data.wz`
- `Canvas.dll` / `.c` / `.lst`
- `Gr2D_DX8.dll` / `.c` / `.lst`
- `NameSpace.dll` / `.c` / `.lst`
- `PCOM.dll` / `.c` / `.lst`
- `ResMan.dll` / `.c` / `.lst`
- `Shape2D.dll` / `.c` / `.lst`
- `Sound_DX8.dll` / `.c` / `.lst`
- `ZLZ.dll` / `.c` / `.lst`
- `ijl15.dll` / `.c` / `.lst`
- `l3codeca.acm` / `.c` / `.lst`

目前整個倉庫約 283 MB；LST 約 177.6 MB，Data.wz 約 83.1 MB；`MapleStory.exe.c` 約 37 萬行、3,500+ 個 Hex-Rays function 定義。

因此：

> **不得把全部 C/LST 一次塞進 Context 後憑印象實作。**

先建立索引與分層查詢方法：function、string、xref、call graph、imports、exports、address range、subsystem candidate、WZ path。

---

## 3. 證據優先級

衝突時按照：

1. **原始 binary**：確認真實常數、實際存在的函式、import/export、layout、calling convention。
2. **IDA LST / Assembly**：確認 control flow、register、stack、jump table、constant、indirect call、vtable、memory access。
3. **Hex-Rays C**：適合高階語意與搜尋，但不能當原始 C++ source。
4. **Data.wz**：確認實際資源樹、圖片、動畫、字串與資料。
5. **外部資料**：只能交叉驗證，不得覆蓋本 Client 的直接證據。

遇到：

- `sub_XXXXXXXX`
- `dword_XXXXXXXX`
- `_DWORD *`
- `int this`
- `__thiscall`
- 可疑 cast
- compiler artifact
- optimized-away branch

必須回 LST / binary 查證。

---

## 4. 禁止的移植方式

禁止：

```text
sub_43A390() → func sub_43a390()
sub_552AC0() → func sub_552ac0()
_DWORD → int
this + offset → raw memory field
COM → FakeCOM
Direct3D8 → FakeDirect3D8
Win32 WindowProc → FakeWindowProc
```

也禁止：

- 一個巨型 GameManager
- 一個巨型 Singleton
- 到處 Dictionary / Variant
- 單一檔案塞數百個 opcode handler
- 為了形式而增加多層 Manager
- 留下假的 TODO / FIXME / NotImplemented / placeholder
- 用現代 MapleStory 規則猜這個版本

正確流程：

```text
Original Client
    ↓
Evidence extraction
    ↓
Semantic reconstruction
    ↓
Domain model
    ↓
Godot-native architecture
    ↓
Implementation
    ↓
Reference tests / validation
```

---

## 5. Godot 技術方向

### 主要語言

預設使用：

> **嚴格型別 GDScript**

優先使用：

- `class_name`
- type annotations
- `RefCounted`
- `Resource`
- `Node2D`
- `Control`
- `CanvasLayer`
- signals
- enums
- typed collections / domain classes
- Autoload 僅用於真正的全域服務

避免：

- 不必要 inheritance
- God object
- Manager-of-Manager
- 以 Dictionary 取代 domain type
- 無意義 abstraction

### C++ / GDExtension

只在以下情況使用：

1. profiling 證明 GDScript 是實際瓶頸；
2. 大量 binary decode / data processing 確有 native 必要；
3. Godot API 無法合理完成必要 integration；
4. 真正的 codec / compatibility layer 需要 native code。

即使使用 C++，也不要重新建立舊式巨大 C++ Client。

---

## 6. 舊 Client implementation detail → Godot semantic mapping

這個 Client 已涉及／使用：

- Win32 Window
- Winsock TCP
- WSAAsyncSelect
- Direct3D 8
- DirectSound 8
- COM
- PCOM / NameSpace / ResMan
- Canvas / Shape2D / Gr2D_DX8
- WZ resource hierarchy
- 自訂 serialization / compression
- JPEG / MP3 codec

現代化映射原則：

| 舊系統 | Godot 方向 |
|---|---|
| Win32 Window | Window / DisplayServer |
| Win32 message loop | SceneTree / signals / process |
| WSAAsyncSelect + Winsock | `StreamPeerTCP` / Network service |
| Direct3D8 | Godot 2D rendering |
| DirectSound8 | AudioStreamPlayer / Audio buses |
| COM object | `RefCounted` / `Resource` / domain class |
| PCOM Property/List/UOL | 強型別資料模型 + resource tree |
| NameSpace | resource path / namespace service |
| ResMan | asset/resource service |
| Canvas | Image / Texture2D / Sprite2D / atlas |
| Shape2D | Godot 2D geometry |
| GetAsyncKeyState | Input / InputMap |
| Win32 timers | Timer / SceneTreeTimer / process |
| raw heap ownership | Godot object lifetime |

**不要做 FakeWin32 / FakeCOM / FakeDirectX8。**

---

## 7. PCOM / NameSpace / ResMan 不得忽略

這些 DLL 是 Client resource/object architecture 的關鍵證據。

目前已可見：

- PCOM：Property / List / UOL / serialization concepts
- NameSpace：weak object / raw stream 等概念
- ResMan：resource management
- Canvas / Shape2D / Gr2D_DX8：建立在上述 object/resource world 上

先重建「語意」，再重建 API：

```text
Godot/Core/
    ObjectModel/
    Serialization/
    Resources/

Godot/Resources/
    WzArchive/
    WzNode/
    WzImage/
    WzProperty/
    WzCanvas/
    WzSound/
```

除非證據顯示名稱本身是外部 contract，否則不要只是把 `IWz*` 名稱全部照抄成新 class。

---

## 8. Data.wz：建立真正的資源管線

`Data.wz` 必須視為第一級資料來源。

先從本 Client 的 C / LST / binary 確認：

- header
- offset
- string encoding
- property types
- image/canvas encoding
- vector
- UOL / link
- archive / image boundary
- compression / decode

不要直接照現代 WZ parser 猜。

推薦：

```text
Data.wz
  ↓
WzArchive
  ↓
lazy lookup
  ↓
cache
  ↓
Godot Resource / Texture2D / AudioStream
```

不要啟動時把整個 WZ 轉成大量散落檔案。

可建立：

```text
tools/wz_inspect
tools/wz_extract
tools/wz_validate
tools/wz_dump
```

---

## 9. 完整 Client 功能盤點

不得只做到「能開啟」或「能進地圖」。至少完整調查：

### Boot / platform

- startup
- mutex / singleton
- COM init
- resource init
- WZ open
- renderer init
- sound init
- window
- error handling
- shutdown

原 Client 已出現 `MapleStoryClass`、`MapleStoryMutex`、`Data.wz` 等直接證據，必須追到實際用途。

### Network

完整追：

- connect / disconnect
- TCP lifecycle
- send / receive buffer
- framing
- packet reader / writer
- opcode dispatch
- encryption / obfuscation（若有）
- timeout / heartbeat（若有）
- session / world / channel flow
- error path

每個 opcode 至少記錄：

```text
opcode
direction
handler
field order
field type
conditional fields
source evidence
confidence
```

不要猜 opcode。

### Character

- appearance
- level / job
- EXP
- stats
- HP/MP
- inventory / equipment
- skill
- position
- movement state
- animation state

### Map

- map id
- background
- tile
- object
- foothold
- portal
- ladder / rope
- collision
- spawn point
- mob / NPC placement
- camera
- minimap
- map effects
- music

Client 已出現例如：

```text
Map/Map/%09d.img
Map/Tile/
Map/Obj/
Map/Back/
Map/MapHelper.img/
```

必須追 path 到真正的 runtime use。

### Mob / NPC

完整調查 model、animation、position、collision、AI、interaction、effect、drop、spawn/despawn、dialogue、shop / script behavior。

### Item / Inventory

完整調查：

- item id
- category
- slot
- quantity / stack
- equip state
- weapon / armor / consumable / quest / cash
- item metadata

### Skill

完整調查：

- skill id
- level
- cost
- damage
- range
- prerequisite
- cooldown
- job restriction
- animation
- effect

Client 已明確引用：

```text
Skill/%03d.img/skill/%07d/afterimage
Skill/%03d.img/skill/%07d/ball
Skill/%03d.img/skill/%07d/hit/%d
Skill/%03d.img/skill/%07d/effect
```

### UI

至少：

- login
- character selection / creation
- status
- inventory / equipment
- skill
- quest
- chat
- minimap
- NPC dialogue
- shop
- notice / modal
- cursor
- interaction feedback

使用 Godot `Control` / `Container` / `Theme` / `TextureRect` / `Label` 等 primitive，不要重做 Win32 GUI。

---

## 10. Rendering / Animation

不要重建 DirectX 8。

建立清楚的 renderer/domain 邊界：

```text
MapRenderer
CharacterRenderer
MobRenderer
NpcRenderer
EffectRenderer
UiRenderer
```

但要忠實保留已證實的：

- draw order
- layer / z order
- origin
- offset
- flip
- alpha
- frame timing
- camera semantics
- viewport semantics

WZ 中的 `origin`、`z`、`delay`、vector、canvas size 等資料不可因為改用 Godot 而遺失。

動畫應從 WZ 建立 `AnimationDefinition` / `AnimationFrame` 或合理的 Godot 2D animation abstraction，而不是到處手動切圖。

---

## 11. Game loop / input

不要複製：

```text
WinMain
PeekMessage
GetMessage
DispatchMessage
Sleep
```

改用：

```text
SceneTree
  ↓
App
  ↓
Session
  ↓
World
  ↓
Map
  ↓
Entities
```

時間系統必須先驗證原 Client 真的依賴 frame time、tick、GetTickCount、timeGetTime、QueryPerformanceCounter 還是哪一種，再映射到 Godot。

Input 先還原：

```text
physical key
    ↓
logical action
    ↓
game command
    ↓
state transition
```

不要因為使用 Godot InputMap 就自行改掉舊 Client 的按鍵語意。

---

## 12. 建議的 Godot 專案結構

```text
Godot/
├─ project.godot
├─ main/
├─ core/
│  ├─ types/
│  ├─ serialization/
│  ├─ protocol/
│  ├─ time/
│  └─ diagnostics/
├─ resources/
│  ├─ wz/
│  ├─ loaders/
│  └─ cache/
├─ network/
│  ├─ tcp/
│  ├─ packet/
│  ├─ crypto/
│  └─ session/
├─ game/
│  ├─ world/
│  ├─ map/
│  ├─ character/
│  ├─ mob/
│  ├─ npc/
│  ├─ item/
│  ├─ skill/
│  ├─ quest/
│  └─ chat/
├─ rendering/
│  ├─ map/
│  ├─ character/
│  ├─ mob/
│  ├─ npc/
│  └─ effects/
├─ ui/
├─ audio/
├─ scenes/
├─ tests/
└─ tools/
```

可以調整，但必須保持：

> **data、protocol、domain/game state、rendering、UI、platform integration 分離。**

---

## 13. Packet architecture

不要把所有 opcode 塞進一個 `match opcode` 巨型檔案。

推薦：

```text
network/packet/
    reader.gd
    writer.gd
    registry.gd
    server_opcode.gd
    client_opcode.gd
    handlers/
        login/
        channel/
        character/
        map/
        mob/
        npc/
        item/
```

用 registry / class / callable dispatch。

每個 packet handler 必須容易定位、容易測試、容易從 evidence 追溯。

---

## 14. Evidence / provenance 必須是一等公民

建立：

```text
Godot/docs/evidence/
Godot/docs/architecture/
Godot/docs/protocol/
Godot/docs/resources/
```

重要逆向結論至少記：

```text
Finding:
Evidence:
Source:
Address / Function:
Reasoning:
Confidence:
Open questions:
Godot mapping:
```

Confidence：

```text
HIGH
MEDIUM
LOW
UNKNOWN
```

不要把猜測寫成事實。

---

## 15. 不確定時怎麼辦

先繼續查：

1. C
2. LST
3. caller / callee
4. string xref
5. data xref
6. binary constant
7. 同 subsystem 的相鄰 functions
8. Data.wz

只有合理證據全部耗盡，才允許局部 fallback。

fallback 必須：

- 明確標記 guessed / fallback
- 記錄原因與證據缺口
- 保持局部、可替換
- 不得假裝已確認

不要默默寫 `return 0`、`return null`、空 handler 或假資料。

---

## 16. 不要把現代 MapleStory 倒灌進來

目標是：

> **這個特定 2003 KMS 1.11 Client。**

不是現代 MapleStory，也不是泛用 MapleStory clone。

因此：

- 不自動加入後期職業
- 不自動加入後期地圖
- 不自動加入後期技能
- 不自動加入後期 UI
- 不自動加入後期封包
- 不用現代 WZ 規則覆蓋這份 Data.wz

外部版本只能交叉驗證，不得成為預設真相。

---

## 17. 第三方 DLL / codec

對 `ijl15.dll`、`l3codeca.acm`、`ZLZ.dll` 等，先找出 Client 真正依賴的資料格式與行為。

如果 Godot 原生能力已能正確完成：

> 優先 Godot-native implementation。

只有在格式相容性、正確性或 profiling 證明確有必要時，才加入 native compatibility layer。

---

## 18. 測試與 validation

每個 subsystem 都要有可獨立驗證的 test。

至少涵蓋：

```text
WZ header / path / property / canvas
packet reader / writer
opcode registry / handler
character
inventory
map
animation
```

能從原 Client / Data.wz 產生 golden/reference values 時，優先做：

```text
expected bytes
expected values
expected resource tree
expected frame count
expected origin / position
expected delay
expected string
```

然後讓 Godot implementation 比對。

---

## 19. 反編譯大型檔案的 tooling

不要反覆人工掃完整 LST。

建立：

```text
analysis/
    function_index.json
    string_index.json
    callgraph.json
    imports.json
    exports.json
    xrefs.json
    address_map.json
```

必要時建立 function-level chunk / query tool，讓 LLM 可以「查一個函式及其 caller/callee/xref」，而不是吃整個 70 MB LST。

---

## 20. Function naming policy

不要一開始把：

```text
sub_439E50
```

直接改成：

```text
NetworkClient.connect
```

先保留：

```text
original_function: sub_439E50
semantic_name: NetworkClient.connect
confidence: HIGH
```

一個 Hex-Rays function 可能只是 thunk、constructor fragment、destructor、COM plumbing、exception machinery 或 helper；一個現代 subsystem 也可能由多個舊 functions 合併而成。

> **不要追求 function 數量 1:1 對映。**

---

## 21. Performance 原則

優先級：

```text
Correctness
>
Evidence fidelity
>
Architecture
>
Maintainability
>
Profiling
>
Optimization
```

避免顯而易見的壞架構，例如：

- 每 frame 重解析 Data.wz
- 每 frame 重建 UI
- 每個 packet 建大量暫時 Dictionary
- 所有 entity 都堆在深層 Node hierarchy
- 啟動時把所有資源一次 decode

需要優化時，以 profiler 與實際 benchmark 為依據，不靠想像。

---

## 22. Implementation phases

### Phase 1 — Repository / Evidence index

完成：

- binary inventory
- C / LST inventory
- DLL dependency graph
- imports / exports
- string index
- function index
- call graph
- subsystem candidates
- WZ resource map

### Phase 2 — Core

建立：

- domain types
- serialization
- logging / diagnostics
- time
- resource abstraction

### Phase 3 — WZ

完成：

```text
Data.wz → parser → resource tree → canvas/string/vector/sound
```

### Phase 4 — Network foundation

建立：

```text
TCP
buffer
packet reader
packet writer
opcode registry
session
```

### Phase 5 — Rendering foundation

建立：

```text
camera
map layer
sprite
animation
effect
```

### Phase 6 — World

建立：

```text
Map
Foothold
Portal
Character
Mob
NPC
Drop
```

### Phase 7 — Player systems

建立：

```text
CharacterState
Stats
Inventory
Equipment
Skill
Quest
Chat
```

### Phase 8 — UI

依原 Client flow 復原所有重要畫面。

### Phase 9 — Integration

串起：

```text
Input
Network
World
UI
Resource
Audio
Rendering
```

### Phase 10 — Validation

持續：

```text
Original evidence
    ↓
Godot behavior
    ↓
compare
    ↓
fix
    ↓
document
```

---

## 23. 每一輪 LLM 工作規則

每一輪開始先檢查：

```text
Godot source
evidence docs
tests
migration status
```

然後：

1. 找出目前 subsystem 的缺口。
2. 回原始 C / LST / binary / WZ 查證。
3. 先形成 evidence-backed conclusion，再寫 code。
4. 修改最小必要範圍。
5. 做 syntax / static / test / project validation。
6. 檢查 guess、duplicate logic、dead code、giant class、hidden dependency、modern-version contamination。
7. 更新 migration status 與 evidence。
8. 才進入下一個 subsystem。

不要只是回覆 `done`。

每個重要階段回報：

```text
## Completed
## Evidence
## Architecture
## Files Changed
## Validation
## Remaining Unknowns
## Confidence
```

---

## 24. 第一輪具體任務

**不要第一輪就大量實作。**

先建立：

```text
Godot/
    project.godot
    docs/
        ARCHITECTURE.md
        MIGRATION_STATUS.md
        evidence/
            REPOSITORY.md
            BINARY.md
            NETWORK.md
            RESOURCES.md
            GAMEPLAY.md
            UI.md
analysis/
```

第一輪完成條件：

> 已能清楚說明 Client 的主要 subsystem、dependency graph、network flow、resource flow、UI flow、game-state flow；哪些已由 binary/LST/C/WZ 證實、哪些仍 UNKNOWN；以及每個 subsystem 為何應以目前的 Godot 架構重建。

---

## 25. 最終架構判斷

任何設計都先問：

1. 原 Client 實際做什麼？
2. 證據在哪？
3. 這是 gameplay / data semantics，還是舊 implementation detail？
4. implementation detail 能否用 Godot-native API 取代？
5. 取代後行為是否等價？
6. 未來是否容易升級與替換？

最終架構應接近：

```text
                 Godot App
                     │
          ┌──────────┼──────────┐
          │          │          │
          UI        Game       Audio
          │          │          │
          └──────┬───┴───┬──────┘
                 │       │
             Rendering  Network
                 │       │
                 └───┬───┘
                     │
                 Domain State
                     │
                Resource Layer
                     │
                  Data.wz
```

禁止變成：

```text
Godot
  ↓
FakeWin32
  ↓
FakeCOM
  ↓
FakeDirectX8
  ↓
HexRaysC
```

---

## 26. 最終硬性規則

> **不要把 Hex-Rays C 當原始碼。**
>
> **不要逐行翻譯。**
>
> **不要把 DirectX / Win32 / COM implementation detail 原封不動搬進 Godot。**
>
> **不要以後期 MapleStory 規則補這個 2003 Client。**
>
> **不要自行發明未被證據支持的 opcode、資料格式、玩法或數值。**
>
> **不要留下偽完成的 TODO / placeholder。**
>
> **每個重要結論都要有 evidence 與 confidence。**
>
> **每個重要 subsystem 都要可測試。**
>
> **現代化的是 implementation，不是 2003 KMS 1.11 的內容。**
>
> **最終目標是一個真正現代化的 Godot Client，而不是一份換語言的 Hex-Rays C。**
