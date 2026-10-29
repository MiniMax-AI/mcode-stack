# 参与贡献

[English](CONTRIBUTING.md)

欢迎开 issue 讨论。代码、文档和 stack 的 PR，目前只收仓库协作者的。还不是协作者的话，先[开一个 issue](https://github.com/MiniMax-AI/mcode-stack/issues/new/choose) 把想法说清楚。

下面是给协作者加 stack、改 stack 用的。

## 我们收什么

- **一份 stack = 一个人或一个团队真实的日常用法**：一份 `WORKFLOW.md`，加上至少一个 Skill 或清单。
- **不收**：纯 prompt 合集、没人在用的「理想流程」、和某个内部系统强绑定、别人没法跑的东西。
- 协作者也可以改已有的 Skill，请说清楚不改的话 agent 会在哪儿出错。

## 提交流程

协作者走完全部步骤。还不是协作者的，只做第 1 步。

1. **先开一个「New stack」issue**，用几句话说清楚你是谁、怎么用 agent、打算放哪几样东西。
2. **从模板复制**到 `community/<id>/`。`id` 只用小写字母、数字和连字符，并且要和 `.minimax-plugin/plugin.json` 里的 `name` 一致。
3. **登记到插件市场**：在 `.claude-plugin/marketplace.json` 里加一条，`"name"` 填 id，`"source"` 填 `"./community/<id>"`，`description` 和 `plugin.json` 里的保持一致。不要写 `skills` 等组件字段，这些由 `plugin.json` 定义。
4. **本地跑校验**，把输出贴进 PR：

   ```bash
   node scripts/check.mjs
   # 可选：同时跑 MiniMax Code 官方的插件校验
   git clone --depth 1 https://github.com/MiniMax-AI/minimax-code.git ../minimax-code
   MINIMAX_CODE_DIR=../minimax-code node scripts/check.mjs
   ```

5. **PR 里附一段真实的使用记录**：agent 在什么任务里用了这个 Skill，过程是什么样，结果怎么样。不要只贴最终结果。

## 修改已有的 stack

PR 只要改了某份 stack 里的文件，就要同时调高它 `.minimax-plugin/plugin.json` 里的 `version`（比如 `0.2.0` 改成 `0.2.1`）。从插件市场装的用户，只有版本号变高才会收到更新，所以不调版本号的改动 CI 会直接报错。如果这份 stack 还有 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` 或根目录的 `plugin.json`，里面的 `name`、`version`、`description` 和作者名要和 `.minimax-plugin/plugin.json` 保持一致。本地可以用 `CHECK_BASE=origin/main node scripts/check.mjs` 跑同样的检查。

## 怎么审

每个 PR 至少一位维护者审，看三件事：

- **能不能跑**：校验通过；在 MiniMax Code 里装上后 `/skills` 能看到；agent 能按 `description` 正确加载。
- **是不是真在用**：使用记录要能看出过程，而不只是结论。这也是我们对自己的要求：看 agent 怎么得到结果，不只看结果。
- **安全和边界**：不带密钥、token、内部地址；脚本不做超出说明的事；第三方内容注明出处和许可。

审的时候一般会请作者回答一句：「删掉这个 Skill，你的 agent 会在哪儿犯错？」答不上来的，我们可能会建议先合进已有的 Skill。

## 收录之后

- 进了 `community/`，作者就是这份 stack 的维护人。后续改动同样由协作者提 PR。
- 长期没人维护、和新版 MiniMax Code 对不上的，会先标记，再移到归档区。
- 写得好、用的人多的，会在工程笔记或官方渠道里介绍。

## 写好一个 Skill

- frontmatter 里的 `name` 和目录名一致；`description` 一句话写清做什么、**什么时候**用。值里有 `: ` 的话要加引号。
- 步骤要是 agent 真能执行的，按顺序写，并写清每一步怎么确认做对了。
- 要求 agent 拿证据说话（文件、命令、真实输出），不要让 Skill 编数字。
- 写清最后要交回什么。

## 许可和行为规范

提交即表示你同意按本仓库的 [MIT License](LICENSE) 发布。第三方内容沿用它原来的许可，请注明出处，并在 stack 的 `NOTICE.md` 里写清许可。在 issue 和 review 里请保持尊重、就事论事。
