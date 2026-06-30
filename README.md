# 超星学习通翻译

DeepSeek AI 驱动的浏览器扩展，一键将学习通作业/考试页面中文翻译为英文。

## 功能

- **一键翻译** — 点右侧标签，全页中文 → 英文
- **双语对照** — 翻译后开启，英文上方 + 中文原文下方，方便对照阅读
- **翻译记忆** — 同一句子翻过即缓存，跨页面永久保留，省 API 费用
- **单词本** — Ctrl+Click 收藏生词，自动查释义，可导出 CSV

## 安装

1. 下载此仓库（Code → Download ZIP）并解压
2. 打开 `edge://extensions`（或 `chrome://extensions`），开启**开发人员模式**
3. 点击**加载解压缩的扩展**，选择解压出的文件夹
4. 打开学习通任意作业页面，粘贴 DeepSeek API Key

## 获取 DeepSeek API Key

1. 注册 [DeepSeek 开放平台](https://platform.deepseek.com/)
2. 进入 [API Keys](https://platform.deepseek.com/api_keys)，创建 Key
3. 新用户赠送免费额度

## 使用

| 操作 | 说明 |
|------|------|
| 点击 `翻译` | 全页中文翻译为英文 |
| 点击 `还原` | 恢复原始中文 |
| 点击 `对照` | 切换双语对照模式 |
| 点击 `单词本` | 查看收藏的生词 |
| Ctrl+Click 英文词 | 收藏到单词本 |
| `Ctrl+Shift+T` | 快捷键翻译/还原 |
| `Ctrl+Shift+B` | 快捷键切换对照 |
| 点击 `⚙` | 设置 API Key / 清缓存 |

## 单词本

翻译后，**按住 Ctrl 键点击**不认识的英文单词，自动查询中文释义并收藏。

单词本面板中可查看所有收藏单词，支持逐条删除、一键清空、导出 CSV。

## 技术栈

- Manifest V3
- DeepSeek Chat API
- 零依赖，纯原生 JS

## License

MIT
