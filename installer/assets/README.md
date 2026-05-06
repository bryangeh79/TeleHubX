# installer/assets

放置打包用的图标 / banner 资源。

## 必备文件

| 文件 | 用途 | 来源 |
|------|------|------|
| `telehubx-logo.png` | 1024×1024 渐变 X 标识，源图 | 用户提供 |
| `telehubx.ico` | 多尺寸 ICO（256/128/64/48/32/16） | `png-to-ico.ps1` 自动生成 |
| `telehubx-banner.bmp` | Inno Setup 左侧大图 164×314 | `png-to-ico.ps1` 自动生成 |
| `telehubx-banner-small.bmp` | Inno Setup 顶部小图 55×58 | `png-to-ico.ps1` 自动生成 |

## 一键生成

```powershell
# 1. 把源 PNG 放到 installer\assets\telehubx-logo.png
# 2. 跑转换:
.\installer\scripts\png-to-ico.ps1 `
  -Source installer\assets\telehubx-logo.png `
  -Out    installer\assets\telehubx.ico
```

输出 3 个文件：`telehubx.ico` + `telehubx-banner.bmp` + `telehubx-banner-small.bmp`。

## 注意

- `*.ico` / `*.bmp` 不入仓（`.gitignore`），`telehubx-logo.png` 入仓作为单一可信源
- Phase 4 `build.ps1` 会自动调 png-to-ico.ps1 如果 .ico 不存在
