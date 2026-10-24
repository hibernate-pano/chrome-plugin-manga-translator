# Round 13 audit — 三个 P0，和它们背后的那个词

上一轮（10-23 的深入体检）没有改代码，只记了 **5 个 P0 + 9 个 P1**。
这一轮关掉其中三个 P0。它们是三件不同的事，但根子是同一个：

> **两个上下文在写同一份账，而规则只认得其中一个。**

---

## P0-1 — 账单会变少，而且少了的部分找不回来

### 现象

`src/stores/usage-store.ts` 里，每个月只有一份「本月累计」的累加器记录。
worker 记了一笔 120 token，一个**更早 hydrate 过**的上下文（比如设置页
打开着）再记一笔 10 token，它那份不含 worker 数据的快照就把 120 覆盖
成了 10：

```
after worker write:    acc-2026-10 byDay tokens=120
after stale ctx2 write: acc-2026-10 byDay tokens=10   <- 120 消失
FINAL summary: {"translations":1,"billableCalls":1,"tokens":10}
```

用户看到的账单**比真实的少**。明细记录还在，所以能看出少了一次调用；
但那 120 token 本身没了 —— 累加器是被**替换**掉的，不是被合并的。

### 根因

累加器的 id 只带月份：`acc-2026-10`。

两个上下文算出**同一个 id**，于是 `unionRecords` 认为「这是同一条记录的
两个版本」，按「时间戳新的赢」取一个。而这个规则只对**同一个写者的同一
条血脉**成立：worker 自己的多次写入，保留新的那份是对的。**两个不同的
写者共用一个 id 时，它变成了一场「谁后写谁赢」——后写的那个把前一个的
数字整个替换掉。**

### 修法

id 里带上**写者身份**：

```ts
const WRITER_ID =
  typeof window === 'undefined' ? 'worker' : `page-${CONTEXT_ID}`;
```

- worker 用固定的 `'worker'` —— 它是 MV3 的 service worker，空闲 30 秒就
  被回收，30–60 秒就要重启一次；id 必须跨重启稳定，否则每重启一次就多
  一份累加器。
- 页面（弹窗、设置页）用 `page-${CONTEXT_ID}` —— 每个页面实例一份，互不
  干扰。

两个写者现在握着**互不相交**的总额，`collectUsage` 把它们加起来。写者
变了，id 就变了，冲突的前提就消失了。

> 这里用 `typeof window === 'undefined'` 区分 worker 和页面：service worker
> 没有 `window`，扩展页面有。这不是取巧，是这条边界上唯一一个能同时在
> 两侧成立的判据。

### 验证

两个测试，都做过变异验证（改坏实现 → 测试必须变红）：

| 测试 | 变异后 |
| --- | --- |
| 「早 hydrate 的上下文不会让账单变小」 | 红：`expected 120 to be 130` |
| 「一个月一份累计，不是每重启一份」 | 红：累加器变成 2 份 |

第二个测试用 `vi.stubGlobal('window', undefined)` 模拟 worker，
`vi.resetModules()` + 动态 `import()` 造出第二个上下文 —— 两个进程
共用一个 `chrome.storage.local` 的真实形态。

---

## P0-2 — 列举模型的超时被算成了花钱，真实的超时反而不算

### 现象

`src/providers/openai-compatible-base.ts` 两处 408 的判断，正好反了：

| 位置 | 请求 | 原来 | 应该 |
| --- | --- | --- | --- |
| `:346` | `GET /models`（列举，模型没跑） | **记了账单** | 不记 |
| `:412` | chat completion（真跑了模型） | **不记** | 记 |

更糟的是 `allowBillableProbe: false`（设置页每 15 分钟的健康轮询用的正是
这个参数）只挡住了 404 分支，挡不住这条。于是：网关一慢，用户的账上就
每 15 分钟多一次「计费调用」，而服务商根本没为他跑过任何模型。

### 根因

计费规则被写在**错误的调用点上**。规则的正确表述是「**跑了模型的请求
才计费**」，但代码把它写成了「返回了错误的请求才计费」——两个不同的问
题。`/models` 是个列举接口，它问网关「你有哪些模型」，从没跑过一个。

### 修法

规则跟着问题走：

- `/models` 超时 → **不记**。这是列举，模型没跑，没有东西要收钱。
- chat completion 超时 → **记**。服务商可能已经跑了模型、也已经回了，只是
  我们没听见。用户付了钱，我们看不见不等于他没付。

