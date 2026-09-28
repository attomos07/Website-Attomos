package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"golang.org/x/crypto/ssh"
)

// HetznerService maneja la interacción con la API de Hetzner
type HetznerService struct {
	apiToken string
	client   *http.Client
}

// ServerResponse respuesta de la API de Hetzner al crear servidor
type ServerResponse struct {
	Server struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		Status    string `json:"status"`
		PublicNet struct {
			IPv4 struct {
				IP string `json:"ip"`
			} `json:"ipv4"`
		} `json:"public_net"`
	} `json:"server"`
	RootPassword string `json:"root_password"`
}

// ServerStatusResponse respuesta al consultar estado del servidor
type ServerStatusResponse struct {
	Server struct {
		ID        int    `json:"id"`
		Status    string `json:"status"`
		PublicNet struct {
			IPv4 struct {
				IP string `json:"ip"`
			} `json:"ipv4"`
		} `json:"public_net"`
	} `json:"server"`
}

// NewHetznerService crea una nueva instancia del servicio
func NewHetznerService() (*HetznerService, error) {
	apiToken := os.Getenv("HETZNER_API_TOKEN")
	if apiToken == "" {
		return nil, errors.New("HETZNER_API_TOKEN no está configurado")
	}

	return &HetznerService{
		apiToken: apiToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// CreateAtomicBotsGlobalServer crea el servidor compartido global para AtomicBots
func (h *HetznerService) CreateAtomicBotsGlobalServer(serverName string) (*ServerResponse, error) {
	url := "https://api.hetzner.cloud/v1/servers"

	payload := map[string]interface{}{
		"name":        serverName,
		"server_type": "cx23",
		"image":       "ubuntu-22.04",
		"location":    "nbg1",
		"ssh_keys":    []string{},
		"user_data":   h.getAtomicBotsGlobalServerScript(),
		"labels": map[string]string{
			"purpose":     "atomic-bots",
			"server_type": "global-shared",
			"managed_by":  "attomos",
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+h.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("error al crear servidor: %s - %s", resp.Status, string(body))
	}

	var serverResp ServerResponse
	if err := json.Unmarshal(body, &serverResp); err != nil {
		return nil, err
	}

	return &serverResp, nil
}

// getAtomicBotsGlobalServerScript genera el cloud-init para servidor global de AtomicBots
func (h *HetznerService) getAtomicBotsGlobalServerScript() string {
	return `#cloud-config

chpasswd:
  expire: false

ssh_pwauth: true

package_update: true
package_upgrade: false

packages:
  - curl
  - git
  - ca-certificates
  - gnupg
  - build-essential
  - gcc
  - wget
  - apt-transport-https
  - software-properties-common

runcmd:
  # === FASE 1: SETUP INICIAL ===
  - mkdir -p /var/log/attomos /opt/atomic-bots
  - echo "INICIO SERVIDOR GLOBAL DE ATOMIC BOTS" > /var/log/attomos/init.log
  - date >> /var/log/attomos/init.log
  - echo "PHASE_1_START" > /var/log/attomos/status
  - chage -I -1 -m 0 -M 99999 -E -1 root
  
  # === FASE 2: ESPERAR LOCKS DE APT ===
  - echo "PHASE_2_WAIT_LOCKS" > /var/log/attomos/status
  - echo "[$(date)] Esperando que cloud-init libere locks..." >> /var/log/attomos/init.log
  - timeout 300 bash -c 'while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/lib/dpkg/lock >/dev/null 2>&1; do echo "Esperando locks de apt..."; sleep 5; done' >> /var/log/attomos/init.log 2>&1 || true
  
  # === FASE 3: INSTALAR GCC Y BUILD TOOLS ===
  - echo "PHASE_3_GCC" > /var/log/attomos/status
  - echo "[$(date)] Instalando GCC y herramientas de compilación..." >> /var/log/attomos/init.log
  - for i in 1 2 3; do apt-get update -y 2>&1 && break || sleep 10; done >> /var/log/attomos/init.log
  - DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential gcc g++ make >> /var/log/attomos/init.log 2>&1
  - gcc --version >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] GCC instalado correctamente" >> /var/log/attomos/init.log
  
  # === FASE 4: INSTALAR GO ===
  - echo "PHASE_4_GOLANG" > /var/log/attomos/status
  - echo "[$(date)] Instalando Go 1.24..." >> /var/log/attomos/init.log
  - cd /tmp
  - wget -q https://go.dev/dl/go1.24.0.linux-amd64.tar.gz >> /var/log/attomos/init.log 2>&1
  - rm -rf /usr/local/go
  - tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz >> /var/log/attomos/init.log 2>&1
  - rm go1.24.0.linux-amd64.tar.gz
  - echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
  - echo 'export PATH=$PATH:/usr/local/go/bin' >> /root/.bashrc
  - export PATH=$PATH:/usr/local/go/bin
  - /usr/local/go/bin/go version >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Go instalado correctamente" >> /var/log/attomos/init.log
  
  # === FASE 5: CREAR ESTRUCTURA DE DIRECTORIOS ===
  - echo "PHASE_5_DIRECTORIES" > /var/log/attomos/status
  - echo "[$(date)] Creando estructura de directorios..." >> /var/log/attomos/init.log
  - mkdir -p /opt/atomic-bots/agents
  - mkdir -p /var/log/atomic-bots
  - chmod 755 /opt/atomic-bots
  - chmod 755 /var/log/atomic-bots
  - echo "[$(date)] Directorios creados" >> /var/log/attomos/init.log
  
  # === FASE 5: INSTALAR Y CONFIGURAR NGINX (para servir imágenes de servicios) ===
  - echo "PHASE_5_NGINX" > /var/log/attomos/status
  - echo "[$(date)] Instalando nginx..." >> /var/log/attomos/init.log
  - DEBIAN_FRONTEND=noninteractive apt-get install -y nginx >> /var/log/attomos/init.log 2>&1
  - mkdir -p /var/www/uploads
  - chmod 755 /var/www/uploads
  - |
    cat > /etc/nginx/sites-available/uploads << 'EOFNGINX'
    server {
        listen 80;
        server_name _;

        # Servir imágenes de servicios de todos los usuarios
        location /uploads/ {
            alias /var/www/uploads/;
            expires 30d;
            add_header Cache-Control "public, no-transform";
            add_header X-Content-Type-Options nosniff;
            autoindex off;
        }

        # Health check
        location /health {
            return 200 "ok";
            add_header Content-Type text/plain;
        }
    }
    EOFNGINX
  - ln -sf /etc/nginx/sites-available/uploads /etc/nginx/sites-enabled/uploads
  - rm -f /etc/nginx/sites-enabled/default
  - nginx -t >> /var/log/attomos/init.log 2>&1
  - systemctl enable nginx >> /var/log/attomos/init.log 2>&1
  - systemctl start nginx >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Nginx configurado para servir uploads" >> /var/log/attomos/init.log

  # === FASE 6: CONFIGURAR FIREWALL ===
  - echo "PHASE_6_FIREWALL" > /var/log/attomos/status
  - echo "[$(date)] Configurando firewall..." >> /var/log/attomos/init.log
  - ufw --force enable >> /var/log/attomos/init.log 2>&1
  - ufw allow 22 >> /var/log/attomos/init.log 2>&1
  - ufw allow 80 >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Firewall configurado (puertos para bots se abrirán bajo demanda)" >> /var/log/attomos/init.log
  
  # === FASE 7: OPTIMIZACIONES DEL SISTEMA ===
  - echo "PHASE_7_OPTIMIZATIONS" > /var/log/attomos/status
  - echo "[$(date)] Aplicando optimizaciones del sistema..." >> /var/log/attomos/init.log
  - echo "fs.file-max = 200000" >> /etc/sysctl.conf
  - echo "net.core.somaxconn = 2048" >> /etc/sysctl.conf
  - echo "vm.max_map_count = 262144" >> /etc/sysctl.conf
  - sysctl -p >> /var/log/attomos/init.log 2>&1 || true
  - echo "[$(date)] Optimizaciones aplicadas" >> /var/log/attomos/init.log
  
  # === FASE 8: HEALTH CHECK ===
  - echo "PHASE_8_HEALTH_CHECK" > /var/log/attomos/status
  - |
    cat > /opt/health_check.sh << 'EOFHEALTH'
    #!/bin/bash
    echo "=== HEALTH CHECK - SERVIDOR GLOBAL ATOMIC BOTS ==="
    command -v go && echo "Go OK" || exit 1
    command -v gcc && echo "GCC OK" || exit 1
    [ -d /opt/atomic-bots/agents ] && echo "Directorio de agentes OK" || exit 1
    [ -f /var/log/attomos/status ] && cat /var/log/attomos/status
    [ "$(cat /var/log/attomos/status)" = "CLOUD_INIT_COMPLETE" ] && echo "SERVIDOR LISTO PARA DESPLEGAR ATOMIC BOTS" && exit 0
    exit 2
    EOFHEALTH
  - chmod +x /opt/health_check.sh
  - echo "[$(date)] Health check creado" >> /var/log/attomos/init.log
  
  # === FASE 9: CREAR SCRIPT DE GESTIÓN DE BOTS ===
  - echo "PHASE_9_BOT_MANAGER" > /var/log/attomos/status
  - |
    cat > /opt/atomic-bots/bot-manager.sh << 'EOFMANAGER'
    #!/bin/bash
    # Script para gestionar bots AtomicBot
    
    case "$1" in
      list)
        echo "=== BOTS ACTIVOS ==="
        systemctl list-units --type=service --state=running | grep atomic-bot
        ;;
      status)
        if [ -z "$2" ]; then
          echo "Uso: bot-manager.sh status <agent_id>"
          exit 1
        fi
        systemctl status atomic-bot-$2
        ;;
      logs)
        if [ -z "$2" ]; then
          echo "Uso: bot-manager.sh logs <agent_id> [lines]"
          exit 1
        fi
        LINES=${3:-50}
        tail -n $LINES /var/log/atomic-bot-$2.log
        ;;
      restart)
        if [ -z "$2" ]; then
          echo "Uso: bot-manager.sh restart <agent_id>"
          exit 1
        fi
        systemctl restart atomic-bot-$2
        ;;
      stop)
        if [ -z "$2" ]; then
          echo "Uso: bot-manager.sh stop <agent_id>"
          exit 1
        fi
        systemctl stop atomic-bot-$2
        ;;
      *)
        echo "Uso: bot-manager.sh {list|status|logs|restart|stop} [agent_id] [args]"
        exit 1
        ;;
    esac
    EOFMANAGER
  - chmod +x /opt/atomic-bots/bot-manager.sh
  - echo "[$(date)] Bot manager creado" >> /var/log/attomos/init.log
  
  # === COMPLETADO ===
  - echo "CLOUD_INIT_COMPLETE" > /var/log/attomos/status
  - date >> /var/log/attomos/init.log
  - echo "[$(date)] ✅ SERVIDOR GLOBAL DE ATOMIC BOTS INICIALIZADO" >> /var/log/attomos/init.log
  - echo "[$(date)] Listo para desplegar hasta 100 AtomicBots" >> /var/log/attomos/init.log
  - /opt/health_check.sh >> /var/log/attomos/init.log 2>&1
`
}

// CreateServer crea un nuevo servidor en Hetzner (para BuilderBot - usuarios individuales)
func (h *HetznerService) CreateServer(serverName string, userID uint) (*ServerResponse, error) {
	url := "https://api.hetzner.cloud/v1/servers"

	payload := map[string]interface{}{
		"name":        fmt.Sprintf("user-%d-server", userID),
		"server_type": "cx23",
		"image":       "ubuntu-22.04",
		"location":    "nbg1",
		"ssh_keys":    []string{},
		"user_data":   h.getCloudInitScript(userID),
		"labels": map[string]string{
			"user_id":     fmt.Sprintf("%d", userID),
			"server_name": fmt.Sprintf("user-%d-server", userID),
			"type":        "shared-server",
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+h.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("error al crear servidor: %s - %s", resp.Status, string(body))
	}

	var serverResp ServerResponse
	if err := json.Unmarshal(body, &serverResp); err != nil {
		return nil, err
	}

	return &serverResp, nil
}

// getCloudInitScript genera el script de inicialización para BuilderBot
func (h *HetznerService) getCloudInitScript(userID uint) string {
	return `#cloud-config

chpasswd:
  expire: false

ssh_pwauth: true

package_update: true
package_upgrade: false

packages:
  - curl
  - git
  - ca-certificates
  - gnupg
  - build-essential
  - gcc
  - nginx
  - certbot
  - python3-certbot-nginx
  - apt-transport-https
  - software-properties-common

runcmd:
  # === FASE 1: SETUP INICIAL ===
  - mkdir -p /var/log/attomos /opt/agents /opt/chatwoot
  - echo "INICIO" > /var/log/attomos/init.log
  - date >> /var/log/attomos/init.log
  - echo "PHASE_1_START" > /var/log/attomos/status
  - chage -I -1 -m 0 -M 99999 -E -1 root
  
  # === FASE 2: INSTALAR DOCKER ===
  - echo "PHASE_2_DOCKER" > /var/log/attomos/status
  - echo "[$(date)] Instalando Docker..." >> /var/log/attomos/init.log
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update -y >> /var/log/attomos/init.log 2>&1
  - DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin >> /var/log/attomos/init.log 2>&1
  - systemctl enable docker >> /var/log/attomos/init.log 2>&1
  - systemctl start docker >> /var/log/attomos/init.log 2>&1
  - docker --version >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Docker instalado" >> /var/log/attomos/init.log
  
  # === FASE 3: INSTALAR NODE.JS Y PM2 ===
  - echo "PHASE_3_NODEJS" > /var/log/attomos/status
  - echo "[$(date)] Instalando Node.js..." >> /var/log/attomos/init.log
  - curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  - echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  - apt-get update -y >> /var/log/attomos/init.log 2>&1
  - DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >> /var/log/attomos/init.log 2>&1
  - sleep 3
  - node --version >> /var/log/attomos/init.log 2>&1
  - npm --version >> /var/log/attomos/init.log 2>&1
  - npm install -g pm2 >> /var/log/attomos/init.log 2>&1
  - sleep 3
  - pm2 --version >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Node.js instalado" >> /var/log/attomos/init.log
  
  # === FASE 4: CONFIGURAR CHATWOOT ===
  - echo "PHASE_4_CHATWOOT" > /var/log/attomos/status
  - echo "[$(date)] Configurando Chatwoot..." >> /var/log/attomos/init.log
  - cd /opt/chatwoot
  - |
    cat > docker-compose.yml << 'EOFCOMPOSE'
    services:
      postgres:
        image: pgvector/pgvector:pg16
        container_name: chatwoot-postgres
        restart: always
        volumes:
          - postgres_data:/var/lib/postgresql/data
        environment:
          - POSTGRES_DB=chatwoot_production
          - POSTGRES_USER=postgres
          - POSTGRES_PASSWORD=chatwoot_postgres_password
        networks:
          - chatwoot
        healthcheck:
          test: ["CMD-SHELL", "pg_isready -U postgres"]
          interval: 10s
          timeout: 5s
          retries: 5
    
      redis:
        image: redis:alpine
        container_name: chatwoot-redis
        restart: always
        command: ["sh", "-c", "redis-server --requirepass chatwoot_redis_password"]
        volumes:
          - redis_data:/data
        networks:
          - chatwoot
        healthcheck:
          test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
          interval: 10s
          timeout: 5s
          retries: 5
    
      chatwoot:
        image: chatwoot/chatwoot:latest
        container_name: chatwoot-app
        restart: always
        depends_on:
          postgres:
            condition: service_healthy
          redis:
            condition: service_healthy
        ports:
          - "3000:3000"
        environment:
          - NODE_ENV=production
          - RAILS_ENV=production
          - INSTALLATION_ENV=docker
          - SECRET_KEY_BASE=replace_with_random_string_min_30_chars_` + h.generateRandomString(32) + `
          - FRONTEND_URL=https://chat-user` + fmt.Sprintf("%d", userID) + `.attomos.com
          - POSTGRES_HOST=postgres
          - POSTGRES_PORT=5432
          - POSTGRES_DATABASE=chatwoot_production
          - POSTGRES_USERNAME=postgres
          - POSTGRES_PASSWORD=chatwoot_postgres_password
          - REDIS_URL=redis://:chatwoot_redis_password@redis:6379
          - REDIS_PASSWORD=chatwoot_redis_password
          - MAILER_SENDER_EMAIL=noreply@attomos.com
          - SMTP_DOMAIN=attomos.com
          - ACTIVE_STORAGE_SERVICE=local
          - FORCE_SSL=false
          - ENABLE_ACCOUNT_SIGNUP=true
          - USE_INBOX_AVATAR_FOR_BOT=false
        volumes:
          - chatwoot_storage:/app/storage
        networks:
          - chatwoot
        command: >
          sh -c "bundle exec rails db:chatwoot_prepare && 
                 bundle exec rails db:migrate &&
                 bundle exec rails s -p 3000 -b 0.0.0.0"
        healthcheck:
          test: ["CMD-SHELL", "curl -f http://localhost:3000/api || exit 1"]
          interval: 30s
          timeout: 10s
          retries: 5
          start_period: 180s
    
      sidekiq:
        image: chatwoot/chatwoot:latest
        container_name: chatwoot-sidekiq
        restart: always
        depends_on:
          postgres:
            condition: service_healthy
          redis:
            condition: service_healthy
          chatwoot:
            condition: service_started
        environment:
          - NODE_ENV=production
          - RAILS_ENV=production
          - INSTALLATION_ENV=docker
          - SECRET_KEY_BASE=replace_with_random_string_min_30_chars_` + h.generateRandomString(32) + `
          - FRONTEND_URL=https://chat-user` + fmt.Sprintf("%d", userID) + `.attomos.com
          - POSTGRES_HOST=postgres
          - POSTGRES_PORT=5432
          - POSTGRES_DATABASE=chatwoot_production
          - POSTGRES_USERNAME=postgres
          - POSTGRES_PASSWORD=chatwoot_postgres_password
          - REDIS_URL=redis://:chatwoot_redis_password@redis:6379
          - REDIS_PASSWORD=chatwoot_redis_password
        volumes:
          - chatwoot_storage:/app/storage
        networks:
          - chatwoot
        command: bundle exec sidekiq -C config/sidekiq.yml
    
    networks:
      chatwoot:
        name: chatwoot
    
    volumes:
      postgres_data:
      redis_data:
      chatwoot_storage:
    EOFCOMPOSE
  - echo "[$(date)] docker-compose.yml creado" >> /var/log/attomos/init.log
  - docker compose up -d >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Esperando 180 segundos para que Chatwoot inicie..." >> /var/log/attomos/init.log
  - sleep 180
  - docker compose ps >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Verificando logs de Chatwoot..." >> /var/log/attomos/init.log
  - docker compose logs chatwoot --tail=50 >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Chatwoot configurado" >> /var/log/attomos/init.log
  
  # === FASE 5: CONFIGURAR NGINX ===
  - echo "PHASE_5_NGINX" > /var/log/attomos/status
  - echo "[$(date)] Configurando Nginx..." >> /var/log/attomos/init.log
  - |
    cat > /etc/nginx/sites-available/chatwoot << 'EOFNGINX'
    server {
        listen 80;
        server_name chat-user` + fmt.Sprintf("%d", userID) + `.attomos.com;
        
        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
    EOFNGINX
  - ln -sf /etc/nginx/sites-available/chatwoot /etc/nginx/sites-enabled/
  - rm -f /etc/nginx/sites-enabled/default
  - |
    cat > /etc/nginx/sites-available/uploads << 'EOFUPLOADS'
    server {
        listen 8080;
        server_name _;

        # Servir imágenes de sucursales
        location /uploads/ {
            alias /var/www/uploads/;
            expires 30d;
            add_header Cache-Control "public, no-transform";
            add_header X-Content-Type-Options nosniff;
            autoindex off;
        }

        location /health {
            return 200 "ok";
            add_header Content-Type text/plain;
        }
    }
    EOFUPLOADS
  - ln -sf /etc/nginx/sites-available/uploads /etc/nginx/sites-enabled/uploads
  - mkdir -p /var/www/uploads
  - chmod 755 /var/www/uploads
  - nginx -t >> /var/log/attomos/init.log 2>&1
  - systemctl reload nginx >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Nginx configurado (chatwoot:80 + uploads:8080)" >> /var/log/attomos/init.log
  
  # === FASE 6: CONFIGURAR FIREWALL ===
  - echo "PHASE_6_FIREWALL" > /var/log/attomos/status
  - echo "[$(date)] Configurando firewall..." >> /var/log/attomos/init.log
  - ufw --force enable >> /var/log/attomos/init.log 2>&1
  - ufw allow 22 >> /var/log/attomos/init.log 2>&1
  - ufw allow 80 >> /var/log/attomos/init.log 2>&1
  - ufw allow 443 >> /var/log/attomos/init.log 2>&1
  - ufw allow 3000 >> /var/log/attomos/init.log 2>&1
  - ufw allow 8080 >> /var/log/attomos/init.log 2>&1
  - echo "[$(date)] Firewall configurado (puertos para BuilderBot se abrirán bajo demanda)" >> /var/log/attomos/init.log
  
  # === FASE 7: OPTIMIZACIONES DEL SISTEMA ===
  - echo "PHASE_7_OPTIMIZATIONS" > /var/log/attomos/status
  - echo "fs.file-max = 100000" >> /etc/sysctl.conf
  - echo "net.core.somaxconn = 1024" >> /etc/sysctl.conf
  - sysctl -p >> /var/log/attomos/init.log 2>&1 || true
  
  # === FASE 8: HEALTH CHECK ===
  - echo "PHASE_8_HEALTH_CHECK" > /var/log/attomos/status
  - |
    cat > /opt/health_check.sh << 'EOFHEALTH'
    #!/bin/bash
    echo "=== HEALTH CHECK ==="
    command -v node && echo "Node OK" || exit 1
    command -v npm && echo "NPM OK" || exit 1
    command -v pm2 && echo "PM2 OK" || exit 1
    command -v docker && echo "Docker OK" || exit 1
    docker ps | grep chatwoot && echo "Chatwoot OK" || exit 1
    curl -f http://localhost:3000/api && echo "Chatwoot API OK" || exit 1
    [ -f /var/log/attomos/status ] && cat /var/log/attomos/status
    [ "$(cat /var/log/attomos/status)" = "CLOUD_INIT_COMPLETE" ] && echo "SERVIDOR LISTO PARA DESPLEGAR BOTS" && exit 0
    exit 2
    EOFHEALTH
  - chmod +x /opt/health_check.sh
  
  # === COMPLETADO ===
  - echo "CLOUD_INIT_COMPLETE" > /var/log/attomos/status
  - date >> /var/log/attomos/init.log
  - echo "[$(date)] COMPLETADO" >> /var/log/attomos/init.log
  - echo "[$(date)] Verificando Chatwoot final..." >> /var/log/attomos/init.log
  - curl -v http://localhost:3000/api >> /var/log/attomos/init.log 2>&1 || echo "Chatwoot no responde aún" >> /var/log/attomos/init.log 2>&1
`
}

// generateRandomString genera una cadena aleatoria
func (h *HetznerService) generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)
	for i := range result {
		result[i] = charset[i%len(charset)]
	}
	return string(result)
}

// MonitorCloudInitLogs conecta por SSH y muestra los logs en tiempo real
func (h *HetznerService) MonitorCloudInitLogs(serverIP, password string, duration time.Duration) {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║           📡 MONITOREANDO LOGS DE INICIALIZACIÓN              ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Printf("🌐 IP: %s\n", serverIP)
	fmt.Printf("⏱️  Duración: %v\n\n", duration)

	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	// Intentar conectar con reintentos
	var client *ssh.Client
	var err error
	maxRetries := 30

	for i := 0; i < maxRetries; i++ {
		fmt.Printf("[SSH] Intento de conexión %d/%d...\n", i+1, maxRetries)
		client, err = ssh.Dial("tcp", serverIP+":22", config)
		if err == nil {
			fmt.Println("✅ [SSH] Conectado exitosamente")
			break
		}
		if i < maxRetries-1 {
			fmt.Printf("⚠️  Error: %v - Reintentando en 10s...\n", err)
			time.Sleep(10 * time.Second)
		}
	}

	if err != nil {
		fmt.Printf("❌ [SSH] No se pudo conectar después de %d intentos: %v\n", maxRetries, err)
		return
	}
	defer client.Close()

	// Monitorear logs
	session, err := client.NewSession()
	if err != nil {
		fmt.Printf("❌ Error creando sesión: %v\n", err)
		return
	}
	defer session.Close()

	// Comando para seguir los logs
	cmd := fmt.Sprintf("timeout %d tail -f /var/log/attomos/init.log 2>/dev/null || tail -100 /var/log/cloud-init-output.log", int(duration.Seconds()))

	stdout, err := session.StdoutPipe()
	if err != nil {
		fmt.Printf("❌ Error creando pipe: %v\n", err)
		return
	}

	if err := session.Start(cmd); err != nil {
		fmt.Printf("❌ Error iniciando comando: %v\n", err)
		return
	}

	// Leer y mostrar logs en tiempo real
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("📜 LOGS DE INICIALIZACIÓN (EN TIEMPO REAL):")
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()

	buf := make([]byte, 1024)
	for {
		n, err := stdout.Read(buf)
		if err != nil {
			if err != io.EOF {
				fmt.Printf("\n⚠️  Error leyendo logs: %v\n", err)
			}
			break
		}
		if n > 0 {
			fmt.Print(string(buf[:n]))
		}
	}

	session.Wait()
	fmt.Print("\n═══════════════════════════════════════════════════════════════\n")
	fmt.Println("📊 FIN DE MONITOREO DE LOGS")
	fmt.Print("═══════════════════════════════════════════════════════════════\n")
}

// WaitForServer espera a que el servidor esté en estado "running"
func (h *HetznerService) WaitForServer(serverID int, maxWaitTime time.Duration) error {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║      ⏳ ESPERANDO QUE SERVIDOR ESTÉ EN ESTADO 'RUNNING'       ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")

	url := fmt.Sprintf("https://api.hetzner.cloud/v1/servers/%d", serverID)

	startTime := time.Now()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	attempt := 0
	lastStatus := ""

	for range ticker.C {
		attempt++
		elapsed := time.Since(startTime).Round(time.Second)

		if elapsed > maxWaitTime {
			fmt.Println("\n❌ TIMEOUT: Servidor no alcanzó estado 'running'")
			return errors.New("timeout esperando que el servidor esté en estado running")
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			fmt.Printf("⚠️  [Intento %d] Error creando request: %v\n", attempt, err)
			continue
		}

		req.Header.Set("Authorization", "Bearer "+h.apiToken)

		resp, err := h.client.Do(req)
		if err != nil {
			fmt.Printf("⚠️  [Intento %d] Error en petición HTTP: %v\n", attempt, err)
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var statusResp ServerStatusResponse
		if err := json.Unmarshal(body, &statusResp); err != nil {
			fmt.Printf("⚠️  [Intento %d] Error parseando respuesta: %v\n", attempt, err)
			continue
		}

		currentStatus := statusResp.Server.Status

		if currentStatus != lastStatus {
			fmt.Printf("\n🔄 [%v] Cambio de estado: '%s' → '%s'\n", elapsed, lastStatus, currentStatus)
			lastStatus = currentStatus
		} else if attempt%3 == 0 {
			fmt.Printf("⏱️  [%v] Estado actual: '%s' - Esperando 'running'...\n", elapsed, currentStatus)
		}

		if currentStatus == "running" {
			fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
			fmt.Println("║           ✅ SERVIDOR EN ESTADO 'RUNNING'                      ║")
			fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
			fmt.Printf("⏱️  Tiempo total: %v\n", elapsed)
			fmt.Printf("📊 Intentos: %d\n", attempt)
			fmt.Print("\n💡 Nota: Cloud-init continuará ejecutándose en segundo plano\n")
			return nil
		}
	}

	return errors.New("timeout esperando que el servidor esté listo")
}

// DeleteServer elimina un servidor
func (h *HetznerService) DeleteServer(serverID int) error {
	url := fmt.Sprintf("https://api.hetzner.cloud/v1/servers/%d", serverID)

	req, err := http.NewRequest("DELETE", url, nil)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+h.apiToken)

	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("error al eliminar servidor: %s - %s", resp.Status, string(body))
	}

	return nil
}

// GetServerInfo obtiene información de un servidor
func (h *HetznerService) GetServerInfo(serverID int) (*ServerStatusResponse, error) {
	url := fmt.Sprintf("https://api.hetzner.cloud/v1/servers/%d", serverID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+h.apiToken)

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error al obtener info del servidor: %s", resp.Status)
	}

	var statusResp ServerStatusResponse
	if err := json.Unmarshal(body, &statusResp); err != nil {
		return nil, err
	}

	return &statusResp, nil
}

// OpenPortForAgent abre un puerto específico en el firewall para un agente BuilderBot
func (h *HetznerService) OpenPortForAgent(serverIP, password string, port int) error {
	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	client, err := ssh.Dial("tcp", serverIP+":22", config)
	if err != nil {
		return fmt.Errorf("error conectando por SSH: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("error creando sesión: %w", err)
	}
	defer session.Close()

	cmd := fmt.Sprintf("ufw allow %d/tcp && ufw status", port)
	output, err := session.CombinedOutput(cmd)
	if err != nil {
		return fmt.Errorf("error abriendo puerto %d: %w\nOutput: %s", port, err, string(output))
	}

	fmt.Printf("✅ Puerto %d abierto en firewall", port)
	return nil
}
