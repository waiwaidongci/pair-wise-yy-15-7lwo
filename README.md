# 标签工坊

面向昆虫标本馆的标签排版与批量打印工具。支持纸张毫米尺寸、多栏布局、边距、间距、字号和边框配置；可导入标本 CSV，自动检查缺失字段与超长内容；支持拉丁学名斜体和长名称自动换行。

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```

模板、清单和打印批次保存在浏览器本地，不需要服务器。

## 打印批次如何对得上序号

模板、标本清单和打印批次在「打印批次」页接成一条流水线，解决换纸、改栏数后已打印标签与剩余标签对不上的问题：

- **开打前只排队，开打时才定序号**：新建打印任务时按当前模板的当页容量分页，一张纸 = 一个批次，超出容量的标签自动排到后续批次；每张标签的连续序号（`#0001…`）在点「开打队首批」的瞬间才锁定并印在标签角上。
- **模板 / 栏数改动，未开打批次自动失效重算**：换纸、改栏数（或任何模板参数）后，引用该模板的排队批次按新容量重新分页并冻结新模板快照；开打中、已打完的批次快照与页数原样保留，顺序不乱。字号等不影响每页容量的外观参数只体现在容量指纹之外。
- **两位馆员同时开打同一批，只让先到的那批成立**：同一浏览器的多个标签页代表不同工位，通过 BroadcastChannel + localStorage 仲裁；先提交者赢得该批并锁定序号，后提交者收到提示并看到「对方开打中」，落败方无法确认或打印该批。
- **打完的顺序留住**：每批打印后点「确认打完」，状态进入终态留档，任何工位都不能改回；下一批开打时序号紧接其后。
- **写入失败可重试**：本地存储写入失败时不回滚、不清空，原清单与已排批次保留在页面并出现重试横幅，修好存储空间后一键重试落盘。
- 入队即冻结标本与模板快照，之后清单增删改、模板再调整都不影响已排队 / 已打印的批次；打印纸尺寸以锁定批次的模板快照为准。

## 逻辑自检脚本

纯业务规则（分页、序号、失效重算、并发仲裁、失败重试）可用 esbuild 打包后在 Node 中跑断言：

```bash
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild scripts/verify-batches.ts --bundle --platform=node --format=esm --outfile=/tmp/v.mjs && node /tmp/v.mjs
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild scripts/verify-merge.ts   --bundle --platform=node --format=esm --outfile=/tmp/v.mjs && node /tmp/v.mjs
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild scripts/verify-claim.ts   --bundle --platform=node --format=esm --outfile=/tmp/v.mjs && node /tmp/v.mjs
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild scripts/verify-persist.ts --bundle --platform=node --format=esm --outfile=/tmp/v.mjs && node /tmp/v.mjs
```
