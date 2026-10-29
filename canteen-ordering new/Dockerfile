# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the Spring Boot jar with Maven + Java 17
# ---------------------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-17 AS build

WORKDIR /build

# Cache dependencies in their own layer so code changes don't re-download them.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline || true

COPY src ./src
RUN mvn -B -DskipTests clean package \
    && cp "$(find target -maxdepth 1 -type f -name '*.jar' ! -name '*.original' | head -n 1)" /build/app.jar

# ---------------------------------------------------------------------------
# Stage 2: run the jar on a slim Java 17 runtime
# ---------------------------------------------------------------------------
FROM eclipse-temurin:17-jre-jammy

# Run as a non-root user.
RUN groupadd --system app \
    && useradd --system --gid app app \
    && mkdir -p /app/data \
    && chown -R app:app /app

WORKDIR /app

COPY --from=build --chown=app:app /build/app.jar /app/app.jar

USER app

# Render provides PORT at runtime; 8080 is only the local/default fallback.
ENV PORT=8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -XX:+UseContainerSupport"

EXPOSE 8080

# server.port=${PORT:8080} in application.properties makes Spring listen on
# Render's port. `exec` ensures SIGTERM reaches the JVM for a clean shutdown.
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
