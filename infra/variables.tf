variable "region" {
  description = "Scaleway region (managed database lives here)."
  type        = string
  default     = "nl-ams"
}

variable "zone" {
  description = "Scaleway zone for the server. Stardust is only sold in some zones (e.g. nl-ams-1, fr-par-1)."
  type        = string
  default     = "nl-ams-1"
}

variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "chinese-practice"
}

variable "ssh_public_key" {
  description = "Your SSH public key (contents of ~/.ssh/id_ed25519.pub)."
  type        = string
}

variable "repo_url" {
  description = "Git repository with the static site."
  type        = string
  default     = "https://github.com/roelbaka/chinese-practice.git"
}

variable "domain" {
  description = "Domain (a DNS zone in Scaleway Domains & DNS). Gets A records for the apex and www; Caddy fetches HTTPS certificates for both. Empty = plain HTTP on the IP, no DNS records."
  type        = string
  default     = "xuexi.nl"
}

variable "swap_size_gb" {
  description = "Swap file on the server."
  type        = number
  default     = 2
}

variable "db_name" {
  type    = string
  default = "chinese"
}

variable "db_user" {
  type    = string
  default = "chinese"
}

variable "db_engine" {
  description = "Managed PostgreSQL version."
  type        = string
  default     = "PostgreSQL-16"
}
