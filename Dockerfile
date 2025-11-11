FROM node:22-alpine AS builder

WORKDIR /app

# Corepack 활성화
RUN corepack enable

# 의존성 파일 복사
COPY package.json pnpm-lock.yaml ./

# 의존성 설치
RUN pnpm install --frozen-lockfile

# 소스 코드 복사
COPY . .

# Prisma generate을 위한 임시 .env 파일 생성
RUN echo "DATABASE_URL=mysql://temp:temp@localhost:3306/temp" > .env

# prisma generate

RUN pnpm db:gen

# 임시 .env 파일 삭제 (선택사항)
RUN rm .env

# NestJS 빌드
RUN pnpm build

# =============================================
# 2. 배포 단계 (Production Stage)
# =============================================
FROM node:22-alpine AS production

WORKDIR /app

# Corepack 활성화
RUN corepack enable

# package 파일 복사
COPY package.json pnpm-lock.yaml ./

# Prisma schema 파일 복사
COPY --from=builder /app/prisma ./prisma

# 프로덕션 의존성 설치 (postinstall 스크립트 무시)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# 빌더에서 생성된 파일들 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated

# 비-root 사용자 생성
RUN addgroup -g 1001 -S nodejs && \
  adduser -S nestjs -u 1001 && \
  chown -R nestjs:nodejs /app

# 비-root 사용자로 전환
USER nestjs

# 포트 노출 (애플리케이션 포트에 맞게 조정)
EXPOSE 8081

# 헬스체크 (선택사항)
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#     CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# 애플리케이션 실행
CMD ["node", "dist/src/main.js"]