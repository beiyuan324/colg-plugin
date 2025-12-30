<div align="center">

# colg-plugin

`(≧▽≦)` 一个会把 COLG 帖子内容和图片打包成 **合并转发消息** 投喂给群友的 Yunzai 插件～

</div>

## 功能说明

- 支持 **自动识别** COLG 帖子链接：群里直接丢链接即可解析
- 支持指令解析：`#colg <tid或链接>`
- 解析内容：
  - 标题
  - 正文（按长度自动分段）
  - 图片（按批次组装）
- 输出形式：**合并转发消息**（不刷屏）

## 使用方式

### 方式 1：直接发链接（推荐）

把类似下面的链接直接发到群里：

- `https://bbs.colg.cn/forum.php?mod=viewthread&tid=9549504&mobile=2...`
- `https://bbs.colg.cn/thread-9549504-1-1.html`

机器人会自动识别并解析。

### 方式 2：使用指令

- `#colg 9549504`
- `#colg https://bbs.colg.cn/thread-9549504-1-1.html`

## 安装

1) 将本插件放入：

- `Yunzai/plugins/colg-plugin`

2) 由于项目根目录 `plugins/.gitignore` 默认会忽略大部分插件目录，本项目已在 `plugins/.gitignore` 中为 `colg-plugin` 加入白名单。

3) 重启机器人或热更新后生效。

## 解析策略说明

- 对包含 `tid` 的链接，会优先转换为更容易获取正文的页面：
  - `https://bbs.colg.cn/thread-<tid>-1-1.html`
  - 若失败再尝试 `mobile=no` 的页面兜底
- HTML 解析：
  - 若运行环境存在 `cheerio`：优先使用 `cheerio`
  - 若不存在：自动降级为无依赖的 fallback 解析（正则提取主楼区域 + 去标签）

## 免责声明

- 本插件仅做网页内容抓取与格式化展示，素材版权归原作者与 COLG 平台所有。
- 请勿用于任何商业用途或违规用途。

## 开源协议

本项目使用开源协议：**木兰宽松许可证 Mulan PSL v2**，详见 `LICENSE`。