`src/providers/usage-recording.ts` 的文档也同步改了 —— 之前那段注释
写着「只有超时算」，读的人会以为超时一律算。

### 验证

三个测试（列表超时、轮询超时、chat 探针超时），全部做过变异验证：
改回去之后分别红成 `1 vs 0`、`1 vs 0`、`0 vs 1`。

---

## P0-3 — 第一道门在干净 checkout 上是空转的

### 现象

凭据边界有两道门（`scripts/check-release-consistency.mjs`）：

1. **源码门禁**（`checkCredentialBoundary`）：走 import 图，看内容脚本
   有没有碰到凭据模块。
2. **产物门禁**（`checkNoCredentialsInContentScript`）：扫 `dist/content.js`
   的字节。

第二道是真的，第一道有洞。而且第一道跑的位置也不对。

### 根因（两处）

**洞**：判定 type-only import 的正则漏了三种形态。

| 形态 | 原来 |
| --- | --- |
| `import { X } from '...'` | CAUGHT |
| `import X from '...'` | CAUGHT |
| `import * as X from '...'` | CAUGHT |
| `import X, { type Y } from '...'` | **MISSED** |
| 缩进的 import | **MISSED** |

**位置**：`--source-only` 跑在 `inject-env-config.mjs` **之前**。而源码门禁
要看的正是 `src/shared/env-credentials.generated.ts` —— 那个文件是注入
脚本生成的。干净 checkout 里它还不存在，门禁于是**无图可走**，给出一个
虚假的绿灯。

（所以这一条的严重级别不是「密钥会泄漏」—— 产物门禁拦得住。真实的
严重级别是「CI 的第一道门空转」，以及它让人以为源码层已经被守住了。）

### 修法

- 判据换成逐个 import 子句地看：只有当**所有**具名绑定都是 `type` 前缀、
  且没有 default / namespace 绑定时，才算 type-only。
- 所有正则允许行首空白。
- `package.json` 里把 `inject-env-config.mjs` 挪到 `--source-only` 之前
  （`build` 和 `build:public` 都是）。

### 验证

三个测试：带 default 绑定的 type-only 混写、缩进的 import、以及一条
**读 `package.json` 断言注入顺序**的测试。全部做过变异验证。

---

## 还开着的

### 9 个 P1（上一轮体检确认，尚未动）

| # | 发现 | 位置 |
| --- | --- | --- |
| 4 | 旧轮的迟到回调把已清除的译文画回页面 | `content.ts:1082/1125/1506/2031` |
| 5 | 换图后旧译文画到新图上 | `content.ts:901-949/1125` |
| 6 | 换章后旧章结果记到新章，新章图被永久跳过 | `content.ts:1805/2634-2665` |
| 7 | 取消后互斥锁不释放，第二次点击被静默吞掉 | `content.ts:1429-1438/1983` |
| 8 | 右键单图翻译被上一轮的取消状态连累（花钱没结果） | `content.ts:1082/2163` |
| 9 | 精修的包含度判据在「墨迹 ⊇ 模型框」时恒为 1，护栏不响 | `text-box-refiner.ts:640-655` |
| 10 | smoke 测试把「内容脚本完全失聪」判为通过 | `smoke-test-public-build.mjs:447` |
| 11 | `expect(true).toBe(true)` —— keepalive 与并发度热更新零覆盖 | `background-auth.test.ts:811` |
| 12 | 承诺锚点只验字符串存在性，符号删了留注释也算通过 | `check-store-claims.mjs:77-85` |

其中 4/5/6 是同一组：根因是 `translationCancelled` 是**模块级布尔量**
而不是 per-run 的 token。`translationRunGeneration` 已经是现成的机制，
但只用在了一半的地方 —— 把剩下的检查点补上，这三条能一起解决。

### 门禁脚本自己没有被变异验证

项目已经确立了「新测试必须做变异验证」，但这套规矩只覆盖了**产品代码
的测试**，没覆盖**门禁脚本**。#10 和 #12 就是这么来的：一个把「内容脚本
完全失聪」当通过，一个把「符号删了、注释还在」当通过。

### 上架仍然是 Jasper 一个人的事

自动化已经就位（`pnpm release:publish` 会打包、上传、发布），但
Chrome Web Store 的 dashboard item、`PUBLISHER_ID` / `ITEM_ID`、Google
Cloud 的 API 凭据、支持页 URL —— 这些在仓库里一份都没有，只有 Jasper
能建。
