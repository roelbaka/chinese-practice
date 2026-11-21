output "server_ip" {
  description = "Public IP of the web server. Point your domain's A record here."
  value       = scaleway_instance_ip.web.address
}

output "url" {
  value = var.domain != "" ? "https://${var.domain}" : "http://${scaleway_instance_ip.web.address}"
}

output "ssh" {
  value = "ssh root@${scaleway_instance_ip.web.address}"
}

output "database_host" {
  value = "${scaleway_rdb_instance.db.load_balancer[0].ip}:${scaleway_rdb_instance.db.load_balancer[0].port}"
}

output "database_url" {
  description = "Also written to /opt/app/.env on the server."
  value       = "postgresql://${var.db_user}:${random_password.db.result}@${scaleway_rdb_instance.db.load_balancer[0].ip}:${scaleway_rdb_instance.db.load_balancer[0].port}/${var.db_name}?sslmode=require"
  sensitive   = true
}

output "redis_password" {
  value     = random_password.redis.result
  sensitive = true
}
