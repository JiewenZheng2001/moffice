# MOffice 后端 Docker 镜像
# 使用 Node 22+（node:sqlite 内置，无需额外原生依赖）
FROM node:22-alpine

WORKDIR /app

# 先复制 package.json 安装依赖（利用 Docker 层缓存）
COPY server/package.json server/pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || pnpm install

# 复制后端源码
COPY server/ .

# 生产启动（tsx 直接运行 TS）
EXPOSE 3000
CMD ["pnpm", "start"]
