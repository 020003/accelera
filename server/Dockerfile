FROM nvidia/cuda:12.3.2-base-ubuntu22.04

# Install Python and network tools
RUN apt-get update && apt-get install -y python3 python3-pip net-tools iproute2 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

EXPOSE 5000
CMD ["python3", "app.py"]
