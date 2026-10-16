const shellSyntax = /[;&|><`$\n\r]|\.\.[\\/]|(?:^|\s)(?:sudo|su|ssh|scp|curl|wget|nc|ncat|powershell|cmd|bash|sh|docker|podman|kubectl)(?:\s|$)/i;
const scripts = /^(?:test(?::[a-z0-9:_-]+)?|lint|typecheck|check|dev|start|serve)$/i;

export function commandTokens(command) {
  if (typeof command !== 'string' || command.length > 500 || shellSyntax.test(command)) throw new Error('命令包含不允许的 shell 语法或超过长度限制。');
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(value => value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) || [];
  const [file, operation, module] = parts;
  if (!['npm', 'npx', 'python', 'python3', 'pytest', 'go'].includes(file)) throw new Error('命令入口不在允许列表。');
  if (file === 'npm' && !(['ci', 'install', 'test'].includes(operation) || operation === 'run' && scripts.test(module || ''))) throw new Error('npm 命令不在允许列表。');
  if (file === 'npx' && !(operation === 'playwright' && module === 'test')) throw new Error('npx 只允许项目内 Playwright 测试。');
  if (file === 'go' && operation !== 'test') throw new Error('Go 只允许 go test。');
  if (['python', 'python3'].includes(file)) {
    if (operation !== '-m' || !['pytest', 'unittest', 'pip'].includes(module)) throw new Error('Python 只允许测试模块或受限 pip 安装。');
    if (module === 'pip') {
      const args = parts.slice(3);
      const prefix = ['install', '--target', '.repocare-python', '--no-compile'];
      if (!prefix.every((value, index) => args[index] === value)) throw new Error('Python 安装需使用 --target .repocare-python --no-compile。');
      const tail = args.slice(prefix.length);
      const requirements = tail.length === 2 && tail[0] === '-r' && /^(?:requirements(?:[-.](?:dev|test))?\.txt)$/.test(tail[1]);
      const project = tail.length === 2 && tail[0] === '--no-build-isolation' && tail[1] === '.';
      if (!requirements && !project) throw new Error('Python 仅支持仓库根目录 requirements 文件或 --no-build-isolation .。');
    }
  }
  return parts;
}

export function dependencyCommand(command) {
  const parts = commandTokens(command);
  return parts[0] === 'npm' && ['ci', 'install'].includes(parts[1]) || ['python', 'python3'].includes(parts[0]) && parts[2] === 'pip';
}

export function pytestCommand(command) {
  const parts = commandTokens(command);
  return parts[0] === 'pytest' || ['python', 'python3'].includes(parts[0]) && parts[1] === '-m' && parts[2] === 'pytest';
}
