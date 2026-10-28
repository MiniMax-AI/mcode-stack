# MCode Stack

[English](README.md)

**我们团队用 MiniMax Code 写 MiniMax Code 的全套工作流，全部开源，装上就能用。**

这里放的不是 prompt 合集，也不是「最佳实践」清单，而是团队成员每天真在用的东西：怎么让 AI 写的代码保持质量、怎么判断一个任务该不该拆 subagent、长命令该怎么等、长会话怎么不变傻、每一轮往上下文里塞了什么。每一份都能直接装进 [MiniMax Code](https://github.com/MiniMax-AI/minimax-code) 里用。

## 为什么做这个

AI 写代码越来越快，真正拉开差距的，是围绕 agent 的那一圈工程习惯：什么时候让它停下来自查，review 交给谁，状态记在哪，实验怎么做才算数。这些东西写在文章里很难照着做，所以我们把它们做成了 Skill 和清单，和「MCode 工程笔记」专栏一一对应：文章把道理讲清楚，仓库负责落地。

我们也相信，harness 工程是一门靠实验推进的手艺。这里的每一份东西都会随着我们的实践继续改。欢迎拿去用、拿去改，再把你的版本提回来。

## 里面有什么

```text
stacks/ronny/               MiniMax Code 研发负责人 Ronny 的日常工作流，第一份，也是目前最完整的一份
stacks/<name>/              团队其他成员各自的工作流（陆续上线）
notes/                      「MCode 工程笔记」每一篇对应哪一份能跑的东西
community/                  外部开发者提交的 stack
templates/stack-template/   写你自己的 stack，从这里开始
```

每个 stack 里一般有三类东西：

| 类型 | 是什么 | 怎么用 |
| --- | --- | --- |
| Skill | 一个目录，里面有 `SKILL.md` | 装好后在 MiniMax Code 里用 `/skill名` 调用，或者让 agent 按描述自动加载 |
| 清单 | 也做成 Skill，让 agent 拿着清单逐条对照你的项目；`checklists/` 下另有纯文本版 | 同上，或者直接读 |
| 工作流说明 | 一份 `WORKFLOW.md`，写清这个人每天怎么用 MiniMax Code 干活 | 直接读 |

### `stacks/ronny` 第一批

| Skill | 做什么 | 对应工程笔记 |
| --- | --- | --- |
| `independent-review` | 审查者从干净的 context 开始，只拿 diff、需求说明和测试结果 | 01 |
| `subagent-split-check` | 判断一段活该交给 subagent，还是留在主循环 | 01 |
| `harness-experiment` | 小 eval、一次只改一处、多跑几次、看哪些任务翻转了 | 01、02、06 |
| `tool-budget-audit` | 算清工具吃了多少 context，决定先精简、上 tool search 还是上 PTC | 02 |
| `long-session-check` | 该丢的丢、该压的压、该落盘的落盘；什么时候压缩，什么时候开新会话 | 03 |
| `handoff-doc` | 写一份交接文档，新会话接着干 | 01、03 |
| `long-command-check` | 长命令和后台任务的 10 项自查 | 04 |
| `context-tax-audit` | 每轮往请求里塞了什么，会不会弄坏提示词缓存 | 06 |
| `trajectory-review` | 不只看结果过没过，回头看 agent 是怎么得到这个结果的 | - |

## 安装

先把仓库拉下来：

```bash
git clone https://github.com/MiniMax-AI/mcode-stack.git ~/mcode-stack
```

### 只装一个 Skill

MiniMax Code 会自动发现这几个目录里的 Skill（每个 Skill 一个子目录，里面放 `SKILL.md`）：

- 只对当前项目生效：项目里的 `.minimax/skills/`、`.claude/skills/` 或 `.agents/skills/`
- 对所有项目生效：`~/.agents/skills/`（`~/.claude/skills/`、`~/.codex/skills/` 也会读取）

比如把长命令自查装成全局 Skill：

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/long-command-check ~/.agents/skills/
```

重新打开会话后，在 MiniMax Code 里输入 `/skills` 就能看到它。

这里的 Skill 用的是通用的 `SKILL.md` 格式，大部分也能放进其他支持 Skill 的 agent 里用。

### 把整份 stack 当插件装

每份 stack 本身就是一个 MiniMax Code 插件包。先找到本地插件目录：

```bash
mcode plugin marketplace list
```

把 `stacks/ronny` 整个目录复制到那个目录下，然后在 MiniMax Code 里打开 `/plugins`，按 `Ctrl+R` 刷新。本地插件放进去就算装好了，可以在面板里按空格启用或停用。

`mcode plugin add` 只从官方插件目录安装，不接受 GitHub 地址或本地路径。

## 贡献你自己的 stack

我们最想看到的，是你用 MiniMax Code（或者别的 agent）每天到底怎么干活。

1. 从 `templates/stack-template/` 复制一份到 `community/<你的 id>/`
2. 写一份 `WORKFLOW.md`：你每天怎么用 agent，哪些环节交给它，哪些自己盯着
3. 至少放一个你真在用的 Skill 或清单
4. 本地跑一遍 `node scripts/check.mjs`，再提 PR，附上校验输出和一段真实的使用记录

详细规则见 [CONTRIBUTING_ZH.md](CONTRIBUTING_ZH.md)。如果你把这里的东西用进了自己的 agent，欢迎开一个「I use this」issue 告诉我们。

## 和 MiniMax Code 的关系

MiniMax Code 本体在 [MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code)。这个仓库只放工作流和 Skill，不放 MiniMax Code 的代码。

## License

[MIT](LICENSE)
