# VeriRouter project website

独立的英文项目网站。使用 v38 Demo 的 Tabler 图标、原生网页动画、完整原片，以及现场生成的 Plonky2 ZK proofs。布局参考 [Sherlock](https://sherlocksec.org/) 的居中内容、章节大标题、叙事顺序和单一主要操作。

## 本地运行

前端需要 Node.js 20+，无需安装 npm 包：

```sh
npm run dev
```

打开 <http://localhost:4173>。按 Ctrl+C 关闭。

现场生成另需 Python 3、OpenSSL、Rust nightly，以及旁边的 `../VeriRouter-release` 代码仓库。可先编译一次：

```sh
npm run setup:prover
npm run dev
```

若使用已编译的二进制，设置 `CARGO_TARGET_DIR` 指向其 target 目录。例如当前机器已完成编译：

```sh
CARGO_TARGET_DIR=/tmp/verirouter-native npm run dev
```

可用 `VERIROUTER_ARTIFACT_DIR` 指定代码仓库路径，`PROVER_THREADS` 指定证明生成线程数（默认 4）。首次未预编译时，服务会先编译 Rust 二进制。

## 页面与交互

- 首屏先解释 LLM Router 的工作流程与隐藏环节，再进入攻击、协议和测量结果。
- 攻击区默认可直接播放。下拉菜单选择四种攻击；勾选 VeriRouter checks 查看证据链如何拒绝攻击。
- 动画自动展示对应阶段的完整 JSON：客户端请求 → 转发请求 → 模型回答 → 最终交付。不需要手动切换 Request / Response；长 JSON 在窗口内滚动。
- 每个阶段约 5.2 秒，可暂停和继续。下方步骤仅展示进度。
- 完整攻击视频和验证视频在同一 Demo 区域播放，提供章节跳转、下载和返回交互演示。保留原片烧录字幕，无第二层字幕。
- Generate & verify 一次操作完成 Rust proving、serving certificate 签名，以及浏览器里的独立验证。成功后出现篡改下拉菜单；修改 proof、回答或模型身份会自动重新验证。
- 作者信息放在 BibTeX 中。

## 现场证明流程

`POST /api/prove` 为 release artifact 的 small component example 创建独立 run ID 和新的 request commitment randomness。`server/prove.py` 调用原始 `scripts.demo.run_component`，生成 selection proof、rewrite proof 和 Ed25519 serving certificate，并运行原生证据链验证。

浏览器轮询进度，取得公开证明包后，在 Web Worker 中运行 Plonky2 1.1.0 WebAssembly verifier。客户端固定 selection / rewrite verifier keys、selection public inputs、rewrite bank commitments 和 client-request hash；当前 request commitment 与证书绑定匹配。Demo provider 公钥从同源服务初始化获取，再与每次返回的证据比较。

例子使用 release artifact 中的固定 MT-Bench 请求与回答、模拟 provider，不发起付费 API 请求。新一轮会重新生成 ZK proofs 和 certificate。`assets/zk/` 同时保留一份已生成的公开示例，供静态部署进行浏览器验证。

服务一次运行一个 proving job，生成结果保留 20 分钟。每轮完成后仅保留公开证据；签名私钥位于被 Git 忽略的 `.local/` 中。HTTP 服务只公开网页资源与明确列出的公开证明文件。

## 检查与构建

```sh
npm run check
npm run build
npm run preview
```

`dist/` 为发布文件。字体、SVG 图标、WASM、视频和演示数据均本地托管。所有前端路径使用相对路径。

已在本机验证：现场生成与浏览器验证通过；篡改 selection proof、rewrite proof、response 和 model identity 分别被对应检查拒绝；桌面、平板与手机尺寸无横向溢出。

## 发布完整网站和 proving 服务

可在支持 Node.js / Python 的服务器运行：

```sh
npm run setup:prover
npm run build
HOST=0.0.0.0 PORT=8080 npm run serve
```

将网站域名反向代理到 8080，启用 HTTPS 即可同时提供页面和 `/api/`。生成由服务器执行，验证由访客浏览器执行。

也提供容器构建文件：

```sh
npm run prepare:server
docker build -t verirouter-site .
docker run --rm -p 8080:8080 -v verirouter-state:/var/lib/verirouter verirouter-site
```

`prepare:server` 从代码仓库 HEAD 导出构建输入到 `server/artifact/`，该目录不进入网站 Git 历史。容器在构建时编译 prover，运行时使用 Node.js、Python 和 OpenSSL。本机未安装 Docker；已验证的是原生运行路径。

## 静态发布

GitHub Pages、Cloudflare Pages、Netlify 或 Vercel 可发布 `dist/`。静态模式的主要按钮显示 Verify the example，使用保存的真实 proofs 运行浏览器验证；现场生成功能使用上面的 Node 服务部署。

GitHub Pages 已有 `.github/workflows/pages.yml`。将网站仓库推送到 `main`，在 Settings → Pages 选择 GitHub Actions。

构建时可设置最终域名，生成 canonical 与分享链接：

```sh
SITE_URL=https://your-domain.example/ npm run build
```

## Git 仓库

本文件夹是独立网站仓库。创建空的远程仓库后：

```sh
git remote add origin <网站仓库地址>
git push -u origin main
```

代码仓库：[Yao-mengyu/VeriRouter-release](https://github.com/Yao-mengyu/VeriRouter-release)，private、main 分支、一次初始提交。内容与原 `release` 分支 commit `8f74110` 的 Git tree 相同。

## 文件

| 路径 | 用途 |
| --- | --- |
| `index.html` / `styles.css` | 页面、叙事和响应式排版 |
| `app.js` | 自动 JSON 重放、视频与一键生成交互 |
| `verifier-worker.js` | ZK proofs、签名与共享绑定的浏览器验证 |
| `server/` | proving job API 与原始论文代码的调用桥接 |
| `assets/zk/` | 公开 proofs、verifier keys、WASM 和示例证据 |
| `verifier/` | WASM verifier 的 Rust 源码与锁定依赖 |
| `assets/media/` | 两部原始 1080p 视频，每个约 19 MB |
| `data/demo-trace.json` | v38 保存的完整 API 重放数据 |
| `assets/fonts/` | 自托管字体与 OFL 许可证 |
| `assets/Tabler-LICENSE.txt` | 图标许可证 |
| `scripts/` | 检查、构建、预编译与部署准备 |

## 重建 WASM

普通构建直接使用已生成的 WASM。更新 verifier 后：

```sh
rustup target add wasm32-unknown-unknown --toolchain nightly
cargo +nightly build --release --locked --target wasm32-unknown-unknown --manifest-path verifier/Cargo.toml
wasm-bindgen verifier/target/wasm32-unknown-unknown/release/verirouter_web_verifier.wasm --target web --out-dir assets/zk --out-name verifier
```

绑定工具版本 `wasm-bindgen-cli 0.2.114`。

论文：[VeriRouter: Towards Verifiable LLM Routing](https://arxiv.org/abs/2610.17431)。结果来源为 §6；证明生成时间与新增 serving latency 分别展示。
