# State lives in a Scaleway Object Storage bucket (S3-compatible), so GitHub Actions and your laptop
# share it. Create the bucket once by hand (console → Object Storage → nl-ams, private) and keep the
# name in sync with the TF_STATE_BUCKET variable of the GitHub environment.
#
# Credentials: the S3 backend reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, which are the same
# Scaleway API keys (the workflow sets them). Locally:
#   export AWS_ACCESS_KEY_ID=$SCW_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$SCW_SECRET_KEY
#   tofu init -backend-config="bucket=<your bucket>"
terraform {
  backend "s3" {
    key    = "chinese-practice/terraform.tfstate"
    region = "nl-ams"

    endpoints = {
      s3 = "https://s3.nl-ams.scw.cloud"
    }

    # Scaleway is not AWS: skip the AWS-only checks.
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
