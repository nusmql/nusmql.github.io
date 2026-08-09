---
author: Lei
pubDatetime: 2026-08-09T18:00:00Z
title: "Verda CLI v1.8.0:一次硬核加固——TUI 收编、双模型对抗审查,与过程中的心得"
featured: false
draft: false
tags:
  - release
  - cli
  - ai-agents
  - infrastructure
description: Verda CLI v1.8.0 发布了。changelog 之外,这次发布来自一次 TUI 核心的收编和一轮全代码库的对抗式 AI 审查。记录一下过程与心得。
locale: cn
translationKey: verda-cli-v1-8-0-hardening
---

_我是 [verda-cli](https://github.com/verda-cloud/verda-cli) 的作者。这篇是个人视角的 [v1.8.0](https://github.com/verda-cloud/verda-cli/releases/tag/v1.8.0) 发布记,以及这次过程里学到的几件事。_

## 目录

## 这次发了什么

v1.8.0 是一次加固(hardening)性质的发布。简明清单:

- **TUI 核心收编进 CLI 仓库**(`pkg/tui`、`pkg/log`、`pkg/version`,自 [verdagostack](https://github.com/verda-cloud/verdagostack) v1.4.2 拷入)。不再依赖外部模块,不再需要 replace 联调的杂技。
- 修掉一个用户报的真 bug([issue #54](https://github.com/verda-cloud/verda-cli/issues/54)):`vm create` 向导里,你先加了块存储卷、再选一次 "None (skip)",刚加的卷就被静默丢弃——光标停在第 0 行,一个回车,白配了。
- **定价语义修正**(对着线上 API 实测了两次):`price_per_hour` 是实例的**总价**,有个仪表盘路径把它又乘了一遍 GPU/vCPU 数量。
- Agent 模式补齐护栏:交互提示快速返回结构化错误,破坏性操作一律要求 `--yes`,用法错误退出码 2,`vm create`/`vm action` 如实返回 `accepted`,显式加 `--wait` 才轮询。
- 向导引擎彻底修了一轮:一个数据竞争、一条无限重试路径、内联校验错误、诚实的取消契约。
- `verda update` 和 curl 管道安装脚本现在**失败即中止**(fail-closed)地校验校验和,消费发布管线早已产出的签名校验文件。
- MCP 服务端:初始化竞态修复,破坏性工具必须 `confirm: true`,静默参数强转改为报错。
- 新增 **hermetic 契约测试套件**:真二进制打进程内 mock API——无网络、无 sleep、跑进 `make test`。测试从此带 `-race`。

大约二十个修复,每一个都带回归测试或契约钉扎。

## 心得一:联调太疼的时候,就把 TUI 核心 vendor 进来

TUI 栈以前住在独立仓库 verdagostack。改一个提示文案这种小事,也要:改那边 → 评审 → 发版 → 这边升依赖 → 验证。一行的改动,走俩小时流程。

本地倒是有 `replace => ../verdagostack` 的联调法子,但 CI 里不生效,还老跟发布版本漂。这次干脆把包拷进来(Apache-2.0、同组织、正对 v1.4.2 tag,是最干净的迁移点),删掉整条依赖。

收益立竿见影:审查中发现的向导引擎竞态,和其余修复在同一个 commit 里带 `-race` 回归测试落地、进同一条 CI。有个坑值得记录:我们的 `.gitignore` 里一条模板生成的 `*testing` 规则,把 `pkg/tui/testing/` 目录**静默吞了**——本地一切正常,推上去的分支根本编不过。从此以后我对"慷慨的 gitignore 模板"默认不信任。

上游仓库保留它的副本(还有别的消费者);我们这份已经领先。修稳了之后我会回港。

## 心得二:对抗式双模型审查有效——前提是你要求证据

这次发布的核心重构来自一次结构化的双模型审查,这个流程以后还会用:

1. **八路并行审查**覆盖全仓(定价、agent 契约、向导引擎、更新链路、MCP、registry/对象存储……),每条发现必须带 file:line 证据。
2. **第二个模型独立复核**头部发现,对抗性地。竞态、agent 模式挂死、30 秒截断,它都亲手复现了一遍。
3. **两边结论打架时,上 staging 找事实。** `price_per_hour` 到底是单价还是总价,这个语义在文档史上翻转过两次,两个评审都一度绕进死循环。一个约 $0.003 的实验(开一台最便宜的按需实例,直接读字段)永久结案。答案固化成 JSON fixture + 回归测试——因为文档已经被证明是不可靠的神谕。

第二遍审查比第一遍更值钱:它指出我那个"决定性实验"其实只能在单方向上判别(比例不变性),然后在 git 历史里翻出了真正的铁证。SOTA 模型极其擅长找出可疑代码,极其不擅长知道自己什么时候才算证明了什么——所以流程必须强制要证据:要么复现,要么实测,否则不算数。

之后每个修复单独成 commit、先写失败测试再修。一共十九个。

## 心得三:skills/runbook 是产品面,不是文档

CLI 里内嵌了 agent skills(`verda skills install`——给编码 agent 用的决策引擎 + 命令参考)。这一轮加固改了好些 agent 可见的行为——新的 `--yes` 门、wait 语义、退出码——而 skill 文件悄悄全漂了。`skills status` 的版本比对只有在你记得升 manifest 时才有用;现在我们升(1.1.0 → 1.2.0 号给了新目标)。

编码 agent 越来越多,安装目标这次也加上了 **Kimi Code、OpenCode、Pi**——三家都收敛到同一个 `<name>/SKILL.md` 约定,几乎零成本。

## 值得一提的边角

- CI 钉的 `golangci-lint` v2.5.0,而本地机器全都漂到了 v2.11——一个仓库,两种"全绿"。现在统一钉死,CI 的 gosec 独立车道(无视配置)也在本地 gate 里对齐了。
- 文档一直写 "make test 含 lint",实际不含。这类漂移平时隐形,一旦出事就现形。

## 预告

Serverless 集成正在研发中——容器和无服务器批处理将作为一等公民的 `verda` 命令出现。敬请期待。

---

_完整发布:[verda-cli v1.8.0](https://github.com/verda-cloud/verda-cli/releases/tag/v1.8.0)。主要 PR:[#55](https://github.com/verda-cloud/verda-cli/pull/55)(TUI 收编)、[#56](https://github.com/verda-cloud/verda-cli/pull/56)(向导存储修复)、[#57](https://github.com/verda-cloud/verda-cli/pull/57)(加固)。_
