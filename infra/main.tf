# Smallest possible setup:
#   - one Stardust instance (STARDUST1-S: 1 vCPU, 1 GB RAM, 10 GB local SSD) with a 2 GB swap file,
#     running Caddy (web server / HTTPS), Redis as a sidecar for sessions, and Litestream
#   - SQLite on the server's disk; Litestream streams every change to a private Object Storage bucket
#     and restores the database from it when a new server boots

# ---------- Server ----------

resource "scaleway_iam_ssh_key" "main" {
  name       = "${var.name}-key"
  public_key = var.ssh_public_key
}

resource "scaleway_instance_ip" "web" {}

resource "scaleway_instance_security_group" "web" {
  name                    = "${var.name}-web"
  inbound_default_policy  = "drop"
  outbound_default_policy = "accept"

  inbound_rule {
    action   = "accept"
    port     = 22
    protocol = "TCP"
  }
  inbound_rule {
    action   = "accept"
    port     = 80
    protocol = "TCP"
  }
  inbound_rule {
    action   = "accept"
    port     = 443
    protocol = "TCP"
  }
}

resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "scaleway_instance_server" "web" {
  name              = "${var.name}-web"
  type              = "STARDUST1-S"
  image             = "ubuntu_noble"
  ip_id             = scaleway_instance_ip.web.id
  security_group_id = scaleway_instance_security_group.web.id

  root_volume {
    volume_type = "l_ssd" # Stardust comes with 10 GB local SSD
    size_in_gb  = 10
  }

  user_data = {
    cloud-init = templatefile("${path.module}/cloud-init.yaml", {
      swap_size_gb   = var.swap_size_gb
      repo_url       = var.repo_url
      domain         = var.domain
      redis_password = random_password.redis.result
      backup_bucket  = scaleway_object_bucket.backup.name
      region         = var.region
      backup_key_id  = var.litestream_access_key_id
      backup_secret  = var.litestream_secret_key
    })
  }

  # cloud-init only runs on first boot: a new config means a new server. The database survives,
  # because Litestream restores it from the bucket.
  lifecycle {
    replace_triggered_by = [terraform_data.cloud_init_version]
  }

  depends_on = [scaleway_iam_ssh_key.main]
}

resource "terraform_data" "cloud_init_version" {
  input = filesha256("${path.module}/cloud-init.yaml")
}

# ---------- DNS (zone xuexi.nl in Scaleway Domains & DNS) ----------

resource "scaleway_domain_record" "apex" {
  count    = var.domain != "" ? 1 : 0
  dns_zone = var.domain
  name     = ""
  type     = "A"
  data     = scaleway_instance_ip.web.address
  ttl      = 300
}

resource "scaleway_domain_record" "www" {
  count    = var.domain != "" ? 1 : 0
  dns_zone = var.domain
  name     = "www"
  type     = "A"
  data     = scaleway_instance_ip.web.address
  ttl      = 300
}

# ---------- SQLite backups (Litestream → Object Storage) ----------

resource "random_id" "backup" {
  byte_length = 3
}

resource "scaleway_object_bucket" "backup" {
  name = "${var.name}-db-${random_id.backup.hex}"

  versioning {
    enabled = false
  }
}
