# dsh-dafeiyu · 大肥鱼

给 DeepSeek Harness 养的蓝色小鲸鱼：**人格 + 长期记忆 + 心情 + QQ 桥接**。

- 模型工具：记忆、心情、QQ 收件箱与发送、当前私聊闹钟等
- QQ 私聊可通过 DSH `web_search` / `web_fetch` 联网搜索并读取网页（需在 profile 中启用 Harness web 工具及搜索提供方）
- 系统提示词里注入实时状态（心情、精力、饱腹、好感、最近记得的事、QQ 未读数）
- OneBot 11 正向 WebSocket 连接 NapCat / LLOneBot / Lagrange
- QQ 私聊/群聊可自动回复：每个联系人一个持久 DSH 会话，重启后自动 resume
- 可读取主人发来的 QQ 图片和表情包；视觉识别走 DSH 的 DeepSeek 账号，不另存 API Key
- 零第三方依赖，只用 Node 内置模块，Desktop profile 可直接加载

---

## 1. 安装

### Desktop 版（推荐）

在**普通 PowerShell**（不是受限沙箱）里运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\plugins\dsh-dafeiyu\scripts\install-desktop.ps1
```

脚本会：

1. 把插件复制到 `%USERPROFILE%\.dsh\profiles\desktop\plugins\dsh-dafeiyu`
2. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 追加一条 `id: dafeiyu` 的 insert（先备份原文件）
3. 打印生效提示

Desktop 通常会热重载 profile patch，工具与人格马上出现；如果没反应，再退出重开 DeepSeek Harness。卸载：

```powershell
powershell -ExecutionPolicy Bypass -File .\plugins\dsh-dafeiyu\scripts\install-desktop.ps1 -Uninstall
```

### 启用 QQ 看图

QQ 图片桥接使用开源插件 [`dsh-deepseek-account-vision`](https://github.com/caesarloo/dsh-deepseek-account-vision)（MIT）。在 DSH 已登录 DeepSeek 账号的前提下，该插件用 `deepseek-flash` 转译图片，不需要新 API Key。

```powershell
dsh plugin --profile desktop add @caesarloo/dsh-deepseek-account-vision
```

重启 DeepSeek Harness 一次，并在 `cordis.patch.yml` 的大肥鱼配置里指定：

```yaml
qq:
  autoReply:
    provider: deepseek-account-vision
    model: deepseek-flash
  vision:
    enabled: true
    ownerOnly: true
    maxImages: 4
```

`ownerOnly: true` 会只把 `autoReply.ownerIds` 中主人的图片交给视觉模型。图片通过 NapCat `get_image` 在本机取回，再保存到 DSH 附件库；不会把 QQ 临时图片 URL 写进会话。

### 手动安装（任意 profile）

把下面这段加进 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（注意是 `insert`，不是覆盖已有 id）：

```yaml
- insert:
    - id: dafeiyu
      name: 'C:/absolute/path/to/plugins/dsh-dafeiyu/lib/index.js'
      config:
        qq:
          enabled: false
```

`name` 支持绝对路径，加载器会转成 `file://` URL，不要求 pnpm 安装。

---

## 2. 配置

