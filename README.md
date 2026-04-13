# EVE-SDE

一个基于 **官方 EVE Online SDE** 的纯静态查询站。

这个仓库会在 GitHub Actions 构建阶段自动下载最新官方 SDE 的 **JSONL** 压缩包，把全部 JSONL 文件转换为适合网页浏览和搜索的静态分片文件，然后发布到 GitHub Pages。

## 这个项目能做什么

- 使用 **官方 SDE** 作为唯一数据源
- 构建时自动抓取最新版本
- 运行时 **不依赖后端、不依赖数据库、不调用在线接口**
- 支持按 **名称、ID、摘要** 做全局搜索
- 支持按文件浏览和查看原始 JSON
- 适合直接部署到 GitHub Pages

## 工作方式

### 构建阶段

GitHub Actions 会自动：

1. 获取官方最新 SDE 版本号
2. 下载对应的 JSONL 压缩包
3. 解压并遍历全部 JSONL 文件
4. 生成静态分片数据与搜索索引
5. 发布 `dist/` 到 GitHub Pages

### 运行阶段

网站上线后只会读取 Pages 上的静态 JSON 文件：

- 没有后端服务
- 没有数据库
- 没有运行时 API 请求
- 用户看到的是纯本地静态数据

## 仓库设置

1. 打开 **Settings → Pages**
2. 将 **Build and deployment → Source** 设置为 **GitHub Actions**
3. 运行工作流 **Build and Deploy EVE SDE Site**

## 本地构建

```bash
python3 scripts/build_sde_site.py
```

输出目录：

```bash
dist/
```

## 目录说明

- `.github/workflows/build-and-deploy.yml`：下载官方 SDE 并部署 Pages
- `scripts/build_sde_site.py`：SDE 转静态站脚本
- `src/index.html`：页面结构
- `src/styles.css`：页面样式
- `src/app.js`：前端交互与搜索逻辑

## 说明

这是一个基于 CCP 官方 SDE 构建的非官方工具站。
EVE Online 及相关名称、素材与商标归 CCP hf. 所有。
