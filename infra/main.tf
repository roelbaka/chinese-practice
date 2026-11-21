# Smallest possible setup:
#   - one Stardust instance (STARDUST1-S: 1 vCPU, 1 GB RAM, 10 GB local SSD) with a 2 GB swap file,
#     running Caddy (web server / HTTPS) and Redis as a sidecar container for sessions
#   - one managed PostgreSQL (DB-DEV-S), reachable only from the server's public IP

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
      database_url   = "postgresql://${var.db_user}:${random_password.db.result}@${scaleway_rdb_instance.db.load_balancer[0].ip}:${scaleway_rdb_instance.db.load_balancer[0].port}/${var.db_name}?sslmode=require"
    })
  }

  depends_on = [scaleway_iam_ssh_key.main]
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

# ---------- Managed PostgreSQL ----------

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "-_"
  min_upper        = 1
  min_lower        = 1
  min_numeric      = 1
  min_special      = 1
}

resource "scaleway_rdb_instance" "db" {
  name           = "${var.name}-db"
  node_type      = "DB-DEV-S" # smallest: 2 vCPU (shared), 2 GB
  engine         = var.db_engine
  is_ha_cluster  = false
  disable_backup = false
  user_name      = var.db_user
  password       = random_password.db.result

  volume_type       = "sbs_5k"
  volume_size_in_gb = 5 # smallest block volume
}

resource "scaleway_rdb_database" "app" {
  instance_id = scaleway_rdb_instance.db.id
  name        = var.db_name
}

resource "scaleway_rdb_privilege" "app" {
  instance_id   = scaleway_rdb_instance.db.id
  user_name     = var.db_user
  database_name = scaleway_rdb_database.app.name
  permission    = "all"
}

# Only the web server may connect to the database.
resource "scaleway_rdb_acl" "db" {
  instance_id = scaleway_rdb_instance.db.id

  acl_rules {
    ip          = "${scaleway_instance_ip.web.address}/32"
    description = "web server"
  }
}
