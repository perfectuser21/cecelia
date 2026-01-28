FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/
COPY sor/ ./sor/

# Create data directories
RUN mkdir -p /data/chroma /app/logs

# Environment variables
ENV CHROMA_DB_PATH=/data/chroma
ENV SOR_CONFIG_PATH=/app/sor/config.yaml
ENV LOG_LEVEL=INFO
ENV PYTHONPATH=/app

# Expose port
EXPOSE 5220

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:5220/health || exit 1

# Start command
CMD ["python", "-m", "uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "5220"]