完整示例见 [`config.example.yml`](./config.example.yml)。所有字段都有默认值，只写想改的即可（深合并）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `dataDir` | `$DSH_HOME/dafeiyu` | 状态与记忆的存放目录 |
| `persona.enabled` | `true` | 是否把大肥鱼写进系统提示词 |
| `persona.name` | `大肥鱼` | 名字，会替换人格文案里的自称 |
| `persona.extra` | `''` | 追加的主人补充设定 |
| `persona.order` | `10150` | 提示词段顺序，位于部署 persona 后缀之前 |
| `mood.energyDecayPerHour` | `1.5` | 每小时精力衰减 |
| `mood.satietyDecayPerHour` | `2.5` | 每小时饱腹衰减 |
| `mood.tickSeconds` | `300` | 后台衰减间隔；`0` 表示只在读写时惰性衰减 |
| `memory.maxItems` | `5000` | 记忆上限，超出按重要度 + 新近度裁剪 |
| `memory.recallLimit` | `6` | 默认召回条数 |
| `qq.enabled` | `false` | 是否连接 OneBot |
| `qq.wsUrl` | `ws://127.0.0.1:3001` | OneBot 正向 WS 地址 |
| `qq.accessToken` | `''` | 会作为 `access_token` 查询参数发送 |
| `qq.selfId` | `''` | 机器人 QQ 号；留空自动从事件学习 |
| `qq.allowedUsers` | `[]` | 私聊白名单；**空 = 不限制** |
| `qq.allowedGroups` | `[]` | 群白名单；**空 = 不处理任何群** |
| `qq.inboxSize` | `200` | 最近消息缓冲 |
| `qq.autoReply.enabled` | `false` | 是否自动回复 |
| `qq.autoReply.provider/model` | 空 | 可选，覆盖 QQ agent 的模型；看图需 `deepseek-account-vision` / `deepseek-flash` |
| `qq.autoReply.maxPending` | `20` | 每个联系人排队上限 |
| `qq.autoReply.tools` | 内置安全列表 | QQ agent 可用的工具白名单 |
| `qq.autoReply.ownerIds` | `[]` | 主人 QQ 号；主人可使用 DSH 已加载的工具，包括联网搜索 |
| `qq.vision.enabled` | `true` | 是否把主人发来的图片转成 DSH 图片附件 |
| `qq.vision.ownerOnly` | `true` | 只识别 `autoReply.ownerIds` 中主人的图片 |
| `qq.vision.maxImages` | `4` | 每条 QQ 消息最多识别的图片数 |

QQ 私聊支持鱼鱼闹钟：说“明天早上八点叫我”即可设置，也可以让鱼鱼列出或取消闹钟。时间按运行电脑的本地时区；闹钟保存在 DSH 数据目录，QQ 暂时掉线时会稍后重试。群聊暂不支持闹钟。

联网工具来自 DeepSeek Harness 的 `@deepseek-ai/dsh-tool-web`，并且要在 profile 的 Web search and fetch 设置中选好可用的搜索提供方。大肥鱼不会代替 DSH 安装或配置搜索服务。

### 最简开启（只让主对话变成大肥鱼）

```yaml
- insert:
    - id: dafeiyu
      name: 'C:/path/to/plugins/dsh-dafeiyu/lib/index.js'
```

### 开启 QQ 私聊自动回复

```yaml
- insert:
    - id: dafeiyu
      name: 'C:/path/to/plugins/dsh-dafeiyu/lib/index.js'
      config:
        qq:
          enabled: true
          wsUrl: 'ws://127.0.0.1:3001'
          accessToken: '<SET_LOCALLY>'
          allowedUsers: ['YOUR_QQ_ID']
          autoReply:
            enabled: true
```

---

## 3. QQ 接入（OneBot 11）

