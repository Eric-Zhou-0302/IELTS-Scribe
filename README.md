# IELTS Scribe

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Vite 7](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![Express 5](https://img.shields.io/badge/Express-5-000?logo=express&logoColor=white)](https://expressjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

本地运行的雅思机考写作练习台。左栏题目图，右栏写作区；自带 20 / 40 分钟倒计时、自动保存、历史归档与深浅主题切换。所有练习数据落在项目本地，无账号、无云同步、不联网。

适合备考 IELTS Writing、想要贴近真实机考节奏、又不想被云服务和订阅捆绑的人。

## 功能

- **左图右文工作台** —— 单张题目图支持截图粘贴（`⌘/Ctrl + V`）和文件上传，可随时替换而不影响草稿。
- **20 / 40 分钟计时器** —— Task 1 与 Task 2 分别对应；开始、暂停、继续、重置；最后 1 分钟倒计时变红。
- **自动保存** —— 文本输入 1.8 秒节流落盘，关键动作即时保存，关闭页面兜底一次。
- **历史归档** —— 一键归档当前练习，自动开下一篇；抽屉支持按题目来源筛选、查看详情、删除。
- **字数实时统计** —— 右下角实时计算，可一键隐藏。
- **深色 / 浅色双主题** —— 选择持久化在草稿文件。
- **图片引用追踪** —— 删除历史时，共享图片自动保留。
- **原子写入与损坏恢复** —— JSON 半写入损坏会自动备份到 `data/recovery/`，不会丢历史。

## 快速开始

```bash
git clone https://github.com/Eric-Zhou-0302/IELTS-Scribe
cd IELTS-Scribe
npm install
npm run dev
```

终端出现应用 URL 后浏览器打开 `http://127.0.0.1:5173/` 即可。

## 技术栈

- **前端**：React 19 + Vite 7（JSX + 原生 ESM）
- **后端**：Express 5 + multer 2（纯 ESM，无 TypeScript）
- **测试**：Vitest + supertest + jsdom
- **持久化**：项目目录下的 JSON + 图片文件，**不使用数据库**

## 数据存放

```
data/
├── drafts/current-session.json   当前正在写的练习
├── sessions/*.json               历史归档
├── images/*                      题目图原文件
└── recovery/                     损坏文件的备份
```

没有账号、没有云端。要搬电脑就把整个项目目录拷走。

## 许可

[MIT](./LICENSE) © 2026 Eric Zhou