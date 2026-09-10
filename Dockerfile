# 1：用 Node 镜像来安装依赖和编译代码
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Self-host the OCR engine and language data so the deployed app never asks a
# CDN for them. Build with --build-arg ENABLE_OCR=false to skip the download;
# the app then reports OCR as unavailable instead of reaching out at runtime.
ARG ENABLE_OCR=true
RUN if [ "$ENABLE_OCR" = "true" ]; then npm run prepare-ocr; fi

RUN npm run build

# 2：用轻量的 Nginx 镜像来运行编译好的静态网页
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
