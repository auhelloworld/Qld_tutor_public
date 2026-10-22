# Qld_tutor 双仓方案：自用仓（private）→ 公开仓（public）

## 结构

| 仓 | 可见性 | 内容 | 用途 |
|---|---|---|---|
| `Qld_tutor_private`（由现仓改名） | private | 代码 + 全部题库（含 Mathspace 6,444 条）+ 全部配图 | 你和孩子日常使用、开发的唯一仓 |
| `Qld_tutor`（新建空仓） | public | 代码 + 自有题（约 10,071 条）+ MIT LICENSE | 拿去申请 Codex for OSS、对外展示 |

**铁律：只在自用仓开发；公开仓只进、只通过 `sync_to_public.py` 同步，不手工往公开仓推任何东西。**
公开仓若收到外部 PR/贡献，先把改动搬回自用仓，再走同步发出来——否则下次镜像同步会把
公开仓独有的文件当“源头没有”删掉。

## sync_to_public.py 做什么

1. 镜像复制自用仓 → 公开仓，跳过私有路径：`frontend/public/mathspace_images/`（4,300 个文件）、
   `scratch/`、`.env*`、任何 `credentials.json`、运行时 DB/日志、venv/node_modules 等
2. 过滤公开侧 `data/**/*.json`：记录 id 含 `_ms_`、topic 含 Mathspace、或整条记录
   序列化后含 `mathspace` 的，一律剔除。已用真实数据验证：Y7 2,467→974、Y8 2,379→806、
   Y9 2,419→1,023、Y10 2,864→882，共剔除 **6,444** 条；保留题与原文件逐条深比对一致、
   顺序不变、非数学题库逐字节不变（写回格式与原仓一致：indent=2、ensure_ascii=False）
3. 全文扫描公开仓：还有任何文件含 `mathspace` 字样（脚本与本说明除外）就报错退出、
   **不提交不推送**，把文件列给你人工处理
4. 默认不自动提交；`--commit "msg"` 才提交，再加 `--push` 才推送。公开仓有未提交
   改动时默认拒绝运行（防覆盖），确认无误可用 `--force`

```bash
# 演练（不写文件，只看会剔多少、跳过什么）
python3 sync_to_public.py --source ~/Qld_tutor_private --dest ~/Qld_tutor --dry-run

# 日常同步（之后自己看 git diff 再提交）
python3 sync_to_public.py --source ~/Qld_tutor_private --dest ~/Qld_tutor

# 一键同步+提交+推送（扫描不过自动中止）
python3 sync_to_public.py --source ~/Qld_tutor_private --dest ~/Qld_tutor \
    --commit "sync: public snapshot 2026-10-22" --push
```

报告里的“剔除 6,444 条”是每次运行的处理量（先镜像原文、再过滤），最终以
公开仓 `git status` 是否干净为准——重复运行结果幂等，无变化时不会产生提交。

公开仓独有、不希望被镜像删除的文件，写进公开仓根目录 `.sync-keep`（每行一个相对路径）。

## 首次迁移（按顺序做，别跳步）

**第 0 步 · 备份（务必先做）**
```bash
git clone --mirror https://github.com/auhelloworld/Qld_tutor.git ~/backup-Qld_tutor-mirror.git
```
外加一份当前工作区完整拷贝。历史一旦重写/换仓，这份备份是唯一的后悔药。

**第 1 步 · 现仓转自用仓**
GitHub 上 `Qld_tutor` → Settings → 改名为 `Qld_tutor_private`，可见性改 private。
本地部署不受影响；各 clone 里执行
`git remote set-url origin https://github.com/auhelloworld/Qld_tutor_private.git`。

**第 2 步 · 建新公开仓**
新建 public 仓仍叫 `Qld_tutor`（与申请表要填的 URL 一致），**不要**勾选初始化
README/LICENSE，保持空仓；本地 clone 到 `~/Qld_tutor`。

**第 3 步 · 摆放工具**
把 `sync_to_public.py` 和本文件放进自用仓根目录；`LICENSE`（MIT，全文随本包附带）
也放自用仓根目录，随同步一起过去，保持单一来源。

**第 4 步 · 首次同步 + 处理扫描命中**
先 `--dry-run`，再正式跑。首次扫描大概率会拦下提交，命中多半是这几类：
- `docs/readme/content.md` 等题量文档：里面是含 ms 题的旧计数。处理：在**公开仓**里
  对过滤后的数据重跑 `python3 scripts/check_exercises.py --update-readme` 再提交；
  若每次同步都被它拦，可把该文件加进脚本 `EXCLUDED_PATTERNS`，改为只在公开侧生成
- `iterative-question-bank-content-audit/`、`qld-tutor-question-bank-generation/`、
  `qld-tutor-source-digest/`、`tasks/` 等过程目录：本就是生产题库的工作文件，
  建议整目录加进 `EXCLUDED_PATTERNS`，不随公开仓发布
- `data/bank_statistics.json`：旧统计（16,515 条）会与过滤后题库矛盾，按公开侧
  数据重新生成后再提交

全部处理完、扫描变绿后，在公开仓自检一遍：`./start.sh` 起服务，
`curl 127.0.0.1:9527/api/ready` 应为 ready（它会校验每个 exercise 文件可解析）。

**第 5 步 · 公开仓门面**
仓库描述改成一句正经话（如 *Self-hosted AI tutoring system for Queensland
secondary students — ACARA V9 / QCAA aligned*），加 topics（education,
queensland, acara, fastapi, nextjs, tutoring），GitHub 个人资料补 bio。
题量口径统一用过滤后的 **10,071 条自有题**（16,515 − 6,444），申请表文案同步改。

**第 6 步 · 提交申请**
用公开仓 URL `https://github.com/auhelloworld/Qld_tutor` 提交 Codex for OSS 申请。

## 为什么不推荐 git filter-repo 保历史

保住 337 个 commit 的历史不是不行（filter-repo 改写 JSON blob + 删配图路径 +
改写 commit 信息），但步骤多、易漏、强推后所有 clone 要重拉，GitHub 侧旧对象
也不会立刻消失。对单人维护的仓，新公开仓从干净快照起步代价最低：开发历史完整
保留在自用仓里，公开仓的提交记录会随日常同步很快长起来。

## 另外一个提醒（与双仓无关，但顺手处理）

现公开仓里有一个 `data/credentials.json`。本脚本已把任何 `credentials.json`
列入永不同步清单；但如果那个文件里是真实凭据而不是测试占位，光删文件不够，
需要把对应凭据轮换掉，并同样从历史里清掉——转 private + 换新公开仓正好一并解决。
