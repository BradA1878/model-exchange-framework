#!/bin/bash
# MXF Quick Start Script - Deploy full stack with Meilisearch

set -e

echo "🚀 MXF Quick Start - Full Stack Deployment"
echo "==========================================="
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose found"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚙️  Creating .env file from template..."
    cp .env.example .env

    echo ""
    echo "⚠️  IMPORTANT: Please edit .env and set the following:"
    echo "  - MEILISEARCH_MASTER_KEY (generate with: openssl rand -base64 32)"
    echo "  - JWT_SECRET (generate with: openssl rand -base64 64)"
    echo "  - AGENT_API_KEY (generate with: openssl rand -base64 32)"
    echo "  - MONGODB_PASSWORD (secure password)"
    echo "  - REDIS_PASSWORD (secure password)"
    echo "  - OPENAI_API_KEY (for embeddings)"
    echo "  - OPENROUTER_API_KEY (for SystemLLM, optional)"
    echo ""
    echo "Generate secure keys with:"
    echo "  openssl rand -base64 32  # For API keys and Meilisearch"
    echo "  openssl rand -base64 64  # For JWT secret"
    echo ""
    read -p "Press Enter after you've updated .env file..."
else
    echo "✅ .env file found"
fi

echo ""
echo "🔧 Building Docker images..."
docker-compose build

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health
echo ""
echo "🏥 Checking service health..."

services=("mongodb" "meilisearch" "redis" "mxf-server")
all_healthy=true

for service in "${services[@]}"; do
    if docker-compose ps | grep "$service" | grep -q "Up (healthy)"; then
        echo "  ✅ $service is healthy"
    else
        echo "  ⚠️  $service is not healthy yet"
        all_healthy=false
    fi
done

echo ""

if [ "$all_healthy" = true ]; then
    echo "✅ All services are healthy!"
else
    echo "⚠️  Some services are not healthy yet. Check logs with: docker-compose logs"
fi

echo ""
echo "🎉 MXF Stack is running!"
echo ""
echo "📍 Service URLs:"
echo "  - MXF Server:    http://localhost:3001"
echo "  - Dashboard:     http://localhost:5173"
echo "  - Meilisearch:   http://localhost:7700"
echo "  - MongoDB:       localhost:27017"
echo "  - Redis:         localhost:6379"
echo ""
echo "🔍 Useful commands:"
echo "  - View logs:         docker-compose logs -f"
echo "  - Stop services:     docker-compose down"
echo "  - Restart services:  docker-compose restart"
echo "  - Check status:      docker-compose ps"
echo ""
echo "📚 Next steps:"
echo "  1. Visit http://localhost:5173 for the dashboard"
echo "  2. Read DEPLOYMENT.md for detailed documentation"
echo "  3. Check examples/ for usage patterns"
echo ""
