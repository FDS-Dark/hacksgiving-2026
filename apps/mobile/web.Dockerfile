# The app as a website: `expo export --platform web` (a static single-page
# app), served by unprivileged nginx. EXPO_PUBLIC_* values are inlined into
# the bundle at build time, so each environment builds its own image
# (.gitlab-ci.yml build-web-staging passes apps/mobile/.env.web-staging).

FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

ARG APP_VARIANT=staging
ARG EXPO_PUBLIC_API_BASE_URL
ARG EXPO_PUBLIC_AUTH0_DOMAIN
ARG EXPO_PUBLIC_AUTH0_CLIENT_ID
ARG EXPO_PUBLIC_AUTH0_AUDIENCE
# Shell values win over .env files, so blank these explicitly: a dev token or
# auth bypass must never ship.
ENV APP_VARIANT=$APP_VARIANT \
    EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL \
    EXPO_PUBLIC_AUTH0_DOMAIN=$EXPO_PUBLIC_AUTH0_DOMAIN \
    EXPO_PUBLIC_AUTH0_CLIENT_ID=$EXPO_PUBLIC_AUTH0_CLIENT_ID \
    EXPO_PUBLIC_AUTH0_AUDIENCE=$EXPO_PUBLIC_AUTH0_AUDIENCE \
    EXPO_PUBLIC_DEV_ACCESS_TOKEN= \
    EXPO_PUBLIC_SKIP_AUTH= \
    EXPO_NO_TELEMETRY=1
RUN test -n "$EXPO_PUBLIC_API_BASE_URL" && test -n "$EXPO_PUBLIC_AUTH0_CLIENT_ID" \
 && npx expo export --platform web --output-dir dist

FROM nginxinc/nginx-unprivileged:1.29.1-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
