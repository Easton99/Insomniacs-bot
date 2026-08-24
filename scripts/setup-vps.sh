#!/usr/bin/env bash
# VPS initial setup script.
# Run once as the ubuntu user on a fresh OVH/Ubuntu 24.04 VPS:
#
#   bash scripts/setup-vps.sh
#
# What this does:
#   - Creates a non-root admin user (adam)
#   - Installs UFW and locks down inbound traffic to SSH only
#   - Enables automatic security updates
#   - Installs Docker Engine (official repo)
#   - Creates /opt project directories
#
# What you still need to do manually after this script finishes:
#   See the printed checklist at the end.

set -euo pipefail

ADMIN_USER="adam"

echo ""
echo "=== VPS Setup ==="
echo ""

# ── 1. Create admin user ───────────────────────────────────────────────────────
if id "$ADMIN_USER" &>/dev/null; then
  echo "[skip] User $ADMIN_USER already exists"
else
  echo "[+] Creating user $ADMIN_USER..."
  sudo adduser --gecos "" "$ADMIN_USER"
  sudo usermod -aG sudo "$ADMIN_USER"
  echo "[ok] User $ADMIN_USER created and added to sudo"
fi

# ── 2. UFW firewall ────────────────────────────────────────────────────────────
echo "[+] Configuring UFW firewall..."
sudo apt-get install -y ufw -q
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw --force enable
echo "[ok] UFW enabled — only SSH is open"

# ── 3. Automatic security updates ─────────────────────────────────────────────
echo "[+] Enabling automatic security updates..."
sudo apt-get install -y unattended-upgrades -q
echo 'Unattended-Upgrade::Automatic-Reboot "false";' | \
  sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-local > /dev/null
sudo systemctl enable --now unattended-upgrades
echo "[ok] Automatic security updates enabled (no auto-reboot)"

# ── 4. Docker Engine ───────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  echo "[skip] Docker already installed ($(docker --version))"
else
  echo "[+] Installing Docker Engine..."
  sudo apt-get update -q
  sudo apt-get install -y ca-certificates curl -q
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -q
  sudo apt-get install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin -q
  echo "[ok] Docker installed ($(docker --version))"
fi

# Add admin user to docker group
if groups "$ADMIN_USER" | grep -q docker; then
  echo "[skip] $ADMIN_USER already in docker group"
else
  sudo usermod -aG docker "$ADMIN_USER"
  echo "[ok] Added $ADMIN_USER to docker group"
fi

# ── 5. Directory structure ─────────────────────────────────────────────────────
echo "[+] Creating /opt project directories..."
sudo mkdir -p /opt/insomniacs-bot /opt/infrastructure /opt/game-servers
sudo chown -R "$ADMIN_USER:$ADMIN_USER" /opt/insomniacs-bot /opt/infrastructure /opt/game-servers
echo "[ok] Directories created under /opt"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo ""
echo "Manual steps remaining (in order):"
echo ""
echo "  1. Copy your SSH public key to $ADMIN_USER's authorized_keys:"
echo "       mkdir -p /home/$ADMIN_USER/.ssh && chmod 700 /home/$ADMIN_USER/.ssh"
echo "       echo 'YOUR_PUBLIC_KEY_HERE' >> /home/$ADMIN_USER/.ssh/authorized_keys"
echo "       chmod 600 /home/$ADMIN_USER/.ssh/authorized_keys"
echo "       chown -R $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.ssh"
echo ""
echo "  2. Open a NEW terminal and verify SSH key login works:"
echo "       ssh -i ~/.ssh/id_ed25519_ovh $ADMIN_USER@$(hostname -I | awk '{print $1}')"
echo ""
echo "  3. ONLY after confirming key login — harden SSH (as $ADMIN_USER with sudo):"
echo "       sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config"
echo "       sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config"
echo "       sudo systemctl restart sshd"
echo ""
echo "  4. Deploy the bot (as $ADMIN_USER):"
echo "       cd /opt/insomniacs-bot"
echo "       git clone https://github.com/Easton99/Insomniacs-bot.git ."
echo "       cp .env.example .env && nano .env   # fill in your secrets"
echo "       mkdir -p data"
echo "       bash deploy.sh"
echo ""
