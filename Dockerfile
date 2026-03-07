# 阶段一：用配置极高的 Node 镜像来安装依赖和编译代码 (GitHub 服务器的算力随便用)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 阶段二：用极其轻量的 Nginx 镜像来运行编译好的静态网页 (给你的 GCP 免费机减负)
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]