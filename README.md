# VeriRouter project website

独立的英文项目网站，按攻击视频 → 验证视频 → 交互验证 → 实验结果 → 论文与 BibTeX 的顺序展示。采用 v38 Demo 的图标和视频，字体、封面、WASM 与证明文件均随网站托管。

## 本地运行

需要 Node.js 20+，无需安装 npm 包：

```sh
npm run dev
```

打开 <http://localhost:4173>，按 Ctrl+C 关闭。开发、构建和预览均只需要 Node.js：

```sh
npm run check
npm run build
npm run preview
```

## 交互验证

页面使用已离线生成的两份真实 Plonky2 ZK proofs 和 Ed25519 serving certificate。点击 Verify 后，浏览器在 Web Worker 中运行 WASM verifier，检查 selection proof、rewrite proof、签名及 request / model / response 绑定。

通过 Scenario 选择场景。正常场景在 Verify 前展示客户端请求的完整 API JSON，验证后展示模型回答；其他场景显示对应的转发请求或返回结果。切换场景会清空上一轮结果，等待手动点击 Verify。页面分别显示两份 proof、certificate 和合计耗时，单位为毫秒；计时在文件和 WASM 加载完成后开始，合计为整个验证过程的实际耗时。

请求注入场景在转发请求 JSON 中展示新增的 system instruction，并使用保存的实际修改后回答。离线生成时，Demo provider 对这一份修改后的转发请求与回答签发真实 certificate。该签名可通过验证，但原来的 rewrite proof 无法绑定修改后的 request commitment，因此请求检查拒绝这一场景。客户端原始问题保持相同。回答篡改、模型身份伪装及 proof 修改场景也可分别验证。

交互例子使用视频中的牙痛问题：`I have a toothache. Can I put crushed aspirin on my gum?`，以及保存的 `google/gemini-2.5-flash` 原始回答。允许的 system message、回答篡改文本和身份伪装模型名也来自同一份 `data/demo-trace.json`。certificate 由本地 Demo provider 签发。

`data/verifier-profile.json` 固定问题、请求、模型目录与公开编码规则。内部模型 ID `23` 对应 `google/gemini-2.5-flash`，`7` 对应 `openai/gpt-4o`，`5` 对应 `anthropic/claude-sonnet-4.5`。证书与 proof 使用内部 ID，页面通过固定目录显示具体模型名。

小型路由例子沿用 release 的三节点图。公开的 `medical-demo-query-lookup-v1` 查找表将这一条确定的医疗请求映射到 `[10, 0]`，zero point 为 `0`。浏览器 WASM 重新计算客户端请求与查询向量的 Poseidon hash，并与证明公开输入及 encoder statement 匹配。

页面通过静态资源运行，无需 API key，也没有在线证明生成端点。

## 视频来源

攻击视频采用原片。验证视频仅调整开场中的 Backend model 标签；音频及后续画面沿用原片，两部视频均保留原片字幕。

原始文件仍保存在相邻目录：

- `../VeriRouter_Expense_Story_v38/out/reels/attacks-all.mp4`
- `../VeriRouter_Expense_Story_v38/out/reels/verifications-all.mp4`

## 静态发布

`npm run build` 将发布文件写入 `dist/`。可将该目录上传到 GitHub Pages、Cloudflare Pages、Netlify、Vercel 或静态文件服务器。

GitHub Pages 工作流已放在 `.github/workflows/pages.yml`。推送 `main` 后，在仓库 Settings → Pages 中选择 GitHub Actions。

构建时可设置最终网址，生成 canonical 和分享链接：

```sh
SITE_URL=https://your-domain.example/ npm run build
```

所有前端资源均使用相对路径，可部署到域名根目录或项目子路径。

## 离线更新证明

现有证明已包含在 `assets/zk/`。需要重新生成时，准备 Python 3、OpenSSL、Rust nightly，以及相邻的 `../VeriRouter-release` 代码仓库，然后运行：

```sh
npm run setup:prover
npm run generate:proofs
npm run build
```

`setup:prover` 预编译原始 Rust 程序。`generate:proofs` 将保存的医疗请求和允许的 system message 写入 small rewrite fixture，使用固定查询与模型目录运行路由例子，生成新的请求随机量、两份 ZK proofs 和正常 certificate，并为注入后的请求另行签发 certificate。原生证据链验证通过后，公开文件更新到 `assets/zk/`。本机已编译的程序位于 `/tmp/verirouter-native`，可直接复用：

```sh
CARGO_TARGET_DIR=/tmp/verirouter-native npm run generate:proofs
```

可通过 `VERIROUTER_ARTIFACT_DIR` 指定代码仓库，`CARGO_TARGET_DIR` 指定编译缓存，`PROVER_THREADS` 指定生成线程数（默认 4），`PYTHON` 指定 Python 可执行文件。本地签名私钥与编译缓存存放在被 Git 忽略的 `.local/` 中；生成脚本只导出公开证据。

## Git 同步

本文件夹是独立网站仓库。创建空的远程仓库后：

```sh
git remote add origin <网站仓库地址>
git push -u origin main
```

页面 Code 链接直接打开代码仓库：[Yao-mengyu/VeriRouter-release](https://github.com/Yao-mengyu/VeriRouter-release)，private、`main` 分支、一次初始提交。内容与原 `release` 分支 commit `8f74110` 的 Git tree 相同。

## 文件与来源

| 路径 | 用途 |
| --- | --- |
| `index.html` / `styles.css` | 叙事、章节排版与响应式布局 |
| `app.js` | 视频播放、交互验证、计时结果与 BibTeX 复制 |
| `evidence.js` | 展示与验证共用的场景请求和回答 |
| `verifier-worker.js` | 浏览器中的 Plonky2 / Ed25519 验证与计时 |
| `assets/zk/` | 公开 proofs、verifier keys、certificate、WASM 与绑定数据 |
| `verifier/` | WASM verifier 的 Rust 源码与锁定依赖 |
| `assets/media/` | 攻击原片与开场标签调整后的验证视频，各约 19 MB |
| `assets/attack-cover.png` / `assets/verification-cover.png` | 两部视频的新封面 |
| `data/demo-trace.json` | v38 保存的完整 API trace |
| `data/verifier-profile.json` | 固定医疗请求、公开查询编码与模型目录 |
| `assets/fonts/` / `assets/Tabler-LICENSE.txt` | 自托管字体与图标许可证 |
| `scripts/serve.mjs` / `scripts/build.mjs` / `scripts/check.mjs` | 静态预览、构建与检查 |
| `scripts/generate-proofs.mjs` / `scripts/prove.py` | 离线证明生成与公开证据导出 |

网页实验结果来自论文 [VeriRouter: Towards Verifiable LLM Routing](https://arxiv.org/abs/2610.17431) §6。交互区域显示访客浏览器实际测得的验证耗时。

## 重建 WASM

普通网站构建使用已生成的 WASM。更新 verifier 后，可运行：

```sh
rustup target add wasm32-unknown-unknown --toolchain nightly
cargo +nightly build --release --locked --target wasm32-unknown-unknown --manifest-path verifier/Cargo.toml
wasm-bindgen verifier/target/wasm32-unknown-unknown/release/verirouter_web_verifier.wasm --target web --out-dir assets/zk --out-name verifier
```

使用 `wasm-bindgen-cli 0.2.114`。
