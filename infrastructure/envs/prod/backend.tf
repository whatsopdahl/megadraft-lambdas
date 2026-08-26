# Same state bucket the infrastructure repo uses, under a distinct key so the
# two repos' states never collide. Kept under the "fantasy-draft/" prefix
# that github-actions-lambda-deploy's TerraformState IAM statement already
# grants, so no bucket-policy change was needed to add this state.
terraform {
  backend "s3" {
    bucket       = "fantasy-draft-terraform-state-381491860914"
    key          = "fantasy-draft/lambda-prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
