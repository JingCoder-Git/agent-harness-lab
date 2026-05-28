# Agent Harness Lab

一个面向 AI 应用开发的 STEP 式教程项目，方便前端、全栈和应用工程师学习如何构建模型周围的 Harness。

## 技术判断

当前项目使用 Next.js 框架，并使用 TypeScript 编写。

## 课程模式

- 12 个课程模块被组织为 STEP 1 到 STEP 12。
- 当前 STEP 会保存到浏览器 LocalStorage。
- 学员可以前进、回退，也可以完成当前 STEP 后进入下一 STEP。
- 每个课程内部的可视化、模拟器、源码查看和深挖交互保持原有模式。
- 页面中的 Try it / 试一试段落会在内容生成阶段移除。

## 本地开发

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

## 内容结构

- `docs/`: 多语言课程 Markdown。
- `examples/`: TypeScript/Node 参考实现，驱动源码视图和版本对比。
- `src/components/visualizations/`: 每个 STEP 的交互可视化。
- `src/data/scenarios/`: 模拟器使用的交互场景。
- `scripts/extract-content.ts`: 从 `docs/` 和 `examples/` 生成页面数据。

## 常用命令

```bash
npm run extract
npm run build
```
