FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required by opencv-python-headless and psycopg2
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libpq-dev gcc build-essential curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:${PATH}"

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal && \
    rustup default stable && \
    cargo install --locked svg2gcode-cli --version 0.0.18 && \
    cp /root/.cargo/bin/svg2gcode /usr/local/bin/svg2gcode && \
    rm -rf /root/.cargo /root/.rustup

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
