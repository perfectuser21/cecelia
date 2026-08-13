# 从 Fleet 注入的 DB_URL 派生 DB_DEFAULTS/migrate.js 所需的离散连接变量。
# local_api 空库自举硬规则：只声明 DB_URL 这一项 Fleet 资源，其余从中派生。
# 被 e2e-verify（模式B）与 tests/run-case.sh（模式A BEHAVIOR）共同 source。
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"   # 触发 contract-store.test.js 的 HAS_REAL_POSTGRES 门
export DB="$DB_URL"
export NODE_ENV=test
eval "$(node -e 'const u=new URL(process.env.DB_URL);const o=(k,v)=>`export ${k}=${JSON.stringify(String(v))}`;console.log([o("DB_HOST",u.hostname),o("DB_PORT",u.port||"5432"),o("DB_NAME",decodeURIComponent(u.pathname.replace(/^\//,""))),o("DB_USER",decodeURIComponent(u.username)),o("DB_PASSWORD",decodeURIComponent(u.password))].join("\n"))')"
