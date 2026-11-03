# DSH Balance

在 DSH Web 侧边栏底部、账户头像上方显示 DeepSeek 开放平台的余额、用量和峰谷时段。

## 功能

- **余额优先**：展开卡片以当前账户余额为主，月度 token 用量、费用和构成放在次级位置。
- **折叠态可见**：侧边栏收起时仍显示 44px 余额块，以及当前峰/谷状态和切换倒计时。
- **真实峰谷规则**：按北京时间，周一至周五 09:00–12:00、14:00–18:00 为峰时；其余时间、周末和中国法定节假日为谷时。
- **远程节假日表**：优先使用 `jiejiariapi`，失败时回退到 `holiday-cn`；未来年份暂无官方日历时回退到内置表。
- **权威校时**：按设备时区选择区域 NTP 服务器（阿里云、腾讯、NIST、Cloudflare、pool.ntp.org），失败时回退到 `timeapi.io`。
- **自动刷新**：余额和用量每 30 秒轮询，窗口重新聚焦或恢复可见时刷新；展开卡片支持手动刷新。

## 安装

要求：DSH Web 界面 + 已登录的 DeepSeek 账户。

从 dshmarket 上架后直接安装。上架前可手动安装：

```bash
# npm 发布后
dsh plugin --profile web add dsh-balance-simple

# 或直接从 GitHub 安装
dsh plugin --profile web add git+https://github.com/lamp23333/dsh-balance-simple
```

安装后刷新 DSH Web 页面。

## 数据与隐私

插件复用 DSH 已保存的 DeepSeek 账户授权，不需要额外填写 API Key 或 token。浏览器只访问 DSH 同源的 `/dsh-deepseek-usage/*` 接口；DeepSeek 授权 token 始终留在 Host，不会返回给浏览器。

外部请求仅用于：

- `platform.deepseek.com`：读取账户余额、用量和费用
- `jiejiariapi.com` / GitHub `holiday-cn`：读取中国法定节假日
- 区域 NTP 服务器 / `timeapi.io`：校准当前时间

插件只支持 DeepSeek 账户级数据；OpenAI、Anthropic、OpenRouter 等其他供应商不在支持范围内。DeepSeek 的其他模型会自然聚合到同一账户用量中。

## 峰谷定价依据

DeepSeek 官方定价规则写明：峰时为 UTC 01:00–04:00 和 06:00–10:00，即北京时间 09:00–12:00、14:00–18:00，周一至周五；其中排除的是**中国法定节假日**，不参考其他国家节假日。

- 官方文档：<https://api-docs.deepseek.com/quick_start/pricing>
- 周末即使调休上班也按谷时处理，因为官方规则只按周一至周五 + 中国法定节假日判断。

## 开发

无需构建步骤，源码即发布产物。修改后至少检查：

```bash
node --check index.js
node --check client.js
npm pack --dry-run
```

主要文件：

- `index.js`：Host 端，读取账户数据、节假日和授时，提供同源 JSON 接口
- `client.js`：Web 客户端，渲染侧边栏卡片和折叠余额块
- `cordis.patch.yml`：DSH bundle 入口

## License

MIT
