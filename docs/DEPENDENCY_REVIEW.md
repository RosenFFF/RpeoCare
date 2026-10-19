# 依赖审计与兼容性核对

2026-10-19的锁文件安装后，npm audit对全部依赖及仅生产依赖均返回0项告警。这是当日注册表审计结果，不证明不存在未知漏洞。模型ID、pi SDK版本、输出配置与执行权限没有因本次依赖处理而降级。

| 依赖 | 固定版本 | 处理依据 |
| --- | --- | --- |
| next / @next/env | 16.3.8 | 同主版本修复，覆盖原锁文件涉及的Next.js告警 |
| sharp | 0.35.5 | 更新锁文件中的兼容版本，包含librsvg修复 |
| source-map-js | 1.2.2 | 更新兼容版本，修复索引偏移导致的事件循环阻塞 |
| basic-ftp | 6.2.3 | get-uri的定向override，避免通过降级整个pi SDK绕开告警 |
| concurrently | 10.0.6 | 更新兼容版本及shell-quote传递链 |
| shell-quote | 1.12.0 | 更新锁文件中的兼容版本 |

basic-ftp的修复跨越get-uri声明的主版本范围，因此在package.json显式保留override。get-uri仍是6.0.5，pi-agent-core与pi-ai仍是0.73.1。一次仅监听回环地址的受控FTP检查覆盖get-uri获取内容及目录查询回退，实际下载内容一致；该检查不代表任意代理服务或FTP服务均兼容。模型传输和应用流程还需分别看工程及实测记录。

修复前的生产审计包含9个受影响包，部分来自同一传递链，不能计作9个独立可利用漏洞。没有通过真实攻击确认本项目的可达性；本次选择更新受影响组件。Next.js公告也不能证明应用使用了next/og路径。

公告依据：[Next.js](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)、[basic-ftp](https://github.com/advisories/GHSA-c475-qrg2-pj4r)、[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[shell-quote](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)。实际版本及完整性以package-lock.json为准，安装使用npm ci，不使用强制降级修复。