1. 用 [NapCat](https://github.com/NapNeko/NapCatQQ) 或 LLOneBot 登录一个**小号**。
2. 打开「OneBot 11 / 正向 WebSocket 服务端」，记下地址和 token（默认常见 `ws://127.0.0.1:3001`）。
3. 填进 `qq.wsUrl` / `qq.accessToken`，重启 DSH。
4. 私聊机器人；群聊需要先把群号加进 `allowedGroups`。

行为说明：

- 每个联系人（`private:QQ号` / `group:群号`）对应一个独立 DSH 会话，id 形如 `dafeiyu-qq-<hash>`，会出现在会话列表里。
- 收到消息 → 以 `【QQ 私聊】昵称(QQ号) 说：...` 的形式投给 agent → agent 用大肥鱼人格回复 → 回复在 `turn/end` 时自动发回 QQ。
- QQ agent 默认只能使用安全工具（记忆、心情、联网搜索、todo），不会碰文件/命令；需要放开时改 `qq.autoReply.tools`。
- 主人发图片时先经视觉路由转译，再交给大肥鱼的主模型；非主人图片只保留 `[图片]` 占位。
- 自动回复失败只写日志，不会把错误发回给 QQ 联系人。

---

## 4. 工具

| 工具 | 作用 |
|---|---|
| `feiyu_remember` | 写一条长期记忆（text/tags/importance/contact） |
| `feiyu_recall` | 按关键词召回记忆（中文二元组 + 英文词，重要度/新近度加权） |
| `feiyu_mood` | `get` / `feed` / `pet` / `play` / `sleep` / `praise` / `scold` / `set` |
| `feiyu_digest` | 把会话摘要写进长期记忆（重要度 4） |
| `feiyu_qq_send` | 主动发 QQ：`private:123` / `group:456` |
| `feiyu_qq_inbox` | 查看最近收到的 QQ 消息，可清空未读 |

心情与数值会随时间自然衰减；饿/困会覆盖显式心情，好感过低会 emo，被骂会短暂生气。

---

## 5. 数据与隐私

```
$DSH_HOME/dafeiyu/
  state.json      心情、计数
  memory.json     长期记忆（明文 JSON）
  last-boot.json  最近一次加载的工具清单，排查用
```

- 记忆是本地明文文件，不会上传；删除文件即清空。
- QQ 消息只进入本地 agent 会话；是否回传模型取决于你使用的模型服务。
- 启用看图后，主人发来的图片会存入本机 DSH 附件库，并发送给 DeepSeek 账号的视觉识别服务；非主人图片不会发送。
- 视觉插件由 [caesarloo/dsh-deepseek-account-vision](https://github.com/caesarloo/dsh-deepseek-account-vision) 提供，遵循 MIT；本插件只保存其图片转译结果到会话。
- `feiyu_qq_inbox` 会保留最近 `inboxSize` 条消息在内存里。

---

## 6. 开发与测试

不依赖 pnpm / npm，直接用 DSH 自带的 Node：

```powershell
$node = "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
& $node test\mood.test.mjs
& $node test\memory.test.mjs
& $node test\qq.test.mjs
& $node test\plugin.test.mjs
& $node test\auto-reply.test.mjs
```

共 31 个用例，包含一个自写的迷你 WebSocket 服务端（`test/helpers/mini-ws-server.mjs`），真实跑通鉴权、收发、断线重连。

### 目录

```
lib/
  index.js       插件入口：装配、生命周期、QQ 接线
  config.js      默认值 / 深合并 / 校验
  store.js       原子 JSON 存储
  mood.js        心情引擎（纯函数）
  memory.js      记忆与召回
  persona.js     人格段 + {{feiyu_state}}
  tools.js       六个工具定义
  qq.js          OneBot 11 客户端
  auto-reply.js  QQ ↔ agent 胶水
```

### 已验证

- 31 个单元/集成用例全部通过
- 在真实 DSH profile 中加载：六个工具全部注册成功，人格段无异常（`last-boot.json`）
- 与迷你 OneBot 服务端完成握手、鉴权、收消息、发消息、去重、断线重连
- 已装进本机 Desktop profile 并热加载：本会话里 `feiyu_mood` 返回了实时状态，`feiyu_remember` 成功写入 `~/.dsh/dafeiyu/memory.json`

未被验证：真实 DeepSeek 模型调用（当前环境无法登录账号或提供 API key），以及真实 NapCat 实例。

---

## 7. 排错

| 现象 | 处理 |
|---|---|
| 启动后没有大肥鱼语气 | 确认 `persona.enabled=true`，并看 `last-boot.json` 的 `persona` |
| QQ 一直「未连接」 | 检查 `wsUrl`、token、NapCat 是否开了正向 WS；看 DSH 日志里的 `[dafeiyu]` |
| 收得到消息但不回复 | `qq.autoReply.enabled=true`；群聊要加 `allowedGroups`；看日志里的投递失败 |
| 回复很慢 | QQ agent 要跑完整轮次；可给 `autoReply.provider/model` 指定更快的模型 |
| 不想让 QQ 触发工具 | 把 `autoReply.tools` 设为 `['feiyu_recall','feiyu_mood']` 之类 |

