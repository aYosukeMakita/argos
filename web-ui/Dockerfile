FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
ARG NEXT_PUBLIC_ARGOS_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_ARGOS_API_BASE_URL=${NEXT_PUBLIC_ARGOS_API_BASE_URL}
COPY tsconfig.json next.config.ts next-env.d.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
