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

output "backup_bucket" {
  description = "Object Storage bucket with the Litestream replica of the SQLite database."
  value       = scaleway_object_bucket.backup.name
}

output "redis_password" {
  value     = random_password.redis.result
  sensitive = true
}
