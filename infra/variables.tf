variable "region" {
  description = "Scaleway region (Object Storage bucket for the SQLite backups)."
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

# Key of a separate Scaleway IAM application that may only read/write objects (made by hand, so the
# deploy key needs no IAM rights). In GitHub: secrets LIFESTREAMSCWKEYID and LIFESTREAMSCWSECRET.
variable "litestream_access_key_id" {
  description = "Access key Litestream uses for the backup bucket."
  type        = string
  sensitive   = true
}

variable "litestream_secret_key" {
  description = "Secret key Litestream uses for the backup bucket."
  type        = string
  sensitive   = true
}

# Google sign-in (OAuth client in Google Cloud). Redirect URI: https://<domain>/auth/google/callback.
# In GitHub: secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
variable "google_client_id" {
  description = "Google OAuth client id."
  type        = string
}

variable "google_client_secret" {
  description = "Google OAuth client secret."
  type        = string
  sensitive   = true
}
