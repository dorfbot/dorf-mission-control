#!/bin/bash
# Install Mission Control as a systemd service

SERVICE_FILE="/etc/systemd/system/mission-control.service"

sudo tee $SERVICE_FILE > /dev/null << 'EOF'
[Unit]
Description=Mission Control Dashboard
After=network.target

[Service]
Type=simple
User=pro
WorkingDirectory=/home/pro/.openclaw/workspace/mission-control
ExecStart=/usr/bin/node /home/pro/.openclaw/workspace/mission-control/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mission-control
sudo systemctl start mission-control
sudo systemctl status mission-control
