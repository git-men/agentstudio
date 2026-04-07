# Fix: Plugin Symlink EEXIST Error on Startup

## 目标
修复 agentstudio 启动时 pluginSymlink 服务在安装 marketplace 插件时抛出
`EEXIST: file already exists` 错误，导致部分插件安装失败（`1/3 plugins`）。

## 根因
`createSymlink` 方法使用 `fs.existsSync()` 检查目标路径是否存在。
`existsSync` 会**跟踪符号链接**——当 symlink 存在但指向的目标不存在（dangling symlink）时，
`existsSync` 返回 `false`，使代码绕过检查直接调用 `symlinkSync`，
而 symlink 本身实际存在，因此抛出 `EEXIST`。

## 完成标准
- [ ] agentstudio 启动日志中不再出现 `EEXIST` 错误
- [ ] 已存在的 symlink（包括 dangling symlink）能被正确识别并跳过或更新
- [ ] 新增回归测试覆盖 dangling symlink 场景

## 非目标
- 不重构 pluginSymlink 的其他方法（removeSymlinks、installMcpServers 等）
- 不更改插件解析或安装流程的其他逻辑
