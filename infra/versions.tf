terraform {
  required_version = ">= 1.6.0"

  required_providers {
    scaleway = {
      source  = "scaleway/scaleway"
      version = "~> 2.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Credentials come from the environment, never from this repo:
#   export SCW_ACCESS_KEY=...  SCW_SECRET_KEY=...  SCW_DEFAULT_PROJECT_ID=...
provider "scaleway" {
  zone   = var.zone
  region = var.region
}
