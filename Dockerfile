# === Stage 1: Build Frontend ===
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# === Stage 2: Python API + Serve Static ===
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN pip install --no-cache-dir -e .

COPY --from=frontend-builder /app/frontend/dist/ ./frontend/dist/

EXPOSE 8000

CMD ["uvicorn", "tw_quant_selector.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
