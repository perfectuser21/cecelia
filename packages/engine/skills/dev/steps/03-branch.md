# Step 3: Branch（已废弃）

> 此文件保留供回归测试引用。原分支创建逻辑已并入 `01-taskcard.md`（.dev-mode 写入）和 `03-prci.md`（PR+CI）。

## .dev-mode 格式规范

`.dev-mode` 文件首行必须是 `dev`，文件名必须包含分支名：

```bash
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
cat > "${DEV_MODE_FILE}" << EOF
dev
branch: ${BRANCH_NAME}
EOF
echo "dev" # 首行标记
```

**禁止**：裸文件名写入（不含分支名）

**正确**：`echo ... >> ".dev-mode.${BRANCH_NAME}"`
