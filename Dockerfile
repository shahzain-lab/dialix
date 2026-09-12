FROM public.ecr.aws/docker/library/node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm build
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node apps/api/dist/index.js"]
