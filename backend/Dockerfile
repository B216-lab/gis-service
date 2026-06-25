FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/geopanel-api ./cmd/api

FROM golang:1.26-alpine AS dev

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY docker/dev-watch.sh ./docker/dev-watch.sh
RUN chmod +x ./docker/dev-watch.sh

EXPOSE 18080

CMD ["sh", "./docker/dev-watch.sh"]

FROM alpine:3.22

RUN apk add --no-cache ca-certificates=20260611-r0

RUN addgroup -S geopanel && adduser -S -G geopanel geopanel
USER geopanel

COPY --from=build /out/geopanel-api /usr/local/bin/geopanel-api

EXPOSE 18080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:18080/api/v1/health || exit 1

CMD ["geopanel-api"]
