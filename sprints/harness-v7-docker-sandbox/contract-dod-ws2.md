# Contract DoD — Workstream 2: Docker 容器化执行

- [ ] [ARTIFACT] docker/harness-runner/Dockerfile 存在且包含 claude CLI + Node.js 运行时
  Test: node -e "const c=require('fs').readFileSync('docker/harness-runner/Dockerfile','utf8');if(!c.includes('FROM')||!c.includes('node'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] cecelia-run.sh 在 HARNESS_DOCKER_ENABLED=true 时使用 docker run --rm --memory 启动任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('docker run')||!c.includes('--memory')||!c.includes('HARNESS_DOCKER_ENABLED'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] cecelia-run.sh 在 HARNESS_DOCKER_ENABLED=false 或未设置时仍使用 setsid bash 执行（零回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');const lines=c.split('\n');const setsidLine=lines.findIndex(l=>l.includes('setsid bash'));if(setsidLine<0)process.exit(1);console.log('PASS: setsid 回退路径保留在第'+(setsidLine+1)+'行')"
- [ ] [BEHAVIOR] executor.js 定义 CONTAINER_SIZES 常量，按 task_type 映射容器内存/CPU 规格（至少 light/normal/heavy 三档）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('CONTAINER_SIZES'))process.exit(1);const m=c.match(/CONTAINER_SIZES\s*=\s*\{[^}]+\}/s);if(!m||!m[0].includes('light')||!m[0].includes('normal')||!m[0].includes('heavy'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] Docker daemon 不可用时 cecelia-run.sh 检测并自动回退到 non-docker 模式
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!c.includes('docker info')||!c.includes('fallback'))process.exit(1);console.log('PASS: 包含 docker 可用性检测和回退逻辑')"
